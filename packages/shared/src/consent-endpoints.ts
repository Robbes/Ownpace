// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE A CONSENT SENDS THE BROWSER (workplan 0163 T4, finding 9).
 *
 * The API builds every consent address on its provider's authorize endpoint,
 * and the web app sends the consent's window there, or offers the address as
 * a link when no window opened (`apps/web/src/services/consent-window.ts`).
 * Since 0163 the web app reads the address first, and follows or links it
 * only when it is `https:` on the host this table names for that provider
 * (`apps/web/src/services/address-to-follow.ts`). Both sides read these
 * constants, so the door that builds the address and the screen that follows
 * it cannot disagree about a host, as `CONSENT_STATE_TTL_MS` keeps them
 * agreeing about a time.
 *
 * Google's and Dropbox's authorize endpoints moved here from `apps/api`'s
 * consent modules on 2026-11-21. Their token endpoints stay there: only the
 * server calls them. Microsoft's endpoint is per tenant and stays in
 * `microsoft-scopes.ts`, and Cirrux's in `cirrux-drive.ts`; their hosts are
 * read from there.
 */

import { CIRRUX_AUTHORIZE_ENDPOINT } from './cirrux-drive.ts';
import { microsoftAuthEndpoint } from './microsoft-scopes.ts';
import type { GrantProvider } from './provider-clients.ts';

/** Google's consent screen. */
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Dropbox's. */
export const DROPBOX_AUTH_ENDPOINT = 'https://www.dropbox.com/oauth2/authorize';

/**
 * The host each provider's consent address is on: the three whose consent
 * mints a token for a form (`GrantProvider`), and Cirrux Drive's sign-in,
 * which the server stores on the account it was begun for (workplan 0160 T5).
 */
export const CONSENT_HOSTS: Readonly<Record<GrantProvider | 'cirrux', string>> = {
  google: new URL(GOOGLE_AUTH_ENDPOINT).host,
  dropbox: new URL(DROPBOX_AUTH_ENDPOINT).host,
  // Whichever directory the consent names, the authority is this one host.
  microsoft: new URL(microsoftAuthEndpoint('common')).host,
  cirrux: new URL(CIRRUX_AUTHORIZE_ENDPOINT).host,
};
