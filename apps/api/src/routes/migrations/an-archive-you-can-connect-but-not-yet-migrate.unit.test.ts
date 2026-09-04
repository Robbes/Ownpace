// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ARCHIVE YOU CAN CONNECT, AND CANNOT YET MIGRATE.
 *
 * Workplan 0116 T1. The `archive` kind ships in an unusual state on purpose:
 * it can be added, tested and measured, and it CANNOT be the source of a
 * mapping, because placement (T5) and idempotency by content hash (T6) are not
 * built. That is the whole point of the first slice — a person sees what their
 * export holds before anybody commits to importing 25 GB of it.
 *
 * A half-built kind is a fine thing to ship and a dangerous thing to leave
 * unguarded, because there are exactly two ways to get it wrong and this file
 * holds both shut.
 *
 * **The loud way**: the create door accepts an archive mapping. Then
 * `sourceFaceBuilder` hands the file face to a builder that does not exist,
 * and either the pass throws from inside a worker — a stack trace where a
 * sentence belonged — or, worse, it falls through to `dav`, aims a WebDAV
 * client at a folder on a disk, and reports a successful migration of nothing.
 * That second one is #597's exact shape.
 *
 * **The quiet way**: the refusal happens but says the wrong thing. "Not
 * supported" reads as *your export cannot be migrated*, which is false and
 * discouraging; the archive is fine, the product is unfinished. So the sentence
 * has to say which of those it is, the way `mode: 'one_time'` distinguishes NOT
 * WITHDRAWN from NOT BUILT a few hundred lines from here.
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

describe('a mapping FROM an archive is refused, and says which kind of no it is', () => {
  it('refuses, rather than storing a mapping nothing can run', () => {
    const paths = issuesFor(MAPPING).map((i) => i.path);
    expect(
      paths,
      'an archive mapping was accepted. Nothing builds an archive file source yet, so the ' +
        'pass would either throw from inside a worker or fall through to the DAV builder and ' +
        'report a successful migration of nothing.',
    ).toContain('sourceType');
  });

  it('says NOT BUILT, and says the export is not the problem', () => {
    const message = issuesFor(MAPPING).find((i) => i.path === 'sourceType')?.message ?? '';
    // "Not supported" would read as *your archive cannot be migrated*, which
    // is false. The archive is fine; this product is unfinished, and only one
    // of those is worth somebody re-downloading an export over.
    expect(message).toMatch(/not built yet/i);
    expect(message).toMatch(/a gap, not a limit of the archive/i);
    expect(message).toMatch(/nothing about your export prevents it/i);
    // And it names what CAN be done today, so the refusal ends somewhere.
    expect(message).toMatch(/connected, tested and measured/i);
  });

  it('still demands both fields, so the Connections door refuses a half-filled one', () => {
    // The mapping refusal above fires for every archive body; these two must
    // fire independently, because the add-form validates the same schema and
    // never reaches the mapping refusal.
    for (const missing of ['provider', 'path'] as const) {
      const body = { ...MAPPING, sourceConfig: { ...ARCHIVE_CONFIG, [missing]: '' } };
      expect(
        issuesFor(body).map((i) => i.path),
        `a '${missing}'-less archive was not refused by name`,
      ).toContain(`sourceConfig.${missing}`);
    }
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
});

describe('what an archive connection stores', () => {
  it('stores which export and where, in the engine\'s own shape', () => {
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
