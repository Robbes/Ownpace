#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SECRET NO ENVIRONMENT HOLDS (workplan 0163 T1, the second half of its
 * step 2; the owner's D2 of 2026-11-20).
 *
 * An outside, read-only check of 2026-11-20 found nine `secrets.*` reads in
 * jobs that name no GitHub environment (its finding 1). A secret kept for the
 * repository reaches every job of every workflow, one added on a branch
 * included; a secret kept in an environment reaches only a job that names
 * that environment. zizmor's `secrets-outside-env` audit names such a read,
 * but since zizmor 1.24.0 only under its auditor persona, so zizmor.yml's
 * audit, which blocks at the default persona, never shows it.
 *
 * So zizmor.yml runs the same zizmor a second time, with `--persona auditor`
 * and `--format json-v1`, and this reads what it wrote:
 *
 *   - Each `secrets-outside-env` finding is LISTED, in the job summary and as
 *     a warning on its line, and passes. D2 keeps it report only: zizmor's own
 *     documentation says fixing one needs care (a reusable workflow, for one,
 *     cannot read an environment's secrets unless its caller passes
 *     `secrets: inherit`).
 *   - The auditor persona's other findings are counted, not listed. They are
 *     not what this step is for (0163 §5, step 2); the audit before it holds
 *     what blocks.
 *   - A run that did not finish FAILS the step: any exit but 0 (no finding)
 *     or 11 to 14 (findings, by the highest severity among them), which
 *     zizmor gives for an error (1), arguments it cannot read (2) or no inputs
 *     (3); a report that cannot be read, or is not zizmor's JSON; and an exit
 *     that does not match the report's highest severity, a status from another
 *     run. A run that read nothing would otherwise read as "no secret outside
 *     an environment".
 *
 * `.mjs` for the reason `audit-advisories.mjs` gives: a CI step runs it on any
 * Node this project has used, with no type stripping. Its guard is
 * `a-secret-no-environment-holds.unit.test.ts`.
 *
 * Usage:  node scripts/zizmor-secrets-report.mjs --exit-code <zizmor's exit code> <report.json>
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The audit this reads, and the only one it lists. */
export const AUDIT = 'secrets-outside-env';

/** What zizmor's exit codes say (docs/usage.md, "Exit codes", at v1.32.0). */
export const EXIT_MEANINGS = Object.freeze({
  0: 'found nothing',
  1: 'stopped on an error',
  2: 'could not read its arguments',
  3: 'collected no inputs',
  11: 'found findings, the highest of them informational',
  12: 'found findings, the highest of them low',
  13: 'found findings, the highest of them medium',
  14: 'found findings, the highest of them high',
});

/** The exit zizmor gives when this is the highest severity among its findings (`FindingRegistry::exit_code`, v1.32.0). */
export const SEVERITY_EXIT = Object.freeze({ Informational: 11, Low: 12, Medium: 13, High: 14 });

/** The words for an exit code, including one zizmor does not document. */
export function meaning(code) {
  return EXIT_MEANINGS[code] ?? 'ended in a way zizmor does not document';
}

/** `zizmor <version>` from the image zizmor.yml pins, or `zizmor` when it is not that shape. */
export function versionOf(image) {
  const m = /^ghcr\.io\/zizmorcore\/zizmor:(\d+\.\d+\.\d+)@sha256:[0-9a-f]{64}$/.exec(String(image ?? ''));
  return m ? `zizmor ${m[1]}` : 'zizmor';
}

function fail(what) {
  throw new Error(`zizmor's report is not in the shape --format json-v1 writes: ${what}`);
}

/** A path as the tree names it: zizmor names an input of `.` as `./.github/…`. */
const relative = (path) => path.replace(/^(?:\.\/)+/, '');

/**
 * The report, read: `{ total, highest, secrets }`. `total` counts every
 * finding, `highest` is the highest severity among them (undefined for none),
 * and each of `secrets` is one `secrets-outside-env` finding,
 * `{ file, line, job, reads }`, at the place its primary location names.
 * Throws for a report not in zizmor's JSON shape, rather than reading less of it.
 */
export function collect(report) {
  if (!Array.isArray(report)) fail('not a list of findings');
  let highest;
  const secrets = [];
  for (const [i, finding] of report.entries()) {
    const ident = finding?.ident;
    if (typeof ident !== 'string' || ident === '') fail(`finding ${i} has no ident`);
    const severity = finding.determinations?.severity;
    if (!Object.hasOwn(SEVERITY_EXIT, severity)) fail(`finding ${i} (${ident}) has the severity ${JSON.stringify(severity)}`);
    if (highest === undefined || SEVERITY_EXIT[severity] > SEVERITY_EXIT[highest]) highest = severity;
    if (!Array.isArray(finding.locations)) fail(`finding ${i} (${ident}) has no locations`);
    if (ident !== AUDIT) continue;
    const primary = finding.locations.filter((l) => l?.symbolic?.kind === 'Primary');
    if (primary.length !== 1) fail(`the ${AUDIT} finding ${i} has ${primary.length} primary locations, not one`);
    const { symbolic, concrete } = primary[0];
    const path = symbolic.key?.Local?.verbatim_path;
    if (typeof path !== 'string' || path === '') fail(`the ${AUDIT} finding ${i} names no local file`);
    const row = concrete?.location?.start_point?.row;
    if (!Number.isInteger(row) || row < 0) fail(`the ${AUDIT} finding ${i} in ${path} has no line`);
    const route = symbolic.route?.route;
    const job = Array.isArray(route) && route[0]?.Key === 'jobs' ? route[1]?.Key : undefined;
    if (typeof job !== 'string' || job === '') fail(`the ${AUDIT} finding ${i} in ${path} names no job`);
    const reads = concrete.feature;
    if (typeof reads !== 'string' || reads.trim() === '') fail(`the ${AUDIT} finding ${i} in ${path} names nothing it reads`);
    // json-v1 counts lines from 0 (docs/usage.md); the summary and the annotation count from 1, as an editor does.
    secrets.push({ file: relative(path), line: row + 1, job, reads: reads.trim() });
  }
  return { total: report.length, highest, secrets };
}

/**
 * What the run means, from zizmor's exit code and its report:
 * `{ total, secrets, problems }`. `problems` holds each reason the run cannot
 * be trusted to have read the workflows; the step fails on any problem, and
 * never on a finding. An exit other than 0 or 11 to 14 is a problem without
 * reading the report, which may be empty or missing.
 */
export function judge(exitCode, report) {
  if (exitCode !== 0 && !Object.values(SEVERITY_EXIT).includes(exitCode)) {
    return { total: 0, secrets: [], problems: [`zizmor ${meaning(exitCode)} (exit ${exitCode}), so no workflow was read`] };
  }
  const { total, highest, secrets } = collect(report);
  const problems = [];
  const expected = highest === undefined ? 0 : SEVERITY_EXIT[highest];
  if (exitCode !== expected) {
    const listed = highest === undefined ? 'lists no finding' : `lists ${total}, the highest of them ${highest.toLowerCase()}`;
    problems.push(`zizmor exited ${exitCode} (${meaning(exitCode)}) and its report ${listed}, which is exit ${expected}: the status does not belong to the report`);
  }
  return { total, secrets, problems };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A table cell: one line, its bars escaped, nothing a renderer reads as HTML or as code. */
const cell = (text) =>
  String(text).replace(/\s*\n\s*/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, "'").replace(/\|/g, '\\|');

/** A workflow command's message, and one of its properties, escaped as GitHub reads them. */
const commandData = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const commandProperty = (text) => commandData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** The job summary: what this audit is, how many it found, and one row per secret read outside an environment. */
export function renderSummary({ version, total, secrets }) {
  const lines = [
    `### ${version}, secrets read outside a GitHub environment (report only)`,
    '',
    `zizmor's \`${AUDIT}\` audit, under its auditor persona, names each \`secrets.*\` read in a job that names no GitHub environment. ` +
      'Such a secret is one kept for the repository, which every job of every workflow can read, one added on a branch included. ' +
      'Report only (workplan 0163 D2): each is listed here and as a warning, and passes.',
    '',
    `${plural(secrets.length, 'secret')} read outside an environment, of ${plural(total, 'finding')} under the auditor persona; the others are not listed here.`,
    '',
  ];
  if (secrets.length === 0) return `${lines.join('\n')}\n`;
  lines.push('| Where | Job | Reads |', '| --- | --- | --- |');
  for (const s of secrets) lines.push(`| \`${cell(s.file)}:${s.line}\` | \`${cell(s.job)}\` | \`${cell(s.reads)}\` |`);
  lines.push(
    '',
    'To keep one for its job: add the secret to a GitHub environment (Settings → Environments), name that environment in the job ' +
      '(`environment:`), and delete the repository secret.',
  );
  return `${lines.join('\n')}\n`;
}

/** One warning per secret read outside an environment, on its line. */
export function annotations(secrets) {
  return secrets.map(
    (s) =>
      `::warning file=${commandProperty(s.file)},line=${s.line},title=${commandProperty(`zizmor ${AUDIT}`)}::` +
      commandData(
        `Job ${s.job} reads ${s.reads} and names no GitHub environment, so the secret is one kept for the repository, which every job of ` +
          'every workflow can read. Keep it in an environment that only this job names (listed, not blocking: workplan 0163 D2).',
      ),
  );
}

function main(argv) {
  const at = argv.indexOf('--exit-code');
  const raw = at >= 0 ? argv[at + 1] : undefined;
  const file = argv.find((a, i) => !a.startsWith('--') && i !== at + 1);
  if (raw === undefined || !/^\d+$/.test(raw) || file === undefined) {
    console.log('::error::usage: node scripts/zizmor-secrets-report.mjs --exit-code <zizmor exit code> <report.json>');
    return 1;
  }
  const code = Number(raw);
  let report;
  if (code === 0 || Object.values(SEVERITY_EXIT).includes(code)) {
    try {
      report = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      // A report that cannot read its own input says so and fails, as audit-advisories.mjs does.
      console.log(`::error::zizmor's report could not be read: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }
  let result;
  try {
    result = judge(code, report);
  } catch (err) {
    console.log(`::error::${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  for (const line of annotations(result.secrets)) console.log(line);
  const summary = renderSummary({ version: versionOf(process.env.ZIZMOR_IMAGE), ...result });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.log(summary);
  for (const problem of result.problems) console.log(`::error::${problem}`);
  console.log(
    `zizmor, auditor persona: ${plural(result.total, 'finding')}, ${result.secrets.length} of them ${AUDIT}; ` +
      `${result.problems.length} problem(s) with the run.`,
  );
  return result.problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
