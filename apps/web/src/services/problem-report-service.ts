// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130): whether the service takes reports, and
 * sending one. The report becomes a ticket on the owner's helpdesk, and the
 * reply comes by email.
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

/**
 * How long the form waits for a report to be sent and answered: two minutes,
 * not `apiClient`'s 30 seconds. A report with a 5 MB screenshot is a request of
 * about 7 MB, and the time covers its upload too, before the API spends up to
 * 20 seconds handing it to the helpdesk (`services/zammad.ts` in the API).
 * Thirty seconds needed about 1.9 Mbit/s of upstream even without the
 * helpdesk's share; two minutes needs about 0.6 with it. A slower line still
 * runs out, and `timedOut` says what that means.
 */
export const REPORT_TIMEOUT_MS = 120_000;

/** Send a report; answers the ticket's number. */
export async function sendProblemReport(body: ProblemReportBody): Promise<string> {
  const response = await apiClient.post<{ ticket: string }>('/problem-reports', body, {
    timeout: REPORT_TIMEOUT_MS,
  });
  return response.data.ticket;
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
 * made, so sending it again can make a second one. The form says that, in the
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
