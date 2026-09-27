// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Each DAV target writer's own `removeItem`, wired through to the shared
 * `removeDavResource` helper — the sequence itself is tested in
 * `dav-remove.unit.test.ts`; this is about each writer building the right URL,
 * auth header and (for calendar/contacts) forced `kind` from ITS OWN config.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';

const TENANT = asTenantId('6d330000-e29b-41d4-a716-4466554472a1' as never);
const MAPPING = asMappingId('6d330000-e29b-41d4-a716-4466554472a2' as never);

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

interface Call {
  method: string;
  url: string;
  headers?: Record<string, string>;
}

function client(deleteStatus = 204) {
  const calls: Call[] = [];
  const httpClient: HttpClient = {
    async request(o) {
      calls.push({ method: o.method, url: o.url, headers: o.headers });
      if (o.method === 'DELETE') return { status: deleteStatus, body: '', headers: {} };
      return { status: 200, body: '', headers: {} };
    },
  };
  return { calls, httpClient };
}

describe('CalDAVTargetWriter.removeItem', () => {
  it('DELETEs the href and always reports deleted, never binned', async () => {
    const c = client();
    const writer = new CalDAVTargetWriter(
      { url: 'https://cloud.example.com/remote.php/dav', username: 'alice', password: 'pw' },
      { domain: 'calendar', ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: c.httpClient },
    );

    const result = await writer.removeItem('calendars/alice/personal/evt-1.ics', { expectedTargetVersion: 'v1' });

    expect(result).toEqual({ kind: 'deleted' });
    const deletes = c.calls.filter((call) => call.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.url).toBe(
      'https://cloud.example.com/remote.php/dav/calendars/alice/personal/evt-1.ics',
    );
    expect(deletes[0]!.headers?.Authorization).toMatch(/^Basic /);
  });

  it('forces deleted even against a Nextcloud-files-shaped path', async () => {
    // Never actually happens for calendar data, but the rule is: calendar and
    // contacts NEVER claim `binned`, because whether Nextcloud keeps a deleted
    // calendar object is version-dependent and this code cannot tell.
    const c = client();
    const writer = new CalDAVTargetWriter(
      { url: 'https://cloud.example.com/remote.php/dav', username: 'alice', password: 'pw' },
      { domain: 'calendar', ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: c.httpClient },
    );

    const result = await writer.removeItem('files/alice/evt-1.ics', { expectedTargetVersion: 'v1' });
    expect(result).toEqual({ kind: 'deleted' });
  });
});

describe('CardDAVTargetWriter.removeItem', () => {
  it('DELETEs the href and always reports deleted', async () => {
    const c = client();
    const writer = new CardDAVTargetWriter(
      { url: 'https://cloud.example.com/remote.php/dav', username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: c.httpClient },
    );

    const result = await writer.removeItem('addressbooks/alice/contacts/card-1.vcf', { expectedTargetVersion: 'v1' });

    expect(result).toEqual({ kind: 'deleted' });
    expect(c.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
});

describe('WebDAVTargetWriter.removeItem', () => {
  it('reports binned for a file under the account\'s own files endpoint', async () => {
    const c = client();
    const writer = new WebDAVTargetWriter(
      { url: 'https://cloud.example.com/remote.php/dav/files/alice', username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: c.httpClient },
    );

    const result = await writer.removeItem('report.pdf', { expectedTargetVersion: 'v1' });

    expect(result).toEqual({ kind: 'binned' });
    const deletes = c.calls.filter((call) => call.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.url).toBe('https://cloud.example.com/remote.php/dav/files/alice/report.pdf');
  });

  it('reports deleted for a plain (non-Nextcloud) WebDAV target', async () => {
    const c = client();
    const writer = new WebDAVTargetWriter(
      { url: 'https://dav.example.com/webdav', username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: c.httpClient },
    );

    const result = await writer.removeItem('report.pdf', { expectedTargetVersion: 'v1' });
    expect(result).toEqual({ kind: 'deleted' });
  });

  it('refuses when the target has been edited: the server checks the version it is sent', async () => {
    // A server that honours If-Match, as a real one does, holding somebody
    // else's edit. The DELETE goes out with our version and is refused
    // (workplan 0149 T3); it used to be a HEAD and a comparison first.
    const calls: Call[] = [];
    const current = '"someone-elses-edit"';
    const httpClient: HttpClient = {
      async request(o): Promise<{ status: number; body: string; headers: Record<string, string> }> {
        calls.push({ method: o.method, url: o.url, headers: o.headers });
        if (o.method === 'HEAD') return { status: 200, body: '', headers: { etag: current } };
        if (o.headers?.['If-Match'] !== current) return { status: 412, body: '', headers: {} };
        return { status: 204, body: '', headers: {} };
      },
    };
    const writer = new WebDAVTargetWriter(
      { url: 'https://cloud.example.com/remote.php/dav/files/alice', username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient },
    );

    const result = await writer.removeItem('report.pdf', { expectedTargetVersion: 'our-etag' });

    expect(result).toEqual({ conflicted: true });
    expect(calls.find((c) => c.method === 'DELETE')?.headers?.['If-Match']).toBe('"our-etag"');
  });
});

describe('all three refuse nothing silently on a real failure', () => {
  it('propagates a genuine server error instead of reporting success', async () => {
    const c = client(500);
    const writer = new CalDAVTargetWriter(
      { url: 'https://cloud.example.com/remote.php/dav', username: 'alice', password: 'pw' },
      { domain: 'calendar', ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: c.httpClient },
    );

    await expect(writer.removeItem('calendars/alice/personal/evt-1.ics', { expectedTargetVersion: 'v1' })).rejects.toThrow();
  });
});
