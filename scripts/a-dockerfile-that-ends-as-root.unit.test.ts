// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOCKERFILE THAT ENDS AS ROOT, AND THE OTHER RULES A READING OF ONE HOLDS
 * IT TO (a read-only check of the repository, 2026-11-19: GEN-21 and GEN-20,
 * the latter by hadolint 2.15.1's rules; workplan 0119).
 *
 * The check read each Dockerfile, not the image it builds. Five ended in a
 * stage with no USER, or with `USER root`: the web image, GoAccess's, the
 * dashboard's TLS front, the Docker socket proxy and the Stalwart fixture
 * (GEN-21). And it listed the lines where one breaks a rule of hadolint's
 * (GEN-20): a USER named rather than numbered (DL3066), a HEALTHCHECK in shell
 * form (DL3025), a RUN that pipes without `pipefail` (DL4006), packages
 * installed without a version (DL3008, DL3018), and ShellCheck's notes inside
 * a RUN.
 *
 * So this holds, for every Dockerfile git lists, found rather than listed:
 *
 *  1. ITS LAST STAGE ENDS AS A USER THAT IS NOT ROOT (GEN-21, hadolint's
 *     DL3002): the stage names a USER, and the last one is neither `root` nor
 *     uid 0;
 *  2. EVERY USER IS A NUMBER (DL3066): a name is resolved inside the image, and
 *     a host, or a rule about the uid, cannot read it;
 *  3. CMD, ENTRYPOINT AND HEALTHCHECK'S CMD ARE EXEC FORM (DL3025): a shell
 *     form runs under `/bin/sh -c`, and a shell is a program the image must
 *     have and the command is not what it reads;
 *  4. A RUN THAT PIPES RUNS UNDER `pipefail` (DL4006): a SHELL with
 *     `-o pipefail` before it, in its stage. Without it a pipeline's status is
 *     its last command's, and a check whose first command failed passes;
 *  5. NO ADD (DL3020): it fetches and unpacks what COPY would name;
 *  6. EVERY OUTSIDE FROM NAMES A TAG, AND NOT `latest` (DL3006, DL3007). Its
 *     digest is `a-float-nothing-ever-pulled`'s.
 *
 * unless EXCEPTIONS names the file and the rule, with the reason it stands.
 * An exception whose file keeps its rule fails too, so the list says what is
 * true and shrinks as files are fixed. EXCEPTIONS live in
 * `scripts/hadolint-report.mjs` since 2026-11-19, so that CI's hadolint report
 * reads them on a bare checkout (below).
 *
 * WHAT IS NOT HELD HERE, AND WHY. Packages installed without a version
 * (DL3008, DL3018): the bases are pinned by digest, a package at an exact
 * version stops the build the day Alpine or Debian ships the next one and
 * drops it from its mirror, and the image scan says when a package is behind;
 * the owner's answer of 2026-11-19 is not to pin them, and `.hadolint.yaml`
 * ignores both. ShellCheck's notes inside a RUN, and hadolint's other rules:
 * hadolint reports them in CI now, report only (below), and each image's
 * build proves what its RUNs do. A HEALTHCHECK in every image (DL3057, off by
 * default in hadolint): compose gives each service its probe, or none on
 * purpose. And a Dockerfile's user against the image it builds on: a base
 * that sets a user of its own, as Stalwart's does, still ends as root by this
 * file's reading when the Dockerfile names none, which is how the check read
 * it.
 *
 * HADOLINT ITSELF, IN CI, REPORT ONLY (the owner's decision of 2026-11-19).
 * `.github/workflows/hadolint.yml` runs hadolint 2.15.1 over every
 * Dockerfile this file finds (`dockerfiles()` is the report's, so the two
 * read the same files), with `.hadolint.yaml`, and writes each file's
 * findings to the job's summary, a finding EXCEPTIONS or KNOWN_FINDINGS
 * explain marked known with its reason. It becomes blocking after the two
 * Trigger.dev Dockerfiles have had their pass. So this also holds, each rule
 * broken on purpose below as well, on the real file where there is one:
 *
 *  7. THE IMAGE IS HADOLINT'S BY A RELEASE TAG AND ITS INDEX DIGEST, the
 *     reference read on 2026-11-19 (`HADOLINT`, below), in one
 *     `HADOLINT_IMAGE`, and the comment above it names that digest, the tag,
 *     the two platforms and the day it was read, so a digest moved without
 *     its reading fails;
 *  8. THE CONFIG IGNORES DL3008 AND DL3018 AND NOTHING ELSE, and lets no
 *     `# hadolint ignore=` line in a Dockerfile ignore more;
 *  9. THE JOB IS REPORT ONLY: not in ci.yml, so ci-complete never waits for
 *     it, and not among docs/testing.md's required checks; no
 *     `continue-on-error` and no `if:` to read a broken run as green; and its
 *     report, run against a stubbed `docker`, exits 0 on every finding, and
 *     on a pull request whatever happened, and 1 on a push or a dispatch only
 *     when a Dockerfile went unlinted;
 * 10. THE WORKFLOW SAYS WHEN IT BECOMES BLOCKING, naming both Trigger.dev
 *     Dockerfiles;
 * 11. THE REPORT LINTS EVERY DOCKERFILE THIS FILE FINDS, after one pull, one
 *     sandboxed run each, and calls known exactly what EXCEPTIONS (by
 *     hadolint's code for the rule, RULE_CODES) or KNOWN_FINDINGS explain.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseYaml } from 'yaml';
import {
  CONFIG,
  EXCEPTIONS,
  IGNORED,
  IMAGE,
  KNOWN_FINDINGS,
  PULL_DELAYS,
  RULE_CODES,
  dockerfiles as dockerfilesUnder,
  knownAs,
  lintArgs,
  report,
  run,
  type Ran,
  type Rule,
} from './hadolint-report.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/**
 * Every Dockerfile in the repository, as git lists them, tracked or new: the
 * report's own walk, so CI's hadolint lints what this reads.
 */
export function dockerfiles(): string[] {
  return dockerfilesUnder(REPO_ROOT);
}

/** The Dockerfiles this was written against: the walk must find each, so it cannot pass on a short list. */
export const KNOWN = [
  'apps/api/Dockerfile',
  'apps/selfhost/Dockerfile',
  'apps/web/Dockerfile',
  'apps/worker/Dockerfile',
  'apps/worker/task-image/Dockerfile',
  'deploy/compose/caddy/Dockerfile',
  'deploy/compose/docker-socket-proxy/Dockerfile',
  'deploy/compose/goaccess/Dockerfile',
  'deploy/compose/pgbouncer/Dockerfile',
  'deploy/compose/postgres/Dockerfile',
  'deploy/compose/redis/Dockerfile',
  'deploy/compose/supervisor/Dockerfile',
  'deploy/compose/trigger.dev/Dockerfile',
  'deploy/selfhost/postgres/Dockerfile',
  'packages/testing/fixtures/stalwart/Dockerfile',
] as const;

/** One instruction: its first line's number, its keyword and the rest, continuation lines joined and comment lines inside dropped. */
export interface Instruction {
  readonly line: number;
  readonly keyword: string;
  readonly args: string;
}

export function instructionsOf(text: string): Instruction[] {
  const out: Instruction[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const first = lines[i]!;
    if (/^\s*(#|$)/.test(first)) continue;
    const start = i + 1;
    let body = first;
    while (/\\\s*$/.test(body) && i + 1 < lines.length) {
      i += 1;
      const next = lines[i]!;
      if (/^\s*#/.test(next)) continue;
      body = body.replace(/\\\s*$/, '') + next;
    }
    const m = /^\s*(\S+)\s*([\s\S]*)$/.exec(body)!;
    out.push({ line: start, keyword: m[1]!.toUpperCase(), args: m[2]!.trim() });
  }
  return out;
}

export interface Stage {
  readonly from: Instruction;
  readonly name: string | null;
  readonly body: readonly Instruction[];
}

export function stagesOf(text: string): Stage[] {
  const stages: Array<{ from: Instruction; name: string | null; body: Instruction[] }> = [];
  for (const ins of instructionsOf(text)) {
    if (ins.keyword === 'FROM') {
      const name = /\s+AS\s+(\S+)\s*$/i.exec(ins.args)?.[1] ?? null;
      stages.push({ from: ins, name, body: [] });
    } else if (stages.length) {
      stages.at(-1)!.body.push(ins);
    }
  }
  return stages;
}

/** The uid a USER names: what comes before its group. */
const uidOf = (user: string) => user.split(':')[0]!.trim();

/**
 * Whether a RUN's command pipes, read as a shell reads its quotes: a `|` that
 * is not `||`, outside single quotes, outside double quotes unless inside a
 * command substitution there (`"$(a | b)"` pipes), and not escaped. A `case`
 * statement's patterns (`a|b)`) are taken out first, with its body: none of
 * the RUNs here pipes inside one.
 */
export function pipes(command: string): boolean {
  const text = command.replace(/\bcase\b[\s\S]*?\besac\b/g, ' ');
  // What each open context is: code, a single-quoted or a double-quoted string.
  const stack: Array<'code' | 'single' | 'double'> = ['code'];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    const at = stack.at(-1)!;
    if (at === 'single') {
      if (c === "'") stack.pop();
      continue;
    }
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (at === 'double') {
      if (c === '"') stack.pop();
      else if (c === '$' && text[i + 1] === '(') {
        stack.push('code');
        i += 1;
      }
      continue;
    }
    // Code, at the top or inside a command substitution.
    if (c === "'") stack.push('single');
    else if (c === '"') stack.push('double');
    else if (c === '$' && text[i + 1] === '(') {
      stack.push('code');
      i += 1;
    } else if (c === ')' && stack.length > 1) stack.pop();
    else if (c === '|') {
      if (text[i + 1] === '|') i += 1;
      else return true;
    }
  }
  return false;
}

/** Whether a SHELL instruction's array sets pipefail on a shell that has it (bash, zsh, ash). */
export function setsPipefail(args: string): boolean {
  let shell: unknown;
  try {
    shell = JSON.parse(args);
  } catch {
    return false;
  }
  if (!Array.isArray(shell) || !shell.every((s) => typeof s === 'string')) return false;
  const words = shell as string[];
  const name = words[0]?.split('/').at(-1);
  if (!['bash', 'zsh', 'ash'].includes(name ?? '')) return false;
  return words.some((w, i) => (w === '-o' && words[i + 1] === 'pipefail') || /^-\w*o$/.test(w) && words[i + 1] === 'pipefail');
}

/** What breaks each rule in one Dockerfile's text, by rule; a rule it keeps has no entry. */
export function breaches(text: string): Partial<Record<Rule, string[]>> {
  const found: Partial<Record<Rule, string[]>> = {};
  const add = (rule: Rule, what: string) => (found[rule] ??= []).push(what);
  const stages = stagesOf(text);
  const names = new Set<string>();
  for (const stage of stages) {
    const image = stage.from.args.replace(/^(--\S+\s+)*/, '').split(/\s+/)[0]!;
    if (!names.has(image.toLowerCase()) && image !== 'scratch') {
      const tag = /^[^@]*\/?[^/@]*:([^/@:]+)(?:@|$)/.exec(image)?.[1] ?? '';
      if (tag === '' || tag === 'latest') add('tagged', `${stage.from.line}: FROM ${image} names ${tag === '' ? 'no tag' : 'latest'}`);
    }
    if (stage.name) names.add(stage.name.toLowerCase());
    let pipefail = false;
    for (const ins of stage.body) {
      if (ins.keyword === 'SHELL') pipefail = setsPipefail(ins.args);
      if (ins.keyword === 'USER' && !/^\d+$/.test(uidOf(ins.args)) && !/^\$/.test(uidOf(ins.args))) add('numeric-user', `${ins.line}: USER ${ins.args}`);
      if (ins.keyword === 'ADD') add('no-add', `${ins.line}: ADD ${ins.args.split('\n')[0]}`);
      if ((ins.keyword === 'CMD' || ins.keyword === 'ENTRYPOINT') && !ins.args.startsWith('[')) add('exec-form', `${ins.line}: ${ins.keyword} ${ins.args}`);
      if (ins.keyword === 'HEALTHCHECK') {
        const cmd = /\bCMD\s+([\s\S]*)$/.exec(ins.args)?.[1]?.trim();
        if (cmd !== undefined && !cmd.startsWith('[')) add('exec-form', `${ins.line}: HEALTHCHECK CMD ${cmd}`);
      }
      if (ins.keyword === 'RUN') {
        const command = ins.args.replace(/^(--\S+\s+)*/, '');
        if (!command.startsWith('[') && !pipefail && pipes(command)) add('pipefail', `${ins.line}: a RUN that pipes, with no SHELL that sets pipefail before it in its stage`);
      }
    }
  }
  const last = stages.at(-1);
  const user = last?.body.filter((i) => i.keyword === 'USER').at(-1);
  if (!last) add('non-root', 'no stage at all');
  else if (!user) add('non-root', `the last stage (line ${last.from.line}) names no USER, so it runs as its base does, which a reading of the file takes for root`);
  else if (['root', '0'].includes(uidOf(user.args))) add('non-root', `${user.line}: the last USER is ${user.args}`);
  return found;
}

/** What is wrong across the repository's Dockerfiles, against EXCEPTIONS; empty when it holds. */
export function problems(files: readonly string[], textOf: (file: string) => string, exceptions = EXCEPTIONS): string[] {
  const out: string[] = [];
  for (const file of files) {
    const found = breaches(textOf(file));
    const excused = exceptions[file] ?? {};
    for (const [rule, what] of Object.entries(found) as Array<[Rule, string[]]>) {
      if (!excused[rule]) out.push(`${file} breaks ${rule}: ${what.join('; ')}`);
    }
    for (const rule of Object.keys(excused) as Rule[]) {
      if (!found[rule]) out.push(`${file} keeps ${rule} now: take it out of EXCEPTIONS, whose reason no longer holds`);
    }
  }
  for (const file of Object.keys(exceptions)) {
    if (!files.includes(file)) out.push(`EXCEPTIONS names ${file}, which is no Dockerfile here: take it out`);
  }
  return out;
}

describe('a Dockerfile that ends as root, and the rules a reading of one holds it to', () => {
  const files = dockerfiles();

  it('finds every Dockerfile it was written against, and no other unread', () => {
    expect(files).toEqual(expect.arrayContaining([...KNOWN]));
    expect(files.filter((f) => !(KNOWN as readonly string[]).includes(f)), 'a Dockerfile this was not written against: read it, then add it to KNOWN').toEqual([]);
  });

  it('each keeps every rule, or EXCEPTIONS says why it does not', () => {
    expect(problems(files, read)).toEqual([]);
  });

  it('gives every exception a reason', () => {
    for (const [file, rules] of Object.entries(EXCEPTIONS)) {
      for (const [rule, why] of Object.entries(rules)) expect(why?.length ?? 0, `${file} ${rule}`).toBeGreaterThan(40);
    }
  });
});

describe('each rule, broken on purpose', () => {
  const base = 'FROM alpine:3.24.4@sha256:' + '0'.repeat(64) + '\nRUN true\nUSER 1000:1000\nENTRYPOINT ["/bin/true"]\n';
  const only = (text: string) => breaches(text);

  it('passes a Dockerfile that keeps them all', () => {
    expect(only(base)).toEqual({});
  });

  it('non-root: no USER, root, uid 0, and a USER before a later stage that names none', () => {
    expect(only(base.replace('USER 1000:1000\n', ''))['non-root']).toEqual([expect.stringContaining('names no USER')]);
    expect(only(base.replace('USER 1000:1000', 'USER root'))['non-root']).toEqual([expect.stringContaining('the last USER is root')]);
    expect(only(base.replace('USER 1000:1000', 'USER 0:0'))['non-root']).toEqual([expect.stringContaining('the last USER is 0:0')]);
    expect(only(`${base}FROM scratch AS out\nCOPY --from=0 / /\n`)['non-root']).toEqual([expect.stringContaining('names no USER')]);
  });

  it('numeric-user: a name, root by name, anywhere in the file', () => {
    expect(only(base.replace('USER 1000:1000', 'USER node'))['numeric-user']).toEqual([expect.stringContaining('USER node')]);
    expect(only(base.replace('RUN true', 'USER root\nRUN true'))['numeric-user']).toEqual([expect.stringContaining('USER root')]);
    expect(only(base.replace('USER 1000:1000', 'USER $UID'))['numeric-user']).toBeUndefined();
  });

  it('exec-form: CMD, ENTRYPOINT and HEALTHCHECK CMD in shell form', () => {
    expect(only(base.replace('ENTRYPOINT ["/bin/true"]', 'ENTRYPOINT /bin/true'))['exec-form']).toHaveLength(1);
    expect(only(`${base}CMD echo hi\n`)['exec-form']).toHaveLength(1);
    expect(only(`${base}HEALTHCHECK --interval=30s \\\n  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1\n`)['exec-form']).toHaveLength(1);
    expect(only(`${base}HEALTHCHECK --interval=30s \\\n  CMD ["wget", "-qO", "/dev/null", "http://127.0.0.1/"]\n`)['exec-form']).toBeUndefined();
    expect(only(`${base}HEALTHCHECK NONE\n`)['exec-form']).toBeUndefined();
  });

  it('pipefail: a pipe, in a command substitution too, without a SHELL that sets it; not || nor a quoted or escaped bar', () => {
    const run = (command: string, shell = '') => only(base.replace('RUN true', `${shell}RUN ${command}`))['pipefail'];
    expect(run('ls | wc -l')).toHaveLength(1);
    expect(run('n="$(ls /x | wc -l)"')).toHaveLength(1);
    expect(run('ls | wc -l', 'SHELL ["/bin/ash", "-o", "pipefail", "-c"]\n')).toBeUndefined();
    expect(run('ls | wc -l', 'SHELL ["/bin/bash", "-eo", "pipefail", "-c"]\n')).toBeUndefined();
    expect(run('ls | wc -l', 'SHELL ["/bin/sh", "-c"]\n')).toHaveLength(1);
    expect(run("true || false; tr ' ' '|' < /dev/null; grep 'a|b' /x")).toBeUndefined();
    expect(run('sed -e "s/a\\|b/c/" /x')).toBeUndefined();
    expect(run('case "$x" in a|b) ;; esac')).toBeUndefined();
    // A bar in double quotes is text; an apostrophe there opens nothing.
    expect(run(`echo "a|b, the file's own" >&2; sed -i -e 's|x|y|' /f`)).toBeUndefined();
    expect(run(`echo "it's $(printf x | tr x y)"`)).toHaveLength(1);
    // A SHELL reaches the RUNs of its own stage, not the next stage's.
    expect(only(`FROM a:1 AS one\nSHELL ["/bin/ash", "-o", "pipefail", "-c"]\nFROM b:2\nRUN ls | wc -l\nUSER 1:1\n`)['pipefail']).toHaveLength(1);
  });

  it('no-add and tagged', () => {
    expect(only(base.replace('RUN true', 'ADD https://example.org/x /x'))['no-add']).toHaveLength(1);
    expect(only(base.replace(/^FROM \S+/, 'FROM alpine'))['tagged']).toEqual([expect.stringContaining('names no tag')]);
    expect(only(base.replace(/^FROM \S+/, 'FROM alpine:latest'))['tagged']).toEqual([expect.stringContaining('names latest')]);
    expect(only(base.replace(/^FROM \S+/, 'FROM chainguard/minio:latest@sha256:' + '1'.repeat(64)))['tagged']).toEqual([expect.stringContaining('names latest')]);
    expect(only(`FROM a:1 AS build\nRUN true\nFROM build\nUSER 1:1\n`)['tagged']).toBeUndefined();
  });

  it('an exception whose file keeps its rule is stale, and one for no file is too', () => {
    const files = ['x/Dockerfile'];
    const text = () => base;
    expect(problems(files, text, { 'x/Dockerfile': { 'non-root': 'a reason long enough to say why this file ends as root, for the test' } })).toEqual([
      expect.stringContaining('keeps non-root now'),
    ]);
    expect(problems(files, text, { 'y/Dockerfile': { pipefail: 'a reason long enough to say why this file pipes without pipefail' } })).toEqual([
      expect.stringContaining('names y/Dockerfile, which is no Dockerfile here'),
    ]);
    expect(problems(files, () => base.replace('USER 1000:1000\n', ''), {})).toEqual([expect.stringContaining('x/Dockerfile breaks non-root')]);
  });
});

/** The workflow that runs hadolint, and its one job. */
const WORKFLOW = '.github/workflows/hadolint.yml';
const JOB = 'hadolint';
/**
 * The hadolint the job runs, as read on 2026-11-19 at 19:43 UTC: v2.15.1's
 * index, the `Docker-Content-Digest` Google's mirror of Docker Hub
 * (mirror.gcr.io) gave for the tag, its body hashing to it, and the `digest`
 * Docker Hub's tag API gave, the same, pushed 2026-07-31 09:57:38 UTC. A move
 * is a re-read: of both, and of the job's summary on the pull request that
 * moves it, since a release can bring new rules.
 */
const HADOLINT = 'hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d';
/** The two Dockerfiles whose pass turns the job blocking. */
const TRIGGER_DEV = ['deploy/compose/trigger.dev/Dockerfile', 'deploy/compose/supervisor/Dockerfile'] as const;

interface Step {
  readonly uses?: string;
  readonly run?: string;
  readonly if?: unknown;
  readonly env?: Record<string, unknown>;
  readonly 'continue-on-error'?: unknown;
}

interface Job {
  readonly 'runs-on'?: unknown;
  readonly if?: unknown;
  readonly env?: Record<string, unknown>;
  readonly steps?: ReadonlyArray<Step>;
  readonly 'continue-on-error'?: unknown;
}

interface Workflow {
  readonly on?: Record<string, unknown>;
  readonly jobs?: Record<string, Job>;
}

/** What is wrong with the hadolint job, read from its workflow's text (7, 9 and 10 in the header); empty when it holds. */
export function jobProblems(text: string): string[] {
  const out: string[] = [];
  const wf = parseYaml(text) as Workflow;
  const names = Object.keys(wf.jobs ?? {});
  if (names.join(' ') !== JOB) out.push(`its jobs are ${JSON.stringify(names)}, not the one \`${JOB}\``);
  const job = wf.jobs?.[JOB];
  if (!job) return out;
  for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
    if (!Object.hasOwn(wf.on ?? {}, event)) out.push(`it does not run on ${event}`);
  }
  if (typeof job['runs-on'] !== 'string' || !/^ubuntu-\d/.test(job['runs-on'])) {
    out.push(`runs-on is ${JSON.stringify(job['runs-on'])}, not a GitHub-hosted ubuntu runner`);
  }
  if (job.if !== undefined) out.push(`the job has an if: (${String(job.if)}), so a run can skip it and read green`);
  const steps = job.steps ?? [];
  const swallowing: Array<[string, unknown]> = [['the job', job['continue-on-error']], ...steps.map((s, i): [string, unknown] => [`step ${i + 1}`, s['continue-on-error']])];
  for (const [where, value] of swallowing) {
    if (value !== undefined) {
      out.push(`${where} sets continue-on-error (${String(value)}): the report decides its own exit, and this would read a run that linted nothing as green`);
    }
  }
  const runs = steps.filter((s) => typeof s.run === 'string');
  if (runs.length !== 1 || runs[0]!.run!.trim() !== 'node scripts/hadolint-report.mjs') {
    out.push(`its run steps are ${JSON.stringify(runs.map((s) => s.run))}, not the one \`node scripts/hadolint-report.mjs\``);
  }
  for (const s of runs) {
    if (s.if !== undefined) out.push(`the lint step has an if: (${String(s.if)})`);
    for (const key of ['HADOLINT_IMAGE', 'GITHUB_EVENT_NAME']) if (s.env && Object.hasOwn(s.env, key)) out.push(`the lint step sets ${key} itself`);
  }
  const image = job.env?.['HADOLINT_IMAGE'];
  if (typeof image !== 'string' || !IMAGE.test(image)) {
    out.push(`HADOLINT_IMAGE is ${JSON.stringify(image)}, not hadolint/hadolint:v<x.y.z>@sha256:<index digest>`);
  } else {
    // The comment right above the pin: the digest it carries, its tag, both platforms, the day it was read.
    const at = text.indexOf(`HADOLINT_IMAGE: ${image}`);
    const above: string[] = [];
    for (const line of text.slice(0, at).split('\n').reverse().slice(1)) {
      if (!/^\s*#/.test(line)) break;
      above.push(line);
    }
    const comment = above.reverse().join('\n');
    const [named, digest] = image.split('@sha256:') as [string, string];
    const tag = named.slice(named.indexOf(':') + 1);
    if (!comment.includes(digest.slice(0, 12))) {
      out.push(`the comment above HADOLINT_IMAGE does not name the digest it carries (${digest.slice(0, 12)}…): read the new image, then say what it is`);
    }
    if (!comment.includes(`hadolint ${tag} `)) out.push(`the comment above HADOLINT_IMAGE does not name the release it pins (hadolint ${tag})`);
    for (const platform of ['linux/amd64', 'linux/arm64']) {
      if (!comment.includes(platform)) out.push(`the comment above HADOLINT_IMAGE does not say its index holds ${platform}`);
    }
    if (!/read on \d{4}-\d{2}-\d{2}/.test(comment)) out.push('the comment above HADOLINT_IMAGE does not say the day its digest was read');
  }
  const images = [...text.matchAll(/hadolint\/hadolint:[^\s'"]+/g)].map((m) => m[0]);
  if (images.length !== 1) out.push(`the workflow names a hadolint image ${images.length} times, not once: ${images.join(', ')}`);
  const header = text.slice(0, Math.max(0, text.search(/^name:/m)));
  if (!header.includes('IT BECOMES BLOCKING')) out.push('the header does not say when the job becomes blocking (IT BECOMES BLOCKING after …)');
  for (const file of TRIGGER_DEV) if (!header.includes(file)) out.push(`the header does not name ${file}, whose pass turns the job blocking`);
  return out;
}

/** What would make the job gate a merge: a job in ci.yml, or a place among docs/testing.md's required checks (9). */
export function gateProblems(ciText: string, testing: string): string[] {
  const out: string[] = [];
  const ci = parseYaml(ciText) as Workflow;
  const there = Object.entries(ci.jobs ?? {})
    .filter(([, job]) => /hadolint/i.test(JSON.stringify(job)))
    .map(([name]) => name);
  if (there.length) out.push(`ci.yml runs hadolint in ${there.join(', ')}: ci-complete waits for every job there and fails on one that does not pass`);
  const marker = '**Required status checks**';
  const start = testing.indexOf(marker);
  if (start < 0) out.push(`docs/testing.md has no "${marker}" paragraph to read`);
  else if (/hadolint/i.test(testing.slice(start).split('\n\n')[0] ?? '')) out.push("docs/testing.md's required checks name hadolint, which is report only");
  return out;
}

/** What is wrong with `.hadolint.yaml` (8): anything but DL3008 and DL3018 ignored, and no pragma ignoring more. */
export function configProblems(text: string): string[] {
  const config: unknown = parseYaml(text);
  const want = { ignored: [...IGNORED], 'disable-ignore-pragma': true };
  return isDeepStrictEqual(config, want)
    ? []
    : [`${CONFIG} reads ${JSON.stringify(config)}, not ${JSON.stringify(want)}: it ignores DL3008 and DL3018 and nothing else, and no pragma ignores more`];
}

describe('hadolint in CI, report only (workplan 0119, the owner’s decision of 2026-11-19)', () => {
  const text = read(WORKFLOW);

  it('runs hadolint by tag and index digest, in one job that hides nothing and says when it becomes blocking', () => {
    expect(jobProblems(text)).toEqual([]);
    const image = (parseYaml(text) as Workflow).jobs![JOB]!.env!['HADOLINT_IMAGE'];
    expect(image, `${WORKFLOW} runs another hadolint than the one read: read the new one as HADOLINT says, then move both`).toBe(HADOLINT);
  });

  it('refuses a pin moved without its reading, a tag alone, a channel, a second image and another registry', () => {
    const pin = /^ {6}HADOLINT_IMAGE: (\S+)$/m.exec(text)?.[1];
    expect(pin, `${WORKFLOW} pins no HADOLINT_IMAGE to mutate`).toBeDefined();
    const mutate = (from: string, to: string): string[] => {
      const next = text.replace(from, to);
      expect(next, from).not.toBe(text);
      return jobProblems(next);
    };
    expect(mutate(pin!, pin!.replace(/@sha256:[0-9a-f]{64}/, `@sha256:${'0'.repeat(64)}`))).toEqual([
      expect.stringMatching(/does not name the digest it carries \(000000000000…\)/),
    ]);
    expect(mutate(pin!, pin!.replace(/@sha256:.*/, '')).join('\n')).toMatch(/not hadolint\/hadolint:v<x\.y\.z>@sha256:<index digest>/);
    expect(mutate(pin!, pin!.replace(/:v[\d.]+@/, ':latest@')).join('\n')).toMatch(/not hadolint\/hadolint:v<x\.y\.z>@sha256:<index digest>/);
    expect(mutate(pin!, `ghcr.io/${pin!}`).join('\n')).toMatch(/not hadolint\/hadolint:v<x\.y\.z>@sha256:<index digest>/);
    expect(mutate(pin!, pin!.replace('v2.15.1', 'v2.15.2')).join('\n')).toMatch(/does not name the release it pins \(hadolint v2\.15\.2\)/);
    expect(mutate('linux/arm64', 'arm64').join('\n')).toMatch(/does not say its index holds linux\/arm64/);
    expect(mutate('read on 2026-11-19', 'read').join('\n')).toMatch(/does not say the day its digest was read/);
    expect(mutate('run: node scripts/hadolint-report.mjs', 'run: docker run --rm -i hadolint/hadolint:latest < apps/api/Dockerfile').join('\n')).toMatch(
      /names a hadolint image 2 times, not once/,
    );
  });

  it('refuses each way the job could read a broken run as green, or land where it should not', () => {
    const mutate = (from: string, to: string): string => {
      const next = text.replace(from, to);
      expect(next, from).not.toBe(text);
      return jobProblems(next).join('\n');
    };
    const step = '        run: node scripts/hadolint-report.mjs\n';
    expect(mutate('    timeout-minutes: 10\n', '    timeout-minutes: 10\n    continue-on-error: true\n')).toMatch(/the job sets continue-on-error \(true\)/);
    expect(mutate(step, `${step}        continue-on-error: true\n`)).toMatch(/step 3 sets continue-on-error \(true\)/);
    expect(mutate('    timeout-minutes: 10\n', "    timeout-minutes: 10\n    if: github.event_name != 'pull_request'\n")).toMatch(/the job has an if:/);
    expect(mutate(step, `${step}        if: always()\n`)).toMatch(/the lint step has an if:/);
    expect(mutate(step, `        env:\n          GITHUB_EVENT_NAME: pull_request\n${step}`)).toMatch(/the lint step sets GITHUB_EVENT_NAME itself/);
    expect(mutate(step, '        run: node scripts/hadolint-report.mjs || true\n')).toMatch(/not the one `node scripts\/hadolint-report\.mjs`/);
    expect(mutate('runs-on: ubuntu-24.04', 'runs-on: self-hosted')).toMatch(/not a GitHub-hosted ubuntu runner/);
    expect(mutate('  pull_request:\n', '')).toMatch(/it does not run on pull_request/);
    expect(mutate('IT BECOMES BLOCKING', 'IT TURNS')).toMatch(/does not say when the job becomes blocking/);
    expect(mutate(TRIGGER_DEV[1], 'deploy/compose/supervisor')).toMatch(/does not name deploy\/compose\/supervisor\/Dockerfile/);
  });

  it('is not in ci.yml, so ci-complete never waits for it, and docs/testing.md does not require it', () => {
    const ci = read('.github/workflows/ci.yml');
    const testing = read('docs/testing.md');
    expect(gateProblems(ci, testing)).toEqual([]);
    const job = '  hadolint:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: node scripts/hadolint-report.mjs\n';
    expect(ci.endsWith('\n'), 'ci.yml does not end in a newline, so the job below would not be one of its jobs').toBe(true);
    expect(gateProblems(`${ci}${job}`, testing)).toEqual([expect.stringMatching(/^ci\.yml runs hadolint in hadolint: ci-complete waits/)]);
    const required = '**Required status checks** on `main`, as this repository intends them, are five: ';
    expect(testing, `docs/testing.md does not open its required checks with "${required}"`).toContain(required);
    expect(gateProblems(ci, testing.replace(required, `${required}\`hadolint (report only)\`, `))).toEqual([
      expect.stringMatching(/required checks name hadolint/),
    ]);
  });

  it('ignores DL3008 and DL3018 and nothing else, and lets no pragma in a Dockerfile ignore more', () => {
    const config = read(CONFIG);
    expect(IGNORED).toEqual(['DL3008', 'DL3018']);
    expect(configProblems(config)).toEqual([]);
    const mutate = (from: string, to: string): string[] => {
      const next = config.replace(from, to);
      expect(next, from).not.toBe(config);
      return configProblems(next);
    };
    expect(mutate('  - DL3018\n', '  - DL3018\n  - DL3059\n')).toHaveLength(1);
    expect(mutate('  - DL3018\n', '')).toHaveLength(1);
    expect(mutate('disable-ignore-pragma: true', 'disable-ignore-pragma: false')).toHaveLength(1);
    expect(mutate('disable-ignore-pragma: true', 'disable-ignore-pragma: true\nfailure-threshold: error')).toHaveLength(1);
    expect(mutate('disable-ignore-pragma: true', 'disable-ignore-pragma: true\nno-fail: true')).toHaveLength(1);
    expect(mutate('disable-ignore-pragma: true', 'disable-ignore-pragma: true\noverride:\n  ignore:\n    - DL3059')).toHaveLength(1);
  });
});

describe("the hadolint report, run against a stubbed docker (11, and 9's exit)", () => {
  const image = (parseYaml(read(WORKFLOW)) as Workflow).jobs![JOB]!.env!['HADOLINT_IMAGE'] as string;
  const files = dockerfiles();
  const ok = (stdout: string): Ran => ({ status: 0, stdout, stderr: '' });
  /** One finding per file, naming the file. */
  const lintsAll = (args: string[]): Ran =>
    args[0] === 'pull' ? ok('') : ok(JSON.stringify([{ code: 'DL3059', line: 3, level: 'info', message: `a note on ${args.at(-1)}`, column: 1, file: args.at(-1) }]));
  /** A docker that answers as `answer` does, and writes down what it was asked and how long it was made to wait. */
  const stub = (answer: (args: string[]) => Ran) => {
    const calls: string[][] = [];
    const waits: number[] = [];
    const docker = (args: string[]): Ran => {
      calls.push(args);
      return answer(args);
    };
    return { calls, waits, docker, wait: async (ms: number) => void waits.push(ms) };
  };
  const at = (event: string, s: ReturnType<typeof stub>, env: Record<string, string> = {}) =>
    run({ root: REPO_ROOT, env: { HADOLINT_IMAGE: image, GITHUB_EVENT_NAME: event, ...env }, docker: s.docker, wait: s.wait, uid: 1001, gid: 118 });

  it('pulls the workflow’s image once, then lints each Dockerfile this file finds, one sandboxed run each', async () => {
    expect(files.length).toBeGreaterThan(10);
    const s = stub(lintsAll);
    const out = await at('pull_request', s);
    expect(s.calls[0]).toEqual(['pull', '--quiet', image]);
    expect(s.calls.slice(1)).toEqual(files.map((file) => lintArgs(image, file, { root: REPO_ROOT, uid: 1001, gid: 118 })));
    for (const args of s.calls.slice(1)) {
      const said = args.join(' ');
      expect(args.slice(0, 4)).toEqual(['run', '--rm', '--pull', 'never']);
      for (const flag of ['--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges', '--user 1001:118', `--volume ${REPO_ROOT}:/repo:ro`]) {
        expect(said).toContain(flag);
      }
      expect(args.slice(args.indexOf(image))).toEqual([image, '/bin/hadolint', '--config', CONFIG, '--no-fail', '--format', 'json', args.at(-1)]);
    }
    expect(out.code).toBe(0);
  });

  it('exits 0 on a pull request, a push and a dispatch when every Dockerfile has a finding: none fails the job', async () => {
    for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
      const out = await at(event, stub(lintsAll));
      expect(out.code, event).toBe(0);
      expect(out.markdown).toContain(`| **${files.length} Dockerfiles** | **${files.length}** | **0** | **${files.length}** |`);
      for (const file of files) expect(out.markdown).toContain(`### \`${file}\``);
      expect(out.lines.filter((l) => l.startsWith('::'))).toEqual([]);
    }
  });

  it('passes a pull request, and warns, when the image cannot be pulled; fails a push or a dispatch', async () => {
    for (const [event, code, annotation] of [['pull_request', 0, '::warning::'], ['push', 1, '::error::'], ['workflow_dispatch', 1, '::error::']] as const) {
      const s = stub(() => ({ status: 1, stdout: '', stderr: 'toomanyrequests: You have reached your unauthenticated pull rate limit' }));
      const out = await at(event, s);
      expect(out.code, event).toBe(code);
      expect(s.calls.map((c) => c[0]), 'it ran hadolint on an image it did not have').toEqual(['pull', 'pull', 'pull']);
      expect(s.waits).toEqual(PULL_DELAYS.map((d) => d * 1000));
      expect(out.markdown).toMatch(/### Not linted\n\nNothing was linted: .* was not pulled in 3 attempts \(the last: docker exited 1: toomanyrequests/);
      expect(out.lines.at(-1)).toMatch(new RegExp(`^${annotation}hadolint: ${files.length} of ${files.length} Dockerfiles not linted`));
    }
  });

  it('reads anything but a list of findings, or one of a rule the config ignores, as a file not linted', async () => {
    const odd = files[0]!;
    const answers: Array<[Ran, RegExp]> = [
      [{ status: 1, stdout: '', stderr: 'Error parsing config' }, /docker exited 1: Error parsing config/],
      [ok(''), /printed no list of findings \(nothing\)/],
      [ok('{"code":"DL3059"}'), /printed JSON that is not a list of findings/],
      [ok('[{"code":"DL3059"}]'), /a finding without a code, a line, a level and a message/],
      [ok(JSON.stringify([{ code: 'DL3008', line: 1, level: 'warning', message: 'Pin versions in apt get install' }])), /reported DL3008, which \.hadolint\.yaml ignores: the config was not read/],
      [{ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' }) }, /docker could not be run \(ETIMEDOUT\)/],
    ];
    for (const [answer, why] of answers) {
      for (const [event, code] of [['pull_request', 0], ['push', 1]] as const) {
        const out = await at(event, stub((args) => (args[0] === 'pull' || args.at(-1) !== odd ? lintsAll(args) : answer)));
        expect(out.code, `${event}: ${why.source}`).toBe(code);
        expect(out.markdown).toContain(`| \`${odd}\` | not linted | | |`);
        const line = out.markdown.split('\n').find((l) => l.startsWith(`- \`${odd}\`: `)) ?? '';
        expect(line, why.source).toMatch(why);
        // The other files were read all the same.
        expect(out.markdown).toContain(`| \`${files[1]!}\` | 1 | 0 | 1 |`);
      }
    }
  });

  it('runs nothing, and fails only outside a pull request, when HADOLINT_IMAGE is not hadolint by a release tag and its digest', async () => {
    for (const wrong of ['', 'hadolint/hadolint:v2.15.1', `hadolint/hadolint:latest@sha256:${'0'.repeat(64)}`, `ghcr.io/hadolint/hadolint:v2.15.1@sha256:${'0'.repeat(64)}`]) {
      for (const [event, code] of [['pull_request', 0], ['push', 1]] as const) {
        const s = stub(lintsAll);
        const out = await at(event, s, { HADOLINT_IMAGE: wrong });
        expect(s.calls, wrong).toEqual([]);
        expect(out.code, `${event} ${wrong}`).toBe(code);
        expect(out.markdown).toContain('Nothing was linted: HADOLINT_IMAGE is ');
      }
    }
  });

  it("pairs each rule this file holds with hadolint's code for it, as the header does", () => {
    expect(RULE_CODES).toEqual({
      'non-root': ['DL3002'],
      'numeric-user': ['DL3066'],
      'exec-form': ['DL3025'],
      pipefail: ['DL4006'],
      'no-add': ['DL3020'],
      tagged: ['DL3006', 'DL3007'],
    });
  });

  it("records in KNOWN_FINDINGS only Dockerfiles here and hadolint's codes, none the config ignores or EXCEPTIONS explain, each with its reason", () => {
    for (const [file, codes] of Object.entries(KNOWN_FINDINGS)) {
      expect(files, file).toContain(file);
      const excused = Object.keys(EXCEPTIONS[file] ?? {}).flatMap((rule) => RULE_CODES[rule as Rule]);
      for (const [code, why] of Object.entries(codes)) {
        expect(code).toMatch(/^(DL|SC)\d{4}$/);
        expect(IGNORED).not.toContain(code);
        expect(excused, `${file} ${code}: EXCEPTIONS explain it already`).not.toContain(code);
        expect(why.length, `${file} ${code}`).toBeGreaterThan(40);
      }
    }
  });

  it('calls known exactly what EXCEPTIONS or KNOWN_FINDINGS explain, with the reason, and names a known one hadolint did not report', () => {
    const [proxy, supervisor] = ['deploy/compose/docker-socket-proxy/Dockerfile', TRIGGER_DEV[1]];
    expect(knownAs(supervisor, 'DL3066')).toEqual({ by: 'EXCEPTIONS, numeric-user', why: EXCEPTIONS[supervisor]!['numeric-user'] });
    expect(knownAs(supervisor, 'DL4006')?.by).toBe('EXCEPTIONS, pipefail');
    expect(knownAs(proxy, 'DL3064')).toEqual({ by: 'KNOWN_FINDINGS', why: KNOWN_FINDINGS[proxy]!['DL3064'] });
    expect(knownAs(proxy, 'DL3059')).toBeNull();
    expect(knownAs('apps/api/Dockerfile', 'DL3066')).toBeNull();
    expect(knownAs(supervisor, 'constructor')).toBeNull();
    const finding = (code: string, line: number) => ({ code, line, level: 'warning', message: `${code} | <here>` });
    const out = report({
      image,
      event: 'push',
      files: [proxy, supervisor],
      results: [
        { file: proxy, findings: [finding('DL3064', 120)] },
        { file: supervisor, findings: [finding('DL3059', 10), finding('DL3066', 242)] },
      ],
    });
    expect(out.code).toBe(0);
    expect(out.markdown).toContain(`| \`${supervisor}\` | 2 | 1 | 1 |`);
    expect(out.markdown).toContain('| 242 | [DL3066](https://github.com/hadolint/hadolint/wiki/DL3066) | warning | DL3066 \\| &lt;here&gt; | EXCEPTIONS, numeric-user |');
    expect(out.markdown).toContain('| 10 | [DL3059](https://github.com/hadolint/hadolint/wiki/DL3059) | warning | DL3059 \\| &lt;here&gt; |  |');
    expect(out.markdown).toContain(`- **EXCEPTIONS, numeric-user**: ${EXCEPTIONS[supervisor]!['numeric-user']}`);
    const unreported = out.markdown.split('### Known, and not reported this run')[1] ?? '';
    expect(unreported).toContain(`\`${supervisor}\`: DL4006 (EXCEPTIONS, pipefail) is known, and hadolint did not report it here`);
    expect(out.markdown).toContain(`| 120 | [DL3064](https://github.com/hadolint/hadolint/wiki/DL3064) | warning | DL3064 \\| &lt;here&gt; | KNOWN_FINDINGS |`);
    expect(unreported, 'the proxy’s DL3064 was reported').not.toContain(`\`${proxy}\`: DL3064`);
    expect(unreported, 'the proxy has no exception since 2026-11-20').not.toContain(`\`${proxy}\`: DL30`);
    expect(out.markdown).toContain('**3 findings in 2 Dockerfiles linted of 2: 2 known, 1 to read.**');
  });
});
