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
import {
  STORED_CREDENTIAL_NAMES,
  buildGraphMailSourceFrom,
} from './mail-source-factory.ts';

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

  it('names the CREDENTIAL FIELDS when the caller says the credentials are stored', () => {
    // The refusal used to name OAUTH2_REFRESH_TOKEN on both paths, including the
    // managed one, where no such variable is read and unsetting it changes
    // nothing. Rule 9 says name the fix; a fix the operator cannot apply is not
    // one. Duplication hid this — both copies were wrong identically.
    const failure = () =>
      buildGraphMailSourceFrom(
        { ...TENANT, mailbox: 'gedeeld@contoso.nl' },
        {
          clientId: 'app-id',
          refreshToken: 'a-delegated-refresh-token',
          naming: STORED_CREDENTIAL_NAMES,
        },
      );

    expect(failure).toThrow(/refreshToken is set/);
    expect(failure).toThrow(/set clientSecret/);
    // The point of the fix: no env-var advice on a path with no env vars.
    expect(failure).not.toThrow(/OAUTH2_/);
  });

  it('still names the ENV VARS by default, which is what self-host needs', () => {
    // Omitting `naming` must keep the pre-2026-08-14 behaviour exactly — that is
    // what makes the default safe for the self-host caller, which passes none.
    expect(() =>
      buildGraphMailSourceFrom(
        { ...TENANT, mailbox: 'gedeeld@contoso.nl' },
        { clientId: 'app-id', refreshToken: 'a-delegated-refresh-token' },
      ),
    ).toThrow(/OAUTH2_REFRESH_TOKEN is set/);
  });
});
