// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The migrator's two calls (workplan 0108 T4).
 *
 * A **separate axios instance** from `api.ts`'s, and that is the point of the
 * file. `apiClient` attaches a `Bearer` from `localStorage` on every request
 * and signs the caller out on a 401 — both wrong here, in ways that would be
 * quiet:
 *
 *  - The person opening a grant link has no session. If they happen to be
 *    signed in to Ownpace in the same browser — an owner testing their own
 *    link, most likely — the shared client would attach that token to a route
 *    that authenticates a LINK, and the two credentials would travel together
 *    for no reason.
 *  - The link routes answer 401 for a refused LINK, not for a stale session.
 *    Running that through `onUnauthorized()` would sign a bystander out of
 *    Ownpace because somebody sent them a dead link.
 *
 * So this client attaches nothing and interprets nothing. The link in the path
 * is the entire credential.
 */

import axios from 'axios';
import { z } from 'zod';

const client = axios.create({
  baseURL: (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

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
