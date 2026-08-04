// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Reading permissions off the source (workplan 0029 T1).
 *
 * The most important test in this file is the one asserting that mailbox
 * delegation CANNOT be read. FullAccess and SendAs are the rights whose
 * silent loss at cutover §14.2 exists to prevent, and the Graph API this
 * tool speaks does not expose them — a report that omitted that would be
 * worse than no report, because it would read as "nothing was delegated".
 */

import { describe, it, expect, vi } from 'vitest';
import {
  mailboxDelegations,
  listCalendarPermissions,
  listDriveItemPermissions,
} from './graph-permissions';
import type { HttpClient } from './dav-http.types';

const token = async () => 'tok';
const APP = { applicationPermissions: true } as const;

function client(...responses: Array<{ status: number; body: string }>): HttpClient {
  let i = 0;
  return {
    request: vi.fn(async () => {
      const res = responses[Math.min(i++, responses.length - 1)]!;
      return { status: res.status, body: res.body, headers: {} };
    }),
  } as unknown as HttpClient;
}

const page = (value: unknown[], nextLink?: string) => ({
  status: 200,
  body: JSON.stringify({ value, ...(nextLink ? { '@odata.nextLink': nextLink } : {}) }),
});

describe('mailbox delegation', () => {
  it('reports that it cannot be read, and names the tool that can', () => {
    const result = mailboxDelegations();

    expect(result.kind).toBe('not_discoverable');
    if (result.kind !== 'not_discoverable') return;
    // The operator learns what to do, not just that something is missing.
    expect(result.reason).toContain('Get-MailboxPermission');
    expect(result.reason).toContain('Get-RecipientPermission');
    // And the sentence refuses the reading it would otherwise get.
    expect(result.reason).toContain('not "no permissions are set"');
    expect(result.reason).toContain('stop working');
  });
});

describe('calendar sharing', () => {
  it('lists who a calendar is shared with, and how', async () => {
    const http = client(
      page([{ role: 'read', emailAddress: { address: 'anna@acme.nl', name: 'Anna' } }]),
    );
    const result = await listCalendarPermissions(
      'rob@acme.nl',
      'cal-1',
      'Rob — Calendar',
      token,
      http,
      APP,
    );

    expect(result.kind).toBe('listed');
    if (result.kind !== 'listed') return;
    expect(result.grants[0]).toMatchObject({
      subject: 'calendar',
      on: 'Rob — Calendar',
      grantee: 'anna@acme.nl',
      role: 'read',
    });
    // The source's own words, kept for the report and for re-checking.
    expect(result.grants[0]?.raw).toContain('anna@acme.nl');
  });

  it('drops an entry that grants nothing', async () => {
    // Graph's `none` is an entry with no access; reporting it would send
    // somebody to remove a share that grants nothing.
    const http = client(page([{ role: 'none', emailAddress: { address: 'x@acme.nl' } }]));
    const result = await listCalendarPermissions('rob@acme.nl', 'c', 'Cal', token, http, APP);

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.grants).toEqual([]);
  });

  it('refuses a delegated connection before making a request', async () => {
    const http = client(page([]));
    const result = await listCalendarPermissions('rob@acme.nl', 'c', 'Cal', token, http, {
      applicationPermissions: false,
    });

    expect(result.kind).toBe('not_discoverable');
    if (result.kind === 'not_discoverable') {
      expect(result.reason).toContain('docs/o365-application-access.md');
    }
    expect(http.request).not.toHaveBeenCalled();
  });

  it('escapes the mailbox and calendar into the path', async () => {
    const http = client(page([]));
    await listCalendarPermissions('a/b@acme.nl', 'c?d', 'Cal', token, http, APP);

    const url = (http.request as unknown as { mock: { calls: Array<[{ url: string }]> } }).mock
      .calls[0]![0].url;
    // A raw value with a slash would change which endpoint is called.
    expect(url).toContain('/users/a%2Fb%40acme.nl/calendars/c%3Fd/calendarPermissions');
  });
});

describe('drive sharing', () => {
  it('tells a sharing LINK apart from a person', async () => {
    const http = client(
      page([
        { roles: ['write'], link: { scope: 'anonymous', type: 'edit', webUrl: 'https://x' } },
        { roles: ['read'], grantedToV2: { user: { email: 'anna@acme.nl' } } },
      ]),
    );
    const result = await listDriveItemPermissions('d1', 'i1', '/Shared/Budget.xlsx', token, http, APP);

    if (result.kind !== 'listed') throw new Error('expected a listing');
    // "Anyone with this link can edit" is the finding an owner most often
    // does not know about; flattening it into a list of names hides it.
    expect(result.grants[0]).toMatchObject({ viaLink: true, role: 'write' });
    expect(result.grants[0]?.grantee).toBeUndefined();
    expect(result.grants[1]).toMatchObject({ grantee: 'anna@acme.nl', role: 'read' });
    expect(result.grants[1]?.viaLink).toBeUndefined();
  });

  it('falls back through the ways Graph names a grantee', async () => {
    const http = client(
      page([
        { roles: ['read'], grantedTo: { user: { displayName: 'Jan' } } },
        { roles: ['read'], invitation: { email: 'extern@partner.nl' } },
      ]),
    );
    const result = await listDriveItemPermissions('d', 'i', 'file', token, http, APP);

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.grants[0]?.grantee).toBe('Jan');
    // An invitation to somebody outside the tenant is exactly the grant an
    // owner should see before cutover.
    expect(result.grants[1]?.grantee).toBe('extern@partner.nl');
  });

  it('drops an entry with no roles', async () => {
    const http = client(page([{ grantedToV2: { user: { email: 'x@acme.nl' } } }]));
    const result = await listDriveItemPermissions('d', 'i', 'file', token, http, APP);

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.grants).toEqual([]);
  });

  it('follows paging', async () => {
    const http = client(page([{ roles: ['read'] }], 'https://graph/next'), page([{ roles: ['write'] }]));
    const result = await listDriveItemPermissions('d', 'i', 'file', token, http, APP);

    if (result.kind !== 'listed') throw new Error('expected a listing');
    expect(result.grants.map((g) => g.role)).toEqual(['read', 'write']);
  });
});

describe('when a read fails', () => {
  it('carries Graph’s own words on an error status', async () => {
    const http = client({ status: 403, body: 'Access denied' });
    const result = await listDriveItemPermissions('d', 'i', 'file', token, http, APP);

    expect(result.kind).toBe('not_discoverable');
    if (result.kind !== 'not_discoverable') return;
    // A 403 usually means consent was granted but the Access Policy excludes
    // this app — the operator needs the server's text to tell those apart.
    expect(result.reason).toContain('403');
    expect(result.reason).toContain('Access denied');
  });

  it('does not turn a transport failure into “nothing is shared”', async () => {
    const http = {
      request: vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    } as unknown as HttpClient;
    const result = await listCalendarPermissions('rob@acme.nl', 'c', 'Cal', token, http, APP);

    expect(result.kind).toBe('not_discoverable');
    if (result.kind === 'not_discoverable') expect(result.reason).toContain('ECONNRESET');
  });

  it('does not turn a malformed body into “nothing is shared”', async () => {
    const http = client({ status: 200, body: '<html>sign in</html>' });
    const result = await listCalendarPermissions('rob@acme.nl', 'c', 'Cal', token, http, APP);

    expect(result.kind).toBe('not_discoverable');
    if (result.kind === 'not_discoverable') expect(result.reason).toContain('not JSON');
  });

  it('refuses to report a partial set as complete', async () => {
    // A nextLink that never ends would otherwise page forever, or — worse —
    // be cut short and reported as the whole picture.
    const http = client(page([{ roles: ['read'] }], 'https://graph/loop'));
    const result = await listDriveItemPermissions('d', 'i', 'file', token, http, APP);

    expect(result.kind).toBe('not_discoverable');
    if (result.kind === 'not_discoverable') expect(result.reason).toContain('partial set');
  });
});
