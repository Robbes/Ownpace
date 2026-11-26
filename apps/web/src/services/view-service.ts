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
import { DISCOVERY_DOMAINS, DOMAIN_STATES, MAPPING_LIFECYCLES, STAGES } from '@openmig/shared';
import type { DiscoveryDomain, MappingLifecycle, Stage, ViewTime } from '@openmig/shared';
import { linkClient as client } from './link-client.ts';
import { LinkAddressChangesField } from './link-address-service.ts';
import { SenderSchema } from './sender-schema.ts';

const RowSchema = z.object({
  domain: z.enum(DISCOVERY_DOMAINS as unknown as [DiscoveryDomain, ...DiscoveryDomain[]]),
  state: z.enum(DOMAIN_STATES),
  itemsSynced: z.number(),
  itemsFailed: z.number(),
  bytesTransferred: z.number(),
  itemsRetrying: z.number(),
  itemsNeedingDecision: z.number(),
  // What was left as it was and what discovery found (0124 T2, 0154 T8):
  // counts the line reads, *18,234 of ~19,000 · 402 left as they are*.
  itemsAdopted: z.number().optional(),
  itemsFound: z.number().optional(),
  bytesFound: z.number().optional(),
  // The stage the owner's line shows (0154 T8). One this page does not know
  // reads as none, and the row says what it said before stages: a newer
  // server must not blank an older page.
  stage: z
    .enum(STAGES as unknown as [Stage, ...Stage[]])
    .optional()
    .catch(undefined),
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

// How long (0154 T3, T8), in `timeBeforeStart`'s and `timeWhileCopying`'s
// shapes. Parsed strictly and dropped whole when it does not match, so a
// shape this page cannot say is said as nothing rather than as a wrong range.
const TimeSchema: z.ZodType<ViewTime> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('beforeStart'),
    estimate: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('gmailDays'), low: z.number(), high: z.number(), filesToo: z.boolean() }),
      z.object({ kind: z.literal('gmailWithinADay'), mailBytes: z.number(), filesToo: z.boolean() }),
      z.object({ kind: z.literal('notKnownYet') }),
    ]),
  }),
  z.object({
    kind: z.literal('whileCopying'),
    estimate: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('range'),
        unit: z.enum(['hours', 'days']),
        low: z.number(),
        high: z.number(),
        passes: z.number(),
        slowed: z.boolean(),
      }),
      z.object({ kind: z.literal('afterThreePasses'), passesSoFar: z.number() }),
    ]),
  }),
]);

/** What a migration's progress adds to its rows (0154 T8): the check that passed, and how long. */
const extras = {
  checkPassedAt: z.string().optional(),
  time: TimeSchema.optional().catch(undefined),
};

// The grant this page may take back (0108 T8 (c)). A state the page does not
// know fails the parse rather than rendering a button it cannot explain.
//
// What a withdrawal took back (the owner's decisions of 2026-11-26, change
// 1): the source's access, or a destination's password and which. Absent
// from a server before alpha.21, and one this page does not know reads as
// absent: the source's, as every hold read until then.
const WhatStoppedFields = {
  what: z.enum(['source', 'destination']).optional().catch(undefined),
  destination: z.string().optional(),
};
const GrantSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('granted') }),
  z.object({ state: z.literal('withdrawn'), withdrawnAt: z.string(), ...WhatStoppedFields }),
  z.object({ state: z.literal('none') }),
]);

const ViewSchema = z.object({
  organisation: z.string(),
  state: z.enum(MAPPING_LIFECYCLES as [MappingLifecycle, ...MappingLifecycle[]]),
  started: z.boolean(),
  domains: z.array(RowSchema),
  // The source's kind, to say who slowed it (0154 T8).
  from: z.string().optional(),
  ...extras,
  expiresAt: z.string(),
  grant: GrantSchema,
});
export type MigrationViewPayload = z.infer<typeof ViewSchema>;

/**
 * A PERSON'S progress page (ADR-0035, amended 2026-09-29; 0153 T5 (b), slice
 * 3): every migration of theirs, each with the rows a migration's page reads
 * through the same `RowSchema`, and the Google account each reads named by an
 * opaque `ref`, which a withdrawal sends back.
 */
const PersonViewSchema = z.object({
  kind: z.literal('person'),
  organisation: z.string(),
  expiresAt: z.string(),
  migrations: z.array(
    z.object({
      from: z.string(),
      to: z.string().nullable(),
      state: z.enum(MAPPING_LIFECYCLES as [MappingLifecycle, ...MappingLifecycle[]]),
      started: z.boolean(),
      domains: z.array(RowSchema),
      ...extras,
      account: z.string().nullable(),
      // While a withdrawal holds it: when, and what was taken back.
      stopped: z.object({ at: z.string(), ...WhatStoppedFields }).optional().catch(undefined),
      // Whether the organisation can open the copy at its destination too
      // (workplan 0176 T6, step B). Absent from a server before it: no line.
      theOrganisationOpensIt: z.boolean().optional(),
    }),
  ),
  accounts: z.array(z.object({ ref: z.string(), grant: GrantSchema })),
  // Who sent the link (workplan 0176 T6, §7): the name the member gave, how
  // the person knows them and their own number, never an address; and the
  // organisation's number beside it (D11). Absent from a server before step
  // B: the page names the organisation, as it did.
  sender: SenderSchema.nullable().optional(),
  organisationPhone: z.string().nullable().optional(),
  // The destinations the person connected with their own password (0174
  // §4.3). Absent from a server before alpha.21, read as none.
  destinations: z
    .array(z.object({ ref: z.string(), provider: z.string(), drive: z.boolean() }))
    .optional()
    .default([]),
  // The person's own rows of the address changes (0168 §4.4), where sent.
  addressChanges: LinkAddressChangesField,
});
export type PersonViewPayload = z.infer<typeof PersonViewSchema>;

// What happened when the grant was taken back: revoked at Google too, or
// deleted here with Google not confirming, which the person then finishes.
const WithdrawalSchema = z.object({
  withdrawnAt: z.string(),
  atGoogle: z.enum(['revoked', 'not_confirmed']),
});
export type WithdrawalPayload = z.infer<typeof WithdrawalSchema>;

/** A destination's password removed (0174 §4.3): no provider was asked, so there is no `atGoogle`. */
const DestinationWithdrawalSchema = z.object({
  withdrawnAt: z.string(),
  provider: z.string(),
  drive: z.boolean(),
});
export type DestinationWithdrawalPayload = z.infer<typeof DestinationWithdrawalSchema>;

export const viewApi = {
  /**
   * Counts and states for one migration, or for every migration of a person's
   * when the link is theirs (`kind: 'person'`). Repeatable — nothing is spent.
   */
  read: async (link: string): Promise<MigrationViewPayload | PersonViewPayload> => {
    const res = await client.get(`/view/${encodeURIComponent(link)}`);
    const data: unknown = res.data;
    const person = typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === 'person';
    return person ? PersonViewSchema.parse(data) : ViewSchema.parse(data);
  },
  /** Take back the grant this migration reads the account on (0108 T8 (c)). */
  withdraw: async (link: string): Promise<WithdrawalPayload> => {
    const res = await client.post(`/view/${encodeURIComponent(link)}/withdraw`);
    return WithdrawalSchema.parse(res.data);
  },
  /** Take back the grant one Google account of a person's holds, named by the page's `ref`. */
  withdrawAccount: async (link: string, account: string): Promise<WithdrawalPayload> => {
    const res = await client.post(`/view/${encodeURIComponent(link)}/withdraw`, { account });
    return WithdrawalSchema.parse(res.data);
  },
  /** Remove the password a person gave a destination they connected, named by the page's `ref` (0174 §4.3). */
  withdrawDestination: async (link: string, destination: string): Promise<DestinationWithdrawalPayload> => {
    const res = await client.post(`/view/${encodeURIComponent(link)}/withdraw`, { destination });
    return DestinationWithdrawalSchema.parse(res.data);
  },
};
