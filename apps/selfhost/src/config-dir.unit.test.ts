// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigDir } from './config-dir.ts';

function validConfig(mappingId: string): string {
  return JSON.stringify({
    tenantId: '00000000-0000-4000-8000-000000000001',
    mappingId,
    source: {
      type: 'imap-oauth2',
      host: 'outlook.office365.com',
      port: 993,
      user: 'user@example.test',
      auth: { kind: 'xoauth2', tokenFromEnv: 'O365_ACCESS_TOKEN' },
    },
    target: {
      type: 'jmap',
      baseUrl: 'http://stalwart:8080',
      user: 'target@dev.local',
      auth: { kind: 'basic', passwordFromEnv: 'TARGET_PASSWORD' },
    },
    schedule: { cron: '*/15 * * * *' },
  });
}

describe('loadConfigDir', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'selfhost-config-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads and validates every *.json, sorted, ignoring non-json', () => {
    writeFileSync(join(dir, 'b.json'), validConfig('mapping-b'));
    writeFileSync(join(dir, 'a.json'), validConfig('mapping-a'));
    writeFileSync(join(dir, 'README.md'), 'not a config');

    const loaded = loadConfigDir(dir);
    expect(loaded.map((l) => l.config.mappingId)).toEqual(['mapping-a', 'mapping-b']);
    expect(loaded[0]!.config.schedule?.cron).toBe('*/15 * * * *');
  });

  it('throws with the offending path on an invalid config (never skips silently)', () => {
    writeFileSync(join(dir, 'good.json'), validConfig('ok'));
    writeFileSync(join(dir, 'bad.json'), '{ not valid json');
    expect(() => loadConfigDir(dir)).toThrow(/bad\.json/);
  });

  it('rejects duplicate mappingIds across files', () => {
    writeFileSync(join(dir, 'one.json'), validConfig('dup'));
    writeFileSync(join(dir, 'two.json'), validConfig('dup'));
    expect(() => loadConfigDir(dir)).toThrow(/Duplicate mappingId 'dup'/);
  });

  it('returns [] for an empty directory', () => {
    expect(loadConfigDir(dir)).toEqual([]);
  });
});

/**
 * The id derivation (2026-09-05, found by the archive-import gate, 0116 T10).
 *
 * The old `uuidFromString` kept the seed's first sixteen bytes, and every seed
 * begins with the 36-character tenant id — so two mappings in one tenant were
 * ONE row: one status, one ledger, one finish. The pinned legacy value below is
 * the same for `x` and `y`, which is the whole defect in one line; the new
 * derivation must tell them apart and must stay stable, because everything the
 * appliance keeps is keyed by it.
 */
describe('uuidFromString — a second mapping in a tenant is not the first', () => {
  const tenant = '00000000-0000-4000-8000-000000000001';

  it('derives DIFFERENT ids for two mappings of one tenant', async () => {
    const { uuidFromString, mappingSeed } = await import('./config-dir.ts');
    const x = uuidFromString(mappingSeed(tenant, 'x'));
    const y = uuidFromString(mappingSeed(tenant, 'y'));
    expect(x).not.toBe(y);
    expect(x).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is stable: the same seed derives the same id, and the connection ids differ from the mapping id', async () => {
    const { uuidFromString, mappingSeed } = await import('./config-dir.ts');
    expect(uuidFromString(mappingSeed(tenant, 'x'))).toBe(uuidFromString(mappingSeed(tenant, 'x')));
    const ids = new Set([
      uuidFromString(mappingSeed(tenant, 'x')),
      uuidFromString(`${tenant}:source:imap`),
      uuidFromString(`${tenant}:target:jmap`),
      uuidFromString(`${tenant}:mailbox:source:someone`),
      uuidFromString(`${tenant}:mailbox:target:someone`),
    ]);
    expect(ids.size).toBe(5);
  });

  it('keeps the legacy derivation byte for byte, so an upgraded appliance can find its row', async () => {
    const { legacyUuidFromString, mappingSeed } = await import('./config-dir.ts');
    // Computed from the derivation as it shipped until 2026-09-05. Same for
    // `x` and `y`: the first sixteen bytes of the seed are the tenant id.
    expect(legacyUuidFromString(mappingSeed(tenant, 'x'))).toBe('30303030-3030-4030-2d30-3030302d3430');
    expect(legacyUuidFromString(mappingSeed(tenant, 'y'))).toBe('30303030-3030-4030-2d30-3030302d3430');
  });
});
