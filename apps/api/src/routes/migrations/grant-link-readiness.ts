// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Whether a grant link could possibly succeed — decided BEFORE one is minted.
 *
 * Workplan 0108 T3, and it is the same principle as 0089 T6's raw-IP refusal:
 * **refused HERE, not at Google's screen.** A grant link is handed to a person
 * who has no account, no session, and no way to fix anything. Every condition
 * that would kill the flow in their browser is a condition the owner could have
 * fixed in thirty seconds, and only the owner can — so the refusal has to land
 * on the owner, at the moment they press the button, naming what to configure.
 *
 * The alternative is what the manual does today: a link goes out, somebody
 * clears an hour to do their part, and the page they open fails at a Google
 * screen with an error about a client id they have never heard of. That is a
 * support ticket, a lost afternoon and an apology, in exchange for skipping one
 * check.
 *
 * ## Why this file takes booleans and not values
 *
 * `hasClientSecret`, not `clientSecret`. The decision needs to know whether the
 * owner configured one; it never needs the value. Passing the value would put a
 * decrypted client secret inside a function whose whole output is a sentence
 * shown to a person and written to a log — one interpolation away from ADR-0037's
 * hardest rule. Taking a boolean makes that mistake unavailable rather than
 * merely unmade.
 */

import type { GoogleConsentSourceType } from './google-consent.ts';

/**
 * `connection.kind` → the consent vocabulary, for the four Google sources.
 *
 * The inverse of `sourceKindFor`, and the reason it is a table rather than a
 * `.replace('_', '-')`: the two vocabularies agree by coincidence today (one
 * underscores where the other hyphenates, because `connection.kind` predates
 * the wizard's words) and a derivation would silently accept a fifth kind that
 * happens to transliterate. Membership of THIS table is what "a grant link can
 * be issued for it" means.
 */
export const GOOGLE_CONSENT_KIND_TO_SOURCE: Readonly<Record<string, GoogleConsentSourceType>> = {
  gmail: 'gmail',
  google_calendar: 'google-calendar',
  google_contacts: 'google-contacts',
  google_drive: 'google-drive',
};

/** What the API knows about a mapping before it decides to issue. */
export interface GrantLinkReadiness {
  /** `connection.kind` of the mapping's SOURCE, or null when it has none. */
  readonly sourceKind: string | null;
  /** Whether the stored source credentials carry a non-empty client id. */
  readonly hasClientId: boolean;
  /** Whether they carry a non-empty client secret. */
  readonly hasClientSecret: boolean;
  /** Whether this deployment knows the browser-facing address (`WEB_URL`). */
  readonly hasWebUrl: boolean;
}

export interface GrantLinkRefusal {
  /** A stable machine code, for a UI that wants to route to the right screen. */
  readonly code:
    | 'no_source_connection'
    | 'source_not_google'
    | 'client_not_configured'
    | 'web_url_unset';
  /** One sentence, naming what to do about it. Never a value, only a field. */
  readonly reason: string;
}

/**
 * The four ways a grant link is dead on arrival, in the order the owner can act
 * on them. Returns null when the link would work.
 *
 * `web_url_unset` is last because it is the deployment's problem rather than
 * this mapping's, and an owner who fixes it once never sees it again — but it
 * is checked at all because a link is nothing BUT a URL. Issuing one against a
 * deployment that cannot say where its own web app lives would hand somebody
 * `http://localhost:3123/grant/…`, which is 0095 T3's lesson word for word: it
 * goes out looking exactly like a successful one.
 */
export function grantLinkRefusal(r: GrantLinkReadiness): GrantLinkRefusal | null {
  if (!r.sourceKind) {
    return {
      code: 'no_source_connection',
      reason:
        'This migration has no source connection yet, so there is nothing for anyone to ' +
        'grant access to. Finish setting up the source first.',
    };
  }
  const consentSource = GOOGLE_CONSENT_KIND_TO_SOURCE[r.sourceKind];
  if (!consentSource) {
    return {
      code: 'source_not_google',
      reason:
        `A grant link asks somebody to sign in with Google, and this migration's source is ` +
        `'${r.sourceKind}'. Only Gmail, Google Calendar, Google Contacts and Google Drive ` +
        'sources can be granted this way today — for the others, the credential still comes ' +
        'to you by hand.',
    };
  }
  if (!r.hasClientId || !r.hasClientSecret) {
    // Names the FIELD, never a value, and says where it is set. An owner who
    // reads "clientSecret is missing" and cannot find the box has been told
    // nothing.
    const missing =
      !r.hasClientId && !r.hasClientSecret
        ? 'has neither a client id nor a client secret stored'
        : !r.hasClientId
          ? 'has no client id stored'
          : 'has no client secret stored';
    return {
      code: 'client_not_configured',
      reason:
        `The consent runs against your own Google client, and this source ${missing}. ` +
        'Add it on the source connection, then issue the link — otherwise the person you send ' +
        'it to lands on a Google error page about a client they have never heard of.',
    };
  }
  if (!r.hasWebUrl) {
    return {
      code: 'web_url_unset',
      reason:
        'This deployment has no WEB_URL set, so it cannot say which address the link should ' +
        'point at. A link built without it would send somebody to a machine that is not ' +
        'yours. Set WEB_URL and restart the API.',
    };
  }
  return null;
}
