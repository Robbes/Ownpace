// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The shared Graph mail construction, tested directly (workplan 0041).
 *
 * Both editions already cover this through their own builders —
 * `build-deps.unit.test.ts` via OAUTH2_* env vars, and
 * `build-deps-from-mapping.unit.test.ts` via decrypted credentials — and those
 * stay exactly as they were; the collapse is a refactor, so a test needing edits
 * would have meant a behaviour change.
 *
 * What they cannot do is say WHERE the behaviour lives. Both reach it through a
 * caller, so a refusal proven twice looks like two implementations agreeing
 * rather than one implementation used twice. These pin the shared function
 * itself, with no env var and no database anywhere near them.
 */

import { describe, it, expect } from 'vitest';
import { GraphMailSource } from '@openmig/connectors';
import { buildGraphMailSourceFrom } from './mail-source-factory';

const TENANT = { tenantId: 'contoso.example' };

describe('buildGraphMailSourceFrom', () => {
  it('builds a GraphMailSource on the client-credentials flow', () => {
    const source = buildGraphMailSourceFrom(TENANT, {
      clientId: 'app-id',
      clientSecret: 'app-secret',
    });
    expect(source).toBeInstanceOf(GraphMailSource);
  });

  it('builds a GraphMailSource on the delegated flow', () => {
    const source = buildGraphMailSourceFrom(TENANT, {
      clientId: 'app-id',
      refreshToken: 'a-delegated-refresh-token',
    });
    expect(source).toBeInstanceOf(GraphMailSource);
  });

  it('reads a NAMED mailbox on the client-credentials flow (the shared-mailbox path)', () => {
    const source = buildGraphMailSourceFrom(
      { ...TENANT, mailbox: 'gedeeld@contoso.nl' },
      { clientId: 'app-id', clientSecret: 'app-secret' },
    );
    expect(source).toBeInstanceOf(GraphMailSource);
  });

  it('REFUSES a named mailbox on the delegated flow, naming the fix', () => {
    // The failure this prevents: a delegated token against /users/{address}
    // gets a bare 403 from Graph, and the operator reads an access-denied error
    // that says nothing about which of the two flows they are on. This refusal
    // used to exist in two copies; it is now proven where it actually lives.
    expect(() =>
      buildGraphMailSourceFrom(
        { ...TENANT, mailbox: 'gedeeld@contoso.nl' },
        { clientId: 'app-id', refreshToken: 'a-delegated-refresh-token' },
      ),
    ).toThrow(/names another user's mailbox/);
  });

  it('allows the delegated flow when no mailbox is named', () => {
    // The other side of the refusal above — /me needs no application
    // permissions, so a refresh token alone is entirely legitimate.
    expect(() =>
      buildGraphMailSourceFrom(TENANT, {
        clientId: 'app-id',
        refreshToken: 'a-delegated-refresh-token',
      }),
    ).not.toThrow();
  });
});
