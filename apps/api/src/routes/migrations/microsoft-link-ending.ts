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
 * The decisions are in `decideLinkEnding` (`link-ending.ts`), lifted out of
 * this file when Dropbox joined (workplan 0174 §6); `decideMicrosoftLinkEnding`
 * hands it Microsoft's own parts. It takes its effects as arguments so every
 * branch is proven without a server or a database; the callback in
 * `microsoft-oauth-routes.ts` hands it the real ones.
 */

import type { RecordedPermission } from './google-consent.ts';
import { microsoftConsentRefusal } from './microsoft-consent.ts';
import {
  decideLinkEnding,
  type LinkEndingEffects,
  type LinkEndingPage,
  type LinkEndingPending,
  type LinkEndingProvider,
} from './link-ending.ts';

/** What the ending page shows: a refusal and what is true of the link, or the grant. */
export type MicrosoftLinkPage = LinkEndingPage;

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
export type MicrosoftLinkEffects = LinkEndingEffects;

/** What the pending state says about this consent, as far as the ending reads it. */
export type MicrosoftLinkPending = LinkEndingPending;

/** Microsoft's own parts of the ending. */
export const MICROSOFT_LINK_ENDING: LinkEndingProvider = {
  id: 'microsoft',
  name: 'Microsoft',
  recordedPermission: microsoftRecordedPermission,
  // An organisation's policy refusal (an administrator must approve the
  // app) is said in Entra's own words, as the owner's ending says it: the
  // person forwards it, and the administrator can act on it (§3.3).
  policyRefusal: (description) => microsoftConsentRefusal(description, 'deployment'),
};

/** The whole ending, decided, for a Microsoft consent (`decideLinkEnding`). */
export function decideMicrosoftLinkEnding(
  pending: MicrosoftLinkPending,
  query: { readonly error?: unknown; readonly error_description?: unknown; readonly code?: unknown },
  effects: MicrosoftLinkEffects,
): Promise<MicrosoftLinkPage> {
  return decideLinkEnding(MICROSOFT_LINK_ENDING, pending, query, effects);
}
