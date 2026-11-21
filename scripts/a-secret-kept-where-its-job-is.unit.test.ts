// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SECRET KEPT WHERE ITS JOB IS (workplan 0163 T1; the owner's decision D2 of
 * 2026-11-20: move the secrets into GitHub environments, and D7, which took
 * the O365 lane and its seven secrets out).
 *
 * An outside, read-only check of 2026-11-20 found the workflows' secrets kept
 * for the whole repository (its finding 1). A repository secret reaches every
 * job of every workflow, a workflow added on a branch included. A secret kept
 * in a GitHub environment reaches only a job that names that environment, and
 * the environment's own rules, set in Settings, say which branches may run
 * such a job. Two secrets are left, one job each:
 *
 *  - `TRIGGER_ACCESS_TOKEN`, the Trigger.dev CLI's token, which
 *    `e2e-managed.yml`'s one job, `e2e-managed`, deploys with;
 *  - `EXPOSURE_PROBE_HOST`, the machine's own address, which
 *    `exposure-probe.yml`'s `probe` asks from outside.
 *
 * Each job names its environment (`KEPT`, below), and the secret is read in
 * that job alone, never in a workflow's top-level `env:`, which no environment
 * reaches, and never by any other job or workflow. Moving the secret is the
 * owner's part, in Settings; until then the job still reads the repository's
 * secret, and GitHub makes the environment the first time a job names it, so
 * this holds the same before and after the move.
 *
 * Only these two. A secret added later is zizmor's `secrets-outside-env`
 * audit's to report (0163 §5, step 2, report only by D2), not this guard's to
 * refuse.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = '.github/workflows';
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** Each secret left, the one job that reads it, and the environment that job names. */
const KEPT = [
  { secret: 'TRIGGER_ACCESS_TOKEN', workflow: `${WORKFLOWS}/e2e-managed.yml`, job: 'e2e-managed', environment: 'e2e-managed' },
  { secret: 'EXPOSURE_PROBE_HOST', workflow: `${WORKFLOWS}/exposure-probe.yml`, job: 'probe', environment: 'exposure-probe' },
] as const;

type Kept = (typeof KEPT)[number];

interface Job {
  readonly environment?: unknown;
  readonly [key: string]: unknown;
}

interface Workflow {
  readonly env?: Record<string, unknown>;
  readonly jobs?: Record<string, Job>;
}

/** `secrets.NAME` in an expression, as GitHub reads one; `secrets['NAME']` too. */
const reads = (secret: string): RegExp => new RegExp(`\\bsecrets\\s*(?:\\.\\s*${secret}\\b|\\[\\s*['"]${secret}['"]\\s*\\])`);

/** The name a job's `environment:` gives: the string itself, or the `name` of the long form. */
const environmentOf = (job: Job): unknown => (job.environment !== null && typeof job.environment === 'object' ? (job.environment as { name?: unknown }).name : job.environment);

/** What is wrong with where `kept.secret` is read in its workflow's text; empty when it holds. */
export function keptProblems(text: string, kept: Kept): string[] {
  const out: string[] = [];
  const wf = parseYaml(text) as Workflow;
  const secret = reads(kept.secret);
  const job = wf.jobs?.[kept.job];
  if (!job) return [`${kept.workflow} has no job \`${kept.job}\`, the one that reads ${kept.secret}`];
  const named = environmentOf(job);
  if (named !== kept.environment) {
    out.push(`${kept.workflow}'s ${kept.job} names the environment ${JSON.stringify(named)}, not \`${kept.environment}\`, so ${kept.secret} kept there would not reach it, or one kept for the repository would stay there`);
  }
  if (!secret.test(JSON.stringify(job))) out.push(`${kept.workflow}'s ${kept.job} no longer reads ${kept.secret}: move this entry with it, or take it out`);
  if (secret.test(JSON.stringify(wf.env ?? {}))) {
    out.push(`${kept.workflow} reads ${kept.secret} in its top-level env:, which no environment reaches: read it in ${kept.job}'s own env:`);
  }
  for (const [name, other] of Object.entries(wf.jobs ?? {})) {
    if (name !== kept.job && secret.test(JSON.stringify(other))) out.push(`${kept.workflow}'s ${name} reads ${kept.secret} too, which only ${kept.job} should`);
  }
  return out;
}

/** The workflows other than `kept.workflow` that read `kept.secret`, by file. */
export function elsewhere(kept: Kept, files: ReadonlyArray<{ path: string; text: string }>): string[] {
  return files.filter((f) => f.path !== kept.workflow && reads(kept.secret).test(f.text)).map((f) => f.path);
}

const workflows = (): Array<{ path: string; text: string }> =>
  readdirSync(join(ROOT, WORKFLOWS))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ path: `${WORKFLOWS}/${f}`, text: read(`${WORKFLOWS}/${f}`) }));

describe('the two secrets left, each kept in the environment of the one job that reads it (workplan 0163 T1)', () => {
  it.each(KEPT)('$secret is read by $workflow’s $job alone, which names the environment $environment', (kept) => {
    expect(keptProblems(read(kept.workflow), kept)).toEqual([]);
    expect(elsewhere(kept, workflows()), `${kept.secret} is read outside ${kept.workflow}`).toEqual([]);
  });

  it('reads secrets.NAME and secrets[\'NAME\'] alike, and no secret whose name only starts the same', () => {
    const token = reads('TRIGGER_ACCESS_TOKEN');
    expect(token.test('${{ secrets.TRIGGER_ACCESS_TOKEN }}')).toBe(true);
    expect(token.test("${{ secrets['TRIGGER_ACCESS_TOKEN'] }}")).toBe(true);
    expect(token.test('${{ secrets.TRIGGER_ACCESS_TOKEN_OLD }}')).toBe(false);
    expect(token.test('TRIGGER_ACCESS_TOKEN: ${{ vars.X }}')).toBe(false);
  });

  it('refuses each way a secret could leave its job’s environment, by a change to the real file', () => {
    const [trigger, probe] = KEPT;
    const managed = read(trigger.workflow);
    const exposure = read(probe.workflow);
    const mutate = (text: string, kept: Kept, from: string | RegExp, to: string): string => {
      const next = text.replace(from, to);
      expect(next, String(from)).not.toBe(text);
      return keptProblems(next, kept).join('\n');
    };
    expect(mutate(managed, trigger, '    environment: e2e-managed\n', '')).toMatch(/names the environment undefined, not `e2e-managed`/);
    expect(mutate(managed, trigger, '    environment: e2e-managed\n', '    environment: production\n')).toMatch(/names the environment "production"/);
    expect(mutate(managed, trigger, '    environment: e2e-managed\n', '    environment:\n      name: e2e-managed\n')).toBe('');
    expect(mutate(exposure, probe, '    environment: exposure-probe\n', '')).toMatch(/names the environment undefined, not `exposure-probe`/);
    // The token read in the workflow's own env again, as it was before.
    const moved = managed.replace(/\n {6}TRIGGER_ACCESS_TOKEN: \$\{\{ secrets\.TRIGGER_ACCESS_TOKEN \}\}/, '').replace(/^env:\n/m, 'env:\n  TRIGGER_ACCESS_TOKEN: ${{ secrets.TRIGGER_ACCESS_TOKEN }}\n');
    expect(moved).not.toBe(managed);
    expect(keptProblems(moved, trigger).join('\n')).toMatch(/reads TRIGGER_ACCESS_TOKEN in its top-level env:, which no environment reaches/);
    expect(keptProblems(moved, trigger).join('\n')).toMatch(/no longer reads TRIGGER_ACCESS_TOKEN/);
    // A second job in the same workflow reading it.
    const second = `${exposure}  another:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo "$HOST"\n        env:\n          HOST: \${{ secrets.EXPOSURE_PROBE_HOST }}\n`;
    expect(exposure.endsWith('\n'), `${probe.workflow} does not end in a newline, so the job above would not be one of its jobs`).toBe(true);
    expect(keptProblems(second, probe)).toEqual([expect.stringMatching(/'s another reads EXPOSURE_PROBE_HOST too, which only probe should/)]);
    // Another workflow reading it.
    const files = [...workflows(), { path: `${WORKFLOWS}/new.yml`, text: 'jobs:\n  x:\n    steps:\n      - run: echo ${{ secrets.EXPOSURE_PROBE_HOST }}\n' }];
    expect(elsewhere(probe, files)).toEqual([`${WORKFLOWS}/new.yml`]);
  });
});
