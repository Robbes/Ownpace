// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * "Report this link" (workplan 0108 T8 (d)): whether a link can be reported,
 * and sending the report. Over `linkClient`, like the rest of the link pages:
 * nobody is signed in, and the link in the path is the whole credential.
 */

import { z } from 'zod';
import { linkClient as client } from './link-client.ts';
import type { SentReport } from './problem-report-service.ts';

/** Which page the link opens: the grant page, or the progress page. */
export type ReportedLink = 'grant' | 'view';

export interface LinkReportBody {
  readonly description: string;
  /** Left out when the person wants no answer (the owner, 2026-09-24). */
  readonly replyTo?: string;
}

const path = (kind: ReportedLink, link: string) => `/${kind}/${encodeURIComponent(link)}/report`;

export const linkReportApi = {
  /**
   * Whether to offer the report. A service that answers anything but `true`,
   * including one without the route at all, is not offered it.
   */
  available: async (kind: ReportedLink, link: string): Promise<boolean> => {
    try {
      const res = await client.get(path(kind, link));
      return z.object({ available: z.literal(true) }).safeParse(res.data).success;
    } catch {
      return false;
    }
  },

  /**
   * Send the report; answers its ticket's number, or, when it went to the
   * support mailbox by mail (the owner, for the alpha, 2026-09-28), its
   * reference.
   */
  send: async (kind: ReportedLink, link: string, body: LinkReportBody): Promise<SentReport> => {
    const res = await client.post(path(kind, link), body);
    return z
      .union([z.object({ ticket: z.string() }), z.object({ reference: z.string() })])
      .parse(res.data);
  },
};
