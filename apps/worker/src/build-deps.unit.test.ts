// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

// Regression guard for the IMAP source auth-wiring bug found via a live e2e.yml run
// (workplan 0010 T5): buildImapSource() hardcoded authType: 'XOAUTH2' regardless of the
// configured auth.kind, and never extracted a password for auth.kind: 'login' at all —
// so a login-kind source (like the T5 fixture, or any generic non-O365 IMAP source)
// always sent an empty XOAUTH2 attempt and IMAP servers rejected it with
// "No supported authentication method(s) available".

import { describe, it, expect, vi } from 'vitest';
import { buildDeps } from './build-deps';
import { GraphMailSource, MailSourceWithGraphFallback, ImapFlowSource } from '@openmig/connectors';
import type { MappingConfig, SourceAuth } from '@openmig/shared';

interface ImapSourceInternals {
  config: {
    authType?: 'LOGIN' | 'XOAUTH2';
    auth: { user: string; password?: string; accessToken?: string };
  };
}

function configWith(auth: SourceAuth): MappingConfig {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001',
    mappingId: '11111111-1111-4111-8111-111111111111',
    source: {
      type: 'imap-oauth2',
      host: 'stalwart',
      port: 993,
      user: 'source@dev.local',
      auth,
    },
    target: {
      type: 'jmap',
      baseUrl: 'https://mail.example.net/jmap',
      user: 'u@example.net',
      auth: { kind: 'basic', passwordFromEnv: 'TGT_PASSWORD' },
    },
  };
}

describe('buildDeps IMAP source auth wiring', () => {
  it('wires password-based (login) auth through to the connector, not XOAUTH2', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('SRC_PASSWORD', 'source_password');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      const deps = await buildDeps(configWith({ kind: 'login', passwordFromEnv: 'SRC_PASSWORD' }));
      const internals = (deps.source as unknown as ImapSourceInternals).config;
      expect(internals.authType).toBe('LOGIN');
      expect(internals.auth.password).toBe('source_password');
      expect(internals.auth.accessToken).toBeUndefined();
      await deps.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('still wires xoauth2 auth through to the connector as XOAUTH2', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('SRC_TOKEN', 'tok');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      const deps = await buildDeps(configWith({ kind: 'xoauth2', tokenFromEnv: 'SRC_TOKEN' }));
      const internals = (deps.source as unknown as ImapSourceInternals).config;
      expect(internals.authType).toBe('XOAUTH2');
      expect(internals.auth.accessToken).toBe('tok');
      expect(internals.auth.password).toBeUndefined();
      await deps.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---------------------------------------------------------------------------
// graph-mail (workplan 0023 T2 — ADR-0006's IMAP-disabled fallback):
// the OAUTH2_* env contract is REQUIRED here — no static-token fallback —
// and a missing credential must refuse at build time naming the variable,
// not fail mid-pass with a token error.
// ---------------------------------------------------------------------------

function graphMailConfig(mailbox?: string): MappingConfig {
  const base = configWith({ kind: 'login', passwordFromEnv: 'UNUSED' });
  return {
    ...base,
    source: {
      type: 'graph-mail',
      tenantId: 'contoso.example',
      ...(mailbox === undefined ? {} : { mailbox }),
    },
  };
}

describe('buildDeps graph-mail source wiring', () => {
  it('builds a GraphMailSource on the client-credentials flow', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('OAUTH2_CLIENT_ID', 'app-id');
    vi.stubEnv('OAUTH2_CLIENT_SECRET', 'app-secret');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      const deps = await buildDeps(graphMailConfig());
      expect(deps.source).toBeInstanceOf(GraphMailSource);
      await deps.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses at build time, naming OAUTH2_CLIENT_ID, when it is missing', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      await expect(buildDeps(graphMailConfig())).rejects.toThrow(/OAUTH2_CLIENT_ID/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reads a NAMED mailbox on the client-credentials flow (the shared-mailbox path)', async () => {
    // 0027 T0 gave the connector a `mailbox` option and nothing could set it;
    // this is the mapping-file surface that makes it reachable (SAD §14.1
    // Pattern S — a shared store has no user to sign in as).
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('OAUTH2_CLIENT_ID', 'app-id');
    vi.stubEnv('OAUTH2_CLIENT_SECRET', 'app-secret');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      const deps = await buildDeps(graphMailConfig('gedeeld@contoso.nl'));
      expect(deps.source).toBeInstanceOf(GraphMailSource);
      await deps.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('REFUSES a named mailbox on the delegated flow, naming the fix', async () => {
    // The failure this prevents: a delegated token against /users/{address}
    // gets a bare 403 from Graph, and the operator reads an access-denied
    // error that says nothing about which of the two flows they are on.
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('OAUTH2_CLIENT_ID', 'app-id');
    vi.stubEnv('OAUTH2_REFRESH_TOKEN', 'a-delegated-refresh-token');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      const failure = buildDeps(graphMailConfig('gedeeld@contoso.nl'));
      await expect(failure).rejects.toThrow(/gedeeld@contoso\.nl/);
      await expect(buildDeps(graphMailConfig('gedeeld@contoso.nl'))).rejects.toThrow(
        /OAUTH2_REFRESH_TOKEN is set/,
      );
      // Points at the runbook rather than leaving them to guess.
      await expect(buildDeps(graphMailConfig('gedeeld@contoso.nl'))).rejects.toThrow(
        /o365-application-access\.md/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('still allows the delegated flow when no mailbox is named', async () => {
    // The guard must not break /me reads, which is what every existing
    // delegated mapping does.
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('OAUTH2_CLIENT_ID', 'app-id');
    vi.stubEnv('OAUTH2_REFRESH_TOKEN', 'a-delegated-refresh-token');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      const deps = await buildDeps(graphMailConfig());
      expect(deps.source).toBeInstanceOf(GraphMailSource);
      await deps.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses when neither OAUTH2_CLIENT_SECRET nor OAUTH2_REFRESH_TOKEN is set', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('OAUTH2_CLIENT_ID', 'app-id');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      await expect(buildDeps(graphMailConfig())).rejects.toThrow(
        /OAUTH2_CLIENT_SECRET.*OAUTH2_REFRESH_TOKEN/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---------------------------------------------------------------------------
// The runtime IMAP-disabled fallback (workplan 0023 T3, ADR-0006): an
// imap-oauth2 mapping gets the fallback wrapper exactly when the env also
// carries Graph-capable credentials — OAUTH2_TENANT_ID being the signal.
// ---------------------------------------------------------------------------

describe('buildDeps IMAP→Graph fallback wiring', () => {
  it('wraps the IMAP source when Graph-capable env credentials exist', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('SRC_PASSWORD', 'pw');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    vi.stubEnv('OAUTH2_TENANT_ID', 'contoso.example');
    vi.stubEnv('OAUTH2_CLIENT_ID', 'app-id');
    vi.stubEnv('OAUTH2_CLIENT_SECRET', 'app-secret');
    try {
      const deps = await buildDeps(configWith({ kind: 'login', passwordFromEnv: 'SRC_PASSWORD' }));
      expect(deps.source).toBeInstanceOf(MailSourceWithGraphFallback);
      await deps.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('leaves the IMAP source unwrapped without OAUTH2_TENANT_ID (nothing to fall back to)', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('SRC_PASSWORD', 'pw');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    vi.stubEnv('OAUTH2_CLIENT_ID', 'app-id');
    vi.stubEnv('OAUTH2_CLIENT_SECRET', 'app-secret');
    try {
      const deps = await buildDeps(configWith({ kind: 'login', passwordFromEnv: 'SRC_PASSWORD' }));
      // PINS THE CUTOVER (workplan 0032 T3, 2026-08-06). Production builds the
      // imapflow source, and since T3b there is no other one to build — the
      // `imap-simple` implementation and both parity harnesses are gone. That
      // makes this assertion more load-bearing rather than less: it is now the
      // only place a revert would be caught.
      expect(deps.source).toBeInstanceOf(ImapFlowSource);
      await deps.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('IMAP TLS is configured, not deduced from the port', () => {
  /**
   * Until 2026-08-09 this was `tls: sourceConfig.port === 993` — a literal port
   * comparison, repeated in four places across both editions. A dev Stalwart
   * published on 1993 therefore got a CLEARTEXT socket opened against a TLS
   * listener, and the resulting failure reads like a network fault rather than
   * a configuration one.
   *
   * The default is now `true` and the port is not consulted. That asymmetry is
   * the point: defaulting to TLS and being wrong costs a connection error in
   * front of whoever just wrote the mapping, while defaulting to cleartext and
   * being wrong puts a mailbox password on the wire. Only one of those can be
   * fixed by reading the error.
   */
  function sourceOn(port: number, tls?: boolean): MappingConfig {
    const base = configWith({ kind: 'login', passwordFromEnv: 'SRC_PASSWORD' });
    return {
      ...base,
      source: {
        type: 'imap-oauth2',
        host: 'stalwart',
        port,
        user: 'source@dev.local',
        auth: { kind: 'login', passwordFromEnv: 'SRC_PASSWORD' },
        ...(tls === undefined ? {} : { tls }),
      },
    };
  }

  async function tlsOf(config: MappingConfig): Promise<boolean | undefined> {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('SRC_PASSWORD', 'pw');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      const deps = await buildDeps(config);
      const tls = (deps.source as unknown as { config: { tls?: boolean } }).config.tls;
      await deps.close();
      return tls;
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it('uses TLS on a NON-standard IMAPS port, which the port rule got wrong', async () => {
    // The exact case: Stalwart on 1993. Under the old rule this was `false`.
    await expect(tlsOf(sourceOn(1993))).resolves.toBe(true);
  });

  it('uses TLS on 143 as well — the port carries no meaning any more', async () => {
    // Deliberate, and a behaviour change: a cleartext/STARTTLS mapping must now
    // SAY so. That is the right shape for a choice not to encrypt, and it fails
    // loudly at connect rather than quietly on the wire.
    await expect(tlsOf(sourceOn(143))).resolves.toBe(true);
  });

  it('obeys an explicit tls:false, which is how cleartext is now requested', async () => {
    await expect(tlsOf(sourceOn(143, false))).resolves.toBe(false);
  });

  it('still uses TLS on 993, so no existing mapping changes behaviour', async () => {
    await expect(tlsOf(sourceOn(993))).resolves.toBe(true);
  });
});
