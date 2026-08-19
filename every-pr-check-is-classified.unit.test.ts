// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Every check a pull request can produce is classified as required or not.
 *
 * `ci-complete-covers-every-job.unit.test.ts` guards the inside of `ci.yml`: add
 * a job there and forget `ci-complete.needs`, and it fails. It cannot see one
 * step further out. `ci-complete` is a job IN ci.yml, so it can only `needs:`
 * jobs in that same file — a check produced by a DIFFERENT workflow is outside
 * its reach by construction, and has to be required in branch protection on its
 * own.
 *
 * That gap has already cost this repo once. On 2026-08-14 branch protection was
 * narrowed to `ci-complete` alone, on the reasoning that it aggregates
 * everything. It aggregates everything *in ci.yml*. `security-scan`, `Trivy` and
 * `Check for committed artifacts` were silently un-gated — a failing security
 * scan would have merged, and nothing anywhere would have said so. It was caught
 * by reading the workflows, which is not a control.
 *
 * So the classification is asserted here. Add a workflow that reports on pull
 * requests and this test fails until you say which bucket its checks are in.
 * The point is not that the list below is correct forever — it is that changing
 * what CI reports forces a decision about gating, in the same commit, rather
 * than leaving it to be noticed.
 *
 * WHAT THIS CANNOT DO. Branch protection lives in GitHub's settings, not the
 * repo, so nothing here reads the actually-required set. This asserts that every
 * producible check has a documented intent; it cannot assert that the intent was
 * applied. `docs/testing.md` records the set for a human to check against.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const WORKFLOW_DIR = fileURLToPath(new URL('./.github/workflows/', import.meta.url));
const DOC_PATH = fileURLToPath(new URL('./docs/testing.md', import.meta.url));

/**
 * Required in branch protection ALONGSIDE `ci-complete`, because `ci-complete`
 * cannot reach across workflow files to `needs:` them.
 *
 * `Trivy` is not a job name: `trivy-action`, inside security-scan.yml's
 * `security-scan` job, posts its own check run under that name. It is listed
 * because branch protection sees a context called `Trivy` regardless of which
 * job produced it, and requiring it is what makes a Trivy finding block a merge.
 */
const REQUIRED_OUTSIDE_CI = new Set(['security-scan', 'Trivy', 'Check for committed artifacts']);

/**
 * Must NOT be required, each with the reason.
 *
 * These do not fail — they go UNREPORTED on some pull requests, which is worse.
 * A required context that is never reported leaves the pull request at
 * "Expected — waiting for status to be reported" with nothing queued in Actions
 * to explain it, and no amount of re-running fixes it.
 */
const NOT_REQUIRABLE = new Map([
  [
    'build',
    'images.yml carries a `paths:` filter on its pull_request trigger, so on a PR ' +
      'touching none of those paths the workflow never runs and the context is never reported.',
  ],
]);

interface Job {
  readonly name?: string;
}

interface Workflow {
  readonly on?: unknown;
  readonly jobs?: Record<string, Job>;
}

const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

/**
 * `on` is a YAML 1.1 boolean, so some parsers key this map under `true` rather
 * than the string. The `yaml` package's default (1.2 core) keeps it a string;
 * both are read so a parser default change surfaces as a real failure here
 * rather than as this test quietly finding no triggers and passing vacuously.
 */
function triggersOf(wf: Workflow): Record<string, unknown> {
  const on = wf.on ?? (wf as Record<string, unknown>)['true'];
  if (typeof on === 'string') return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map((k) => [String(k), {}]));
  return (on ?? {}) as Record<string, unknown>;
}

/** A check name a workflow can report on a pull request, and how it got there. */
interface ProducedCheck {
  readonly workflow: string;
  readonly checkName: string;
  readonly pathsFiltered: boolean;
}

const produced: ProducedCheck[] = [];
for (const file of files) {
  const wf = parse(readFileSync(WORKFLOW_DIR + file, 'utf8')) as Workflow;
  const triggers = triggersOf(wf);
  if (!('pull_request' in triggers)) continue;

  const pr = triggers.pull_request as { paths?: unknown } | null;
  const pathsFiltered = Boolean(pr && typeof pr === 'object' && 'paths' in pr);

  for (const [key, job] of Object.entries(wf.jobs ?? {})) {
    produced.push({ workflow: file, checkName: job?.name ?? key, pathsFiltered });
  }
}

const fromCi = produced.filter((p) => p.workflow === 'ci.yml');
const fromElsewhere = produced.filter((p) => p.workflow !== 'ci.yml');

describe('every check a pull request can produce is classified', () => {
  it('parsed real workflows, with real jobs', () => {
    // The vacuity guard. Every assertion below is trivially true against an
    // empty list — a wrong directory, or a parser that stopped recognising the
    // `on:` key, would otherwise report perfect classification of nothing.
    expect(files.length, `no workflow files under ${WORKFLOW_DIR}`).toBeGreaterThan(3);
    expect(
      produced.map((p) => p.workflow),
      'no pull_request-triggered workflow found — check `on:` parsing',
    ).toContain('ci.yml');
    expect(fromCi.length, 'ci.yml parsed with almost no jobs').toBeGreaterThan(5);
    expect(fromElsewhere.length, 'no non-ci.yml PR checks found').toBeGreaterThan(0);
  });

  it('classifies every check produced outside ci.yml', () => {
    // ci.yml's own jobs are deliberately not checked here: `ci-complete`
    // aggregates them and the sibling test proves it. These are the ones no
    // aggregate can reach.
    const unclassified = fromElsewhere.filter(
      (p) => !REQUIRED_OUTSIDE_CI.has(p.checkName) && !NOT_REQUIRABLE.has(p.checkName),
    );

    expect(
      unclassified.map((p) => `${p.checkName} (${p.workflow})`),
      'these checks report on pull requests but are in neither list, so nobody has ' +
        'decided whether a failure should block a merge:\n' +
        unclassified.map((p) => `  - ${p.checkName}  from ${p.workflow}`).join('\n') +
        '\nAdd each to REQUIRED_OUTSIDE_CI (and to branch protection, and to the ' +
        'required-checks list in docs/testing.md) or to NOT_REQUIRABLE with a reason.',
    ).toEqual([]);
  });

  it('never requires a check that a `paths:` filter can silence', () => {
    // The mechanical rule behind NOT_REQUIRABLE, asserted rather than trusted:
    // a paths-filtered pull_request trigger means the workflow does not run at
    // all on some PRs, so its contexts are absent rather than red. Requiring one
    // deadlocks exactly the pull requests it does not apply to.
    const silenceable = produced.filter(
      (p) => p.pathsFiltered && REQUIRED_OUTSIDE_CI.has(p.checkName),
    );

    expect(
      silenceable.map((p) => `${p.checkName} (${p.workflow})`),
      'these are required but their workflow is paths-filtered, so they are ' +
        'unreported — not green — on a PR that touches none of those paths, and ' +
        'branch protection would block it forever:\n' +
        silenceable.map((p) => `  - ${p.checkName}  from ${p.workflow}`).join('\n'),
    ).toEqual([]);
  });

  it('documents a reason for every check it refuses to require', () => {
    // A bare "do not require this" is a note. The reason is what stops the next
    // person re-adding it, so an empty one is treated as an omission.
    for (const [name, reason] of NOT_REQUIRABLE) {
      expect(reason.length, `NOT_REQUIRABLE['${name}'] has no reason`).toBeGreaterThan(40);
    }
  });

  it('keeps the required-checks list in docs/testing.md in step', () => {
    // The doc is where a human configuring branch protection actually looks. If
    // it and this file disagree, one of them is lying and there is no way to
    // tell which from the outside.
    //
    // Scoped to the paragraph that STATES the required set, not the whole file.
    // Searching the document at large passes on coincidence: `Trivy` also appears
    // in the CI-mapping bullet describing what security-scan.yml runs, so a
    // whole-file `includes` stayed green through a deliberate deletion of the
    // name from the required list. That is the vacuous-assertion failure this
    // repo keeps paying for, and it was caught here only by mutating the doc and
    // watching this test fail to notice.
    const doc = readFileSync(DOC_PATH, 'utf8');
    const marker = '**Required status checks**';
    const start = doc.indexOf(marker);

    expect(start, `docs/testing.md no longer contains "${marker}"`).toBeGreaterThan(-1);

    // split() always yields at least one element; ?? '' says so to the compiler.
    const paragraph = doc.slice(start).split('\n\n')[0] ?? '';
    const missing = [...REQUIRED_OUTSIDE_CI].filter((n) => !paragraph.includes(n));

    expect(
      missing,
      `these are required alongside ci-complete but are not named in the "${marker}" ` +
        'paragraph of docs/testing.md:\n' +
        missing.map((n) => `  - ${n}`).join('\n'),
    ).toEqual([]);
  });
});
