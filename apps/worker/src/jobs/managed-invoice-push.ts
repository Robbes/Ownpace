// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EACH DRAFT NUMBERED BY MONEYBIRD (workplan 0111, slice 5 of §"The build,
 * sliced"; ADR-0044). The wiring half.
 *
 * Every hour, after the month task has made the hour's drafts, each active
 * organisation's drafts are taken to Moneybird, which numbers them, and the
 * number, the date and the figures come back onto the row. Claiming a draft,
 * deciding what to send, sending it and writing it back are
 * `invoice-push.ts`'s and `moneybird-push.ts`'s, tested there with a
 * Moneybird of their own. THIS FILE IS ONLY THE WIRING: the switches, the
 * list, each organisation's scopes, the pace and the alert.
 *
 * Hourly at :41, eighteen minutes after the month task, so a draft made on a
 * month's first hour is numbered within it.
 *
 * OFF WHERE NOTHING IS INVOICED. The month task's switch holds here too
 * (`whyNobodyIsInvoiced`: `OWNPACE_BILLING_FROM` empty, the Alpha, before its
 * month), so nothing is sent while nothing would be made. Moneybird off
 * (`MONEYBIRD_*` unset) pushes nothing and says so; half a set is refused by
 * key name, every hour. Each stops before the list is read.
 *
 * PACED UNDER MONEYBIRD'S LIMIT. Moneybird allows 150 requests in 5 minutes,
 * and one push makes about seven. So a run pushes at most
 * `PUSHES_PER_RUN`, one every `PUSH_SPACING_MS`, about 85 requests in 5
 * minutes at the most; the rest wait for the next hour. A 429 stops the run
 * where it is.
 *
 * THE ALERT (decision 6). An organisation with a draft still a draft two days
 * after it was made is said as an error, with its references, every run until
 * it is numbered: the operator's log page shows it (0129 T1).
 *
 * WHY IT CROSSES ORGANISATIONS, AND WHAT IT READS OF EACH (as workplan 0138 T2
 * split the digest). One question spans organisations: which ones are active.
 * `activeOrganisations` (task-pools.ts) answers it with ids, and nothing more.
 * Everything else is one organisation's, read and written in its own scope on
 * the tenant pool, `app_user`, under row security (`openTaskPools`): its
 * drafts, claimed one at a time; its invoice details and the latest VIES
 * answer for its number; and the draft written back, numbered.
 *
 * Its pools are opened in its run and ended in `afterwards`, after a failure
 * is on the operator's log page, whose sink is on the tenant pool.
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { schedules } from '@trigger.dev/sdk';
import type { Pool } from 'pg';
import { withTenant } from '@openmig/ledger';
import { log, type TenantId } from '@openmig/shared';
import {
  claimNextDraft,
  draftsBehind,
  moneybirdFromEnv,
  planPush,
  pushInvoice,
  readVatStanding,
  recordIssued,
  whyNobodyIsInvoiced,
  type MoneybirdSettings,
  type PushContext,
} from '@openmig/managed';
import { leavesAReference } from './what-a-run-leaves.ts';
import { activeOrganisations, openTaskPools } from './task-pools.ts';

/** The most drafts one run takes to Moneybird. */
export const PUSHES_PER_RUN = 60;

/** Between two pushes: seven requests each, so about 85 in five minutes at the most. */
export const PUSH_SPACING_MS = 25_000;

/** What one run did, counted. */
export interface PushCounts {
  issued: number;
  adopted: number;
  refused: number;
  unavailable: number;
  slowed: number;
}

/** What the run lets the next push do: how many are left, and whether Moneybird asked it to stop. */
export interface PushBudget {
  left: number;
  stopped: boolean;
}

/**
 * One organisation's drafts, each claimed, decided, sent and written back,
 * then its alert. Exported so the tests run it on a database and a Moneybird
 * of their own.
 */
export async function pushOrganisation(
  pool: Pool,
  organisation: string,
  now: Date,
  settings: MoneybirdSettings,
  context: PushContext,
  budget: PushBudget,
  counts: PushCounts,
  options: { readonly fetchImpl?: typeof fetch; readonly pace?: () => Promise<void> } = {},
): Promise<void> {
  const tenantId = organisation as TenantId;
  while (budget.left > 0 && !budget.stopped) {
    const draft = await withTenant(pool, organisation, (db) => claimNextDraft(db, tenantId, now));
    if (!draft) break;
    budget.left--;
    const standing = await withTenant(pool, organisation, (db) => readVatStanding(db, organisation));
    const plan = planPush(organisation, draft, standing, context);
    if (plan.kind === 'refused') {
      // Held until its lease runs out, and tried again the next hour.
      counts.refused++;
      log.error(`[invoice-push] organisation ${organisation}: ${plan.reason}.`);
      continue;
    }
    const outcome = await pushInvoice(settings, plan.invoice, options.fetchImpl);
    if (outcome.kind === 'issued') {
      await withTenant(pool, organisation, (db) => recordIssued(db, draft, plan, outcome, settings, now));
      counts.issued++;
      if (outcome.adopted) counts.adopted++;
      log.info(`[invoice-push] organisation ${organisation}: ${draft.reference} is ${outcome.invoice.invoiceNumber}.`);
    } else if (outcome.kind === 'refused') {
      counts.refused++;
      log.error(`[invoice-push] organisation ${organisation}: ${outcome.reason}`);
    } else if (outcome.kind === 'unavailable') {
      counts.unavailable++;
      log.warn(`[invoice-push] organisation ${organisation}: ${outcome.reason}`);
    } else {
      counts.slowed++;
      budget.stopped = true;
      log.warn(
        `[invoice-push] Moneybird asked to slow down (retry after ${outcome.retryAfterSeconds ?? 'an unstated number of'} ` +
          'seconds); the rest waits for the next run.',
      );
    }
    if (budget.left > 0 && !budget.stopped) await (options.pace ?? (() => sleep(PUSH_SPACING_MS)))();
  }
  const behind = await withTenant(pool, organisation, (db) => draftsBehind(db, tenantId, now));
  if (behind.length > 0) {
    log.error(
      `[invoice-push] organisation ${organisation}: ${behind.length} invoice(s) still drafts two days after they ` +
        `were made (workplan 0111, decision 6): ${behind.join(', ')}.`,
    );
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const managedInvoicePush = schedules.task({
  id: 'managed-invoice-push',
  // Every hour at :41 UTC, eighteen minutes after the month task's :23.
  cron: '41 * * * *',
  run: leavesAReference('managed-invoice-push', async (_payload: unknown, _context: unknown, afterwards) => {
    // This run's pools (0138 T1, T2), opened first, so even a refusal below
    // reaches the log page, and ended once the run is over.
    const pools = openTaskPools();
    afterwards(() => pools.end());
    const now = new Date();

    // The month task's switch: nothing is sent while nothing would be made.
    const stop = whyNobodyIsInvoiced(process.env.OWNPACE_BILLING_FROM, process.env.OWNPACE_STAGE, now);
    if (stop) {
      log.info(`[invoice-push] nothing is pushed: ${stop.said}`);
      return { pushing: false, reason: stop.reason } as const;
    }
    // Each key named, so the guard on the task environment sees every one of
    // them and holds set-task-env.sh to uploading it.
    const moneybird = moneybirdFromEnv({
      MONEYBIRD_API_TOKEN: process.env.MONEYBIRD_API_TOKEN,
      MONEYBIRD_ADMINISTRATION_ID: process.env.MONEYBIRD_ADMINISTRATION_ID,
      MONEYBIRD_WORKFLOW_ID: process.env.MONEYBIRD_WORKFLOW_ID,
      MONEYBIRD_TAX_RATE_ID_DOMESTIC: process.env.MONEYBIRD_TAX_RATE_ID_DOMESTIC,
      MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE: process.env.MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE,
      MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU: process.env.MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU,
      MONEYBIRD_DELIVERY: process.env.MONEYBIRD_DELIVERY,
    });
    if (moneybird.kind === 'refused') throw new Error(`[invoice-push] ${moneybird.reason}`);
    if (moneybird.kind === 'off') {
      log.warn('[invoice-push] nothing is pushed: Moneybird is off (no MONEYBIRD_* keys are set), and drafts wait.');
      return { pushing: false, reason: 'moneybird_off' } as const;
    }
    const context: PushContext = {
      sellerCountry: process.env.OWNPACE_SELLER_COUNTRY?.trim() || 'NL',
      ossActive: process.env.VAT_OSS_ACTIVE?.trim().toLowerCase() === 'true',
      delivery: moneybird.config.delivery,
    };

    // The one question across organisations.
    const organisations = await activeOrganisations();
    const budget: PushBudget = { left: PUSHES_PER_RUN, stopped: false };
    const counts: PushCounts = { issued: 0, adopted: 0, refused: 0, unavailable: 0, slowed: 0 };
    let failed = 0;
    for (const organisation of organisations) {
      try {
        // Each organisation as itself, on the tenant pool.
        await pushOrganisation(pools.tenant, organisation, now, moneybird.config, context, budget, counts);
      } catch (err) {
        // Said, and the next organisation still pushed (hard rule 9).
        failed++;
        log.error(
          `[invoice-push] organisation ${organisation}: its drafts could not be pushed or written back:`,
          err instanceof Error ? err.message : err,
        );
      }
      if (budget.stopped) break;
    }

    const result = { pushing: true, tenants: organisations.length, ...counts, failed, left: budget.left };
    log.info('[invoice-push]', result);
    return result;
  }),
});
