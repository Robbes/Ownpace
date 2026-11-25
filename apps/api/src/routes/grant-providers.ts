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
 * - **Apple** (0174 T3, T4) is in the id type, so the web's list and the
 *   routes can name it, and has no entry until its task adds one: a provider
 *   without an entry is never grantable.
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
  dropboxDeploymentClient,
  googleDeploymentClient,
  microsoftDeploymentClient,
  type Bilingual,
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
import type { SignedInAccount } from './migrations/signed-in-account.ts';

export type { SignedInAccount } from './migrations/signed-in-account.ts';

/** Every provider a grant link is designed for (§3.2); not all of them have an entry yet. */
export const GRANT_PROVIDER_IDS = ['google', 'microsoft', 'dropbox', 'apple'] as const;
export type GrantProviderId = (typeof GRANT_PROVIDER_IDS)[number];

/** Whether a string is one of the provider ids, for a route parameter. */
export function isGrantProviderId(value: unknown): value is GrantProviderId {
  return typeof value === 'string' && (GRANT_PROVIDER_IDS as readonly string[]).includes(value);
}

/** What a deployment carries that decides which providers it serves. Booleans only. */
export interface DeploymentFacts {
  readonly googleClient: boolean;
  readonly microsoftClient: boolean;
  /** Whether it carries a whole Dropbox app (workplan 0174 §6). */
  readonly dropboxClient: boolean;
}

/** The facts, read from the environment once; values never leave this function. */
export function deploymentFacts(
  env: GoogleClientEnv & MicrosoftClientEnv & DropboxClientEnv = process.env,
): DeploymentFacts {
  return {
    googleClient: googleDeploymentClient(env) !== null,
    microsoftClient: microsoftDeploymentClient(env) !== null,
    dropboxClient: dropboxDeploymentClient(env) !== null,
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
  /** The `connection.kind`s a link of this provider can connect. */
  readonly sourceKinds: ReadonlySet<string>;
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
  }) => string;
  /** OAuth providers: the code exchanged, and the account that actually signed in. */
  readonly finish?: (code: string, redirectUri: string, client: GrantClient) => Promise<GrantFinish>;
  /** Apple (T5): a password tried against the provider before it is stored. */
  readonly tryPassword?: (
    account: string,
    password: string,
  ) => Promise<{ readonly secret: StoredSourceSecret } | { readonly refused: string }>;
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

/** The entries, by id. Apple joins with workplan 0174's password tasks. */
export const GRANT_PROVIDERS: Readonly<Partial<Record<GrantProviderId, GrantProvider>>> = {
  google: GOOGLE,
  microsoft: MICROSOFT,
  dropbox: DROPBOX,
};

/** The provider whose link connects this `connection.kind`, or null. Own entries only. */
export function grantProviderOfKind(kind: string | null | undefined): GrantProvider | null {
  if (!kind) return null;
  for (const provider of Object.values(GRANT_PROVIDERS)) {
    if (provider?.sourceKinds.has(kind)) return provider;
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
