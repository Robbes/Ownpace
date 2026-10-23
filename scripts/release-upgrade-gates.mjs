#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE UPGRADE GATES, FROM THE RELEASE BEFORE, READ RATHER THAN EYEBALLED
 * (workplan 0025 T5, 0146 T2 step 4; the Release workflow's preflight).
 *
 * Each migration chain has an upgrade test that materialises the chain at a
 * released tag, applies it, applies the candidate's chain on top, and
 * compares. Without the tag its cases are skipped, `skipIf(!HAVE_REF)`, and
 * the file still reports green. `docs/release.md` asked a person to confirm
 * the cases ran; this reads vitest's JSON report instead. A chain passes when:
 *
 * - its test file exists at the candidate (otherwise: "not exercised");
 * - the report has it, every case passed, and none was skipped;
 * - the cases ran against the release asked for: the file names the ref in
 *   its `describe`, as the ledger's does, and the report must show it.
 *
 * `packages/managed/src/two-chains.unit.test.ts` also reads
 * `UPGRADE_FROM_REF` and is NOT an upgrade proof: its released-ref block
 * applies the ledger chain at the ref and then the candidate's whole managed
 * chain to an empty bookkeeping table. It tests adopting a database from
 * before the chains split. It is not run here, and a report that carries it
 * is told it does not count.
 *
 * Usage, from the root of a checkout holding the scripts, with the
 * candidate checked out beside it and installed:
 *
 *   node scripts/release-upgrade-gates.mjs --candidate <dir> --from <tag>
 *
 * It runs the gates in the candidate with no token in their environment,
 * prints a line per chain and each chain's migration count at the two refs,
 * and exits 1 on a refusal; with `RELEASE_LINES` set (the preflight), it
 * writes the lines there and exits 0, so the verdict counts them.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, refuse, note, report } from './release-github.mjs';

export const UPGRADE_GATES = [
  { chain: 'ledger', file: 'packages/ledger/src/migrate-upgrade.unit.test.ts', migrations: 'packages/ledger/migrations' },
  { chain: 'managed', file: 'packages/managed/src/migrate-upgrade.unit.test.ts', migrations: 'packages/managed/migrations' },
];

export const NOT_AN_UPGRADE_PROOF = ['packages/managed/src/two-chains.unit.test.ts'];

const UNRUN = new Set(['skipped', 'pending', 'todo', 'disabled']);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The report's results for one repository-relative file. */
function resultsFor(report, file) {
  return (report?.testResults ?? []).filter((t) => t.name === file || t.name.endsWith(`/${file}`));
}

/** One line per chain, and a note for anything in the report that does not count. */
export function judgeUpgradeGates({ report: vitest, present, from, counts = {} }) {
  const lines = [];
  for (const gate of UPGRADE_GATES) {
    const check = `upgrade-${gate.chain}`;
    if (!present[gate.file]) {
      lines.push(
        refuse(check, `not exercised: ${gate.file} does not exist at the candidate, so the ${gate.chain} chain's upgrade from ${from} is not tested`),
      );
      continue;
    }
    const results = resultsFor(vitest, gate.file);
    const cases = results.flatMap((t) => t.assertionResults ?? []);
    if (results.length === 0 || cases.length === 0) {
      lines.push(refuse(check, `not exercised: the run reported nothing for ${gate.file}`));
      continue;
    }
    const failed = cases.filter((c) => c.status === 'failed');
    const unrun = cases.filter((c) => UNRUN.has(c.status));
    const passed = cases.filter((c) => c.status === 'passed');
    const fromRef = passed.filter((c) => (c.fullName ?? [...(c.ancestorTitles ?? []), c.title].join(' ')).includes(from));
    if (failed.length > 0) {
      lines.push(refuse(check, `${plural(failed.length, 'case', 'cases')} failed: ${failed.map((c) => c.title).join('; ')}`));
    } else if (unrun.length > 0) {
      lines.push(
        refuse(
          check,
          `${plural(unrun.length, 'case was', 'cases were')} skipped (${unrun.map((c) => c.title).join('; ')}): a skip here is a hole, not a pass`,
        ),
      );
    } else if (passed.length === 0 || results.some((t) => t.status !== 'passed')) {
      lines.push(refuse(check, `${gate.file} did not pass as a file (${results.map((t) => t.status).join(', ')})`));
    } else if (fromRef.length === 0) {
      lines.push(refuse(check, `the report does not show an upgrade from ${from}: no case names it, so UPGRADE_FROM_REF was not what ran`));
    } else {
      const c = counts[gate.chain];
      const chain =
        c === undefined
          ? ''
          : c.from === c.to
            ? `; ${c.from} → ${c.to} migrations: nothing to upgrade on this chain, so the gate ran its mechanics and no migration`
            : `; ${c.from} → ${c.to} migrations`;
      lines.push(pass(check, `all ${passed.length} cases ran and passed, ${fromRef.length} of them upgrading from ${from}${chain}`));
    }
  }
  for (const file of NOT_AN_UPGRADE_PROOF) {
    if (resultsFor(vitest, file).length > 0) {
      lines.push(note('upgrade', `${file} is in the report and is not counted: two-chains adopts a pre-split database, it is not an upgrade proof`));
    }
  }
  return lines;
}

/** The environment a candidate's code runs with: no token of any kind. */
export function withoutTokens(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/TOKEN/i.test(k)));
}

/** How many `.sql` files a chain has at a ref, read from git. */
function countAt(cwd, ref, dir) {
  const out = execFileSync('git', ['ls-tree', '--name-only', ref, `${dir}/`], { cwd, encoding: 'utf8' });
  return out.split('\n').filter((p) => p.endsWith('.sql')).length;
}

function main(argv) {
  const arg = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const candidate = resolve(arg('--candidate') ?? '.');
  const from = arg('--from');
  if (!from) {
    report([refuse('upgrade-ledger', 'no release to upgrade from was named (--from)'), refuse('upgrade-managed', 'no release to upgrade from was named (--from)')]);
    return process.env.RELEASE_LINES ? 0 : 1;
  }
  const present = Object.fromEntries(UPGRADE_GATES.map((g) => [g.file, existsSync(join(candidate, g.file))]));
  const files = UPGRADE_GATES.filter((g) => present[g.file]).map((g) => g.file);

  let vitest = null;
  if (files.length > 0) {
    const dir = mkdtempSync(join(tmpdir(), 'upgrade-gates-'));
    const out = join(dir, 'report.json');
    try {
      const run = spawnSync(
        'pnpm',
        ['exec', 'vitest', 'run', '--project', 'unit', ...files, '--reporter=json', `--outputFile=${out}`],
        {
          cwd: candidate,
          env: { ...withoutTokens(process.env), UPGRADE_FROM_REF: from, CI: 'true', SKIP_STALWART: 'true' },
          stdio: ['ignore', 'ignore', 'inherit'],
          timeout: 20 * 60_000,
        },
      );
      console.log(`vitest exited ${run.status ?? run.signal} for ${files.join(', ')}`);
      vitest = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const counts = {};
  for (const gate of UPGRADE_GATES) {
    try {
      counts[gate.chain] = { from: countAt(candidate, from, gate.migrations), to: countAt(candidate, 'HEAD', gate.migrations) };
    } catch {
      // A chain the release did not have yet counts from zero.
      counts[gate.chain] = { from: 0, to: countAt(candidate, 'HEAD', gate.migrations) };
    }
  }
  const lines = judgeUpgradeGates({ report: vitest, present, from, counts });
  report(lines);
  if (process.env.RELEASE_LINES) return 0;
  return lines.some((l) => l.kind === 'refuse') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
