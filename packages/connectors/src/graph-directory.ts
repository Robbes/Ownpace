// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Listing a tenant's mailboxes (workplan 0028 T2, on 0027 T0's auth model).
 *
 * `/users` is an APPLICATION-permission endpoint: there is no delegated way to
 * enumerate other people's mailboxes, which is the whole reason 0027 T0 had to
 * come first. A connector configured for delegated `/me` access cannot answer
 * this question, and says so — it does not return an empty list.
 *
 * That distinction is the point of this file. `listMailboxes` returns a
 * `DirectoryListing`, a union of "I looked, here they are" and "I could not
 * look, and here is why", so a caller cannot accidentally read the second as
 * the first (hard rule 9). Every failure path below produces the second: no
 * permission, an HTTP error, a malformed page. None of them yields `[]`.
 */

import { log, type DirectoryListing } from '@openmig/shared';
import type { HttpClient } from './dav-http.types.ts';
import { directoryNotEnumerable } from './graph-scope.ts';

/** Just the fields the detector needs from a Graph user. */
interface GraphUser {
  readonly userPrincipalName?: string;
  readonly mail?: string;
}

interface GraphUserPage {
  readonly value?: readonly GraphUser[];
  readonly '@odata.nextLink'?: string;
}

export interface GraphDirectoryOptions {
  readonly baseUrl?: string;
  /**
   * Whether this connection holds APPLICATION permissions. Delegated
   * connections cannot read `/users` at all, and saying so up front produces a
   * better sentence than letting Graph answer 403 — the operator learns what
   * to change rather than what broke.
   */
  readonly applicationPermissions: boolean;
  /** Page size. Graph's default is 100; the cap is 999. */
  readonly pageSize?: number;
}

/**
 * Enumerate the mailboxes in the source tenant.
 *
 * Returns every address it can see. Filtering to "which of these are actually
 * mailboxes rather than accounts without one" is deliberately NOT done here:
 * `mail` being present is the closest signal Graph offers, and a user with no
 * `mail` is skipped, but beyond that this reports what the directory says and
 * lets the detector and the owner decide. Guessing harder would mean silently
 * hiding a mailbox somebody expected to see.
 */
export async function listTenantMailboxes(
  token: () => Promise<string>,
  httpClient: HttpClient,
  options: GraphDirectoryOptions,
): Promise<DirectoryListing> {
  if (!options.applicationPermissions) {
    return {
      kind: 'not_enumerable',
      reason: directoryNotEnumerable(
        'this connection uses delegated permissions, which can only read the ' +
          'signed-in mailbox (/me). Enumerating a tenant needs application ' +
          'permissions and admin consent — see docs/o365-application-access.md',
      ),
    };
  }

  const base = (options.baseUrl ?? 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');
  const size = options.pageSize ?? 100;
  const addresses: string[] = [];
  let url: string | undefined = `${base}/users?$select=userPrincipalName,mail&$top=${size}`;
  let pages = 0;

  while (url) {
    // A tenant with tens of thousands of users would otherwise page forever on
    // a malformed nextLink; 200 pages at 100 each is far past any SMB.
    if (++pages > 200) {
      return {
        kind: 'not_enumerable',
        reason: directoryNotEnumerable(
          `the directory did not stop paging after ${pages - 1} pages — refusing to ` +
            'keep going rather than report a partial list as complete',
        ),
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
      // A transport failure is not "no mailboxes".
      return {
        kind: 'not_enumerable',
        reason: directoryNotEnumerable(
          `the request failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }

    if (res.status !== 200) {
      return {
        kind: 'not_enumerable',
        // Graph's own words: a 403 here usually means consent was granted but
        // the Application Access Policy excludes this app, and the operator
        // needs the server's text to tell those apart.
        reason: directoryNotEnumerable(`Graph answered ${res.status}: ${res.body}`),
      };
    }

    let page: GraphUserPage;
    try {
      page = JSON.parse(res.body) as GraphUserPage;
    } catch (err) {
      return {
        kind: 'not_enumerable',
        reason: directoryNotEnumerable(
          `the directory response was not JSON: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }

    for (const user of page.value ?? []) {
      // `mail` is the address that receives; a user without one has no mailbox
      // to migrate. `userPrincipalName` is the fallback because some tenants
      // leave `mail` unset on perfectly real mailboxes.
      const address = (user.mail ?? user.userPrincipalName ?? '').trim();
      if (address !== '') addresses.push(address);
    }

    url = page['@odata.nextLink'];
  }

  log.debug(`[graph-directory] listed ${addresses.length} mailboxes across ${pages} page(s)`);
  return { kind: 'listed', addresses };
}
