// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CONNECT CIRRUX DRIVE: the authorization-code flow with PKCE (workplan 0160
 * T5; ADR-0052), built the way `dropbox-consent.ts` built Dropbox's and reusing
 * its state store, its refusal shape and its page headers. What differs is
 * Cirrux's (`https://cirrux.co/help/api`, *Signing people in with OAuth*, read
 * 2026-11-19):
 *
 *  - **A public client, PKCE `S256` required, no secret.** The verifier is made
 *    here, waits in the signed single-use state in process memory, and leaves
 *    only in the token request. The client ID is the deployment's
 *    (`CIRRUX_OAUTH_CLIENT_ID`), one per deployment, registered by Cirrux with
 *    this deployment's exact callback.
 *  - **No `resource` parameter and no `offline_access`**: Cirrux says not to
 *    send the first (it binds MCP tokens, which the API refuses) and always
 *    returns a refresh token without the second.
 *  - **`iss` comes back beside `code` and `state`.** Compared by origin with
 *    Cirrux's own (`CIRRUX_ISSUER_ORIGIN`): a callback naming another issuer is
 *    refused before a code is exchanged.
 *  - **The refresh token never reaches a browser.** It rotates on every
 *    refresh, and the consent began on a stored ACCOUNT, so the callback stores
 *    it on that account itself and tells the opening window only that the
 *    Drive is connected (`cirruxResultPage`, which has no parameter a token
 *    could arrive in).
 *  - **Two sentences per refusal** (the owner, 2026-10-14, for every consent):
 *    `reason` for the server log, with Cirrux's own `error`, and `said` for the
 *    person's page, in both languages.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  CIRRUX_API_BASE,
  CIRRUX_AUTHORIZE_ENDPOINT,
  CIRRUX_DRIVE_SCOPES,
  CIRRUX_ISSUER_ORIGIN,
  CIRRUX_TOKEN_ENDPOINT,
  localeOf,
  type Bilingual,
} from '@openmig/shared';
import type { ConsentLocale } from './google-consent.ts';

/** A PKCE pair: the verifier kept on the server, the `S256` challenge sent in the URL. */
export function pkcePair(): { readonly verifier: string; readonly challenge: string } {
  // 32 random bytes as base64url: 43 characters, inside RFC 7636's 43 to 128.
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}

/** `BASE64URL(SHA256(verifier))`, RFC 7636 §4.2. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Cirrux's consent URL: the scopes, the state, the challenge, and nothing it says not to send. */
export function cirruxConsentUrl(p: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly challenge: string;
}): string {
  const url = new URL(CIRRUX_AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', CIRRUX_DRIVE_SCOPES.join(' '));
  url.searchParams.set('state', p.state);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Is this `iss` Cirrux's? An absent one is accepted, as RFC 9207 lets a client
 * accept a server that does not send it; one naming another origin is not.
 */
export function issuerIsCirrux(iss: string | undefined): boolean {
  if (iss === undefined || iss === '') return true;
  try {
    return new URL(iss).origin === CIRRUX_ISSUER_ORIGIN;
  } catch {
    return false;
  }
}

/** Said after a refusal that is this service's to fix, never the person's. */
const ON_OUR_SIDE = {
  en: 'If it happens again, this is on our side: please contact us.',
  nl: 'Gebeurt het opnieuw, dan ligt het aan ons: neem contact met ons op.',
} as const;

/** What the person reads for each way Connect Cirrux Drive can fail. */
export const CIRRUX_CONSENT_FOR_THE_OWNER = {
  refused: {
    en: `Cirrux did not accept the sign-in when it came back, so nothing was stored. This happens when it took too long or was sent twice: press Connect Cirrux Drive again. ${ON_OUR_SIDE.en}`,
    nl: `Cirrux accepteerde de aanmelding niet toen die terugkwam, dus er is niets opgeslagen. Dat gebeurt als het te lang duurde of als die twee keer is verstuurd: druk opnieuw op Cirrux Drive verbinden. ${ON_OUR_SIDE.nl}`,
  },
  unreachable: {
    en: 'Cirrux could not be reached to finish the sign-in, so nothing was stored. Press Connect Cirrux Drive again in a moment.',
    nl: 'Cirrux was niet bereikbaar om de aanmelding af te ronden, dus er is niets opgeslagen. Druk zo dadelijk opnieuw op Cirrux Drive verbinden.',
  },
  unreadable: {
    en: `Cirrux sent back an answer we could not read, so nothing was stored. Press Connect Cirrux Drive again. ${ON_OUR_SIDE.en}`,
    nl: `Cirrux stuurde een antwoord terug dat wij niet konden lezen, dus er is niets opgeslagen. Druk opnieuw op Cirrux Drive verbinden. ${ON_OUR_SIDE.nl}`,
  },
  noRefreshToken: {
    en: `Cirrux did not give lasting access, so nothing was stored: without it, no migration could reach your Drive between your visits. Press Connect Cirrux Drive again. ${ON_OUR_SIDE.en}`,
    nl: `Cirrux gaf geen blijvende toegang, dus er is niets opgeslagen: zonder die toegang kan geen migratie uw Drive bereiken als u er niet bent. Druk opnieuw op Cirrux Drive verbinden. ${ON_OUR_SIDE.nl}`,
  },
  scopeMissing: {
    en: 'Cirrux gave less access than a migration into your Drive needs, so nothing was stored. Press Connect Cirrux Drive again and allow everything Cirrux asks about.',
    nl: 'Cirrux gaf minder toegang dan een migratie naar uw Drive nodig heeft, dus er is niets opgeslagen. Druk opnieuw op Cirrux Drive verbinden en sta alles toe wat Cirrux vraagt.',
  },
  wrongIssuer: {
    en: `The answer that came back was not from Cirrux, so nothing was stored. Press Connect Cirrux Drive again. ${ON_OUR_SIDE.en}`,
    nl: `Het antwoord dat terugkwam was niet van Cirrux, dus er is niets opgeslagen. Druk opnieuw op Cirrux Drive verbinden. ${ON_OUR_SIDE.nl}`,
  },
  noAccount: {
    en: 'The Cirrux account this sign-in was for is not on your Accounts page any more, so nothing was stored.',
    nl: 'Het Cirrux-account waarvoor deze aanmelding was, staat niet meer op uw pagina Accounts, dus er is niets opgeslagen.',
  },
  notStored: {
    en: `Cirrux accepted the sign-in, and something on our side went wrong storing it, so nothing was kept and Cirrux Drive is not connected. Press Connect Cirrux Drive again. ${ON_OUR_SIDE.en}`,
    nl: `Cirrux accepteerde de aanmelding, en bij ons ging er iets mis met het opslaan, dus er is niets bewaard en Cirrux Drive is niet verbonden. Druk opnieuw op Cirrux Drive verbinden. ${ON_OUR_SIDE.nl}`,
  },
} as const satisfies Readonly<Record<string, Bilingual>>;

/** The audit action a Drive grant stored on a Cirrux account is recorded under (ADR-0052, decision 7). */
export const CIRRUX_DRIVE_CONNECTED_ACTION = 'connection.cirrux_drive_connected';

/** The audit action *Disconnect Cirrux Drive* is recorded under, when it removed a grant (workplan 0160). */
export const CIRRUX_DRIVE_DISCONNECTED_ACTION = 'connection.cirrux_drive_disconnected';

/** Scopes a migration into Drive cannot run without: listing, creating and replacing. */
export const CIRRUX_REQUIRED_SCOPES: ReadonlyArray<string> = ['drive.read', 'drive.create', 'drive.update'];

export type CirruxExchangeResult =
  | {
      readonly ok: true;
      readonly refreshToken: string;
      readonly accessToken: string;
      /** When the access token stops working, epoch milliseconds: `expires_in`, or Cirrux's 15 minutes. */
      readonly accessExpiresAt: number;
    }
  | { readonly ok: false; readonly reason: string; readonly said: Bilingual };

/**
 * Exchange the authorization code, with the verifier, for the first tokens.
 *
 * The token answer's fields are not listed on Cirrux's page; RFC 6749's are
 * read (`access_token`, `refresh_token`, `scope`). A `scope` that is present
 * and lacks one a migration needs is refused by name; an absent one is not
 * guessed at, and the Test measures what the grant reaches.
 */
export async function exchangeCirruxCode(
  p: { readonly code: string; readonly verifier: string; readonly clientId: string; readonly redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CirruxExchangeResult> {
  let response: Response;
  try {
    response = await fetchImpl(CIRRUX_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: p.code,
        code_verifier: p.verifier,
        redirect_uri: p.redirectUri,
        client_id: p.clientId,
      }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Cirrux's token endpoint could not be reached: ${err instanceof Error ? err.message : String(err)}`,
      said: CIRRUX_CONSENT_FOR_THE_OWNER.unreachable,
    };
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    // Cirrux's words, bounded, for the log. They never echo the verifier.
    return {
      ok: false,
      reason: `Cirrux refused the code exchange (${response.status}): ${text.slice(0, 300)}`,
      said: CIRRUX_CONSENT_FOR_THE_OWNER.refused,
    };
  }
  let json: { access_token?: unknown; refresh_token?: unknown; scope?: unknown; expires_in?: unknown };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return {
      ok: false,
      reason: `Cirrux answered the code exchange with something that is not JSON (${response.status}).`,
      said: CIRRUX_CONSENT_FOR_THE_OWNER.unreadable,
    };
  }
  if (typeof json.scope === 'string') {
    const granted = json.scope.split(/\s+/).filter(Boolean);
    const missing = CIRRUX_REQUIRED_SCOPES.filter((s) => !granted.includes(s));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `Cirrux granted less than a migration into Drive needs: missing ${missing.join(' ')}; granted ${granted.join(' ') || '(nothing)'}.`,
        said: CIRRUX_CONSENT_FOR_THE_OWNER.scopeMissing,
      };
    }
  }
  if (typeof json.refresh_token !== 'string' || json.refresh_token === '' || typeof json.access_token !== 'string') {
    return {
      ok: false,
      reason: 'Cirrux answered the code exchange without a refresh token and an access token.',
      said: CIRRUX_CONSENT_FOR_THE_OWNER.noRefreshToken,
    };
  }
  const seconds =
    typeof json.expires_in === 'number' && Number.isFinite(json.expires_in) && json.expires_in > 0 ? json.expires_in : 15 * 60;
  return {
    ok: true,
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    accessExpiresAt: Date.now() + seconds * 1000,
  };
}

/**
 * Who signed in, and in which workspace, for the page and the log: `GET
 * /user/profile` with the first access token. Informational: Cirrux's profile
 * carries no email address to bind the sign-in to the mailbox, so the page
 * names the login and the workspace and the person can see whose Drive it is.
 */
export async function cirruxSignedInAs(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ readonly username?: string; readonly workspace?: string } | undefined> {
  try {
    const response = await fetchImpl(`${CIRRUX_API_BASE}/user/profile`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { user?: { username?: unknown }; workspace?: { name?: unknown } };
    return {
      ...(typeof body.user?.username === 'string' ? { username: body.user.username } : {}),
      ...(typeof body.workspace?.name === 'string' ? { workspace: body.workspace.name } : {}),
    };
  } catch {
    return undefined;
  }
}

/** HTML-escape for text nodes. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A JS string literal that cannot break out of its <script> block. */
function jsString(value: unknown): string {
  return JSON.stringify(JSON.stringify(value)).replace(/</g, '\\u003c');
}

const PAGE_STYLE = 'font-family: system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; line-height: 1.5;';

const ENDING: Readonly<
  Record<
    ConsentLocale,
    {
      readonly failed: string;
      readonly retry: string;
      readonly done: string;
      readonly as: (who: string) => string;
      readonly next: string;
    }
  >
> = {
  en: {
    failed: 'Cirrux Drive was not connected',
    retry: 'You can close this window and try again from the Accounts page.',
    done: 'Cirrux Drive is connected',
    as: (who) => `Signed in to Cirrux as ${who}.`,
    next: 'Files can now go to this account’s Drive. You can close this window.',
  },
  nl: {
    failed: 'Cirrux Drive is niet verbonden',
    retry: 'U kunt dit venster sluiten en het opnieuw proberen vanaf de pagina Accounts.',
    done: 'Cirrux Drive is verbonden',
    as: (who) => `Aangemeld bij Cirrux als ${who}.`,
    next: 'Bestanden kunnen nu naar de Drive van dit account. U kunt dit venster sluiten.',
  },
};

/**
 * The page the callback ends on. On success it tells the opening window, on
 * the web origin only, that this account's Drive is connected: the message
 * carries the account's id and no credential, because none has a parameter
 * here to arrive in.
 */
export function cirruxResultPage(p: {
  readonly outcome:
    | { readonly ok: true; readonly connectionId: string; readonly username?: string; readonly workspace?: string }
    | { readonly ok: false; readonly reason: string };
  readonly locale?: ConsentLocale;
  readonly webOrigin?: string;
}): string {
  const lang = localeOf(p.locale);
  const words = ENDING[lang];
  const shell = (body: string) =>
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8" />` +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    `<title>Ownpace</title></head><body>${body}</body></html>`;
  if (!p.outcome.ok) {
    return shell(
      `<main style="${PAGE_STYLE}"><h1>${words.failed}</h1><p>${esc(p.outcome.reason)}</p><p>${words.retry}</p></main>`,
    );
  }
  const who = [p.outcome.username, p.outcome.workspace].filter(Boolean).join(', ');
  const signedIn = who ? `<p>${esc(words.as(who))}</p>` : '';
  const script = p.webOrigin
    ? '<script>' +
      `const payload = JSON.parse(${jsString({ type: 'ownpace-cirrux-drive', connected: true, connectionId: p.outcome.connectionId })});` +
      `const target = JSON.parse(${jsString(p.webOrigin)});` +
      'if (window.opener) { window.opener.postMessage(payload, target); }' +
      '</script>'
    : '';
  return shell(`<main style="${PAGE_STYLE}"><h1>${words.done}</h1>${signedIn}<p>${words.next}</p></main>${script}`);
}
