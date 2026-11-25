// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONLY THE LAST 90 DAYS AT THE DOORS (workplan 0170 §5.2): `recentOnly` on
 * create and update.
 *
 *  1. create takes `recentOnly: true` for a migration that has mail, files or
 *     calendars, and refuses it, on the field, for one of contacts and tasks
 *     alone, where it would copy what a migration of everything copies;
 *  2. what create stores: `{ days: 90, anchor }` in the override, beside a
 *     reused connection's own answers, and nothing for a migration of
 *     everything with its own connection, as before;
 *  3. update takes `recentOnly` as a boolean, the route deciding its way
 *     (§5.3, `only-the-last-90-days-one-way` in shared).
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, vi } from 'vitest';
import type express from 'express';

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  };
});

const { CreateMappingSchema, UpdateMappingSchema, createdOverride } = await import('./index.ts');

/** A Dropbox migration as the wizard posts it, with the data types and the choice given. */
function createBody(domains: string[], recentOnly?: boolean, sourceConnectionId?: string) {
  return {
    name: 'a Dropbox migration',
    sourceType: 'dropbox',
    targetType: 'nextcloud',
    ...(sourceConnectionId ? { sourceConnectionId } : {}),
    sourceConfig: {
      username: 'dropbox',
      clientId: 'app-key',
      clientSecret: 'app-secret',
      refreshToken: 'a-refresh-token',
      rootPath: '/Projects',
    },
    targetConfig: { url: 'https://cloud.example.invalid', username: 'a@example.invalid', password: 'x' },
    syncConfig: { domains },
    ...(recentOnly === undefined ? {} : { recentOnly }),
  };
}

const recentIssues = (body: unknown) =>
  (CreateMappingSchema.safeParse(body).error?.issues ?? [])
    .filter((i) => i.path.join('.') === 'recentOnly')
    .map((i) => i.message);

describe('1. create', () => {
  it('takes recentOnly for a migration that has files', () => {
    expect(recentIssues(createBody(['file'], true))).toEqual([]);
    expect(recentIssues(createBody(['file'], false))).toEqual([]);
  });

  it('refuses it for contacts and tasks alone, on the field, saying what to do', () => {
    const issues = recentIssues({ ...createBody(['contact', 'task'], true), sourceType: 'carddav' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/contacts and tasks are always copied whole/);
  });
});

describe('2. what create stores', () => {
  const NOW = new Date('2026-11-24T10:00:00.000Z');
  const parsed = (body: unknown) => CreateMappingSchema.parse(body);

  it('the setting, anchored at the moment the migration is created', () => {
    expect(createdOverride(parsed(createBody(['file'], true)), NOW)).toEqual({
      recentOnly: { days: 90, anchor: NOW.toISOString() },
    });
  });

  it('beside a reused connection own answers', () => {
    const reused = parsed(createBody(['file'], true, '00000000-0000-4000-8000-000000000001'));
    expect(createdOverride(reused, NOW)).toEqual({
      rootPath: '/Projects',
      recentOnly: { days: 90, anchor: NOW.toISOString() },
    });
  });

  it('nothing for a migration of everything with its own connection, as before', () => {
    expect(createdOverride(parsed(createBody(['file'])), NOW)).toBeNull();
    expect(createdOverride(parsed(createBody(['file'], false)), NOW)).toBeNull();
  });
});

describe('3. update', () => {
  it('takes recentOnly as a boolean, and nothing else', () => {
    expect(UpdateMappingSchema.safeParse({ recentOnly: false }).success).toBe(true);
    expect(UpdateMappingSchema.safeParse({ recentOnly: true }).success).toBe(true);
    expect(UpdateMappingSchema.safeParse({ recentOnly: 'yes' }).success).toBe(false);
  });
});
