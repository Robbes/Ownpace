// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TICK THAT KNOWS THE BOX'S SIZE (workplan 0143 T1 step 3, the alpha minimum).
 *
 * The sync tick enqueued every due migration. So the passes running at once
 * were the migrations that fell due in the same minute, and nothing bounded
 * that but the plane's limit of 300 per environment, on a machine whose two
 * stacks have 20 GB between them and whose every pass is held to 512 MB. A
 * rehearsal's twenty organisations, or one quarter hour when many migrations
 * share a schedule, would ask for more containers than the machine has.
 *
 * Now the tick counts the copying passes in flight, on the stack and per
 * organisation, and starts no more than `MAX_PASSES_IN_FLIGHT` and
 * `MAX_PASSES_PER_ORGANISATION` leave room for, longest-waiting first. What
 * this holds:
 *
 *  1. The choice, a pure function driven here: the caps, the order, and the
 *     count of the ones held for capacity.
 *  2. The count, executed on the ledger's own schema: only open rows of the
 *     kinds a pass writes, younger than the tick's staleness window.
 *  3. The caps, from their variables, with the owner's numbers as defaults,
 *     and a value that is not a number refused.
 *  4. The tick, read as text in the manner of `a-drain-that-only-said-so`:
 *     it counts, chooses after phase 2, and enqueues only what was chosen.
 *     Running it needs a database, a runner and a queue.
 *  5. A first copy run at the floor whatever its schedule (workplan 0156 T5)
 *     is decided in phase 1, after a running pass skips it and before the
 *     back-off and these caps, so it starts no pass the caps would not.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgliteDriver, runMigrations, type LedgerDriver, type LedgerConnection } from '@openmig/ledger';
import { BILLABLE_RUN_KINDS } from '@openmig/managed';
import type { PassCaps, PassesInFlight, Waiting } from './managed-sync-tick.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');

// UUID family 0143b000-…01xx, unused elsewhere in the repo.
const ORG_A = '0143b000-e29b-41d4-a716-446655440101';
const ORG_B = '0143b000-e29b-41d4-a716-446655440102';
const ORG_C = '0143b000-e29b-41d4-a716-446655440103';

type Tick = typeof import('./managed-sync-tick.ts');
let tick: Tick;

beforeAll(async () => {
  // Importing the tick opens a Pool, which throws without SYSTEM_DATABASE_URL
  // (the system role, 0138 T3 step 2). It is
  // never used here.
  process.env.SYSTEM_DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/none';
  // And the pass it triggers, run-delta-sync, opens its pools at import through
  // openTaskPools, which refuses without APP_DATABASE_URL (0138 T1).
  process.env.APP_DATABASE_URL ??= 'postgres://unused:unused@tick.test.invalid/none';
  tick = await import('./managed-sync-tick.ts');
});

const NOW = Date.parse('2026-09-28T12:00:00Z');
const startedMinutesAgo = (minutes: number): Date => new Date(NOW - minutes * 60_000);
const due = (id: string, organisation: string, lastStarted: Date | null): Waiting => ({
  id,
  tenant_id: organisation,
  last_started: lastStarted,
});
const running = (byOrganisation: Record<string, number>): PassesInFlight => {
  const map = new Map(Object.entries(byOrganisation));
  return { total: [...map.values()].reduce((sum, n) => sum + n, 0), byOrganisation: map };
};
const NOTHING_RUNS = running({});
const caps = (inFlight: number, perOrganisation: number): PassCaps => ({ inFlight, perOrganisation });
const ids = (chosen: readonly Waiting[]): string[] => chosen.map((m) => m.id);

describe('which due migrations the tick starts', () => {
  it('with a cap of 2 and one pass running, starts one of three: the one that waited longest', () => {
    const three = [
      due('m-10', ORG_A, startedMinutesAgo(10)),
      due('m-30', ORG_B, startedMinutesAgo(30)),
      due('m-20', ORG_C, startedMinutesAgo(20)),
    ];
    const { chosen, heldForCapacity } = tick.withinCapacity(
      three,
      running({ 'another-organisation': 1 }),
      caps(2, 2),
    );
    expect(ids(chosen)).toEqual(['m-30']);
    expect(heldForCapacity).toBe(2);
  });

  it('with 1 per organisation, holds back an organisation that already runs a pass, and counts it', () => {
    // The held one waited longest, so only the organisation's cap can explain
    // passing over it.
    const { chosen, heldForCapacity } = tick.withinCapacity(
      [due('a-second', ORG_A, startedMinutesAgo(90)), due('b-first', ORG_B, startedMinutesAgo(15))],
      running({ [ORG_A]: 1 }),
      caps(6, 1),
    );
    expect(ids(chosen)).toEqual(['b-first']);
    expect(heldForCapacity).toBe(1);
  });

  it('counts its own choices against the organisation too, not only what already runs', () => {
    const { chosen, heldForCapacity } = tick.withinCapacity(
      [
        due('a-old', ORG_A, startedMinutesAgo(60)),
        due('a-new', ORG_A, startedMinutesAgo(30)),
        due('b', ORG_B, startedMinutesAgo(45)),
      ],
      NOTHING_RUNS,
      caps(6, 1),
    );
    expect(ids(chosen)).toEqual(['a-old', 'b']);
    expect(heldForCapacity).toBe(1);
  });

  it('starts a migration that never ran before one that did', () => {
    const { chosen } = tick.withinCapacity(
      [due('ran-long-ago', ORG_A, startedMinutesAgo(24 * 60)), due('never-ran', ORG_B, null)],
      NOTHING_RUNS,
      caps(1, 2),
    );
    expect(ids(chosen)).toEqual(['never-ran']);
  });

  it('starts nothing while the stack is full, and counts every due migration as held', () => {
    const two = [due('x', ORG_A, null), due('y', ORG_B, null)];
    for (const inFlight of [running({ [ORG_C]: 3 }), running({ [ORG_C]: 5 })]) {
      // Five is more than the cap: passes somebody started by hand are
      // counted, and the tick waits for them.
      const { chosen, heldForCapacity } = tick.withinCapacity(two, inFlight, caps(3, 2));
      expect(chosen).toEqual([]);
      expect(heldForCapacity).toBe(2);
    }
  });

  it('starts them all when there is room, longest-waiting first, which is the order they are enqueued in', () => {
    const { chosen, heldForCapacity } = tick.withinCapacity(
      [
        due('m-5', ORG_A, startedMinutesAgo(5)),
        due('m-never', ORG_B, null),
        due('m-50', ORG_C, startedMinutesAgo(50)),
      ],
      NOTHING_RUNS,
      caps(6, 2),
    );
    expect(ids(chosen)).toEqual(['m-never', 'm-50', 'm-5']);
    expect(heldForCapacity).toBe(0);
  });

  it('gives the same migrations the same answer every tick: the id breaks a tie', () => {
    const same = startedMinutesAgo(20);
    const pair = [due('m-2', ORG_A, same), due('m-1', ORG_B, same)];
    const first = tick.withinCapacity(pair, NOTHING_RUNS, caps(1, 2));
    const reversed = tick.withinCapacity([...pair].reverse(), NOTHING_RUNS, caps(1, 2));
    expect(ids(first.chosen)).toEqual(['m-1']);
    expect(ids(reversed.chosen)).toEqual(['m-1']);
  });

  it('leaves the lists it is given as they were', () => {
    const list = [due('late', ORG_A, startedMinutesAgo(1)), due('early', ORG_B, startedMinutesAgo(9))];
    const inFlight = running({ [ORG_A]: 1 });
    tick.withinCapacity(list, inFlight, caps(3, 2));
    expect(ids(list)).toEqual(['late', 'early']);
    expect([...inFlight.byOrganisation]).toEqual([[ORG_A, 1]]);
  });
});

describe('the caps, from their variables', () => {
  it('are the owner’s numbers when unset: 3 on the stack, which is the OTA stack’s, and 2 per organisation', () => {
    expect(tick.DEFAULT_MAX_PASSES_IN_FLIGHT).toBe(3);
    expect(tick.DEFAULT_MAX_PASSES_PER_ORGANISATION).toBe(2);
    for (const blank of [undefined, '', '  ']) {
      expect(tick.passCapFromEnv('MAX_PASSES_IN_FLIGHT', blank, 3)).toBe(3);
    }
  });

  it('takes a whole number, as live’s 6', () => {
    expect(tick.passCapFromEnv('MAX_PASSES_IN_FLIGHT', '6', 3)).toBe(6);
  });

  it('refuses anything else, naming the variable, the value and the default', () => {
    for (const raw of ['six', '0', '-2', '2.5']) {
      expect(() => tick.passCapFromEnv('MAX_PASSES_PER_ORGANISATION', raw, 2)).toThrow(
        `MAX_PASSES_PER_ORGANISATION must be a whole number, at least 1 — got ${JSON.stringify(raw)}. ` +
          'Leave it unset for the default of 2.',
      );
    }
  });
});

describe('what the tick counts as in flight', () => {
  let driver: LedgerDriver;
  let conn: LedgerConnection;

  beforeAll(async () => {
    driver = pgliteDriver({});
    await runMigrations({ driver, logger: () => {} });
    conn = await driver.acquire();
    for (const [id, name] of [
      [ORG_A, 'in-flight-a'],
      [ORG_B, 'in-flight-b'],
    ]) {
      await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, $2, 'active')`, [id, name]);
    }
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  /** A run row with no migration of its own, which the schema allows. */
  async function runRow(organisation: string, kind: string, status: string, minutesAgo: number): Promise<void> {
    await conn.query(
      `INSERT INTO run (tenant_id, kind, status, started_at)
       VALUES ($1, $2, $3, now() - ($4::int * interval '1 minute'))`,
      [organisation, kind, status, minutesAgo],
    );
  }

  it('counts the open passes of each organisation, and nothing else', async () => {
    await runRow(ORG_A, 'incremental', 'running', 1);
    await runRow(ORG_A, 'initial_copy', 'running', 40);
    // Not a pass: a listing holds a container too, but 0143 T1 counts the
    // runs that copy, and the others have no row the tick could wait on.
    await runRow(ORG_A, 'discovery', 'running', 1);
    // Finished.
    await runRow(ORG_B, 'incremental', 'succeeded', 2);
    // Killed three hours ago and never closed: older than the window, so it
    // holds no memory and must not hold a slot for ever.
    await runRow(ORG_B, 'incremental', 'running', 180);
    await runRow(ORG_B, 'incremental', 'running', 5);

    const { rows } = await conn.query<{ tenant_id: string; running: number }>(tick.PASSES_IN_FLIGHT_SQL, [
      tick.STALE_RUN_AFTER_MS,
      [...BILLABLE_RUN_KINDS],
    ]);
    const byOrganisation = Object.fromEntries(rows.map((r) => [r.tenant_id, Number(r.running)]));
    expect(byOrganisation).toEqual({ [ORG_A]: 2, [ORG_B]: 1 });
    // The window is the tick's own, well inside the three hours above.
    expect(tick.STALE_RUN_AFTER_MS).toBeLessThan(180 * 60_000);
  });
});

/** Comments removed: this file's own prose names the calls it looks for. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('the tick applies it', () => {
  const TICK = (() => {
    const whole = code(readFileSync(join(HERE, 'managed-sync-tick.ts'), 'utf8'));
    const body = whole.indexOf("run: leavesAReference('managed-sync-tick', async () => {");
    expect(body, 'the scheduled task body is no longer recognisable').toBeGreaterThan(-1);
    return whole.slice(body);
  })();
  const at = (needle: string): number => {
    const found = TICK.indexOf(needle);
    expect(found, `the tick no longer contains ${needle}`).toBeGreaterThan(-1);
    return found;
  };
  const count = (needle: string): number => TICK.split(needle).length - 1;

  it('reads both caps from their variables, with their defaults', () => {
    expect(TICK).toMatch(
      /passCapFromEnv\(\s*'MAX_PASSES_IN_FLIGHT',\s*process\.env\.MAX_PASSES_IN_FLIGHT,\s*DEFAULT_MAX_PASSES_IN_FLIGHT,?\s*\)/,
    );
    expect(TICK).toMatch(
      /passCapFromEnv\(\s*'MAX_PASSES_PER_ORGANISATION',\s*process\.env\.MAX_PASSES_PER_ORGANISATION,\s*DEFAULT_MAX_PASSES_PER_ORGANISATION,?\s*\)/,
    );
  });

  it('counts what is in flight with the staleness window and the copying kinds', () => {
    expect(TICK).toMatch(
      /pool\.query<[^>]*>\(\s*PASSES_IN_FLIGHT_SQL,\s*\[STALE_RUN_AFTER_MS, \[\.\.\.BILLABLE_RUN_KINDS\]\],?\s*\)/,
    );
  });

  it('chooses after phase 2, from every eligible migration, and enqueues only what it chose', () => {
    const scopes = at('enabledDomainsForMappings(');
    const choose = at('const capacity = withinCapacity(eligible, inFlight, caps);');
    const chosen = at('const toEnqueue = capacity.chosen;');
    const enqueue = at('await mapWithConcurrency(toEnqueue,');
    expect(scopes).toBeLessThan(choose);
    expect(choose).toBeLessThan(chosen);
    expect(chosen).toBeLessThan(enqueue);
    // Nothing else becomes what is enqueued, and nothing else enqueues.
    expect(count('toEnqueue =')).toBe(1);
    expect(count('toEnqueue.push')).toBe(0);
    expect(count('mapWithConcurrency(')).toBe(1);
    expect(count('runDeltaSync.trigger(')).toBe(1);
    expect(at('runDeltaSync.trigger(')).toBeGreaterThan(enqueue);
  });

  it('runs a first copy at the floor only where the schedule was asked, so the caps still choose (0156 T5)', () => {
    // A migration whose first copy is unfinished is due at the floor whatever
    // its schedule. That is ONE answer in phase 1, and everything that bounded
    // a due migration before bounds this one: the pass already running skips
    // it first (never two at once), the back-off holds a failing one after,
    // and the caps choose among the due ones last. Moved anywhere else, the
    // floor would start passes the box was never sized for.
    const running = at('if (m.running) {');
    const facts = at('const facts = { firstCopyUnfinished: m.first_copy_unfinished };');
    const asked = at('isDue = isSyncDue(schedule, m.last_started, now, facts);');
    const fallback = at('isDue = isSyncDue(defaultScheduleFor(m.id), m.last_started, now, facts);');
    const heldBack = at('heldBackByFailures(');
    const pushed = at('due.push(m);');
    const choose = at('const capacity = withinCapacity(eligible, inFlight, caps);');
    expect(running).toBeLessThan(facts);
    expect(facts).toBeLessThan(asked);
    expect(asked).toBeLessThan(fallback);
    expect(fallback).toBeLessThan(heldBack);
    expect(heldBack).toBeLessThan(pushed);
    expect(pushed).toBeLessThan(choose);
    // Asked in one place only: a second call without the fact would be a
    // migration due by its schedule on one path and by the floor on another.
    expect(count('isSyncDue(')).toBe(2);
    // And the tick says how many it ran that way.
    expect(TICK).toMatch(/^\s+firstCopies: rows\.filter\(\(m\) => m\.first_copy_unfinished\)\.length,$/m);
  });

  it('counts the held ones in the summary, and says how many in one line that names none of them', () => {
    expect(TICK).toMatch(/^\s+heldForCapacity: capacity\.heldForCapacity,$/m);
    const start = at('if (capacity.heldForCapacity > 0) {');
    const line = TICK.slice(start, TICK.indexOf('\n    }\n', start));
    expect(line).toContain('${capacity.heldForCapacity} due migration(s) wait for a free pass');
    expect(line, 'the line names migrations; it gives the count').not.toMatch(/\.id\b|\.map\(/);
  });
});

describe('the operator can set both, and they reach the tick', () => {
  const example = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.env.example'), 'utf8');

  it('are in the example, blank, so the OTA stack keeps the defaults and live writes its own', () => {
    expect(example).toMatch(/^MAX_PASSES_IN_FLIGHT=$/m);
    expect(example).toMatch(/^MAX_PASSES_PER_ORGANISATION=$/m);
    expect(example).toContain('Live sets 6.');
  });
});
