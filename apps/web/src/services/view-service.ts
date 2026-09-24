// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The migrator's one call for the PROGRESS lifetime (workplan 0122 T4).
 *
 * Over `linkClient` — the session-less instance `grant-service.ts` also uses,
 * whose header carries the reasoning. Sharing it is deliberate: the property
 * that matters is a negative one (no bearer attached, no 401 interpreted) and a
 * second axios instance would be a second place to lose it.
 *
 * ## Parsed, not trusted, and the schema is the second copy of a rule
 *
 * `viewRowFor` in `@openmig/shared` decides what the server may put on the
 * wire. This schema decides what the page will read off it, and it is
 * deliberately not `passthrough()`: a field that appeared on the payload
 * without passing through the server's narrowing would be dropped here rather
 * than rendered. Two independent narrowings, so a mistake needs both to be
 * wrong.
 *
 * The optional fields really are optional — an absent `lastSyncedAt` means a
 * domain has never completed, which the page says in words rather than
 * printing `undefined` beside a label.
 */

import { z } from 'zod';
import { DISCOVERY_DOMAINS, DOMAIN_STATES, MAPPING_LIFECYCLES } from '@openmig/shared';
import type { DiscoveryDomain, MappingLifecycle } from '@openmig/shared';
import { linkClient as client } from './link-client.ts';

const RowSchema = z.object({
  domain: z.enum(DISCOVERY_DOMAINS as unknown as [DiscoveryDomain, ...DiscoveryDomain[]]),
  state: z.enum(DOMAIN_STATES),
  itemsSynced: z.number(),
  itemsFailed: z.number(),
  bytesTransferred: z.number(),
  itemsRetrying: z.number(),
  itemsNeedingDecision: z.number(),
  lastSyncedAt: z.string().optional(),
  lastActiveAt: z.string().optional(),
  // The failure CATEGORY, never the prose. If a `lastError` ever appears on
  // this payload it is a defect on the server, and dropping it here is the
  // right second answer.
  lastErrorCategory: z.string().optional(),
  failedSide: z.enum(['source', 'target']).optional(),
  pausedReason: z.unknown().optional(),
});
export type ViewRow = z.infer<typeof RowSchema>;

// The grant this page may take back (0108 T8 (c)). A state the page does not
// know fails the parse rather than rendering a button it cannot explain.
const GrantSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('granted') }),
  z.object({ state: z.literal('withdrawn'), withdrawnAt: z.string() }),
  z.object({ state: z.literal('none') }),
]);

const ViewSchema = z.object({
  organisation: z.string(),
  state: z.enum(MAPPING_LIFECYCLES as [MappingLifecycle, ...MappingLifecycle[]]),
  started: z.boolean(),
  domains: z.array(RowSchema),
  expiresAt: z.string(),
  grant: GrantSchema,
});
export type MigrationViewPayload = z.infer<typeof ViewSchema>;

// What happened when the grant was taken back: revoked at Google too, or
// deleted here with Google not confirming, which the person then finishes.
const WithdrawalSchema = z.object({
  withdrawnAt: z.string(),
  atGoogle: z.enum(['revoked', 'not_confirmed']),
});
export type WithdrawalPayload = z.infer<typeof WithdrawalSchema>;

export const viewApi = {
  /** Counts and states for one migration. Repeatable — nothing is spent. */
  read: async (link: string): Promise<MigrationViewPayload> => {
    const res = await client.get(`/view/${encodeURIComponent(link)}`);
    return ViewSchema.parse(res.data);
  },
  /** Take back the grant this migration reads the account on (0108 T8 (c)). */
  withdraw: async (link: string): Promise<WithdrawalPayload> => {
    const res = await client.post(`/view/${encodeURIComponent(link)}/withdraw`);
    return WithdrawalSchema.parse(res.data);
  },
};
