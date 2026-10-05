// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUN THAT WAS CANCELLED, AND A GREEN TICK OVER THE TREE IT WAS TESTING.
 *
 * Twice now, in two shapes. The first half of this file holds the first
 * (2026-09-21): a push build cancelled by concurrency, and a later docs-only
 * run reporting green over the code it carried. The second half holds the
 * second (2026-10-05): gates that never got a runner, and `ci-complete`
 * reporting green over the run they belonged to.
 *
 * ## The first: a push build cancelled by the next push
 *
 * `concurrency: cancel-in-progress` is right on a pull request and wrong on a
 * push, and the two look identical.
 *
 * What this holds is the SETTING, not an outcome: that the workflow does not
 * ask for a push or a schedule run to be cancelled. The outcome is narrower
 * than the first version of this file implied, and ci.yml's concurrency
 * comment carries the measurement — GitHub cancels the run in its one pending
 * slot whatever this flag says, so of several rapid merges the oldest and the
 * newest complete and the middle ones do not.
 *
 * On a PULL REQUEST a new commit makes the running build obsolete — the older
 * commit is not what will merge, and nobody will ever ask what it said.
 * Cancelling is free.
 *
 * On a PUSH to `main` the superseded commit is not obsolete. **It is in
 * `main`.** Cancelling its build means nothing ever runs the gates for the
 * code it carried, because `detect-changes` on the NEXT push computes changed
 * files from THAT push's diff alone — not from everything since the last
 * completed run.
 *
 * ### What it did, 2026-09-21
 *
 * #1054 merged at 21:32 carrying a change to `ci.yml` and a new guard. #1055
 * merged at 21:43 carrying one paragraph of prose. Run **2841** was eleven
 * minutes into the suite on the Spark and was cancelled where it stood. Run
 * **2843** read its own diff — one `.md` file — skipped `lint`, `unit-tests`,
 * `ui-tests`, `migration-lint` and `integration-tests`, and concluded success
 * in four and a half minutes.
 *
 * `main` then carried a green tick over a tree whose tests had not run. The
 * suite was in fact green — it was run by hand to find out, which is the part
 * that should never be necessary. And nothing lied: `ci-complete` named every
 * skipped gate in its summary, exactly as it is built to. The composition did.
 *
 * Any code merge followed within a build's length by a docs-only merge
 * reproduces it. That is not a rare shape; it is two ordinary merges.
 *
 * ### What the first half holds
 *
 * The PROPERTY, not the spelling: that `cancel-in-progress` is false when the
 * event is `push` and true when it is `pull_request`. It reads the workflow,
 * takes whatever expression is there and evaluates it for both events, so the
 * assertion survives the condition being rewritten in another form.
 *
 * It FAILS CLOSED. An expression this file cannot read is a failure, not a
 * pass — a guard that shrugs at what it does not understand is the same green
 * tick over an unknown tree that it exists to prevent.
 *
 * It also holds the `group`, because the flag is only half the mechanism: the
 * two events are kept apart by `github.ref` (`refs/pull/N/merge` against
 * `refs/heads/main`). A group that stopped varying with the ref would put pull
 * request and push runs in one bucket, where a pull request could cancel a
 * push build and this file's first test would still pass.
 *
 * ## The second: gates that never started, and a check that called them passed
 *
 * GitHub had an incident on the evening of 2026-10-05, "delays in assigning
 * GitHub-hosted runners". A pull request job no runner picks up is given up
 * after about fifteen minutes with "The job was not acquired by Runner of type
 * hosted even after multiple attempts", and the jobs API reports it
 * `cancelled`.
 *
 * `ci-complete` reported SUCCESS over every run it happened to. Its failing
 * step was conditional — `contains(needs.*.result, 'failure') ||
 * contains(needs.*.result, 'cancelled')` — and the step was SKIPPED, because
 * what the `needs` context says about a job that never started is neither of
 * those. It says **`abandoned`**, a value GitHub's documentation for
 * `needs.<job_id>.result` does not list (it lists success, failure, cancelled
 * and skipped). The runs' own `ci-complete` logs print it:
 *
 *     37364709044/1  commit-convention, fixture-uuid-check, lint, unit-tests
 *                    abandoned (unit-tests: two shards passed, two never ran)
 *     37371577511/1  commit-convention, lint, unit-tests abandoned
 *     37373154965/1  detect-changes, commit-convention abandoned, so lint and
 *                    everything below it SKIPPED, as a docs-only change would
 *     37366193208/2  a re-run of failed jobs; lint, unit-tests abandoned
 *
 * `ci-complete` is the required check on `main`, so each of those pull
 * requests showed as mergeable with lint and the unit tests never run. Run
 * 37373278333/1, cancelled by a newer push to its branch, was red as it
 * should have been — `cancelled` was a value the step knew.
 *
 * The rule was written as a list of the ways to fail, and GitHub found
 * another. AGENTS.md hard rule 9's "skipped is not passed" was honoured in the
 * summary table and nowhere else.
 *
 * ### What the second half holds
 *
 * The rule turned around: a gate that SHOULD have run, for this event and
 * this change, passes only on `success` — whatever GitHub calls anything
 * else. "Should have run" is each job's own `if:` and `needs:`, read from
 * ci.yml, so it does not depend on guessing GitHub's word for a job that never
 * ran.
 *
 * And it is held by RUNNING `ci-complete`: its steps, as ci.yml writes them —
 * each step's `if:` evaluated, its `env:` rendered, its `run:` executed by
 * bash — against `needs` as GitHub would hand it over. Against:
 *
 *  - the runs above, recorded from their logs, which must FAIL;
 *  - green runs recorded the same way — a docs-only pull request and push, a
 *    full one of each, one that changed a migration — which must PASS;
 *  - every combination of event and `detect-changes` output, with every job
 *    doing exactly what its own `if:` asks, which must PASS; and with any one
 *    job that should have run reporting anything but `success`, or one that
 *    had no reason to run reporting anything but `skipped`, which must FAIL.
 *
 * So adding a job, or changing a job's condition, without telling
 * `ci-complete` goes red here: the model says what the job now does, and
 * `ci-complete` has not been told. Nothing about this half reads how
 * `ci-complete` is SPELLED — only what it does with what it is given.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const WORKFLOWS = join(REPO_ROOT, '.github/workflows');

interface Step {
  readonly name?: string;
  readonly if?: unknown;
  readonly run?: string;
  readonly uses?: string;
  readonly shell?: string;
  readonly env?: Readonly<Record<string, unknown>>;
  readonly 'continue-on-error'?: unknown;
}

interface Job {
  readonly needs?: string | ReadonlyArray<string>;
  readonly if?: unknown;
  readonly outputs?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, unknown>>;
  readonly steps?: ReadonlyArray<Step>;
}

interface Workflow {
  /** The FILE name. Not `name:` — every workflow declares one of those, and
   *  spreading the parsed document over a field called `name` let `ci.yml`
   *  arrive calling itself `CI`. */
  readonly file: string;
  readonly concurrency?: { group?: string; 'cancel-in-progress'?: boolean | string };
  readonly on?: Readonly<Record<string, unknown>>;
  readonly jobs?: Readonly<Record<string, Job>>;
}

/** Every workflow in the repository, parsed. */
function workflows(): ReadonlyArray<Workflow> {
  return readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((file) => ({
      ...(parseYaml(readFileSync(join(WORKFLOWS, file), 'utf8')) as object),
      file,
    })) as ReadonlyArray<Workflow>;
}

const workflow = workflows().find((w) => w.file === 'ci.yml')!;

// ── A small reader for GitHub's expression language ─────────────────────────
//
// Deliberately small, and FAILS CLOSED: a name, a function or an operator it
// does not know THROWS rather than guessing. Both halves of this file read
// conditions with it, so one reader is held to one standard. When a workflow
// needs more than this, the workflow and this reader are changed together,
// which is the point at which somebody re-reads what the condition is for.
//
// Where it models GitHub, it models GitHub's rules rather than JavaScript's:
// strings compare without regard to case, and a non-empty string is TRUE —
// `'false'` included, which is why a condition must compare an output with
// `== 'true'` and never test it bare.

/** What one job in a `needs` context carries. */
interface NeedResult {
  readonly result: string;
  readonly outputs: Readonly<Record<string, string>>;
}

interface ExpressionContext {
  readonly github?: { readonly event_name: string };
  readonly needs?: Readonly<Record<string, NeedResult>>;
  /**
   * Set only when a STEP's `if:` is read: whether an earlier step failed.
   * A job's `if:` has no status to ask about in the model below, so a status
   * function there is refused rather than given a made-up answer.
   */
  readonly stepFailed?: boolean;
}

type Token = { readonly kind: 'punct' | 'string' | 'name'; readonly text: string };

const TOKEN =
  /\s*(?:(!=|==|&&|\|\||[(),!])|'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*(?:\.(?:[A-Za-z_][A-Za-z0-9_-]*|\*))*))/y;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    if (/^\s*$/.test(source.slice(TOKEN.lastIndex))) break;
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(source);
    if (!m) {
      throw new Error(`cannot read \`${source.slice(at).trim()}\` in \`${source.trim()}\``);
    }
    if (m[1] !== undefined) tokens.push({ kind: 'punct', text: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: 'string', text: m[2].replace(/''/g, "'") });
    else tokens.push({ kind: 'name', text: m[3]! });
  }
  return tokens;
}

/** GitHub's truthiness: false, null, '' and 0 are false; every other value is true. */
function truthy(value: unknown): boolean {
  return !(value === false || value === null || value === '' || value === 0);
}

function equal(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  if (a === null && b === null) return true;
  throw new Error(
    `compares ${JSON.stringify(a)} with ${JSON.stringify(b)}. GitHub converts mixed types to ` +
      'numbers before comparing them, which this reader does not model',
  );
}

const STATUS_FUNCTIONS = ['success', 'failure', 'always', 'cancelled'] as const;

function call(name: string, args: ReadonlyArray<unknown>, ctx: ExpressionContext): unknown {
  if ((STATUS_FUNCTIONS as ReadonlyArray<string>).includes(name)) {
    if (ctx.stepFailed === undefined) {
      throw new Error(
        `\`${name}()\` changes when a JOB runs in a way the model in this file does not follow ` +
          '(it assumes the implicit `success()`: a job runs only when everything it needs succeeded)',
      );
    }
    if (name === 'success') return !ctx.stepFailed;
    if (name === 'failure') return ctx.stepFailed;
    if (name === 'always') return true;
    // `cancelled()` depends on whether the whole run was being cancelled,
    // which a recorded `needs` context does not say.
    throw new Error('`cancelled()` depends on whether the run was being cancelled, which is not modelled');
  }
  if (name === 'contains' && args.length === 2) {
    const [search, item] = args;
    if (Array.isArray(search)) return search.some((v: unknown) => equal(v, item));
    if (typeof search === 'string' && typeof item === 'string') {
      return search.toLowerCase().includes(item.toLowerCase());
    }
  }
  if (name === 'toJSON' && args.length === 1) return JSON.stringify(args[0], null, 2);
  throw new Error(`unknown function \`${name}\` with ${args.length} argument(s)`);
}

function lookup(path: string, ctx: ExpressionContext): unknown {
  if (path === 'github.event_name' && ctx.github) return ctx.github.event_name;
  const needs = ctx.needs;
  if (needs) {
    if (path === 'needs') return needs;
    if (path === 'needs.*.result') return Object.values(needs).map((n) => n.result);
    const result = /^needs\.([^.]+)\.result$/.exec(path);
    if (result && needs[result[1]!]) return needs[result[1]!]!.result;
    const output = /^needs\.([^.]+)\.outputs\.([^.]+)$/.exec(path);
    if (output && needs[output[1]!]) {
      const [, job, name] = output as unknown as [string, string, string];
      const declared = Object.keys(workflow.jobs?.[job]?.outputs ?? {});
      if (!declared.includes(name)) {
        throw new Error(`\`${path}\`: ${job} declares no output called ${name} (it has ${declared.join(', ') || 'none'})`);
      }
      // A job that never ran has no outputs, and GitHub reads the missing
      // value as empty — which is what makes `== 'true'` false for it.
      return needs[job]!.outputs[name] ?? '';
    }
  }
  throw new Error(`unknown name \`${path}\` here`);
}

/**
 * Evaluate one expression — with or without its `${{ }}` — the way GitHub would.
 * Throws on anything outside the small language above.
 */
function evaluate(source: string, ctx: ExpressionContext): unknown {
  const body = /^\s*\$\{\{([\s\S]*)\}\}\s*$/.exec(source)?.[1] ?? source;
  const tokens = tokenize(body);
  let i = 0;
  const peek = (): string | undefined => tokens[i]?.text;
  const take = (want?: string): Token => {
    const t = tokens[i++];
    if (!t || (want !== undefined && t.text !== want)) {
      throw new Error(`expected ${want ?? 'more'} in \`${body.trim()}\``);
    }
    return t;
  };

  function or(): unknown {
    let left = and();
    while (peek() === '||') {
      take();
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  }
  function and(): unknown {
    let left = not();
    while (peek() === '&&') {
      take();
      const right = not();
      left = truthy(left) ? right : left;
    }
    return left;
  }
  function not(): unknown {
    if (peek() === '!') {
      take();
      return !truthy(not());
    }
    return compare();
  }
  function compare(): unknown {
    const left = primary();
    const op = peek();
    if (op === '==' || op === '!=') {
      take();
      const same = equal(left, primary());
      return op === '==' ? same : !same;
    }
    return left;
  }
  function primary(): unknown {
    const t = take();
    if (t.kind === 'string') return t.text;
    if (t.kind === 'punct' && t.text === '(') {
      const value = or();
      take(')');
      return value;
    }
    if (t.kind === 'name') {
      if (t.text === 'true') return true;
      if (t.text === 'false') return false;
      if (t.text === 'null') return null;
      if (peek() === '(') {
        take('(');
        const args: unknown[] = [];
        if (peek() !== ')') {
          args.push(or());
          while (peek() === ',') {
            take();
            args.push(or());
          }
        }
        take(')');
        return call(t.text, args, ctx);
      }
      return lookup(t.text, ctx);
    }
    throw new Error(`unexpected \`${t.text}\` in \`${body.trim()}\``);
  }

  const value = or();
  if (i !== tokens.length) throw new Error(`cannot read past \`${peek()}\` in \`${body.trim()}\``);
  return value;
}

/** Substitute every `${{ }}` in a string, as GitHub does for `env:` and `run:`. */
function render(template: string, ctx: ExpressionContext): string {
  return template.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression: string) => {
    const value = evaluate(expression, ctx);
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return String(value);
    if (value === null) return '';
    throw new Error(`\`${expression.trim()}\` would render as an object; GitHub prints that as "Object"`);
  });
}

/**
 * Would this `cancel-in-progress` cancel a running build, for this event?
 *
 * Read with the reader above, given only the event: a condition naming
 * anything else (`github.actor`, `github.ref`) THROWS rather than guessing —
 * see the note on failing closed in the header.
 */
function cancelsFor(flag: boolean | string | undefined, eventName: string): boolean {
  if (typeof flag === 'boolean') return flag;
  if (typeof flag !== 'string') {
    throw new Error(
      `ci.yml has no concurrency.cancel-in-progress (got ${JSON.stringify(flag)}). If the ` +
        'concurrency block was removed, nothing cancels anything and this guard needs ' +
        'rewriting; if it moved, point this at its new home.',
    );
  }
  try {
    return truthy(evaluate(flag, { github: { event_name: eventName } }));
  } catch (e) {
    throw new Error(
      `this guard cannot read the condition \`${flag}\` (${(e as Error).message}). It reads ` +
        'literals, `github.event_name` and the comparisons and logic between them, and it ' +
        'refuses to guess at anything else rather than pass over a condition nobody has ' +
        'checked. Widen the reader in the same change that widened the workflow.',
      { cause: e },
    );
  }
}

describe('a superseded push build is finished, not cancelled', () => {
  const flag = workflow.concurrency?.['cancel-in-progress'];

  it('holds for EVERY workflow, not just the one this started with', () => {
    // #1056 fixed ci.yml and named only ci.yml, which is the shape
    // `a-doc-a-test-reads-that-ci-skipped` was rewritten to stop repeating: a
    // guard that knows one file cannot notice the second. security-scan.yml
    // was the second, and it was worse in one way — its `group` keys on
    // `github.ref`, which is `refs/heads/main` for a push, for the Monday
    // `schedule` AND for a dispatch, so an ordinary merge cancelled the weekly
    // CVE sweep and the next one was seven days out.
    //
    // A `schedule` run is the sharpest case anywhere: it exists to scan code
    // that has NOT changed, so nothing about a later run replaces it.
    const withConcurrency = workflows().filter((w) => w.concurrency !== undefined);
    expect(
      withConcurrency.length,
      'no workflow declares a concurrency block, which is not what this directory looks like — ' +
        'the scan is broken and every assertion below is passing over an empty list',
    ).toBeGreaterThan(3);

    const cancelled = withConcurrency.flatMap((w) =>
      (['push', 'schedule'] as const)
        .filter((event) => cancelsFor(w.concurrency?.['cancel-in-progress'], event))
        .map((event) => `${w.file} cancels a running ${event} build`),
    );
    expect(
      cancelled,
      'these cancel a build that nothing will re-run. A push build is testing a commit that is ' +
        'already on the branch, and a scheduled build is the only one that will happen that ' +
        'week. Condition `cancel-in-progress` on the event, the way ci.yml, images.yml and ' +
        'security-scan.yml do.',
    ).toEqual([]);
  });

  it('does not ask for a running push build to be cancelled', () => {
    // NAMED FOR WHAT IT ASSERTS. This said "never cancels a push build,
    // whatever lands on main behind it" until 2026-09-22, which claimed an
    // EFFECT this setting does not deliver: GitHub holds one run pending per
    // group, and a newer arrival cancels the one in that slot regardless of
    // this flag. What the flag governs is the run HOLDING the group, and that
    // is worth having — run 2850 outlived three merges landing behind it. See
    // the measurement in ci.yml's concurrency comment.
    expect(
      cancelsFor(flag, 'push'),
      'ci.yml asks for a running push build to be cancelled. The commit it was testing is ' +
        'already IN main, and the next push computes its own diff — so nothing re-runs the ' +
        'gates for the code the cancelled build carried, and a later docs-only merge reports ' +
        'green over it. That is run 2841 against run 2843 on 2026-09-21. Condition ' +
        '`cancel-in-progress` on the event instead of setting it true.',
    ).toBe(false);
  });

  it('still cancels a superseded pull request build', () => {
    expect(
      cancelsFor(flag, 'pull_request'),
      'ci.yml no longer cancels superseded pull request builds. Nothing is unsafe about that, ' +
        'but it is waste this repository had already decided against: the older commit is not ' +
        'what will merge. If it was deliberate, delete this test and say why.',
    ).toBe(true);
  });

  it('keeps pull request and push builds in different groups', () => {
    // The other half of the mechanism. One bucket for both events would let a
    // pull request cancel a push build while the test above still passed.
    expect(
      workflow.concurrency?.group ?? '',
      'the concurrency group no longer varies with github.ref, so pull request and push builds ' +
        'share one bucket and can cancel each other regardless of the flag above',
    ).toContain('github.ref');
  });
});

// ── The second half: what `ci-complete` makes of a gate that never ran ─────

const AGGREGATOR = 'ci-complete';
const jobs = workflow.jobs ?? {};

function needsOf(job: Job | undefined): ReadonlyArray<string> {
  const needs = job?.needs;
  if (needs === undefined) return [];
  return typeof needs === 'string' ? [needs] : needs;
}

const aggregator = jobs[AGGREGATOR];
if (!aggregator) {
  throw new Error(`ci.yml has no \`${AGGREGATOR}\` job — the second half of this file has nothing to hold`);
}
/** The gates `ci-complete` judges, in the order its `needs` lists them. */
const GATES = needsOf(aggregator);

/** One way a run can begin: an event, and what each gate's outputs said. */
interface Scenario {
  readonly event: string;
  readonly outputs: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * Every combination of event and declared output.
 *
 * The events are the workflow's own `on:` keys. The outputs are every output
 * a gate declares, each `'true'` or `'false'`: today that is
 * `detect-changes`' two `any_changed` flags, which tj-actions/changed-files
 * sets to exactly those two strings. An output that could carry anything else
 * would need its values named here.
 */
function scenarios(): ReadonlyArray<Scenario> {
  let all: Scenario[] = Object.keys(workflow.on ?? {}).map((event) => ({ event, outputs: {} }));
  for (const gate of GATES) {
    for (const output of Object.keys(jobs[gate]?.outputs ?? {})) {
      all = all.flatMap((s) =>
        ['true', 'false'].map((value) => ({
          event: s.event,
          outputs: { ...s.outputs, [gate]: { ...s.outputs[gate], [output]: value } },
        })),
      );
    }
  }
  return all;
}

function describeScenario(s: Scenario): string {
  const flags = Object.entries(s.outputs).flatMap(([job, o]) =>
    Object.entries(o).map(([k, v]) => `${job}.${k}=${v}`),
  );
  return [s.event, ...flags].join(', ');
}

/**
 * Should this job run, in this scenario, by its OWN definition?
 *
 * GitHub's rule, and the only one ci.yml uses: a job runs when everything in
 * its `needs` succeeded (the `success()` GitHub puts in front of every `if:`
 * that names no status function) and its `if:`, if it has one, is true. So
 * `ui-tests`, which has no `if:` and needs `lint`, runs exactly when `lint`
 * does. A status function in a job's `if:` would change that rule, and the
 * reader refuses it rather than pretend.
 */
function shouldRun(name: string, s: Scenario, path: ReadonlyArray<string> = []): boolean {
  if (path.includes(name)) throw new Error(`ci.yml's needs go round in a circle: ${[...path, name].join(' -> ')}`);
  const job = jobs[name];
  if (!job) throw new Error(`\`${path.at(-1) ?? AGGREGATOR}\` needs \`${name}\`, which ci.yml does not define`);
  const needs = needsOf(job);
  if (!needs.every((n) => shouldRun(n, s, [...path, name]))) return false;
  if (job.if === undefined) return true;
  const ctx: ExpressionContext = {
    github: { event_name: s.event },
    needs: Object.fromEntries(needs.map((n) => [n, { result: 'success', outputs: s.outputs[n] ?? {} }])),
  };
  try {
    return truthy(evaluate(String(job.if), ctx));
  } catch (e) {
    throw new Error(`cannot read ${name}'s \`if: ${String(job.if)}\`: ${(e as Error).message}`, { cause: e });
  }
}

/** `needs` as GitHub would hand it to `ci-complete` if every gate did exactly what it should. */
function asDefined(s: Scenario): Record<string, NeedResult> {
  return Object.fromEntries(
    GATES.map((g) => [
      g,
      shouldRun(g, s) ? { result: 'success', outputs: s.outputs[g] ?? {} } : { result: 'skipped', outputs: {} },
    ]),
  );
}

const scratch = mkdtempSync(join(tmpdir(), 'ci-complete-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Verdict {
  readonly failed: boolean;
  /** How many `run:` steps actually executed — a simulation that ran none proves nothing. */
  readonly ran: number;
  readonly log: string;
}

/**
 * Run `ci-complete`'s steps as GitHub would, given this event and this `needs`.
 *
 * Each step's `if:` is read (a step with none, or one naming no status
 * function, gets GitHub's implicit `success()`); its `env:` — the job's, then
 * its own — is rendered; and its `run:` goes to bash the way the runner
 * invokes a step with no `shell:`, `bash -e <file>`, with GITHUB_STEP_SUMMARY
 * pointing at a scratch file. The job fails when a step that ran exits
 * non-zero. A `uses:` step cannot be run here and is refused.
 */
function runCiComplete(event: string, needs: Readonly<Record<string, NeedResult>>): Verdict {
  let failed = false;
  let ran = 0;
  const log: string[] = [];
  const summary = join(scratch, `summary-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(summary, '');
  for (const [index, step] of (aggregator!.steps ?? []).entries()) {
    const label = step.name ?? `step ${index + 1}`;
    const ctx: ExpressionContext = { github: { event_name: event }, needs, stepFailed: failed };
    if (step.if !== undefined) {
      const condition = String(step.if);
      const named = STATUS_FUNCTIONS.some((f) => new RegExp(`\\b${f}\\s*\\(`).test(condition));
      const holds = truthy(evaluate(condition, ctx));
      if (!(named ? holds : !failed && holds)) {
        log.push(`[${label}] skipped by its if: ${condition}`);
        continue;
      }
    } else if (failed) {
      log.push(`[${label}] skipped: an earlier step failed`);
      continue;
    }
    if (step.uses !== undefined || step.run === undefined) {
      throw new Error(
        `${AGGREGATOR}'s step "${label}" is not a \`run:\` step, and this guard runs only those. ` +
          'If it now needs an action, widen runCiComplete in the same change.',
      );
    }
    if (step.shell !== undefined && step.shell !== 'bash') {
      throw new Error(`${AGGREGATOR}'s step "${label}" runs under ${step.shell}; this guard runs bash`);
    }
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...aggregator!.env, ...step.env })) {
      env[key] = render(String(value), ctx);
    }
    const file = join(scratch, `step-${Math.random().toString(36).slice(2)}.sh`);
    writeFileSync(file, render(step.run, ctx));
    const r = spawnSync('bash', ['-e', file], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: scratch, ...env, GITHUB_STEP_SUMMARY: summary },
    });
    ran += 1;
    log.push(`[${label}] exit ${r.status ?? r.signal}\n${r.stdout}${r.stderr}`);
    if (r.status !== 0 && step['continue-on-error'] !== true) failed = true;
  }
  return { failed, ran, log: log.join('\n') };
}

/** A gate's result as a run's `ci-complete` log printed it; outputs only where there were any. */
type RecordedNeed = string | readonly [result: string, outputs: Readonly<Record<string, string>>];

interface Recorded {
  /** run id / attempt, as the Actions UI and API name it. */
  readonly run: string;
  readonly event: string;
  readonly what: string;
  readonly needs: Readonly<Record<string, RecordedNeed>>;
}

const changed = (any: string, migrations: string): Readonly<Record<string, string>> => ({
  any_changed: any,
  migrations_changed: migrations,
});

/**
 * Runs where a gate that should have run did not pass, copied from the
 * `RESULTS:` each run's `ci-complete` printed. Every one of these must FAIL.
 * All but the last reported success on 2026-10-05.
 */
const MUST_FAIL: ReadonlyArray<Recorded> = [
  {
    run: '37364709044/1',
    event: 'pull_request',
    what: 'four gates never got a runner; two unit-tests shards passed and two never started',
    needs: {
      'detect-changes': ['success', changed('true', 'false')],
      'commit-convention': 'abandoned',
      'docs-hygiene': 'success',
      'fixture-uuid-check': 'abandoned',
      'migration-lint': 'skipped',
      lint: 'abandoned',
      'unit-tests': 'abandoned',
      'ui-tests': 'skipped',
      'integration-tests': 'skipped',
    },
  },
  {
    run: '37371577511/1',
    event: 'pull_request',
    what: 'commit-convention, lint and every unit-tests shard never got a runner',
    needs: {
      'detect-changes': ['success', changed('true', 'false')],
      'commit-convention': 'abandoned',
      'docs-hygiene': 'success',
      'fixture-uuid-check': 'success',
      'migration-lint': 'skipped',
      lint: 'abandoned',
      'unit-tests': 'abandoned',
      'ui-tests': 'skipped',
      'integration-tests': 'skipped',
    },
  },
  {
    run: '37373154965/1',
    event: 'pull_request',
    what: 'detect-changes never got a runner, so everything it gates was skipped as if docs-only',
    needs: {
      'detect-changes': 'abandoned',
      'commit-convention': 'abandoned',
      'docs-hygiene': 'success',
      'fixture-uuid-check': 'success',
      'migration-lint': 'skipped',
      lint: 'skipped',
      'unit-tests': 'skipped',
      'ui-tests': 'skipped',
      'integration-tests': 'skipped',
    },
  },
  {
    run: '37366193208/2',
    event: 'pull_request',
    what: 'a re-run of failed jobs, in which lint and two unit-tests shards never got a runner',
    needs: {
      'detect-changes': ['success', changed('true', 'false')],
      'commit-convention': 'success',
      'docs-hygiene': 'success',
      'fixture-uuid-check': 'success',
      'migration-lint': 'skipped',
      lint: 'abandoned',
      'unit-tests': 'abandoned',
      'ui-tests': 'skipped',
      'integration-tests': 'skipped',
    },
  },
  {
    run: '37373278333/1',
    event: 'pull_request',
    what: 'cancelled by a newer push to the branch — red on the day, and must stay red',
    needs: {
      'detect-changes': ['success', changed('true', 'false')],
      'commit-convention': 'success',
      'docs-hygiene': 'success',
      'fixture-uuid-check': 'success',
      'migration-lint': 'skipped',
      lint: 'success',
      'unit-tests': 'cancelled',
      'ui-tests': 'cancelled',
      'integration-tests': 'cancelled',
    },
  },
];

/** Green runs recorded the same way, every gate having done what it should. Every one must PASS. */
const MUST_PASS: ReadonlyArray<Recorded> = [
  {
    run: '37341703144/1',
    event: 'pull_request',
    what: 'a docs-only pull request',
    needs: {
      'detect-changes': ['success', changed('false', 'false')],
      'commit-convention': 'success',
      'docs-hygiene': 'success',
      'fixture-uuid-check': 'success',
      'migration-lint': 'skipped',
      lint: 'skipped',
      'unit-tests': 'skipped',
      'ui-tests': 'skipped',
      'integration-tests': 'skipped',
    },
  },
  {
    run: '37359980804/1',
    event: 'pull_request',
    what: 'a pull request that changed code, every gate green',
    needs: {
      'detect-changes': ['success', changed('true', 'false')],
      'commit-convention': 'success',
      'docs-hygiene': 'success',
      'fixture-uuid-check': 'success',
      'migration-lint': 'skipped',
      lint: 'success',
      'unit-tests': 'success',
      'ui-tests': 'success',
      'integration-tests': 'success',
    },
  },
  {
    run: '37306264122/1',
    event: 'pull_request',
    what: 'a pull request that changed ci.yml, so migration-lint ran too',
    needs: {
      'detect-changes': ['success', changed('true', 'true')],
      'commit-convention': 'success',
      'docs-hygiene': 'success',
      'fixture-uuid-check': 'success',
      'migration-lint': 'success',
      lint: 'success',
      'unit-tests': 'success',
      'ui-tests': 'success',
      'integration-tests': 'success',
    },
  },
  {
    run: '37376370658/1',
    event: 'push',
    what: 'a docs-only push to main, where commit-convention does not run',
    needs: {
      'detect-changes': ['success', changed('false', 'false')],
      'commit-convention': 'skipped',
      'docs-hygiene': 'success',
      'fixture-uuid-check': 'success',
      'migration-lint': 'skipped',
      lint: 'skipped',
      'unit-tests': 'skipped',
      'ui-tests': 'skipped',
      'integration-tests': 'skipped',
    },
  },
  {
    run: '37355582558/1',
    event: 'push',
    what: 'a push to main that changed code, every gate green',
    needs: {
      'detect-changes': ['success', changed('true', 'false')],
      'commit-convention': 'skipped',
      'docs-hygiene': 'success',
      'fixture-uuid-check': 'success',
      'migration-lint': 'skipped',
      lint: 'success',
      'unit-tests': 'success',
      'ui-tests': 'success',
      'integration-tests': 'success',
    },
  },
];

/**
 * A recording as `needs` for TODAY's `ci-complete`.
 *
 * The recordings stay as they were printed. A gate added to ci.yml since did
 * not exist then, so it is filled in with what its own definition says it
 * would have done in that run — `success` if it should have run, `skipped`
 * if not — and a gate since removed is dropped. Neither can turn a failing
 * recording green: the gates that did not pass are still in it.
 */
function asToday(r: Recorded): Record<string, NeedResult> {
  const recorded = Object.fromEntries(
    Object.entries(r.needs).map(([job, need]) => [
      job,
      typeof need === 'string' ? { result: need, outputs: {} } : { result: need[0], outputs: need[1] },
    ]),
  );
  const s: Scenario = {
    event: r.event,
    outputs: Object.fromEntries(Object.entries(recorded).map(([job, n]) => [job, n.outputs])),
  };
  return Object.fromEntries(
    GATES.map((g) => [
      g,
      recorded[g] ?? (shouldRun(g, s) ? { result: 'success', outputs: {} } : { result: 'skipped', outputs: {} }),
    ]),
  );
}

/**
 * What GitHub has reported, or might, for a job that did not pass: the four
 * values it documents, the one it actually used on 2026-10-05, an empty
 * value, and one nobody has seen yet. The point of the rule is that the list
 * does not matter.
 */
const NOT_SUCCESS = ['skipped', 'cancelled', 'failure', 'abandoned', '', 'a-result-github-has-not-invented-yet'];

describe('a gate that never ran is not passed', () => {
  const all = scenarios();

  it('has a definition to hold ci-complete to', () => {
    // The vacuity guard. Every "must pass" below passes trivially if nothing
    // runs, and every "must fail" is meaningless if no gate is ever expected.
    expect(GATES.length, `${AGGREGATOR} needs almost nothing — check the path`).toBeGreaterThan(5);
    expect(all.length, 'no scenarios: ci.yml has no `on:` events, or they failed to parse').toBeGreaterThanOrEqual(4);
    const sometimes = GATES.filter((g) => all.some((s) => shouldRun(g, s)) && all.some((s) => !shouldRun(g, s)));
    expect(
      sometimes,
      'no gate runs in some scenarios and not in others, so the conditions were not read',
    ).toEqual(expect.arrayContaining(['lint', 'unit-tests', 'commit-convention', 'migration-lint']));
    const v = runCiComplete('pull_request', asDefined(all[0]!));
    expect(v.ran, `${AGGREGATOR} executed no step:\n${v.log}`).toBeGreaterThan(0);
  });

  it('FAILS every recorded run in which a gate that should have run did not pass', () => {
    const called = MUST_FAIL.flatMap((r) => {
      const v = runCiComplete(r.event, asToday(r));
      return v.failed ? [] : [`${r.run} (${r.what}) — ${AGGREGATOR} reported success:\n${v.log}`];
    });
    expect(
      called,
      `${AGGREGATOR} passes runs whose gates did not pass. It must fail whenever a gate that ` +
        "should have run did not end in 'success', whatever GitHub calls what happened instead — " +
        "on 2026-10-05 it called a job that never got a runner 'abandoned', which no list of " +
        'failure words included.',
    ).toEqual([]);
  });

  it('PASSES every recorded run in which each gate did what it should', () => {
    const refused = MUST_PASS.flatMap((r) => {
      const v = runCiComplete(r.event, asToday(r));
      return v.failed ? [`${r.run} (${r.what}) — ${AGGREGATOR} failed:\n${v.log}`] : [];
    });
    expect(
      refused,
      `${AGGREGATOR} fails runs that were green, which is hard rule 10's lie: a docs-only change ` +
        'and the jobs one event does not run are not failures.',
    ).toEqual([]);
  });

  it('PASSES a run in which every gate did exactly what its own `if:` and `needs:` ask, for every event and change', () => {
    const refused = all.flatMap((s) => {
      const v = runCiComplete(s.event, asDefined(s));
      return v.failed ? [`${describeScenario(s)}:\n${v.log}`] : [];
    });
    expect(
      refused,
      `${AGGREGATOR}'s idea of which gates should run differs from the gates' own conditions. ` +
        `Make ${AGGREGATOR}'s expectation for each job match that job's \`if:\` and \`needs:\`.`,
    ).toEqual([]);
  });

  /**
   * Run `ci-complete` with ONE gate's result replaced, for every gate whose
   * defined result is `defined` and in every scenario where it is.
   *
   * Each gate meets every value in the first scenario where it applies, and
   * in the rest the two that matter most. `abandoned`, the word GitHub used on
   * 2026-10-05. And `skipped`, because it is the one value `ci-complete`
   * accepts from a gate it thinks had no reason to run — so it is what tells
   * this sweep, in EVERY scenario, that `ci-complete` and the gate's own
   * `if:` disagree. (Trying only `abandoned` beyond the first scenario let a
   * commit-convention widened to push events through: the mutation check
   * that wrote this sentence.) Every value everywhere is several hundred bash
   * runs for no further assertion.
   */
  function sweep(defined: 'success' | 'skipped', values: ReadonlyArray<string>) {
    const passed: string[] = [];
    const tried = new Set<string>();
    for (const gate of GATES) {
      let first = true;
      for (const s of all) {
        const needs = asDefined(s);
        if (needs[gate]!.result !== defined) continue;
        for (const result of first ? values : values.filter((v) => v === 'skipped' || v === 'abandoned')) {
          const v = runCiComplete(s.event, { ...needs, [gate]: { result, outputs: {} } });
          if (!v.failed) passed.push(`${describeScenario(s)}: ${gate} = ${JSON.stringify(result)}`);
        }
        tried.add(gate);
        first = false;
      }
    }
    return { passed, tried };
  }

  it('FAILS when any gate that should have run reports anything but success', { timeout: 60_000 }, () => {
    const { passed, tried } = sweep('success', NOT_SUCCESS);
    expect([...tried].sort(), 'some gate is never expected to run in any scenario').toEqual([...GATES].sort());
    expect(
      passed,
      `${AGGREGATOR} reports success although a gate that should have run did not pass. Add the ` +
        `job, or correct its condition, in ${AGGREGATOR}'s expectation; and fail on anything ` +
        "that is not 'success' rather than on a list of failure words.",
    ).toEqual([]);
  });

  it('FAILS when a gate that had no reason to run reports anything but skipped', { timeout: 60_000 }, () => {
    // A job that should not have run and says it failed, or was abandoned, is
    // a result nothing explains — and an unexplained result is not a pass.
    const { passed, tried } = sweep(
      'skipped',
      NOT_SUCCESS.filter((r) => r !== 'skipped'),
    );
    expect(tried.size, 'no gate is ever skipped by its own condition — the conditions were not read').toBeGreaterThan(0);
    expect(passed, `${AGGREGATOR} reports success over a result nothing explains`).toEqual([]);
  });
});
