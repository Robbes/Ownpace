// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EACH DRAFT NUMBERED BY MONEYBIRD (workplan 0111, slice 5 of §"The build,
 * sliced"; ADR-0044). The wiring half.
 *
 * Every hour, after the month task has made the hour's drafts, each active
 * organisation's drafts are taken to Moneybird, which numbers them, and the
 * number, the date and the figures come back onto the row. Claiming a draft,
 * deciding what to send, sending it and writing it back are
 * `invoice-push.ts`'s and `moneybird-push.ts`'s, and a credit note's
 * `credit-note.ts`'s and `moneybird-credit-push.ts`'s (slice 7a), and a
 * payment through Mollie booked on its invoice `payment-book.ts`'s (slice 5f),
 * tested there with a Moneybird of their own. THIS FILE IS ONLY THE WIRING:
 * the switches, the list, each organisation's scopes, the pace and the alert.
 *
 * PAYMENTS, BOOKED (slice 5f; the owner, 2026-10-11). After an organisation's
 * documents, each payment Mollie confirmed is booked on its invoice in
 * Moneybird, on `MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE`, so Moneybird never
 * reminds anybody who paid. Unset, nothing is booked, and the run says so.
 *
 * MONEY BACK (slice 7d, its second half). Then each issued credit note's
 * amount is made real, once (`money-back.ts`): what was paid through Mollie
 * above what is owed goes back as a Mollie refund (`MOLLIE_API_KEY`, the
 * API's own), then is booked on the credit note in the books; a credit note
 * with nothing paid above is set against its invoice in the books; one whose
 * invoice was paid by transfer is said to the operator, to pay back by hand.
 *
 * PAID AND LATE, READ BACK (slice 5f, its second half). Once every
 * organisation has been pushed, one question to Moneybird: every invoice it
 * changed in the last day that is late, reminded or paid
 * (`books-read-back.ts`), each copied back onto its row in its organisation's
 * own scope, forwards only: a bank transfer is seen as paid, and Moneybird's
 * late as overdue.
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
  applyReadBack,
  bookPayment,
  bookRefund,
  claimNextCreditNote,
  claimNextMoneyBack,
  claimNextRefundToBook,
  claimNextDraft,
  claimNextPaymentToBook,
  draftsBehind,
  listChangedSalesInvoices,
  makeMoneyBack,
  moneybirdFromEnv,
  organisationOf,
  planCreditPush,
  planPush,
  pushCreditNote,
  pushInvoice,
  readVatStanding,
  recordCreditDraft,
  recordCreditIssued,
  recordIssued,
  recordMoneyBack,
  READ_BACK_PAGE,
  READ_BACK_PAGES,
  READ_BACK_WINDOW_HOURS,
  recordPaymentBooked,
  whyNobodyIsInvoiced,
  type MoneybirdSettings,
  type PushContext,
  type SlowDown,
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
  /** Of `issued`, the credit notes (slice 7a). */
  credited: number;
  adopted: number;
  /** Payments through Mollie booked on their invoice in Moneybird (slice 5f). */
  booked: number;
  /** Payments the books held already: booked before, or the invoice paid there by other means. */
  held: number;
  /** Credit notes whose amount went back through Mollie (slice 7d). */
  refunded: number;
  /** Credit notes set against their invoice in the books: nothing paid above what is owed. */
  settled: number;
  /** Credit notes whose money goes back by transfer, by hand: the invoice was not paid through Mollie. */
  byHand: number;
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
 * then its credit notes the same way, then its payments through Mollie booked
 * in the books, then its alert. Exported so the tests run it on a database and
 * a Moneybird of their own.
 */
export async function pushOrganisation(
  pool: Pool,
  organisation: string,
  now: Date,
  settings: MoneybirdSettings,
  context: PushContext,
  budget: PushBudget,
  counts: PushCounts,
  options: {
    readonly fetchImpl?: typeof fetch;
    readonly pace?: () => Promise<void>;
    /** Mollie's API key, for a refund (slice 7d); null, a refund waits and is said. */
    readonly mollieApiKey?: string | null;
  } = {},
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
    } else {
      notIssued(outcome, organisation, budget, counts);
    }
    if (budget.left > 0 && !budget.stopped) await (options.pace ?? (() => sleep(PUSH_SPACING_MS)))();
  }
  // Then its credit notes, each once the invoice it corrects is numbered
  // (credit-note.ts): the same claim, the same pace, the same budget.
  while (budget.left > 0 && !budget.stopped) {
    const note = await withTenant(pool, organisation, (db) => claimNextCreditNote(db, tenantId, now));
    if (!note) break;
    budget.left--;
    const plan = planCreditPush(note, settings, now);
    if (plan.kind === 'refused') {
      counts.refused++;
      log.error(`[invoice-push] organisation ${organisation}: ${plan.reason}.`);
      continue;
    }
    const outcome = await pushCreditNote(
      settings,
      plan.note,
      // Written down the moment Moneybird gives it, before the draft is filled.
      (moneybirdId) => withTenant(pool, organisation, (db) => recordCreditDraft(db, note, moneybirdId, settings, now)),
      options.fetchImpl,
    );
    if (outcome.kind === 'issued') {
      await withTenant(pool, organisation, (db) => recordCreditIssued(db, note, outcome, settings, now));
      counts.issued++;
      counts.credited++;
      if (outcome.adopted) counts.adopted++;
      log.info(
        `[invoice-push] organisation ${organisation}: ${note.reference} is ${outcome.invoice.invoiceNumber}, ` +
          `crediting ${note.credited.invoiceNumber}.`,
      );
    } else {
      notIssued(outcome, organisation, budget, counts);
    }
    if (budget.left > 0 && !budget.stopped) await (options.pace ?? (() => sleep(PUSH_SPACING_MS)))();
  }
  // Then each payment Mollie confirmed, booked on its invoice in the books
  // (payment-book.ts), on the account Mollie pays out from: two requests, the
  // read and the booking, under the same budget and pace.
  const mollieAccountId = settings.mollieAccountId;
  while (mollieAccountId !== null && budget.left > 0 && !budget.stopped) {
    const payment = await withTenant(pool, organisation, (db) => claimNextPaymentToBook(db, tenantId, now));
    if (!payment) break;
    budget.left--;
    const outcome = await bookPayment(settings, mollieAccountId, payment, options.fetchImpl);
    if (outcome.kind === 'booked' || outcome.kind === 'held') {
      await withTenant(pool, organisation, (db) => recordPaymentBooked(db, tenantId, payment.id, now));
      if (outcome.kind === 'booked') {
        counts.booked++;
        log.info(
          `[invoice-push] organisation ${organisation}: ${payment.paymentId} booked on ` +
            `${payment.invoiceNumber ?? payment.reference ?? payment.id} in Moneybird.`,
        );
      } else {
        counts.held++;
      }
    } else {
      notIssued(outcome, organisation, budget, counts);
    }
    if (budget.left > 0 && !budget.stopped) await (options.pace ?? (() => sleep(PUSH_SPACING_MS)))();
  }
  // Then each issued credit note's amount made real, once (money-back.ts):
  // refunded through Mollie, settled in the books, or said for a transfer by
  // hand. Under the same budget and pace.
  while (budget.left > 0 && !budget.stopped) {
    const due = await withTenant(pool, organisation, (db) => claimNextMoneyBack(db, tenantId, now));
    if (!due) break;
    budget.left--;
    const outcome = await makeMoneyBack(settings, options.mollieApiKey ?? null, due, { fetchImpl: options.fetchImpl });
    const name = due.invoiceNumber ?? due.reference;
    if (outcome.kind === 'refunded' || outcome.kind === 'settled' || outcome.kind === 'by_hand') {
      await withTenant(pool, organisation, (db) => recordMoneyBack(db, tenantId, due.id, outcome, now));
      if (outcome.kind === 'refunded') {
        counts.refunded++;
        log.info(
          `[invoice-push] organisation ${organisation}: credit note ${name} refunded ${outcome.cents} cents through ` +
            `Mollie (${outcome.refundId}${outcome.adopted ? ', found made before' : ''}).`,
        );
      } else if (outcome.kind === 'settled') {
        counts.settled++;
      } else {
        counts.byHand++;
        // Once: the row now says by hand, and is never claimed again.
        log.error(
          `[invoice-push] organisation ${organisation}: credit note ${name} credits ${outcome.cents} cents on invoice ` +
            `${due.original.invoiceNumber ?? due.original.id}, which was paid, but not through Mollie: pay back what ` +
            'was paid above what is owed by transfer, within 14 days of the withdrawal (terms §7), and book it on ' +
            'the credit note in Moneybird.',
        );
      }
    } else if (outcome.kind === 'waiting') {
      // Held until its lease runs out, and tried again the next hour.
      counts.unavailable++;
      log.error(`[invoice-push] organisation ${organisation}: ${outcome.reason}.`);
    } else {
      notIssued(outcome, organisation, budget, counts);
    }
    if (budget.left > 0 && !budget.stopped) await (options.pace ?? (() => sleep(PUSH_SPACING_MS)))();
  }
  // Then each refund booked on its credit note in the books, on Mollie's account.
  while (mollieAccountId !== null && budget.left > 0 && !budget.stopped) {
    const refund = await withTenant(pool, organisation, (db) => claimNextRefundToBook(db, tenantId, now));
    if (!refund) break;
    budget.left--;
    const outcome = await bookRefund(settings, mollieAccountId, refund, options.fetchImpl);
    if (outcome.kind === 'booked' || outcome.kind === 'held') {
      await withTenant(pool, organisation, (db) => recordPaymentBooked(db, tenantId, refund.id, now));
      if (outcome.kind === 'booked') counts.booked++;
      else counts.held++;
    } else {
      notIssued(outcome, organisation, budget, counts);
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

/** What one read-back did, counted. */
export interface ReadBackCounts {
  /** Whether Moneybird answered the list. */
  read: boolean;
  overdue: number;
  paid: number;
  /** Changed invoices with no organisation of ours in their reference: a proof, the nightly's, one by hand. */
  notOurs: number;
  failed: number;
}

/**
 * The read-back (books-read-back.ts): one list of what Moneybird changed in
 * the last day, each change written in its organisation's own scope. Exported
 * so the tests run it on a database and a Moneybird of their own.
 */
export async function readBackFromTheBooks(
  pool: Pool,
  settings: MoneybirdSettings,
  now: Date,
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<ReadBackCounts> {
  const counts: ReadBackCounts = { read: false, overdue: 0, paid: 0, notOurs: 0, failed: 0 };
  const since = new Date(now.getTime() - READ_BACK_WINDOW_HOURS * 3_600_000);
  const listed = await listChangedSalesInvoices(settings, since, now, options.fetchImpl);
  if (listed.kind === 'slow_down') {
    log.warn('[invoice-push] Moneybird asked to slow down before the read-back; it waits for the next run.');
    return counts;
  }
  if (listed.kind === 'unavailable') {
    log.warn(`[invoice-push] paid and late not read back: ${listed.reason}`);
    return counts;
  }
  counts.read = true;
  for (const invoice of listed.invoices) {
    const organisation = organisationOf(invoice.reference);
    if (!organisation) {
      counts.notOurs++;
      continue;
    }
    try {
      const change = await withTenant(pool, organisation, (db) =>
        applyReadBack(db, organisation as TenantId, settings.administrationId, invoice, now),
      );
      if (change) counts[change]++;
    } catch (err) {
      // Said, and the next invoice still read back (hard rule 9).
      counts.failed++;
      log.error(
        `[invoice-push] organisation ${organisation}: invoice ${invoice.moneybirdId} could not be read back:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (listed.more) {
    // The next run asks the same window again, so the rest may never be read.
    log.error(
      `[invoice-push] more than ${READ_BACK_PAGE * READ_BACK_PAGES} invoices changed in the books in the last ` +
        `${READ_BACK_WINDOW_HOURS} hours; only the first were read back. Raise READ_BACK_PAGES.`,
    );
  }
  return counts;
}

/** A push that issued nothing: counted, and said; a 429 stops the run where it is. */
function notIssued(
  outcome:
    | { readonly kind: 'refused'; readonly reason: string }
    | { readonly kind: 'unavailable'; readonly reason: string }
    | SlowDown,
  organisation: string,
  budget: PushBudget,
  counts: PushCounts,
): void {
  if (outcome.kind === 'refused') {
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
      MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE: process.env.MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE,
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
    const counts: PushCounts = {
      issued: 0,
      credited: 0,
      adopted: 0,
      booked: 0,
      held: 0,
      refunded: 0,
      settled: 0,
      byHand: 0,
      refused: 0,
      unavailable: 0,
      slowed: 0,
    };
    if (moneybird.config.mollieAccountId === null) {
      log.info(
        '[invoice-push] payments through Mollie are not booked in Moneybird: ' +
          'MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE is not set (workplan 0111, slice 5f).',
      );
    }
    // The API's own key, for a refund (slice 7d); unset, a refund waits and each run says so.
    const mollieApiKey = process.env.MOLLIE_API_KEY?.trim() || null;
    let failed = 0;
    for (const organisation of organisations) {
      try {
        // Each organisation as itself, on the tenant pool.
        await pushOrganisation(pools.tenant, organisation, now, moneybird.config, context, budget, counts, {
          mollieApiKey,
        });
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

    // Then paid and late, read back from the books, once a 429 has not stopped the run.
    const readBack = budget.stopped ? null : await readBackFromTheBooks(pools.tenant, moneybird.config, now);
    const result = { pushing: true, tenants: organisations.length, ...counts, failed, left: budget.left, readBack };
    log.info('[invoice-push]', result);
    return result;
  }),
});
