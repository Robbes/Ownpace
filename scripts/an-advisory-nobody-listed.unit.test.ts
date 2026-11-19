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
 *    before anything can report it. That moderate — esbuild
 *    GHSA-67mh-4wv8-2f99 — had sat unpinned for weeks on a note in
 *    `pnpm-workspace.yaml` reasoning that it was dev-only and the bump looked
 *    risky. No CI run had ever named it, so nothing prompted anyone to check
 *    whether that was still true. It was listed for the first time, the bump
 *    was then actually measured, and it was fine: the advisory is now gone
 *    from the tree entirely. A finding nobody states is a finding nobody
 *    re-examines.
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
 *  6. **`dev` never lets anything through.** It is reported, never subtracted.
 *     The owner's rule, verbatim: "i want vulnerabilities out of the product,
 *     we are open source, all is in the open, i dont want vulnerabilities,
 *     also not in dev." A dev-only high blocks exactly like a production one,
 *     and the test below fails if anyone ever makes `shouldFail` skip a row
 *     for being dev-only.
 *  7. **An advisory no release fixes passes only by name, for a month at
 *     most.** An entry in `ACCEPTED` names the advisory, its package, the
 *     severity, the owner's words and a last day. The row stays listed, and
 *     the gate fails again the day a fix is published, a production path
 *     appears, the severity rises, or the last day passes. Each of those has
 *     a test below, and so does the month.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEVERITY_ORDER,
  ACCEPTED,
  rank,
  collect,
  shouldFail,
  renderSummary,
  annotations,
  staleEntries,
  utcDay,
} from './audit-advisories.mjs';

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
    // The owner's rule, pinned: high and critical block, moderate and low do not.
    expect(auditStep).toContain('--fail-at=high');
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

  it('gates on severity, never on reach — a dev-only high still blocks', () => {
    // The rule this encodes: dev tooling gets no discount. If someone later
    // makes shouldFail() skip dev rows "because they do not ship", this fails.
    const devOnlyHigh = collect({
      advisories: {
        '1': {
          severity: 'high',
          module_name: 'only-in-dev',
          findings: [{ version: '1.0.0', dev: true, paths: ['.>eslint>only-in-dev'] }],
        },
      },
    });
    expect(devOnlyHigh[0]?.dev, 'the row is dev-only').toBe(true);
    expect(shouldFail(devOnlyHigh, 'high'), 'and it must block anyway').toBe(true);
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

describe('an advisory no release fixes passes by name, for a month at most', () => {
  /**
   * GHSA-fc5q-39xc-vjpf as `pnpm audit --json` gave it on 2026-11-17, one path
   * per installed version. `over` replaces fields, and `findings` the paths.
   */
  const picomatch = (over: Record<string, unknown> = {}, findings?: unknown[]) =>
    collect({
      advisories: {
        '1': {
          github_advisory_id: 'GHSA-fc5q-39xc-vjpf',
          severity: 'high',
          module_name: 'picomatch',
          title: 'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
          url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
          vulnerable_versions: '<=4.0.7',
          patched_versions: null,
          findings: findings ?? [
            { version: '4.0.7', dev: true, paths: ['.>vitest>picomatch'] },
            { version: '2.3.2', dev: true, paths: ['apps__worker>trigger.dev>c12>chokidar>anymatch>picomatch'] },
          ],
          ...over,
        },
      },
    });

  /** An entry of the shape ACCEPTED holds, so these tests outlive any real one. */
  const granted = [
    {
      id: 'GHSA-fc5q-39xc-vjpf',
      module: 'picomatch',
      severity: 'high',
      accepted: '2026-11-17',
      until: '2026-12-17',
      words: 'the words that accepted it',
    },
  ];
  const inside = '2026-11-30';

  it('lets the named advisory through while no release fixes it, and still lists it', () => {
    const rows = picomatch();
    expect(rows[0]?.id).toBe('GHSA-fc5q-39xc-vjpf');
    expect(shouldFail(rows, 'high', granted, inside), 'accepted, inside its month').toBe(false);
    expect(shouldFail(rows, 'high', granted, '2026-12-17'), 'its last day still counts').toBe(false);
    expect(annotations(rows, granted, inside)[0]).toMatch(
      /^::warning::high picomatch \(dev only\), accepted to 2026-12-17 while no release fixes it: /,
    );
    const summary = renderSummary(rows, granted, inside);
    expect(summary, 'the row stays in the table').toContain('| high, accepted to 2026-12-17 | `picomatch` |');
    expect(summary).toContain('### Accepted by name');
    expect(summary).toContain('"the words that accepted it"');
    expect(summary).toContain('It holds.');
  });

  it('fails again the day a release fixes it, and says to take it', () => {
    const rows = picomatch({ patched_versions: '>=4.0.8' });
    expect(shouldFail(rows, 'high', granted, inside)).toBe(true);
    expect(annotations(rows, granted, inside)[0]).toMatch(
      /^::error::high picomatch \(dev only\): .* Its acceptance no longer holds: a release fixes it now \(>=4\.0\.8\), so take it\.$/,
    );
    expect(renderSummary(rows, granted, inside)).toContain('**acceptance lapsed**');
    // npm's database writes "no release fixes it" as a range no version is in.
    expect(shouldFail(picomatch({ patched_versions: '<0.0.0' }), 'high', granted, inside)).toBe(false);
  });

  it('fails again when a production path reaches it', () => {
    const rows = picomatch({}, [
      { version: '4.0.7', dev: true, paths: ['.>vitest>picomatch'] },
      { version: '4.0.7', dev: false, paths: ['apps__api>a-runtime-dependency>picomatch'] },
    ]);
    expect(rows[0]?.dev, 'one production path makes it production').toBe(false);
    expect(shouldFail(rows, 'high', granted, inside)).toBe(true);
    expect(annotations(rows, granted, inside)[0]).toContain('a production path reaches it now');
  });

  it('fails again the day after its last day', () => {
    expect(shouldFail(picomatch(), 'high', granted, '2026-12-18')).toBe(true);
    expect(annotations(picomatch(), granted, '2026-12-18')[0]).toContain('its last day was 2026-12-17');
  });

  it('fails again if the advisory is raised above the severity accepted', () => {
    const rows = picomatch({ severity: 'critical' });
    expect(shouldFail(rows, 'high', granted, inside)).toBe(true);
    expect(annotations(rows, granted, inside)[0]).toContain('it is critical now, above the high that was accepted');
  });

  it('accepts by name only: another advisory on that package, or that advisory on another, still blocks', () => {
    expect(shouldFail(picomatch({ github_advisory_id: 'GHSA-aaaa-bbbb-cccc' }), 'high', granted, inside)).toBe(true);
    expect(shouldFail(picomatch({ module_name: 'micromatch' }), 'high', granted, inside)).toBe(true);
  });

  it('reads the id from the advisory URL when the report gives no github_advisory_id', () => {
    expect(picomatch({ github_advisory_id: undefined })[0]?.id).toBe('GHSA-fc5q-39xc-vjpf');
    expect(picomatch({ github_advisory_id: undefined, url: '' })[0]?.id).toBe('');
  });

  it('names an entry the report no longer lists, so it leaves the list once its advisory has', () => {
    expect(staleEntries([], granted)).toEqual(granted);
    expect(staleEntries(picomatch(), granted)).toEqual([]);
    expect(renderSummary([], granted, inside)).toContain('is accepted, but this report does not list it: its entry can go.');
  });

  it('counts days in UTC, the way accepted and until are written', () => {
    expect(utcDay(new Date('2026-11-17T23:59:59Z'))).toBe('2026-11-17');
    expect(utcDay(new Date('2026-11-18T00:00:00Z'))).toBe('2026-11-18');
  });

  it("holds every entry in ACCEPTED to one advisory, the owner's words and a month at most", () => {
    const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
    for (const e of ACCEPTED) {
      expect(e.id, 'a GHSA id, which is what the report carries').toMatch(/^GHSA(-[0-9a-z]{4}){3}$/);
      expect(e.module, `${e.id}: the one package`).not.toBe('');
      expect(rank(e.severity), `${e.id}: a severity npm names`).toBeGreaterThanOrEqual(0);
      expect(e.accepted, `${e.id}: accepted`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.until, `${e.id}: until`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.words.trim(), `${e.id}: the owner's words`).not.toBe('');
      const span = day(e.until) - day(e.accepted);
      expect(span, `${e.id}: a last day after the day it was accepted`).toBeGreaterThan(0);
      expect(span, `${e.id}: a month at most; another month is another decision`).toBeLessThanOrEqual(31);
    }
  });

  it('the gate reads ACCEPTED when it is given no list', () => {
    // With no list given, the gate decides as it does with ACCEPTED, whatever
    // ACCEPTED holds that day. It holds nothing since 2026-11-18, when GitHub
    // withdrew GHSA-fc5q-39xc-vjpf, so a row no entry names blocks at high, as
    // it does with an empty list.
    const rows = picomatch();
    for (const today of [inside, '2026-12-18']) {
      expect(shouldFail(rows, 'high', undefined, today), today).toBe(shouldFail(rows, 'high', ACCEPTED, today));
    }
    expect(shouldFail(rows, 'high', [], inside)).toBe(true);
    expect(shouldFail(rows, 'high', granted, inside)).toBe(false);
  });
});
