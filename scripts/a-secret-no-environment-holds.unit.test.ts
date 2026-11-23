// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SECRET NO ENVIRONMENT HOLDS (workplan 0163 T1, the second half of its
 * step 2; the owner's D2 of 2026-11-20).
 *
 * An outside, read-only check of 2026-11-20 found nine `secrets.*` reads in
 * jobs that name no GitHub environment (its finding 1), and nothing here would
 * have said so before a merge. zizmor.yml's audit runs at zizmor's default
 * persona, and zizmor has shown `secrets-outside-env` only under its auditor
 * persona since 1.24.0. A secret kept for the repository reaches every job of
 * every workflow, one added on a branch included; a secret kept in an
 * environment reaches only a job that names it.
 *
 * So zizmor.yml runs the same zizmor once more with `--persona auditor`, and
 * `scripts/zizmor-secrets-report.mjs` reads the JSON it writes.
 *
 * ## What this holds, and how each part could rot
 *
 *  1. **Each secret read outside an environment is listed, and passes.** D2
 *     keeps the audit report only. It is named by its file, line, job and what
 *     it reads, where the finding's primary location puts it, its line counted
 *     from 1 (`--format json-v1` counts from 0).
 *  2. **Nothing else is listed.** The auditor persona's other findings are
 *     counted, not listed; listing them would bury the one this step is for,
 *     and the audit before it holds what blocks.
 *  3. **A run that did not finish fails.** An exit other than 0 or 11 to 14, a
 *     report that cannot be read or is not zizmor's shape, and an exit that
 *     does not match the report's highest severity. Each of those would
 *     otherwise read as "no secret outside an environment".
 *  4. **zizmor.yml runs it as decided.** After the audit, and after a red one
 *     too; the same image, offline, with no network, with the one config and
 *     no ignore comment counted, as the audit runs; `--persona auditor` and
 *     `--format json-v1`, zizmor's own exit code and that JSON handed to the
 *     report; and never zizmor's status as the step's own, which would block.
 *
 * a-workflow-zizmor-would-flag holds the audit to taking no persona, and tells
 * this step from it by its name.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { AUDIT, EXIT_MEANINGS, SEVERITY_EXIT, annotations, collect, judge, meaning, renderSummary, versionOf } from './zizmor-secrets-report.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTER = join(REPO, 'scripts', 'zizmor-secrets-report.mjs');
const WORKFLOW = '.github/workflows/zizmor.yml';
const JOB = 'zizmor';

/** The report step's name, which a-workflow-zizmor-would-flag tells it from the audit by. */
const REPORT_STEP = 'Report each secret read outside a GitHub environment (secrets-outside-env, report only)';

/** Where the report step has zizmor write its JSON, and the reporter reads it. */
const JSON_OUT = '"$RUNNER_TEMP/zizmor-auditor.json"';

type Kind = 'Primary' | 'Related' | 'Hidden';

/** A location as `--format json-v1` writes one: zizmor's symbolic route and the concrete span, its row counted from 0. */
const location = (kind: Kind, job: string, row: number, feature: string, path = './.github/workflows/exposure-probe.yml') => ({
  symbolic: {
    key: { Local: { verbatim_path: path } },
    annotation: kind === 'Primary' ? 'secret is accessed outside of a dedicated environment' : 'this job',
    route: { route: [{ Key: 'jobs' }, { Key: job }] },
    feature_kind: kind === 'Related' ? 'KeyOnly' : 'Normal',
    kind,
  },
  concrete: {
    location: { start_point: { row, column: 14 }, end_point: { row, column: 14 + feature.length }, offset_span: { start: 4100, end: 4100 + feature.length } },
    feature,
    comments: [],
  },
});

/**
 * A `secrets-outside-env` finding, located as the audit locates one
 * (`audit/secrets_outside_env.rs` at v1.32.0, the same file at v1.33.1): the
 * whole job hidden, its key, and the secret's context as the one primary
 * location.
 */
const secret = (job: string, row: number, reads: string, path?: string) => ({
  ident: AUDIT,
  desc: 'secrets referenced without a dedicated environment',
  url: 'https://docs.zizmor.sh/audits/#secrets-outside-env',
  determinations: { confidence: 'High', severity: 'Medium', persona: 'Auditor' },
  locations: [location('Hidden', job, 90, `${job}:\n    runs-on: ubuntu-24.04\n`, path), location('Related', job, 90, `${job}:`, path), location('Primary', job, row, reads, path)],
  ignored: false,
  fixes: [],
});

/** Another audit's finding, at this severity. */
const other = (ident: string, severity: string) => ({
  ident,
  desc: 'another audit',
  url: `https://docs.zizmor.sh/audits/#${ident}`,
  determinations: { confidence: 'Low', severity, persona: 'Auditor' },
  locations: [location('Primary', 'build', 12, 'uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', './.github/workflows/ci.yml')],
  ignored: false,
  fixes: [],
});

const PROBE = secret('probe', 119, 'secrets.EXPOSURE_PROBE_HOST');

describe('what the report reads', () => {
  it('names a secret read outside an environment by its file, line from 1, job and what it reads', () => {
    expect(collect([PROBE])).toEqual({
      total: 1,
      highest: 'Medium',
      secrets: [{ file: '.github/workflows/exposure-probe.yml', line: 120, job: 'probe', reads: 'secrets.EXPOSURE_PROBE_HOST' }],
    });
  });

  it("counts the auditor persona's other findings, lists none of them, and keeps the highest severity", () => {
    const read = collect([other('unpinned-images', 'High'), PROBE, other('excessive-permissions', 'Low')]);
    expect(read.total).toBe(3);
    expect(read.highest).toBe('High');
    expect(read.secrets.map((s) => s.job)).toEqual(['probe']);
    expect(collect([])).toEqual({ total: 0, highest: undefined, secrets: [] });
  });

  it('refuses a report that is not in the shape --format json-v1 writes, rather than reading less of it', () => {
    const shape = /not in the shape --format json-v1 writes/;
    const without = (mutate: (f: ReturnType<typeof secret>) => void) => {
      const f = structuredClone(PROBE);
      mutate(f);
      return () => collect([f]);
    };
    expect(() => collect({ findings: [] })).toThrow(/not a list of findings/);
    expect(() => collect(null)).toThrow(shape);
    expect(without((f) => Object.assign(f, { ident: '' }))).toThrow(/finding 0 has no ident/);
    expect(without((f) => Object.assign(f.determinations, { severity: 'Unknown' }))).toThrow(/has the severity "Unknown"/);
    expect(without((f) => Object.assign(f, { locations: undefined }))).toThrow(/has no locations/);
    expect(without((f) => f.locations.pop())).toThrow(/has 0 primary locations, not one/);
    expect(without((f) => f.locations.push(structuredClone(f.locations[2]!)))).toThrow(/has 2 primary locations, not one/);
    expect(without((f) => Object.assign(f.locations[2]!.symbolic, { key: { Remote: { slug: 'a/b', path: 'x.yml' } } }))).toThrow(/names no local file/);
    expect(without((f) => Object.assign(f.locations[2]!.concrete.location.start_point, { row: -1 }))).toThrow(/has no line/);
    expect(without((f) => Object.assign(f.locations[2]!.symbolic, { route: { route: [{ Key: 'on' }] } }))).toThrow(/names no job/);
    expect(without((f) => Object.assign(f.locations[2]!.concrete, { feature: ' ' }))).toThrow(/names nothing it reads/);
  });
});

describe('what fails the step, and what only reports', () => {
  it('lists a secret read outside an environment, and passes', () => {
    expect(judge(13, [PROBE])).toEqual({ total: 1, secrets: collect([PROBE]).secrets, problems: [] });
    expect(judge(14, [PROBE, other('unpinned-images', 'High')]).problems).toEqual([]);
  });

  it('passes a run that found nothing, and one whose findings hold no secret', () => {
    expect(judge(0, [])).toEqual({ total: 0, secrets: [], problems: [] });
    expect(judge(12, [other('excessive-permissions', 'Low')])).toEqual({ total: 1, secrets: [], problems: [] });
  });

  it('fails a run that did not finish, for every exit but 0 and 11 to 14, without reading a report', () => {
    for (const code of [1, 2, 3, 10, 15, 125, 255]) {
      const verdict = judge(code, undefined);
      expect(verdict.problems, String(code)).toEqual([`zizmor ${meaning(code)} (exit ${code}), so no workflow was read`]);
      expect(verdict.secrets).toEqual([]);
    }
    expect(meaning(3)).toBe('collected no inputs');
    expect(meaning(125)).toBe('ended in a way zizmor does not document');
  });

  it('fails a report whose highest severity is not the one the exit code names', () => {
    expect(judge(0, [PROBE]).problems).toEqual([
      'zizmor exited 0 (found nothing) and its report lists 1, the highest of them medium, which is exit 13: the status does not belong to the report',
    ]);
    expect(judge(13, []).problems).toEqual([
      'zizmor exited 13 (found findings, the highest of them medium) and its report lists no finding, which is exit 0: the status does not belong to the report',
    ]);
    expect(judge(12, [PROBE]).problems).toHaveLength(1);
    expect(judge(14, [PROBE]).problems).toHaveLength(1);
  });

  it('knows the exit for each severity zizmor gives, and the words for each exit it documents', () => {
    expect(SEVERITY_EXIT).toEqual({ Informational: 11, Low: 12, Medium: 13, High: 14 });
    expect(Object.keys(EXIT_MEANINGS).map(Number)).toEqual([0, 1, 2, 3, 11, 12, 13, 14]);
  });

  it('writes the summary with one row per secret, its cells kept to one line and out of code', () => {
    const summary = renderSummary({ version: 'zizmor 1.32.0', total: 2, secrets: collect([PROBE]).secrets });
    expect(summary).toContain('### zizmor 1.32.0, secrets read outside a GitHub environment (report only)');
    expect(summary).toContain('1 secret read outside an environment, of 2 findings under the auditor persona');
    expect(summary).toContain('| `.github/workflows/exposure-probe.yml:120` | `probe` | `secrets.EXPOSURE_PROBE_HOST` |');
    const odd = renderSummary({ version: 'zizmor', total: 1, secrets: [{ file: 'a|b.yml', line: 1, job: 'j`x', reads: "secrets['A']\nB" }] });
    expect(odd).toContain("| `a\\|b.yml:1` | `j'x` | `secrets['A'] B` |");
    expect(renderSummary({ version: 'zizmor', total: 0, secrets: [] })).not.toContain('| Where |');
  });

  it('puts one warning on each line, its properties escaped as GitHub reads them', () => {
    const [line] = annotations(collect([PROBE]).secrets);
    expect(line).toMatch(/^::warning file=\.github\/workflows\/exposure-probe\.yml,line=120,title=zizmor secrets-outside-env::Job probe reads secrets\.EXPOSURE_PROBE_HOST and names no GitHub environment/);
    expect(annotations([{ file: 'a,b:c.yml', line: 3, job: 'j', reads: 'secrets.X\n%' }])[0]).toMatch(/^::warning file=a%2Cb%3Ac\.yml,line=3,title=zizmor secrets-outside-env::Job j reads secrets\.X%0A%25 /);
  });

  it('names the release from the image zizmor.yml pins, and no more than it can read there', () => {
    expect(versionOf('ghcr.io/zizmorcore/zizmor:1.32.0@sha256:3014cc8f68f663935f69b3c3e0e41f5ce102b268d97db13db0f62208747f860d')).toBe('zizmor 1.32.0');
    expect(versionOf('ghcr.io/zizmorcore/zizmor:1.32.0')).toBe('zizmor');
    expect(versionOf(undefined)).toBe('zizmor');
  });
});

describe('the CLI zizmor.yml runs', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'zizmor-secrets-report-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  /** Run the reporter as the step does, with zizmor's exit code and a report (or none) at a path. */
  const run = (code: string | undefined, body: string | undefined) => {
    const file = join(scratch, `report-${Math.random().toString(36).slice(2)}.json`);
    if (body !== undefined) writeFileSync(file, body);
    const summary = join(scratch, `summary-${Math.random().toString(36).slice(2)}.md`);
    const args = [REPORTER, ...(code === undefined ? [] : ['--exit-code', code]), file];
    const env = { PATH: process.env.PATH ?? '', GITHUB_STEP_SUMMARY: summary, ZIZMOR_IMAGE: 'ghcr.io/zizmorcore/zizmor:1.32.0@sha256:' + 'a'.repeat(64) };
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', env });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '' };
  };

  it('passes a secret read outside an environment, warns on its line, and writes it to the job summary', () => {
    const r = run('14', JSON.stringify([PROBE, other('unpinned-images', 'High')], null, 2));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('::warning file=.github/workflows/exposure-probe.yml,line=120,title=zizmor secrets-outside-env::');
    expect(r.out).toContain('zizmor, auditor persona: 2 findings, 1 of them secrets-outside-env; 0 problem(s) with the run.');
    expect(r.out).not.toContain('unpinned-images');
    expect(r.summary).toContain('### zizmor 1.32.0, secrets read outside a GitHub environment (report only)');
    expect(r.summary).toContain('| `.github/workflows/exposure-probe.yml:120` | `probe` | `secrets.EXPOSURE_PROBE_HOST` |');
  });

  it('passes a run that found nothing', () => {
    const r = run('0', '[]');
    expect(r.status, r.out).toBe(0);
    expect(r.summary).toContain('0 secrets read outside an environment, of 0 findings');
  });

  it('fails a run that did not finish, with no report on disk, saying what the exit code means', () => {
    const r = run('3', undefined);
    expect(r.status).toBe(1);
    expect(r.out).toContain('::error::zizmor collected no inputs (exit 3), so no workflow was read');
  });

  it('fails a report it cannot read, one in another shape, a status from another run, and a call without the exit code', () => {
    const unreadable = run('13', '[{"ident": ');
    expect(unreadable.status).toBe(1);
    expect(unreadable.out).toContain("::error::zizmor's report could not be read:");
    const shape = run('13', JSON.stringify({ findings: [PROBE] }));
    expect(shape.status).toBe(1);
    expect(shape.out).toContain("::error::zizmor's report is not in the shape --format json-v1 writes: not a list of findings");
    const stale = run('0', JSON.stringify([PROBE]));
    expect(stale.status).toBe(1);
    expect(stale.out).toContain('::error::zizmor exited 0 (found nothing) and its report lists 1');
    const bare = run(undefined, '[]');
    expect(bare.status).toBe(1);
    expect(bare.out).toContain('::error::usage: node scripts/zizmor-secrets-report.mjs --exit-code');
  });
});

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: unknown;
  readonly with?: Record<string, unknown>;
}

/** What is wrong with zizmor.yml's report step, by the four parts of the header; empty when it holds. */
export function reportProblems(text: string): string[] {
  const out: string[] = [];
  const steps = ((parseYaml(text) as { jobs?: Record<string, { steps?: Step[] }> }).jobs?.[JOB]?.steps ?? []) as Step[];
  const at = steps.flatMap((s, i) => (s.name === REPORT_STEP ? [i] : []));
  if (at.length !== 1) return [`${WORKFLOW}'s ${JOB} job has ${at.length} steps named "${REPORT_STEP}", not one`];
  const report = steps[at[0]!]!;
  const audit = steps.findIndex((s) => s.name !== REPORT_STEP && typeof s.run === 'string' && s.run.includes('"$ZIZMOR_IMAGE"') && /^\s*exit "\$status"\s*$/m.test(s.run));
  if (audit < 0 || audit > at[0]!) out.push('the report does not come after the audit');
  if (report.if !== '${{ !cancelled() }}') out.push(`the report runs if ${JSON.stringify(report.if)}, not \${{ !cancelled() }}, so a red audit would hide it`);
  const node = steps.findIndex((s, i) => i > audit && i < at[0]! && typeof s.uses === 'string' && s.uses.startsWith('actions/setup-node@'));
  if (node < 0) out.push('no setup-node step comes between the audit and the report');
  else {
    if (steps[node]!.if !== '${{ !cancelled() }}') out.push('setup-node does not run after a red audit, so the report would run on the runner’s own Node');
    if (steps[node]!.with?.['node-version'] !== '26') out.push(`setup-node installs Node ${JSON.stringify(steps[node]!.with?.['node-version'])}, not 26`);
  }
  const run = typeof report.run === 'string' ? report.run : '';
  const must = [
    'docker run --rm --pull never',
    '"$ZIZMOR_IMAGE"',
    '--network none',
    '--read-only',
    '--offline',
    '--config .github/zizmor.yml',
    '--no-ignores',
    '--persona auditor',
    '--format json-v1',
    `. > ${JSON_OUT} 2> "$RUNNER_TEMP/zizmor-auditor.log" || status=$?`,
    `node scripts/zizmor-secrets-report.mjs --exit-code "$status" ${JSON_OUT}`,
  ];
  for (const piece of must) if (!run.includes(piece)) out.push(`the report does not run with ${piece}`);
  if (/^\s*exit\b/m.test(run)) out.push('the report exits with a status of its own, and zizmor’s would block on a finding D2 keeps report only');
  if (/\|\|\s*(true|:)\b/.test(run)) out.push('the report reads a run that did not finish as one that did');
  if (/--no-exit-codes|--min-(severity|confidence)|--fix|--format[ =](sarif|github|plain)|2>&1/.test(run)) {
    out.push('the report hides how zizmor ended, narrows what it reports, or mixes its log into the JSON');
  }
  return out;
}

describe('zizmor.yml runs it as decided', () => {
  const text = readFileSync(join(REPO, WORKFLOW), 'utf8');

  it('runs the report after the audit and after a red one, with the image, the flags and the persona above', () => {
    expect(reportProblems(text)).toEqual([]);
    expect(existsSync(REPORTER)).toBe(true);
  });

  it('refuses each way the report could block, go online, read less, or be skipped', () => {
    const mutate = (from: string | RegExp, to: string): string => {
      const next = text.replace(from, to);
      expect(next, String(from)).not.toBe(text);
      return reportProblems(next).join('\n');
    };
    /** The last place `piece` occurs in the file, which is in the report, the job's last step: the audit's own stays as it is. */
    const last = (piece: string): RegExp => {
      const escaped = piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`${escaped}(?![\\s\\S]*${escaped})`);
    };
    const tail = `node scripts/zizmor-secrets-report.mjs --exit-code "$status" ${JSON_OUT}\n`;
    expect(mutate(tail, `${tail}          exit "$status"\n`)).toMatch(/exits with a status of its own/);
    expect(mutate('--persona auditor ', '')).toMatch(/does not run with --persona auditor/);
    expect(mutate('--persona auditor --format json-v1', '--persona auditor --format sarif')).toMatch(/does not run with --format json-v1/);
    expect(mutate('--persona auditor ', '--persona auditor --min-severity high ')).toMatch(/narrows what it reports/);
    expect(mutate('--persona auditor ', '--persona auditor --no-exit-codes ')).toMatch(/hides how zizmor ended/);
    expect(mutate('2> "$RUNNER_TEMP/zizmor-auditor.log" || status=$?', '2>&1 || status=$?')).toMatch(/mixes its log into the JSON/);
    expect(mutate(last('|| status=$?'), '|| true')).toMatch(/reads a run that did not finish as one that did/);
    expect(mutate(last('--network none '), '')).toMatch(/does not run with --network none/);
    expect(mutate(last('--read-only '), '')).toMatch(/does not run with --read-only/);
    expect(mutate(last('--offline '), '')).toMatch(/does not run with --offline/);
    expect(mutate(last('--no-ignores '), '')).toMatch(/does not run with --no-ignores/);
    expect(mutate(last('--config .github/zizmor.yml '), '')).toMatch(/does not run with --config \.github\/zizmor\.yml/);
    expect(mutate(last('"$ZIZMOR_IMAGE"'), '"$OTHER_IMAGE"')).toMatch(/does not run with "\$ZIZMOR_IMAGE"/);
    expect(mutate(last('docker run --rm --pull never'), 'docker run --rm')).toMatch(/does not run with docker run --rm --pull never/);
  });

  it('refuses the report skipped after a red audit, run before it, or run on the runner’s own Node', () => {
    const mutate = (from: string, to: string): string => {
      const next = text.replace(from, to);
      expect(next, from).not.toBe(text);
      return reportProblems(next).join('\n');
    };
    const name = `      - name: ${REPORT_STEP}\n        if: \${{ !cancelled() }}\n`;
    expect(mutate(name, `      - name: ${REPORT_STEP}\n`)).toMatch(/runs if undefined, not \$\{\{ !cancelled\(\) \}\}/);
    expect(mutate("          node-version: '26'\n          check-latest", "          node-version: '24'\n          check-latest")).toMatch(/installs Node "24", not 26/);
    const setup = '      - uses: actions/setup-node@';
    const start = text.indexOf(setup);
    const end = text.indexOf(`      - name: ${REPORT_STEP}`);
    expect(start > 0 && end > start, `${WORKFLOW}'s setup-node step was not found`).toBe(true);
    const block = text.slice(start, end);
    expect(mutate(block, block.replace('        if: ${{ !cancelled() }}\n', ''))).toMatch(/setup-node does not run after a red audit/);
    expect(mutate(block, '')).toMatch(/no setup-node step comes between the audit and the report/);
    // The report and its setup-node moved above the audit.
    const report = text.slice(start);
    const before = text.slice(0, start).replace('      - name: Audit every workflow', `${report.endsWith('\n') ? report : `${report}\n`}      - name: Audit every workflow`);
    expect(before).not.toBe(text.slice(0, start));
    expect(reportProblems(before).join('\n')).toMatch(/does not come after the audit/);
    expect(mutate(`name: ${REPORT_STEP}`, 'name: Report secrets')).toMatch(/has 0 steps named/);
  });
});
