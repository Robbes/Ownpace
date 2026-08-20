// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Finding the things that HAVE permissions (workplan 0029 T1, the wiring half).
 *
 * `graph-permissions.ts` reads the rights on one calendar or one file. This
 * finds the calendars and the files, which is the part with the awkward
 * trade-off in it: a tenant's drive can hold hundreds of thousands of items,
 * and asking Graph for the permissions on each one is neither kind nor
 * finishable.
 *
 * SO THE DRIVE SCAN IS BOUNDED, AND SAYS WHEN IT STOPPED. Two narrowings,
 * both honest rather than clever:
 *
 *  1. Only items carrying Graph's `shared` facet are asked about. An item
 *     with no facet is not shared with anybody, so its permission list holds
 *     nothing an owner needs to act on. This is the difference between a
 *     handful of requests and a hundred thousand.
 *  2. Both the walk and the permission reads are capped. When a cap is hit
 *     the result is `not_discoverable` — NOT a short list — because a partial
 *     inventory presented as complete is exactly the report that gets an
 *     owner to cut over believing nothing was missed (hard rule 9).
 */

import {
  log,
  permissionsNotDiscoverable,
  type PermissionGrant,
  type PermissionListing,
} from '@openmig/shared';
import type { HttpClient } from './dav-http.types.ts';
import {
  listCalendarPermissions,
  listDriveItemPermissions,
  type GraphPermissionOptions,
} from './graph-permissions.ts';

export interface ScanOptions extends GraphPermissionOptions {
  /** Folders to descend into before refusing to keep going. */
  readonly maxFolders?: number;
  /** Items whose permissions will be read before refusing to keep going. */
  readonly maxSharedItems?: number;
}

interface GraphCalendar {
  readonly id?: string;
  readonly name?: string;
}

interface GraphDriveItem {
  readonly id?: string;
  readonly name?: string;
  readonly folder?: { readonly childCount?: number };
  readonly shared?: unknown;
  readonly parentReference?: { readonly path?: string };
}

interface GraphPage<T> {
  readonly value?: readonly T[];
  readonly '@odata.nextLink'?: string;
}

const DEFAULT_MAX_FOLDERS = 500;
const DEFAULT_MAX_SHARED_ITEMS = 500;

/**
 * Every calendar in a mailbox, with who it is shared with.
 *
 * Merged into ONE listing rather than one per calendar: the report groups by
 * category, and a mailbox with eight calendars would otherwise produce eight
 * sections of which seven say nothing. A failure to read any single
 * calendar's permissions fails the whole listing, deliberately — "these are
 * the shares on your calendars, except the ones we could not read" is the
 * half-truth this module exists to avoid.
 */
export async function scanCalendarPermissions(
  mailbox: string,
  token: () => Promise<string>,
  httpClient: HttpClient,
  options: ScanOptions,
): Promise<PermissionListing> {
  if (!options.applicationPermissions) {
    return {
      kind: 'not_discoverable',
      reason: permissionsNotDiscoverable(
        'this connection uses delegated permissions, which can only read the signed-in ' +
          "user's own calendars — see docs/o365-application-access.md",
      ),
    };
  }

  const base = (options.baseUrl ?? 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');
  const calendars = await getAll<GraphCalendar>(
    `${base}/users/${encodeURIComponent(mailbox)}/calendars?$select=id,name`,
    token,
    httpClient,
  );
  if (!calendars.ok) {
    return { kind: 'not_discoverable', reason: permissionsNotDiscoverable(calendars.reason) };
  }

  const grants: PermissionGrant[] = [];
  for (const calendar of calendars.value) {
    if (!calendar.id) continue;
    const label = calendar.name ? `${mailbox} — ${calendar.name}` : mailbox;
    const listing = await listCalendarPermissions(
      mailbox,
      calendar.id,
      label,
      token,
      httpClient,
      options,
    );
    if (listing.kind === 'not_discoverable') {
      // One unreadable calendar makes the whole answer partial, and a partial
      // answer must not be dressed as a complete one.
      return listing;
    }
    grants.push(...listing.grants);
  }

  log.debug(`[permission-scan] ${mailbox}: ${grants.length} calendar grant(s)`);
  return { kind: 'listed', grants };
}

/**
 * The id of a mailbox owner's drive.
 *
 * A separate step because `/drives/{id}` is the only addressing the sharing
 * endpoints take, and `users/{address}/drive` is a path, not an id — building
 * one from the other by string concatenation is exactly the mistake
 * `graph-scope.ts` exists to prevent elsewhere. A failure comes back as a
 * reason, so the caller reports a blind spot rather than an empty drive.
 */
export async function resolveUserDriveId(
  mailbox: string,
  token: () => Promise<string>,
  httpClient: HttpClient,
  options: ScanOptions,
): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: string }> {
  if (!options.applicationPermissions) {
    return {
      ok: false,
      reason: permissionsNotDiscoverable(
        'this connection uses delegated permissions, which cannot reach another user’s ' +
          'drive — see docs/o365-application-access.md',
      ),
    };
  }
  const base = (options.baseUrl ?? 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');
  let res;
  try {
    res = await httpClient.request({
      url: `${base}/users/${encodeURIComponent(mailbox)}/drive?$select=id`,
      method: 'GET',
      headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' },
    });
  } catch (err) {
    return {
      ok: false,
      reason: permissionsNotDiscoverable(
        `the request failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }
  if (res.status !== 200) {
    return {
      ok: false,
      // A 404 here is common and benign — plenty of mailboxes have no
      // OneDrive provisioned — but it is still "nothing was looked at",
      // not "nothing is shared".
      reason: permissionsNotDiscoverable(`Graph answered ${res.status}: ${res.body}`),
    };
  }
  try {
    const id = (JSON.parse(res.body) as { id?: string }).id;
    if (!id) {
      return { ok: false, reason: permissionsNotDiscoverable('the drive response carried no id') };
    }
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      reason: permissionsNotDiscoverable(
        `the drive response was not JSON: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }
}

/**
 * Everything shared in a drive.
 *
 * Walks folders breadth-first, collecting only items Graph marks as `shared`,
 * then reads the rights on each. Both counts are capped and a hit cap is
 * reported as `not_discoverable`.
 */
export async function scanDrivePermissions(
  driveId: string,
  token: () => Promise<string>,
  httpClient: HttpClient,
  options: ScanOptions,
): Promise<PermissionListing> {
  if (!options.applicationPermissions) {
    return {
      kind: 'not_discoverable',
      reason: permissionsNotDiscoverable(
        'this connection uses delegated permissions, which can only read the signed-in ' +
          "user's own drive — see docs/o365-application-access.md",
      ),
    };
  }

  const base = (options.baseUrl ?? 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');
  const maxFolders = options.maxFolders ?? DEFAULT_MAX_FOLDERS;
  const maxItems = options.maxSharedItems ?? DEFAULT_MAX_SHARED_ITEMS;

  const queue: Array<{ url: string; path: string }> = [
    { url: `${base}/drives/${encodeURIComponent(driveId)}/root/children`, path: '' },
  ];
  const shared: Array<{ id: string; label: string }> = [];
  let folders = 0;

  while (queue.length > 0) {
    const next = queue.shift()!;
    if (++folders > maxFolders) {
      return {
        kind: 'not_discoverable',
        reason: permissionsNotDiscoverable(
          `this drive has more than ${maxFolders} folders, so the scan stopped rather than ` +
            'report part of it as the whole picture. Nothing below that point was looked at',
        ),
      };
    }

    const page = await getAll<GraphDriveItem>(
      `${next.url}?$select=id,name,folder,shared`,
      token,
      httpClient,
    );
    if (!page.ok) {
      return { kind: 'not_discoverable', reason: permissionsNotDiscoverable(page.reason) };
    }

    for (const item of page.value) {
      if (!item.id) continue;
      const label = `${next.path}/${item.name ?? item.id}`;
      // The `shared` facet is Graph's own marker. Absent means nobody else
      // can reach it, so there is nothing for an owner to act on.
      if (item.shared !== undefined && item.shared !== null) {
        if (shared.length >= maxItems) {
          return {
            kind: 'not_discoverable',
            reason: permissionsNotDiscoverable(
              `more than ${maxItems} items in this drive are shared, which is more than this ` +
                'report can inventory. The list would be partial, and a partial list read as ' +
                'complete is how a share nobody knew about survives a cutover',
            ),
          };
        }
        shared.push({ id: item.id, label });
      }
      if (item.folder) {
        queue.push({
          url: `${base}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(item.id)}/children`,
          path: label,
        });
      }
    }
  }

  const grants: PermissionGrant[] = [];
  for (const item of shared) {
    const listing = await listDriveItemPermissions(
      driveId,
      item.id,
      item.label,
      token,
      httpClient,
      options,
    );
    if (listing.kind === 'not_discoverable') return listing;
    grants.push(...listing.grants);
  }

  log.debug(
    `[permission-scan] drive ${driveId}: ${grants.length} grant(s) across ${shared.length} shared item(s)`,
  );
  return { kind: 'listed', grants };
}

type Fetched<T> =
  | { readonly ok: true; readonly value: readonly T[] }
  | { readonly ok: false; readonly reason: string };

async function getAll<T>(
  first: string,
  token: () => Promise<string>,
  httpClient: HttpClient,
): Promise<Fetched<T>> {
  const out: T[] = [];
  let url: string | undefined = first;
  let pages = 0;

  while (url) {
    if (++pages > 100) {
      return {
        ok: false,
        reason: `a list did not stop paging after ${pages - 1} pages — refusing to report a partial set as complete`,
      };
    }

    let res;
    try {
      res = await httpClient.request({
        url,
        method: 'GET',
        headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' },
      });
    } catch (err) {
      return {
        ok: false,
        reason: `the request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (res.status !== 200) return { ok: false, reason: `Graph answered ${res.status}: ${res.body}` };

    let parsed: GraphPage<T>;
    try {
      parsed = JSON.parse(res.body) as GraphPage<T>;
    } catch (err) {
      return {
        ok: false,
        reason: `the response was not JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    out.push(...(parsed.value ?? []));
    url = parsed['@odata.nextLink'];
  }

  return { ok: true, value: out };
}
