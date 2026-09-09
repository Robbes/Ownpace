#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ADVISORY NOBODY LISTED — the moderates the gate knew about and never said.
 *
 * `security-scan.yml` ran the advisory gate as one line:
 *
 *   pnpm audit --audit-level=high || echo "::warning::pnpm audit reported advisories"
 *
 * Two things follow from `--audit-level=high`, and only the first is obvious.
 *
 * The obvious one: MODERATE ADVISORIES ARE NEVER MENTIONED. Not suppressed
 * after review — never fetched. On 2026-09-09 the tree carried one (esbuild
 * GHSA-67mh-4wv8-2f99, dev-only) that had been deliberately left unpinned in
 * `pnpm-workspace.yaml`, with the reasoning written out there. That decision
 * was invisible to anyone reading CI: the run said nothing, which reads
 * exactly like "there is nothing".
 *
 * The less obvious one: WHAT IT DID FIND, IT PRINTED AS A SENTENCE. Six HIGH
 * advisories were live that same morning and the whole report was one warning
 * line saying advisories exist. Nothing named the package, the fix version, or
 * whether the path was production or dev tooling — the three facts you need to
 * decide between pinning it and living with it.
 *
 * So the gate now reads the audit's JSON and renders it: one row per advisory,
 * with the severity, the versions installed, the version that fixes it, and
 * whether every path to it is dev-only. Into the job summary, where it is a
 * table rather than scrollback, and as annotations so it also lands on the
 * run's own page.
 *
 * ## Reporting and failing are separate, on purpose
 *
 * `--fail-at` decides the exit code and NOTHING decides what is reported: every
 * advisory the audit returns is listed at every setting. That split is the
 * point. A moderate the owner has read and accepted must stay visible without
 * turning the build red for ever — the alternative is a step that is red on
 * every run, which is a step people stop reading. The repository already made
 * that argument in `pnpm-workspace.yaml`: "an audit whose noise is tolerated is
 * an audit nobody reads."
 *
 * ## Why `dev` is on every row
 *
 * `findings[].dev` is the fact that decides most of these. A HIGH advisory in
 * the SBOM generator and a MODERATE one in `express` are not the same problem,
 * and severity alone does not separate them. A row counts as production if ANY
 * path to it is non-dev — the safe direction, since one production path is
 * enough to make it reachable at runtime.
 */

import { readFileSync } from 'node:fs';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Least to most severe. npm/pnpm use these five names and no others. */
export const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];

/**
 * Position in SEVERITY_ORDER, or -1 for anything unrecognised.
 *
 * -1 rather than a throw: a severity name this list has not seen is a reason to
 * report the row anyway, not to lose the whole report. It sorts to the top so
 * it cannot hide at the bottom of a long table.
 */
export function rank(severity) {
  return SEVERITY_ORDER.indexOf(String(severity ?? '').toLowerCase());
}

/**
 * Turn `pnpm audit --json` into one row per advisory, worst first.
 *
 * Accepts the parsed object. Anything missing degrades to an empty list rather
 * than throwing — a gate that crashes on an unexpected shape tells you less
 * than one that reports nothing and says so.
 */
export function collect(report) {
  const advisories = report?.advisories;
  if (!advisories || typeof advisories !== 'object') return [];
  return Object.values(advisories)
    .map((a) => {
      const findings = Array.isArray(a?.findings) ? a.findings : [];
      return {
        severity: String(a?.severity ?? 'unknown').toLowerCase(),
        module: a?.module_name ?? '(unnamed)',
        title: a?.title ?? '',
        url: a?.url ?? '',
        vulnerable: a?.vulnerable_versions ?? '',
        patched: a?.patched_versions ?? '',
        installed: [...new Set(findings.map((f) => f?.version).filter(Boolean))],
        // Production if ANY path is non-dev. One reachable path is enough.
        dev: findings.length > 0 && findings.every((f) => f?.dev === true),
        paths: findings.flatMap((f) => (Array.isArray(f?.paths) ? f.paths : [])),
      };
    })
    .sort((x, y) => rank(y.severity) - rank(x.severity) || x.module.localeCompare(y.module));
}

/**
 * Exit 1 only when something at or above `failAt` is present.
 *
 * `never` is a real setting, not a disabled one: it means "report, do not
 * block", which is the position the owner takes on an accepted moderate.
 */
export function shouldFail(rows, failAt) {
  const wanted = String(failAt ?? 'never').toLowerCase();
  if (wanted === 'never') return false;
  const floor = rank(wanted);
  if (floor < 0) {
    // A NAME THIS LIST DOES NOT KNOW IS A TYPO, AND A TYPO HERE IS SILENT.
    // `--fail-at=hgih` that quietly matches nothing turns a hard gate into a
    // no-op that still prints a table and still exits 0 — the same shape as
    // the SBOM step 0025 T3 fixed and the Trivy step #887 fixed. So it refuses
    // instead of guessing, and the refusal names the settings that exist.
    throw new Error(
      `--fail-at="${failAt}" is not a severity. Use one of ${SEVERITY_ORDER.join(', ')}, or "never" ` +
        'to report without blocking. Refusing to guess: a typo here would silently disable this gate.',
    );
  }
  return rows.some((r) => rank(r.severity) >= floor);
}

/** The markdown table that lands in the job summary. */
export function renderSummary(rows) {
  if (rows.length === 0) {
    return '## Advisories\n\nNone at moderate or above.\n';
  }
  const head =
    '| Severity | Package | Reaches | Installed | Fixed in | Advisory |\n' +
    '| --- | --- | --- | --- | --- | --- |\n';
  const body = rows
    .map((r) => {
      const link = r.url ? `[${r.title.slice(0, 70)}](${r.url})` : r.title.slice(0, 70);
      return `| ${r.severity} | \`${r.module}\` | ${r.dev ? 'dev only' : '**production**'} | ${
        r.installed.join(', ') || '?'
      } | ${r.patched || '?'} | ${link} |`;
    })
    .join('\n');
  return `## Advisories\n\n${head}${body}\n`;
}

/** One annotation per advisory, so the run page carries them too. */
export function annotations(rows) {
  return rows.map((r) => {
    const level = rank(r.severity) >= rank('high') ? 'error' : 'warning';
    const where = r.dev ? 'dev only' : 'production';
    return `::${level}::${r.severity} ${r.module} (${where}): ${r.title} — installed ${
      r.installed.join(', ') || '?'
    }, fixed in ${r.patched || '?'}. ${r.url}`;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const failAt = (args.find((a) => a.startsWith('--fail-at='))?.split('=')[1] ?? 'never').toLowerCase();
  const file = args.find((a) => !a.startsWith('--'));

  let report;
  try {
    report = JSON.parse(file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8'));
  } catch (err) {
    // A gate that cannot read its own input must say so and fail; staying green
    // here is the exact shape 0025 T3 and #887 were both about.
    console.log(`::error::the advisory report could not be parsed: ${err.message}`);
    process.exit(1);
  }

  const rows = collect(report);
  for (const line of annotations(rows)) console.log(line);

  const summary = renderSummary(rows);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.log(summary);

  const counts = report?.metadata?.vulnerabilities ?? {};
  const tally = SEVERITY_ORDER.map((s) => `${counts[s] ?? 0} ${s}`).join(', ');
  console.log(`advisories: ${rows.length} listed (${tally}); failing at "${failAt}".`);

  let failing;
  try {
    failing = shouldFail(rows, failAt);
  } catch (err) {
    console.log(`::error::${err.message}`);
    process.exit(1);
  }
  process.exit(failing ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
