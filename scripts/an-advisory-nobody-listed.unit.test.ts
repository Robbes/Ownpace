// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * An advisory nobody listed, in a job that reported green.
 *
 * `security-scan.yml` ran the advisory gate as a single line:
 *
 *   pnpm audit --audit-level=high || echo "::warning::pnpm audit reported advisories"
 *
 * On 2026-09-09 that line was asked what it knew. It knew a great deal and
 * said almost none of it.
 *
 *  - SIX HIGH advisories were live in the tree — four `fast-uri`, two
 *    `js-yaml`, all reached through `@cyclonedx/cyclonedx-npm`. The entire
 *    report was one sentence saying advisories exist. Not the package, not the
 *    fix version, not whether the path was production or dev tooling: the
 *    three facts you need to choose between pinning it and living with it.
 *
 *  - ONE MODERATE was never fetched at all. `--audit-level=high` filters it out
 *    before anything can report it. That moderate (esbuild
 *    GHSA-67mh-4wv8-2f99) had already been reviewed and deliberately left
 *    unpinned, with the reasoning written into `pnpm-workspace.yaml` — and no
 *    CI run has ever mentioned it. A decision that is invisible in CI is
 *    indistinguishable from an oversight, and it is re-litigated from scratch
 *    by whoever next reads the audit.
 *
 * The owner's ask, verbatim: "i do want 'moderate' also signalled, so we can
 * know those kind of vulnerabilities and decide to keep or mitigate those."
 * Decide is the operative word, and it is why reporting and failing are
 * separate settings here rather than one threshold.
 *
 * ## What these tests hold, and how each one can rot
 *
 *  1. **The audit is asked at `moderate`.** The defect itself. Someone
 *     "tightening" this back to `high` restores exactly the blind spot.
 *  2. **The reporter reads JSON.** The human-readable table has no `dev` flag,
 *     so a switch to it would silently drop the production/dev distinction
 *     while still looking like it works.
 *  3. **pnpm's exit code cannot pre-empt the reporter.** Without `|| true`,
 *     `set -e` kills the step before anything is listed — the failure mode
 *     where finding MORE makes the job report LESS.
 *  4. **Reporting is not gated on severity.** Every advisory is listed at every
 *     `--fail-at`. If a future edit reports only what it fails on, the accepted
 *     moderate goes dark again.
 *  5. **Production wins over dev.** A package reached by one prod path and ten
 *     dev paths is production. The opposite default would under-report the
 *     only rows that can reach a customer.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEVERITY_ORDER, rank, collect, shouldFail, renderSummary, annotations } from './audit-advisories.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wf = readFileSync(join(here, '..', '.github', 'workflows', 'security-scan.yml'), 'utf8');

/** The gate's own step, sliced out so a match elsewhere in the file cannot stand in for it. */
const auditStep = wf.slice(
  wf.indexOf('- name: pnpm audit (advisory gate)'),
  wf.indexOf('# ---------- THE DATABASE THIS SCAN NEEDS'),
);

/** A report shaped exactly like `pnpm audit --json`, with one row per severity of interest. */
const report = {
  advisories: {
    '1': {
      severity: 'moderate',
      module_name: 'esbuild',
      title: 'dev server answers any origin',
      url: 'https://example.invalid/a',
      vulnerable_versions: '<=0.24.2',
      patched_versions: '>=0.24.3',
      findings: [{ version: '0.18.20', dev: true, paths: ['.>drizzle-kit>esbuild'] }],
    },
    '2': {
      severity: 'high',
      module_name: 'qs',
      title: 'array limit bypass',
      url: 'https://example.invalid/b',
      vulnerable_versions: '<6.16.0',
      patched_versions: '>=6.16.0',
      findings: [
        { version: '6.15.3', dev: true, paths: ['.>superagent>qs'] },
        { version: '6.15.3', dev: false, paths: ['.>express>qs'] },
      ],
    },
  },
};

describe('the advisory gate asks for moderates, and names what it finds', () => {
  it('asks the audit at moderate — the level that was filtering the finding out', () => {
    // The defect in one flag. `high` here means a moderate is never fetched,
    // so no amount of downstream reporting can mention it.
    expect(auditStep).toContain('--audit-level=moderate');
    expect(auditStep, 'the old high-only threshold is back').not.toContain('--audit-level=high');
  });

  it('reads the JSON, because the printed table carries no dev flag', () => {
    // `findings[].dev` exists only in the JSON. Reading the table would look
    // like it worked and quietly lose the production/dev split.
    expect(auditStep).toContain('--json');
    expect(auditStep).toMatch(/audit-advisories\.mjs/);
  });

  it("pnpm's own exit code cannot end the step before anything is listed", () => {
    // pnpm audit exits non-zero whenever it finds something at the level asked
    // for. Under `set -e` that kills the step, so finding MORE would report
    // LESS — the exact inversion this gate exists to prevent.
    expect(auditStep).toMatch(/pnpm audit[^\n]*\|\|\s*true/);
  });

  it('reports every advisory regardless of what it fails on', () => {
    // Reporting and failing are separate settings. At the strictest and the
    // most permissive setting alike, both rows are listed.
    const rows = collect(report);
    expect(rows).toHaveLength(2);
    expect(annotations(rows)).toHaveLength(2);
    expect(renderSummary(rows)).toContain('esbuild');
    expect(renderSummary(rows)).toContain('qs');
  });

  it('fails only at or above the floor, and never at "never"', () => {
    const rows = collect(report);
    expect(shouldFail(rows, 'never'), 'never must not block').toBe(false);
    expect(shouldFail(rows, 'critical'), 'nothing here is critical').toBe(false);
    expect(shouldFail(rows, 'high'), 'the qs row is high').toBe(true);
    expect(shouldFail(rows, 'moderate'), 'both rows are at or above moderate').toBe(true);
    // The workflow's current position, stated so a change to it is deliberate.
    expect(auditStep).toContain('--fail-at=never');
  });

  it('refuses a --fail-at it does not recognise instead of quietly not failing', () => {
    // A typo is the one way this gate can be disabled without anyone editing
    // its intent. `--fail-at=hgih` that matches no severity would still print
    // the table and still exit 0 — deliberate-looking, and doing nothing.
    const rows = collect(report);
    expect(() => shouldFail(rows, 'hgih')).toThrow(/not a severity/);
    expect(() => shouldFail(rows, 'hgih')).toThrow(/silently disable/);
    // "never" is a real setting and must stay distinct from a typo.
    expect(shouldFail(rows, 'never')).toBe(false);
    expect(shouldFail(rows, undefined)).toBe(false);
  });

  it('counts a package as production when ANY path to it is not dev', () => {
    // qs is reached by one dev path and one prod path. Calling that "dev only"
    // would under-report the single row here that can reach a customer.
    const rows = collect(report);
    const qs = rows.find((r) => r.module === 'qs');
    const esbuild = rows.find((r) => r.module === 'esbuild');
    expect(qs?.dev, 'one production path is enough to make it production').toBe(false);
    expect(esbuild?.dev, 'every path is dev').toBe(true);
    expect(renderSummary(rows)).toContain('**production**');
    expect(renderSummary(rows)).toContain('dev only');
  });

  it('puts the worst first, so a long table cannot bury a critical', () => {
    const rows = collect(report);
    expect(rows[0]?.severity).toBe('high');
    expect(rank('critical')).toBeGreaterThan(rank('high'));
    expect(rank('high')).toBeGreaterThan(rank('moderate'));
    expect(SEVERITY_ORDER).toEqual(['info', 'low', 'moderate', 'high', 'critical']);
  });

  it('annotates high and above as errors, and the rest as warnings', () => {
    const lines = annotations(collect(report));
    expect(lines.find((l) => l.includes('qs'))).toMatch(/^::error::/);
    expect(lines.find((l) => l.includes('esbuild'))).toMatch(/^::warning::/);
  });

  it('names the fix version on every row, which is what a decision needs', () => {
    const summary = renderSummary(collect(report));
    expect(summary).toContain('>=6.16.0');
    expect(summary).toContain('>=0.24.3');
  });

  it('survives a report shape it has never seen rather than taking the job down', () => {
    // A gate that throws on an unexpected payload tells you less than one that
    // reports nothing and says so plainly.
    expect(collect(undefined)).toEqual([]);
    expect(collect({})).toEqual([]);
    expect(collect({ advisories: null })).toEqual([]);
    expect(renderSummary([])).toContain('None at moderate or above');
    expect(shouldFail([], 'high')).toBe(false);
  });

  it('an unknown severity name is still reported, and sorts where it cannot hide', () => {
    const odd = collect({
      advisories: { '9': { severity: 'apocalyptic', module_name: 'x', findings: [] } },
    });
    expect(odd).toHaveLength(1);
    expect(rank('apocalyptic')).toBe(-1);
    expect(renderSummary(odd)).toContain('`x`');
  });
});
