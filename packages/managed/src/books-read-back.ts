// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * PAID AND LATE, READ BACK FROM THE BOOKS (workplan 0111, slice 5f, its second
 * half; the owner, 2026-10-11: *"Ownpace asks every invoice changed since last
 * hour"*).
 *
 * Mollie's webhook says when a payment through Mollie lands, and the first
 * half books it in Moneybird. What Mollie never sees, the books do: a bank
 * transfer, and Moneybird's own judgement that an invoice is late (its
 * reminders follow from it). So every hour the push asks Moneybird for every
 * invoice it changed lately that is late, reminded or paid, and copies two
 * states back onto our rows:
 *
 *  - `late` and `reminded` move a `sent` invoice to `overdue`;
 *  - `paid` moves a `sent` or `overdue` invoice to `paid`, with Moneybird's
 *    day as `paid_at`, and notes that the books hold the payment
 *    (`moneybird_paid_at`), so the first half never books it again.
 *
 * What it never does: move anything backwards (the database refuses that
 * anyway, managed 0014); touch a credit note, whose state is the books'
 * settling of it; or call paid an invoice its credit notes take off in full,
 * since Moneybird calls that settled, and nobody paid it (slice 7d's Billing
 * page says *credited in full*).
 *
 * "Lately" is the last `READ_BACK_WINDOW_HOURS`, a day and two hours, asked
 * every hour: a change is seen on the first run after it, and a night the
 * worker did not run is caught up the next morning, with nothing kept between
 * runs. Moneybird's `updated_after` filter answers it, with an explicit period
 * (its default is this year alone), the invoices filtered to the three states.
 * Each invoice names its organisation in our own reference, `ownpace-{id}-m-…`,
 * so each change is written in that organisation's own scope; one without it
 * (a proof, the nightly's, one made by hand) is left alone.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import { moneybirdRead, type MoneybirdAccess, type SlowDown } from './moneybird-http.ts';

/** How far back each run asks: a day and two hours, so a missed night is caught up. */
export const READ_BACK_WINDOW_HOURS = 26;

/** Moneybird's page, and the most pages one run reads; the rest wait for the next hour. */
export const READ_BACK_PAGE = 100;
export const READ_BACK_PAGES = 20;

/** No Ownpace invoice is dated before this: the start of the period every read asks about. */
const BOOKS_BEGIN = '20260101';

/** A state the read-back acts on. */
export type ReadBackState = 'late' | 'reminded' | 'paid';

/** An invoice Moneybird changed lately, as far as the read-back needs it. */
export interface ChangedInvoice {
  readonly moneybirdId: string;
  readonly reference: string | null;
  readonly state: ReadBackState;
  /** The day Moneybird holds it paid, `YYYY-MM-DD`; null unless paid. */
  readonly paidOn: string | null;
}

export type ListChangedOutcome =
  | {
      readonly kind: 'ok';
      readonly invoices: readonly ChangedInvoice[];
      /** True when the run stopped at `READ_BACK_PAGES` with more to read. */
      readonly more: boolean;
    }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

function changedOf(entry: unknown): ChangedInvoice | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.id !== 'string') return null;
  if (raw.state !== 'late' && raw.state !== 'reminded' && raw.state !== 'paid') return null;
  return {
    moneybirdId: raw.id,
    reference: typeof raw.reference === 'string' ? raw.reference : null,
    state: raw.state,
    paidOn: typeof raw.paid_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.paid_at) ? raw.paid_at : null,
  };
}

/** Every invoice Moneybird changed since `since` that is late, reminded or paid, a page at a time. */
export async function listChangedSalesInvoices(
  access: MoneybirdAccess,
  since: Date,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<ListChangedOutcome> {
  const filter =
    `state:late|reminded|paid,updated_after:${since.toISOString()},` +
    `period:${BOOKS_BEGIN}..${now.getUTCFullYear() + 1}1231`;
  const invoices: ChangedInvoice[] = [];
  for (let page = 1; page <= READ_BACK_PAGES; page += 1) {
    const read = await moneybirdRead(
      access,
      `sales_invoices.json?filter=${encodeURIComponent(filter)}&per_page=${READ_BACK_PAGE}&page=${page}`,
      fetchImpl,
    );
    if (read.kind !== 'ok') return read;
    if (!Array.isArray(read.body)) {
      return { kind: 'unavailable', reason: "Moneybird's list of changed invoices was not a list." };
    }
    for (const entry of read.body) {
      const changed = changedOf(entry);
      if (changed) invoices.push(changed);
    }
    if (read.body.length < READ_BACK_PAGE) return { kind: 'ok', invoices, more: false };
  }
  return { kind: 'ok', invoices, more: true };
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MONTH_REFERENCE = new RegExp(`^ownpace-(${UUID})-m-`, 'i');

/** The organisation a month's invoice is for, from our own reference; null for anything else. */
export function organisationOf(reference: string | null): string | null {
  const found = reference ? MONTH_REFERENCE.exec(reference) : null;
  return found ? found[1]!.toLowerCase() : null;
}

/** What one change did to our row: the state it moved to, or nothing. */
export type ReadBackChange = 'overdue' | 'paid' | null;

/**
 * Copy one invoice's state back onto the organisation's row, forwards only,
 * in its own scope. Null when nothing moved: already there, a credit note,
 * another administration's, or one its credit notes take off in full.
 */
export async function applyReadBack(
  db: PgDatabase,
  tenantId: TenantId,
  administrationId: string,
  invoice: ChangedInvoice,
  now: Date,
): Promise<ReadBackChange> {
  const at = now.toISOString();
  if (invoice.state === 'late' || invoice.state === 'reminded') {
    const moved = await db.execute(sql`
      UPDATE invoice SET status = 'overdue', updated_at = ${at}::timestamptz
       WHERE tenant_id = ${tenantId} AND moneybird_administration_id = ${administrationId}
         AND moneybird_id = ${invoice.moneybirdId} AND kind = 'invoice' AND status = 'sent'
      RETURNING id`);
    return (moved as unknown as { rows: unknown[] }).rows.length === 1 ? 'overdue' : null;
  }
  // Paid on Moneybird's day, at its start in UTC; today when it did not say.
  const paidAt = invoice.paidOn ? `${invoice.paidOn}T00:00:00Z` : at;
  const moved = await db.execute(sql`
    UPDATE invoice SET status = 'paid', paid_at = COALESCE(paid_at, ${paidAt}::timestamptz),
           moneybird_paid_at = COALESCE(moneybird_paid_at, ${at}::timestamptz), updated_at = ${at}::timestamptz
     WHERE tenant_id = ${tenantId} AND moneybird_administration_id = ${administrationId}
       AND moneybird_id = ${invoice.moneybirdId} AND kind = 'invoice' AND status IN ('sent', 'overdue')
       AND total > COALESCE((
         SELECT -sum(c.total) FROM invoice c
          WHERE c.credited_invoice_id = invoice.id AND c.kind = 'credit_note' AND c.status <> 'void'), 0)
    RETURNING id`);
  return (moved as unknown as { rows: unknown[] }).rows.length === 1 ? 'paid' : null;
}
