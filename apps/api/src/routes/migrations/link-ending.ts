// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN OAUTH GRANT LINK'S ENDING, for every provider but Google (workplan 0171
 * §3.2, T3; Dropbox joined in 0174 §6).
 *
 * Written for Microsoft in alpha.20 and lifted out unchanged when Dropbox
 * joined, so the two endings cannot drift apart: the order is Google's, and
 * so is the store. The code is exchanged, the provider is asked who signed in
 * (the entry's `finish`), and `storeGrantedToken` or `storePersonGrant` spends
 * the link, checks the account against the one the migration names, and
 * writes the token, in one transaction. A wrong account's token is dropped
 * and the link stays live.
 *
 * What differs per provider is passed in as `LinkEndingProvider`: its id and
 * name, how it judges the scopes it recorded, and, for Microsoft, the policy
 * refusals Entra words for an administrator. The effects are arguments too,
 * so every branch is proven without a server or a database; each callback
 * hands it the real ones.
 */

import {
  NOT_KEPT,
  exchangeRefusedAt,
  log,
  nothingCameBackFrom,
  stoppedAtProvider,
  type Bilingual,
} from '@openmig/shared';
import type { GrantClient, GrantFinish, GrantProviderId } from '../grant-providers.ts';
import type { GrantStoreResult, GrantTarget, GrantedAccess } from './grant-ending.ts';
import type { PersonGrantStoreResult, PersonGrantTarget } from './person-grant-ending.ts';
import type { RecordedPermission } from './google-consent.ts';
import type { ProgressPageUrl } from './progress-page-url.ts';

/** What the ending page shows: a refusal and what is true of the link, or the grant. */
export type LinkEndingPage =
  | { readonly status: number; readonly ok: false; readonly reason: Bilingual | string; readonly link?: 'works' | 'unused' }
  | {
      readonly status: 200;
      readonly ok: true;
      readonly permission: RecordedPermission;
      readonly progressUrl?: ProgressPageUrl;
      /** A person's link with accounts left to connect (`grantResultPage`'s `more`). */
      readonly more?: { readonly left: number; readonly backUrl: string };
    };

/** What is the provider's own in an ending. */
export interface LinkEndingProvider {
  readonly id: GrantProviderId;
  /** As the server log names it. */
  readonly name: string;
  /** Read-only or not, by the provider's own names for what it recorded. */
  readonly recordedPermission: (grantedScopes: ReadonlyArray<string>) => RecordedPermission;
  /** A refusal the provider words for an administrator, or null. */
  readonly policyRefusal?: (description: string) => string | null;
}

/** The effects the ending needs, injected. */
export interface LinkEndingEffects {
  readonly closedOrganisation: (tenantId: string) => Promise<{ reason: string; reasonNl: string } | null>;
  readonly finish: (code: string, redirectUri: string, client: GrantClient) => Promise<GrantFinish>;
  readonly storeGrantedToken: (target: GrantTarget, granted: GrantedAccess) => Promise<GrantStoreResult>;
  readonly storePersonGrant: (target: PersonGrantTarget, granted: GrantedAccess) => Promise<PersonGrantStoreResult>;
  /** After the grant's transaction: what it lets start, and the page the person keeps. Never undo it. */
  readonly afterMigration: (target: GrantTarget) => Promise<ProgressPageUrl | null>;
  readonly afterPerson: (target: PersonGrantTarget, granted: readonly string[]) => Promise<ProgressPageUrl | null>;
}

/** What the pending state says about this consent, as far as the ending reads it. */
export interface LinkEndingPending {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly tenant?: string;
  readonly link?: GrantTarget;
  readonly personLink?: PersonGrantTarget;
}

/**
 * The whole ending, decided, for one OAuth provider. `query` is the browser's (`error`,
 * `error_description`, `code`); everything that decides whose link this is
 * comes from `pending`, the server's own record.
 */
export async function decideLinkEnding(
  provider: LinkEndingProvider,
  pending: LinkEndingPending,
  query: { readonly error?: unknown; readonly error_description?: unknown; readonly code?: unknown },
  effects: LinkEndingEffects,
): Promise<LinkEndingPage> {
  const anyLink = pending.link ?? pending.personLink;
  if (!anyLink) return { status: 500, ok: false, reason: NOT_KEPT, link: 'unused' };
  const whose = pending.clientId;

  if (typeof query.error === 'string' && query.error.length > 0) {
    const description = typeof query.error_description === 'string' ? query.error_description : '';
    // An organisation's policy refusal (an administrator must approve the
    // app) is said in the provider's own words where it has them, as the
    // owner's ending says it: the person forwards it (0171 §3.3).
    const policy = provider.policyRefusal?.(description) ?? null;
    return { status: 200, ok: false, reason: policy ?? stoppedAtProvider(provider.id, query.error), link: 'unused' };
  }
  const code = typeof query.code === 'string' ? query.code : '';
  if (!code) return { status: 400, ok: false, reason: nothingCameBackFrom(provider.id), link: 'unused' };

  // A consent begun before its organisation was closed (0085 T2): refused
  // before the code is exchanged, so nothing is stored and the link is unspent.
  let closed;
  try {
    closed = await effects.closedOrganisation(anyLink.tenantId);
  } catch (error) {
    log.error('[api] reading whether a grant link’s organisation was closed failed:', error);
    return { status: 500, ok: false, reason: NOT_KEPT, link: 'unused' };
  }
  if (closed) return { status: 409, ok: false, reason: { en: closed.reason, nl: closed.reasonNl }, link: 'unused' };

  const client: GrantClient = {
    clientId: whose,
    clientSecret: pending.clientSecret,
    ...(pending.tenant === undefined ? {} : { tenant: pending.tenant }),
  };
  let finished: GrantFinish;
  try {
    finished = await effects.finish(code, pending.redirectUri, client);
  } catch (error) {
    // The provider could not be reached, or asking who signed in failed with
    // a fault of its own: nothing was stored, and the link was not claimed
    // (hard rule 9).
    log.error(`[api] a ${provider.name} grant link could not be finished:`, error);
    return { status: 502, ok: false, reason: NOT_KEPT, link: 'unused' };
  }
  if (!finished.ok) {
    log.warn(
      `[api] a ${provider.name} grant link's code exchange failed for ` +
        `${pending.link ? `mapping ${pending.link.mappingId}` : `person ${pending.personLink!.personId}`}: ${finished.reason}`,
    );
    // The provider's own policy sentence where it gave one (Entra's);
    // otherwise ours, worded for somebody who holds no client.
    const said = typeof finished.said === 'string' ? finished.said : exchangeRefusedAt(provider.id);
    return { status: 400, ok: false, reason: said, link: 'unused' };
  }

  const { refreshToken, ...alsoStore } = finished.secret;
  if (!refreshToken) return { status: 500, ok: false, reason: NOT_KEPT, link: 'unused' };
  const granted: GrantedAccess = { refreshToken, signedInAs: finished.signedInAs, provider: provider.id, alsoStore };
  const permission = provider.recordedPermission(finished.grantedScopes);

  let stored: GrantStoreResult | PersonGrantStoreResult;
  try {
    stored = pending.personLink
      ? await effects.storePersonGrant(pending.personLink, granted)
      : await effects.storeGrantedToken(pending.link!, granted);
  } catch (error) {
    log.error(`[api] storing a granted ${provider.name} credential failed:`, error);
    // One transaction: a throw rolled the claim back with it.
    return { status: 500, ok: false, reason: NOT_KEPT, link: 'unused' };
  }
  if (!stored.ok) {
    const reason = { en: stored.reason, nl: stored.reasonNl };
    if (stored.linkStillWorks) return { status: 403, ok: false, reason, link: 'works' };
    return { status: 409, ok: false, reason, ...(stored.linkUnused ? { link: 'unused' as const } : {}) };
  }
  const progressUrl = pending.personLink
    ? await effects.afterPerson(pending.personLink, 'granted' in stored ? stored.granted : [])
    : await effects.afterMigration(pending.link!);
  const more = moreToConnect(pending.personLink, stored);
  return {
    status: 200,
    ok: true,
    permission,
    ...(progressUrl ? { progressUrl } : {}),
    ...(more ? { more } : {}),
  };
}

/**
 * What a person's ending says is left (the owner's decisions of 2026-11-26):
 * the accounts on the link still to connect, and the grant page to go back
 * to, while the link is not spent. None for a migration's link, a spent one,
 * or a deployment that names no web address.
 */
export function moreToConnect(
  personLink: { readonly backUrl?: string } | undefined,
  stored: { readonly ok: true } & Partial<{ readonly left: number; readonly linkSpent: boolean }>,
): { readonly left: number; readonly backUrl: string } | undefined {
  if (!personLink?.backUrl || stored.linkSpent || !stored.left || stored.left <= 0) return undefined;
  return { left: stored.left, backUrl: personLink.backUrl };
}
