// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The migrator's two calls for the CREDENTIAL lifetime (workplan 0108 T4).
 *
 * Over `linkClient`, which is a separate axios instance from `api.ts`'s and
 * carries the reasoning for why: no bearer attached, no 401 interpreted, the
 * link in the path is the whole credential. The progress lifetime
 * (`view-service.ts`) shares it, and both must keep sharing it — see that
 * file's header.
 */

import { z } from 'zod';
import { linkClient as client } from './link-client.ts';

const SubjectSchema = z.object({
  organisation: z.string(),
  reads: z.string(),
  scope: z.string(),
  expiresAt: z.string(),
});
export type GrantSubject = z.infer<typeof SubjectSchema>;

export const grantApi = {
  /** What this page must be able to say before the button. Changes nothing. */
  read: async (link: string): Promise<GrantSubject> => {
    const res = await client.get(`/grant/${encodeURIComponent(link)}`);
    return SubjectSchema.parse(res.data);
  },

  /** Where the button goes. Answers a URL to follow, never a redirect. */
  authorize: async (link: string): Promise<{ url: string }> => {
    const res = await client.post(`/grant/${encodeURIComponent(link)}/google/authorize`, {});
    return z.object({ url: z.string() }).parse(res.data);
  },
};
