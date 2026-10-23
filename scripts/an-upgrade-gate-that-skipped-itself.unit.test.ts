// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN UPGRADE GATE THAT SKIPPED ITSELF: `docs/release.md` asked a person to confirm by eye that the upgrade gate's `skipIf(!HAVE_REF)` cases ran against the previous release, because without the tag they skip and the file still reports green (workplan 0025 T5, 0146 T2 step 4).
 *
 * ## What the Release preflight does instead
 *
 * `scripts/release-upgrade-gates.mjs` runs, in the candidate's checkout,
 * each chain's upgrade test with `UPGRADE_FROM_REF` set to the release
 * before, through vitest's JSON reporter, and reads the report:
 *
 * - **ledger**: `packages/ledger/src/migrate-upgrade.unit.test.ts`;
 * - **managed**: `packages/managed/src/migrate-upgrade.unit.test.ts`, the
 *   same shape (`UPGRADE_FROM_REF`, a default ref, `skipIf(!HAVE_REF)` cases,
 *   a throw under CI when the ref is missing).
 *
 * A chain passes only when its file exists at the candidate, every case in
 * it ran and passed, none was skipped, and the report shows the cases ran
 * against the release asked for (the file names the ref in its `describe`,
 * as the ledger's does). A chain whose file does not exist at the candidate
 * is printed "not exercised", and refuses.
 *
 * ## What is not an upgrade proof
 *
 * `packages/managed/src/two-chains.unit.test.ts` takes `UPGRADE_FROM_REF`
 * too, and it is not one. Its released-ref block materialises only the
 * LEDGER chain at the ref, then applies the candidate's whole managed chain
 * to an empty bookkeeping table: it tests adopting a database from before
 * the two chains split, which `v0.1.0-rc.1` had and `v0.2.0-alpha.1` does
 * not. Pointed at alpha.1 it passes without applying alpha.1's 46 managed
 * migrations. The critique of 2026-10-22 caught the design counting it; it
 * is not in the list, and a report that carries it is told so.
 *
 * ## The ledger gate had to learn which release it was upgrading from
 *
 * Run from `v0.2.0-alpha.1` on 2026-10-23, the ledger gate failed one case:
 * "still finds every leftover it declares". Its list of tables a pre-split
 * release left behind is true of rc.1, whose baseline created them, and of
 * no later release. The case now expects each leftover only from a release
 * whose migrations created that table.
 *
 * ## What this test holds
 *
 * The verdict against real vitest reports of the ledger gate
 * (`scripts/fixtures/release/vitest-*.json`): with its tag missing (six cases
 * skipped), from alpha.1 before that fix (one failed), from alpha.1 after it,
 * and from rc.1 when alpha.1 was asked for; the missing managed file; and the
 * shape both files must keep for the verdict to mean anything.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPGRADE_GATES, NOT_AN_UPGRADE_PROOF, judgeUpgradeGates } from './release-upgrade-gates.mjs';
import type { VitestReport } from './release-upgrade-gates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const report = (name: string) => JSON.parse(read(`scripts/fixtures/release/${name}`)) as VitestReport;

const LEDGER = 'packages/ledger/src/migrate-upgrade.unit.test.ts';
const MANAGED = 'packages/managed/src/migrate-upgrade.unit.test.ts';
const TWO_CHAINS = 'packages/managed/src/two-chains.unit.test.ts';
const both = { [LEDGER]: true, [MANAGED]: true };
const ledgerOnly = { [LEDGER]: true, [MANAGED]: false };

/** The ledger's real passing report from alpha.1, copied under another file's name. */
function asFile(source: VitestReport, file: string): VitestReport['testResults'][number] {
  const first = source.testResults[0]!;
  return { ...first, name: `/home/runner/work/Ownpace/Ownpace/candidate/${file}` };
}

const byCheck = (lines: Array<{ kind: string; check: string; sentence: string }>, check: string) =>
  lines.filter((l) => l.check === check);

describe('which files prove an upgrade', () => {
  it('names the two chains’ upgrade tests, and not two-chains', () => {
    expect(UPGRADE_GATES.map((g) => [g.chain, g.file])).toEqual([
      ['ledger', LEDGER],
      ['managed', MANAGED],
    ]);
    expect(NOT_AN_UPGRADE_PROOF).toEqual([TWO_CHAINS]);
  });
});

describe('the verdict on a real report', () => {
  it('refuses the ledger gate run with its tag missing: six cases skipped, and a skip is a hole', () => {
    const lines = judgeUpgradeGates({ report: report('vitest-ledger-ref-missing.json'), present: ledgerOnly, from: 'v9.9.9' });
    const ledger = byCheck(lines, 'upgrade-ledger');
    expect(ledger.map((l) => l.kind)).toEqual(['refuse']);
    expect(ledger[0]!.sentence).toMatch(/6 cases were skipped/);
  });

  it('refuses the ledger gate from alpha.1 as it was before this change: one case failed', () => {
    const lines = judgeUpgradeGates({
      report: report('vitest-ledger-from-alpha.1-stale-exception.json'),
      present: ledgerOnly,
      from: 'v0.2.0-alpha.1',
    });
    expect(byCheck(lines, 'upgrade-ledger')[0]!.sentence).toMatch(/1 case failed: .*still finds every leftover it declares/);
  });

  it('passes the ledger gate from alpha.1 now, and says the chain had nothing to upgrade', () => {
    const lines = judgeUpgradeGates({
      report: report('vitest-ledger-from-alpha.1.json'),
      present: ledgerOnly,
      from: 'v0.2.0-alpha.1',
      counts: { ledger: { from: 65, to: 65 } },
    });
    const ledger = byCheck(lines, 'upgrade-ledger');
    expect(ledger.map((l) => l.kind)).toEqual(['pass']);
    expect(ledger[0]!.sentence).toMatch(/65 → 65 migrations: nothing to upgrade on this chain/);
  });

  it('refuses a report that upgraded from another release than the one asked for', () => {
    const lines = judgeUpgradeGates({ report: report('vitest-ledger-from-rc.1.json'), present: ledgerOnly, from: 'v0.2.0-alpha.1' });
    expect(byCheck(lines, 'upgrade-ledger')[0]!.sentence).toMatch(/does not show an upgrade from v0\.2\.0-alpha\.1/);
  });
});

describe('the managed chain', () => {
  const passing = report('vitest-ledger-from-alpha.1.json');

  it('is "not exercised", and refuses, while its file does not exist at the candidate', () => {
    const lines = judgeUpgradeGates({ report: passing, present: ledgerOnly, from: 'v0.2.0-alpha.1' });
    const managed = byCheck(lines, 'upgrade-managed');
    expect(managed.map((l) => l.kind)).toEqual(['refuse']);
    expect(managed[0]!.sentence).toMatch(/not exercised/);
  });

  it('refuses when its file exists and the report has nothing for it', () => {
    const lines = judgeUpgradeGates({ report: passing, present: both, from: 'v0.2.0-alpha.1' });
    expect(byCheck(lines, 'upgrade-managed')[0]!.sentence).toMatch(/not exercised: the run reported nothing/);
  });

  it('passes when every case of its file ran from the release asked for', () => {
    const withManaged = { ...passing, testResults: [...passing.testResults, asFile(passing, MANAGED)] };
    const lines = judgeUpgradeGates({ report: withManaged, present: both, from: 'v0.2.0-alpha.1', counts: { managed: { from: 46, to: 59 } } });
    expect(byCheck(lines, 'upgrade-managed').map((l) => l.kind)).toEqual(['pass']);
    expect(byCheck(lines, 'upgrade-managed')[0]!.sentence).toMatch(/46 → 59 migrations/);
  });

  it('never counts two-chains, even passing, and says why', () => {
    const withTwoChains = { ...passing, testResults: [...passing.testResults, asFile(passing, TWO_CHAINS)] };
    const lines = judgeUpgradeGates({ report: withTwoChains, present: ledgerOnly, from: 'v0.2.0-alpha.1' });
    expect(byCheck(lines, 'upgrade-managed').map((l) => l.kind)).toEqual(['refuse']);
    expect(lines.filter((l) => l.kind === 'note').map((l) => l.sentence).join('\n')).toMatch(/two-chains.*not an upgrade proof/);
  });

  it('refuses every chain when there is no report at all', () => {
    const lines = judgeUpgradeGates({ report: null, present: both, from: 'v0.2.0-alpha.1' });
    expect(lines.filter((l) => l.kind === 'refuse').map((l) => l.check).sort()).toEqual(['upgrade-ledger', 'upgrade-managed']);
  });
});

describe('the shape the verdict relies on (the shared contract with the managed chain’s test)', () => {
  const shape = (file: string) => {
    const text = read(file);
    expect(text, `${file} reads UPGRADE_FROM_REF`).toMatch(/process\.env\.UPGRADE_FROM_REF/);
    expect(text, `${file} has skipIf(!HAVE_REF) cases`).toMatch(/\.skipIf\(!HAVE_REF\)\(/);
    expect(text, `${file} throws under CI when the ref is missing`).toMatch(
      /!HAVE_REF[^\n]{0,40}process\.env\.CI|process\.env\.CI[^\n]{0,40}!HAVE_REF/,
    );
    expect(text, `${file} names the ref it upgrades from in a describe`).toMatch(/describe\(`[^`]*\$\{\w*REF\w*\}/);
  };

  it('the ledger gate keeps it', () => {
    shape(LEDGER);
  });

  it('the managed gate keeps it when it exists, and is reported not exercised until it does', () => {
    if (existsSync(join(ROOT, MANAGED))) {
      shape(MANAGED);
    } else {
      const lines = judgeUpgradeGates({ report: report('vitest-ledger-from-alpha.1.json'), present: ledgerOnly, from: 'v0.2.0-alpha.1' });
      expect(byCheck(lines, 'upgrade-managed')[0]!.sentence).toMatch(/not exercised/);
    }
  });
});
