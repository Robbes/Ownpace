// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MICROSOFT GRANT LINK'S ENDING (workplan 0171 §3.2–3.3, T3).
 *
 * The branches Google's callback has had since 0108 T4 and 0153 T5 (b), for a
 * consent begun at Microsoft by a link holder: a migration's link or a
 * person's. The order is Google's, and so is the store: the code is
 * exchanged, Microsoft is asked who signed in, and `storeGrantedToken` or
 * `storePersonGrant` spends the link, checks the account against the one the
 * migration names, and writes the token, in one transaction. A wrong
 * account's token is dropped and the link stays live.
 *
 * The decisions are in `decideMicrosoftLinkEnding`, which takes its effects as
 * arguments so every branch is proven without a server or a database; the
 * callback in `microsoft-oauth-routes.ts` hands it the real ones.
 */

import {
  NOT_KEPT,
  exchangeRefusedAt,
  log,
  nothingCameBackFrom,
  stoppedAtProvider,
  type Bilingual,
} from '@openmig/shared';
import type { GrantClient, GrantFinish } from '../grant-providers.ts';
import type { GrantStoreResult, GrantTarget, GrantedAccess } from './grant-ending.ts';
import type { PersonGrantStoreResult, PersonGrantTarget } from './person-grant-ending.ts';
import type { RecordedPermission } from './google-consent.ts';
import type { ProgressPageUrl } from './progress-page-url.ts';
import { microsoftConsentRefusal } from './microsoft-consent.ts';

/** What the ending page shows: a refusal and what is true of the link, or the grant. */
export type MicrosoftLinkPage =
  | { readonly status: number; readonly ok: false; readonly reason: Bilingual | string; readonly link?: 'works' | 'unused' }
  | { readonly status: 200; readonly ok: true; readonly permission: RecordedPermission; readonly progressUrl?: ProgressPageUrl };

/** The scopes that say who signed in, or keep the grant alive: neither reads nor writes data. */
const NOT_DATA: ReadonlySet<string> = new Set(['openid', 'email', 'profile', 'offline_access', 'User.Read']);

/**
 * Read-only at Microsoft, by Microsoft's own names, when every data scope the
 * grant RECORDED is a `.Read` one. Microsoft answers with every scope this
 * account gave the same application, so a grant given earlier for more shows
 * here, and the ending then says only that Ownpace reads.
 */
export function microsoftRecordedPermission(grantedScopes: ReadonlyArray<string>): RecordedPermission {
  const prefix = 'https://graph.microsoft.com/';
  const data = grantedScopes
    .map((s) => (s.startsWith(prefix) ? s.slice(prefix.length) : s))
    .filter((s) => !NOT_DATA.has(s));
  return data.every((s) => /\.Read$/.test(s)) ? 'read-only' : 'allows-changes';
}

/** The effects the ending needs, injected. */
export interface MicrosoftLinkEffects {
  readonly closedOrganisation: (tenantId: string) => Promise<{ reason: string; reasonNl: string } | null>;
  readonly finish: (code: string, redirectUri: string, client: GrantClient) => Promise<GrantFinish>;
  readonly storeGrantedToken: (target: GrantTarget, granted: GrantedAccess) => Promise<GrantStoreResult>;
  readonly storePersonGrant: (target: PersonGrantTarget, granted: GrantedAccess) => Promise<PersonGrantStoreResult>;
  /** After the grant's transaction: what it lets start, and the page the person keeps. Never undo it. */
  readonly afterMigration: (target: GrantTarget) => Promise<ProgressPageUrl | null>;
  readonly afterPerson: (target: PersonGrantTarget, granted: readonly string[]) => Promise<ProgressPageUrl | null>;
}

/** What the pending state says about this consent, as far as the ending reads it. */
export interface MicrosoftLinkPending {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly tenant?: string;
  readonly link?: GrantTarget;
  readonly personLink?: PersonGrantTarget;
}

/**
 * The whole ending, decided. `query` is the browser's (`error`,
 * `error_description`, `code`); everything that decides whose link this is
 * comes from `pending`, the server's own record.
 */
export async function decideMicrosoftLinkEnding(
  pending: MicrosoftLinkPending,
  query: { readonly error?: unknown; readonly error_description?: unknown; readonly code?: unknown },
  effects: MicrosoftLinkEffects,
): Promise<MicrosoftLinkPage> {
  const anyLink = pending.link ?? pending.personLink;
  if (!anyLink) return { status: 500, ok: false, reason: NOT_KEPT, link: 'unused' };
  const whose = pending.clientId;

  if (typeof query.error === 'string' && query.error.length > 0) {
    const description = typeof query.error_description === 'string' ? query.error_description : '';
    // An organisation's policy refusal (an administrator must approve the
    // app) is said in Entra's own words, as the owner's ending says it: the
    // person forwards it, and the administrator can act on it (§3.3).
    const policy = microsoftConsentRefusal(description, 'deployment');
    return { status: 200, ok: false, reason: policy ?? stoppedAtProvider('microsoft', query.error), link: 'unused' };
  }
  const code = typeof query.code === 'string' ? query.code : '';
  if (!code) return { status: 400, ok: false, reason: nothingCameBackFrom('microsoft'), link: 'unused' };

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
    // Microsoft could not be reached, or `/me` failed with a fault of its
    // own: nothing was stored, and the link was not claimed (hard rule 9).
    log.error('[api] a Microsoft grant link could not be finished:', error);
    return { status: 502, ok: false, reason: NOT_KEPT, link: 'unused' };
  }
  if (!finished.ok) {
    log.warn(
      `[api] a Microsoft grant link's code exchange failed for ` +
        `${pending.link ? `mapping ${pending.link.mappingId}` : `person ${pending.personLink!.personId}`}: ${finished.reason}`,
    );
    // Entra's own policy sentence where it gave one; otherwise ours, worded
    // for somebody who holds no client.
    const said = typeof finished.said === 'string' ? finished.said : exchangeRefusedAt('microsoft');
    return { status: 400, ok: false, reason: said, link: 'unused' };
  }

  const { refreshToken, ...alsoStore } = finished.secret;
  if (!refreshToken) return { status: 500, ok: false, reason: NOT_KEPT, link: 'unused' };
  const granted: GrantedAccess = { refreshToken, signedInAs: finished.signedInAs, provider: 'microsoft', alsoStore };
  const permission = microsoftRecordedPermission(finished.grantedScopes);

  let stored: GrantStoreResult | PersonGrantStoreResult;
  try {
    stored = pending.personLink
      ? await effects.storePersonGrant(pending.personLink, granted)
      : await effects.storeGrantedToken(pending.link!, granted);
  } catch (error) {
    log.error('[api] storing a granted Microsoft credential failed:', error);
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
  return progressUrl ? { status: 200, ok: true, permission, progressUrl } : { status: 200, ok: true, permission };
}
