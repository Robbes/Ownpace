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
 * - **0142 T3's mail from the machine itself**: every message `box-checks.sh`
 *   and `tell-owner.sh` can send has a row too, under the name the script
 *   gives it. Each script names its messages once, as `MSG_…='<name>'` lines,
 *   and each of those names is used in its code, so a message added without a
 *   name, or a name nobody sends, fails here as well as a name without a row.
 *
 * And the operator runbook links it, where an operator already looks when
 * something is wrong (0142 T6).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** The scripts that mail the owner from the machine itself (0142 T3). */
const MAILERS = ['deploy/compose/box-checks.sh', 'deploy/compose/tell-owner.sh'];

/** The messages a script names, one `MSG_<VARIABLE>='<name>'` line each. */
function messages(rel: string): Array<{ variable: string; name: string }> {
  const text = existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : '';
  return [...text.matchAll(/^(MSG_[A-Z_]+)='([^']+)'$/gm)].map((m) => ({ variable: m[1]!, name: m[2]! }));
}

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

  it("has a row for every message 0142 T3's scripts send from the machine, under the same name", () => {
    const names = MAILERS.flatMap((rel) => messages(rel).map((m) => m.name));
    // Five from box-checks.sh, three from tell-owner.sh: not vacuous.
    expect(names.length, 'no MSG_ names found in box-checks.sh and tell-owner.sh').toBeGreaterThanOrEqual(8);
    expect(
      names.filter((name) => !rows.includes(name)),
      'a message box-checks.sh or tell-owner.sh sends has no row in docs/incident-runbook.md: say what it ' +
        'means, where to look first, and the first thing to do',
    ).toEqual([]);
  });

  it('each message is named once, and every name is one the script sends', () => {
    for (const rel of MAILERS) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      const found = messages(rel);
      expect(new Set(found.map((m) => m.name)).size, `${rel} names a message twice`).toBe(found.length);
      const code = text
        .split('\n')
        .filter((l) => !/^\s*#/.test(l) && !/^MSG_[A-Z_]+='/.test(l))
        .join('\n');
      for (const { variable } of found) {
        expect(code, `${rel}: ${variable} is named and never sent`).toContain(`$${variable}`);
      }
      // No message by a name of its own, around the list: a subject is always one of them.
      expect(code, `${rel} passes tell-owner.sh a name that is not a MSG_ variable`).not.toMatch(/\btell\s+'[^']*'|\btell\s+"[^$"][^"]*"/);
    }
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

describe('where the operator finds it', () => {
  it("is linked from the operator runbook's Health & troubleshooting", () => {
    const operator = readFileSync(join(ROOT, 'docs/operator-runbook.md'), 'utf8');
    const section = operator.split(/^## Health & troubleshooting$/m)[1]?.split(/^## /m)[0] ?? '';
    expect(section).toMatch(/\]\(\.\/incident-runbook\.md\)/);
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
