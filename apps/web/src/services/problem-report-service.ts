// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130): whether the service takes reports, and
 * sending one. The report becomes a ticket on the owner's helpdesk, and the
 * reply comes by email.
 */

import axios from 'axios';
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

/** Send a report; answers the ticket's number. */
export async function sendProblemReport(body: ProblemReportBody): Promise<string> {
  const response = await apiClient.post<{ ticket: string }>('/problem-reports', body);
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
 * The page as a report records it: a grant or view link as `:link`, and no
 * query, exactly as the server records it (it redacts again). Shown to the
 * person before sending, so what they read is what is sent.
 */
export function reportablePage(path: string): string {
  const withoutQuery = path.split('?')[0]!;
  const redacted = withoutQuery.replace(/^(\/(?:api\/)?(?:grant|view)\/)[^/]+/, '$1:link');
  return path.includes('?') ? `${redacted}?...` : redacted;
}
