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
 * after review — never fetched. On 2026-09-09 the tree carried one, esbuild
 * GHSA-67mh-4wv8-2f99, which had sat unpinned for weeks on the reasoning that
 * it was dev-only. No CI run had ever named it, so nobody had cause to revisit
 * that reasoning. The moment this reporter listed it, the bump was measured and
 * turned out to be fine — the advisory is gone from the tree. A finding nobody
 * states is a finding nobody re-examines.
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
 * advisory the audit returns is listed at every setting. The owner's rule is
 * `high` — HIGH and CRITICAL block a merge, MODERATE and LOW are named and do
 * not. The split exists so the second group stays visible without turning the
 * build red for ever, which is how a step stops being read at all. The
 * repository makes the same argument in `pnpm-workspace.yaml`: "an audit whose
 * noise is tolerated is an audit nobody reads."
 *
 * ## `dev` is context for fixing it, NOT a discount
 *
 * `findings[].dev` says WHERE an advisory reaches, and the report shows it
 * because that is what you need in order to fix it — which package pulls it in,
 * and whether the fix is a lockfile pin or a shipped-code change.
 *
 * It is deliberately NOT an input to `shouldFail`. A dev-only HIGH blocks
 * exactly like a production one. This repository is public: the dev tree is as
 * readable as the shipped tree, so "it is only dev tooling" is not a reason to
 * carry a known vulnerability. The esbuild entry in `pnpm-workspace.yaml`
 * records what happened the one time that reasoning was used here — the bump
 * that was called risky turned out to be fine the moment anyone measured it.
 *
 * A row counts as production if ANY path to it is non-dev — the safe direction,
 * since one production path is enough to make it reachable at runtime.
 *
 * ## Accepted by name, never by reach
 *
 * Once, a high had nothing to move to. On 2026-11-17 GitHub's advisory
 * database reviewed GHSA-fc5q-39xc-vjpf (CVE-2026-112366), a ReDoS in picomatch
 * through single-branch repeated extglobs such as `+(*a)`. It covers every
 * picomatch release (`<=4.0.7`), no release fixes it, and every path to it was
 * dev tooling. The gate turned every run red, `main`'s included, and with it
 * the Security Scan that Release runs on the commit it tags. There was no
 * version to pin.
 *
 * `ACCEPTED` is the one way past the line, and it is narrow on purpose. An
 * entry names one advisory on one package, the severity it was accepted at,
 * the owner's words, and a last day no more than a month after the day it was
 * accepted. It lets that row through only while all of the following stay
 * true, and the gate fails again by itself the day any one of them stops:
 *
 *   - No release fixes it. The day "fixed in" names a version, there is
 *     something to move to, and the gate asks for the move.
 *   - Every path to it is dev. A production path is a new decision.
 *   - Its severity is no higher than the one accepted.
 *   - Its last day has not passed. Another month is another decision, in new
 *     words.
 *
 * An accepted row is still listed, in the table and as an annotation, with its
 * last day: it is accepted, not hidden. And `dev` is still no discount. No
 * advisory passes because it is dev-only. The one place the gate reads `dev`
 * is where a production path ENDS an acceptance, so it can only make the gate
 * fail.
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
 * The advisories the owner accepted while no release fixes them. "Accepted by
 * name, never by reach", above, says what an entry is and when it lapses;
 * `an-advisory-nobody-listed.unit.test.ts` holds each entry to a month at most.
 *
 * GHSA-fc5q-39xc-vjpf, read on 2026-11-17: picomatch 4.0.7 under vitest, vite
 * and typescript-eslint (through tinyglobby), and 2.3.2 under the Trigger.dev
 * deploy CLI's config loader (`trigger.dev>c12>chokidar`). pnpm reads every
 * path as dev, and `pnpm why picomatch -r --prod` finds none. The one upstream
 * pull request the advisory names, picomatch's number 194, was open, and its
 * author says it leaves `+(*a)` as it was.
 */
export const ACCEPTED = [
  {
    id: 'GHSA-fc5q-39xc-vjpf',
    module: 'picomatch',
    severity: 'high',
    accepted: '2026-11-17',
    until: '2026-12-17',
    words: 'A.',
  },
];

/**
 * Whether the audit names a version that fixes the advisory. pnpm gives no fix
 * as null, which `collect` makes an empty string; npm's database writes it as
 * `<0.0.0`, a range no version is in.
 */
export function hasFix(patched) {
  const p = String(patched ?? '').trim();
  return p !== '' && p !== '<0.0.0';
}

/** Today as a UTC date, `YYYY-MM-DD`, the form `accepted` and `until` are written in. */
export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * The entry in `accepted` that names this row, and whether it still lets the
 * row through on `today`. `lapsed` says why an entry that names the row no
 * longer does, in words an annotation can print. It is empty when the entry
 * holds, or when no entry names the row.
 */
export function acceptance(row, accepted = ACCEPTED, today = utcDay()) {
  const entry = accepted.find((e) => e.id === row.id && e.module === row.module) ?? null;
  if (!entry) return { entry, holds: false, lapsed: '' };
  let lapsed = '';
  if (hasFix(row.patched)) lapsed = `a release fixes it now (${row.patched}), so take it`;
  else if (!row.dev) lapsed = 'a production path reaches it now';
  else if (rank(row.severity) > rank(entry.severity)) {
    lapsed = `it is ${row.severity} now, above the ${entry.severity} that was accepted`;
  } else if (today > entry.until) lapsed = `its last day was ${entry.until}`;
  return { entry, holds: lapsed === '', lapsed };
}

/** The entries this report has no row for: the advisory left the tree, so the entry can go. */
export function staleEntries(rows, accepted = ACCEPTED) {
  return accepted.filter((e) => !rows.some((r) => r.id === e.id && r.module === e.module));
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
        // The GHSA id, which is what ACCEPTED names. pnpm gives it as
        // github_advisory_id; the advisory's URL ends with it too.
        id: String(a?.github_advisory_id ?? String(a?.url ?? '').match(/GHSA(-[0-9a-z]{4}){3}/i)?.[0] ?? ''),
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
 *
 * A row an entry in `accepted` still holds for does not count, and only that
 * row (see "Accepted by name, never by reach", above).
 */
export function shouldFail(rows, failAt, accepted = ACCEPTED, today = utcDay()) {
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
  return rows.some((r) => rank(r.severity) >= floor && !acceptance(r, accepted, today).holds);
}

/**
 * The markdown table that lands in the job summary, and under it what
 * `accepted` says about the rows it names, held or lapsed, and about any entry
 * this report has no row for.
 */
export function renderSummary(rows, accepted = ACCEPTED, today = utcDay()) {
  const stale = staleEntries(rows, accepted).map(
    (e) => `- \`${e.id}\` on \`${e.module}\` is accepted, but this report does not list it: its entry can go.`,
  );
  const section = (notes) => (notes.length > 0 ? `\n### Accepted by name\n\n${notes.join('\n')}\n` : '');
  if (rows.length === 0) {
    return `## Advisories\n\nNone at moderate or above.\n${section(stale)}`;
  }
  const head =
    '| Severity | Package | Reaches | Installed | Fixed in | Advisory |\n' +
    '| --- | --- | --- | --- | --- | --- |\n';
  const named = [];
  const body = rows
    .map((r) => {
      const { entry, holds, lapsed } = acceptance(r, accepted, today);
      let severity = r.severity;
      if (entry) {
        severity = holds ? `${r.severity}, accepted to ${entry.until}` : `${r.severity}, **acceptance lapsed**`;
        named.push(
          `- \`${r.id}\` on \`${r.module}\`: accepted on ${entry.accepted} in the owner's words ` +
            `"${entry.words}", while no release fixes it and every path to it is dev, to ${entry.until}. ` +
            (holds ? 'It holds.' : `It no longer holds: ${lapsed}.`),
        );
      }
      const link = r.url ? `[${r.title.slice(0, 70)}](${r.url})` : r.title.slice(0, 70);
      return `| ${severity} | \`${r.module}\` | ${r.dev ? 'dev only' : '**production**'} | ${
        r.installed.join(', ') || '?'
      } | ${r.patched || '?'} | ${link} |`;
    })
    .join('\n');
  return `## Advisories\n\n${head}${body}\n${section([...named, ...stale])}`;
}

/**
 * One annotation per advisory, so the run page carries them too: `::error::`
 * at high and above, `::warning::` below it and for a row an entry in
 * `accepted` still holds for, which says so and names its last day.
 */
export function annotations(rows, accepted = ACCEPTED, today = utcDay()) {
  return rows.map((r) => {
    const { entry, holds, lapsed } = acceptance(r, accepted, today);
    const level = rank(r.severity) >= rank('high') && !holds ? 'error' : 'warning';
    const where = r.dev ? 'dev only' : 'production';
    const verdict = holds ? `, accepted to ${entry.until} while no release fixes it` : '';
    const tail = entry && !holds ? ` Its acceptance no longer holds: ${lapsed}.` : '';
    return `::${level}::${r.severity} ${r.module} (${where})${verdict}: ${r.title} — installed ${
      r.installed.join(', ') || '?'
    }, fixed in ${r.patched || '?'}. ${r.url}${tail}`;
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

  const today = utcDay();
  const rows = collect(report);
  for (const line of annotations(rows, ACCEPTED, today)) console.log(line);
  for (const e of staleEntries(rows, ACCEPTED)) {
    console.log(`::notice::${e.id} on ${e.module} is accepted in scripts/audit-advisories.mjs, but this report does not list it: its entry can go.`);
  }

  const summary = renderSummary(rows, ACCEPTED, today);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.log(summary);

  const counts = report?.metadata?.vulnerabilities ?? {};
  const tally = SEVERITY_ORDER.map((s) => `${counts[s] ?? 0} ${s}`).join(', ');
  const held = rows.filter((r) => acceptance(r, ACCEPTED, today).holds).length;
  console.log(`advisories: ${rows.length} listed (${tally}); ${held} accepted by name; failing at "${failAt}".`);

  let failing;
  try {
    failing = shouldFail(rows, failAt, ACCEPTED, today);
  } catch (err) {
    console.log(`::error::${err.message}`);
    process.exit(1);
  }
  process.exit(failing ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
