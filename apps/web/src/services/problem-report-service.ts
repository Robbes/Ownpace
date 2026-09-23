// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130): whether the service takes reports, and
 * sending one. The report becomes a ticket on the owner's helpdesk, and the
 * reply comes by email.
 */

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
 * The page as a report records it: a grant or view link as `:link`, and no
 * query, exactly as the server records it (it redacts again). Shown to the
 * person before sending, so what they read is what is sent.
 */
export function reportablePage(path: string): string {
  const withoutQuery = path.split('?')[0]!;
  const redacted = withoutQuery.replace(/^(\/(?:api\/)?(?:grant|view)\/)[^/]+/, '$1:link');
  return path.includes('?') ? `${redacted}?...` : redacted;
}
