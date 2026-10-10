// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EACH MONTH INVOICED IN ADVANCE (workplan 0111, slice 4 of §"The build,
 * sliced"; decision 6, the owner, 2026-10-05: *"no, please invoice in advance
 * of the month"*). The wiring half.
 *
 * Every hour each active organisation's month is brought in step with what it
 * bills: on the month's first day a draft for the tier it starts on, and after
 * a move up a draft for the difference, each under its own reference. What a
 * month bills, the one step it lacks, its price and its words are
 * `openTheMonth`'s (packages/managed/src/month-invoice.ts), tested there on a
 * real database. THIS FILE IS ONLY THE WIRING: the switch, the list, each
 * organisation's scope and language, and the schedule.
 *
 * Hourly, so a month is opened within its first hour and a move up is
 * invoiced within the hour, well inside the day decision 6 allows; at :23,
 * off the hour everything else is drawn to. A run with nothing to do reads
 * and writes nothing per organisation but a lock and the peak's true-up.
 *
 * OFF UNTIL IT IS SWITCHED ON, AND NEVER DURING THE ALPHA. While
 * `OWNPACE_BILLING_FROM` is empty nobody is invoiced, whatever runs (decision
 * 7); before its month, nobody either. While the stage is `alpha` nothing is
 * charged (0131 D1), and the run says so and stops. A value that is not a
 * month is refused, loudly, every hour, until it is one or empty. Each of
 * these stops before the list is read, so nothing about any organisation is
 * read or written then. docs/ending-the-alpha.md is the switch.
 *
 * WHY IT CROSSES ORGANISATIONS, AND WHAT IT READS OF EACH (as workplan 0138 T2
 * split the digest). One question spans organisations: which ones are active.
 * `activeOrganisations` (task-pools.ts) answers it with ids, and nothing more.
 * Everything else is one organisation's, read and written in its own scope on
 * the tenant pool, `app_user`, under row security (`openTaskPools`): its
 * language, the paths it holds (the true-up writes its month's peak), what its
 * month bills (its peak, the data counted, its yeses and picks), the prices it
 * agreed to, its month's invoices, and the draft this run makes. A closed or
 * suspended organisation is not on the list, so nothing is invoiced after a
 * close (decision 13); a move up in the hour before a close is the one step
 * that can go uninvoiced, in the customer's favour.
 *
 * Its pools are opened in its run and ended in `afterwards`, after a failure
 * is on the operator's log page, whose sink is on the tenant pool: an hourly
 * job holds no pool between runs.
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { schedules } from '@trigger.dev/sdk';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { withTenant } from '@openmig/ledger';
import { log, readTenantNotificationPrefs, type TenantId } from '@openmig/shared';
import { monthOf, openTheMonth, whyNobodyIsInvoiced, type MonthOutcome } from '@openmig/managed';
import { leavesAReference } from './what-a-run-leaves.ts';
import { activeOrganisations, openTaskPools } from './task-pools.ts';

const rowsOf = <R>(result: unknown): R[] => (result as { rows: R[] }).rows;

/**
 * One organisation's month, in its own scope: its language, then the step its
 * invoices lack, if any. Exported so the tests run it on a database of their
 * own.
 */
export async function monthOfOrganisation(pool: Pool, organisation: string, now: Date): Promise<MonthOutcome> {
  return withTenant(pool, organisation, async (db) => {
    const [row] = rowsOf<{ settings: unknown }>(await db.execute(sql`SELECT settings FROM tenant WHERE id = ${organisation}`));
    const locale = readTenantNotificationPrefs(row?.settings).locale;
    return openTheMonth(db, organisation as TenantId, now, locale);
  });
}

export const managedMonthInvoices = schedules.task({
  id: 'managed-month-invoices',
  // Every hour at :23 UTC: a month opens within its first hour, and a move up
  // is invoiced within the hour (decision 6 allows a day).
  cron: '23 * * * *',
  run: leavesAReference('managed-month-invoices', async (_payload: unknown, _context: unknown, afterwards) => {
    // This run's pools (0138 T1, T2): the tenant pool on APP_DATABASE_URL,
    // app_user, under row security, and the audit key's pool of one. Opened
    // first, so even a refusal below reaches the log page, and ended once the
    // run is over, after its failure is recorded.
    const pools = openTaskPools();
    afterwards(() => pools.end());
    const now = new Date();

    // The switch (decision 7) and the stage, read before anything about anybody.
    const stop = whyNobodyIsInvoiced(process.env.OWNPACE_BILLING_FROM, process.env.OWNPACE_STAGE, now);
    if (stop) {
      log.info(`[month-invoices] ${stop.said}`);
      return { invoicing: false, reason: stop.reason } as const;
    }

    // The one question across organisations.
    const organisations = await activeOrganisations();
    const counts: Record<MonthOutcome['kind'] | 'failed', number> = {
      made: 0,
      made_elsewhere: 0,
      in_step: 0,
      free: 0,
      nothing_to_add: 0,
      failed: 0,
    };
    for (const organisation of organisations) {
      try {
        // Each organisation as itself, on the tenant pool.
        const outcome = await monthOfOrganisation(pools.tenant, organisation, now);
        counts[outcome.kind]++;
        if (outcome.kind === 'made') {
          log.info(`[month-invoices] organisation ${organisation}: ${outcome.reference}, ${outcome.cents} cents.`);
        }
      } catch (err) {
        // Said, and the next organisation still asked: one month that cannot
        // be read or written must not keep the others from theirs (hard rule 9).
        counts.failed++;
        log.error(
          `[month-invoices] organisation ${organisation}: its month could not be read or invoiced:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const result = { invoicing: true, month: monthOf(now), tenants: organisations.length, ...counts };
    log.info('[month-invoices]', result);
    return result;
  }),
});
