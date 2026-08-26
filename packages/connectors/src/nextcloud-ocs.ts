// Copyright 2026 The Ownpace authors (Apache-2.0)

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
  /**
   * The owner's context, carried INSIDE the platform's own notification
   * ("this replaces the share on the old platform") — 0104's whole point is
   * that the announcement comes from the target, so the context must ride
   * the same mail. Modern Nextcloud accepts `note` at create; a server that
   * ignores it still shares correctly, it just says less.
   */
  readonly note?: string;
}

export type CreateShareResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * `createNextcloudShare`'s answer also says WHICH door the grantee was
 * reached through — a user share notifies in-app (and by mail per that
 * user's own settings); a share-by-mail always mails the link. The sharing
 * queue can show that word; `applyShareGrant` needs only the `ok`.
 */
export type CreateShareOutcome =
  | { readonly ok: true; readonly via: 'user' | 'mail' }
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
 * One OCS share attempt, one answer. The OCS statuscode travels back with a
 * refusal because it is the one LOCALE-INDEPENDENT fact in the reply:
 * `meta.message` is a translated human sentence, and branching on its words
 * would break on the first non-English server.
 */
async function attemptOcsShare(
  options: NextcloudShareOptions,
  request: CreateUserShareRequest,
  shareType: '0' | '4',
): Promise<{ ok: true } | { ok: false; reason: string; statuscode?: number }> {
  const origin = ocsOriginFrom(options.webdavUrl);
  if (!origin) {
    return {
      ok: false,
      reason: `The target's WebDAV url (${options.webdavUrl}) has no readable server origin, so its OCS endpoint cannot be derived.`,
    };
  }

  const body = new URLSearchParams({
    path: request.path.startsWith('/') ? request.path : `/${request.path}`,
    shareType,
    shareWith: request.shareWith,
    permissions: String(nextcloudPermissionsFor(request.role)),
    ...(request.note?.trim() ? { note: request.note.trim() } : {}),
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
  return {
    ok: false,
    reason: `OCS answered ${response.status}: ${said}`,
    ...(typeof meta?.statuscode === 'number' ? { statuscode: meta.statuscode } : {}),
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
  const attempt = await attemptOcsShare(options, request, '0');
  return attempt.ok ? { ok: true } : { ok: false, reason: attempt.reason };
}

/**
 * Create one share for whoever the grantee is: a user share when the target
 * knows them, a SHARE-BY-MAIL when it does not (0104 T0).
 *
 * Most of the people a cutover owes an announcement are OUTSIDERS — grantees
 * the source platform knew by address, with no account on the target. A user
 * share cannot reach them; Nextcloud's share-by-mail can, and it MAILS the
 * link through the instance's own SMTP — which is the entire point: the
 * announcement comes from the platform, at the moment the grant is applied
 * (creation is deferrable, the notification rides creation).
 *
 * The fallback fires ONLY on OCS statuscode 404 from the user attempt — the
 * locale-independent "no such account" (a missing PATH answers 404 too, and
 * then the mail attempt refuses on the same missing path: one extra call,
 * the same honest refusal). Every other refusal comes back unchanged — a
 * permissions problem or a non-Nextcloud server is not an invitation to try
 * a second door.
 */
export async function createNextcloudShare(
  options: NextcloudShareOptions,
  request: CreateUserShareRequest,
): Promise<CreateShareOutcome> {
  const asUser = await attemptOcsShare(options, request, '0');
  if (asUser.ok) return { ok: true, via: 'user' };
  if (asUser.statuscode !== 404) return { ok: false, reason: asUser.reason };

  const byMail = await attemptOcsShare(options, request, '4');
  if (byMail.ok) return { ok: true, via: 'mail' };
  return {
    ok: false,
    reason: `not a target account (${asUser.reason}), and share-by-mail also refused — ${byMail.reason}`,
  };
}
