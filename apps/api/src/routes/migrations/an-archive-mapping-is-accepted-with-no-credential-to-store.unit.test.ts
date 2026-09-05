// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ARCHIVE MAPPING IS ACCEPTED, AND HAS NO CREDENTIAL TO STORE.
 *
 * Workplan 0116 T1 shipped the `archive` kind half-built on purpose: it could
 * be added, tested and measured, and it could NOT be the source of a mapping,
 * because placement (T5) and idempotency by content hash (T6) were not built.
 * This file held that refusal shut — and held its WORDING, because "not
 * supported" reads as *your export cannot be migrated*, which was false.
 *
 * T5/T6 are built, so the refusal is gone and this file now holds the door
 * open in the shape it has to have:
 *
 * - a complete archive mapping is ACCEPTED, with no issue at all — the file
 *   face resolves to `ArchiveFileSource` and the pass copies out of it;
 * - the two fields the kind has are still demanded by name, so the add-form
 *   and the wizard refuse a half-filled one before anything is stored;
 * - a REUSED archive connection carries `provider` and is not asked for it
 *   again; the `path` stays each mapping's own, because a reused connection
 *   is one person's export series and every migration points at the next
 *   archive in it;
 * - an export this product does not read is refused naming the ones it does,
 *   and where each is requested — because the wrong reader does not fail, it
 *   reports an archive containing nothing.
 *
 * The rest is the shape an archive is STORED in — no credential at all, which
 * is this kind's truth rather than an omission somebody should later "fix".
 */

import { describe, it, expect } from 'vitest';
import { ARCHIVE_PROVIDERS } from '@openmig/shared';
import {
  CreateMappingBase,
  CreateMappingSchema,
  sourceConnectionConfig,
  sourceConfigOverride,
  sourceCredentialRecord,
  sourceKindFor,
} from './index.ts';

const ARCHIVE_CONFIG = {
  username: '',
  useSsl: true,
  provider: 'google-takeout',
  path: '/srv/exports/takeout-20260904',
} as const;

const MAPPING = {
  name: 'photos out of Google',
  sourceType: 'archive',
  targetType: 'webdav',
  sourceConfig: { ...ARCHIVE_CONFIG },
  targetConfig: {
    host: 'cloud.example.invalid',
    port: 443,
    username: 'someone@example.invalid',
    password: 'x',
    useSsl: true,
  },
  syncConfig: { domains: ['file'] },
} as const;

function issuesFor(body: unknown): { path: string; message: string }[] {
  const r = CreateMappingSchema.safeParse(body);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

describe('the wizard vocabulary reaches the connection kind', () => {
  it("maps 'archive' to the 'archive' connection kind", () => {
    // One word on both sides, like the three account kinds — and NOT because
    // it is an account: it is the only kind whose credential is a path.
    expect(sourceKindFor('archive')).toBe('archive');
  });

  it('is a source type the schema accepts, so a connection can be added', () => {
    // The Connections page validates through this same object. If `archive`
    // ever leaves the enum, the front door offers a card the API refuses.
    expect(CreateMappingBase.shape.sourceType.options).toContain('archive');
  });
});

describe('a mapping FROM an archive is accepted (0116 T5/T6)', () => {
  it('accepts a complete one with no issue at all', () => {
    // Until T5/T6 this body was refused by name as NOT BUILT. Now the file
    // face builds `ArchiveFileSource` and the pass copies out of the export;
    // a refusal left here would be a door shut on a room that exists.
    expect(issuesFor(MAPPING)).toEqual([]);
  });

  it('demands both fields by name, so the doors refuse a half-filled one before storing it', () => {
    for (const missing of ['provider', 'path'] as const) {
      const body = { ...MAPPING, sourceConfig: { ...ARCHIVE_CONFIG, [missing]: '' } };
      expect(
        issuesFor(body).map((i) => i.path),
        `a '${missing}'-less archive was not refused by name`,
      ).toContain(`sourceConfig.${missing}`);
    }
  });

  it('asks a REUSED connection for the path only — which export it is belongs to the row', () => {
    const reused = {
      ...MAPPING,
      sourceConnectionId: '11111111-1111-4111-8111-111111111111',
      sourceConfig: { ...ARCHIVE_CONFIG, provider: '' },
    };
    expect(issuesFor(reused)).toEqual([]);
    // And the path is still this mapping's to answer: the next export in the
    // series is a different folder, and nothing stored can know which.
    const pathless = { ...reused, sourceConfig: { ...ARCHIVE_CONFIG, provider: '', path: '' } };
    expect(issuesFor(pathless).map((i) => i.path)).toContain('sourceConfig.path');
  });

  it('refuses an unknown export by naming the ones it reads, and where to get them', () => {
    const body = { ...MAPPING, sourceConfig: { ...ARCHIVE_CONFIG, provider: 'google-photos' } };
    const message = issuesFor(body).find((i) => i.path === 'sourceConfig.provider')?.message ?? '';
    for (const p of ARCHIVE_PROVIDERS) expect(message).toContain(p);
    // WHY it is refused rather than tried: the wrong reader does not fail, it
    // reports nothing — the most alarming answer available here.
    expect(message).toMatch(/archive containing nothing/i);
    expect(message).toContain('takeout.google.com');
    expect(message).toContain('privacy.apple.com');
  });

  it('refuses a domain the archive does not carry — it is files and photos, nothing else', () => {
    const body = { ...MAPPING, syncConfig: { domains: ['email'] } };
    expect(issuesFor(body).map((i) => i.path)).toContain('syncConfig.domains');
  });
});

describe('what an archive connection stores', () => {
  it("stores which export and where, in the engine's own shape", () => {
    expect(
      sourceConnectionConfig({ sourceType: 'archive', sourceConfig: { ...ARCHIVE_CONFIG } as never }),
    ).toEqual({
      type: 'archive',
      provider: 'google-takeout',
      path: '/srv/exports/takeout-20260904',
    });
  });

  it('stores NO credential — a path is not a password', () => {
    // Explicitly, not by falling through to the catch-all, which reads
    // `username` and `password` off the config and would write a
    // credential-shaped nothing that later reads as a broken row.
    expect(
      sourceCredentialRecord({ sourceType: 'archive', sourceConfig: { ...ARCHIVE_CONFIG } as never }),
    ).toEqual({});
  });

  it('lets a mapping override WHERE, never WHICH export', () => {
    // A reused archive connection is one person's export series: the next
    // migration points at the next archive (0116 §5). Letting `provider` be
    // overridden would let one row's export be opened by the other's reader.
    expect(
      sourceConfigOverride({ sourceType: 'archive', sourceConfig: { ...ARCHIVE_CONFIG } as never }),
    ).toEqual({ path: '/srv/exports/takeout-20260904' });
  });
});
