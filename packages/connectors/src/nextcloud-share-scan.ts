// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What a Nextcloud SOURCE has shared with other people (workplan 0104 T2).
 *
 * The §14.2 inventory read Graph and Google Drive; a Nextcloud source was a
 * blind spot — its outbound shares never became sharing-queue rows, so the
 * one-go press had nothing to press on the one platform the demo gate runs
 * against. OCS answers the question in one request: every share the
 * authenticated account created, path, grantee and level included.
 *
 * Read-only by construction: one GET, no writes, no mail — listing what is
 * shared cannot notify anybody. The refusal shape is the inventory's own
 * (`not_discoverable` with the server's words), so a WebDAV server that is
 * not a Nextcloud becomes an honest blind-spot line, never a crash.
 *
 * share_type mapping, from Nextcloud's constants:
 *   0 user, 1 group, 3 public link, 4 by-mail, 6 federated.
 * A link (3) has no grantee — `viaLink`, the queue's manual lane. Groups and
 * federated shares carry `share_with` and travel as grantees; `mapGrant`
 * decides what the target can honour.
 *
 * ## WHERE THE THING SITS, for free (2026-09-19)
 *
 * The fold (workplan 0123 T4) turns a shared folder and its contents into one
 * row, keyed on the container each item sits in. It was built for Google
 * Drive, which answers `parents` on the listing the scan already makes — and
 * it had never worked on a Nextcloud source at all, because this scan said
 * nothing about placement. Every row came back unplaced, so every row was
 * listed on its own and a folder press had no folder to press.
 *
 * OCS already answers both facts in the response above: `path` carries the
 * hierarchy in plain sight, and `item_type` says whether the subject is a
 * folder. No second request, no new permission — the scan was simply not
 * reading two fields it was already being handed.
 */

import { ocsOriginFrom, type NextcloudShareOptions } from './nextcloud-ocs.ts';

/** The inventory's grant shape (shared's PermissionGrant, structurally). */
export interface ScannedGrant {
  readonly subject: 'drive_item';
  readonly on: string;
  readonly grantee?: string;
  readonly role: string;
  readonly viaLink?: boolean;
  readonly raw: string;
  /** The path itself: unique within an account, and what a child points at. */
  readonly itemKey?: string;
  /** The path up to the last slash — `ACCOUNT_ROOT` for a top-level share. */
  readonly parentKey?: string;
  /** From `item_type`. ABSENT when OCS did not say, never guessed `false`. */
  readonly isContainer?: boolean;
}

/**
 * What a top-level share sits in.
 *
 * A path cannot BE `/` — Nextcloud will not share an account root — so this
 * cannot collide with a real subject, and a slash is what the account root is
 * called everywhere else in this protocol.
 *
 * It has to be a value rather than an absence, because the container of a
 * shared top-level FOLDER is exactly as real as the folder: leaving it out
 * would make the folder itself unplaced while its children grouped under it,
 * and the fold would render the folder loose beside the group it heads.
 */
export const ACCOUNT_ROOT = '/';

export type NextcloudShareListing =
  | { readonly kind: 'listed'; readonly grants: readonly ScannedGrant[] }
  | { readonly kind: 'not_discoverable'; readonly reason: string };

interface OcsShareItem {
  readonly share_type?: number;
  readonly share_with?: string;
  readonly path?: string;
  readonly permissions?: number;
  /** `file` or `folder`. Absent on an OCS that does not say — see below. */
  readonly item_type?: string;
}

/**
 * Write-ish is any bit beyond read: update (2), create (4), delete (8).
 * The words match the queue's fixtures so `mapGrant` reads them the same way.
 */
export function roleFromPermissionBits(permissions: number | undefined): string {
  return ((permissions ?? 1) & (2 | 4 | 8)) !== 0 ? 'writer' : 'reader';
}

export async function scanNextcloudShares(
  options: NextcloudShareOptions,
): Promise<NextcloudShareListing> {
  const origin = ocsOriginFrom(options.webdavUrl);
  if (!origin) {
    return {
      kind: 'not_discoverable',
      reason: `The source's WebDAV url (${options.webdavUrl}) has no readable server origin, so its OCS endpoint cannot be derived.`,
    };
  }

  let response;
  try {
    response = await options.httpClient.request({
      url: `${origin}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`,
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`,
        'OCS-APIRequest': 'true',
        Accept: 'application/json',
      },
    });
  } catch (err) {
    return {
      kind: 'not_discoverable',
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  let data: OcsShareItem[] | undefined;
  try {
    const parsed = JSON.parse(response.body) as {
      ocs?: { meta?: { status?: string; message?: string }; data?: OcsShareItem[] };
    };
    if (response.status >= 200 && response.status < 300 && parsed.ocs?.meta?.status === 'ok') {
      data = parsed.ocs.data ?? [];
    } else {
      const said = parsed.ocs?.meta?.message?.trim() || response.body.slice(0, 300);
      return { kind: 'not_discoverable', reason: `OCS answered ${response.status}: ${said}` };
    }
  } catch {
    return {
      kind: 'not_discoverable',
      reason: `OCS answered ${response.status} with a body that is not its JSON envelope — a WebDAV server without OCS, most likely: ${response.body.slice(0, 200)}`,
    };
  }

  const grants: ScannedGrant[] = data.map((item) => {
    const path = (item.path ?? '').replace(/^\//, '');
    const viaLink = item.share_type === 3;
    const cut = path.lastIndexOf('/');
    return {
      subject: 'drive_item' as const,
      on: path,
      ...(viaLink || !item.share_with ? {} : { grantee: item.share_with }),
      role: roleFromPermissionBits(item.permissions),
      ...(viaLink ? { viaLink: true } : {}),
      // The grant verbatim, in the source's own words — evidence, never parsed
      // downstream (the queue stores it; `shareGrantHash` does not include it).
      raw: JSON.stringify(item),
      // WHERE IT SITS, from what OCS already said. A share with no path at all
      // is placed nowhere rather than at the root: hard rule 9 — the answer to
      // "where is this" was missing, and the root is a real answer.
      ...(path
        ? {
            itemKey: path,
            parentKey: cut < 0 ? ACCOUNT_ROOT : path.slice(0, cut),
          }
        : {}),
      // Three answers, deliberately. An OCS that did not say leaves this
      // ABSENT, because `false` is the claim "this is not a folder" and the
      // fold treats a container differently from a thing inside one.
      ...(item.item_type === 'folder'
        ? { isContainer: true }
        : item.item_type === 'file'
          ? { isContainer: false }
          : {}),
    };
  });
  return { kind: 'listed', grants };
}
