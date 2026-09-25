// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Whether a link could possibly succeed — decided BEFORE one is minted.
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
 *
 * ## One decision for issue and use (reopened 2026-09-23, 0108 T6–T8a)
 *
 * The owner: *"Grant links: Yes, fix both."* The link never inherited the
 * deployment's Google client (ADR-0041), and it did not know the Google
 * ACCOUNT kind the wizard now makes. Both are answered here once, by
 * `grantLinkAsk`, and read by the owner's route when a link is issued and by
 * the grant route when it is used. Two readings of whose client and which
 * scope would be two answers that can disagree, and the one that loses is a
 * stranger at a Google error page.
 *
 * It also decides that a link is never issued for a migration with no
 * destination: the page says where the data goes before the button (T8a),
 * and a page with nothing to say there is the consent-phishing page with one
 * line missing. Nor for one that names no source account (T8 (b)): the grant is
 * bound to that account, so with none named no sign-in could ever be accepted.
 */

import { providerAccountDomains, type DiscoveryDomain } from '@openmig/shared';
import { GOOGLE_SCOPES_READ_ONLY_AT_GOOGLE } from '@openmig/orchestration/account-qualification';
import { GOOGLE_SOURCE_SCOPES, type GoogleConsentSourceType } from './google-consent.ts';
import { googleAccountConsent, isRefusal } from './google-account-consent.ts';
import { SIGNED_IN_ACCOUNT_SCOPES } from './signed-in-account.ts';

/**
 * `connection.kind` → the consent vocabulary, for the four Google sources.
 *
 * The inverse of `sourceKindFor`, and the reason it is a table rather than a
 * `.replace('_', '-')`: the two vocabularies agree by coincidence today (one
 * underscores where the other hyphenates, because `connection.kind` predates
 * the wizard's words) and a derivation would silently accept a fifth kind that
 * happens to transliterate. Membership of this table, or being the account
 * kind below, is what "a grant link can be issued for it" means
 * (`isGrantableSourceKind`).
 */
export const GOOGLE_CONSENT_KIND_TO_SOURCE: Readonly<Record<string, GoogleConsentSourceType>> = {
  gmail: 'gmail',
  google_calendar: 'google-calendar',
  google_contacts: 'google-contacts',
  google_drive: 'google-drive',
};

/**
 * The Google ACCOUNT kind (workplan 0106 T3b), grantable since 2026-09-23
 * (0108 T7). Not in the table above, because it has no ONE consent source:
 * its link asks for the data types the migration copies, through the same
 * `googleAccountConsent` the owner's own account consent uses.
 */
export const GOOGLE_ACCOUNT_KIND = 'google';

/**
 * Whether a grant link can be issued for this `connection.kind` at all — the
 * four single-purpose kinds and the account. Own properties only: `toString`
 * is on every object and is not a Google source.
 */
export function isGrantableSourceKind(kind: string | null | undefined): boolean {
  if (!kind) return false;
  return kind === GOOGLE_ACCOUNT_KIND || Object.hasOwn(GOOGLE_CONSENT_KIND_TO_SOURCE, kind);
}

/**
 * The one data type each single-purpose kind IS, in the discovery vocabulary
 * the account ask and the scheduler use. Keyed by the consent type, so a
 * fifth one does not compile until it says which type it reads.
 */
const SINGLE_PURPOSE_DOMAIN: Readonly<Record<GoogleConsentSourceType, DiscoveryDomain>> = {
  gmail: 'email',
  'google-calendar': 'calendar',
  'google-contacts': 'contact',
  'google-drive': 'file',
};

/** What the API knows about a mapping before it decides to issue. */
export interface GrantLinkReadiness {
  /** `connection.kind` of the mapping's SOURCE, or null when it has none. */
  readonly sourceKind: string | null;
  /**
   * The data types the migration copies: its included `scope_selection`
   * rows, the scheduler's own reading (`enabledDomains`). What an ACCOUNT
   * link asks for. A single-purpose kind is its one type and ignores this.
   */
  readonly includedDomains: ReadonlyArray<string>;
  /**
   * Whether the migration names the Google account it reads, as an address
   * (T8 (b)). The grant is bound to it: any other account that signs in is
   * refused, so a link for a migration that names none could never be used.
   */
  readonly hasNamedAccount: boolean;
  /** Whether the migration has a destination. The page names it (T8a). */
  readonly hasTarget: boolean;
  /** Whether the stored source credentials carry a non-empty client id. */
  readonly hasClientId: boolean;
  /** Whether they carry a non-empty client secret. */
  readonly hasClientSecret: boolean;
  /** Whether this deployment carries a whole Google client (ADR-0041). */
  readonly hasDeploymentClient: boolean;
  /**
   * `GOOGLE_ACCOUNT_SCOPE_CLASS` as configured: a setting, not a secret. A
   * string rather than the environment, so nothing else in the environment
   * can reach a sentence through it.
   */
  readonly scopeClass: string | undefined;
  /** Whether this deployment knows the browser-facing address (`WEB_URL`). */
  readonly hasWebUrl: boolean;
}

/** The refusals `grantLinkAsk` can give — every one but the deployment's address. */
export type GrantLinkAskRefusalCode =
  | 'no_source_connection'
  | 'source_not_google'
  | 'no_named_account'
  | 'no_target'
  | 'nothing_to_ask'
  | 'client_not_configured'
  | 'restricted_scope';

export interface GrantLinkRefusal {
  /** A stable machine code, for a UI that wants to route to the right screen. */
  readonly code: GrantLinkAskRefusalCode | 'web_url_unset';
  /** One sentence, naming what to do about it. Never a value, only a field. */
  readonly reason: string;
}

/** What a link asks Google for, and whose application asks. */
export interface GrantLinkAsk {
  /** Whose Google application the consent runs against — never its values. */
  readonly client: 'connection' | 'deployment';
  /**
   * The scope string Google will record, space-joined: the data types' scopes,
   * then the two that say who signed in (`SIGNED_IN_ACCOUNT_SCOPES`, T8 (b)).
   */
  readonly scope: string;
  /** The data types it covers, in the scope table's order. */
  readonly domains: ReadonlyArray<DiscoveryDomain>;
  /**
   * Whether Google itself holds this grant to reading (workplan 0144 T3 (c)):
   * every DATA scope is one Google enforces as read-only
   * (`GOOGLE_SCOPES_READ_ONLY_AT_GOOGLE`). The page says "read-only" only then.
   * Otherwise it says that Ownpace only reads and that Google describes the
   * permission more broadly, because Google's screen, one click later, will.
   */
  readonly readOnlyAtProvider: boolean;
}

export type GrantLinkDecision =
  | { readonly ok: true; readonly ask: GrantLinkAsk }
  | {
      readonly ok: false;
      readonly refusal: GrantLinkRefusal & { readonly code: GrantLinkAskRefusalCode };
    };

/**
 * The one refusal BOTH purposes share, as a value rather than as two copies.
 *
 * A link is nothing but a URL, so neither kind can be minted by a deployment
 * that cannot say where its own web app lives. Stated once because it is a
 * remedy sentence, and two copies of a remedy are two places for it to go stale
 * — the same reason ADR-0024 keeps server prose in one place per refusal.
 */
const WEB_URL_UNSET: GrantLinkRefusal = {
  code: 'web_url_unset',
  reason:
    'This deployment has no WEB_URL set, so it cannot say which address the link should ' +
    'point at. A link built without it would send somebody to a machine that is not ' +
    'yours. Set WEB_URL and restart the API.',
};

/**
 * What a grant link for this mapping would ask, and through whose Google
 * application — or why it cannot be issued. In the order the owner can act on
 * them: the migration's own gaps first, then its client.
 *
 * **Whose client** (T6, the rule ADR-0041 states for every other Google door):
 * the connection's own WHOLE pair wins; with none stored, the deployment's; half
 * a pair is refused, never completed with the deployment's other half. The
 * run path resolves the same way (`withDeploymentGoogleClient`), so the
 * refresh token a link brings back belongs to the application that will use it.
 *
 * **Mail and files through the deployment's client only where the restricted
 * class is declared.** Its consent screen says Ownpace, and Google verifies it
 * before it may ask for Gmail or Drive (0108, *Reopened 2026-09-23*). Asked of
 * `providerAccountDomains`, the one reading of that setting, so this cannot
 * disagree with what an account consent may ask for.
 *
 * **What is asked** (T7): a single-purpose kind is its one data type. The
 * account kind asks for the data types the migration copies, through
 * `googleAccountConsent` — the owner's own account consent, so the same
 * migration cannot be asked for differently by its owner and by its link.
 */
export function grantLinkAsk(r: Omit<GrantLinkReadiness, 'hasWebUrl'>): GrantLinkDecision {
  const refuse = (code: GrantLinkAskRefusalCode, reason: string): GrantLinkDecision => ({
    ok: false,
    refusal: { code, reason },
  });
  if (!r.sourceKind) {
    return refuse(
      'no_source_connection',
      'This migration has no source connection yet, so there is nothing for anyone to ' +
        'grant access to. Finish setting up the source first.',
    );
  }
  if (!isGrantableSourceKind(r.sourceKind)) {
    return refuse(
      'source_not_google',
      `A grant link asks somebody to sign in with Google, and this migration's source is ` +
        `'${r.sourceKind}'. Only a Google account, Gmail, Google Calendar, Google Contacts ` +
        'and Google Drive can be granted this way today — for the others, the credential ' +
        'still comes to you by hand.',
    );
  }
  if (!r.hasNamedAccount) {
    // The owner's decision of 2026-09-23 (T8 (b)): *"bind to the account the
    // page already named (so filled in by the requester/facilitator)"*. With
    // nothing named there is nothing to bind to, and every sign-in would be
    // refused at the end of the consent rather than here.
    return refuse(
      'no_named_account',
      'A grant is only accepted from the Google account this migration reads, and it ' +
        'names none, so nobody could use the link. Create the migration again with that ' +
        "account's address.",
    );
  }
  if (!r.hasTarget) {
    return refuse(
      'no_target',
      'This migration has no destination yet. The person you send the link to is shown ' +
        'where their data will go before they agree, so set the destination first.',
    );
  }

  const scopeEnv = { GOOGLE_ACCOUNT_SCOPE_CLASS: r.scopeClass };
  let scope: string;
  let domains: ReadonlyArray<DiscoveryDomain>;
  const single = Object.hasOwn(GOOGLE_CONSENT_KIND_TO_SOURCE, r.sourceKind)
    ? GOOGLE_CONSENT_KIND_TO_SOURCE[r.sourceKind]
    : undefined;
  if (single) {
    scope = GOOGLE_SOURCE_SCOPES[single];
    domains = [SINGLE_PURPOSE_DOMAIN[single]];
  } else {
    const consent = googleAccountConsent(r.includedDomains, scopeEnv);
    if (isRefusal(consent)) {
      // `no_domains_ticked` is the one refusal that means "nothing to ask";
      // every other is the account kind declining a face on this deployment,
      // said in that function's own words (its caller's rule: verbatim).
      return consent.error === 'no_domains_ticked'
        ? refuse(
            'nothing_to_ask',
            'This migration copies no data types at the moment, so a link would have ' +
              'nothing to ask for. Include at least one, then issue the link.',
          )
        : refuse('restricted_scope', consent.reason);
    }
    scope = consent.scope;
    domains = consent.domains;
  }

  if (r.hasClientId !== r.hasClientSecret) {
    // Names the FIELD, never a value, and says where it is set. An owner who
    // reads "clientSecret is missing" and cannot find the box has been told
    // nothing.
    const missing = r.hasClientId ? 'has no client secret stored' : 'has no client id stored';
    return refuse(
      'client_not_configured',
      `The consent runs against your own Google client, and this source ${missing}. ` +
        'Add it on the source connection, then issue the link — otherwise the person you ' +
        'send it to lands on a Google error page about a client they have never heard of.',
    );
  }
  const client = r.hasClientId ? 'connection' : r.hasDeploymentClient ? 'deployment' : null;
  if (client === null) {
    return refuse(
      'client_not_configured',
      'The consent needs a Google application, and there is none: this source has neither ' +
        'a client id nor a client secret stored, and this deployment has no Google client ' +
        'of its own. Add the pair on the source connection, or set GOOGLE_OAUTH_CLIENT_ID ' +
        'and GOOGLE_OAUTH_CLIENT_SECRET on the deployment.',
    );
  }
  if (client === 'deployment') {
    const served = providerAccountDomains(GOOGLE_ACCOUNT_KIND, scopeEnv);
    if (domains.some((d) => !served.includes(d))) {
      return refuse(
        'restricted_scope',
        'Mail and files need scopes Google classes as restricted, and this deployment’s ' +
          'own Google application has not declared them (GOOGLE_ACCOUNT_SCOPE_CLASS). Add ' +
          'your own Google client on the source connection, or ask whoever runs this ' +
          'deployment to declare the class once their application carries those scopes.',
      );
    }
  }
  // Read-only at Google, from the data scopes alone: they are what Google
  // describes on its screen. Decided before the sign-in scopes are added,
  // because who signed in is not data and every link asks it (0144 T3 (c)).
  const dataScopes = scope.split(' ').filter((s) => s !== '');
  const readOnlyAtProvider =
    dataScopes.length > 0 && dataScopes.every((s) => GOOGLE_SCOPES_READ_ONLY_AT_GOOGLE.includes(s));
  // Who signed in, asked beside the data: the ending compares it with the
  // account the page named, and refuses anything else (T8 (b)).
  return {
    ok: true,
    ask: {
      client,
      scope: [scope, ...SIGNED_IN_ACCOUNT_SCOPES].join(' '),
      domains,
      readOnlyAtProvider,
    },
  };
}

/**
 * Every way a grant link is dead on arrival, in the order the owner can act
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
  const decided = grantLinkAsk(r);
  if (!decided.ok) return decided.refusal;
  if (!r.hasWebUrl) return WEB_URL_UNSET;
  return null;
}

/**
 * The same question for a PROGRESS link, and the answer is much shorter
 * (workplan 0122 T2).
 *
 * Every check of `grantLinkRefusal` but the last exists because a grant link
 * has to be able to run a **Google consent** and say where it leads: a source
 * connection, a Google kind, a destination to name, something to ask for, and
 * a client to ask with. A progress link runs no consent. It renders counts and
 * states, and a Microsoft mapping, an Apple mapping, an IMAP mapping and an
 * archive import all have those — including a mapping that has never run, whose
 * honest answer is "nothing has happened yet" and is exactly what somebody
 * waiting wants to be told.
 *
 * So this is the first surface in the product that can hand a link to somebody
 * being migrated off a NON-Google source. Worth saying plainly: the credential
 * for those still reaches the owner by hand (0114 and 0115 are where that
 * changes). The insight does not have to wait for it.
 *
 * What survives is `web_url_unset`, because a link is nothing but a URL. 0095
 * T3's lesson word for word: one built without a base address goes out looking
 * exactly like a working one.
 */
export function viewLinkRefusal(r: { readonly hasWebUrl: boolean }): GrantLinkRefusal | null {
  if (!r.hasWebUrl) return WEB_URL_UNSET;
  return null;
}

/**
 * The same question from the other side: may this migration RUN yet?
 * (Workplan 0108 T4's named open edge.)
 *
 * A mapping whose migrator has not granted anything has a source it cannot
 * open. Starting it would enqueue a pass that fails at the first request, with
 * an authentication error in a run report — blamed on the provider, days after
 * the owner forgot they were waiting on somebody.
 *
 * ## Why this is DERIVED and not a new `status` value
 *
 * The plan left the question open: *"if it turns out to need a status value of
 * its own, that is a finding for the build."* It does not, and the finding is
 * that adding one would be the more expensive wrong answer.
 * `mailbox_mapping.status` has five values and they are load-bearing in six
 * places — a database CHECK, `MAPPING_LIFECYCLES` in the shared contract that
 * both editions serve, `STATE_TABLE.lifecycle` in the web app, the audit
 * module's `MappingStatus`, `isAfterCutover` (where the deletion detector may
 * not go), and ADR-0014's billing states, where a new value needs a rule about
 * whether it holds a capacity slot. Adding the fifth (`continuous`, workplan
 * 0117 T1) cost exactly that, which is the price this paragraph predicted. And
 * a stored state can go stale: it would have to be set when a link is issued
 * and cleared when a grant lands, so any path that stored a credential without
 * clearing it would leave a mapping permanently unable to start.
 *
 * Waiting-for-a-grant is not a state somebody puts a mapping into. It is the
 * observation *"the credentials this source needs are not here yet"*, and that
 * is true or false from the rows themselves, at the moment it is asked.
 *
 * A service-account key is a legitimate alternative to a granted refresh token
 * (both appear in the Google credential fields), so it satisfies this too:
 * what is refused is having NO way in, never a particular way in.
 */
export function awaitingGrantRefusal(r: {
  readonly sourceKind: string | null;
  readonly hasRefreshToken: boolean;
  readonly hasServiceAccountKey: boolean;
}): string | null {
  if (!isGrantableSourceKind(r.sourceKind)) return null;
  if (r.hasRefreshToken || r.hasServiceAccountKey) return null;
  return (
    'This migration cannot start yet: nobody has connected its Google account. Create a ' +
    'grant link and send it to the person being migrated — they sign in themselves, and ' +
    'their password never reaches you or us. (You can also paste a refresh token on the ' +
    'source connection if the account is one you administer.)'
  );
}
