// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS A MINUTE (workplan 0143 T2b): the doors' half.
 *
 * The screens offer four cadences, the fastest every 15 minutes, and the API
 * stored any cron expression it could read, `* * * * *` among them. Both doors
 * now refuse a schedule faster than the floor: create, and since the schedule
 * can be changed on the migration page (0125 T8), update, through the one
 * function they share. The floor is the tick's own number (its half has its
 * own test, in orchestration).
 *
 *  1. a schedule faster than the floor is refused on both doors, in the same
 *     words, which name the floor and what the schedule asked for;
 *  2. the four cadences the screens offer, and slower ones, pass;
 *  3. a schedule the tick cannot read is still refused for that, alone.
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

const { CreateMappingSchema, UpdateMappingSchema } = await import('./index.ts');

/** A Dropbox migration as the wizard posts it, on the schedule given. */
function createBody(schedule: string) {
  return {
    name: 'a Dropbox migration',
    sourceType: 'dropbox',
    targetType: 'nextcloud',
    sourceConfig: {
      username: 'dropbox',
      clientId: 'app-key',
      clientSecret: 'app-secret',
      refreshToken: 'a-refresh-token',
    },
    targetConfig: {
      url: 'https://cloud.example.invalid',
      username: 'a@example.invalid',
      password: 'x',
    },
    syncConfig: { domains: ['file'], schedule },
  };
}

type Parsed = {
  success: boolean;
  error?: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> };
};

const scheduleIssues = (result: Parsed) =>
  (result.error?.issues ?? []).filter((i) => i.path.join('.') === 'syncConfig.schedule').map((i) => i.message);

const onCreate = (schedule: string) => scheduleIssues(CreateMappingSchema.safeParse(createBody(schedule)));
const onUpdate = (schedule: string) => scheduleIssues(UpdateMappingSchema.safeParse({ syncConfig: { schedule } }));

describe('a schedule faster than the floor', () => {
  it.each([
    ['* * * * *', 'would start a pass every minute.'],
    ['*/5 * * * *', 'would start a pass every 5 minutes.'],
    ['0,10 * * * *', 'would start a pass every 10 minutes.'],
  ])('%s is refused on both doors, in the same words', (schedule, asked) => {
    const create = onCreate(schedule);
    expect(create).toHaveLength(1);
    expect(create[0]).toContain('A migration syncs at most every 15 minutes');
    expect(create[0]).toContain(asked);
    expect(create[0]).toContain('Choose 15 minutes or longer.');
    expect(onUpdate(schedule)).toEqual(create);
  });
});

describe('the cadences the screens offer, and slower ones', () => {
  it.each([['*/15 * * * *'], ['0 * * * *'], ['0 */6 * * *'], ['0 2 * * *'], ['@weekly'], ['30 1 1 * *']])(
    '%s passes both doors',
    (schedule) => {
      expect(onCreate(schedule)).toEqual([]);
      expect(onUpdate(schedule)).toEqual([]);
    },
  );
});

describe('a schedule the tick cannot read', () => {
  it('is refused for that, and for nothing else', () => {
    const issues = onUpdate('61 * * * *');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('The sync schedule is not a valid cron expression');
  });
});
