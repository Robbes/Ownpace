// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ENDING AN ACCOUNT, THE ONE WAY IT IS DONE (workplan 0139 T7 (a); 0085 T2 to
 * T8).
 *
 * Three doors end an account. The owner presses Close (`POST
 * /api/tenants/:tenantId/close`). And a tester who asks the operator to close
 * it, as terms §11 lets them, is closed by the operator: at the machine
 * (`operator.sh close`), or on the organisation's support page (`POST
 * /api/support/tenants/:tenantId/close`, 0139 T7 (b)). All three are this
 * function, so they cannot drift: the same dates, the same sentences in both
 * languages, the same grants named, the same passes stopped.
 *
 * What it does, in order:
 *
 * 1. In one transaction, in the organisation's own context: it reads the kinds
 *    this organisation connected (for the grants only they can withdraw,
 *    0085 T4b), closes it (`closeTenant`), writes an audit row naming who
 *    closed it, how, and for an operator the tester's request, and reads the
 *    passes still in flight.
 * 2. After the commit, it asks the orchestrator to stop each of those passes
 *    (0085 T8). A network call never holds the organisation's transaction open,
 *    and an orchestrator that does not answer never fails the close: the
 *    purge's quiesce is the backstop, and it enforces the safety rule.
 * 3. It answers the dates and the sentences.
 *
 * From the commit on, nothing new starts (0085 T2; the owner's report of
 * 2026-09-28). The close does not touch the migrations; everything else reads
 * the organisation's status. The sync tick starts no pass for it, a pass under
 * way stops starting new items within about fifteen seconds and finishes the
 * ones it has begun (it re-reads between data types and, since 2026-09-29,
 * from inside one: `whyThisDataTypeStops`), the credential builders refuse it, and
 * every door that would start work or use the stored access answers 409
 * `account_closed` (`closed-organisation.ts`). A reopen sets the status back,
 * and all of it runs again.
 *
 * WHAT THE CANCEL SEES. Only runs whose rows say `running` or `queued`. A pass
 * has a row only once a runner starts it (`startRun` writes `running`, and
 * nothing writes `queued`), so a pass the tick queued in the minute before the
 * close, or a retry waiting for its next attempt, is not among them. Those
 * stop by themselves: the pass's own stop check reads the close before any
 * credential is built (`organisation_closed`), and a task that builds readers
 * is refused by the builders.
 *
 * AND WHAT IT DOES NOT SEE, WHICH STOPS ITSELF (workplan 0139 T7). Only a sync
 * pass records the orchestrator's reference on its row. A verification (its
 * row is `verification_run`), a confirmation (a `run` row with none) and a
 * discovery (no row at all) had built their readers before the close and read
 * on to their end. Each now asks whether the organisation is still open
 * between its steps (`organisationStillOpen`): a verification before each
 * listing of a target and each sample it downloads, a confirmation before each
 * item it reads, a discovery before each collection. The step in flight
 * finishes and no other begins; a file source's walk of its folder tree comes
 * before the discovery's first question and runs to its end. A sync pass the
 * cancel did not reach still reads to the end of the data type it is on, and
 * stops before the next.
 *
 * `closeTenant` MUST run in the organisation's context. `tenant` is under
 * FORCE ROW LEVEL SECURITY with an UPDATE policy on `app.current_tenant`, so
 * outside it the UPDATE matches nothing and the close reports an organisation
 * that does not exist. `erasure_record` outlives the organisation because it
 * has no foreign key, not because it is written outside the transaction.
 *
 * It never marks a run row cancelled. A cancellation is a request, and the pass
 * may still be writing when it is acknowledged. A row landed here would tell
 * the purge nothing is in flight while something is, which is how a leaving
 * customer's mail is copied twice into their own target. Whoever finishes the
 * pass lands its row: the worker, or the purge's quiesce.
 *
 * THE PASSES IN FLIGHT ARE READ IN THE ORGANISATION'S CONTEXT. The route used
 * to read them on the API's pool with no organisation set, and `run` is under
 * FORCE ROW LEVEL SECURITY: as `app_user` that read saw no rows, so a close in
 * managed never asked the orchestrator to stop anything.
 */

import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { PgLedger, withTenant, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import * as schema from '@openmig/ledger/schema-pg';
import { closeTenant, reopenTenant, type CloseWindowDays } from '@openmig/managed';
import {
  accessThatOutlivesErasure,
  backupRetentionDaysFromEnv,
  erasureNeverTouches,
  erasureScopeText,
  erasureTimeline,
  erasureTimelineText,
  log,
  standingGrantReminders,
  type TenantId,
} from '@openmig/shared';

/** The audit action a close is recorded under, at every door. */
export const ACCOUNT_CLOSED_ACTION = 'tenant.closed';

/** The audit action a reopen is recorded under, at either door. */
export const ACCOUNT_REOPENED_ACTION = 'tenant.reopened';

/** A close, as either door asks for it. */
export interface CloseAccountRequest {
  readonly tenantId: string;
  readonly windowDays: CloseWindowDays;
  /** Who closed it: the owner's subject at their screen, the operator's at theirs or the machine. */
  readonly closedBy: string;
  /**
   * Whose door: the owner's Close (`screen`), or an operator's (`operator`),
   * which is `operator.sh close` and the support page's Close alike. The audit
   * row's actor says who; the reference says because of what.
   */
  readonly via: 'screen' | 'operator';
  /** The tester's request the operator acts on (0139 T7 (a)): a ticket, a date. */
  readonly reference?: string;
  readonly closedAt: Date;
  /** This deployment's backup retention, as the close promises it (0085 T5). */
  readonly backupRetentionDays: number;
}

/** What a close needs from outside the database. */
export interface CloseAccountDeps {
  /** Ask the orchestrator to stop one run, by its orchestrator reference. */
  readonly cancelRun: (orchestratorRef: string) => Promise<void>;
}

/** What either door answers: the dates, the sentences, and what outlives us. */
export async function closeAccount(
  source: Pool | LedgerDriver,
  request: CloseAccountRequest,
  deps: CloseAccountDeps,
) {
  const { tenantId, windowDays, closedAt, backupRetentionDays } = request;

  const closed = await withTenant(source, tenantId, async (db) => {
    // The grants only THEY can remove (0085 T4b), read before closing, from
    // the kinds this organisation connected.
    const kinds = (await db.select({ kind: schema.connection.kind }).from(schema.connection)).map(
      (r) => r.kind,
    );
    const result = await closeTenant(db, tenantId, windowDays, request.closedBy, closedAt, backupRetentionDays);
    await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
      actor: request.closedBy,
      action: ACCOUNT_CLOSED_ACTION,
      entity: 'tenant',
      detail: {
        windowDays,
        via: request.via,
        ...(request.reference !== undefined ? { reference: request.reference } : {}),
      },
    });
    const inFlight = (await db.execute(sql`
      SELECT id, orchestrator_ref FROM run
       WHERE tenant_id = ${tenantId}::uuid AND status IN ('running', 'queued')
    `)) as unknown as { rows: Array<{ id: string; orchestrator_ref: string | null }> };
    return { kinds, result, inFlight: inFlight.rows };
  });

  // Stop what is already running, after the commit. Best effort, and never a
  // reason to fail the close.
  let passesStopped = 0;
  for (const run of closed.inFlight) {
    if (!run.orchestrator_ref) continue;
    try {
      await deps.cancelRun(run.orchestrator_ref);
      passesStopped++;
    } catch (error) {
      log.warn(
        `[close] could not ask the orchestrator to cancel run ${run.id} ` +
          `(${run.orchestrator_ref}): ${error instanceof Error ? error.message : String(error)}. ` +
          'The erasure quiesce will deal with it before any purge runs.',
      );
    }
  }

  const { kinds, result } = closed;
  // Both dates, and the sentence that explains them. `purgeAfter` alone would
  // be a true statement that reads as a false one: the live database stops
  // holding it that day, and the backups do not (0085 T5).
  const timeline = erasureTimeline({ closedAt, windowDays, backupRetentionDays });
  return {
    status: 'closed' as const,
    purgeAfter: result.purgeAfter.toISOString(),
    windowDays: result.windowDays,
    backupsExpireAt: result.backupsExpireAt.toISOString(),
    backupRetentionDays: result.backupRetentionDays,
    erasureCompletesText: {
      en: erasureTimelineText(timeline, 'en'),
      nl: erasureTimelineText(timeline, 'nl'),
    },
    canReopenUntil: result.windowDays > 0 ? result.purgeAfter.toISOString() : null,
    // How many in-flight passes we asked to stop. Not how many stopped: that is
    // the orchestrator's to confirm, and the purge checks it.
    passesStopped,
    // Kept for callers that already read it. `outlivingAccess` supersedes it
    // and is what new callers should render.
    standingGrants: standingGrantReminders(kinds, 'en'),
    // Everything that keeps working after we have forgotten them: the consents
    // in their providers' consoles AND the app passwords in their own accounts
    // (owner, 2026-08-18). Credentials first: a live app password is a working
    // way in.
    outlivingAccess: {
      en: accessThatOutlivesErasure(kinds, 'en'),
      nl: accessThatOutlivesErasure(kinds, 'nl'),
    },
    // What erasure will NOT do (0085 T6), said at close, which is the moment
    // the customer is deciding.
    neverTouched: {
      en: erasureScopeText('en'),
      nl: erasureScopeText('nl'),
      boundaries: erasureNeverTouches('en'),
    },
  };
}

/** What a close answers. */
export type ClosedAccount = Awaited<ReturnType<typeof closeAccount>>;

/** A reopen, as either door asks for it. */
export interface ReopenAccountRequest {
  readonly tenantId: string;
  /** Who reopened it: the owner's subject, or the operator's. */
  readonly reopenedBy: string;
  /** Whose door: the owner's Reopen (`screen`), or the support page's (`operator`). */
  readonly via: 'screen' | 'operator';
  /** Why an operator reopened it: the request, or the mistake, it answers. */
  readonly reference?: string;
  readonly reopenedAt: Date;
}

/**
 * Undo a close while its window is open, and record who did, at either door
 * (0085 T2; 0139 T7 (b)).
 *
 * `reopenTenant` decides whether it may happen: it refuses an organisation that
 * is not closed, and one whose window has run out, which a window of 0 has from
 * the start. The audit row is written in the same transaction, after it, so a
 * refused reopen records nothing and an allowed one cannot go unrecorded.
 *
 * Nothing is restored by hand: the close left every migration as it was, and
 * everything that starts work reads the organisation's status, which this sets
 * back to `active`.
 */
export async function reopenAccount(
  source: Pool | LedgerDriver,
  request: ReopenAccountRequest,
): Promise<void> {
  const { tenantId } = request;
  await withTenant(source, tenantId, async (db) => {
    await reopenTenant(db, tenantId, request.reopenedAt);
    await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
      actor: request.reopenedBy,
      action: ACCOUNT_REOPENED_ACTION,
      entity: 'tenant',
      detail: {
        via: request.via,
        ...(request.reference !== undefined ? { reference: request.reference } : {}),
      },
    });
  });
}

/*
 * THE OPERATOR'S DOOR (0139 T7 (a) and (b)). `operator.sh close` at the
 * machine, and the support page's Close and Reopen in the API, come here, so
 * the operator's check is the same at both: the subject a close or a reopen is
 * recorded under must be an appointed operator's (`platform_operator`). It
 * lives here, not beside the command's parser in `scripts/operator-close.ts`,
 * because nothing outside `apps/api/src/scripts` may import from there: a
 * script is exempt from `scripts/a-route-that-opened-the-owners-pool.unit.test.ts`
 * as a file the API never loads.
 */

/** The longest reference a close or a reopen keeps on its audit row. */
export const REFERENCE_MAX = 200;

/**
 * The subject a close or a reopen would be recorded under is not an appointed
 * operator's (`platform_operator`), so nothing was done. Its own class, so the
 * support route can answer it as every route there answers somebody who may
 * not see a row (404), without reading the message.
 */
export class NotAnAppointedOperator extends Error {
  constructor(subject: string, nothing: 'closed' | 'reopened' | 'marked as a test' | 'unmarked') {
    super(
      `${subject} is not an appointed operator (operator.sh list), so nothing was ${nothing}. ` +
        '--by takes your own subject.',
    );
    this.name = 'NotAnAppointedOperator';
  }
}

/** A close, as the operator asked for it: typed at the machine (`parseCloseCommand`), or sent from the support page. */
export interface CloseCommand {
  readonly tenantId: string;
  readonly windowDays: CloseWindowDays;
  readonly by: string;
  readonly reference: string;
}

/**
 * Whether `subject` is an appointed operator, asked the way the API asks about
 * a signed-in person: as that subject. `platform_operator` shows a subject its
 * own row and nobody else's. Exported for the support page's other writes in
 * an organisation's own context, its test marker among them (workplan 0162
 * T1, `test-organisation.ts`), so every one asks the same question.
 */
export async function isAppointedOperator(
  source: Pool | LedgerDriver,
  tenantId: string,
  subject: string,
): Promise<boolean> {
  return withTenant(source, tenantId, (db) => actingAsAppointedOperator(db, subject));
}

/**
 * The same question, in the caller's own transaction, which from then on acts
 * as `subject` (`app.current_user`, transaction-local). For a door whose write
 * the database itself allows an operator only (managed 0062's
 * `test_organisation`): the check and the write are then one transaction, and
 * the policy that guards the write reads the same subject the check did.
 */
export async function actingAsAppointedOperator(db: PgDatabase, subject: string): Promise<boolean> {
  await db.execute(sql`SELECT set_config('app.current_user', ${subject}, true)`);
  const found = (await db.execute(
    sql`SELECT 1 FROM platform_operator WHERE user_id = ${subject}`,
  )) as unknown as { rows: unknown[] };
  return found.rows.length > 0;
}

/**
 * Close the organisation, as the operator asked: at the machine over the owner
 * connection, or from the support page over the API's. A subject that is not
 * an appointed operator's closes nothing (`NotAnAppointedOperator`): the record
 * would name somebody who is nobody.
 */
export async function runCloseCommand(
  source: Pool | LedgerDriver,
  command: CloseCommand,
  deps: CloseAccountDeps,
  now: Date = new Date(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ClosedAccount> {
  if (!(await isAppointedOperator(source, command.tenantId, command.by))) {
    throw new NotAnAppointedOperator(command.by, 'closed');
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

/** A reopen, as the operator asked for it on the support page. */
export interface ReopenCommand {
  readonly tenantId: string;
  readonly by: string;
  readonly reference: string;
}

/**
 * Reopen the organisation, as the operator asked, while its window is open:
 * `reopenAccount`, the function the owner's Reopen calls, recorded under the
 * operator with the reference beside `via: operator`. A subject that is not an
 * appointed operator's reopens nothing (`NotAnAppointedOperator`).
 */
export async function reopenAsOperator(
  source: Pool | LedgerDriver,
  command: ReopenCommand,
  now: Date = new Date(),
): Promise<void> {
  if (!(await isAppointedOperator(source, command.tenantId, command.by))) {
    throw new NotAnAppointedOperator(command.by, 'reopened');
  }
  await reopenAccount(source, {
    tenantId: command.tenantId,
    reopenedBy: command.by,
    via: 'operator',
    reference: command.reference,
    reopenedAt: now,
  });
}
