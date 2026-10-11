// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * An issued invoice's document: Moneybird's own PDF (workplan 0111, T6 and
 * slice 6 of §"The build, sliced"). The app streams it to the person who asks
 * and keeps no copy; a draft has none.
 *
 * **The token goes to Moneybird's API and nowhere else.** `download_pdf`
 * answers with a redirect to a link that lives for about thirty seconds, on a
 * host Moneybird chooses. So the redirect is read, never followed with the
 * token: the link is fetched bare, and only over HTTPS.
 *
 * **What comes back is a PDF or a sentence.** A body that does not start as a
 * PDF does, or one over 10 MB, is refused by name rather than handed to a
 * person as a file that will not open. A 404 is `refused` (Moneybird holds no
 * such invoice in this administration: a person must look), a 429 is
 * `slow_down`, and anything else that is not the document is `unavailable`.
 */

import { MONEYBIRD_API, retryAfterSecondsOf, tokenRefusal, type MoneybirdAccess, type SlowDown } from './moneybird-http.ts';

export type InvoicePdfOutcome =
  | { readonly kind: 'pdf'; readonly bytes: Uint8Array }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/** The largest document handed on. An invoice is a page or two. */
export const INVOICE_PDF_LIMIT_BYTES = 10 * 1024 * 1024;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** `%PDF-`, the first bytes of every PDF. */
function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
}

const unavailable = (reason: string): InvoicePdfOutcome => ({ kind: 'unavailable', reason });

/** Moneybird's PDF of the invoice `invoiceId` (Moneybird's id), fetched through its short-lived link. */
export async function downloadInvoicePdf(
  access: MoneybirdAccess,
  invoiceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InvoicePdfOutcome> {
  const url =
    `${MONEYBIRD_API}/${encodeURIComponent(access.administrationId)}` +
    `/sales_invoices/${encodeURIComponent(invoiceId)}/download_pdf`;
  let answer: Response;
  try {
    answer = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${access.apiToken}`, Accept: 'application/pdf' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return unavailable(`Moneybird could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (answer.status === 429) {
    const retryAfterSeconds = retryAfterSecondsOf(answer.headers.get('Retry-After'), Date.now());
    return {
      kind: 'slow_down',
      reason: 'Moneybird asks us to slow down (HTTP 429).',
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  if (answer.status === 401 || answer.status === 403) return unavailable(tokenRefusal(answer.status));
  if (answer.status === 404) {
    return { kind: 'refused', reason: `Moneybird holds no invoice ${invoiceId} in this administration.` };
  }

  let document = answer;
  if (REDIRECTS.has(answer.status)) {
    const location = answer.headers.get('Location');
    if (!location) return unavailable("Moneybird pointed at the invoice's document without saying where.");
    let link: URL;
    try {
      link = new URL(location, url);
    } catch {
      return unavailable("Moneybird pointed at the invoice's document with a link that is not one.");
    }
    if (link.protocol !== 'https:') return unavailable("Moneybird pointed at the invoice's document over plain HTTP.");
    try {
      // Bare: the link carries its own short-lived signature, and the token
      // is Moneybird's API's alone.
      document = await fetchImpl(link.toString(), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      return unavailable(
        `The invoice's document could not be fetched: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (document.status !== 200) return unavailable(`The invoice's document answered HTTP ${document.status}.`);
  const declared = Number(document.headers.get('Content-Length') ?? '0');
  if (declared > INVOICE_PDF_LIMIT_BYTES) return unavailable(`The invoice's document is ${declared} bytes, over the 10 MB handed on.`);
  const bytes = new Uint8Array(await document.arrayBuffer());
  if (bytes.length > INVOICE_PDF_LIMIT_BYTES) return unavailable(`The invoice's document is ${bytes.length} bytes, over the 10 MB handed on.`);
  if (!looksLikePdf(bytes)) return unavailable("What came back for the invoice's document is not a PDF.");
  return { kind: 'pdf', bytes };
}
