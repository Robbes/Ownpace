#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * squawk over both migration chains, REPORT ONLY (workplan 0165).
 *
 * Run by .github/workflows/migration-locks.yml after its install step has put
 * a squawk checked by its sha256 on the PATH. One squawk run per migration
 * file, read the way `runMigrations` applies it: one transaction per file
 * (`--assume-in-transaction`), on Postgres 18, the version the stacks run.
 *
 * What it writes to the job summary:
 *   - every finding in a file this change adds or changes, in full, and a
 *     warning annotation on that line;
 *   - for every other file, which is history (an applied migration never
 *     changes, ADR-0045), a count per rule;
 *   - each rule that no migration here can meet while each file is one
 *     transaction, marked as such, and each rule the runner meets for every
 *     file (a lock timeout), marked as met and given no warning;
 *   - each file squawk could not read, with what it said.
 *
 * It exits 0 whatever it found, a file it could not read included: that is a
 * warning on the run and a section in the summary. Turning any rule blocking
 * is the owner's decision (workplan 0165, D2), and changes this file.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The two chains, in the order a managed deployment applies them (ADR-0036). */
export const CHAINS = ['packages/ledger/migrations', 'packages/managed/migrations'];

/** squawk's options: each file is one transaction, as `runMigrations` applies it, on the Postgres the stacks run. */
export const SQUAWK_ARGS = ['--reporter', 'gcc', '--assume-in-transaction', '--pg-version', '18.0'];

/**
 * Rules no migration here can meet while `runMigrations` wraps each file in
 * BEGIN/COMMIT: CONCURRENTLY cannot run inside a transaction block, and the
 * runner has no way to apply a file outside one (workplan 0165 §2).
 */
export const CANNOT_BE_MET = new Map([
  ['require-concurrent-index-creation', 'CREATE INDEX CONCURRENTLY cannot run inside a transaction, and every migration file is one'],
  ['require-concurrent-index-deletion', 'DROP INDEX CONCURRENTLY cannot run inside a transaction, and every migration file is one'],
]);

/**
 * Rules the runner meets for every file, which squawk, reading each file
 * alone, cannot see: `applyOne` sets `lock_timeout` for each file's own
 * transaction (`MIGRATION_LOCK_TIMEOUT`, packages/ledger/src/migrate.ts;
 * workplan 0165, D3 and T4). Such a finding is listed and counted, marked as
 * met, and gets no warning on its line.
 */
export const MET_BY_THE_RUNNER = new Map([
  ['require-lock-timeout', 'runMigrations sets lock_timeout for each file (MIGRATION_LOCK_TIMEOUT, packages/ledger/src/migrate.ts)'],
]);

const GCC_LINE = /^(.+?):(\d+):(\d+):\s*(\w+):\s*(.*)$/;
const RULE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

/**
 * squawk's `--reporter gcc` output for one file, as `{ line, column, level, rule, message }`
 * per finding. A line that is not in that shape is not a finding. The rule is
 * the message's first word when it is a rule name, otherwise `unknown`.
 */
export function parseGcc(output) {
  const findings = [];
  for (const raw of String(output).split('\n')) {
    const m = GCC_LINE.exec(raw.trim());
    if (!m) continue;
    const [, , line, column, level, rest] = m;
    const first = rest.split(/\s+/, 1)[0] ?? '';
    const rule = RULE_NAME.test(first) ? first : 'unknown';
    const message = rule === 'unknown' ? rest : rest.slice(first.length).trim();
    findings.push({ line: Number(line), column: Number(column), level, rule, message });
  }
  return findings;
}

/**
 * What one squawk run over one file says: `{ findings }`, or `{ unread }` with
 * the reason. A run with findings is read whatever its exit code; a run that
 * exits 0 with none found nothing; a run that did not start, or exits
 * non-zero with no finding in its output, did not read the file.
 */
export function readRun({ status, stdout, stderr, error }) {
  if (error) return { unread: `squawk did not start: ${error.message ?? String(error)}` };
  const findings = parseGcc(stdout);
  if (findings.length > 0) return { findings };
  if (status === 0) return { findings: [] };
  const said = `${stdout ?? ''}${stderr ?? ''}`.trim().split('\n').slice(0, 3).join(' / ');
  return { unread: `squawk exited ${status ?? 'by a signal'} and named no finding${said ? `: ${said}` : ''}` };
}

/** `|` and line breaks would end a Markdown table cell. */
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
/** A workflow command's message may not hold `%`, CR or LF unescaped. */
const command = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/**
 * The job summary, from `{ version, files, changed, results }`: `results` maps
 * each file to `readRun`'s answer, and `changed` is the set of files this
 * change adds or changes. Returns `{ markdown, annotations, warnings }`.
 */
export function report({ version, files, changed, results }) {
  const out = [];
  const annotations = [];
  const warnings = [];
  const mine = files.filter((f) => changed.has(f));
  const history = files.filter((f) => !changed.has(f));
  const unread = files.filter((f) => results.get(f)?.unread !== undefined);

  out.push('## Migration locks (squawk, report only)', '');
  out.push(
    `${version}, one run per file over \`${CHAINS.join('` and `')}\`, each file read as one transaction (\`--assume-in-transaction\`, as \`runMigrations\` applies it) on Postgres 18. ` +
      `${files.length - unread.length} of ${files.length} files read. Nothing here fails the job (workplan 0165).`,
    '',
  );

  out.push(`### Files this change adds or changes (${mine.length})`, '');
  if (mine.length === 0) {
    out.push('No migration file changed in this run.', '');
  } else {
    const rows = [];
    for (const file of mine) {
      const r = results.get(file);
      for (const f of r?.findings ?? []) {
        const why = CANNOT_BE_MET.get(f.rule);
        const met = MET_BY_THE_RUNNER.has(f.rule);
        rows.push(`| \`${file}:${f.line}\` | \`${f.rule}\`${why ? ' (cannot be met here)' : met ? ' (met by the runner)' : ''} | ${cell(f.message)} |`);
        if (!met) annotations.push(`::warning file=${file},line=${f.line},title=squawk ${f.rule}::${command(f.message)}`);
      }
    }
    if (rows.length === 0) out.push('squawk found nothing in them.', '');
    else out.push('| Where | Rule | What squawk says |', '|---|---|---|', ...rows, '');
  }

  out.push(`### History: every other file (${history.length})`, '');
  out.push('An applied migration never changes (ADR-0045), so these are counted, not listed.', '');
  const byRule = new Map();
  for (const file of history) {
    for (const f of results.get(file)?.findings ?? []) {
      const seen = byRule.get(f.rule) ?? { places: 0, files: new Set() };
      seen.places += 1;
      seen.files.add(file);
      byRule.set(f.rule, seen);
    }
  }
  if (byRule.size === 0) {
    out.push('squawk found nothing in them.', '');
  } else {
    out.push('| Rule | Places | Files | Note |', '|---|---:|---:|---|');
    for (const [rule, seen] of [...byRule].sort((a, b) => b[1].places - a[1].places || a[0].localeCompare(b[0]))) {
      out.push(`| \`${rule}\` | ${seen.places} | ${seen.files.size} | ${CANNOT_BE_MET.has(rule) ? `cannot be met here: ${CANNOT_BE_MET.get(rule)}` : MET_BY_THE_RUNNER.has(rule) ? `met by the runner: ${MET_BY_THE_RUNNER.get(rule)}` : ''} |`);
    }
    out.push('');
  }

  if (unread.length > 0) {
    out.push(`### Not read (${unread.length})`, '');
    for (const file of unread) out.push(`- \`${file}\`: ${cell(results.get(file).unread)}`);
    out.push('');
    warnings.push(`squawk could not read ${unread.length} of ${files.length} migration files; the summary lists them.`);
  }
  if (files.length === 0) warnings.push('No migration file was found to read.');

  return { markdown: out.join('\n'), annotations, warnings };
}

/** The migration files of both chains, in apply order. */
export function migrationFiles(root) {
  return CHAINS.flatMap((dir) =>
    readdirSync(join(root, dir))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => `${dir}/${f}`),
  );
}

/** The migration files this run's commit adds or changes against its first parent, or none on a dispatch. */
function changedFiles(root, event) {
  if (event !== 'pull_request' && event !== 'push') return { changed: new Set() };
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AMR', 'HEAD^1', 'HEAD', '--', ...CHAINS], { cwd: root, encoding: 'utf8' });
    return { changed: new Set(out.split('\n').filter((f) => f.endsWith('.sql'))) };
  } catch (err) {
    return { changed: new Set(), warning: `Could not read which migration files changed (${err.message}); every file is counted as history.` };
  }
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = migrationFiles(root);
  const { changed, warning } = changedFiles(root, process.env.EVENT_NAME ?? '');
  const v = spawnSync('squawk', ['--version'], { encoding: 'utf8' });
  const version = v.error ? 'squawk (not found)' : (v.stdout || '').trim().split('\n')[0] || 'squawk';
  const results = new Map();
  for (const file of files) {
    results.set(file, readRun(spawnSync('squawk', [...SQUAWK_ARGS, file], { cwd: root, encoding: 'utf8', timeout: 60_000 })));
  }
  const { markdown, annotations, warnings } = report({ version, files, changed, results });
  if (warning) warnings.unshift(warning);
  for (const a of annotations) console.log(a);
  for (const w of warnings) console.log(`::warning::${command(w)}`);
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
