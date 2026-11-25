// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * CIRRUX DRIVE, THE FACE A PERSON'S SIGN-IN ADDS TO A `cirrux` ACCOUNT
 * (workplan 0160 T5; ADR-0052).
 *
 * A `cirrux` account is one row with one app password, and that password
 * reaches mail over IMAP and calendars, contacts and Reminders over DAV
 * (0160 T1). Drive is none of those: Cirrux Drive speaks no WebDAV, only
 * Cirrux's own HTTP API, and that API takes a person's OAuth sign-in, never an
 * app password and never a workspace API key (`https://cirrux.co/help/api`,
 * `https://cirrux.co/help/api/drive`, read 2026-11-19). So the file face is a
 * GRANT stored on the same row, beside the app password, and it exists only
 * once that grant is stored (`GRANTED_TARGET_FACES` in `target-domains.ts`).
 *
 * Everything here is a fact Cirrux publishes, named once, so the consent door
 * (`apps/api`), the token provider and the writer (`packages/connectors`) and
 * the qualification (`packages/orchestration`) cannot disagree about an
 * endpoint, a scope or a limit.
 */

/** Where a person is sent to approve the app (`https://cirrux.co/help/api`, *Signing people in with OAuth*). */
export const CIRRUX_AUTHORIZE_ENDPOINT = 'https://api.cirrux.co/oauth/authorize';

/** Where a code is exchanged and a refresh token refreshed, form-encoded. */
export const CIRRUX_TOKEN_ENDPOINT = 'https://api.cirrux.co/oauth/token';

/**
 * The origin the authorization server's `iss` names.
 *
 * Cirrux returns `iss` beside `code` and `state`; the exact string it sends is
 * in its metadata document (`/.well-known/oauth-authorization-server`), which
 * this repository has not read. So the callback compares ORIGINS, which a
 * value that is Cirrux's in any spelling passes and one naming another host
 * does not (workplan 0160 §6, the ambiguities).
 */
export const CIRRUX_ISSUER_ORIGIN = 'https://api.cirrux.co';

/** The public API's base, `/v1` included (`https://cirrux.co/help/api`). */
export const CIRRUX_API_BASE = 'https://api.cirrux.co/public_api/v1';

/**
 * The scopes the consent asks for, in the order Cirrux lists them.
 *
 * `user.profile` to read who signed in and in which workspace; `workspace.read`
 * for the storage pool a pass checks before it uploads; `drive.read`,
 * `drive.create` and `drive.update` to find folders, upload and replace.
 * `drive.delete` is used for ONE thing: moving a file to the trash when the
 * person approved removing it because it was deleted at the source. Never a
 * permanent delete (ADR-0052, decision 6).
 */
export const CIRRUX_DRIVE_SCOPES = [
  'user.profile',
  'workspace.read',
  'drive.read',
  'drive.create',
  'drive.update',
  'drive.delete',
] as const;

/**
 * The key the Drive grant is stored under, in the account's ENCRYPTED
 * credentials, beside `username` and `password` (the app password).
 *
 * One record, one row, one key: the write-back after every refresh replaces
 * the whole encrypted record by a compare-and-swap on what was read
 * (`cirrux-grant-store.ts`), so the app password and the grant can never be
 * stored half from one version and half from another.
 */
export const CIRRUX_DRIVE_GRANT_KEY = 'driveRefreshToken';

/**
 * The key the WORKSPACE a Drive grant reached is recorded under, beside the
 * grant, in the same encrypted record: Cirrux's workspace `uuid`, as `GET
 * /user/profile` named it (workplan 0174 §4.4, T5). Cirrux names no address
 * on a sign-in (`https://cirrux.co/help/api/user`, read 2026-11-25), so the
 * first grant on an account records the workspace and every later one must
 * reach the same. Not a secret; kept in the record so it travels and goes
 * with the grant's own rules (`keepingTheDriveGrant`).
 */
export const CIRRUX_DRIVE_WORKSPACE_KEY = 'driveWorkspace';

/** Does this decrypted credential record carry a Drive grant? */
export function hasCirruxDriveGrant(creds: Readonly<Record<string, string | undefined>>): boolean {
  const token = creds[CIRRUX_DRIVE_GRANT_KEY];
  return typeof token === 'string' && token.trim() !== '';
}

/** The one variable this module reads. */
export interface CirruxClientEnv {
  readonly CIRRUX_OAUTH_CLIENT_ID?: string | undefined;
}

export interface CirruxDeploymentClient {
  readonly clientId: string;
}

/**
 * The deployment's Cirrux OAuth client, or null when it has none.
 *
 * ONE PUBLIC CLIENT PER DEPLOYMENT (ADR-0052, decision 6). Cirrux registers a
 * client by hand, with its redirect URLs, and issues no secret: it is a public
 * client and PKCE `S256` is required. So there is no pair to be half of, and
 * nothing a connection could carry instead: the ID is the deployment's, read
 * where it is used (the consent door, a Test, a pass), the way
 * `GOOGLE_OAUTH_CLIENT_ID` is (ADR-0041, option B). Unset, the Drive face is a
 * measured no that says this deployment has no Cirrux client, and no screen
 * offers the button.
 */
export function cirruxDeploymentClient(
  env: CirruxClientEnv = process.env,
): CirruxDeploymentClient | null {
  const clientId = (env.CIRRUX_OAUTH_CLIENT_ID ?? '').trim();
  return clientId === '' ? null : { clientId };
}

/**
 * The largest file Cirrux's simple upload takes, as this product reads its
 * documentation.
 *
 * *"This route buffers the whole file in memory, so it is capped at 100 MB"*
 * (`https://cirrux.co/help/api/drive`). Whether that is 100 × 10⁶ or
 * 100 × 2²⁰ bytes, and whether it counts the file or the base64 body that
 * carries it, the page does not say. So the smaller reading, of the file: a
 * file of exactly this size or less is sent this way, and a `413
 * file_too_large` from the route is read as the larger reading being wrong
 * (workplan 0160 §6, the ambiguities).
 */
export const CIRRUX_SIMPLE_UPLOAD_MAX_BYTES = 100_000_000;

/**
 * Cirrux's own limit for one file, at every size path: *"up to 2 GiB"* for the
 * chunked flow and *"at most 2 GiB"* for a replace; over it, `413
 * file_too_large` (`https://cirrux.co/help/api/drive`). The web app says
 * *"up to 2 GB each"* (`https://cirrux.co/help/drive`).
 */
export const CIRRUX_LARGEST_FILE_BYTES = 2 * 1024 * 1024 * 1024;
