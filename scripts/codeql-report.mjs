#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT CODEQL FOUND, AND WHETHER IT READ THE TREE (workplan 0178 T5; the
 * owner's D1 (a) and D8 (a) of 2026-11-26).
 *
 * `codeql.yml` runs CodeQL's default suite for JavaScript and TypeScript and
 * writes its SARIF to `$SARIF_DIR`. This reads it and writes the job's
 * summary: every alert, counted by query, then listed with its file and
 * line. It fails the job on no alert, the ReDoS queries' included: CodeQL
 * reports only, and a query blocks later only through a report that fails on
 * that query alone, one at a time (T9).
 *
 * A SCAN THAT DID NOT FINISH FAILS THE JOB (security-scan.yml's rule):
 *
 *   - no SARIF, or one with no run;
 *   - a file CodeQL says it could not extract (`…/diagnostics/extraction-errors`,
 *     or a notification at level `error`);
 *   - a source file the checkout tracks that is not among the files CodeQL
 *     says it extracted (`…/diagnostics/successfully-extracted-files`), or
 *     fewer than MIN_EXTRACTED of them. CodeQL parses TypeScript with its own
 *     compiler, not this repository's TypeScript 7 (0178 §4.1), so a file it
 *     silently read nothing of is the risk this is for;
 *   - on an ordinary run, an alert in the known-bad fixture, which that run
 *     leaves out (`.github/codeql/codeql.yml`): the configuration was not the
 *     one meant.
 *
 * THE PROOF (0178 §8 step 2). With `PROOF=true` (a dispatch with `proof`) the
 * run reads the fixture too and uploads nothing, and it is red unless every
 * one of PROOF_QUERIES is reported in the fixture: otherwise the workflow is
 * not reading what it should.
 *
 * `.mjs` for the reason `audit-advisories.mjs` gives: a CI step runs it on a
 * bare checkout, with no `node_modules`. Its guard is
 * `a-flow-across-files-nothing-followed.unit.test.ts`.
 *
 * Usage:  SARIF_DIR=<dir> PROOF=<true|false> node scripts/codeql-report.mjs
 */

import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The known-bad fixture's folder: read by a proof run, left out of every other. */
export const FIXTURE = 'scripts/fixtures/codeql-known-bad';

/** What a proof run must report in the fixture, each of them. */
export const PROOF_QUERIES = ['js/sql-injection', 'js/reflected-xss'];

/** The fewest files a finished scan of this tree extracts (about 2,500 source files on 2026-11-26). */
export const MIN_EXTRACTED = 1000;

/** The files CodeQL's JavaScript extractor reads, by extension. */
export const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** What CodeQL leaves out by default: installed packages and minified files. */
export const LEFT_OUT = /(?:^|\/)node_modules\/|[.-]min\.js$/;

const inFixture = (path) => path === FIXTURE || path.startsWith(`${FIXTURE}/`);

/** The tracked files a finished scan must have extracted. */
export function expectedFiles(tracked, { proof }) {
  return tracked.filter((path) => SOURCE.test(path) && !LEFT_OUT.test(path) && (proof || !inFixture(path)));
}

const uriOf = (location) => String(location?.physicalLocation?.artifactLocation?.uri ?? '').replace(/^file:\/\/\/?/, '');

/**
 * One SARIF file's alerts, the files CodeQL says it extracted, and the ones
 * it says it could not. Throws on a file that is not SARIF, or has no run.
 */
export function readSarif(text) {
  const sarif = JSON.parse(text);
  if (!Array.isArray(sarif?.runs) || sarif.runs.length === 0) throw new Error('a SARIF file with no run');
  const results = [];
  const extracted = new Set();
  const problems = [];
  for (const run of sarif.runs) {
    for (const result of run.results ?? []) {
      const location = result.locations?.[0];
      results.push({ rule: String(result.ruleId ?? result.rule?.id ?? '?'), uri: uriOf(location), line: location?.physicalLocation?.region?.startLine ?? 0 });
    }
    for (const invocation of run.invocations ?? []) {
      for (const note of invocation.toolExecutionNotifications ?? []) {
        const id = String(note.descriptor?.id ?? '');
        const uri = uriOf(note.locations?.[0]);
        if (id.endsWith('/diagnostics/successfully-extracted-files')) {
          if (uri) extracted.add(uri);
        } else if (id.endsWith('/diagnostics/extraction-errors') || note.level === 'error') {
          problems.push({ uri: uri || '(no file)', text: String(note.message?.text ?? id) });
        }
      }
    }
  }
  return { results, extracted, problems };
}

/** The job's verdict, its log lines and its summary. */
export function report({ sarifs, tracked, proof }) {
  const stopped = [];
  const results = [];
  const extracted = new Set();
  const problems = [];
  if (sarifs.length === 0) stopped.push('CodeQL wrote no SARIF');
  for (const text of sarifs) {
    try {
      const read = readSarif(text);
      results.push(...read.results);
      for (const uri of read.extracted) extracted.add(uri);
      problems.push(...read.problems);
    } catch (error) {
      stopped.push(`a SARIF file could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (stopped.length === 0) {
    for (const p of problems) stopped.push(`not extracted: ${p.uri}: ${p.text}`);
    const missing = expectedFiles(tracked, { proof }).filter((path) => !extracted.has(path));
    for (const path of missing) stopped.push(`tracked, and not among the files CodeQL extracted: ${path}`);
    if (extracted.size < MIN_EXTRACTED) stopped.push(`CodeQL says it extracted ${extracted.size} files, fewer than the ${MIN_EXTRACTED} a finished scan of this tree reads`);
    const inside = results.filter((r) => inFixture(r.uri));
    if (proof) {
      for (const query of PROOF_QUERIES) {
        if (!inside.some((r) => r.rule === query)) stopped.push(`the proof run did not report ${query} in ${FIXTURE}, so the workflow is not reading what it should`);
      }
    } else if (inside.length > 0) {
      stopped.push(`an ordinary run reported in ${FIXTURE}, which its configuration leaves out`);
    }
  }

  const byRule = new Map();
  for (const r of results) byRule.set(r.rule, (byRule.get(r.rule) ?? 0) + 1);
  const rules = [...byRule.entries()].sort(([a], [b]) => a.localeCompare(b));
  const lines = [
    ...stopped.map((s) => `::error::${s}`),
    `CodeQL (${proof ? 'proof run' : 'report only'}): ${results.length} alert(s) under ${rules.length} quer${rules.length === 1 ? 'y' : 'ies'}; ${extracted.size} file(s) extracted.`,
  ];
  const md = [
    `## CodeQL, ${proof ? 'the proof run (nothing uploaded)' : 'report only'}`,
    '',
    stopped.length === 0
      ? `The scan finished: ${extracted.size} files extracted, none refused. No alert fails this job.`
      : `**The scan did not finish, or did not read what it should:**\n\n${stopped.map((s) => `- ${s}`).join('\n')}`,
    '',
  ];
  if (rules.length > 0) {
    md.push('| Query | Alerts |', '|---|---|', ...rules.map(([rule, n]) => `| \`${rule}\` | ${n} |`), '');
    md.push('<details><summary>Every alert</summary>', '');
    for (const r of [...results].sort((a, b) => a.rule.localeCompare(b.rule) || a.uri.localeCompare(b.uri) || a.line - b.line)) {
      md.push(`- \`${r.rule}\` ${r.uri}:${r.line}${inFixture(r.uri) ? ' (the known-bad fixture)' : ''}`);
    }
    md.push('', '</details>', '');
  } else {
    md.push('No alert.', '');
  }
  return { code: stopped.length === 0 ? 0 : 1, lines, markdown: `${md.join('\n')}\n` };
}

function main() {
  const dir = process.env.SARIF_DIR ?? '';
  if (!dir) throw new Error('SARIF_DIR is not set');
  const proof = process.env.PROOF === 'true';
  const sarifs = readdirSync(dir).filter((f) => f.endsWith('.sarif')).map((f) => readFileSync(join(dir, f), 'utf8'));
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const out = report({ sarifs, tracked, proof });
  for (const line of out.lines) console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, out.markdown);
  return out.code;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (e) {
    // A fault here vouches for nothing: the job fails (A SCAN THAT DID NOT FINISH, above).
    console.log(`::error::codeql-report stopped: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
