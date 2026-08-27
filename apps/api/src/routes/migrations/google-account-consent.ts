// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What a `google` ACCOUNT consent may ask for, given exactly the faces ticked
 * (workplan 0106 T3b — the owner's decision of 2026-08-27).
 *
 * ## The tick decides the ask, and nothing else does
 *
 * The owner's words: *"one can tick 'google' and pick the object types to ask
 * a grant for."* So the consent screen is built from the ticks and from no
 * other source — no default, no widening, no "while we are here". That is the
 * standing least-privilege rule made mechanical: **never ask a scope no ticked
 * domain needs.**
 *
 * `domainsToScopes` (0106 T1b) already refuses to substitute anything for an
 * empty tick set, deliberately, and says callers must refuse rather than
 * default. This is that caller.
 *
 * ## Why two faces and not four, and why that is a REFUSAL rather than a gap
 *
 * `PROVIDER_ACCOUNT_DOMAINS.google` is `['calendar', 'contact']`. Not a
 * technical limit — Google's own pricing of its scopes. Calendar and carddav
 * are *sensitive* (brand verification, free); Gmail's `https://mail.google.com/`
 * and `drive.readonly` are *restricted*, needing an annual third-party security
 * assessment (`docs/google-oauth-verification.md`). One consent inviting all
 * four would push the MANAGED client into the restricted tier **for every
 * customer, including one who only wanted contacts**.
 *
 * So a tick for mail or files on a `google` ACCOUNT is refused here, and the
 * refusal names the way through rather than the wall: the single-purpose
 * `gmail` and `google-drive` sources still exist and still work, each asking
 * its own one scope. That is what "cohabit" meant in T3b — the account kind
 * does not replace them, and while it cannot serve all four, saying so is
 * better than silently asking for less than the person ticked.
 *
 * A silent narrowing would be the worse failure: somebody ticks four faces,
 * approves a consent screen showing two, and finds out weeks later that mail
 * was never in the grant. The qualification record would eventually say so
 * (0106 T1a reads what a grant actually carries), but weeks late and to
 * somebody who thought they had already answered the question.
 *
 * ## Pure, so it needs no server to prove
 *
 * Same shape as `google-consent.ts` and for the same stated reason: every
 * decision here is a function of its arguments, and the route below is thin.
 */

import { PROVIDER_ACCOUNT_DOMAINS, type DiscoveryDomain } from '@openmig/shared';
import {
  domainsToScopes,
  GOOGLE_SCOPES_ASKED_BY_DOMAIN,
  type GoogleGrantDomain,
} from '@openmig/orchestration/account-qualification';

/**
 * The wizard ticks in DISCOVERY vocabulary; the scope table is keyed in GRANT
 * vocabulary. One word differs — `email` there is `mail` here — and it has
 * differed since both existed. Written out rather than string-munged, so the
 * next vocabulary that joins is a line in a table instead of a rule somebody
 * has to remember.
 */
const GRANT_DOMAIN: Readonly<Record<DiscoveryDomain, GoogleGrantDomain>> = {
  email: 'mail',
  calendar: 'calendar',
  contact: 'contact',
  file: 'file',
};

/** Which single-purpose source still serves a face the account kind cannot. */
const SINGLE_PURPOSE_SOURCE: Readonly<Partial<Record<DiscoveryDomain, string>>> = {
  email: 'gmail',
  file: 'google-drive',
};

export interface AccountConsentAsk {
  /** The space-joined scope string, in the table's own stable order. */
  readonly scope: string;
  /** What was ticked, echoed back so the wizard can show what it asked for. */
  readonly domains: ReadonlyArray<DiscoveryDomain>;
}

export interface AccountConsentRefusal {
  readonly error: string;
  readonly reason: string;
}

export function isRefusal(
  result: AccountConsentAsk | AccountConsentRefusal,
): result is AccountConsentRefusal {
  return 'error' in result;
}

/**
 * The four, in the order `domainsToScopes` emits scopes in. One order for
 * both halves of the answer — see the note where it is used.
 */
const ORDER: ReadonlyArray<DiscoveryDomain> = ['email', 'calendar', 'contact', 'file'];

const KNOWN = ORDER;

const isDiscoveryDomain = (value: string): value is DiscoveryDomain =>
  (KNOWN as ReadonlyArray<string>).includes(value);

/**
 * The scope string for a `google` account consent, or a refusal saying why.
 *
 * Deduplicated and stably ordered by `domainsToScopes`, so the same tick set
 * always produces the same consent screen — a scope string that varies run to
 * run is one a person cannot recognise as the same request they approved
 * yesterday.
 */
export function googleAccountConsent(
  ticked: ReadonlyArray<string>,
): AccountConsentAsk | AccountConsentRefusal {
  const unknown = ticked.filter((d) => !isDiscoveryDomain(d));
  if (unknown.length > 0) {
    return {
      error: 'unknown_domain',
      reason:
        `Not something this product migrates: ${unknown.join(', ')}. The four are email, ` +
        'calendar, contact and file.',
    };
  }

  const domains = [...new Set(ticked as ReadonlyArray<DiscoveryDomain>)];
  if (domains.length === 0) {
    // Refused rather than defaulted. There is no sensible scope for "no
    // domains", and a fallback here would be a way to ask for something
    // nobody ticked — the one thing this path exists to prevent.
    return {
      error: 'no_domains_ticked',
      reason:
        'Tick at least one thing to migrate. The consent asks for exactly what is ticked, so ' +
        'with nothing ticked there is nothing to ask for.',
    };
  }

  const served = PROVIDER_ACCOUNT_DOMAINS.google;
  const beyond = domains.filter((d) => !served.includes(d));
  if (beyond.length > 0) {
    const ways = beyond
      .map((d) => `${d} → the ${SINGLE_PURPOSE_SOURCE[d] ?? 'single-purpose'} source`)
      .join('; ');
    return {
      error: 'not_on_this_account',
      reason:
        `A Google account connection here serves ${served.join(' and ')}. Gmail and Drive need ` +
        'scopes Google classes as restricted, which are not on this deployment’s ' +
        `application. Connect them as their own source instead: ${ways}.`,
    };
  }

  // Ordered by the SCOPE table, not by the caller. Found by the route test:
  // `domains` echoed the tick order while `scope` came back in the table's
  // order, so the two reports of one decision disagreed — a wizard showing
  // "contact, calendar" beside a consent screen listing calendar first. Two
  // orders is one of them being wrong, and the one that matters is the one
  // Google renders.
  const ordered = ORDER.filter((d) => domains.includes(d));
  const scopes = domainsToScopes(ordered.map((d) => GRANT_DOMAIN[d]));
  return { scope: scopes.join(' '), domains: ordered };
}


/**
 * The scopes a `google` account source's refresh token must carry, as a
 * sentence for a refusal (workplan 0106 T3b).
 *
 * The create door needs this because *"which consent is this"* is the mistake
 * waiting to happen with several Google sources sharing one OAuth client — and
 * for an ACCOUNT the answer is a set rather than one scope. Built from the same
 * function `POST /google/authorize` uses, so the string the door demands and
 * the string the consent asked for are the same string.
 *
 * When the ticks are not ones this account kind serves, the refusal about THAT
 * is `sourceDomainRefusal`'s to make; this one falls back to naming every scope
 * the kind can carry, which is the useful thing to say beside a missing
 * credential.
 */
export function googleAccountScopeSentence(ticked: ReadonlyArray<string>): string {
  const consent = googleAccountConsent(ticked);
  if (!isRefusal(consent)) return consent.scope;
  return PROVIDER_ACCOUNT_DOMAINS.google
    .map((d) => GOOGLE_SCOPES_ASKED_BY_DOMAIN[GRANT_DOMAIN[d]])
    .join(' ');
}
