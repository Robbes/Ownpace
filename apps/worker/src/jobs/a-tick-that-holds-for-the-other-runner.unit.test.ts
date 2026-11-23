// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TICK THAT HOLDS FOR THE OTHER RUNNER (ADR-0054; workplan 0167 T6).
 *
 * While the managed edition's jobs could run on Trigger.dev or on pg-boss (until alpha.18), two
 * runners left running at once would run two sync ticks, and each runner
 * serialises a migration's passes on its own queue only: two passes on one
 * migration, two writers. The procedures stop one runner before they start the
 * other. This holds the net under them, the tick's interlock:
 *
 * 1. **Its beats need no migration.** Each runner's tick writes a beat of its
 *    own, `managed-sync-tick-trigger` and `managed-sync-tick-pg-boss`, into
 *    `sync_tick_beat`: names the table's CHECK admits (managed migration 0030),
 *    written by the system role under the grants 0033 gives it on the whole
 *    table. Run on PGlite with both chains, as `ownpace_system`.
 * 2. **The other runner's beat is fresh for a minute and a half**, read as the
 *    readiness route reads the shared one, in the database.
 * 3. **The tick asks first, and holds as under an operator's hold**: before the
 *    operator's hold and the enumeration, it reads the other runner's beat,
 *    and while that is fresh it starts no pass and beats as its own runner
 *    alone, never the shared beat, so two left running start nothing and the
 *    status page's *Scheduled syncs* goes down. Otherwise both beats, at one
 *    time. Read as text, as `a-tick-that-says-it-ran` reads the tick, because
 *    the run needs a database, a runner and a queue;
 *    `a-system-role-that-is-not-the-owner` runs it against Postgres.
 *
 * Only the pg-boss runner is left since alpha.18, so only its half runs: it
 * holds while a Trigger.dev tick beats.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgliteDriver, runMigrations, withSubject, type LedgerDriver } from '@openmig/ledger';
import {
  ANOTHER_RUNNER_BEAT_MS,
  SYNC_TICK_BEAT,
  SYNC_TICK_BEAT_ON,
  readTickBeat,
  recordTickBeat,
  runManagedMigrations,
} from '@openmig/managed';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

const NOW = new Date('2026-11-22T12:00:00.000Z');
const after = (ms: number) => new Date(NOW.getTime() + ms);
const RUNNER_BEATS = Object.values(SYNC_TICK_BEAT_ON);

describe('the beats of the two runners need no migration', () => {
  it('are two, one per runner, each apart from the shared beat the status page reads', () => {
    expect(SYNC_TICK_BEAT_ON).toEqual({ trigger: 'managed-sync-tick-trigger', 'pg-boss': 'managed-sync-tick-pg-boss' });
    expect(RUNNER_BEATS).not.toContain(SYNC_TICK_BEAT);
  });

  it('are names the table’s CHECK admits, read from the migration that made it', () => {
    const made = read('packages/managed/migrations/0030_a_tick_that_says_it_ran.sql');
    const check = /CONSTRAINT sync_tick_beat_task CHECK \(task ~ '([^']+)'\)/.exec(made);
    expect(check, '0030 no longer states the shape of a task id the way this reads it').not.toBeNull();
    const shape = new RegExp(check![1]!);
    for (const beat of [SYNC_TICK_BEAT, ...RUNNER_BEATS]) expect(shape.test(beat), beat).toBe(true);
  });

  it('are written under grants on the whole table, which name no task', () => {
    const grants = read('packages/managed/migrations/0033_a_system_role_that_is_not_the_owner.sql');
    expect(grants).toContain('GRANT SELECT, INSERT ON TABLE public.sync_tick_beat TO ownpace_system;');
    expect(grants).toContain('GRANT UPDATE (beat_at) ON TABLE public.sync_tick_beat TO ownpace_system;');
  });

  describe('on a database with both chains, as the system role', () => {
    let driver: LedgerDriver;
    let asSystem: LedgerDriver;
    let asOwner: LedgerDriver;

    beforeAll(async () => {
      driver = pgliteDriver({});
      await runMigrations({ driver, logger: () => {} });
      await runManagedMigrations({ driver, logger: () => {} });
      // The role managed migration 0033 makes, as the tick connects.
      asSystem = { ...driver, role: 'ownpace_system' };
      asOwner = { ...driver, role: undefined };
    }, 120_000);

    afterAll(async () => {
      await driver?.end();
    });

    beforeEach(async () => {
      await query(asOwner, 'DELETE FROM sync_tick_beat');
    });

    /** One statement, in its own transaction, as the driver's role. */
    async function query<R>(source: LedgerDriver, text: string, params: unknown[] = []): Promise<R[]> {
      const conn = await source.acquire();
      try {
        await conn.query('BEGIN');
        if (source.role) await conn.query(`SET LOCAL ROLE ${source.role}`);
        const result = await conn.query<R>(text, params);
        await conn.query('COMMIT');
        return result.rows;
      } catch (error) {
        await conn.query('ROLLBACK');
        throw error;
      } finally {
        conn.release();
      }
    }

    const beat = (at: Date, task: string) => withSubject(asSystem, 'system:sync-tick', (db) => recordTickBeat(db, at, task));
    const fresh = (at: Date, task: string) =>
      withSubject(asSystem, 'system:sync-tick', (db) => readTickBeat(db, at, task, ANOTHER_RUNNER_BEAT_MS));

    it('writes each runner’s beat, and a second replaces the first, with no grant or migration of their own', async () => {
      for (const task of RUNNER_BEATS) {
        expect(await beat(NOW, task), task).toBe(true);
        expect(await beat(after(60_000), task), task).toBe(true);
      }
      const rows = await query<{ task: string; latest: boolean }>(
        asSystem,
        'SELECT task, beat_at = $1::timestamptz AS latest FROM sync_tick_beat ORDER BY task',
        [after(60_000).toISOString()],
      );
      expect(rows).toEqual([...RUNNER_BEATS].sort().map((task) => ({ task, latest: true })));
    });

    it('reads the other runner’s beat as fresh for a minute and a half, and never with none', async () => {
      const other = SYNC_TICK_BEAT_ON['pg-boss'];
      expect(await fresh(NOW, other)).toBe('down');
      await beat(NOW, other);
      expect(await fresh(after(60_000), other)).toBe('up');
      expect(await fresh(after(ANOTHER_RUNNER_BEAT_MS - 1_000), other)).toBe('up');
      expect(await fresh(after(ANOTHER_RUNNER_BEAT_MS + 1_000), other)).toBe('down');
      // The shared beat's window is its own, and untouched: five minutes.
      expect(await withSubject(asSystem, 'anyone', (db) => readTickBeat(db, after(4 * 60_000), other))).toBe('up');
    });
  });
});

/** Comments removed: this file's own prose names the very calls it guards. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('the tick asks first, and holds as under an operator’s hold', () => {
  const TICK = (() => {
    const whole = code(read('apps/worker/src/jobs/managed-sync-tick.ts'));
    const body = whole.indexOf("export const managedSyncTickRun = leavesAReference(\n  'managed-sync-tick',");
    expect(body, 'the tick’s run is no longer recognisable').toBeGreaterThan(-1);
    return whole.slice(body);
  })();
  const at = (needle: string): number => {
    const found = TICK.indexOf(needle);
    expect(found, `the tick no longer contains ${needle}`).toBeGreaterThan(-1);
    return found;
  };
  const count = (needle: string): number => TICK.split(needle).length - 1;

  const OWN = 'const ownBeat = SYNC_TICK_BEAT_ON[context.runner.name];';
  const OTHER = "const otherRunner = 'trigger';";
  const READ_OTHER = "const otherRunnerBeats = (await readTickBeat(drizzle(pool), now, otherBeat, ANOTHER_RUNNER_BEAT_MS)) === 'up';";
  /** The pg-boss half's second rule (0167 T6): a shared beat that differs from its own, asked on pg-boss only. */
  const READ_SHARED =
    "!otherRunnerBeats && (await sharedBeatWrittenByAnother(pool, now, ownBeat));";
  const ASKED = 'if (otherRunnerBeats || sharedBeatIsAnothers) {';
  const HELD = TICK.slice(at(ASKED), TICK.indexOf('return summary;', at(ASKED)));

  it('beats as the runner it runs on, and reads the other runner’s beat, each by its own name', () => {
    expect(count(OWN)).toBe(1);
    expect(count(OTHER)).toBe(1);
    expect(count('const otherBeat = SYNC_TICK_BEAT_ON[otherRunner];')).toBe(1);
    expect(count('readTickBeat(')).toBe(1);
    expect(count(READ_OTHER)).toBe(1);
    expect(count(READ_SHARED)).toBe(1);
    expect(count('sharedBeatWrittenByAnother(')).toBe(1);
  });

  it('asks before the operator’s hold, the enumeration and any enqueue', () => {
    const asked = at(ASKED);
    expect(at(OWN)).toBeLessThan(asked);
    expect(asked).toBeLessThan(at('const hold = await readOpenPause(drizzle(pool));'));
    expect(asked).toBeLessThan(at('pool.query<TickRow>(ACTIVE_MAPPINGS_SQL'));
    expect(asked).toBeLessThan(at('context.runner.enqueue('));
    // Nothing before it but the clock and the two beats it reads.
    expect(TICK.slice(0, asked).match(/\bawait \w+/g)).toEqual(['await readTickBeat', 'await sharedBeatWrittenByAnother']);
    expect(at(READ_OTHER)).toBeLessThan(at(READ_SHARED));
    expect(at(READ_SHARED)).toBeLessThan(asked);
  });

  it('holding, starts no pass, says so, and beats as its own runner alone, never the shared beat', () => {
    expect(HELD).toContain('const summary = { anotherRunner: otherRunner, triggered: 0, ms: Date.now() - startedAt };');
    expect(HELD).toContain('log.warn(');
    expect(HELD).not.toContain('enqueue');
    const beats = HELD.match(/await recordTickBeat\([^\n]*\);/g) ?? [];
    expect(beats).toEqual(['await recordTickBeat(drizzle(pool), new Date(), ownBeat);']);
  });

  it('otherwise beats both, at one time, under the operator’s hold and after its passes', () => {
    expect(count('await recordTickBeat(drizzle(pool), heldAt);')).toBe(1);
    expect(count('await recordTickBeat(drizzle(pool), heldAt, ownBeat);')).toBe(1);
    expect(count('await recordTickBeat(drizzle(pool), beatAt);')).toBe(1);
    expect(count('await recordTickBeat(drizzle(pool), beatAt, ownBeat);')).toBe(1);
    expect(count('await recordTickBeat(')).toBe(5);
  });

  it('runs on pg-boss alone since alpha.18, and still holds for a Trigger.dev tick’s beat', () => {
    const context = code(read('apps/worker/src/jobs/run-context.ts'));
    expect(context).toContain("readonly name: 'pg-boss';");
    expect(SYNC_TICK_BEAT_ON.trigger).toBe('managed-sync-tick-trigger');
    expect(SYNC_TICK_BEAT_ON['pg-boss']).toBe('managed-sync-tick-pg-boss');
  });
});
