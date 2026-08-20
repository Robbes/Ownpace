// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Listing a tenant's mailboxes (workplan 0028 T2).
 *
 * Every test here is a variant of one question: when this cannot answer, does
 * it SAY so? An empty list and a failed read are the same value in most APIs,
 * and here they must never be — one means the tenant is covered, the other
 * means nobody is watching it (hard rule 9).
 */

import { describe, it, expect, vi } from 'vitest';
import { listTenantMailboxes } from './graph-directory.ts';
import type { HttpClient } from './dav-http.types.ts';

const token = async () => 'tok';

function client(...responses: Array<{ status: number; body: string }>): HttpClient {
  let i = 0;
  return {
    request: vi.fn(async () => {
      const res = responses[Math.min(i++, responses.length - 1)]!;
      return { status: res.status, body: res.body, headers: {} };
    }),
  } as unknown as HttpClient;
}

const page = (users: Array<{ mail?: string; userPrincipalName?: string }>, nextLink?: string) =>
  JSON.stringify({ value: users, ...(nextLink ? { '@odata.nextLink': nextLink } : {}) });

describe('a delegated connection', () => {
  it('refuses before making a request, and names the fix', async () => {
    const http = client({ status: 200, body: page([]) });
    const result = await listTenantMailboxes(token, http, { applicationPermissions: false });

    expect(result.kind).toBe('not_enumerable');
    if (result.kind === 'not_enumerable') {
      expect(result.reason).toContain('delegated permissions');
      // The operator learns what to change, not just what broke.
      expect(result.reason).toContain('docs/o365-application-access.md');
    }
    // Not even attempted: Graph would answer 403 and the message would be worse.
    expect(http.request).not.toHaveBeenCalled();
  });
});

describe('a successful read', () => {
  it('returns the addresses it found', async () => {
    const http = client({
      status: 200,
      body: page([{ mail: 'anna@acme.nl' }, { mail: 'info@acme.nl' }]),
    });
    const result = await listTenantMailboxes(token, http, { applicationPermissions: true });

    expect(result).toEqual({ kind: 'listed', addresses: ['anna@acme.nl', 'info@acme.nl'] });
  });

  it('falls back to the UPN when mail is unset', async () => {
    // Some tenants leave `mail` unset on perfectly real mailboxes; dropping
    // those would hide a mailbox somebody expects to see.
    const http = client({ status: 200, body: page([{ userPrincipalName: 'anna@acme.nl' }]) });
    const result = await listTenantMailboxes(token, http, { applicationPermissions: true });
    expect(result).toMatchObject({ addresses: ['anna@acme.nl'] });
  });

  it('skips an account with no address at all', async () => {
    const http = client({ status: 200, body: page([{}, { mail: 'info@acme.nl' }]) });
    const result = await listTenantMailboxes(token, http, { applicationPermissions: true });
    expect(result).toMatchObject({ addresses: ['info@acme.nl'] });
  });

  it('follows paging', async () => {
    const http = client(
      { status: 200, body: page([{ mail: 'a@acme.nl' }], 'https://graph/next') },
      { status: 200, body: page([{ mail: 'b@acme.nl' }]) },
    );
    const result = await listTenantMailboxes(token, http, { applicationPermissions: true });
    expect(result).toMatchObject({ addresses: ['a@acme.nl', 'b@acme.nl'] });
  });

  it('reads an empty tenant as listed-and-empty, not as a failure', async () => {
    // It looked. Nothing there. That is a real answer and must not be dressed
    // up as a blind spot either — the union cuts both ways.
    const http = client({ status: 200, body: page([]) });
    const result = await listTenantMailboxes(token, http, { applicationPermissions: true });
    expect(result).toEqual({ kind: 'listed', addresses: [] });
  });
});

describe('everything that can go wrong reports that it went wrong', () => {
  it('carries Graph’s own words on an error status', async () => {
    const http = client({
      status: 403,
      body: '{"error":{"message":"Access denied by application access policy"}}',
    });
    const result = await listTenantMailboxes(token, http, { applicationPermissions: true });

    expect(result.kind).toBe('not_enumerable');
    if (result.kind === 'not_enumerable') {
      // Consent-granted-but-policy-excludes vs consent-missing are different
      // problems with different fixes, and only Graph's text tells them apart.
      expect(result.reason).toContain('Access denied by application access policy');
      expect(result.reason).toContain('403');
    }
  });

  it('reports a transport failure rather than an empty tenant', async () => {
    const http = {
      request: vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND graph.microsoft.com');
      }),
    } as unknown as HttpClient;
    const result = await listTenantMailboxes(token, http, { applicationPermissions: true });

    expect(result.kind).toBe('not_enumerable');
    if (result.kind === 'not_enumerable') {
      expect(result.reason).toContain('ENOTFOUND');
    }
  });

  it('reports a malformed response rather than parsing to nothing', async () => {
    const http = client({ status: 200, body: '<html>proxy error</html>' });
    const result = await listTenantMailboxes(token, http, { applicationPermissions: true });
    expect(result.kind).toBe('not_enumerable');
  });

  it('refuses to report a partial list as complete when paging will not end', async () => {
    // A nextLink that always points at another page would otherwise loop, or
    // — worse — be cut short and returned as if it were the whole directory.
    const http = client({ status: 200, body: page([{ mail: 'a@acme.nl' }], 'https://graph/next') });
    const result = await listTenantMailboxes(token, http, { applicationPermissions: true });

    expect(result.kind).toBe('not_enumerable');
    if (result.kind === 'not_enumerable') {
      expect(result.reason).toContain('did not stop paging');
    }
  });

  it('always says "nothing was looked at" so a caller cannot misread it', async () => {
    const http = client({ status: 500, body: 'boom' });
    const result = await listTenantMailboxes(token, http, { applicationPermissions: true });
    if (result.kind === 'not_enumerable') {
      expect(result.reason).toContain('nothing was looked at');
    }
  });
});
