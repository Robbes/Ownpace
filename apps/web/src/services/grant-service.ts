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
  // The name the EU VAT register gave, when the organisation's VAT number was
  // checked and found valid (0108 T8a); null otherwise.
  checkedCompany: z.string().nullable(),
  // Who asked (0108 T8a): the issuing member's sign-in address, or null when
  // they are no longer a member.
  askedBy: z.string().nullable(),
  // The organisation's phone number, when it gave one (optional).
  organisationPhone: z.string().nullable(),
  reads: z.string(),
  scope: z.string(),
  // Whether Google itself holds that scope to reading (workplan 0144 T3 (c)).
  // The page says "read-only" only when it is true.
  readOnlyAtProvider: z.boolean(),
  // Where from and where to (workplan 0108 T8a): the account the migration
  // reads, and the kind of server it writes, its host and the account on it.
  // Never null since T8 (b): the grant is bound to that account, so the server
  // answers no page for a migration that names none.
  from: z.string(),
  to: z.object({
    provider: z.string(),
    host: z.string().nullable(),
    account: z.string().nullable(),
  }),
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
