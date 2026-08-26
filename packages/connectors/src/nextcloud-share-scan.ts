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
}

export type NextcloudShareListing =
  | { readonly kind: 'listed'; readonly grants: readonly ScannedGrant[] }
  | { readonly kind: 'not_discoverable'; readonly reason: string };

interface OcsShareItem {
  readonly share_type?: number;
  readonly share_with?: string;
  readonly path?: string;
  readonly permissions?: number;
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
    return {
      subject: 'drive_item' as const,
      on: path,
      ...(viaLink || !item.share_with ? {} : { grantee: item.share_with }),
      role: roleFromPermissionBits(item.permissions),
      ...(viaLink ? { viaLink: true } : {}),
      // The grant verbatim, in the source's own words — evidence, never parsed
      // downstream (the queue stores it; `shareGrantHash` does not include it).
      raw: JSON.stringify(item),
    };
  });
  return { kind: 'listed', grants };
}
