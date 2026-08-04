// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Listing a tenant's mail-enabled groups (workplan 0027 T1, on T0's auth model).
 *
 * `/groups` is an APPLICATION-permission endpoint (`Group.Read.All`), the same
 * shape of problem `/users` was for 0028's mailbox detector: a delegated
 * connection cannot answer the question at all, and must say so rather than
 * report an empty list. Every failure path below returns `not_enumerable`.
 *
 * WHAT THIS FILE DECIDES AND WHAT IT DOES NOT. §14.1's question — shared
 * MAILBOX (Pattern S) or distribution LIST (Pattern D) — turns on whether the
 * group has a message store, and *the mapping from Microsoft's vocabulary to
 * "has a store"* is Microsoft-specific knowledge, so it lives here. The
 * mapping from "has a store" to a §14.1 pattern is a rule of ours and lives in
 * `@openmig/core`. Keeping the seam there means a second source (Google
 * Groups, one day) states the same three facts and reuses the same judgement.
 *
 * The store signal itself:
 *  - `groupTypes` contains `Unified` — an M365 group, which always has a
 *    mailbox. §14.1 is explicit: "If an M365 group has a store, treat it as
 *    Pattern S."
 *  - mail-enabled and NOT Unified — a distribution list or a mail-enabled
 *    security group. Neither has a store; what migrates is the definition.
 *  - anything else — `unknown`, which is a real answer and not a failure. It
 *    becomes a `shared_address_pattern` decision rather than a guess.
 */

import {
  log,
  type DirectoryListing,
  type GroupStore,
  type DiscoveredGroup,
  type GroupListing,
} from '@openmig/shared';
import type { HttpClient } from './dav-http.types';

export type { GroupListing, DiscoveredGroup, GroupStore };

export interface GraphGroupsOptions {
  readonly baseUrl?: string;
  /** Application permissions are required; delegated cannot read `/groups`. */
  readonly applicationPermissions: boolean;
  readonly pageSize?: number;
}

interface GraphGroup {
  readonly id?: string;
  readonly displayName?: string;
  readonly mail?: string;
  readonly mailEnabled?: boolean;
  readonly groupTypes?: readonly string[];
}

interface GraphGroupPage {
  readonly value?: readonly GraphGroup[];
  readonly '@odata.nextLink'?: string;
}

interface GraphMember {
  readonly mail?: string;
  readonly userPrincipalName?: string;
}

interface GraphMemberPage {
  readonly value?: readonly GraphMember[];
  readonly '@odata.nextLink'?: string;
}

/** What a source should SAY when it cannot enumerate groups. */
export function groupsNotEnumerable(reason: string): string {
  return (
    `This source cannot enumerate groups, so shared addresses cannot be ` +
    `discovered: ${reason}. This is not "no groups found" — nothing was looked at.`
  );
}

const MAX_PAGES = 200;

/**
 * Enumerate the tenant's mail-enabled groups, with their member lists.
 *
 * Mail-enabled only, and filtered server-side: a tenant's security groups are
 * typically an order of magnitude more numerous and none of them is a shared
 * address. A group without a `mail` value is skipped for the same reason —
 * §14.1 is about addresses people send to.
 */
export async function listMailEnabledGroups(
  token: () => Promise<string>,
  httpClient: HttpClient,
  options: GraphGroupsOptions,
): Promise<GroupListing> {
  if (!options.applicationPermissions) {
    return {
      kind: 'not_enumerable',
      reason: groupsNotEnumerable(
        'this connection uses delegated permissions, which can only read the ' +
          'signed-in user and the groups they belong to. Enumerating a tenant’s ' +
          'groups needs the Group.Read.All application permission and admin ' +
          'consent — see docs/o365-application-access.md',
      ),
    };
  }

  const base = (options.baseUrl ?? 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');
  const size = options.pageSize ?? 100;
  const raw: GraphGroup[] = [];
  let url: string | undefined =
    `${base}/groups?$filter=mailEnabled%20eq%20true` +
    `&$select=id,displayName,mail,mailEnabled,groupTypes&$top=${size}`;
  let pages = 0;

  while (url) {
    if (++pages > MAX_PAGES) {
      return {
        kind: 'not_enumerable',
        reason: groupsNotEnumerable(
          `the directory did not stop paging after ${pages - 1} pages — refusing to ` +
            'keep going rather than report a partial list as complete',
        ),
      };
    }

    const page: Fetched<GraphGroupPage> = await getJson(url, token, httpClient);
    if (!page.ok) return { kind: 'not_enumerable', reason: groupsNotEnumerable(page.reason) };

    raw.push(...(page.value.value ?? []));
    url = page.value['@odata.nextLink'];
  }

  const groups: DiscoveredGroup[] = [];
  for (const group of raw) {
    const address = (group.mail ?? '').trim();
    // No address means nothing anybody sends to; §14.1 is about shared
    // ADDRESSES. No id means we cannot ask who is in it either.
    if (address === '' || !group.id) continue;

    groups.push({
      id: group.id,
      address,
      ...(group.displayName ? { displayName: group.displayName } : {}),
      store: classifyStore(group),
      members: await listGroupMembers(group.id, token, httpClient, { baseUrl: base, pageSize: size }),
    });
  }

  log.debug(`[graph-groups] listed ${groups.length} mail-enabled group(s) across ${pages} page(s)`);
  return { kind: 'listed', groups };
}

/**
 * Microsoft's vocabulary → "does it have a store". Not a §14.1 judgement;
 * that one is `classifySharedAddress` in `@openmig/core`.
 */
function classifyStore(group: GraphGroup): GroupStore {
  // `groupTypes` absent is not the same as empty: absent means the directory
  // did not tell us (a `$select` that dropped it, a future group kind), and
  // guessing "distribution list" there would classify an M365 group with a
  // full mailbox as having nothing to copy.
  if (group.groupTypes === undefined) return 'unknown';
  if (group.groupTypes.includes('Unified')) return 'has_store';
  if (group.mailEnabled === true) return 'no_store';
  return 'unknown';
}

/**
 * The group's members, as addresses.
 *
 * Returns `not_enumerable` on every failure rather than a short list: a member
 * list that silently loses half its entries would have Pattern D recreate a
 * group missing the people who were not read.
 */
export async function listGroupMembers(
  groupId: string,
  token: () => Promise<string>,
  httpClient: HttpClient,
  options: { readonly baseUrl?: string; readonly pageSize?: number } = {},
): Promise<DirectoryListing> {
  const base = (options.baseUrl ?? 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');
  const size = options.pageSize ?? 100;
  const addresses: string[] = [];
  let url: string | undefined =
    `${base}/groups/${encodeURIComponent(groupId)}/members` +
    `?$select=mail,userPrincipalName&$top=${size}`;
  let pages = 0;

  while (url) {
    if (++pages > MAX_PAGES) {
      return {
        kind: 'not_enumerable',
        reason:
          `the member list did not stop paging after ${pages - 1} pages — refusing ` +
          'to report a partial membership as complete',
      };
    }

    const page: Fetched<GraphMemberPage> = await getJson(url, token, httpClient);
    if (!page.ok) return { kind: 'not_enumerable', reason: page.reason };

    for (const member of page.value.value ?? []) {
      // Nested groups and service principals come back without either field;
      // they are not addresses a message can be delivered to.
      const address = (member.mail ?? member.userPrincipalName ?? '').trim();
      if (address !== '') addresses.push(address);
    }

    url = page.value['@odata.nextLink'];
  }

  return { kind: 'listed', addresses };
}

type Fetched<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** One GET, with every way it can fail turned into a sentence. */
async function getJson<T>(
  url: string,
  token: () => Promise<string>,
  httpClient: HttpClient,
): Promise<Fetched<T>> {
  let res;
  try {
    res = await httpClient.request({
      url,
      method: 'GET',
      headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' },
    });
  } catch (err) {
    // A transport failure is not "no groups".
    return { ok: false, reason: `the request failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (res.status !== 200) {
    // Graph's own words: a 403 here usually means consent was granted but the
    // Application Access Policy excludes this app, and the operator needs the
    // server's text to tell those apart.
    return { ok: false, reason: `Graph answered ${res.status}: ${res.body}` };
  }

  try {
    return { ok: true, value: JSON.parse(res.body) as T };
  } catch (err) {
    return {
      ok: false,
      reason: `the response was not JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
