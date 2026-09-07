// Copyright 2026 The Ownpace authors (Apache-2.0)

// Regression guard for the IMAP source auth-wiring bug found via a live e2e.yml run
// (workplan 0010 T5): buildImapSource() hardcoded authType: 'XOAUTH2' regardless of the
// configured auth.kind, and never extracted a password for auth.kind: 'login' at all —
// so a login-kind source (like the T5 fixture, or any generic non-O365 IMAP source)
// always sent an empty XOAUTH2 attempt and IMAP servers rejected it with
// "No supported authentication method(s) available".

import { describe, it, expect, vi } from 'vitest';
import { buildDeps, buildDomainDeps } from './build-deps.ts';
import {
  GraphMailSource,
  MailSourceWithGraphFallback,
  ImapFlowSource,
  ImapFlowDavMailTarget,
  GoogleDriveSource,
 ArchiveFileSource } from '@openmig/connectors';
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

describe('IMAP certificate verification is configured, not ambient', () => {
  /**
   * The connector verifies by default since 2026-08-09 (it hardcoded
   * `rejectUnauthorized: false` for everyone before that — see
   * imapflow-source.unit.test.ts for the story). What THESE pin is the seam:
   * the mapping's `tlsVerify` must actually arrive at the connector, because a
   * dropped plumb here fails closed for dev servers (self-signed certs stop
   * connecting, loudly) but would ALSO mean an operator writing
   * `"tlsVerify": false` gets a config field that silently does nothing.
   */
  async function rejectUnauthorizedOf(config: MappingConfig): Promise<boolean | undefined> {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('SRC_PASSWORD', 'pw');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      const deps = await buildDeps(config);
      const value = (deps.source as unknown as { config: { rejectUnauthorized?: boolean } })
        .config.rejectUnauthorized;
      await deps.close();
      return value;
    } finally {
      vi.unstubAllEnvs();
    }
  }

  function sourceWithVerify(tlsVerify?: boolean): MappingConfig {
    const base = configWith({ kind: 'login', passwordFromEnv: 'SRC_PASSWORD' });
    return {
      ...base,
      source: {
        type: 'imap-oauth2',
        host: 'stalwart',
        port: 993,
        user: 'source@dev.local',
        auth: { kind: 'login', passwordFromEnv: 'SRC_PASSWORD' },
        ...(tlsVerify === undefined ? {} : { tlsVerify }),
      },
    };
  }

  it('leaves it undefined when the mapping is silent, so the connector default rules', async () => {
    await expect(rejectUnauthorizedOf(sourceWithVerify())).resolves.toBeUndefined();
  });

  it('carries an explicit tlsVerify:false through to the connector', async () => {
    await expect(rejectUnauthorizedOf(sourceWithVerify(false))).resolves.toBe(false);
  });
});

/**
 * IMAP/DAV TARGET coverage, added 2026-08-14 (workplan 0041 T3).
 *
 * Every fixture above uses a `jmap` target, so the `imap-dav` branch of
 * `buildTargetWriter` was never constructed by this suite. Breaking it failed
 * nothing here — the same gap the managed suite had, in the same place, found
 * the same way: by the workplan's mutation check refusing to fail.
 */
describe('buildDeps imap-dav target wiring', () => {
  function imapDavTargetConfig(auth: { kind: 'login'; passwordFromEnv: string }): MappingConfig {
    const base = configWith({ kind: 'login', passwordFromEnv: 'SRC_PASSWORD' });
    return {
      ...base,
      target: {
        type: 'imap-dav',
        host: 'mail.example.net',
        port: 993,
        user: 'u@example.net',
        auth,
      },
    } as MappingConfig;
  }

  it('builds an ImapFlowDavMailTarget from the named env var', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('SRC_PASSWORD', 'source_password');
    vi.stubEnv('TGT_IMAP_PASSWORD', 'target_password');
    try {
      const deps = await buildDeps(
        imapDavTargetConfig({ kind: 'login', passwordFromEnv: 'TGT_IMAP_PASSWORD' }),
      );
      // PINS THE CUTOVER (workplan 0032 T3, 2026-08-06) — the WRITE path.
      expect(deps.target).toBeInstanceOf(ImapFlowDavMailTarget);
      await deps.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses at build time, naming the env var, when the target password is unset', async () => {
    // Rule 9: name the variable. A target whose password is missing must say
    // which one, not fail later against the server with an auth error.
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('SRC_PASSWORD', 'source_password');
    try {
      await expect(
        buildDeps(imapDavTargetConfig({ kind: 'login', passwordFromEnv: 'TGT_IMAP_PASSWORD' })),
      ).rejects.toThrow(/TGT_IMAP_PASSWORD/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/**
 * The file domain can be a Google Drive (workplan 0042 T5).
 *
 * Until this landed, `SourceConfig` had no Drive variant and neither builder
 * constructed one: the connector was a tested class nothing could reach. These
 * two cases are the reachability itself — the appliance path, from a mapping
 * file plus environment credentials.
 */
describe('buildDomainDeps — a Google Drive file source', () => {
  function driveMapping(): MappingConfig {
    return {
      tenantId: '00000000-0000-4000-8000-000000000001',
      mappingId: '11111111-1111-4111-8111-111111111111',
      source: {
        type: 'imap-oauth2',
        host: 'stalwart',
        port: 993,
        user: 'source@dev.local',
        auth: { kind: 'login', passwordFromEnv: 'SRC_PASSWORD' },
      },
      target: {
        type: 'jmap',
        baseUrl: 'https://mail.example.net',
        user: 'u@example.net',
        auth: { kind: 'basic', passwordFromEnv: 'TGT_PASSWORD' },
      },
      domains: {
        files: {
          enabled: true,
          source: { type: 'google-drive', rootFolderId: 'shared-drive-1' },
          target: {
            type: 'webdav',
            url: 'https://cloud.example.net/remote.php/dav/files/target/',
            user: 'target',
            auth: { kind: 'login', passwordFromEnv: 'TGT_PASSWORD' },
          },
        },
      },
    } as MappingConfig;
  }

  it('builds a GoogleDriveSource, with no DAV credentials anywhere in sight', () => {
    // Google withdrew WebDAV years ago, so a Drive source has no url/user/
    // password to resolve. Reaching the DAV endpoint resolver would refuse for
    // missing credentials that do not exist for this provider.
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-1.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'GOCSPX-secret');
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', '1//refresh');
    vi.stubEnv('TGT_PASSWORD', 'target_password');
    try {
      const deps = buildDomainDeps(driveMapping(), 'file');
      expect(deps.source).toBeInstanceOf(GoogleDriveSource);
      void deps.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses at build time, naming the environment variable that is missing', () => {
    // Rule 9. Without this the appliance builds a source that cannot mint a
    // token, and the operator sees a 401 from Google in the middle of a pass.
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', '');
    vi.stubEnv('TGT_PASSWORD', 'target_password');
    try {
      expect(() => buildDomainDeps(driveMapping(), 'file')).toThrow(/GOOGLE_CLIENT_ID/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/**
 * The file domain can be an EXPORT ARCHIVE on the appliance's own disk
 * (workplan 0116 T5/T6, wired for the appliance by T10).
 *
 * The managed seam got its `archive` arm with T5/T6; this one did not, and
 * the self-host gate found it: an archive mapping on the appliance was handed
 * to the DAV endpoint resolver and refused for a URL a folder never had. The
 * one route where a local path is the whole of getting the archive to us
 * (0116 §3) is the appliance, so this is the arm that matters most.
 */
describe('buildDomainDeps — an export archive as the file source (0116 T10)', () => {
  function archiveMapping(): MappingConfig {
    return {
      tenantId: '00000000-0000-4000-8000-000000000001',
      mappingId: '22222222-2222-4222-8222-222222222222',
      source: { type: 'archive', provider: 'google-takeout', path: '/data/fixtures/takeout' },
      target: {
        type: 'webdav',
        url: 'https://cloud.example.net/remote.php/dav/files/target/',
        user: 'target',
        auth: { kind: 'login', passwordFromEnv: 'TGT_PASSWORD' },
      },
      domains: {
        files: {
          enabled: true,
          source: { type: 'archive', provider: 'google-takeout', path: '/data/fixtures/takeout' },
          target: {
            type: 'webdav',
            url: 'https://cloud.example.net/remote.php/dav/files/target/',
            user: 'target',
            auth: { kind: 'login', passwordFromEnv: 'TGT_PASSWORD' },
          },
        },
      },
    } as MappingConfig;
  }

  it('builds the archive file source — a snapshot — and never reaches the DAV resolver', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
    vi.stubEnv('TGT_PASSWORD', 'target_password');
    try {
      const deps = buildDomainDeps(archiveMapping(), 'file');
      expect(deps.source).toBeInstanceOf(ArchiveFileSource);
      expect((deps.source as ArchiveFileSource).snapshot).toBe(true);
      void deps.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
