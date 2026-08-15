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
import { GraphMailSource, ImapFlowSource, MailSourceWithGraphFallback } from '@openmig/connectors';
import { JmapTargetWriter, ImapFlowDavMailTarget } from '@openmig/connectors';
import {
  buildSourceConnectorFromCredentials,
  buildTargetWriterFromCredentials,
} from './build-deps-from-mapping';
import type { SourceConfig, TargetConfig } from '@openmig/shared';

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
    // PINS THE CUTOVER (workplan 0032 T3, 2026-08-06).
    expect(source).toBeInstanceOf(ImapFlowSource);
  });

  it('builds an XOAUTH2 IMAP source from an app registration alone (0037 T6): tenantId + clientId + clientSecret, no token, no password', () => {
    const source = buildSourceConnectorFromCredentials(IMAP, {
      username: 'mailbox@contoso.example',
      tenantId: 'contoso.example',
      clientId: 'app-id',
      clientSecret: 'app-secret',
    });
    // tenantId doubles as the Graph-fallback signal, so the registration-only
    // credential set comes back wrapped — the IMAP source with minted tokens
    // inside, Graph behind it (ADR-0006: IMAP primary, Graph fallback).
    expect(source).toBeInstanceOf(MailSourceWithGraphFallback);
  });

  it('refuses imap-oauth2 credentials with no token, no password and no app registration, naming all three options', () => {
    expect(() =>
      buildSourceConnectorFromCredentials(IMAP, { username: 'mailbox@contoso.example' }),
    ).toThrow(/access token.*password.*app registration/);
  });

  it('wraps imap-oauth2 in the Graph fallback when the credentials also carry a Graph set (0023 T3)', () => {
    const source = buildSourceConnectorFromCredentials(IMAP, {
      password: 'pw',
      tenantId: 'contoso.example',
      clientId: 'app-id',
      clientSecret: 'app-secret',
    });
    expect(source).toBeInstanceOf(MailSourceWithGraphFallback);
  });

  it('leaves imap-oauth2 unwrapped when the credentials carry no tenantId', () => {
    const source = buildSourceConnectorFromCredentials(IMAP, {
      password: 'pw',
      clientId: 'app-id',
      clientSecret: 'app-secret',
    });
    // PINS THE CUTOVER (workplan 0032 T3, 2026-08-06).
    expect(source).toBeInstanceOf(ImapFlowSource);
  });

  it('rejects a non-mail source type with an honest error', () => {
    const caldav = { type: 'caldav', url: 'https://dav.example.net', user: 'u', auth: { kind: 'login', passwordFromEnv: 'X' } } as unknown as SourceConfig;
    expect(() => buildSourceConnectorFromCredentials(caldav, {})).toThrow(/imap-oauth2 and graph-mail/);
  });
});

/**
 * TARGET coverage, added 2026-08-14 (workplan 0041 T3).
 *
 * This suite had none. `buildTargetWriterFromCredentials` was not exported, so
 * nothing here could reach it, and breaking the managed target construction
 * failed no test at all — the gap was invisible because absence of coverage
 * looks exactly like coverage that passes.
 *
 * It surfaced from the workplan's mutation check: breaking the shared target
 * builder was supposed to fail BOTH editions' tests and failed only self-host's.
 */
describe('buildTargetWriterFromCredentials', () => {
  const JMAP_TARGET: TargetConfig = {
    type: 'jmap',
    baseUrl: 'https://jmap.example',
    user: 'target@example',
  } as TargetConfig;

  const IMAP_DAV_TARGET: TargetConfig = {
    type: 'imap-dav',
    host: 'mail.example',
    port: 993,
    user: 'target@example',
  } as TargetConfig;

  it('builds a JmapTargetWriter from a password credential', () => {
    expect(buildTargetWriterFromCredentials(JMAP_TARGET, { password: 'pw' })).toBeInstanceOf(
      JmapTargetWriter,
    );
  });

  it('accepts token or api_key in place of password for JMAP', () => {
    // Three accepted key names is a contract, not an accident: connections
    // created by different paths encrypt the same secret under different names.
    expect(buildTargetWriterFromCredentials(JMAP_TARGET, { token: 'tk' })).toBeInstanceOf(
      JmapTargetWriter,
    );
    expect(buildTargetWriterFromCredentials(JMAP_TARGET, { api_key: 'ak' })).toBeInstanceOf(
      JmapTargetWriter,
    );
  });

  it('refuses a JMAP target with no usable credential', () => {
    expect(() => buildTargetWriterFromCredentials(JMAP_TARGET, {})).toThrow(/JMAP target/);
  });

  it('builds an ImapFlowDavMailTarget from a password credential', () => {
    // PINS THE CUTOVER (workplan 0032 T3, 2026-08-06) — the WRITE path.
    expect(buildTargetWriterFromCredentials(IMAP_DAV_TARGET, { password: 'pw' })).toBeInstanceOf(
      ImapFlowDavMailTarget,
    );
  });

  it('accepts access_token in place of password for imap-dav', () => {
    expect(
      buildTargetWriterFromCredentials(IMAP_DAV_TARGET, { access_token: 'tk' }),
    ).toBeInstanceOf(ImapFlowDavMailTarget);
  });

  it('refuses an imap-dav target with no usable credential', () => {
    expect(() => buildTargetWriterFromCredentials(IMAP_DAV_TARGET, {})).toThrow(/IMAP\/DAV target/);
  });

  it('refuses an unsupported target type', () => {
    expect(() =>
      buildTargetWriterFromCredentials({ type: 'caldav' } as unknown as TargetConfig, {}),
    ).toThrow(/Unsupported target type/);
  });
});

/**
 * The mailbox refusal, through the MANAGED caller (2026-08-14).
 *
 * This suite never exercised it, so the refusal's wording was unconstrained on
 * this path — and it was wrong: it told a managed operator to unset
 * OAUTH2_REFRESH_TOKEN, an environment variable this edition never reads.
 */
describe('buildSourceConnectorFromCredentials — named mailbox on the delegated flow', () => {
  const SHARED_MAILBOX: SourceConfig = {
    type: 'graph-mail',
    tenantId: 'contoso.example',
    mailbox: 'gedeeld@contoso.nl',
  } as SourceConfig;

  it('refuses, naming the CREDENTIAL FIELDS the operator can actually change', () => {
    const failure = () =>
      buildSourceConnectorFromCredentials(SHARED_MAILBOX, {
        clientId: 'app-id',
        refreshToken: 'a-delegated-refresh-token',
      });

    expect(failure).toThrow(/gedeeld@contoso\.nl/);
    expect(failure).toThrow(/refreshToken is set/);
    expect(failure).toThrow(/set clientSecret/);
    // A managed operator has no OAUTH2_* variables. Advice they cannot act on
    // is worse than none: it sends them looking for a setting that is not there.
    expect(failure).not.toThrow(/OAUTH2_/);
    // Still points at the runbook rather than leaving them to guess.
    expect(failure).toThrow(/o365-application-access\.md/);
  });

  it('allows a named mailbox on the client-credentials flow', () => {
    // The other side of the refusal — /users/{address} is exactly what
    // application permissions are for (0027 T0, the shared-mailbox path).
    expect(
      buildSourceConnectorFromCredentials(SHARED_MAILBOX, {
        clientId: 'app-id',
        clientSecret: 'app-secret',
      }),
    ).toBeInstanceOf(GraphMailSource);
  });
});
