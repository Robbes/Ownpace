// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE GRANT-LINK PROVIDERS, one entry each (workplan 0171 §3.2, T3).
 *
 * Until alpha.20 a grant link was Google's on three layers: the web offered
 * one for Google's cards only, the readiness check refused every other source
 * (`source_not_google`), and the page followed Google's consent only. This
 * file is the one place that says which providers a link can connect, which
 * source kinds each one covers, whether this deployment serves it, and how its
 * consent begins and ends. The three layers ask it, so a fourth provider is an
 * entry here, not a branch in each.
 *
 * ## What is in the seam, and what is not yet
 *
 * - **Google** keeps its own ending in `google-oauth-routes.ts`, unchanged:
 *   its refusal codes, `include_granted_scopes` and the recorded permission
 *   predate the seam, and moving them would change what is proven of them.
 *   Its entry names its kinds, when it is served, and its consent URL.
 * - **Microsoft** is built here (§3.3): its consent bound to the named account
 *   with `login_hint`, and its ending, which exchanges the code and asks
 *   Microsoft who signed in (`microsoft-signed-in-account.ts`).
 * - **Dropbox** is built here since alpha.21 (workplan 0174 §6, superseding
 *   0171 T4): its consent as the owner's own Connect with Dropbox asks it
 *   (Dropbox takes no login hint), and its ending, which exchanges the code
 *   and asks Dropbox who signed in (`dropboxSignedInAccount`).
 * - **Cirrux** (0174 T5) is a DESTINATION's sign-in, its Drive: the one
 *   entry with `targetKinds`, bound by the workspace (its entry says why).
 * - **Apple** stays in the id type for the web's list, and never has an
 *   entry: since 0174 it is the `apple` password kind (below), not a sign-in.
 *
 * ## Two ways in, two roles (workplan 0174 §3, §4.1, §5.1, T1)
 *
 * A link asks for ACCOUNTS: each has a role (`source` or `target`) and a way
 * (`sign-in` or `password`). A sign-in entry names the kinds it covers per
 * role (`sourceKinds`, `targetKinds`). Every kind whose credential is a
 * password, sources and destinations, is a password kind
 * (`PASSWORD_SOURCE_KINDS`, `PASSWORD_TARGET_KINDS`) with a `PasswordGrant`:
 * what the person fills, from the one field table (`credentialFieldsFor`),
 * and the test the create door runs (`password-test.ts`, 0174 T3). The two lists are held to
 * that table by `every-password-kind-has-a-link.unit.test.ts`.
 *
 * ## Two additions to the interface the plan fixed (§3.2)
 *
 * `consentUrl` and `finish` also take the client the consent runs against
 * (and Microsoft's directory), since the pending state holds them and the
 * plan's signature had nowhere to put them; and `finish` answers a refusal as
 * well as a success, because a code exchange can be refused and the ending
 * must say so in the person's language. Both are said in the pull request.
 */

import {
  CIRRUX_DRIVE_GRANT_KEY,
  CIRRUX_DRIVE_WORKSPACE_KEY,
  isPasswordKind,
  type PasswordKind,
  cirruxDeploymentClient,
  credentialFieldsFor,
  dropboxDeploymentClient,
  googleDeploymentClient,
  microsoftDeploymentClient,
  publishedEndpoint,
  signsInToMailApart,
  type Bilingual,
  type CirruxClientEnv,
  type DiscoveryDomain,
  type DropboxClientEnv,
  type GoogleClientEnv,
  type MicrosoftClientEnv,
} from '@openmig/shared';
import { dropboxConsentUrl, dropboxSignedInAccount, exchangeDropboxCode } from './migrations/dropbox-consent.ts';
import { consentUrl as googleConsentUrl } from './migrations/google-consent.ts';
import {
  exchangeMicrosoftCode,
  microsoftConsentUrl,
  microsoftDomainHint,
} from './migrations/microsoft-consent.ts';
import { microsoftSignedInAccount } from './migrations/microsoft-signed-in-account.ts';
import { cirruxConsentUrl, cirruxSignedInAs, exchangeCirruxCode } from './migrations/cirrux-consent.ts';
import type { SignedInAccount } from './migrations/signed-in-account.ts';
import { testPassword } from './password-test.ts';
import { probeAnswers } from '../probe-answer.ts';

export type { SignedInAccount } from './migrations/signed-in-account.ts';

/**
 * Every sign-in provider a grant link is designed for (0171 §3.2, 0174 §4.4);
 * not all of them have an entry yet. `apple` never will: it is a password
 * kind (0174 §5.1), kept here only because the web's list names it.
 */
export const GRANT_PROVIDER_IDS = ['google', 'microsoft', 'dropbox', 'apple', 'cirrux'] as const;
export type GrantProviderId = (typeof GRANT_PROVIDER_IDS)[number];

/** Whether a string is one of the provider ids, for a route parameter. */
export function isGrantProviderId(value: unknown): value is GrantProviderId {
  return typeof value === 'string' && (GRANT_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Which side of a migration an account on a link is (workplan 0174 §4.1). */
export type GrantRole = 'source' | 'target';

/** How the person gives a way in: a provider's sign-in, or their own password (0174 §3). */
export type GrantWay = 'sign-in' | 'password';

/** What a deployment carries that decides which providers it serves. Booleans only. */
export interface DeploymentFacts {
  readonly googleClient: boolean;
  readonly microsoftClient: boolean;
  /** A whole Dropbox app (`dropboxDeploymentClient`; 0174 T2 reads it). */
  readonly dropboxClient: boolean;
  /** A Cirrux public client (`cirruxDeploymentClient`; 0174 T5 reads it). */
  readonly cirruxClient: boolean;
}

/** The facts, read from the environment once; values never leave this function. */
export function deploymentFacts(
  env: GoogleClientEnv & MicrosoftClientEnv & DropboxClientEnv & CirruxClientEnv = process.env,
): DeploymentFacts {
  return {
    googleClient: googleDeploymentClient(env) !== null,
    microsoftClient: microsoftDeploymentClient(env) !== null,
    dropboxClient: dropboxDeploymentClient(env) !== null,
    cirruxClient: cirruxDeploymentClient(env) !== null,
  };
}

/** What a grant stores on the migration: the person's half, never the owner's client. */
export type StoredSourceSecret = Readonly<Record<string, string>>;

/** The application a consent runs against, as the pending state holds it. */
export interface GrantClient {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Microsoft's directory; absent for every other provider. */
  readonly tenant?: string;
}

/** How a provider's ending answered. */
export type GrantFinish =
  | {
      readonly ok: true;
      readonly secret: StoredSourceSecret;
      /** Null when the provider did not vouch for an account: nothing may be stored. */
      readonly signedInAs: SignedInAccount | null;
      readonly grantedScopes: ReadonlyArray<string>;
      /**
       * The first access token, when the ending may use it to measure what
       * was granted without spending a refresh (Cirrux's rotate, 0160 T5;
       * added by 0174 T5). Never stored: `secret` is what is stored.
       */
      readonly access?: { readonly accessToken: string; readonly expiresAt: number };
      /** Who signed in, for the page, when the provider names no address (Cirrux's login and workspace). */
      readonly shownAs?: { readonly username?: string; readonly workspace?: string };
    }
  | {
      readonly ok: false;
      /** For the server log only: the provider's own answer, bounded. */
      readonly reason: string;
      /** For the page: the sentence, or the provider's policy refusal as written. */
      readonly said: Bilingual | string;
    };

export interface GrantProvider {
  readonly id: GrantProviderId;
  /** The source `connection.kind`s a link of this provider can connect. */
  readonly sourceKinds: ReadonlySet<string>;
  /**
   * The destination `connection.kind`s it can connect (0174 §4.4): Cirrux
   * Drive's, once T5 adds its entry. Empty for every source provider.
   */
  readonly targetKinds: ReadonlySet<string>;
  /**
   * Whether this deployment can serve a link for it with its OWN application,
   * which is what the wizard needs before it offers a link for an account
   * saved for somebody else (that account holds no client of its own). A
   * connection that carries its own pair can still be granted by link; the
   * readiness check decides that per migration.
   */
  readonly served: (facts: DeploymentFacts) => boolean;
  /** OAuth providers: the consent URL, bound to the named account. */
  readonly consentUrl?: (a: {
    readonly account: string;
    readonly state: string;
    readonly redirectUri: string;
    readonly locale: string;
    readonly client: GrantClient;
    /** The scope string the readiness check decided, space-joined. */
    readonly scope: string;
    /** The data types the link asks for. */
    readonly domains: ReadonlyArray<string>;
    /** PKCE's `S256` challenge, for a provider that requires it (Cirrux; 0174 T5). */
    readonly challenge?: string;
  }) => string;
  /**
   * OAuth providers: the code exchanged, and the account that actually signed
   * in. `verifier` is PKCE's, held in the server's pending state, for a
   * provider that requires it (Cirrux; 0174 T5).
   */
  readonly finish?: (code: string, redirectUri: string, client: GrantClient, verifier?: string) => Promise<GrantFinish>;
}

/** The Google kinds: the account and the four single-purpose ones (0108 T7). */
const GOOGLE_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'google',
  'gmail',
  'google_calendar',
  'google_contacts',
  'google_drive',
]);

const GOOGLE: GrantProvider = {
  id: 'google',
  sourceKinds: GOOGLE_SOURCE_KINDS,
  targetKinds: new Set(),
  served: (facts) => facts.googleClient,
  consentUrl: (a) =>
    googleConsentUrl({
      clientId: a.client.clientId,
      scope: a.scope,
      redirectUri: a.redirectUri,
      state: a.state,
      loginHint: a.account,
    }),
  // The ending stays in `google-oauth-routes.ts` (see the header).
};

/**
 * Microsoft, personal and work (§3.3). The Microsoft ACCOUNT kind only: `o365`
 * is a company's own Entra registration with application permissions, which
 * no person grants by signing in.
 */
const MICROSOFT: GrantProvider = {
  id: 'microsoft',
  sourceKinds: new Set(['microsoft']),
  targetKinds: new Set(),
  served: (facts) => facts.microsoftClient,
  consentUrl: (a) =>
    microsoftConsentUrl({
      clientId: a.client.clientId,
      tenant: a.client.tenant ?? 'common',
      redirectUri: a.redirectUri,
      state: a.state,
      domains: a.domains,
      loginHint: a.account,
      domainHint: microsoftDomainHint(a.account),
    }),
  finish: async (code, redirectUri, client) => {
    const tenant = client.tenant ?? 'common';
    const exchanged = await exchangeMicrosoftCode({
      code,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      tenant,
      redirectUri,
      // A link holder can change no registration; the sentence for the
      // deployment's is the one that tells them to forward it.
      whose: client.clientId === microsoftDeploymentClient()?.clientId ? 'deployment' : 'connection',
    });
    if (!exchanged.ok) return { ok: false, reason: exchanged.reason, said: exchanged.said };
    const signedInAs = await microsoftSignedInAccount({
      idToken: exchanged.idToken,
      accessToken: exchanged.accessToken,
      clientId: client.clientId,
    });
    return {
      ok: true,
      // Today's Microsoft secret: the refresh token, with the directory it
      // was granted at, so a pass refreshes it at the same authority.
      secret: { refreshToken: exchanged.refreshToken, tenantId: tenant },
      signedInAs,
      grantedScopes: exchanged.grantedScopes,
    };
  },
};

/**
 * Dropbox (workplan 0174 §6, as 0171 §3.5 designed it). The consent is the
 * owner's own Connect with Dropbox URL: `token_access_type=offline`, the read
 * scopes and `account_info.read`, which `get_current_account` needs. Dropbox
 * takes no login hint, so the named account is not offered first; the ending
 * is what binds the grant to it. The secret stored is the refresh token alone,
 * as the owner's own connect stores it; the App key and secret stay on the
 * connection or the deployment.
 */
const DROPBOX: GrantProvider = {
  id: 'dropbox',
  sourceKinds: new Set(['dropbox']),
  targetKinds: new Set(),
  served: (facts) => facts.dropboxClient,
  consentUrl: (a) => dropboxConsentUrl({ clientId: a.client.clientId, redirectUri: a.redirectUri, state: a.state }),
  finish: async (code, redirectUri, client) => {
    const exchanged = await exchangeDropboxCode({
      code,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUri,
    });
    if (!exchanged.ok) return { ok: false, reason: exchanged.reason, said: exchanged.said };
    const signedInAs = await dropboxSignedInAccount({ accessToken: exchanged.accessToken });
    return {
      ok: true,
      secret: { refreshToken: exchanged.refreshToken },
      signedInAs,
      grantedScopes: exchanged.grantedScopes,
    };
  },
};

/**
 * Cirrux Drive, a DESTINATION's sign-in (workplan 0174 §4.4, T5; ADR-0052).
 *
 * The account's app password reaches Cirrux's mail and DAV servers; its Drive
 * is reached only through Cirrux's API, with the account holder's own
 * sign-in. A public client with PKCE: no secret, the verifier kept in the
 * server's pending state and handed to `finish`.
 *
 * Cirrux names no address on a sign-in, only the login and the workspace
 * (`https://cirrux.co/help/api/user`, read 2026-11-25), so `signedInAs` is
 * null and the ending binds the grant by the WORKSPACE instead: the secret
 * carries the workspace's `uuid` beside the refresh token, and the store
 * refuses a grant that reached another workspace than the one recorded on the
 * account (`storeCirruxDriveGrantIn`). A sign-in whose workspace Cirrux did
 * not name is refused here: nothing could be bound.
 */
const CIRRUX: GrantProvider = {
  id: 'cirrux',
  sourceKinds: new Set(),
  targetKinds: new Set(['cirrux']),
  served: (facts) => facts.cirruxClient,
  consentUrl: (a) =>
    cirruxConsentUrl({
      clientId: a.client.clientId,
      redirectUri: a.redirectUri,
      state: a.state,
      challenge: a.challenge ?? '',
    }),
  finish: async (code, redirectUri, client, verifier) => {
    if (!verifier) {
      return {
        ok: false,
        reason: 'a Cirrux consent ended with no PKCE verifier in its pending state',
        said: CIRRUX_NOT_NAMED,
      };
    }
    const exchanged = await exchangeCirruxCode({ code, verifier, clientId: client.clientId, redirectUri });
    if (!exchanged.ok) return { ok: false, reason: exchanged.reason, said: exchanged.said };
    const who = await cirruxSignedInAs(exchanged.accessToken);
    if (!who?.workspaceId) {
      return {
        ok: false,
        reason: 'Cirrux answered /user/profile with no workspace uuid, so the Drive grant could not be bound',
        said: CIRRUX_NOT_NAMED,
      };
    }
    return {
      ok: true,
      secret: { [CIRRUX_DRIVE_GRANT_KEY]: exchanged.refreshToken, [CIRRUX_DRIVE_WORKSPACE_KEY]: who.workspaceId },
      signedInAs: null,
      grantedScopes: [],
      access: { accessToken: exchanged.accessToken, expiresAt: exchanged.accessExpiresAt },
      shownAs: {
        ...(who.username === undefined ? {} : { username: who.username }),
        ...(who.workspace === undefined ? {} : { workspace: who.workspace }),
      },
    };
  },
};

/** When Cirrux did not say which workspace signed in, so nothing could be bound. */
const CIRRUX_NOT_NAMED: Bilingual = {
  en: 'Cirrux did not say which workspace you signed in to, so nothing was stored. Press Connect Cirrux Drive again.',
  nl: 'Cirrux zei niet bij welke werkruimte u zich aanmeldde, dus er is niets opgeslagen. Druk opnieuw op Cirrux Drive verbinden.',
};

/** The entries, by id. Apple is a password kind, never an entry. */
export const GRANT_PROVIDERS: Readonly<Partial<Record<GrantProviderId, GrantProvider>>> = {
  google: GOOGLE,
  microsoft: MICROSOFT,
  dropbox: DROPBOX,
  cirrux: CIRRUX,
};

/**
 * The sign-in provider whose link connects this `connection.kind` in this
 * role, or null. Own entries only. The role defaults to `source`, which is
 * every question asked before 0174.
 */
export function grantProviderOfKind(
  kind: string | null | undefined,
  role: GrantRole = 'source',
): GrantProvider | null {
  if (!kind) return null;
  for (const provider of Object.values(GRANT_PROVIDERS)) {
    const kinds = role === 'source' ? provider?.sourceKinds : provider?.targetKinds;
    if (kinds?.has(kind)) return provider;
  }
  return null;
}

/** The providers this deployment serves with its own application, in the ids' order. */
export function servedGrantProviders(facts: DeploymentFacts): GrantProviderId[] {
  return GRANT_PROVIDER_IDS.filter((id) => GRANT_PROVIDERS[id]?.served(facts) === true);
}

/** Every provider with an entry, for a sentence that names them. */
export function grantProvidersWithEntries(): GrantProviderId[] {
  return GRANT_PROVIDER_IDS.filter((id) => GRANT_PROVIDERS[id] !== undefined);
}


// ========================= The password kinds (workplan 0174 §5.1) =========================

// The two lists, and `isPasswordKind`, live in `@openmig/shared` so the screens
// read the same ones (*Start a migration*'s `grantableByLink`, the create
// door's `forPerson`, 0174 T6); the seam re-exports them unchanged.
export { PASSWORD_SOURCE_KINDS, PASSWORD_TARGET_KINDS, isPasswordKind, type PasswordKind } from '@openmig/shared';

/**
 * One box or one shown value on the person's password card (0174 §5.2, D2).
 *
 * The owner fixes where and who (`who: 'owner'`, shown with its `value`, never
 * a box); the person types the secret, and only what the provider says only
 * they can know (`who: 'person'`). Labels, hints and autofill are the field
 * table's own, so the card and the owner's form cannot word one field two
 * ways. A secret never carries a `value`.
 */
export interface PersonField {
  readonly key: string;
  readonly who: 'person' | 'owner';
  readonly labelKey: string;
  readonly hintKey?: string;
  readonly placeholder?: string;
  readonly secret: boolean;
  readonly autoComplete?: 'username' | 'new-password' | 'off';
  readonly revealable?: boolean;
  /** An owner's field only: the value as the owner saved it. */
  readonly value?: string;
}

/**
 * Where a password will be tried (0174 §5.8, D3): the hosts, and whether
 * they are the provider's published ones (Apple's today), which the page
 * names as the provider's own. The registrable-domain and MX comparison of
 * D3's addition joins as optional fields (T3, `grant-server-domain.ts`),
 * answered on the page's read.
 */
export interface GrantServer {
  readonly hosts: ReadonlyArray<string>;
  readonly published: boolean;
  /** Each host's registrable domain, in `hosts`' order: what the page sets in bold. */
  readonly domains?: ReadonlyArray<string>;
  /**
   * D3's addition: the hosts whose registrable domain is neither the
   * address's own nor one of its MX hosts'. The page warns beside each; never
   * a refusal. Empty when every host matches; absent when no comparison was
   * made (a published server, an account that is no address, or an MX
   * lookup that failed, which says nothing either way).
   */
  readonly notTheAddressMail?: ReadonlyArray<string>;
}

/** What the test is handed (0174 §5.4): the merged config and credentials, never a second reading. */
export interface PasswordTestInput {
  readonly role: GrantRole;
  readonly kind: PasswordKind;
  /** The owner's config, as stored on the connection (and the migration's override). */
  readonly config: Readonly<Record<string, unknown>>;
  /** The stored credentials with the person's values over them, key by key. */
  readonly credentials: Readonly<Record<string, string>>;
  /** The faces the person's migrations on this account need measured. */
  readonly faces: ReadonlyArray<DiscoveryDomain>;
}

/** How a test answered. The categories are the only words the owner ever sees (0174 §5.7). */
export type PasswordTest =
  | { readonly ok: true; readonly secret: StoredSourceSecret; readonly faces: ReadonlyArray<DiscoveryDomain> }
  | {
      readonly ok: false;
      readonly category: 'refused_login' | 'unreachable' | 'face_missing';
      readonly faces?: ReadonlyArray<DiscoveryDomain>;
    };

/** One password kind in one role, on the seam (0174 §5.1). Replaces 0171's reserved `tryPassword`. */
export interface PasswordGrant {
  readonly role: GrantRole;
  readonly kind: PasswordKind;
  /** The fields the person fills, from `credentialFieldsFor(role, kind)`: secret ones, and the ones §5.2 lets them fill. */
  readonly personFields: (stored: Readonly<Record<string, unknown>>) => ReadonlyArray<PersonField>;
  /** The test: the create door's probe, then the qualification, on the merged config and credentials. */
  readonly test: (a: PasswordTestInput) => Promise<PasswordTest>;
}

/**
 * The non-secret fields the person fills when the owner left them empty
 * (0174 §5.2, D2): Infomaniak's sync username, which only the account holder
 * can read at config.infomaniak.com. Every other non-secret field is the
 * owner's.
 */
const PERSON_MAY_FILL: Readonly<Partial<Record<PasswordKind, ReadonlyArray<string>>>> = {
  infomaniak: ['username'],
};

/** A stored config value as the card shows it, or '' when there is none. */
function shown(stored: Readonly<Record<string, unknown>>, key: string): string {
  const v = stored[key];
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/**
 * The card's fields for one kind in one role, from the field table.
 *
 * A secret is always the person's. The mailbox's own login (a kind that signs
 * in to its mail apart, `MAIL_LOGIN_FIELDS`) is asked only when the owner
 * gave the account a mail server, which the create door demands exactly when
 * mail is copied: an account used for calendars only has no mail password to
 * type. A non-secret field is the owner's, shown when it has a value, and the
 * person's only where `PERSON_MAY_FILL` says so and the owner left it empty.
 */
export function personFieldsFor(
  role: GrantRole,
  kind: PasswordKind,
  stored: Readonly<Record<string, unknown>>,
): ReadonlyArray<PersonField> {
  const mail = shown(stored, 'mailHost') !== '';
  const out: PersonField[] = [];
  for (const f of credentialFieldsFor(role, kind)) {
    if (f.loginPairedWith !== undefined && signsInToMailApart(kind) && !mail) continue;
    const common = {
      key: f.key,
      labelKey: f.labelKey,
      ...(f.hintKey === undefined ? {} : { hintKey: f.hintKey }),
      ...(f.placeholder === undefined ? {} : { placeholder: f.placeholder }),
      ...(f.autoComplete === undefined ? {} : { autoComplete: f.autoComplete }),
      ...(f.revealable === undefined ? {} : { revealable: f.revealable }),
    };
    if (f.secret === true) {
      out.push({ ...common, who: 'person', secret: true });
      continue;
    }
    const value = shown(stored, f.key);
    if (value !== '') out.push({ ...common, who: 'owner', secret: false, value });
    else if (PERSON_MAY_FILL[kind]?.includes(f.key) === true) out.push({ ...common, who: 'person', secret: false });
  }
  return out;
}

/** The host of an address, or null when it is not one. */
function hostOfUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Where this account's password will be tried, from the owner's config, or
 * the provider's published servers for a kind that has them (Apple). Each host
 * once, in the order the faces are read: the DAV address or host, then the
 * mail server.
 */
export function passwordServerOf(kind: PasswordKind, stored: Readonly<Record<string, unknown>>): GrantServer {
  const faces = ['email', 'calendar', 'contact'] as const;
  const published = faces.map((f) => publishedEndpoint(kind, f)?.host).filter((h): h is string => !!h);
  if (published.length > 0) return { hosts: [...new Set(published)], published: true };
  const hosts = [
    hostOfUrl(stored.url),
    shown(stored, 'host') || null,
    shown(stored, 'mailHost') || null,
  ].filter((h): h is string => h !== null);
  return { hosts: [...new Set(hosts)], published: false };
}

/**
 * The test (0174 §5.4, T3): the create door's probe, then the qualification,
 * on the merged config and credentials, in `password-test.ts`. Its refusals
 * are said from their parts under one reference per call (0136 T3).
 */
const TEST: PasswordGrant['test'] = (a) => testPassword(a, probeAnswers('testing a password on a grant link'));

/** The password grant for this kind in this role, or null when it is not a password kind there. */
export function passwordGrantOf(role: GrantRole, kind: string | null | undefined): PasswordGrant | null {
  if (!isPasswordKind(role, kind)) return null;
  return {
    role,
    kind,
    personFields: (stored) => personFieldsFor(role, kind, stored),
    test: TEST,
  };
}
