// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Reading permissions off the source, read-only (workplan 0029 T1, SAD §14.2).
 *
 * §14.2's discover step, and the first thing to say about it is what Graph
 * CANNOT give us, because that is the part a report would otherwise omit
 * silently:
 *
 *  - **Calendar sharing** — readable. `calendarPermissions` on a calendar is
 *    a v1.0 resource, and it says who a calendar is shared with and how.
 *  - **OneDrive / SharePoint sharing** — readable. A drive item's
 *    `permissions` collection covers both people-grants and sharing LINKS,
 *    and the two are told apart below, because "anyone with the link can
 *    edit" is a different risk from "Anna can edit".
 *  - **Mailbox delegation — FullAccess, SendAs, SendOnBehalf — is NOT
 *    readable through the Graph API this tool speaks.** Those are Exchange
 *    recipient permissions; the way to enumerate them is Exchange Online
 *    PowerShell (`Get-MailboxPermission`, `Get-RecipientPermission`), which
 *    is a different credential, a different consent model and a different
 *    protocol. Rather than pretend otherwise, `mailboxDelegations` returns
 *    `not_discoverable` with those cmdlet names in it, every run — because a
 *    migration that quietly loses the assistant's FullAccess is precisely the
 *    day-one breakage §14.2 exists to prevent (hard rule 9).
 *
 * Nothing here writes. The whole module is `GET`s, and §14.2's apply step is
 * deliberately deferred (workplan 0029's own note) — the inventory is
 * read-only by construction, so hard rule 2 is not merely respected here, it
 * is unreachable.
 */

import {
  log,
  permissionsNotDiscoverable,
  type PermissionGrant,
  type PermissionListing,
} from '@openmig/shared';
import type { HttpClient } from './dav-http.types.ts';

export interface GraphPermissionOptions {
  readonly baseUrl?: string;
  /**
   * Whether this connection holds APPLICATION permissions. Reading another
   * person's calendar or drive is not something a delegated `/me` token can
   * do, and saying so up front produces a better sentence than a 403.
   */
  readonly applicationPermissions: boolean;
}

interface GraphPage<T> {
  readonly value?: readonly T[];
  readonly '@odata.nextLink'?: string;
}

interface GraphCalendarPermission {
  readonly id?: string;
  readonly role?: string;
  readonly isRemovable?: boolean;
  readonly emailAddress?: { readonly name?: string; readonly address?: string };
  readonly allowedRoles?: readonly string[];
}

interface GraphItemPermission {
  readonly id?: string;
  readonly roles?: readonly string[];
  readonly link?: { readonly scope?: string; readonly type?: string; readonly webUrl?: string };
  readonly grantedToV2?: { readonly user?: { readonly displayName?: string; readonly email?: string } };
  readonly grantedTo?: { readonly user?: { readonly displayName?: string; readonly email?: string } };
  readonly invitation?: { readonly email?: string };
}

const MAX_PAGES = 100;

/**
 * Mailbox delegation: the honest "no".
 *
 * Always `not_discoverable`, and it takes no arguments for the same reason
 * `listImapGroups` does — there is no configuration under which the Graph
 * API this tool speaks returns FullAccess, SendAs or SendOnBehalf, so an
 * option that could turn this into a listing would be a promise it cannot
 * keep. Tested, because the regression it guards against is somebody later
 * returning `[]` to make a report look complete.
 */
export function mailboxDelegations(): PermissionListing {
  return {
    kind: 'not_discoverable',
    reason: permissionsNotDiscoverable(
      'FullAccess, SendAs and SendOnBehalf are Exchange recipient permissions, and the ' +
        'Microsoft Graph API this tool uses does not expose them. Capture them with Exchange ' +
        'Online PowerShell — `Get-MailboxPermission` for FullAccess and ' +
        '`Get-RecipientPermission` for SendAs — and record them by hand before cutover, ' +
        'because they will stop working the moment the mailbox moves',
    ),
  };
}

/**
 * Who a calendar is shared with.
 *
 * `calendarId` is the Graph id; `label` is what the report calls it, since a
 * calendar id means nothing to the person reading the runbook.
 */
export async function listCalendarPermissions(
  mailbox: string,
  calendarId: string,
  label: string,
  token: () => Promise<string>,
  httpClient: HttpClient,
  options: GraphPermissionOptions,
): Promise<PermissionListing> {
  if (!options.applicationPermissions) {
    return {
      kind: 'not_discoverable',
      reason: permissionsNotDiscoverable(
        'this connection uses delegated permissions, which can only read the signed-in ' +
          "user's own calendars. Reading another mailbox's sharing needs application " +
          'permissions and admin consent — see docs/o365-application-access.md',
      ),
    };
  }

  const base = (options.baseUrl ?? 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');
  const url =
    `${base}/users/${encodeURIComponent(mailbox)}` +
    `/calendars/${encodeURIComponent(calendarId)}/calendarPermissions`;

  const page = await getAll<GraphCalendarPermission>(url, token, httpClient);
  if (!page.ok) return { kind: 'not_discoverable', reason: permissionsNotDiscoverable(page.reason) };

  const grants: PermissionGrant[] = [];
  for (const entry of page.value) {
    // A role of `none` is Graph's way of saying the entry exists with no
    // access — reporting it as a share would send somebody to remove
    // something that grants nothing.
    const role = entry.role ?? '';
    if (role === '' || role === 'none') continue;
    const grantee = entry.emailAddress?.address ?? entry.emailAddress?.name;
    grants.push({
      subject: 'calendar',
      on: label,
      ...(grantee ? { grantee } : {}),
      role,
      raw: JSON.stringify(entry),
    });
  }

  log.debug(`[graph-permissions] ${label}: ${grants.length} calendar grant(s)`);
  return { kind: 'listed', grants };
}

/**
 * Who a drive item is shared with, and by what.
 *
 * Sharing LINKS and people-grants both come back in the same collection and
 * are told apart here: "anyone with this link can edit" is the finding an
 * owner most often does not know about, and flattening it into a list of
 * names would hide the one item worth acting on before cutover.
 */
export async function listDriveItemPermissions(
  driveId: string,
  itemId: string,
  label: string,
  token: () => Promise<string>,
  httpClient: HttpClient,
  options: GraphPermissionOptions,
): Promise<PermissionListing> {
  if (!options.applicationPermissions) {
    return {
      kind: 'not_discoverable',
      reason: permissionsNotDiscoverable(
        'this connection uses delegated permissions, which can only read the signed-in ' +
          "user's own drive. Reading another user's sharing needs application permissions " +
          'and admin consent — see docs/o365-application-access.md',
      ),
    };
  }

  const base = (options.baseUrl ?? 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');
  const url =
    `${base}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/permissions`;

  const page = await getAll<GraphItemPermission>(url, token, httpClient);
  if (!page.ok) return { kind: 'not_discoverable', reason: permissionsNotDiscoverable(page.reason) };

  const grants: PermissionGrant[] = [];
  for (const entry of page.value) {
    const role = (entry.roles ?? []).join(', ');
    if (role === '') continue;

    if (entry.link) {
      grants.push({
        subject: 'drive_item',
        on: label,
        role,
        viaLink: true,
        raw: JSON.stringify(entry),
      });
      continue;
    }

    const user = entry.grantedToV2?.user ?? entry.grantedTo?.user;
    const grantee = user?.email ?? user?.displayName ?? entry.invitation?.email;
    grants.push({
      subject: 'drive_item',
      on: label,
      ...(grantee ? { grantee } : {}),
      role,
      raw: JSON.stringify(entry),
    });
  }

  log.debug(`[graph-permissions] ${label}: ${grants.length} drive grant(s)`);
  return { kind: 'listed', grants };
}

type Fetched<T> =
  | { readonly ok: true; readonly value: readonly T[] }
  | { readonly ok: false; readonly reason: string };

/** Follow the collection to the end, turning every failure into a sentence. */
async function getAll<T>(
  first: string,
  token: () => Promise<string>,
  httpClient: HttpClient,
): Promise<Fetched<T>> {
  const out: T[] = [];
  let url: string | undefined = first;
  let pages = 0;

  while (url) {
    if (++pages > MAX_PAGES) {
      return {
        ok: false,
        reason:
          `the list did not stop paging after ${pages - 1} pages — refusing to report a ` +
          'partial set of permissions as complete',
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

    if (res.status !== 200) {
      // Graph's own words: a 403 here usually means consent was granted but
      // the Application Access Policy excludes this app, and the operator
      // needs the server's text to tell those apart.
      return { ok: false, reason: `Graph answered ${res.status}: ${res.body}` };
    }

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
