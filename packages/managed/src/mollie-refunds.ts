// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * MOLLIE'S REFUNDS, AS THE HOURLY PUSH ASKS THEM (workplan 0111, T7, slice
 * 7d, its second half; terms §7: *"whatever you paid above it we refund
 * within 14 days, by the means of payment you used"*).
 *
 * Two requests to Mollie's API, over HTTPS with the API key in its header, as
 * the Moneybird modules talk to Moneybird: the refunds already made on a
 * payment, and a refund of part of it. Each refund carries the credit note's
 * reference twice: as its idempotency key, so a retried request within
 * Mollie's hour makes no second refund, and in its metadata, so a refund made
 * by a run that died before writing it down is found on the next run's read
 * (`creditNoteRefundOf`) and adopted, never made again.
 *
 * The key is the API's own (`MOLLIE_API_KEY`), handed to the tasks by
 * `set-task-env.sh`; unset, nothing is refunded and the push says so.
 */

import { decimalFromCents } from './line-price.ts';

/** Mollie's API. */
export const MOLLIE_API = 'https://api.mollie.com/v2';

/** A refund of one payment, as far as the push needs it. */
export interface MollieRefund {
  readonly id: string;
  /** In cents. */
  readonly cents: number;
  /** `queued`, `pending`, `processing`, `refunded`, `failed` or `canceled`, as Mollie says. */
  readonly status: string;
  /** The credit note it was made for, from its metadata; null for one made elsewhere. */
  readonly creditNote: string | null;
}

export type MollieRefundsOutcome =
  | { readonly kind: 'ok'; readonly refunds: readonly MollieRefund[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type MollieRefundOutcome =
  | { readonly kind: 'refunded'; readonly refund: MollieRefund }
  /** Mollie said no in so many words: more than may be refunded, a payment that cannot be. Not asked again. */
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Cents from Mollie's `{ value: "4.00" }`, EUR only; null for anything else. */
function centsOf(amount: unknown): number | null {
  if (typeof amount !== 'object' || amount === null) return null;
  const { currency, value } = amount as { currency?: unknown; value?: unknown };
  if (currency !== 'EUR' || typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, part] = value.split('.') as [string, string];
  return Number(whole) * 100 + Number(part);
}

function refundOf(raw: unknown): MollieRefund | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { id?: unknown; amount?: unknown; status?: unknown; metadata?: unknown };
  const cents = centsOf(r.amount);
  if (typeof r.id !== 'string' || cents === null || typeof r.status !== 'string') return null;
  const metadata = typeof r.metadata === 'object' && r.metadata !== null ? (r.metadata as { creditNote?: unknown }) : {};
  return { id: r.id, cents, status: r.status, creditNote: typeof metadata.creditNote === 'string' ? metadata.creditNote : null };
}

/** Mollie's own words for a refusal: its `detail`, else the status. */
function detailOf(body: unknown, status: number): string {
  const detail = typeof body === 'object' && body !== null ? (body as { detail?: unknown }).detail : undefined;
  return typeof detail === 'string' && detail !== '' ? detail : `HTTP ${status}`;
}

async function mollieRequest(
  apiKey: string,
  method: 'GET' | 'POST',
  path: string,
  init: { body?: unknown; idempotencyKey?: string },
  fetchImpl: typeof fetch,
): Promise<{ kind: 'response'; status: number; body: unknown } | { kind: 'unreachable'; reason: string }> {
  try {
    const response = await fetchImpl(`${MOLLIE_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(10_000),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A body that is not JSON is said by its status.
    }
    return { kind: 'response', status: response.status, body };
  } catch (error) {
    return { kind: 'unreachable', reason: `Mollie could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The refunds made on a payment so far, up to Mollie's page of 250. */
export async function listRefunds(
  apiKey: string,
  paymentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MollieRefundsOutcome> {
  const answer = await mollieRequest(apiKey, 'GET', `/payments/${encodeURIComponent(paymentId)}/refunds?limit=250`, {}, fetchImpl);
  if (answer.kind === 'unreachable') return { kind: 'unavailable', reason: answer.reason };
  if (answer.status !== 200) {
    return { kind: 'unavailable', reason: `Mollie answered ${detailOf(answer.body, answer.status)} to the refunds of ${paymentId}.` };
  }
  const listed = (answer.body as { _embedded?: { refunds?: unknown } } | null)?._embedded?.refunds;
  if (!Array.isArray(listed)) return { kind: 'unavailable', reason: `Mollie's refunds of ${paymentId} were not a list.` };
  const refunds: MollieRefund[] = [];
  for (const raw of listed) {
    const refund = refundOf(raw);
    if (refund) refunds.push(refund);
  }
  return { kind: 'ok', refunds };
}

/** A refund the credit note `reference` made on this payment before, if any: adopted, never made twice. */
export function creditNoteRefundOf(refunds: readonly MollieRefund[], reference: string): MollieRefund | null {
  return refunds.find((r) => r.creditNote === reference && r.status !== 'failed' && r.status !== 'canceled') ?? null;
}

/** Refund `cents` of the payment, for the credit note `reference`. */
export async function createRefund(
  apiKey: string,
  paymentId: string,
  refund: { readonly cents: number; readonly reference: string; readonly description: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MollieRefundOutcome> {
  if (!Number.isSafeInteger(refund.cents) || refund.cents <= 0) {
    return { kind: 'refused', reason: `a refund of ${refund.cents} cents is not one to make` };
  }
  const answer = await mollieRequest(
    apiKey,
    'POST',
    `/payments/${encodeURIComponent(paymentId)}/refunds`,
    {
      body: {
        amount: { currency: 'EUR', value: decimalFromCents(refund.cents) },
        description: refund.description,
        metadata: { creditNote: refund.reference },
      },
      idempotencyKey: refund.reference,
    },
    fetchImpl,
  );
  if (answer.kind === 'unreachable') return { kind: 'unavailable', reason: answer.reason };
  if (answer.status === 201 || answer.status === 200) {
    const made = refundOf(answer.body);
    if (made) return { kind: 'refunded', refund: made };
    return { kind: 'unavailable', reason: `Mollie's answer to the refund of ${paymentId} could not be read.` };
  }
  // 422: more than may be refunded, or a payment that cannot be; 404: no such payment.
  if (answer.status === 422 || answer.status === 404) {
    return { kind: 'refused', reason: `Mollie refused the refund of ${paymentId}: ${detailOf(answer.body, answer.status)}` };
  }
  return { kind: 'unavailable', reason: `Mollie answered ${detailOf(answer.body, answer.status)} to the refund of ${paymentId}.` };
}
