// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MERGE THAT RAN BESIDE THE SOCKET: every push to `main` ran CI on the self-hosted runner, which
 * holds the Docker socket of the machine live and its testers' credentials are on (workplan 0132,
 * open question 1).
 *
 * Until 2026-11-08 every push to `main` ran the jobs of `.github/workflows/ci.yml` and
 * `.github/workflows/security-scan.yml` on the self-hosted runner. That runner holds the Docker
 * socket of the machine that runs `ownpace-live`, and from the first invitation live stores
 * testers' credentials. So every merge ran there at once, `pnpm install`'s lifecycle scripts
 * included, with whatever the merged change or a dependency it pulled in brought along: the path
 * workplan 0132 §4 calls a copy held by code, not by people. Open question 1 asked whether to move
 * the push jobs to GitHub's hosted runners for the alpha's weeks. The owner's answer, 2026-11-08:
 * yes, for every job that does not need the machine. None of these does.
 *
 * So a push runs them on GitHub's hosted arm64 runner, `ubuntu-24.04-arm`, the architecture live
 * runs on. ONE SWITCH TURNS IT BACK: the repository variable `CI_PUSH_ON_SELF_HOSTED`. Unset, or
 * anything but `true`, the push jobs stay on GitHub's runner; `true` sends them to the self-hosted
 * runner, as before. The nightlies that need the machine (`e2e.yml`, `e2e-managed.yml`,
 * `e2e-live-target.yml`) run `main` there on their schedules, as they did.
 *
 * ## What this holds
 *
 * Each by EVALUATING the workflows' own expressions, for every event, every ref a push trigger
 * admits and both states of the switch, so it holds what the files do and not how they spell it:
 *
 *  1. While the switch is on, nothing a push starts runs on the self-hosted runner, in any
 *     workflow: every leg of every job a push can start resolves to a GitHub-hosted runner.
 *  2. The jobs that ran on the machine take `ubuntu-24.04-arm` for a push to main, and the one
 *     variable set to `true` sends every one of them back to `self-hosted`. Turning it back after
 *     the alpha is that variable, not an edit.
 *  3. The switch moves nothing else: a pull request, the schedule, a dispatch and every other
 *     workflow resolve to the same runners in both states.
 *  4. A pull request never reaches the self-hosted runner, in any workflow, and no event but a
 *     push takes ci.yml's or security-scan.yml's jobs there, whatever the variable says. A
 *     dispatch runs a branch's code, and nobody has to have merged it.
 *  5. While the switch is on, a dispatch on a branch runs what a push to main runs, the same legs
 *     on the same runners (security-scan.yml's with `push_runner`, as its proof dispatch is sent),
 *     so a branch proves the push path before it merges. Its own pull request run cannot: that
 *     runs on the pull request's runners.
 *  6. Both workflows' headers name the switch, where somebody turning it back will look.
 *
 * ## How a job is read
 *
 * A job can run for an event when its `if:` can be true there (a condition it cannot decide, such
 * as another job's output, counts as yes) and every job it needs can run, unless its `if:` asks
 * for a status of its own. Where it runs is its `runs-on`, through its matrix where it names one:
 * a literal list, an expression, `include` and `exclude`. A runner is GitHub-hosted when it is one
 * label naming one of GitHub's images (`ubuntu-24.04`, `ubuntu-24.04-arm`, `windows-2025`).
 *
 * IT FAILS CLOSED. The evaluator below tracks every value an expression can take. A name it is not
 * given (another job's output, a variable other than the switch) can be anything, so a `runs-on`
 * that reads one can be the self-hosted runner, and is a failure; syntax it does not know throws.
 * A guard that shrugs at what it cannot read is the green tick over an unknown runner it exists to
 * prevent. Each failure below is proven by a mutation of the real files that must produce it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIR = join(ROOT, '.github/workflows');

/** The repository variable that turns the push jobs back to the self-hosted runner. */
const SWITCH = 'CI_PUSH_ON_SELF_HOSTED';
/** What the push jobs take while the switch is on. */
const PUSH_RUNNER = 'ubuntu-24.04-arm';
/** The jobs that ran on the machine for a push to main until 2026-11-08, by file. */
const MOVED: Readonly<Record<string, ReadonlyArray<string>>> = {
  'ci.yml': ['detect-changes', 'docs-hygiene', 'fixture-uuid-check', 'migration-lint', 'lint', 'unit-tests', 'ui-tests', 'integration-tests'],
  'security-scan.yml': ['security-scan'],
};
/** The inputs security-scan.yml's proof dispatch is sent with: the push's runner, no image legs. */
const PROOF_INPUTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'ci.yml': {},
  'security-scan.yml': { push_runner: true, image_scans: false },
};
/** The switch's states. Unset and `false` are on; `true` turns the push jobs back. */
const ON: ReadonlyArray<{ readonly label: string; readonly value: string | null }> = [
  { label: `${SWITCH} unset`, value: null },
  { label: `${SWITCH}=false`, value: 'false' },
];
const OFF = { label: `${SWITCH}=true`, value: 'true' } as const;

// ── The workflows ────────────────────────────────────────────────────────────

interface Job {
  readonly name?: unknown;
  readonly 'runs-on'?: unknown;
  readonly if?: unknown;
  readonly needs?: unknown;
  readonly strategy?: { readonly matrix?: unknown };
}

interface Workflow {
  readonly file: string;
  readonly text: string;
  readonly on: Readonly<Record<string, unknown>>;
  readonly jobs: Readonly<Record<string, Job>>;
}

function parseWorkflow(file: string, text: string): Workflow {
  const doc = parseYaml(text) as { on?: unknown; jobs?: Record<string, Job> } | null;
  const on = doc?.on;
  const triggers: Record<string, unknown> =
    typeof on === 'string' ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map((e: string) => [e, null])) : ((on as Record<string, unknown> | undefined) ?? {});
  return { file, text, on: triggers, jobs: doc?.jobs ?? {} };
}

function readWorkflows(): ReadonlyArray<Workflow> {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((file) => parseWorkflow(file, readFileSync(join(WORKFLOW_DIR, file), 'utf8')));
}

// ── A reader for GitHub's expressions that keeps every value they can take ──
//
// A value is a JSON value or one of three unknowns: anything, something falsy, something truthy.
// `a && b` with an unknown `a` is either that falsy `a` or `b`; `a || b` is either that truthy `a`
// or `b`. So `matrix.context && 'ubuntu-24.04-arm' || 'ubuntu-24.04'`, with nothing known about the
// matrix, is exactly one of the two labels, and `vars.OTHER == 'true' && 'self-hosted' || ...` is
// either, which is how a runner that reads an unknown name fails. Strings compare without regard to
// case, as GitHub's do; mixed types compare as numbers.

const ANY = Symbol('any');
const FALSY = Symbol('falsy');
const TRUTHY = Symbol('truthy');
type Unknown = typeof ANY | typeof FALSY | typeof TRUTHY;
type Value = string | number | boolean | null | readonly unknown[] | { readonly [key: string]: unknown } | Unknown;

const isUnknown = (v: Value): v is Unknown => v === ANY || v === FALSY || v === TRUTHY;

type Node =
  | { readonly kind: 'literal'; readonly value: Value }
  | { readonly kind: 'name'; readonly path: string }
  | { readonly kind: 'call'; readonly name: string; readonly args: ReadonlyArray<Node> }
  | { readonly kind: 'not'; readonly arg: Node }
  | { readonly kind: 'and' | 'or' | '==' | '!='; readonly left: Node; readonly right: Node };

const TOKEN = /\s*(?:(!=|==|&&|\|\||[(),!])|'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_-]*(?:\.(?:[A-Za-z_][A-Za-z0-9_-]*|\*))*))/y;

function parseExpression(source: string): Node {
  const tokens: Array<{ kind: 'punct' | 'string' | 'number' | 'name'; text: string }> = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length && !/^\s*$/.test(source.slice(TOKEN.lastIndex))) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(source);
    if (!m) throw new Error(`cannot read \`${source.slice(at).trim()}\` in \`${source.trim()}\``);
    if (m[1] !== undefined) tokens.push({ kind: 'punct', text: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: 'string', text: m[2].replace(/''/g, "'") });
    else if (m[3] !== undefined) tokens.push({ kind: 'number', text: m[3] });
    else tokens.push({ kind: 'name', text: m[4]! });
  }
  let i = 0;
  const peek = () => tokens[i]?.text;
  const take = (want?: string) => {
    const t = tokens[i++];
    if (!t || (want !== undefined && t.text !== want)) throw new Error(`expected ${want ?? 'more'} in \`${source.trim()}\``);
    return t;
  };
  const or = (): Node => {
    let left = and();
    while (peek() === '||') {
      take();
      left = { kind: 'or', left, right: and() };
    }
    return left;
  };
  const and = (): Node => {
    let left = not();
    while (peek() === '&&') {
      take();
      left = { kind: 'and', left, right: not() };
    }
    return left;
  };
  const not = (): Node => {
    if (peek() === '!') {
      take();
      return { kind: 'not', arg: not() };
    }
    return compare();
  };
  const compare = (): Node => {
    const left = primary();
    const op = peek();
    if (op === '==' || op === '!=') {
      take();
      return { kind: op, left, right: primary() };
    }
    return left;
  };
  const primary = (): Node => {
    const t = take();
    if (t.kind === 'string') return { kind: 'literal', value: t.text };
    if (t.kind === 'number') return { kind: 'literal', value: Number(t.text) };
    if (t.kind === 'punct' && t.text === '(') {
      const inner = or();
      take(')');
      return inner;
    }
    if (t.kind === 'name') {
      if (t.text === 'true' || t.text === 'false') return { kind: 'literal', value: t.text === 'true' };
      if (t.text === 'null') return { kind: 'literal', value: null };
      if (peek() === '(') {
        take('(');
        const args: Node[] = [];
        if (peek() !== ')') {
          args.push(or());
          while (peek() === ',') {
            take();
            args.push(or());
          }
        }
        take(')');
        return { kind: 'call', name: t.text, args };
      }
      return { kind: 'name', path: t.text };
    }
    throw new Error(`unexpected \`${t.text}\` in \`${source.trim()}\``);
  };
  const node = or();
  if (i !== tokens.length) throw new Error(`cannot read past \`${peek()}\` in \`${source.trim()}\``);
  return node;
}

/** What is known when an expression is read: named values, and `undefined` for what is not. */
interface Context {
  readonly github: Readonly<Record<string, string>>;
  readonly vars: Readonly<Record<string, string | null>>;
  readonly inputs: Readonly<Record<string, unknown>>;
  /** The leg's matrix values, `{}` for a job with none, `ANY` while the matrix is unknown. */
  readonly matrix: Readonly<Record<string, unknown>> | typeof ANY;
}

/** The contexts GitHub offers a job's `if:`, `runs-on`, `name:` and `strategy:`; nothing else exists. */
const CONTEXTS = new Set(['github', 'vars', 'inputs', 'matrix', 'needs', 'strategy', 'secrets', 'env', 'runner', 'job', 'steps']);

function lookup(path: string, ctx: Context): Value {
  const [root, ...rest] = path.split('.');
  if (!CONTEXTS.has(root!)) throw new Error(`\`${path}\` names no context GitHub offers here`);
  const key = rest.join('.');
  if (root === 'github') return key in ctx.github ? ctx.github[key]! : ANY;
  if (root === 'vars') return key === SWITCH ? (ctx.vars[key] ?? null) : ANY;
  if (root === 'inputs') return rest.length === 1 ? ((ctx.inputs[key] as Value | undefined) ?? null) : ANY;
  if (root === 'matrix') {
    if (ctx.matrix === ANY || rest.length !== 1) return ANY;
    return (ctx.matrix[key] as Value | undefined) ?? null;
  }
  return ANY; // needs, steps, env, runner, ...: not known when a job is placed
}

/** GitHub's truthiness, with unknowns kept as such. */
function truth(v: Value): boolean | 'unknown' {
  if (v === TRUTHY) return true;
  if (v === FALSY) return false;
  if (v === ANY) return 'unknown';
  return !(v === false || v === null || v === '' || v === 0 || (typeof v === 'number' && Number.isNaN(v)));
}

function asNumber(v: Value): number {
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? 0 : Number(v);
  return Number.NaN;
}

/** GitHub's `==`: case-insensitive strings, otherwise both sides as numbers; objects by identity. */
function looseEqual(a: Value, b: Value): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a === 'object' && a !== null) return a === b;
  if (typeof b === 'object' && b !== null) return false;
  if (a === null && b === null) return true;
  if (typeof a === typeof b) return a === b;
  return asNumber(a) === asNumber(b);
}

const keyOf = (v: Value): string => (v === ANY ? '\0any' : v === FALSY ? '\0falsy' : v === TRUTHY ? '\0truthy' : `${typeof v}:${JSON.stringify(v)}`);

function distinct(values: Iterable<Value>): Value[] {
  const seen = new Map<string, Value>();
  for (const v of values) seen.set(keyOf(v), v);
  if (seen.size > 256) throw new Error('an expression with more than 256 possible values: read it by hand');
  return [...seen.values()];
}

function product(sets: ReadonlyArray<ReadonlyArray<Value>>): Value[][] {
  let out: Value[][] = [[]];
  for (const set of sets) out = out.flatMap((prefix) => set.map((v): Value[] => [...prefix, v]));
  return out;
}

const asText = (v: Value): string => (typeof v === 'string' ? v : v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function call(name: string, args: ReadonlyArray<Value>): Value {
  if (name === 'always') return true;
  if (['success', 'failure', 'cancelled', 'hashFiles'].includes(name)) return ANY;
  if (args.some(isUnknown)) return ANY;
  if (name === 'fromJSON' && args.length === 1 && typeof args[0] === 'string') return JSON.parse(args[0]) as Value;
  if (name === 'toJSON' && args.length === 1) return JSON.stringify(args[0]);
  if ((name === 'startsWith' || name === 'endsWith') && args.length === 2) {
    const [s, p] = args.map((a) => asText(a!).toLowerCase()) as [string, string];
    return name === 'startsWith' ? s.startsWith(p) : s.endsWith(p);
  }
  if (name === 'contains' && args.length === 2) {
    const [hay, needle] = args as [Value, Value];
    if (Array.isArray(hay)) return hay.some((h) => looseEqual(h as Value, needle));
    return asText(hay).toLowerCase().includes(asText(needle).toLowerCase());
  }
  if (name === 'format' && args.length >= 1) {
    return asText(args[0]!).replace(/\{(\d+)\}/g, (_, n: string) => asText(args[Number(n) + 1] ?? ''));
  }
  throw new Error(`\`${name}()\` with ${args.length} argument(s) is not a function this guard knows`);
}

function evaluateNode(node: Node, ctx: Context): Value[] {
  switch (node.kind) {
    case 'literal':
      return [node.value];
    case 'name':
      return [lookup(node.path, ctx)];
    case 'call':
      return distinct(product(node.args.map((a) => evaluateNode(a, ctx))).map((args) => call(node.name, args)));
    case 'not':
      return distinct(evaluateNode(node.arg, ctx).flatMap((v) => {
        const t = truth(v);
        return t === 'unknown' ? [true, false] : [!t];
      }));
    case '==':
    case '!=': {
      const out: Value[] = [];
      for (const [a, b] of product([evaluateNode(node.left, ctx), evaluateNode(node.right, ctx)])) {
        if (isUnknown(a!) || isUnknown(b!)) out.push(true, false);
        else out.push(looseEqual(a!, b!) === (node.kind === '=='));
      }
      return distinct(out);
    }
    case 'and':
    case 'or': {
      const out: Value[] = [];
      let right: Value[] | undefined;
      const rightValues = () => (right ??= evaluateNode(node.right, ctx));
      for (const v of evaluateNode(node.left, ctx)) {
        const t = truth(v);
        if (node.kind === 'and') {
          if (t === true) out.push(...rightValues());
          else if (t === false) out.push(v);
          else out.push(FALSY, ...rightValues());
        } else if (t === true) out.push(v);
        else if (t === false) out.push(...rightValues());
        else out.push(TRUTHY, ...rightValues());
      }
      return distinct(out);
    }
  }
}

/** A whole `${{ … }}` is its expression's values; text around expressions renders as text. */
function evaluate(field: unknown, ctx: Context): Value[] {
  if (typeof field !== 'string') return [field as Value];
  const whole = /^\s*\$\{\{([\s\S]*?)\}\}\s*$/.exec(field);
  if (whole && !whole[1]!.includes('}}')) return evaluateNode(parseExpression(whole[1]!), ctx);
  if (!field.includes('${{')) return [field];
  const parts = field.split(/(\$\{\{[\s\S]*?\}\})/);
  const sets = parts.map((p) => (p.startsWith('${{') ? evaluateNode(parseExpression(p.slice(3, -2)), ctx) : [p]));
  return distinct(product(sets).map((vs) => (vs.some(isUnknown) ? ANY : vs.map(asText).join(''))));
}

/** A job's `if:`, which GitHub reads as an expression with or without its `${{ }}`. */
function condition(field: unknown, ctx: Context): Value[] {
  if (typeof field === 'string' && !field.includes('${{')) return evaluateNode(parseExpression(field), ctx);
  return evaluate(field, ctx);
}

// ── Where a job runs ─────────────────────────────────────────────────────────

interface Scenario {
  readonly event: string;
  readonly ref: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly switchValue: string | null;
}

function contextFor(s: Scenario, matrix: Context['matrix'] = {}): Context {
  const tag = s.ref.startsWith('refs/tags/');
  const github: Record<string, string> = {
    event_name: s.event,
    ref: s.ref,
    ref_name: s.ref.replace(/^refs\/(heads|tags)\//, ''),
    ref_type: tag ? 'tag' : 'branch',
    repository: 'Robbes/Ownpace',
  };
  if (s.event === 'pull_request') Object.assign(github, { base_ref: 'main', head_ref: 'a-branch' });
  else Object.assign(github, { base_ref: '', head_ref: '' });
  return { github, vars: { [SWITCH]: s.switchValue }, inputs: s.event === 'workflow_dispatch' ? s.inputs : {}, matrix };
}

/** One way a job can run: its matrix values, its name as GitHub shows it, and every runner it can take. */
interface Leg {
  readonly name: string;
  readonly runners: ReadonlyArray<ReadonlyArray<string> | 'unknown'>;
}

const STATUS = /\b(always|failure|cancelled)\s*\(/;

function needsOf(job: Job): string[] {
  return job.needs === undefined ? [] : typeof job.needs === 'string' ? [job.needs] : (job.needs as string[]);
}

/** Can this job run in this scenario? An undecided `if:` can. */
function canRun(w: Workflow, name: string, s: Scenario, path: ReadonlyArray<string> = []): boolean {
  if (path.includes(name)) throw new Error(`${w.file}: needs go round in a circle at ${name}`);
  const job = w.jobs[name];
  if (!job) throw new Error(`${w.file}: a job needs ${name}, which is not defined`);
  const own = job.if === undefined ? [true] : condition(job.if, contextFor(s));
  if (!own.some((v) => truth(v) !== false)) return false;
  if (typeof job.if === 'string' && STATUS.test(job.if)) return true;
  return needsOf(job).every((n) => canRun(w, n, s, [...path, name]));
}

/** Every matrix combination GitHub would make of this definition, `include` and `exclude` applied. */
function combinations(def: Readonly<Record<string, unknown>>): Array<Record<string, unknown>> {
  const keys = Object.keys(def).filter((k) => k !== 'include' && k !== 'exclude');
  for (const k of keys) if (!Array.isArray(def[k])) throw new Error(`matrix key ${k} is not a list`);
  let combos: Array<Record<string, unknown>> = keys.length === 0 ? [] : product(keys.map((k) => def[k] as Value[])).map((vs) => Object.fromEntries(keys.map((k, i) => [k, vs[i]])));
  const exclude = (def.exclude ?? []) as Array<Record<string, unknown>>;
  combos = combos.filter((c) => !exclude.some((e) => Object.entries(e).every(([k, v]) => JSON.stringify(c[k]) === JSON.stringify(v))));
  for (const inc of (def.include ?? []) as Array<Record<string, unknown>>) {
    const original = new Set(keys);
    let added = false;
    combos = combos.map((c) => {
      if (Object.entries(inc).every(([k, v]) => !original.has(k) || JSON.stringify(c[k]) === JSON.stringify(v))) {
        added = true;
        return { ...c, ...inc };
      }
      return c;
    });
    if (!added) combos.push({ ...inc });
  }
  return combos;
}

/** The job's matrices: each possible definition's combinations, or one unknown leg. */
function matrices(job: Job, s: Scenario): Array<Context['matrix']> {
  const field = job.strategy?.matrix;
  if (field === undefined) return [{}];
  const ctx = contextFor(s);
  const definitions: Value[] =
    typeof field === 'string'
      ? evaluate(field, ctx)
      : product(Object.entries(field as Record<string, unknown>).map(([, v]) => evaluate(v, ctx))).map((vs) =>
          Object.fromEntries(Object.keys(field as Record<string, unknown>).map((k, i) => [k, vs[i]])),
        );
  const out: Array<Context['matrix']> = [];
  for (const def of definitions) {
    if (isUnknown(def) || typeof def !== 'object' || def === null || Array.isArray(def)) {
      out.push(ANY);
      continue;
    }
    if (Object.values(def).some((v) => isUnknown(v as Value) || (typeof v !== 'object' && v !== undefined))) {
      out.push(ANY);
      continue;
    }
    out.push(...combinations(def as Record<string, unknown>));
  }
  return out;
}

/** Every leg of a job in a scenario, with every runner each can take. */
function legsOf(w: Workflow, name: string, s: Scenario): Leg[] {
  const job = w.jobs[name]!;
  return matrices(job, s).map((matrix) => {
    const ctx = contextFor(s, matrix);
    const display = evaluate(job.name ?? name, ctx).map((v) => (isUnknown(v) ? '…' : asText(v)));
    const runners = distinct(evaluate(job['runs-on'], ctx)).map((v): ReadonlyArray<string> | 'unknown' => {
      if (typeof v === 'string') return [v];
      if (Array.isArray(v) && v.every((l) => typeof l === 'string')) return v as string[];
      return 'unknown';
    });
    return { name: display.join(' | '), runners };
  });
}

const HOSTED = /^(ubuntu|windows|macos)-(latest|\d[\w.-]*)$/;
const isHosted = (r: ReadonlyArray<string> | 'unknown') => r !== 'unknown' && r.length === 1 && HOSTED.test(r[0]!);
const reaches = (r: ReadonlyArray<string> | 'unknown', label: string) => r === 'unknown' || r.includes(label);
const show = (r: ReadonlyArray<string> | 'unknown') => (r === 'unknown' ? 'a runner it cannot tell' : `[${r.join(', ')}]`);

/** A sample ref for a branch or tag filter's pattern. */
const sample = (pattern: string) => pattern.replace(/\*\*/g, 'x').replace(/\*/g, '0.0.0');

/** Every push ref a workflow's push trigger admits, one sample per pattern. */
function pushRefs(w: Workflow): string[] {
  if (!('push' in w.on)) return [];
  const push = (w.on.push ?? {}) as { branches?: string[]; tags?: string[]; 'branches-ignore'?: unknown; 'tags-ignore'?: unknown };
  const hasBranches = push.branches !== undefined || push['branches-ignore'] !== undefined;
  const hasTags = push.tags !== undefined || push['tags-ignore'] !== undefined;
  const branches = push.branches ? push.branches.map(sample) : !hasTags || hasBranches ? ['main', 'a-branch'] : [];
  const tags = push.tags ? push.tags.map(sample) : !hasBranches || hasTags ? ['v0.0.0'] : [];
  return [...branches.map((b) => `refs/heads/${b}`), ...tags.map((t) => `refs/tags/${t}`)];
}

/** Every dispatch a workflow takes: each combination of its boolean and choice inputs. */
function dispatchInputs(w: Workflow): Array<Record<string, unknown>> {
  if (!('workflow_dispatch' in w.on)) return [];
  const declared = ((w.on.workflow_dispatch as { inputs?: Record<string, { type?: string; default?: unknown; options?: unknown[] }> } | null)?.inputs ?? {});
  const choices = Object.entries(declared).map(([k, d]) => {
    if (d.type === 'boolean') return [true, false].map((v) => [k, v] as const);
    if (d.type === 'choice' && Array.isArray(d.options)) return d.options.map((v) => [k, v] as const);
    return [[k, d.default ?? ''] as const];
  });
  return choices.reduce<Array<Record<string, unknown>>>((acc, set) => acc.flatMap((prefix) => set.map(([k, v]) => ({ ...prefix, [k]: v }))), [{}]);
}

/** Every way a workflow can start, for one state of the switch. */
function scenarios(w: Workflow, switchValue: string | null): Scenario[] {
  const out: Scenario[] = pushRefs(w).map((ref) => ({ event: 'push', ref, inputs: {}, switchValue }));
  if ('pull_request' in w.on) out.push({ event: 'pull_request', ref: 'refs/pull/1/merge', inputs: {}, switchValue });
  if ('schedule' in w.on) out.push({ event: 'schedule', ref: 'refs/heads/main', inputs: {}, switchValue });
  for (const inputs of dispatchInputs(w)) {
    for (const ref of ['refs/heads/main', 'refs/heads/a-branch']) out.push({ event: 'workflow_dispatch', ref, inputs, switchValue });
  }
  for (const event of Object.keys(w.on)) {
    if (!['push', 'pull_request', 'schedule', 'workflow_dispatch'].includes(event)) {
      throw new Error(`${w.file} starts on \`${event}\`, which this guard does not model: say where that event's jobs run, here`);
    }
  }
  return out;
}

const describeScenario = (s: Scenario) =>
  `${s.event === 'workflow_dispatch' ? `a dispatch on ${s.ref}${Object.keys(s.inputs).length ? ` with ${JSON.stringify(s.inputs)}` : ''}` : s.event === 'push' ? `a push to ${s.ref}` : `a ${s.event} run`}`;

/** The legs of every job that can run, keyed by job. */
function placement(w: Workflow, s: Scenario): Map<string, Leg[]> {
  const out = new Map<string, Leg[]>();
  for (const name of Object.keys(w.jobs)) if (canRun(w, name, s)) out.set(name, legsOf(w, name, s));
  return out;
}

const canonical = (legs: ReadonlyArray<Leg> | undefined) =>
  legs === undefined ? 'does not run' : legs.map((l) => `${l.name} on ${l.runners.map(show).join(' or ')}`).sort().join('; ');

// ── The properties, each a list of what is wrong ─────────────────────────────

/** 1. While the switch is on, nothing a push starts runs on the self-hosted runner. */
function pushStaysOffTheMachine(ws: ReadonlyArray<Workflow>): string[] {
  const problems: string[] = [];
  for (const w of ws) {
    for (const state of ON) {
      for (const s of scenarios(w, state.value).filter((x) => x.event === 'push')) {
        for (const [job, legs] of placement(w, s)) {
          for (const leg of legs) {
            const off = leg.runners.filter((r) => !isHosted(r));
            if (off.length > 0) {
              problems.push(`${w.file}: ${leg.name} (${job}) can run on ${off.map(show).join(' or ')} for ${describeScenario(s)} while ${state.label}`);
            }
          }
        }
      }
    }
  }
  return [...new Set(problems)];
}

/** 2. The jobs that ran on the machine take the push runner, and `true` sends every one back. */
function theSwitchTurnsThemBack(ws: ReadonlyArray<Workflow>): string[] {
  const problems: string[] = [];
  for (const [file, jobs] of Object.entries(MOVED)) {
    const w = ws.find((x) => x.file === file);
    if (!w) {
      problems.push(`${file} is gone, and with it ${jobs.length} job(s) this guard holds`);
      continue;
    }
    for (const job of jobs) {
      if (!w.jobs[job]) {
        problems.push(`${file}: ${job} is gone. If it was renamed, rename it in MOVED, so the switch still covers it`);
        continue;
      }
      const main: Scenario = { event: 'push', ref: 'refs/heads/main', inputs: {}, switchValue: null };
      for (const state of ON) {
        for (const leg of legsOf(w, job, { ...main, switchValue: state.value })) {
          if (!leg.runners.every((r) => r !== 'unknown' && r.length === 1 && r[0] === PUSH_RUNNER)) {
            problems.push(`${file}: ${leg.name} runs on ${leg.runners.map(show).join(' or ')} for a push to main while ${state.label}, not on ${PUSH_RUNNER}`);
          }
        }
      }
      for (const leg of legsOf(w, job, { ...main, switchValue: OFF.value })) {
        if (!leg.runners.every((r) => r !== 'unknown' && r.length === 1 && r[0] === 'self-hosted')) {
          problems.push(
            `${file}: ${leg.name} does not go back to the self-hosted runner when ${OFF.label}: it runs on ${leg.runners.map(show).join(' or ')} for a push to main, so turning the switch back would leave it behind`,
          );
        }
      }
    }
  }
  return problems;
}

/** 3. The switch moves nothing but a push of the jobs it covers, from the push runner to the machine. */
function theSwitchMovesNothingElse(ws: ReadonlyArray<Workflow>): string[] {
  const problems: string[] = [];
  for (const w of ws) {
    const [first, ...others] = ON.map((state) => scenarios(w, state.value).map((s) => placement(w, s)));
    const off = scenarios(w, OFF.value).map((s) => placement(w, s));
    scenarios(w, null).forEach((s, i) => {
      const jobs = new Set([...first![i]!.keys(), ...off[i]!.keys()]);
      for (const job of jobs) {
        const on = canonical(first![i]!.get(job));
        for (const [k, other] of others.entries()) {
          if (canonical(other[i]!.get(job)) !== on) problems.push(`${w.file}: ${job} runs differently for ${describeScenario(s)} under ${ON[0]!.label} and ${ON[k + 1]!.label}`);
        }
        const back = canonical(off[i]!.get(job));
        if (back === on) continue;
        const covered = s.event === 'push' && (MOVED[w.file] ?? []).includes(job);
        const swapped =
          covered &&
          (first![i]!.get(job) ?? []).every((l) => l.runners.every((r) => r !== 'unknown' && r.length === 1 && r[0] === PUSH_RUNNER)) &&
          (off[i]!.get(job) ?? []).every((l) => l.runners.every((r) => r !== 'unknown' && r.length === 1 && r[0] === 'self-hosted'));
        if (!swapped) problems.push(`${w.file}: ${job} moves with the switch for ${describeScenario(s)}: ${on} while it is on, ${back} when ${OFF.label}`);
      }
    });
  }
  return problems;
}

/** 4. No pull request reaches the machine, and nothing but a push takes these two files' jobs there. */
function nothingButAPushReachesTheMachine(ws: ReadonlyArray<Workflow>): string[] {
  const problems: string[] = [];
  for (const w of ws) {
    const covered = w.file in MOVED;
    for (const state of [...ON, OFF]) {
      for (const s of scenarios(w, state.value).filter((x) => x.event === 'pull_request' || (covered && x.event !== 'push'))) {
        for (const [job, legs] of placement(w, s)) {
          for (const leg of legs) {
            if (leg.runners.some((r) => reaches(r, 'self-hosted') || !isHosted(r))) {
              problems.push(`${w.file}: ${leg.name} (${job}) can run on ${leg.runners.map(show).join(' or ')} for ${describeScenario(s)} when ${state.label}`);
            }
          }
        }
      }
    }
  }
  return [...new Set(problems)];
}

/** 5. While the switch is on, a dispatch on a branch runs what a push to main runs, where it runs it. */
function aDispatchRunsWhatAPushRuns(ws: ReadonlyArray<Workflow>): string[] {
  const problems: string[] = [];
  for (const [file, inputs] of Object.entries(PROOF_INPUTS)) {
    const w = ws.find((x) => x.file === file);
    if (!w) continue;
    if (!('workflow_dispatch' in w.on)) {
      problems.push(`${file} has no workflow_dispatch trigger, so no branch can prove its push path before it merges`);
      continue;
    }
    for (const name of Object.keys(inputs)) {
      const declared = (w.on.workflow_dispatch as { inputs?: Record<string, unknown> } | null)?.inputs ?? {};
      if (!(name in declared)) problems.push(`${file}'s dispatch takes no input \`${name}\`, which its proof dispatch is sent with`);
    }
    for (const state of ON) {
      const push = placement(w, { event: 'push', ref: 'refs/heads/main', inputs: {}, switchValue: state.value });
      const dispatch = placement(w, { event: 'workflow_dispatch', ref: 'refs/heads/a-branch', inputs, switchValue: state.value });
      for (const job of new Set([...push.keys(), ...dispatch.keys()])) {
        const p = canonical(push.get(job));
        const d = canonical(dispatch.get(job));
        if (p !== d) problems.push(`${file}: ${job} for a dispatch on a branch (${d}) is not what a push to main runs (${p}), while ${state.label}`);
      }
    }
  }
  return problems;
}

/** 6. Both headers name the switch, and what turns it back. */
function theHeadersNameTheSwitch(ws: ReadonlyArray<Workflow>): string[] {
  const problems: string[] = [];
  for (const file of Object.keys(MOVED)) {
    const w = ws.find((x) => x.file === file);
    if (!w) continue;
    const header = w.text.slice(0, w.text.search(/^name:/m));
    if (!header.includes(`\`${SWITCH}\``) || !/`true`/.test(header)) {
      problems.push(`${file}'s header does not say that the repository variable \`${SWITCH}\`, set to \`true\`, turns the push jobs back`);
    }
  }
  return problems;
}

const ALL = (ws: ReadonlyArray<Workflow>) => [
  ...pushStaysOffTheMachine(ws),
  ...theSwitchTurnsThemBack(ws),
  ...theSwitchMovesNothingElse(ws),
  ...nothingButAPushReachesTheMachine(ws),
  ...aDispatchRunsWhatAPushRuns(ws),
  ...theHeadersNameTheSwitch(ws),
];

// ── The real files ───────────────────────────────────────────────────────────

const REAL = readWorkflows();
const file = (name: string) => REAL.find((w) => w.file === name)!;

/** The workflows with one file's text changed, which must be a change. */
function mutated(name: string, change: (text: string) => string): ReadonlyArray<Workflow> {
  const before = file(name).text;
  const after = change(before);
  expect(after, `the mutation of ${name} changed nothing`).not.toBe(before);
  return REAL.map((w) => (w.file === name ? parseWorkflow(name, after) : w));
}

/** Replace `from` with `to` inside one job's block only. */
function inJob(job: string, from: string | RegExp, to: string): (text: string) => string {
  return (text) => {
    const start = text.indexOf(`\n  ${job}:\n`);
    expect(start, `no job ${job}`).toBeGreaterThan(-1);
    const next = text.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
    const end = next === -1 ? text.length : start + 1 + next;
    return text.slice(0, start) + text.slice(start, end).replace(from, to) + text.slice(end);
  };
}

const OLD_RUNS_ON = "runs-on: ${{ github.event_name == 'push' && 'self-hosted' || 'ubuntu-24.04' }}";
const RUNS_ON = /runs-on: \$\{\{[^\n]*\}\}/;

describe('a merge does not run beside the socket while the alpha lasts', () => {
  it('reads every workflow, and finds the two this is about', () => {
    expect(REAL.length, 'no workflow was read').toBeGreaterThan(10);
    for (const name of Object.keys(MOVED)) expect(REAL.map((w) => w.file)).toContain(name);
  });

  it('while the switch is on, nothing a push starts runs on the self-hosted runner, in any workflow', () => {
    expect(pushStaysOffTheMachine(REAL)).toEqual([]);
  });

  it('the jobs that ran on the machine take GitHub’s arm64 runner, and the one variable set to true sends every one back', () => {
    expect(theSwitchTurnsThemBack(REAL)).toEqual([]);
  });

  it('the switch moves nothing else: no other event, job or workflow', () => {
    expect(theSwitchMovesNothingElse(REAL)).toEqual([]);
  });

  it('a pull request never reaches the self-hosted runner, and only a push takes these two files there', () => {
    expect(nothingButAPushReachesTheMachine(REAL)).toEqual([]);
  });

  it('a dispatch on a branch runs what a push to main runs, on the same runners, so it can prove the push path', () => {
    expect(aDispatchRunsWhatAPushRuns(REAL)).toEqual([]);
  });

  it('both headers name the switch', () => {
    expect(theHeadersNameTheSwitch(REAL)).toEqual([]);
  });

  it('reads the real push path as it is meant: the suite once, on arm64, Release’s names included', () => {
    const push = placement(file('ci.yml'), { event: 'push', ref: 'refs/heads/main', inputs: {}, switchValue: null });
    expect(canonical(push.get('unit-tests'))).toBe(`unit-tests (all) on [${PUSH_RUNNER}]`);
    expect(canonical(push.get('integration-tests'))).toBe(`integration-tests (${PUSH_RUNNER}) on [${PUSH_RUNNER}]`);
    expect(canonical(push.get('ci-complete'))).toBe('ci-complete on [ubuntu-24.04]');
    expect(push.has('commit-convention')).toBe(false);
    const back = placement(file('ci.yml'), { event: 'push', ref: 'refs/heads/main', inputs: {}, switchValue: 'true' });
    expect(canonical(back.get('integration-tests'))).toBe('integration-tests (self-hosted) on [self-hosted]');
    const pr = placement(file('ci.yml'), { event: 'pull_request', ref: 'refs/pull/1/merge', inputs: {}, switchValue: 'true' });
    expect(canonical(pr.get('integration-tests'))).toBe('integration-tests (ubuntu-24.04) on [ubuntu-24.04]; integration-tests (ubuntu-24.04-arm) on [ubuntu-24.04-arm]');
    expect(pr.get('unit-tests')?.map((l) => l.name).sort()).toEqual(['unit-tests (1)', 'unit-tests (2)', 'unit-tests (3)', 'unit-tests (4)']);
    const scan = placement(file('security-scan.yml'), { event: 'push', ref: 'refs/tags/v0.0.0', inputs: {}, switchValue: null });
    expect(canonical(scan.get('security-scan')), 'a tag’s scan makes the release page, on the runner it always had').toBe('security-scan on [ubuntu-24.04]');
    const release = placement(file('security-scan.yml'), {
      event: 'workflow_dispatch',
      ref: 'refs/heads/release-gate/v0.0.0',
      inputs: { image_scans: false, push_runner: false },
      switchValue: null,
    });
    expect(canonical(release.get('security-scan')), 'Release’s dispatches keep ubuntu-24.04').toBe('security-scan on [ubuntu-24.04]');
  });
});

describe('each failure is one this guard reports (mutations of the real files)', () => {
  it('a push job sent back to the machine by its own expression, not by the switch', () => {
    const ws = mutated('ci.yml', inJob('lint', RUNS_ON, OLD_RUNS_ON));
    expect(pushStaysOffTheMachine(ws)).toContain(`ci.yml: lint (lint) can run on [self-hosted] for a push to refs/heads/main while ${SWITCH} unset`);
  });

  it('a matrix leg on the machine for a push', () => {
    const ws = mutated('ci.yml', inJob('integration-tests', /runner: \$\{\{[^\n]*\}\}/, `runner: \${{ github.event_name == 'push' && fromJSON('["self-hosted"]') || fromJSON('["ubuntu-24.04","ubuntu-24.04-arm"]') }}`));
    expect(pushStaysOffTheMachine(ws)).toContain(
      `ci.yml: integration-tests (self-hosted) (integration-tests) can run on [self-hosted] for a push to refs/tags/v0.0.0 while ${SWITCH}=false`,
    );
  });

  it('a new workflow whose push job runs on the machine', () => {
    const extra = parseWorkflow(
      'deploy-on-merge.yml',
      'name: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: [self-hosted, linux, arm64]\n    steps:\n      - run: true\n',
    );
    expect(pushStaysOffTheMachine([...REAL, extra])).toContain(
      `deploy-on-merge.yml: deploy (deploy) can run on [self-hosted, linux, arm64] for a push to refs/heads/main while ${SWITCH} unset`,
    );
  });

  it('a runner nobody can tell, and another variable read beside the switch, fail closed', () => {
    const unknown = mutated('ci.yml', inJob('docs-hygiene', RUNS_ON, 'runs-on: ${{ needs.detect-changes.outputs.runner }}'));
    expect(pushStaysOffTheMachine(unknown)).toContain(
      `ci.yml: docs-hygiene (docs-hygiene) can run on a runner it cannot tell for a push to refs/heads/main while ${SWITCH} unset`,
    );
    const other = mutated('ci.yml', inJob('lint', RUNS_ON, "runs-on: ${{ vars.LINT_ON_SELF_HOSTED == 'true' && 'self-hosted' || 'ubuntu-24.04-arm' }}"));
    expect(pushStaysOffTheMachine(other)).toContain(`ci.yml: lint (lint) can run on [self-hosted] for a push to refs/heads/main while ${SWITCH} unset`);
  });

  it('a push job pinned to GitHub’s runner, which the switch would leave behind', () => {
    const ws = mutated('ci.yml', inJob('ui-tests', RUNS_ON, `runs-on: ${PUSH_RUNNER}`));
    expect(pushStaysOffTheMachine(ws)).toEqual([]);
    expect(theSwitchTurnsThemBack(ws)).toEqual([
      `ci.yml: ui-tests does not go back to the self-hosted runner when ${SWITCH}=true: it runs on [${PUSH_RUNNER}] for a push to main, so turning the switch back would leave it behind`,
    ]);
  });

  it('the switch misspelt in one file', () => {
    const ws = mutated('security-scan.yml', (t) => t.replaceAll(`vars.${SWITCH}`, 'vars.CI_PUSH_ON_SELFHOSTED'));
    expect(theSwitchTurnsThemBack(ws)).toContain(
      `security-scan.yml: security-scan does not go back to the self-hosted runner when ${SWITCH}=true: it runs on [self-hosted] or [${PUSH_RUNNER}] for a push to main, so turning the switch back would leave it behind`,
    );
  });

  it('a pull request the switch would send to the machine', () => {
    const ws = mutated('ci.yml', inJob('docs-hygiene', RUNS_ON, `runs-on: \${{ vars.${SWITCH} == 'true' && 'self-hosted' || github.event_name != 'pull_request' && '${PUSH_RUNNER}' || 'ubuntu-24.04' }}`));
    expect(nothingButAPushReachesTheMachine(ws)).toContain(`ci.yml: docs-hygiene (docs-hygiene) can run on [self-hosted] for a pull_request run when ${SWITCH}=true`);
    expect(theSwitchMovesNothingElse(ws)).toContain(
      `ci.yml: docs-hygiene moves with the switch for a pull_request run: docs-hygiene on [ubuntu-24.04] while it is on, docs-hygiene on [self-hosted] when ${SWITCH}=true`,
    );
  });

  it('a dispatch the switch would send to the machine', () => {
    const ws = mutated('ci.yml', inJob('detect-changes', RUNS_ON, `runs-on: \${{ github.event_name != 'pull_request' && vars.${SWITCH} == 'true' && 'self-hosted' || github.event_name != 'pull_request' && '${PUSH_RUNNER}' || 'ubuntu-24.04' }}`));
    expect(nothingButAPushReachesTheMachine(ws)).toContain(
      `ci.yml: detect-changes (detect-changes) can run on [self-hosted] for a dispatch on refs/heads/a-branch when ${SWITCH}=true`,
    );
  });

  it('a dispatch that runs the suite in four shards where a push runs it once', () => {
    const ws = mutated('ci.yml', inJob('unit-tests', "shard: ${{ github.event_name != 'pull_request' &&", "shard: ${{ github.event_name == 'push' &&"));
    expect(aDispatchRunsWhatAPushRuns(ws)).toContain(
      `ci.yml: unit-tests for a dispatch on a branch (unit-tests (1) on [${PUSH_RUNNER}]; unit-tests (2) on [${PUSH_RUNNER}]; unit-tests (3) on [${PUSH_RUNNER}]; unit-tests (4) on [${PUSH_RUNNER}]) is not what a push to main runs (unit-tests (all) on [${PUSH_RUNNER}]), while ${SWITCH} unset`,
    );
  });

  it('a scan dispatch that cannot take the push’s runner, and a workflow nobody can dispatch', () => {
    const scan = mutated('security-scan.yml', (t) => t.replace(' || inputs.push_runner)', ')'));
    expect(aDispatchRunsWhatAPushRuns(scan)).toContain(
      `security-scan.yml: security-scan for a dispatch on a branch (security-scan on [ubuntu-24.04]) is not what a push to main runs (security-scan on [${PUSH_RUNNER}]), while ${SWITCH} unset`,
    );
    const ci = mutated('ci.yml', (t) => t.replace(/\n {2}workflow_dispatch:\n/, '\n'));
    expect(aDispatchRunsWhatAPushRuns(ci)).toContain('ci.yml has no workflow_dispatch trigger, so no branch can prove its push path before it merges');
  });

  it('a header that no longer says how to turn it back', () => {
    const ws = mutated('ci.yml', (t) => t.replace(/^(# [^\n]*)`CI_PUSH_ON_SELF_HOSTED`/m, '$1`A_SWITCH`'));
    expect(theHeadersNameTheSwitch(ws)).toEqual([
      `ci.yml's header does not say that the repository variable \`${SWITCH}\`, set to \`true\`, turns the push jobs back`,
    ]);
  });

  it('syntax the reader does not know throws, rather than passing', () => {
    const ws = mutated('ci.yml', inJob('lint', RUNS_ON, "runs-on: ${{ github.event_name >= 'push' && 'self-hosted' || 'ubuntu-24.04' }}"));
    expect(() => ALL(ws)).toThrow(/cannot read/);
  });
});
