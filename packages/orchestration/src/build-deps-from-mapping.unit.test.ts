// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The managed edition's credential-based mail source builder (workplan 0023
 * T2). No database anywhere: `buildSourceConnectorFromCredentials` takes the
 * decrypted credential record directly, and the behavior worth pinning is the
 * branch-per-type plus its refusals — a graph-mail connection missing a
 * credential must refuse AT BUILD TIME with the field named, not fail
 * mid-pass with a token error.
 */

import { describe, it, expect } from 'vitest';
import {
  GraphMailSource,
  GoogleDriveSource,
  ImapFlowSource,
  MailSourceWithGraphFallback,
  WebdavFileSource,
} from '@openmig/connectors';
import { JmapTargetWriter, ImapFlowDavMailTarget } from '@openmig/connectors';
import {
  buildFileSourceFromConnection,
  buildSourceConnectorFromCredentials,
  buildTargetWriterFromCredentials,
  mailTargetConfigFromConnection,
  tenantThrottleLimiter,
} from './build-deps-from-mapping.ts';
import { GmailFolderView } from './gmail-source-factory.ts';
import { ThrottleLimiter, DEFAULT_THROTTLE_CONFIG } from '@openmig/shared';
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

  it('builds a gmail source from the three stored Google credentials (workplan 0044)', () => {
    const source = buildSourceConnectorFromCredentials(
      { type: 'gmail', user: 'owner@gmail.com' },
      { clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt' },
    );
    // The wrapper that hides Gmail's view-folders, an imapflow source inside.
    expect(source).toBeInstanceOf(GmailFolderView);
  });

  it('refuses gmail credentials in the STORED vocabulary, never an env var this edition ignores', () => {
    const failure = (() => {
      try {
        buildSourceConnectorFromCredentials(
          { type: 'gmail', user: 'owner@gmail.com' },
          { clientId: 'cid' },
        );
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(failure?.message).toContain('clientSecret');
    expect(failure?.message).toContain('refreshToken');
    expect(failure?.message).toContain("connection's stored credentials");
    expect(failure?.message).not.toContain('GOOGLE_MAIL_REFRESH_TOKEN');
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
    // `google` joined the list when the ACCOUNT kind grew its mail face
    // (2026-09-01): the refusal must keep NAMING what it does support, which
    // is the whole of its value to somebody reading a task log.
    expect(() => buildSourceConnectorFromCredentials(caldav, {})).toThrow(
      /imap-oauth2, graph-mail, gmail and google/,
    );
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
 * The account kind's mail seam (0106 T4b): connection KIND resolves the mail
 * protocol here and nowhere downstream. What must hold: a protocol row passes
 * through untouched, a soverin row's stored mail face becomes the imap-dav
 * shape the writer switch already speaks, and an account with NO stored mail
 * server refuses by field name — never by guessing a host from the provider's
 * name.
 */
describe('mailTargetConfigFromConnection — kind resolves protocol at ONE seam', () => {
  const CREDS = { username: 'a@example.nl', password: 'pw' };

  it('passes a protocol row through untouched — the seam only exists for account kinds', () => {
    const stored = { type: 'jmap', baseUrl: 'https://jmap.example', user: 'a@example' };
    expect(mailTargetConfigFromConnection('jmap', stored, CREDS)).toBe(stored);
  });

  it('derives the imap-dav shape for an imap row stored WITHOUT its type (the Connections door before 2026-09-03), user from the credential', () => {
    // The owner's first reused IMAP target: added through the Connections
    // page, whose door built the config from the fields alone, then reused by
    // a migration — the writer switch threw "Unsupported target type:
    // undefined" at discovery. The kind names the protocol.
    const stored = { host: 'imap.example.nl', port: 993, useSsl: true };
    const repaired = mailTargetConfigFromConnection('imap', stored, CREDS) as unknown as {
      type: string;
      host: string;
      port: number;
      tls: boolean;
      user: string;
    };
    expect(repaired).toMatchObject({
      type: 'imap-dav',
      host: 'imap.example.nl',
      port: 993,
      tls: true,
      user: 'a@example.nl',
    });
    expect(
      buildTargetWriterFromCredentials(repaired as unknown as TargetConfig, { password: 'pw' }),
    ).toBeInstanceOf(ImapFlowDavMailTarget);
    // A row that said no TLS keeps saying it; a row that said nothing gets the
    // IMAP doors' asymmetry rule (TLS unless said otherwise).
    expect(
      (mailTargetConfigFromConnection('imap', { ...stored, useSsl: false }, CREDS) as unknown as { tls: boolean }).tls,
    ).toBe(false);
    expect(
      (mailTargetConfigFromConnection('imap', { host: 'imap.example.nl', port: 993 }, CREDS) as unknown as { tls: boolean }).tls,
    ).toBe(true);
  });

  it('derives the jmap shape for a jmap row stored without its type — the baseUrl the wizard door would have written', () => {
    const repaired = mailTargetConfigFromConnection(
      'jmap',
      { host: 'jmap.example.nl', port: 443, useSsl: true },
      CREDS,
    ) as unknown as { type: string; baseUrl: string; user: string };
    expect(repaired).toMatchObject({
      type: 'jmap',
      baseUrl: 'https://jmap.example.nl:443',
      user: 'a@example.nl',
    });
  });

  it('a row that carries its type is passed through untouched, and a DAV protocol row without one still has no mail face', () => {
    const typed = { type: 'imap-dav', host: 'h', port: 993, tls: true, user: 'u' };
    expect(mailTargetConfigFromConnection('imap', typed, CREDS)).toBe(typed);
    const dav = { host: 'dav.example.nl', port: 443, url: 'https://dav.example.nl/dav/' };
    expect(mailTargetConfigFromConnection('caldav', dav, CREDS)).toBe(dav);
    expect(() =>
      buildTargetWriterFromCredentials(dav as unknown as TargetConfig, { password: 'pw' }),
    ).toThrow(/Unsupported target type: undefined/);
  });

  it('turns a soverin row with a stored mail face into the imap-dav shape, writer included', () => {
    const resolved = mailTargetConfigFromConnection(
      'soverin',
      { host: 'dav.example.nl', port: 443, useSsl: true, mailHost: 'imap.example.nl', mailPort: 993 },
      CREDS,
    ) as unknown as { type: string; host: string; port: number; tls: boolean; user: string };
    expect(resolved.type).toBe('imap-dav');
    expect(resolved.host).toBe('imap.example.nl');
    expect(resolved.port).toBe(993);
    expect(resolved.tls).toBe(true);
    // The account's one credential names the user; nothing else can.
    expect(resolved.user).toBe('a@example.nl');
    // And the existing writer switch speaks the resolved shape unchanged.
    expect(
      buildTargetWriterFromCredentials(resolved as unknown as TargetConfig, { password: 'pw' }),
    ).toBeInstanceOf(ImapFlowDavMailTarget);
  });

  it('reads mailPort tolerantly (probe routes carry strings) and defaults to 993', () => {
    const asString = mailTargetConfigFromConnection(
      'soverin',
      { mailHost: 'imap.example.nl', mailPort: '143' },
      CREDS,
    ) as unknown as { port: number };
    expect(asString.port).toBe(143);
    const absent = mailTargetConfigFromConnection(
      'soverin',
      { mailHost: 'imap.example.nl' },
      CREDS,
    ) as unknown as { port: number };
    expect(absent.port).toBe(993);
  });

  it('refuses a soverin row with NO stored mail server, naming the field — never guessing a host', () => {
    expect(() => mailTargetConfigFromConnection('soverin', { host: 'dav.example.nl' }, CREDS)).toThrow(
      /config\.mailHost is missing/,
    );
    // The refusal also says what still works, so nobody rips out a healthy row.
    expect(() =>
      mailTargetConfigFromConnection('soverin', { host: 'dav.example.nl' }, CREDS),
    ).toThrow(/calendar and contact faces are unaffected/);
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

/**
 * The managed edition's FILE source (workplan 0042 T5).
 *
 * Same shape, same reason: the branch and its refusals are the behaviour worth
 * pinning and they need no database. What is new here is that the two providers
 * differ in KIND rather than in URL — a Drive connection has no url, username or
 * password at all — so the wrong branch does not misconfigure the source, it
 * refuses a perfectly good connection for missing fields that do not apply.
 */
describe('buildFileSourceFromConnection', () => {
  const DRIVE_CREDS = {
    clientId: 'client-1.apps.googleusercontent.com',
    clientSecret: 'GOCSPX-secret',
    refreshToken: '1//refresh',
  };

  it('builds a GoogleDriveSource for a google_drive connection', () => {
    const source = buildFileSourceFromConnection({
      kind: 'google_drive',
      config: { rootFolderId: 'shared-drive-1' },
      creds: DRIVE_CREDS,
    }, undefined);

    expect(source).toBeInstanceOf(GoogleDriveSource);
  });

  it('does not ask a Drive connection for a username and password', () => {
    // The failure this branch exists to prevent: `fileEndpointFromCreds` would
    // refuse the connection for credentials Google does not use, and never look
    // at the OAuth ones it does.
    expect(() =>
      buildFileSourceFromConnection({
        kind: 'google_drive',
        config: {},
        creds: DRIVE_CREDS,
      }, undefined),
    ).not.toThrow();
  });

  it('still builds a WebdavFileSource for every other kind', () => {
    // The existing managed mappings. A new provider must not move them.
    const source = buildFileSourceFromConnection({
      kind: 'nextcloud',
      config: { url: 'https://cloud.example.net/remote.php/dav/' },
      creds: { username: 'u', password: 'p' },
    }, undefined);

    expect(source).toBeInstanceOf(WebdavFileSource);
  });

  it('refuses a Drive connection missing a credential, naming the STORED field', () => {
    // Rule 9, in the managed operator's vocabulary: they edit a connection
    // record, they do not set environment variables.
    expect(() =>
      buildFileSourceFromConnection({
        kind: 'google_drive',
        config: {},
        creds: { clientId: 'id', clientSecret: 'secret' },
      }, undefined),
    ).toThrow(/refreshToken/);
  });

  it('validates the stored config the SAME way a mapping file is validated', () => {
    // Hard rule 5. The `config` column is untyped JSON; without the shared
    // validator a policy the appliance refuses would be accepted here and then
    // silently ignored, and an owner would be told their Docs were refused
    // while their connection says "export-office".
    expect(() =>
      buildFileSourceFromConnection({
        kind: 'google_drive',
        config: { nativeFilePolicy: 'export_office' },
        creds: DRIVE_CREDS,
      }, undefined),
    ).toThrow(/nativeFilePolicy/);
  });
});

/**
 * THE FOUR NON-MAIL FACES MET GRAPH WITH NO BACKOFF AT ALL.
 *
 * `buildDepsFromMapping` — the MAIL builder — has built a throttle limiter
 * since workplan 0082 T5. `buildDomainDepsFromMapping`, which is what the
 * preflight and every calendar, contact, file and task pass go through, built
 * none, and the four source builders it calls could not accept one even if it
 * had. Every Graph source guards its backoff with
 *
 *     if (this.throttleLimiter) { … }
 *
 * so "no limiter" is not "unthrottled but working". It is a 429 arriving as a
 * FAILED ITEM instead of as a pause. The owner's preflight said so on
 * 2026-09-07:
 *
 *     Failed to list drive items: 429 - activityLimitReached — The request
 *     has been throttled
 *
 * against a OneDrive his connection card had measured at 4 folders and 3.8 GB
 * minutes earlier. The preflight is where he saw it; a pass over those 3.8 GB
 * is where it would have cost him, one lost item per throttled request.
 *
 * ## What guards what
 *
 * The COMPILER stops a builder being reached without one: `throttleLimiter` is
 * required in position on all four `…FromConnection` builders, so a sixth
 * domain — or a fifth face — cannot forget it the way the four existing ones
 * were never given it. That is the important half and it needs no test.
 *
 * These pin the half a type cannot: that a limiter is actually BUILT rather
 * than a well-typed `undefined` threaded through, and that a tenant who
 * configured a rate gets theirs rather than the default.
 */
describe('tenantThrottleLimiter', () => {
  // `PgRateBudget` stores the handle and only touches it when a request is
  // actually charged, which nothing here does.
  const db = {} as never;
  /** A tenant of ours, which is what the budget must be keyed by. */
  const TENANT = '11111111-2222-3333-4444-555555555555';

  it('builds a limiter when the mapping stored no throttle config at all', () => {
    // "No custom limits" never meant "no limits" — it meant the defaults, and
    // the defaults are what the shared budget enforces. This was the branch
    // that used to leave `throttleLimiter` undefined.
    expect(tenantThrottleLimiter(db, TENANT, null)).toBeInstanceOf(ThrottleLimiter);
    expect(tenantThrottleLimiter(db, TENANT, undefined)).toBeInstanceOf(ThrottleLimiter);
  });

  it('runs at the default rate when nothing is stored', () => {
    const limiter = tenantThrottleLimiter(db, TENANT, null);
    expect(limiter.config.requestsPerSecond).toBe(
      DEFAULT_THROTTLE_CONFIG.requestsPerSecond,
    );
  });

  it("uses the tenant's own stored rate rather than the default", () => {
    const limiter = tenantThrottleLimiter(db, TENANT, { requestsPerSecond: 3 });
    expect(limiter.config.requestsPerSecond).toBe(3);
  });

  it('falls back to the caller mapping only when the mapping stored nothing', () => {
    // Two sources of config, and the STORED one wins: it is the tenant's own
    // decision, where the mapping argument is the process-wide default.
    expect(
      tenantThrottleLimiter(db, TENANT, null, { mapping: { requestsPerSecond: 7 } }).config
        .requestsPerSecond,
    ).toBe(7);
    expect(
      tenantThrottleLimiter(db, TENANT, { requestsPerSecond: 3 }, { mapping: { requestsPerSecond: 7 } })
        .config.requestsPerSecond,
    ).toBe(3);
  });

  /**
   * THE TENANT THE BUDGET IS FOR, WHICH NOTHING USED TO SUPPLY (2026-09-08).
   *
   * `PgRateBudget` took its tenant from `acquire`'s first argument, and every
   * connector passes something else there: the Graph sources pass the ENTRA
   * tenant (`common` for a multi-tenant app registration), the DAV sources the
   * literal `dav`. The column is `uuid`, so the first real call died on
   * `invalid input syntax for type uuid: "common"` — after four faces were
   * given a limiter and reached the budget for the first time.
   *
   * This seam knows the tenant, so this seam supplies it. Required rather than
   * optional: an optional tenant is exactly how the first one came to be
   * missing, and a sixth builder must not be able to repeat it.
   */
  it('refuses to build a budget without one of our tenants', () => {
    // The two values production actually passed, and the empty string.
    for (const notATenant of ['common', 'dav', '']) {
      expect(
        () => tenantThrottleLimiter(db, notATenant, null),
        `${notATenant || '(empty)'} is a connector's label, not our tenant`,
      ).toThrow(/tenant id/i);
    }
  });
});
