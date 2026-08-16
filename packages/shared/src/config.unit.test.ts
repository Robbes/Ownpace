// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTargetFolderPrefix, applyTargetFolderPrefix, parseMappingConfig, parseMappingConfigJson, ConfigError } from './config';

const example = {
  tenantId: 'tenant-1',
  mappingId: 'inbox-mail',
  source: {
    type: 'imap-oauth2',
    host: 'outlook.office365.com',
    port: 993,
    user: 'user@example.onmicrosoft.com',
    auth: { kind: 'xoauth2', tokenFromEnv: 'O365_ACCESS_TOKEN' },
  },
  target: {
    type: 'jmap',
    baseUrl: 'http://stalwart:8080',
    user: 'target@dev.local',
    auth: { kind: 'basic', passwordFromEnv: 'TARGET_PASSWORD' },
  },
  schedule: { cron: '*/15 * * * *' },
  _note: 'ignored extra key',
};

describe('parseMappingConfig', () => {
  it('parses a valid config and ignores unknown keys', () => {
    const cfg = parseMappingConfig(example);
    expect(cfg.tenantId).toBe('tenant-1');
    expect(cfg.source.type).toBe('imap-oauth2');
    expect(cfg.target.type).toBe('jmap');
    expect(cfg.schedule?.cron).toBe('*/15 * * * *');
    expect(cfg.concurrency).toBeUndefined();
  });

  it('accepts the imap-dav target family and a concurrency knob', () => {
    const cfg = parseMappingConfig({
      ...example,
      target: { type: 'imap-dav', host: 'imap.soverin.net', port: 993, user: 'me@dom', auth: { kind: 'login', passwordFromEnv: 'PW' } },
      concurrency: 8,
    });
    expect(cfg.target.type).toBe('imap-dav');
    expect(cfg.concurrency).toBe(8);
  });

  it('rejects a missing tenantId', () => {
    const { tenantId: _omit, ...bad } = example;
    expect(() => parseMappingConfig(bad)).toThrow(ConfigError);
    expect(() => parseMappingConfig(bad)).toThrow(/tenantId/);
  });

  it('rejects an unsupported source type', () => {
    expect(() => parseMappingConfig({ ...example, source: { ...example.source, type: 'pop3' } })).toThrow(/source\.type/);
  });

  it('rejects a non-integer port', () => {
    expect(() => parseMappingConfig({ ...example, source: { ...example.source, port: 99.5 } })).toThrow(/source\.port/);
  });

  it('rejects an unsupported target type', () => {
    expect(() => parseMappingConfig({ ...example, target: { type: 'dropbox' } })).toThrow(/target\.type/);
  });

  it('rejects a non-object root', () => {
    expect(() => parseMappingConfig([])).toThrow(/root/);
    expect(() => parseMappingConfig(null)).toThrow(ConfigError);
  });

  describe('allowApplyDeletions', () => {
    it('defaults to undefined — off unless a mapping opts in', () => {
      // The one destructive capability in the product must never turn on by
      // omission. Absent here is what makes `applyDeletion`'s gate 1 refuse by
      // default rather than by a config author remembering to say `false`.
      expect(parseMappingConfig(example).allowApplyDeletions).toBeUndefined();
    });

    it('accepts an explicit true or false', () => {
      expect(parseMappingConfig({ ...example, allowApplyDeletions: true }).allowApplyDeletions).toBe(true);
      expect(parseMappingConfig({ ...example, allowApplyDeletions: false }).allowApplyDeletions).toBe(false);
    });

    it('rejects anything that is not literally a boolean', () => {
      // A typo here ("true" as a string, 1 as a number) must be loud: silently
      // treating it as falsy would be a config author's REASONABLE belief that
      // they turned this on, quietly not turning it on at all.
      expect(() => parseMappingConfig({ ...example, allowApplyDeletions: 'true' })).toThrow(
        /allowApplyDeletions/,
      );
      expect(() => parseMappingConfig({ ...example, allowApplyDeletions: 1 })).toThrow(ConfigError);
    });
  });
});

describe('source.tls / target.tls', () => {
  // Added 2026-08-09. Before it, TLS was `port === 993` in four places, so an
  // IMAPS server on any other port got a cleartext socket -- found on a dev
  // Stalwart published on 1993. The DEFAULT lives in build-deps, not here:
  // omitting the key must leave it absent so there is one answer to "what
  // happens when tls is unset" rather than one per parser.
  it('leaves tls absent when the mapping does not mention it', () => {
    const cfg = parseMappingConfig(example);
    expect(cfg.source).not.toHaveProperty('tls');
  });

  it('carries an explicit false through, which is how cleartext is requested', () => {
    const cfg = parseMappingConfig({
      ...example,
      source: { ...example.source, port: 143, tls: false },
    });
    expect(cfg.source).toMatchObject({ tls: false });
  });

  it('carries an explicit true through', () => {
    const cfg = parseMappingConfig({ ...example, source: { ...example.source, tls: true } });
    expect(cfg.source).toMatchObject({ tls: true });
  });

  it('refuses a non-boolean, naming the field', () => {
    // "true" the string is the mistake somebody actually makes in JSON, and
    // coercing it would silently accept "false" as truthy -- cleartext where
    // the operator asked for TLS, or the reverse.
    expect(() =>
      parseMappingConfig({ ...example, source: { ...example.source, tls: 'true' } }),
    ).toThrow(/source\.tls/);
  });

  it('carries tlsVerify:false through, which is how a self-signed dev server opts out', () => {
    // Verification itself defaults ON at the connector (2026-08-09 -- it was
    // hardcoded OFF for everyone before that). The parser's job is only to
    // carry the opt-out; silence stays silence so the connector owns the
    // default.
    const cfg = parseMappingConfig({
      ...example,
      source: { ...example.source, tlsVerify: false },
    });
    expect(cfg.source).toMatchObject({ tlsVerify: false });
    expect(parseMappingConfig(example).source).not.toHaveProperty('tlsVerify');
  });

  it('refuses a non-boolean tlsVerify, naming the field', () => {
    expect(() =>
      parseMappingConfig({ ...example, source: { ...example.source, tlsVerify: 'false' } }),
    ).toThrow(/source\.tlsVerify/);
  });

  it('parses on the imap-dav target too', () => {
    const cfg = parseMappingConfig({
      ...example,
      target: {
        type: 'imap-dav',
        host: 'mail.example.net',
        port: 1993,
        user: 'u@example.net',
        auth: { kind: 'login', passwordFromEnv: 'TGT' },
        tls: true,
        tlsVerify: false,
      },
    });
    expect(cfg.target).toMatchObject({ type: 'imap-dav', tls: true, tlsVerify: false });
  });
});

/**
 * Google Drive as a file source (workplan 0042 T5).
 *
 * The parser is where a Drive migration's two dangerous settings are decided:
 * WHAT it is rooted at, and what happens to Google Docs. Both have a wrong
 * answer that is silent — a root that quietly becomes all of My Drive, and a
 * policy typo that quietly becomes "refuse" while the config says otherwise.
 */
describe('the google-drive file source', () => {
  const driveMapping = (source: Record<string, unknown>) => ({
    ...example,
    domains: {
      files: {
        enabled: true,
        source: { type: 'google-drive', ...source },
        target: {
          type: 'webdav',
          url: 'https://cloud.example.net/remote.php/dav/files/target/',
          user: 'target',
          auth: { kind: 'login', passwordFromEnv: 'TARGET_PASSWORD' },
        },
      },
    },
  });

  it('parses with nothing but a type, and carries NO credential fields', () => {
    // The whole point of the shape: an OAuth client secret and refresh token
    // never appear in a file that gets pasted into a support ticket. They come
    // from the environment (appliance) or the encrypted store (managed).
    const source = parseMappingConfig(driveMapping({})).domains?.files?.source;

    expect(source).toEqual({ type: 'google-drive' });
  });

  it('defaults the native-file policy to ABSENT, which the connector reads as refuse', () => {
    // Absent rather than defaulted here, matching `tls`: one place decides what
    // unset means, and it is the place that builds the connector.
    const source = parseMappingConfig(driveMapping({})).domains?.files?.source as {
      nativeFilePolicy?: string;
    };

    expect(source.nativeFilePolicy).toBeUndefined();
  });

  it('carries each of the three policies through', () => {
    for (const policy of ['refuse', 'export-office', 'export-pdf']) {
      const source = parseMappingConfig(driveMapping({ nativeFilePolicy: policy })).domains?.files
        ?.source as { nativeFilePolicy?: string };
      expect(source.nativeFilePolicy).toBe(policy);
    }
  });

  it('REFUSES an unrecognised policy instead of falling back to a default', () => {
    // An underscore instead of a hyphen would otherwise mean the owner is told
    // their Docs are un-migratable while their config says "export_office".
    expect(() => parseMappingConfig(driveMapping({ nativeFilePolicy: 'export_office' }))).toThrow(
      /nativeFilePolicy/,
    );
    // And the refusal names all three, plus the caveat that export is unmeasured.
    expect(() => parseMappingConfig(driveMapping({ nativeFilePolicy: 'export_office' }))).toThrow(
      /export-office/,
    );
  });

  it('refuses an EMPTY rootFolderId rather than treating it as My Drive', () => {
    // `""` reads as "unset" to a lenient parser, and unset means the whole of My
    // Drive. An operator who meant one shared drive would migrate everything.
    expect(() => parseMappingConfig(driveMapping({ rootFolderId: '' }))).toThrow(
      /source\.rootFolderId/,
    );
  });

  it('carries a shared drive id through as the root', () => {
    const source = parseMappingConfig(driveMapping({ rootFolderId: '0AJx-sharedDriveId' })).domains
      ?.files?.source as { rootFolderId?: string };

    expect(source.rootFolderId).toBe('0AJx-sharedDriveId');
  });
});

/**
 * Gmail as a mail source (workplan 0044). One field, because everything else
 * is fixed by Google or is a credential — and credentials never appear in a
 * mapping file (the same argument the Drive shape records).
 */
describe('the gmail mail source', () => {
  it('parses with a type and the account address, and carries NO credential fields', () => {
    const cfg = parseMappingConfig({
      ...example,
      source: { type: 'gmail', user: 'owner@gmail.com' },
    });

    expect(cfg.source).toEqual({ type: 'gmail', user: 'owner@gmail.com' });
  });

  it('refuses a missing account address: XOAUTH2 authenticates a token FOR an address', () => {
    expect(() => parseMappingConfig({ ...example, source: { type: 'gmail' } })).toThrow(
      /source\.user/,
    );
  });
});

/**
 * The Google DAV pair (workplan 0045): the same one-field shape as gmail, for
 * the same reasons — fixed endpoints derived from the address, credentials
 * never in a file.
 */
describe('the google-calendar and google-contacts sources', () => {
  it('parse with a type and the account address only', () => {
    for (const type of ['google-calendar', 'google-contacts'] as const) {
      const cfg = parseMappingConfig({ ...example, source: { type, user: 'owner@example.com' } });
      expect(cfg.source).toEqual({ type, user: 'owner@example.com' });
    }
  });

  it('refuse a missing account address: the principal URL is derived from it', () => {
    for (const type of ['google-calendar', 'google-contacts'] as const) {
      expect(() => parseMappingConfig({ ...example, source: { type } })).toThrow(/source\.user/);
    }
  });
});

describe('parseMappingConfigJson', () => {
  it('parses JSON text', () => {
    expect(parseMappingConfigJson(JSON.stringify(example)).mappingId).toBe('inbox-mail');
  });
  it('throws ConfigError on invalid JSON', () => {
    expect(() => parseMappingConfigJson('{ not json')).toThrow(ConfigError);
  });
});

/**
 * The example mapping is not documentation — it is the file an operator COPIES.
 *
 * It shipped `"baseUrl": "https://mail.example.net/jmap"` until 2026-08-08.
 * Every JMAP client here builds its session URL as
 * `${baseUrl}/.well-known/jmap` (RFC 8620 §2.2), so that example produced
 * `/jmap/.well-known/jmap` and a 404 that reads like the server is
 * misconfigured rather than the config. Found while walking an owner through a
 * first real Windows install — the value I had given them by hand was copied
 * from this file, so the mistake propagated exactly as designed.
 */
/**
 * The e2e fixture syncs against a self-signed Stalwart, and since 2026-08-09
 * certificate verification defaults ON. The workflow that turns the fixture
 * into the live mapping only ADDS host/port fields, so if `tlsVerify: false`
 * is ever dropped from the fixture the failure surfaces one lane too late --
 * as a red nightly e2e with a TLS error deep in a sync log, instead of here.
 */
describe('the e2e fixture mapping', () => {
  const fixturePath = resolve(
    __dirname,
    '../../../test/e2e/fixtures/selfhost-restart-resume.mapping.json',
  );

  it('parses, and opts its self-signed IMAP sources out of verification IN WRITING', () => {
    const parsed = parseMappingConfigJson(readFileSync(fixturePath, 'utf8'));
    expect(parsed.source).toMatchObject({ type: 'imap-oauth2', tlsVerify: false });
    expect(parsed.domains?.mail?.source).toMatchObject({ type: 'imap-oauth2', tlsVerify: false });
  });
});

describe('the shipped example mapping', () => {
  const examplePath = resolve(__dirname, '../../../deploy/selfhost/config/mapping.json.example');

  it('parses with the same parser the appliance uses', () => {
    // `.example` files are never loaded at runtime, so nothing else would ever
    // notice this file rotting away from the schema it is an example of.
    const raw = readFileSync(examplePath, 'utf8');
    expect(() => parseMappingConfigJson(raw)).not.toThrow();
  });

  it('gives target.baseUrl as a server root, with no path', () => {
    const parsed = parseMappingConfigJson(readFileSync(examplePath, 'utf8'));
    const target = parsed.target as { type: string; baseUrl?: string };
    expect(target.type).toBe('jmap');

    const url = new URL(target.baseUrl!);
    // The whole failure in one assertion: a path here becomes a path there.
    expect(url.pathname, `${target.baseUrl} would request ${url.pathname}/.well-known/jmap`).toBe(
      '/',
    );
    expect(`${target.baseUrl}/.well-known/jmap`).toBe(
      `${url.origin}/.well-known/jmap`,
    );
  });
});

describe('parseTargetFolderPrefix — one validator for both editions', () => {
  it('absent, empty and bare slashes all mean MERGE (the default)', () => {
    expect(parseTargetFolderPrefix(undefined)).toBeUndefined();
    expect(parseTargetFolderPrefix('')).toBeUndefined();
    expect(parseTargetFolderPrefix('/')).toBeUndefined();
  });

  it('trims surrounding slashes and keeps nested prefixes', () => {
    expect(parseTargetFolderPrefix('/Gmail/')).toBe('Gmail');
    expect(parseTargetFolderPrefix('archive/2026')).toBe('archive/2026');
  });

  it("refuses '..', '.' and empty segments — each escapes or mangles the account root", () => {
    expect(() => parseTargetFolderPrefix('a/../b')).toThrow(/'\.' or '\.\.' segment/);
    expect(() => parseTargetFolderPrefix('./x')).toThrow(ConfigError);
    expect(() => parseTargetFolderPrefix('a//b')).toThrow(/empty/);
  });

  it('refuses a backslash, naming the separator rule', () => {
    expect(() => parseTargetFolderPrefix('Gmail\\INBOX')).toThrow(/separator/);
  });
});

describe('applyTargetFolderPrefix — the one composition', () => {
  it('prefixes a path, stands alone for the root, and is identity without a prefix', () => {
    expect(applyTargetFolderPrefix('Gmail', 'INBOX/Sub')).toBe('Gmail/INBOX/Sub');
    expect(applyTargetFolderPrefix('Gmail', '')).toBe('Gmail');
    expect(applyTargetFolderPrefix(undefined, 'INBOX')).toBe('INBOX');
  });
});
