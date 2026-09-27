// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `operator.sh close`: A TESTER'S ACCOUNT ENDED WHEN THEY ASK (workplan 0139 T7
 * (a)).
 *
 * Terms §11 lets a tester end their account. Until the screen for it exists
 * (0144, W14 in 0131 §5), they ask the owner, through the report form or the
 * support address, and choose a window. The Close button needs the
 * organisation's own owner signed in, which the owner is not. So this is how
 * the owner does it: at the machine, over the owner connection, through
 * `closeAccount`, the function the button calls. The two cannot drift.
 *
 * - **The window** is one of `CLOSE_WINDOWS_DAYS`, refused before anything is
 *   read.
 * - **`--by`** is the operator's own subject, and it must be an appointed
 *   operator's (`platform_operator`). The close is recorded under it, in
 *   `tenant_closure.closed_by` and as the audit row's actor.
 * - **`--reference`** names the tester's request (a ticket, the date of their
 *   mail). The audit row keeps it beside the operator, so "who closed this,
 *   and because of what" has its answer on the row.
 * - **It prints what to tell the tester:** both dates, the sentence in both
 *   languages, and what outlives the erasure, from the same answer the button
 *   gives.
 */

import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { withTenant, type LedgerDriver } from '@openmig/ledger';
import { CLOSE_WINDOWS_DAYS, isCloseWindow, type CloseWindowDays } from '@openmig/managed';
import { backupRetentionDaysFromEnv } from '@openmig/shared';
import { closeAccount, type CloseAccountDeps, type ClosedAccount } from '../close-account.ts';

export const CLOSE_USAGE = `Usage:
  operator.sh close <tenant-id> <window-days> --by <your-subject> --reference <the tester's request>

  <window-days>  ${CLOSE_WINDOWS_DAYS.join(', ')}: the days before the erasure. 0 cannot be undone.
  --by           your own subject, as operator.sh list shows it.
  --reference    the tester's request you act on: a ticket, or the date of their mail.`;

/** A close, as the operator typed it. */
export interface CloseCommand {
  readonly tenantId: string;
  readonly windowDays: CloseWindowDays;
  readonly by: string;
  readonly reference: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The command line, read before anything is: every refusal names what to fix. */
export function parseCloseCommand(args: readonly string[]): CloseCommand | { error: string } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--by' || arg === '--reference') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value.\n\n${CLOSE_USAGE}` };
      flags.set(arg, value);
      i++;
    } else if (arg.startsWith('--')) {
      return { error: `${arg} is not an option of close.\n\n${CLOSE_USAGE}` };
    } else {
      positional.push(arg);
    }
  }
  const [tenantId, windowText, ...extra] = positional;
  if (tenantId === undefined || windowText === undefined || extra.length > 0) {
    return { error: `close needs a tenant id and a window.\n\n${CLOSE_USAGE}` };
  }
  if (!UUID.test(tenantId)) return { error: `${tenantId} is not a tenant id: operator.sh check lists them.` };
  const windowDays = /^\d+$/.test(windowText) ? Number(windowText) : Number.NaN;
  if (!isCloseWindow(windowDays)) {
    return {
      error:
        `The window must be one of ${CLOSE_WINDOWS_DAYS.join(', ')} days, not ${windowText}. ` +
        'Nothing was closed.',
    };
  }
  const by = flags.get('--by')?.trim() ?? '';
  if (by === '') return { error: `--by names you: your own subject, as operator.sh list shows it.\n\n${CLOSE_USAGE}` };
  const reference = flags.get('--reference')?.trim() ?? '';
  if (reference === '') {
    return { error: `--reference names the tester's request you act on.\n\n${CLOSE_USAGE}` };
  }
  if (reference.length > 200) return { error: 'The reference is at most 200 characters.' };
  return { tenantId, windowDays, by, reference };
}

/**
 * Close the organisation, as the operator asked, over the owner connection.
 * A subject that is not an appointed operator's closes nothing: the record
 * would name somebody who is nobody.
 */
export async function runCloseCommand(
  source: Pool | LedgerDriver,
  command: CloseCommand,
  deps: CloseAccountDeps,
  now: Date = new Date(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ClosedAccount> {
  // Asked the way the API asks about a signed-in person: as that subject.
  // `platform_operator` shows a subject its own row and nobody else's.
  const appointed = await withTenant(source, command.tenantId, async (db) => {
    await db.execute(sql`SELECT set_config('app.current_user', ${command.by}, true)`);
    const found = (await db.execute(
      sql`SELECT 1 FROM platform_operator WHERE user_id = ${command.by}`,
    )) as unknown as { rows: unknown[] };
    return found.rows.length > 0;
  });
  if (!appointed) {
    throw new Error(
      `${command.by} is not an appointed operator (operator.sh list), so nothing was closed. ` +
        '--by takes your own subject.',
    );
  }
  return closeAccount(
    source,
    {
      tenantId: command.tenantId,
      windowDays: command.windowDays,
      closedBy: command.by,
      via: 'operator',
      reference: command.reference,
      closedAt: now,
      backupRetentionDays: backupRetentionDaysFromEnv(env.BACKUP_RETENTION_DAYS),
    },
    deps,
  );
}

/** What `close` prints: what happened, and what to tell the tester, in both languages. */
export function describeClosed(command: CloseCommand, closed: ClosedAccount): string[] {
  const lines = [
    `Closed ${command.tenantId}, recorded under ${command.by} for "${command.reference}".`,
    `The live service stops holding their data on ${closed.purgeAfter} (a window of ${closed.windowDays} days).`,
    `The erasure completes on ${closed.backupsExpireAt}, when the last backup that could hold it ages out.`,
    closed.canReopenUntil
      ? `It can be reopened until ${closed.canReopenUntil}: POST /api/tenants/:tenantId/reopen, as its owner.`
      : 'A window of 0 cannot be undone.',
    `Passes in flight the orchestrator was asked to stop: ${closed.passesStopped}.`,
  ];
  for (const locale of ['en', 'nl'] as const) {
    lines.push('', locale === 'en' ? 'Tell them, in English:' : 'In Dutch:', `  ${closed.erasureCompletesText[locale]}`);
    for (const access of closed.outlivingAccess[locale]) {
      lines.push(`  ${access.heading}: ${access.body} (${access.where})`);
    }
  }
  return lines;
}
