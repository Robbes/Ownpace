// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130): whether the service takes reports, and
 * sending one. The report becomes a ticket on the owner's helpdesk, or, on a
 * service with no helpdesk, a mail to its support mailbox (the owner, for the
 * alpha, 2026-09-28). Either way the reply comes by email.
 */

import axios, { AxiosError } from 'axios';
import apiClient from './api.ts';

export interface ProblemReportBody {
  readonly description: string;
  readonly page: string;
  readonly reference?: string;
  readonly category?: string;
  readonly screenshot?: { readonly data: string };
}

/**
 * Whether to offer the form. A service that answers anything but `true`,
 * including one without the route at all, is not offered it.
 */
export async function fetchReportingAvailable(): Promise<boolean> {
  try {
    const response = await apiClient.get<{ available?: unknown }>('/problem-reports/available');
    return response.data.available === true;
  } catch {
    return false;
  }
}

/** Where a report would go: the addresses its mail is sent to, or the owner's helpdesk. */
export type ReportRecipient =
  | { readonly kind: 'mail'; readonly addresses: readonly string[] }
  | { readonly kind: 'helpdesk' };

/**
 * What a report from this page would carry, before it is sent (workplan 0130
 * T6): where it goes, and its lines of facts, exactly as the API will write
 * them into the ticket or the mail. Shown verbatim, in English, as the support
 * team reads them. Sending reads them again on the server; nothing here is
 * sent back.
 */
export interface ReportPreview {
  readonly to: ReportRecipient;
  readonly lines: readonly string[];
}

/** Whether a value is the recipient the API describes, and nothing else. */
function isRecipient(value: unknown): value is ReportRecipient {
  if (typeof value !== 'object' || value === null) return false;
  const to = value as { kind?: unknown; addresses?: unknown };
  if (to.kind === 'helpdesk') return true;
  return (
    to.kind === 'mail' &&
    Array.isArray(to.addresses) &&
    to.addresses.length > 0 &&
    to.addresses.every((a) => typeof a === 'string' && a !== '')
  );
}

/**
 * The preview for a report from `place`. An answer in any other shape is
 * refused rather than half shown: the form then lists what it knows itself
 * and says the rest is read when the report is sent.
 */
export async function fetchReportPreview(place: {
  readonly page: string;
  readonly reference?: string;
  readonly category?: string;
}): Promise<ReportPreview> {
  const response = await apiClient.get<unknown>('/problem-reports/preview', {
    params: {
      page: place.page,
      ...(place.reference ? { reference: place.reference } : {}),
      ...(place.category ? { category: place.category } : {}),
    },
  });
  const data = response.data as { to?: unknown; lines?: unknown } | null;
  if (
    data === null ||
    typeof data !== 'object' ||
    !isRecipient(data.to) ||
    !Array.isArray(data.lines) ||
    !data.lines.every((line) => typeof line === 'string')
  ) {
    throw new Error('The service answered the preview of a report in a shape this page does not read.');
  }
  return { to: data.to, lines: data.lines as string[] };
}

/**
 * How long the form waits for a report to be sent and answered: two minutes,
 * not `apiClient`'s 30 seconds. A report with a 5 MB screenshot is a request of
 * about 7 MB, and the time covers its upload too, before the API spends up to
 * 20 seconds handing it to the helpdesk or to the support mailbox's relay
 * (`services/zammad.ts`, `services/report-channel.ts` in the API). Thirty
 * seconds needed about 1.9 Mbit/s of upstream even without that share; two
 * minutes needs about 0.6 with it. A slower line still runs out, and
 * `timedOut` says what that means.
 */
export const REPORT_TIMEOUT_MS = 120_000;

/**
 * What a sent report is known by: the helpdesk ticket's number, or, when it
 * went by mail, the report's own reference, which its mail carries too.
 */
export type SentReport = { readonly ticket: string } | { readonly reference: string };

/** Send a report; answers its ticket's number, or its reference when it went by mail. */
export async function sendProblemReport(body: ProblemReportBody): Promise<SentReport> {
  const response = await apiClient.post<{ ticket?: unknown; reference?: unknown }>('/problem-reports', body, {
    timeout: REPORT_TIMEOUT_MS,
  });
  const { ticket, reference } = response.data;
  if (typeof ticket === 'string') return { ticket };
  if (typeof reference === 'string') return { reference };
  throw new Error('The service answered a sent report with neither a ticket nor a reference.');
}

/**
 * Whether a report was refused as too large to take: a 413, from whichever
 * front answered. The web image's nginx answers one in HTML, a public ingress
 * in whatever it likes, and the API (a screenshot over 5 MB) in English JSON.
 * None of those is a sentence in the reader's language that says what to do,
 * so the status is what is read. The description is capped at 5000 characters
 * on both sides, so the screenshot is the only part of a report that can make
 * it that large.
 */
export function refusedAsTooLarge(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 413;
}

/**
 * Whether a report went unanswered because the time ran out (or the browser
 * gave up on the request), rather than being refused. Whether it arrived is
 * then unknown: the front may already have handed it on and the ticket been
 * made or the mail sent, so sending it again can make a second one. The form says that, in the
 * reader's language, instead of axios's *timeout of 120000ms exceeded*. A
 * dropped connection (*Network Error*) is not this.
 */
export function timedOut(err: unknown): boolean {
  return axios.isAxiosError(err) && (err.code === AxiosError.ECONNABORTED || err.code === AxiosError.ETIMEDOUT);
}

/**
 * The page as a report records it: a grant or view link as `:link`, and no
 * query, exactly as the server records it (it redacts again). Shown to the
 * person before sending, so what they read is what is sent.
 */
export function reportablePage(path: string): string {
  const withoutQuery = path.split('?')[0]!;
  const redacted = withoutQuery.replace(/^(\/(?:api\/)?(?:grant|view)\/)[^/]+/, '$1:link');
  return path.includes('?') ? `${redacted}?...` : redacted;
}
