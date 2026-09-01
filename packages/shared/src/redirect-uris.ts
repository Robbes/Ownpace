// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY ADDRESS THIS DEPLOYMENT NEEDS REGISTERED SOMEWHERE ELSE.
 *
 * ## Why this exists
 *
 * On 2026-09-01 the owner registered
 * `https://app.ota.ownpace.eu/api/migrations/google/callback` at Google — the
 * right string — pressed Connect with Google, and got
 * `redirect_uri_mismatch`, because `API_URL` was still the example's
 * `http://localhost:3001` and the app had asked for a different address than
 * the one he had registered. His response was the useful one:
 *
 *   *"i can simply change the callback in the console portal. what should it
 *   be? we will probably have more other callbacks to fetch, like for Dropbox,
 *   box, o365, who knows?… make the surface understandable."*
 *
 * He is right that the shape recurs, and right that nothing said so. These
 * addresses live in four different consoles, look almost identical, and are
 * each wrong in a way that produces the same unhelpful sentence from a
 * different vendor.
 *
 * ## What makes this trustworthy rather than a second list to maintain
 *
 * **Every URI is DERIVED from the same configuration the code uses.** The
 * Google callback is built here exactly as `callbackUri` builds it, from
 * `API_URL`; the sign-in pair from `WEB_URL`, which is what `setup-zitadel.sh`
 * registers; the social one from `IDP_UPSTREAM_CALLBACK_URL`, which the
 * identity-provider setup script writes because only it knows that path. A documented list would have gone stale the first time somebody
 * moved a host — this cannot, because a wrong value here is the same wrong
 * value the product will send.
 *
 * ## And the entries that need NOTHING are entries too
 *
 * "We will probably have more, like Dropbox, Box, O365" deserves the real
 * answer, which is *no, not those*: they authenticate with a refresh token or
 * client credentials that a person pastes, and no browser is ever redirected
 * back. A surface that silently omits them leaves somebody hunting a Dropbox
 * redirect setting that does not exist. So they are listed, with `uri: null`
 * and the reason.
 *
 * ## It names no secret
 *
 * Every value here is an address that is, by construction, published to a
 * provider and typed into a browser's location bar. There is nothing in this
 * module that could not appear in a screenshot — which is what makes it safe
 * to render on a screen an operator will photograph and paste into a console.
 */

/** Where a URI has to be registered, and by whom. */
export type RedirectUriGroup = 'migration' | 'signIn' | 'socialSignIn';

export interface RedirectUriEntry {
  /** Stable key — the UI's translation key and the tests' handle. */
  readonly id: string;
  readonly group: RedirectUriGroup;
  /** The provider whose console this is registered in. */
  readonly provider: string;
  /**
   * The exact string to register, or null when this provider needs none.
   * Null is an ANSWER and is rendered as one: "no redirect URI, and here is
   * why" saves somebody hunting a setting that does not exist.
   */
  readonly uri: string | null;
  /** Why it exists, in one sentence a person can check against. */
  readonly why: string;
  /**
   * True when the value it was built from is missing, so the string on screen
   * is a guess rather than this deployment's answer. Never hidden: a plausible
   * wrong address registered at a provider is worse than a gap.
   */
  readonly unconfigured?: boolean;
}

export interface RedirectUriEnv {
  readonly API_URL?: string | undefined;
  readonly WEB_URL?: string | undefined;
  /**
   * The identity provider's OWN upstream callback — where Google, Microsoft,
   * GitHub or Apple return the browser during a social sign-in. Written by the
   * identity-provider setup script beside the four variables that make the
   * issuer swappable (ADR-0042), and read here as a value: its path shape
   * belongs to whichever provider is deployed, and composing it in shipped
   * source would pin the product to one — the exact decay
   * `no-issuer-lock-in.unit.test.ts` exists to catch, and did.
   */
  readonly IDP_UPSTREAM_CALLBACK_URL?: string | undefined;
}

const origin = (raw: string | undefined): string | null => {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  return trimmed === '' ? null : trimmed;
};

/**
 * Every address, in the order somebody sets a deployment up.
 *
 * Migration sources first, because that is the one a customer reaches on their
 * own; sign-in second; the social upstreams last, because they are optional and
 * because they are the only ones registered in somebody ELSE'S console against
 * an address that is not ours.
 */
export function redirectUris(env: RedirectUriEnv = process.env): ReadonlyArray<RedirectUriEntry> {
  const api = origin(env.API_URL);
  const web = origin(env.WEB_URL);
  const upstream = origin(env.IDP_UPSTREAM_CALLBACK_URL);

  return [
    {
      id: 'google.migration',
      group: 'migration',
      provider: 'Google Cloud Console → Credentials → your OAuth client → Authorised redirect URIs',
      // Built the way `callbackUri` builds it, from the same variable, so the
      // two cannot say different things.
      uri: api === null ? null : `${api}/api/migrations/google/callback`,
      unconfigured: api === null,
      why:
        'Where Google returns the browser after somebody approves a Gmail, Calendar, ' +
        'Contacts, Drive or Google-account consent. Built from API_URL — the address this ' +
        'API is reached at from OUTSIDE, which with the default VITE_API_URL=/api is the ' +
        'same origin as the app.',
    },
    {
      id: 'dropbox.migration',
      group: 'migration',
      provider: 'Dropbox App Console',
      uri: null,
      why:
        'None. A Dropbox source authenticates with an App key, App secret and a refresh ' +
        'token typed into the wizard — no browser is redirected back here, so there is no ' +
        'redirect URI to register.',
    },
    {
      id: 'box.migration',
      group: 'migration',
      provider: 'Box Developer Console',
      uri: null,
      why:
        'None. Box uses the Client Credentials Grant: a client id, a client secret and the ' +
        'subject user id. Nothing redirects.',
    },
    {
      id: 'o365.migration',
      group: 'migration',
      provider: 'Entra ID → App registrations',
      uri: null,
      why:
        'None. A Microsoft 365 source uses an app registration with either application ' +
        'permissions or a refresh token minted once by the customer. No redirect comes back ' +
        'to this deployment.',
    },
    {
      id: 'app.signIn',
      group: 'signIn',
      provider: 'your identity provider — the setup script registers it for the bundled one',
      uri: web === null ? null : `${web}/auth/callback`,
      unconfigured: web === null,
      why:
        'Where the identity provider returns the browser after somebody signs in. Built ' +
        'from WEB_URL. The identity-provider setup script registers it and reconciles it on ' +
        'every re-run, so this is here to CHECK rather than to type.',
    },
    {
      id: 'app.signOut',
      group: 'signIn',
      provider: 'your identity provider — post-logout redirect URIs',
      uri: web === null ? null : `${web}/login`,
      unconfigured: web === null,
      why:
        'Where the provider returns after ending its own session. Unregistered, the sign-out ' +
        'still happens and the person lands on the provider’s page instead of back here.',
    },
    {
      id: 'social.upstream',
      group: 'socialSignIn',
      provider: 'Google, Microsoft, GitHub or Apple — each provider’s own OAuth client',
      // THE IDENTITY PROVIDER'S ADDRESS, NOT OURS, and that is the whole point
      // of listing it: a social sign-in redirects to the identity provider,
      // which then redirects here. Somebody registering the app's address at
      // Google instead is the mistake this line prevents.
      //
      // Read as a VALUE, never composed: the path shape is the deployed
      // provider's own, and writing it here would pin the product to one
      // (ADR-0042). The setup script that knows the provider writes it.
      uri: upstream,
      unconfigured: upstream === null,
      why:
        'Only if you offer social sign-in. This is the IDENTITY PROVIDER’S address, not ' +
        'this app’s: the upstream returns to the provider, which then returns to the app ' +
        'using the sign-in URI above. Written by the provider’s setup script as ' +
        'IDP_UPSTREAM_CALLBACK_URL; some upstreams (Apple) want a variant the script also ' +
        'prints.',
    },
  ];
}
