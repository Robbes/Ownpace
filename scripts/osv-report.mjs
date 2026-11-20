#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MALICIOUS PACKAGE NOTHING HERE WOULD HAVE NAMED (workplan 0163 T2; the
 * owner's D1 of 2026-11-20).
 *
 * `pnpm audit`, read by `audit-advisories.mjs`, names vulnerabilities in the
 * packages people meant to install. It does not read OSV's malicious-package
 * records, `MAL-…`, which the OpenSSF malicious-packages project publishes for
 * packages put on a registry to do harm: a typosquat, or a release pushed with
 * a stolen token. Until 2026-11-20 nothing in CI read those. An outside,
 * read-only check of the repository read them after the merge, with
 * osv-scanner, and found none on `main`.
 *
 * So the Security Scan's repository job runs osv-scanner over `pnpm-lock.yaml`
 * on every pull request, push to main, tag and Monday, and this reads its JSON:
 *
 *   - A package an OSV `MAL-` record names, by its id or by an alias, FAILS the
 *     job, with the package and the record named.
 *   - Every other advisory is LISTED, in the job summary and as a warning, and
 *     passes. `pnpm audit` stays the vulnerability gate with the owner's
 *     `--fail-at=high`, so the two never disagree about what blocks a merge.
 *   - A scan that did not finish FAILS the job: any exit code but 0 (nothing
 *     found) or 1 (advisories found), which osv-scanner gives for an error
 *     (127), no package source (128), the OSV API failing (129) or a config it
 *     cannot read (130); a report that cannot be read, or is not osv-scanner's
 *     shape; findings that disagree with the exit code; no result for the
 *     lockfile; or fewer than MIN_PACKAGES packages read from it. A malware
 *     check that read nothing is not a pass.
 *
 * `.mjs` for the reason `audit-advisories.mjs` gives: a CI step runs it on any
 * Node this project has used, with no type stripping. Its guard is
 * `a-malicious-package-nothing-read.unit.test.ts`.
 *
 * Usage:  node scripts/osv-report.mjs --exit-code <osv-scanner's exit code> <report.json>
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The one lockfile in the tree, and the only source this reads. */
export const LOCKFILE = 'pnpm-lock.yaml';

/**
 * Fewer packages than this read from the lockfile is a scan that did not read
 * it. The tree's lockfile held 934 on 2026-11-20 (osv-scanner's own count).
 */
export const MIN_PACKAGES = 100;

/** What osv-scanner's exit codes say (`cmd/osv-scanner/internal/cmd/run.go`, v2.7.1). */
export const EXIT_MEANINGS = Object.freeze({
  0: 'found no advisory',
  1: 'found advisories',
  127: 'stopped on an error',
  128: 'found no package source to read',
  129: 'could not reach the OSV API',
  130: 'was given a config it could not read',
});

/** The words for an exit code, including one osv-scanner does not document. */
export function meaning(code) {
  return EXIT_MEANINGS[code] ?? 'ended in a way osv-scanner does not document';
}

/** A record OSV keeps for a malicious package: its id, or one of its aliases, starts with `MAL-`. */
export function isMalicious(vulnerability) {
  return [vulnerability.id, ...(vulnerability.aliases ?? [])].some((id) => typeof id === 'string' && id.startsWith('MAL-'));
}

function fail(what) {
  throw new Error(`osv-scanner's report is not in the shape it writes: ${what}`);
}

/**
 * The report, read: `{ packagesRead, findings }`, where `packagesRead` counts
 * the packages of the result for LOCKFILE (or is undefined when there is none),
 * and each finding is one advisory on one package of any result. Throws for a
 * report not in osv-scanner's JSON shape, rather than reading less of it.
 */
export function collect(report) {
  if (report === null || typeof report !== 'object' || !Array.isArray(report.results)) fail('no `results` list');
  let packagesRead;
  const findings = [];
  for (const [r, result] of report.results.entries()) {
    const path = result?.source?.path;
    if (typeof path !== 'string' || path === '') fail(`result ${r} names no source path`);
    if (!Array.isArray(result.packages)) fail(`result ${r} (${path}) has no \`packages\` list`);
    if (path === LOCKFILE || path.endsWith(`/${LOCKFILE}`)) packagesRead = (packagesRead ?? 0) + result.packages.length;
    for (const [p, entry] of result.packages.entries()) {
      const pkg = entry?.package;
      if (typeof pkg?.name !== 'string' || typeof pkg?.version !== 'string') fail(`package ${p} of ${path} has no name and version`);
      const vulnerabilities = entry.vulnerabilities ?? [];
      if (!Array.isArray(vulnerabilities)) fail(`${pkg.name}@${pkg.version} in ${path} has a \`vulnerabilities\` that is not a list`);
      for (const v of vulnerabilities) {
        if (typeof v?.id !== 'string' || v.id === '') fail(`an advisory on ${pkg.name}@${pkg.version} has no id`);
        if (v.aliases !== undefined && !Array.isArray(v.aliases)) fail(`${v.id}'s aliases are not a list`);
        findings.push({
          name: pkg.name,
          version: pkg.version,
          id: v.id,
          aliases: (v.aliases ?? []).filter((a) => typeof a === 'string'),
          summary: typeof v.summary === 'string' ? v.summary : '',
          malicious: isMalicious(v),
          source: path,
        });
      }
    }
  }
  return { packagesRead, findings };
}

/**
 * What the run means, from osv-scanner's exit code and its report:
 * `{ packagesRead, findings, malicious, problems }`. `problems` holds each
 * reason the scan cannot be trusted to have read the lockfile; the job fails
 * on any problem and on any malicious finding. An exit code other than 0 or 1
 * is a problem without reading the report, which may not exist.
 */
export function judge(exitCode, report) {
  if (exitCode !== 0 && exitCode !== 1) {
    return { packagesRead: undefined, findings: [], malicious: [], problems: [`osv-scanner ${meaning(exitCode)} (exit ${exitCode}), so nothing was checked`] };
  }
  const { packagesRead, findings } = collect(report);
  const problems = [];
  if (packagesRead === undefined) problems.push(`the report holds no result for ${LOCKFILE}, so the lockfile was not read`);
  else if (packagesRead < MIN_PACKAGES) problems.push(`osv-scanner read ${packagesRead} package(s) from ${LOCKFILE}, fewer than ${MIN_PACKAGES}: that is not this lockfile read whole`);
  if (exitCode === 0 && findings.length > 0) problems.push(`osv-scanner exited 0 (${meaning(0)}) and its report lists ${findings.length} advisories: the status does not belong to the report`);
  if (exitCode === 1 && findings.length === 0) problems.push(`osv-scanner exited 1 (${meaning(1)}) and its report lists none: the status does not belong to the report`);
  return { packagesRead, findings, malicious: findings.filter((f) => f.malicious), problems };
}

const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The job summary: what was read, and one row per advisory, malicious ones first. */
export function renderSummary({ packagesRead, findings, malicious }) {
  const lines = [
    '### osv-scanner over pnpm-lock.yaml',
    '',
    `${packagesRead ?? 0} packages read; ${findings.length} advisories, ${malicious.length} of them malicious-package records.`,
    'A malicious package fails the job. Every other advisory is listed here and passes: `pnpm audit` is the vulnerability gate.',
    '',
  ];
  if (findings.length === 0) return `${lines.join('\n')}\n`;
  lines.push('| | Package | Version | Advisory | Aliases | Summary |', '|---|---|---|---|---|---|');
  const sorted = [...findings].sort((a, b) => Number(b.malicious) - Number(a.malicious) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const f of sorted) {
    lines.push(`| ${f.malicious ? '**malicious**' : 'reported'} | ${cell(f.name)} | ${cell(f.version)} | ${cell(f.id)} | ${cell(f.aliases.join(', '))} | ${cell(f.summary)} |`);
  }
  return `${lines.join('\n')}\n`;
}

/** One annotation per advisory: `::error::` for a malicious package, `::warning::` for the rest. */
export function annotations(findings) {
  return findings.map((f) =>
    f.malicious
      ? `::error::${f.name}@${f.version} is a malicious package by OSV's ${f.id}. Take it out of ${LOCKFILE}, and find what brought it in.`
      : `::warning::${f.id} on ${f.name}@${f.version}${f.summary ? `: ${f.summary}` : ''} (listed, not blocking: pnpm audit is the vulnerability gate)`,
  );
}

function main(argv) {
  const at = argv.indexOf('--exit-code');
  const raw = at >= 0 ? argv[at + 1] : undefined;
  const file = argv.find((a, i) => !a.startsWith('--') && i !== at + 1);
  if (raw === undefined || !/^\d+$/.test(raw) || file === undefined) {
    console.log('::error::usage: node scripts/osv-report.mjs --exit-code <osv-scanner exit code> <report.json>');
    return 1;
  }
  const code = Number(raw);
  let report;
  if (code === 0 || code === 1) {
    try {
      report = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      // A gate that cannot read its own input says so and fails, as audit-advisories.mjs does.
      console.log(`::error::osv-scanner's report could not be read: ${err instanceof Error ? err.message : String(err)}`);
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
  for (const line of annotations(result.findings)) console.log(line);
  const summary = renderSummary(result);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.log(summary);
  for (const problem of result.problems) console.log(`::error::${problem}`);
  console.log(
    `osv-scanner: ${result.packagesRead ?? 0} packages read from ${LOCKFILE}; ${result.findings.length} advisories, ${result.malicious.length} malicious; ` +
      `${result.problems.length} problem(s) with the scan.`,
  );
  return result.problems.length > 0 || result.malicious.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
