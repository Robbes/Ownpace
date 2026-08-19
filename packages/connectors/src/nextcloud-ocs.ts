// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Nextcloud's OCS Share API — the first target with a share verb (ADR-0032,
 * workplan 0052 T3).
 *
 * Plain WebDAV has no way to say "Anna may see this folder"; Nextcloud does,
 * through OCS (`/ocs/v2.php/apps/files_sharing/api/v1/shares`), and creating
 * a share there makes NEXTCLOUD notify the grantee — in-app and by mail, per
 * that server's own configuration. That notification is the entire point
 * (ADR-0032 §4): the invite comes from the platform the person will actually
 * use, carrying a working link, and it cannot disagree with the access
 * because it IS the access. This module therefore sends no mail, renders no
 * message, and holds no addresses beyond the one grant it was asked to
 * create.
 *
 * The endpoint is ORIGIN-rooted, like `/.well-known/*` (see `wellKnownUrl`):
 * a Nextcloud WebDAV url is `https://host/remote.php/dav/files/user/`, and
 * OCS lives at `https://host/ocs/…` — derived from the origin, never by
 * concatenating onto the DAV path.
 *
 * A refusal is an answer: any non-OK OCS reply comes back as
 * `{ok:false, reason}` carrying the server's own words (a wrong username, a
 * missing file, a server that is not Nextcloud at all — its 404 says so).
 * The sharing queue shows that sentence verbatim and the row stays open.
 */

import type { HttpClient } from './dav-http.types.ts';

export interface NextcloudShareOptions {
  /** The WebDAV url the target connection already stores — any path on the server. */
  readonly webdavUrl: string;
  readonly username: string;
  readonly password: string;
  readonly httpClient: HttpClient;
}

export interface CreateUserShareRequest {
  /** Target-side path of the file or folder, from the account root (e.g. `Projects/budget.xlsx`). */
  readonly path: string;
  /** The target account to share with, as Nextcloud knows it (uid or email it can resolve). */
  readonly shareWith: string;
  /** The source's own word for the level — anything write-ish becomes an editor share. */
  readonly role: string;
}

export type CreateShareResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Nextcloud permission bits: 1 read, 2 update, 4 create, 8 delete, 16 share.
 * Two levels only, mirroring mapGrant's two verdicts: a write-ish role gets
 * the editor set (15 — no re-share: handing out the right to hand out rights
 * is a decision this tool does not make for anybody), everything else reads.
 */
export function nextcloudPermissionsFor(role: string): number {
  return /write|writer|editor|author|contribut/i.test(role) ? 15 : 1;
}

/** `https://host` from whatever DAV url the target stores; undefined when unparseable. */
export function ocsOriginFrom(webdavUrl: string): string | undefined {
  try {
    return new URL(webdavUrl).origin;
  } catch {
    return undefined;
  }
}

interface OcsEnvelope {
  readonly ocs?: {
    readonly meta?: { readonly status?: string; readonly statuscode?: number; readonly message?: string };
  };
}

/**
 * Create one user share. One grant, one call, one answer — §11.2's "one item,
 * one decision" carried into the sharing queue.
 */
export async function createNextcloudUserShare(
  options: NextcloudShareOptions,
  request: CreateUserShareRequest,
): Promise<CreateShareResult> {
  const origin = ocsOriginFrom(options.webdavUrl);
  if (!origin) {
    return {
      ok: false,
      reason: `The target's WebDAV url (${options.webdavUrl}) has no readable server origin, so its OCS endpoint cannot be derived.`,
    };
  }

  const body = new URLSearchParams({
    path: request.path.startsWith('/') ? request.path : `/${request.path}`,
    shareType: '0', // a USER share — the only kind ADR-0032's first slice creates
    shareWith: request.shareWith,
    permissions: String(nextcloudPermissionsFor(request.role)),
  }).toString();

  let response;
  try {
    response = await options.httpClient.request({
      url: `${origin}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`,
        // Without this header OCS answers 401 to everything, by design.
        'OCS-APIRequest': 'true',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  let meta: { status?: string; statuscode?: number; message?: string } | undefined;
  try {
    meta = (JSON.parse(response.body) as OcsEnvelope).ocs?.meta;
  } catch {
    meta = undefined;
  }

  if (response.status >= 200 && response.status < 300 && meta?.status === 'ok') {
    return { ok: true };
  }
  // The server's own words, whole: OCS puts the human sentence in meta.message
  // ("Path already shared with this user", "User does not exist"…); a server
  // that is not Nextcloud answers with whatever it answers, equally worth
  // showing unchanged.
  const said = meta?.message?.trim() ? meta.message : response.body.slice(0, 300);
  return { ok: false, reason: `OCS answered ${response.status}: ${said}` };
}
