// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Listing a tenant's mail-enabled groups (workplan 0027 T1).
 *
 * Two questions run through every test. Does a failure SAY so instead of
 * arriving as an empty list (rule 9) — for the group list AND, separately, for
 * each group's member list, because Pattern D recreates a group from exactly
 * that list. And is the store signal read from what the directory actually
 * stated, rather than guessed when it stated nothing.
 */

import { describe, it, expect, vi } from 'vitest';
import { listMailEnabledGroups, listGroupMembers } from './graph-groups.ts';
import { listImapGroups } from './imap-groups.ts';
import type { HttpClient } from './dav-http.types.ts';

const token = async () => 'tok';

/** Answers by URL substring, so group and member reads can differ. */
function routed(routes: Array<[match: string, res: { status: number; body: string }]>): HttpClient {
  return {
    request: vi.fn(async ({ url }: { url: string }) => {
      const hit = routes.find(([match]) => url.includes(match));
      if (!hit) throw new Error(`no route for ${url}`);
      return { status: hit[1].status, body: hit[1].body, headers: {} };
    }),
  } as unknown as HttpClient;
}

const groupPage = (
  groups: Array<Record<string, unknown>>,
  nextLink?: string,
): { status: number; body: string } => ({
  status: 200,
  body: JSON.stringify({ value: groups, ...(nextLink ? { '@odata.nextLink': nextLink } : {}) }),
});

const memberPage = (
  members: Array<Record<string, unknown>>,
  nextLink?: string,
): { status: number; body: string } => ({
  status: 200,
  body: JSON.stringify({ value: members, ...(nextLink ? { '@odata.nextLink': nextLink } : {}) }),
});

const DL = { id: 'g1', mail: 'sales@acme.nl', displayName: 'Sales', mailEnabled: true, groupTypes: [] };
const M365 = {
  id: 'g2',
  mail: 'team@acme.nl',
  displayName: 'Team',
  mailEnabled: true,
  groupTypes: ['Unified'],
};

describe('a delegated connection', () => {
  it('refuses before making a request, and names the permission', async () => {
    const http = routed([['/groups', groupPage([])]]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: false });

    expect(result.kind).toBe('not_enumerable');
    if (result.kind === 'not_enumerable') {
      expect(result.reason).toContain('Group.Read.All');
      expect(result.reason).toContain('docs/o365-application-access.md');
      // The sentence has to refuse the reading it would otherwise get.
      expect(result.reason).toContain('nothing was looked at');
    }
    expect(http.request).not.toHaveBeenCalled();
  });
});

describe('the store signal', () => {
  it('reads a distribution list as having NO store', async () => {
    const http = routed([
      ['/groups?', groupPage([DL])],
      ['/members', memberPage([{ mail: 'rob@acme.nl' }])],
    ]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    expect(result.kind).toBe('listed');
    if (result.kind !== 'listed') return;
    expect(result.groups[0]).toMatchObject({ address: 'sales@acme.nl', store: 'no_store' });
  });

  it('reads an M365 (Unified) group as HAVING a store', async () => {
    // §14.1 is explicit: an M365 group with a store is Pattern S, not D.
    const http = routed([
      ['/groups?', groupPage([M365])],
      ['/members', memberPage([])],
    ]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.groups[0]?.store).toBe('has_store');
  });

  it('says UNKNOWN when the directory did not state the type', async () => {
    // Absent is not empty. Guessing "distribution list" here would classify a
    // group with a full mailbox as having nothing to copy.
    const http = routed([
      ['/groups?', groupPage([{ id: 'g3', mail: 'x@acme.nl', mailEnabled: true }])],
      ['/members', memberPage([])],
    ]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.groups[0]?.store).toBe('unknown');
  });
});

describe('what is left out', () => {
  it('skips a group with no address', async () => {
    // §14.1 is about addresses people send to; a group without one is not a
    // shared address, whatever else it is.
    const http = routed([
      ['/groups?', groupPage([{ id: 'g4', mailEnabled: true, groupTypes: [] }, DL])],
      ['/members', memberPage([])],
    ]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.groups.map((g) => g.address)).toEqual(['sales@acme.nl']);
  });

  it('follows the directory’s paging', async () => {
    const http = routed([
      ['$skiptoken', groupPage([M365])],
      ['/groups?', groupPage([DL], 'https://graph.microsoft.com/v1.0/groups?$skiptoken=abc')],
      ['/members', memberPage([])],
    ]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.groups.map((g) => g.address)).toEqual(['sales@acme.nl', 'team@acme.nl']);
  });
});

describe('when the group read fails', () => {
  it('reports Graph’s own words on an error status', async () => {
    const http = routed([['/groups', { status: 403, body: 'Insufficient privileges' }]]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    expect(result.kind).toBe('not_enumerable');
    if (result.kind !== 'not_enumerable') return;
    // A 403 usually means consent was granted but the Access Policy excludes
    // this app — the operator needs the server's text to tell those apart.
    expect(result.reason).toContain('403');
    expect(result.reason).toContain('Insufficient privileges');
  });

  it('does not turn a transport failure into “no groups”', async () => {
    const http = {
      request: vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    } as unknown as HttpClient;
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    expect(result.kind).toBe('not_enumerable');
    if (result.kind === 'not_enumerable') expect(result.reason).toContain('ECONNRESET');
  });

  it('does not turn a malformed body into “no groups”', async () => {
    const http = routed([['/groups', { status: 200, body: '<html>sign in</html>' }]]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    expect(result.kind).toBe('not_enumerable');
    if (result.kind === 'not_enumerable') expect(result.reason).toContain('not JSON');
  });
});

describe('the member list, which fails on its own', () => {
  it('carries not_enumerable per group rather than an empty membership', async () => {
    const http = routed([
      ['/groups?', groupPage([DL])],
      ['/members', { status: 403, body: 'no member access' }],
    ]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    if (result.kind !== 'listed') throw new Error('expected a listing');
    // The group exists — that much was read. Who is in it was not, and
    // Pattern D recreates a group from exactly this list.
    expect(result.groups[0]?.members).toMatchObject({ kind: 'not_enumerable' });
  });

  it('keeps the OTHER groups when one group’s members cannot be read', async () => {
    const http = {
      request: vi.fn(async ({ url }: { url: string }) => {
        if (url.includes('/groups/g1/members')) return { status: 500, body: 'boom', headers: {} };
        if (url.includes('/members')) return { ...memberPage([{ mail: 'rob@acme.nl' }]), headers: {} };
        return { ...groupPage([DL, M365]), headers: {} };
      }),
    } as unknown as HttpClient;
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.groups[0]?.members.kind).toBe('not_enumerable');
    expect(result.groups[1]?.members).toEqual({ kind: 'listed', addresses: ['rob@acme.nl'] });
  });

  it('drops members that are not addresses', async () => {
    // Nested groups and service principals come back with neither field;
    // nothing can be delivered to them.
    const http = routed([
      ['/groups?', groupPage([DL])],
      ['/members', memberPage([{ mail: 'rob@acme.nl' }, { id: 'nested-group' }, {}])],
    ]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.groups[0]?.members).toEqual({ kind: 'listed', addresses: ['rob@acme.nl'] });
  });

  it('falls back to the UPN when a member has no mail attribute', async () => {
    const http = routed([
      ['/groups?', groupPage([DL])],
      ['/members', memberPage([{ userPrincipalName: 'jan@acme.nl' }])],
    ]);
    const result = await listMailEnabledGroups(token, http, { applicationPermissions: true });

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.groups[0]?.members).toEqual({ kind: 'listed', addresses: ['jan@acme.nl'] });
  });

  it('pages the membership', async () => {
    const http = routed([
      ['$skiptoken', memberPage([{ mail: 'b@acme.nl' }])],
      ['/members', memberPage([{ mail: 'a@acme.nl' }], 'https://graph.microsoft.com/v1.0/x?$skiptoken=1')],
    ]);
    const members = await listGroupMembers('g1', token, http);

    expect(members).toEqual({ kind: 'listed', addresses: ['a@acme.nl', 'b@acme.nl'] });
  });

  it('escapes the group id into the path', async () => {
    const http = routed([['/members', memberPage([])]]);
    await listGroupMembers('a/b?c', token, http);

    const url = (http.request as unknown as { mock: { calls: Array<[{ url: string }]> } }).mock
      .calls[0]![0].url;
    // A raw id with a slash would change which endpoint is called.
    expect(url).toContain('/groups/a%2Fb%3Fc/members');
  });
});

describe('IMAP', () => {
  it('says it cannot look, rather than returning an empty list', async () => {
    const result = listImapGroups();

    expect(result.kind).toBe('not_enumerable');
    if (result.kind !== 'not_enumerable') return;
    // The regression this guards: somebody later returning `[]` to make a
    // screen look tidier, which reads as "this tenant has no shared addresses".
    expect(result.reason).toContain('IMAP has no directory');
    expect(result.reason).toContain('nothing was looked at');
  });
});
