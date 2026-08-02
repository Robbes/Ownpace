// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The managed edition's credential-based mail source builder (workplan 0023
 * T2). No database anywhere: `buildSourceConnectorFromCredentials` takes the
 * decrypted credential record directly, and the behavior worth pinning is the
 * branch-per-type plus its refusals — a graph-mail connection missing a
 * credential must refuse AT BUILD TIME with the field named, not fail
 * mid-pass with a token error.
 */

import { describe, it, expect } from 'vitest';
import { GraphMailSource, ImapSource } from '@openmig/connectors';
import { buildSourceConnectorFromCredentials } from './build-deps-from-mapping';
import type { SourceConfig } from '@openmig/shared';

const GRAPH_MAIL: SourceConfig = { type: 'graph-mail', tenantId: 'contoso.example' };

const IMAP: SourceConfig = {
  type: 'imap-oauth2',
  host: 'imap.example.net',
  port: 993,
  user: 'u@example.net',
  auth: { kind: 'login', passwordFromEnv: 'UNUSED_HERE' },
};

describe('buildSourceConnectorFromCredentials', () => {
  it('builds a GraphMailSource from clientId + clientSecret (client-credentials flow)', () => {
    const source = buildSourceConnectorFromCredentials(GRAPH_MAIL, {
      clientId: 'app-id',
      clientSecret: 'app-secret',
    });
    expect(source).toBeInstanceOf(GraphMailSource);
  });

  it('builds a GraphMailSource from clientId + refreshToken (delegated flow)', () => {
    const source = buildSourceConnectorFromCredentials(GRAPH_MAIL, {
      clientId: 'app-id',
      refreshToken: 'refresh',
    });
    expect(source).toBeInstanceOf(GraphMailSource);
  });

  it('refuses graph-mail credentials without clientId, naming the field', () => {
    expect(() =>
      buildSourceConnectorFromCredentials(GRAPH_MAIL, { clientSecret: 'app-secret' }),
    ).toThrow(/clientId/);
  });

  it('refuses graph-mail credentials with neither clientSecret nor refreshToken', () => {
    expect(() => buildSourceConnectorFromCredentials(GRAPH_MAIL, { clientId: 'app-id' })).toThrow(
      /clientSecret.*refreshToken/,
    );
  });

  it('still builds the IMAP source for imap-oauth2 (the existing path is untouched)', () => {
    const source = buildSourceConnectorFromCredentials(IMAP, { password: 'pw' });
    expect(source).toBeInstanceOf(ImapSource);
  });

  it('rejects a non-mail source type with an honest error', () => {
    const caldav = { type: 'caldav', url: 'https://dav.example.net', user: 'u', auth: { kind: 'login', passwordFromEnv: 'X' } } as unknown as SourceConfig;
    expect(() => buildSourceConnectorFromCredentials(caldav, {})).toThrow(/imap-oauth2 and graph-mail/);
  });
});
