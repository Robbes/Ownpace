// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130): whether the service takes reports, and
 * sending one. The report becomes a ticket on the owner's helpdesk, or, on a
 * service with no helpdesk, a mail to its support mailbox (the owner, for the
 * alpha, 2026-09-28). Either way the reply comes by email.
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

/**
 * What a sent report is known by: the helpdesk ticket's number, or, when it
 * went by mail, the report's own reference, which its mail carries too.
 */
export type SentReport = { readonly ticket: string } | { readonly reference: string };

/** Send a report; answers its ticket's number, or its reference when it went by mail. */
export async function sendProblemReport(body: ProblemReportBody): Promise<SentReport> {
  const response = await apiClient.post<{ ticket?: unknown; reference?: unknown }>('/problem-reports', body);
  const { ticket, reference } = response.data;
  if (typeof ticket === 'string') return { ticket };
  if (typeof reference === 'string') return { reference };
  throw new Error('The service answered a sent report with neither a ticket nor a reference.');
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
