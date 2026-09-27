// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TICK THAT NEVER SAID IT RAN (workplan 0142 T2): the beat, in the database.
 *
 * Against PGlite with both chains, as `app_user` for what the request path may
 * do and over the owner connection for what the tick does:
 *
 * - `recordTickBeat` writes one row per task, and a second beat replaces it;
 * - `readTickBeat` answers `up` at 30 seconds, and `down` at six minutes or
 *   with no beat at all;
 * - the application role may read the beat and may not write one, so no
 *   request can say the tick ran;
 * - a beat that cannot be written does not throw.
 *
 * It fails today: neither the table nor the functions exist.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withSubject } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import { readTickBeat, recordTickBeat, SYNC_TICK_BEAT, TICK_LATE_AFTER_MS } from './tick-beat.ts';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const after = (ms: number) => new Date(NOW.getTime() + ms);

let driver: LedgerDriver;
/** The same database over the owner connection, as the tick writes it. */
let asOwner: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  asOwner = { ...driver, role: undefined };
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await sql(asOwner, 'DELETE FROM sync_tick_beat');
});

/** One statement, in its own transaction, as the driver's role. */
async function sql(source: LedgerDriver, text: string, params: unknown[] = []): Promise<unknown[]> {
  const conn = await source.acquire();
  try {
    await conn.query('BEGIN');
    if (source.role) await conn.query(`SET LOCAL ROLE ${source.role}`);
    const result = await conn.query(text, params);
    await conn.query('COMMIT');
    return result.rows;
  } catch (error) {
    await conn.query('ROLLBACK');
    throw error;
  } finally {
    conn.release();
  }
}

const beat = (at: Date, task?: string) =>
  withSubject(asOwner, 'system:sync-tick', (db) => recordTickBeat(db, at, task));
const read = (at: Date, source: LedgerDriver = driver) =>
  withSubject(source, 'anyone', (db) => readTickBeat(db, at));

describe('the beat', () => {
  it('is one row per task, and a second beat replaces it', async () => {
    expect(await beat(NOW)).toBe(true);
    expect(await beat(after(60_000))).toBe(true);
    // Compared in the database, whatever type the driver hands a timestamp back as.
    const rows = (await sql(asOwner, 'SELECT task, beat_at = $1::timestamptz AS latest FROM sync_tick_beat', [
      after(60_000).toISOString(),
    ])) as Array<{ task: string; latest: boolean }>;
    expect(rows).toEqual([{ task: SYNC_TICK_BEAT, latest: true }]);
  });

  it('keeps each task apart', async () => {
    await beat(NOW);
    await beat(NOW, 'managed-digest');
    const tasks = (await sql(asOwner, 'SELECT task FROM sync_tick_beat ORDER BY task')) as Array<{ task: string }>;
    expect(tasks.map((r) => r.task)).toEqual(['managed-digest', SYNC_TICK_BEAT]);
  });
});

describe('reading it', () => {
  it('is up at 30 seconds, as the request path reads it', async () => {
    await beat(NOW);
    expect(await read(after(30_000))).toBe('up');
  });

  it('is still up at the edge, and down just past it', async () => {
    await beat(NOW);
    expect(await read(after(TICK_LATE_AFTER_MS - 1_000))).toBe('up');
    expect(await read(after(TICK_LATE_AFTER_MS + 1_000))).toBe('down');
  });

  it('is down at six minutes', async () => {
    await beat(NOW);
    expect(await read(after(6 * 60_000))).toBe('down');
  });

  it('is down with no beat at all', async () => {
    expect(await read(NOW)).toBe('down');
  });
});

describe('who may write it', () => {
  it('the application role may read the beat', async () => {
    await beat(NOW);
    expect(await sql(driver, 'SELECT task FROM sync_tick_beat')).toHaveLength(1);
  });

  it('and may not write one, so no request can say the tick ran', async () => {
    await expect(
      sql(driver, 'INSERT INTO sync_tick_beat (task, beat_at) VALUES ($1, now())', [SYNC_TICK_BEAT]),
    ).rejects.toThrow(/permission denied/);
    await beat(NOW);
    await expect(sql(driver, 'UPDATE sync_tick_beat SET beat_at = now()')).rejects.toThrow(
      /permission denied/,
    );
    await expect(sql(driver, 'DELETE FROM sync_tick_beat')).rejects.toThrow(/permission denied/);
  });

  it('holds a task id to a name’s shape', async () => {
    await expect(
      sql(asOwner, 'INSERT INTO sync_tick_beat (task, beat_at) VALUES ($1, now())', ['someone@example.test']),
    ).rejects.toThrow(/sync_tick_beat_task/);
  });

  it('a beat that cannot be written does not throw', async () => {
    // As the request path: denied, and answered false rather than thrown, so
    // the tick's own work would stand.
    const written = await withSubject(driver, 'anyone', (db) => recordTickBeat(db, NOW));
    expect(written).toBe(false);
    expect(await read(NOW)).toBe('down');
  });
});
