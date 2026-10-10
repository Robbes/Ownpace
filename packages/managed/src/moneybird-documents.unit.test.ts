// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * An issued invoice's document, Moneybird's own PDF (workplan 0111, T6).
 *
 * What matters here: the redirect `download_pdf` answers with is read, never
 * followed with the token, and the link is fetched bare and only over HTTPS;
 * a document served straight away is taken too; what is not a PDF, or is
 * over 10 MB, is not handed on; and Moneybird's 404, 401 and 429 each say
 * what they are.
 */

import { describe, it, expect } from 'vitest';
import { downloadInvoicePdf, INVOICE_PDF_LIMIT_BYTES } from './moneybird-documents.ts';

const ACCESS = { administrationId: '123456789012345678', apiToken: 'not-a-real-token' };
const PDF = new TextEncoder().encode('%PDF-1.7\n% an invoice\n');
const LINK = 'https://documents.example.invalid/invoice-555.pdf?signature=abc';

type Call = { url: string; init: RequestInit | undefined };

function books(answers: Record<string, () => Response>) {
  const calls: Call[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[String(url)];
    if (!answer) throw new Error(`unexpected request to ${String(url)}`);
    return answer();
  }) as typeof fetch;
  return { impl, calls };
}

const DOWNLOAD = 'https://moneybird.com/api/v2/123456789012345678/sales_invoices/555/download_pdf';
const redirectTo = (location: string) => () => new Response(null, { status: 302, headers: { Location: location } });
const pdf = (bytes: Uint8Array = PDF, headers: Record<string, string> = {}) => () =>
  new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf', ...headers } });

describe('downloadInvoicePdf', () => {
  it('reads the redirect, and fetches the link bare: the token goes to the API alone', async () => {
    const { impl, calls } = books({ [DOWNLOAD]: redirectTo(LINK), [LINK]: pdf() });
    const outcome = await downloadInvoicePdf(ACCESS, '555', impl);

    expect(outcome).toEqual({ kind: 'pdf', bytes: PDF });
    expect(calls.map((c) => c.url)).toEqual([DOWNLOAD, LINK]);
    expect(calls[0]!.init).toMatchObject({ redirect: 'manual', headers: { Authorization: 'Bearer not-a-real-token' } });
    expect(calls[1]!.init?.headers).toBeUndefined();
    expect(calls[1]!.init).toMatchObject({ redirect: 'error' });
  });

  it('takes a document served straight away', async () => {
    const { impl } = books({ [DOWNLOAD]: pdf() });
    expect(await downloadInvoicePdf(ACCESS, '555', impl)).toEqual({ kind: 'pdf', bytes: PDF });
  });

  it('does not follow a link over plain HTTP', async () => {
    const { impl, calls } = books({ [DOWNLOAD]: redirectTo('http://documents.example.invalid/x.pdf') });
    expect(await downloadInvoicePdf(ACCESS, '555', impl)).toEqual({
      kind: 'unavailable',
      reason: "Moneybird pointed at the invoice's document over plain HTTP.",
    });
    expect(calls).toHaveLength(1);
  });

  it('hands on nothing that is not a PDF', async () => {
    const { impl } = books({ [DOWNLOAD]: redirectTo(LINK), [LINK]: pdf(new TextEncoder().encode('<html>expired</html>')) });
    expect(await downloadInvoicePdf(ACCESS, '555', impl)).toEqual({
      kind: 'unavailable',
      reason: "What came back for the invoice's document is not a PDF.",
    });
  });

  it('hands on nothing over 10 MB, by its stated length before reading it', async () => {
    const { impl } = books({
      [DOWNLOAD]: redirectTo(LINK),
      [LINK]: pdf(PDF, { 'Content-Length': String(INVOICE_PDF_LIMIT_BYTES + 1) }),
    });
    const outcome = await downloadInvoicePdf(ACCESS, '555', impl);
    expect(outcome).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('over the 10 MB') });
  });

  it.each([
    [404, { kind: 'refused', reason: 'Moneybird holds no invoice 555 in this administration.' }],
    [401, { kind: 'unavailable', reason: expect.stringContaining('Moneybird refused the token (HTTP 401)') }],
    [500, { kind: 'unavailable', reason: "The invoice's document answered HTTP 500." }],
  ])('says what a %i is', async (status, expected) => {
    const { impl } = books({ [DOWNLOAD]: () => new Response('{}', { status }) });
    expect(await downloadInvoicePdf(ACCESS, '555', impl)).toEqual(expected);
  });

  it('a 429 is slow_down, with the wait Moneybird asked for', async () => {
    const { impl } = books({ [DOWNLOAD]: () => new Response('{}', { status: 429, headers: { 'Retry-After': '12' } }) });
    expect(await downloadInvoicePdf(ACCESS, '555', impl)).toMatchObject({ kind: 'slow_down', retryAfterSeconds: 12 });
  });
});
