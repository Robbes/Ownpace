// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VOICE PER PERSON (workplan 0176 §11, T7; D8 (a); managed migration 0068).
 *
 * How a person's own pages speak to them is chosen per person, by the member:
 * Dutch with *u*, Dutch with *je*, or English. A mother may be *je* and a
 * grandfather *u* in one family. The person's row holds the choice, and
 * nothing outside the three; unset is today's page: the browser's language,
 * with *u*. The code's list (`PERSON_VOICES`) is the migration's, held equal
 * here.
 *
 * PGlite, both chains.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { PERSON_VOICES } from '@openmig/shared';
import { managedMigrationsDir, runManagedMigrations } from './migrate-managed.ts';

// UUID family 01760068-…, unused elsewhere in the repo.
const U = (n: string) => `01760068-e29b-41d4-a716-4466554400${n}`;
const OURS = U('01');
const ANNA = U('11');

let driver: LedgerDriver;

async function owner(statement: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(statement, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const setVoice = (voice: string | null) =>
  owner(`UPDATE person SET voice = $1 WHERE id = $2`, [voice, ANNA]).then(
    () => null,
    (e: Error) => e.message,
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner('INSERT INTO tenant (id, name) VALUES ($1, $2)', [OURS, 'Ours']);
  await owner(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1, $2, 'Anna')`, [ANNA, OURS]);
}, 60_000);

afterAll(async () => {
  await driver.end?.();
});

describe('how a person’s pages speak to them (T7, D8 (a))', () => {
  it('is unset for a person made before it, which is today’s page', async () => {
    expect(await owner(`SELECT voice FROM person WHERE id = $1`, [ANNA])).toEqual([{ voice: null }]);
  });

  it('takes each of the three, and none', async () => {
    for (const voice of PERSON_VOICES) expect(await setVoice(voice)).toBeNull();
    expect(await setVoice(null)).toBeNull();
  });

  it('refuses anything else', async () => {
    for (const voice of ['nl', 'je', 'de', 'NL-JE', '']) expect(await setVoice(voice)).toMatch(/person_voice_check/);
  });

  it('is the list the code offers, word for word', () => {
    const file = readFileSync(join(managedMigrationsDir(), '0068_a_voice_per_person.sql'), 'utf8');
    const check = /person_voice_check CHECK \(([\s\S]*?)\)\s*\);/.exec(file)?.[1] ?? '';
    expect([...check.matchAll(/'([a-z-]+)'::text/g)].map((m) => m[1])).toEqual([...PERSON_VOICES]);
  });
});
