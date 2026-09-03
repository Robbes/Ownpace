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

import {
  providerAccountDomains,
  type DiscoveryDomain,
  type ProviderAccountEnv,
} from '@openmig/shared';
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
 *
 * PARTIAL, AND THE GAP IS THE POINT (workplan 0113). There is no entry for
 * `task`, because there is no Google scope to ask for: Google's own CalDAV
 * guide states the implementation supports neither VTODO nor VJOURNAL, and its
 * tasks live behind a separate REST API this product does not speak (0113 T6,
 * deliberately out of v1). A missing entry therefore means "Google cannot
 * serve this face" — which is true, and which `providerAccountDomains` already
 * says by leaving `task` off the google row. Anything reading this map filters
 * to the faces the account carries first, so the gap is never reached; it is
 * `Partial` so that a future domain Google also cannot serve is a missing line
 * rather than a lie.
 */
const GRANT_DOMAIN: Readonly<Partial<Record<DiscoveryDomain, GoogleGrantDomain>>> = {
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
 * The four Google faces, in the order `domainsToScopes` emits scopes in. One
 * order for both halves of the answer — see the note where it is used.
 *
 * FOUR, NOT FIVE: `task` is a domain of the product, not a face of a Google
 * account (0113). Google's CalDAV carries no VTODO at all, so there is nothing
 * here to order.
 */
const ORDER: ReadonlyArray<DiscoveryDomain> = ['email', 'calendar', 'contact', 'file'];

const KNOWN = ORDER;

/**
 * The grant names for these domains, dropping any Google cannot serve.
 *
 * The drop is unreachable from both callers — one filters through `ORDER` and
 * the other through `providerAccountDomains('google')`, and neither yields
 * `task`. It is written once, here, rather than asserted away at each site:
 * a filter that can be read is better than a `!` that has to be trusted, and
 * when a sixth domain arrives this is where it declines to become a scope.
 */
function grantNamesFor(domains: ReadonlyArray<DiscoveryDomain>): GoogleGrantDomain[] {
  return domains
    .map((d) => GRANT_DOMAIN[d])
    .filter((g): g is GoogleGrantDomain => g !== undefined);
}

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
  env: ProviderAccountEnv = process.env,
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

  // ASKED OF THE DEPLOYMENT, not read off a constant (ADR-0041, owner decision
  // 2026-09-01). The header above explains why two faces and not four; that
  // reasoning is about the client Ownpace publishes to strangers, and it holds
  // there. A deployment whose own application registered the restricted scopes
  // answers differently, and this follows its answer.
  const served = providerAccountDomains('google', env);
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
  const scopes = domainsToScopes(grantNamesFor(ordered));
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
export function googleAccountScopeSentence(
  ticked: ReadonlyArray<string>,
  env: ProviderAccountEnv = process.env,
): string {
  const consent = googleAccountConsent(ticked, env);
  if (!isRefusal(consent)) return consent.scope;
  // The same deployment answer as the gate above, or this sentence would name
  // scopes the consent would then refuse to ask for — a fallback that lies.
  return grantNamesFor(providerAccountDomains('google', env))
    .map((g) => GOOGLE_SCOPES_ASKED_BY_DOMAIN[g])
    .join(' ');
}
