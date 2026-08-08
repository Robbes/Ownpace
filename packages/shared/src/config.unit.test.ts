// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMappingConfig, parseMappingConfigJson, ConfigError } from './config';

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
