// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The owner's three calls for grant links (workplan 0108 T3).
 *
 * Its own file rather than another section of `mapping-service.ts`, because
 * what it carries is different in kind: `issue` returns the ONE response in
 * this application that ever contains a bearer secret. Keeping it visible in a
 * small file is the point — the next person to widen a cache, add a log line,
 * or persist a query result should be looking straight at the reason not to.
 *
 * ## Nothing here is stored, retried or remembered
 *
 * `issue` is deliberately not a react-query mutation with a cached result. The
 * URL exists once, in the component's own state, until the owner navigates
 * away. It is never written to `localStorage`, never put in a query cache, and
 * never re-fetched — because it CANNOT be re-fetched: the server holds a hash.
 *
 * Shapes are parsed rather than trusted (`mapping-service.ts`'s convention):
 * the link state drives what the screen tells an owner about who still has
 * access, and a silently-changed field would make that answer wrong rather
 * than absent.
 */

import { z } from 'zod';
import apiClient from './api.ts';

/**
 * The expiries the owner may choose. Duplicated from
 * `@openmig/ledger`'s `MAPPING_LINK_EXPIRY_DAYS` rather than imported: the web
 * bundle does not depend on the ledger (it is a server package carrying pg),
 * and the API refuses anything outside its own list, so a drift here fails
 * loudly at the button rather than quietly minting an unintended lifetime.
 */
export const GRANT_LINK_EXPIRY_DAYS = [1, 7, 30] as const;
export const DEFAULT_GRANT_LINK_EXPIRY_DAYS = 7;

export const GrantLinkSchema = z.object({
  id: z.string(),
  purpose: z.enum(['grant', 'view']),
  state: z.enum(['live', 'used', 'revoked', 'expired']),
  createdAt: z.string(),
  createdBy: z.string(),
  expiresAt: z.string(),
  usedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type GrantLink = z.infer<typeof GrantLinkSchema>;

const IssuedSchema = z.object({
  id: z.string(),
  url: z.string(),
  expiresAt: z.string(),
  expiryDays: z.number(),
  distribution: z.string(),
});
export type IssuedGrantLink = z.infer<typeof IssuedSchema>;

export const grantLinkApi = {
  list: async (mappingId: string): Promise<GrantLink[]> => {
    const res = await apiClient.get(`/migrations/${encodeURIComponent(mappingId)}/links`);
    return z.array(GrantLinkSchema).parse(res.data.links);
  },

  issue: async (mappingId: string, expiryDays: number): Promise<IssuedGrantLink> => {
    const res = await apiClient.post(`/migrations/${encodeURIComponent(mappingId)}/links`, {
      expiryDays,
    });
    return IssuedSchema.parse(res.data);
  },

  revoke: async (mappingId: string, linkId: string): Promise<void> => {
    await apiClient.delete(
      `/migrations/${encodeURIComponent(mappingId)}/links/${encodeURIComponent(linkId)}`,
    );
  },
};
