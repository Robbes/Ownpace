// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ALERT NOBODY KNOWS WHAT TO DO ABOUT IS THE NEXT THING TO BE IGNORED
 * (workplan 0142 T6).
 *
 * `docs/incident-runbook.md` has one row per alert: what it means, where to
 * look first, and the first thing to do. The row is found by the name the
 * status page gives it, so a row added to the page's Ownpace group, or an alert
 * added anywhere on it, without a row here fails this file. The Ownpace group
 * is where 0142 T1 puts the alerts; its rows are checked before the alerts
 * exist, so the runbook is ready the day they do.
 *
 * It also holds three things the runbook carries for other plans:
 *
 * - **0143 T2d's step for stopping one organisation**, by the lifecycle's own
 *   table: an `active` migration to `paused`, a `continuous` one to `cutover`,
 *   never a `continuous` one to `paused`. The moves are asked of
 *   `updateTransition` itself, so a change to the table fails here before the
 *   runbook tells somebody to do something the product refuses;
 * - **0139 T8's breach procedure**, linked wherever a tester's data may have
 *   leaked, once that page exists;
 * - **0142 T3's `box-checks.sh`**, whose messages will need rows too. It does
 *   not exist yet. When it does, this file fails until it is taught to read
 *   them.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { updateTransition } from '@openmig/shared';

const ROOT = join(import.meta.dirname, '..');
const RUNBOOK = readFileSync(join(ROOT, 'docs/incident-runbook.md'), 'utf8');

interface Endpoint {
  readonly name: string;
  readonly group?: string;
  readonly alerts?: unknown;
}

const PAGE = parse(readFileSync(join(ROOT, 'deploy/compose/gatus.yaml'), 'utf8')) as {
  readonly endpoints?: ReadonlyArray<Endpoint>;
};

/** The first column of the runbook's alert table, bold markers removed. */
function runbookRows(): string[] {
  const section = RUNBOOK.split(/^## One row per alert$/m)[1]?.split(/^## /m)[0] ?? '';
  return section
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
    .map((line) => line.split('|')[1]!.replace(/\*\*/g, '').trim())
    .filter((cell) => cell !== '' && cell !== 'Row');
}

describe('every alert has a row', () => {
  const rows = runbookRows();

  it('finds the table and the page, so the checks below are not vacuous', () => {
    expect(rows.length, 'the runbook has no alert table under "One row per alert"').toBeGreaterThan(4);
    expect(PAGE.endpoints?.length ?? 0).toBeGreaterThan(4);
  });

  it("has a row for each of the page's Ownpace rows, under the same name", () => {
    const ownpace = (PAGE.endpoints ?? []).filter((e) => e.group === 'Ownpace').map((e) => e.name);
    expect(ownpace.length).toBeGreaterThan(4);
    const missing = ownpace.filter((name) => !rows.includes(name));
    expect(
      missing,
      'a status row that 0142 T1 alerts on has no row in docs/incident-runbook.md: say what it ' +
        'means, where to look first, and the first thing to do',
    ).toEqual([]);
  });

  it('has a row for anything on the page that sends an alert', () => {
    const alerting = (PAGE.endpoints ?? []).filter((e) => e.alerts !== undefined).map((e) => e.name);
    expect(alerting.filter((name) => !rows.includes(name))).toEqual([]);
  });

  it("has 0142 T2's Scheduled syncs row ready for the day it is on the page", () => {
    expect(rows).toContain('Scheduled syncs');
  });

  it("is taught to read 0142 T3's box checks the day they exist", () => {
    const found = execFileSync('git', ['ls-files', '*box-checks.sh'], { cwd: ROOT, encoding: 'utf8' }).trim();
    expect(
      found,
      'box-checks.sh has landed (0142 T3). Teach this file to read the names of the messages it ' +
        'sends, and give each a row in docs/incident-runbook.md.',
    ).toBe('');
  });
});

describe("0143 T2d's step for stopping one organisation", () => {
  it('moves by the lifecycle table, and the table still allows those moves', () => {
    expect(RUNBOOK).toMatch(/SET status = 'paused'\s+WHERE id = '<id>' AND status = 'active'/);
    expect(RUNBOOK).toMatch(/SET status = 'cutover' WHERE id = '<id>' AND status = 'continuous'/);
    expect(updateTransition('active', 'paused')).toMatchObject({ apply: true });
    expect(updateTransition('continuous', 'cutover')).toMatchObject({ apply: true });
  });

  it('never tells anyone to pause a continuous migration, which the table refuses', () => {
    expect(updateTransition('continuous', 'paused')).toMatchObject({ code: 'after_cutover' });
    expect(RUNBOOK).not.toMatch(/SET status = 'paused'[^\n]*status = 'continuous'/);
    expect(RUNBOOK).toMatch(/Never to `paused`/);
  });

  it('writes down what it moved, so each can be put back', () => {
    expect(RUNBOOK).toMatch(/SELECT id, status FROM mailbox_mapping/);
  });
});

describe("0139 T8's breach procedure", () => {
  it('is where a possible breach goes, once the page exists', () => {
    // Linked from the start: the page arrives with #1241, and a link to it is
    // what the runbook needs the day it lands.
    expect(RUNBOOK).toMatch(/\]\(\.\/breach-procedure\.md\)/);
    if (existsSync(join(ROOT, 'docs/breach-procedure.md'))) {
      expect(readFileSync(join(ROOT, 'docs/breach-procedure.md'), 'utf8')).toMatch(/^# /m);
    }
  });
});
