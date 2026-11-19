// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOCKERFILE THAT ENDS AS ROOT, AND THE OTHER RULES A READING OF ONE HOLDS
 * IT TO (a read-only check of the repository, BlueLandscape, 2026-11-19: GEN-21
 * and GEN-20, the latter by hadolint 2.15.1's rules; workplan 0119).
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
 * true and shrinks as files are fixed.
 *
 * WHAT IS NOT HELD HERE, AND WHY. Packages installed without a version
 * (DL3008, DL3018): the bases are pinned by digest, a package at an exact
 * version stops the build the day Alpine or Debian ships the next one and
 * drops it from its mirror, and the image scan says when a package is behind;
 * whether to pin anyway is a decision left open (workplan 0119, 2026-11-19).
 * ShellCheck's notes inside a RUN: ShellCheck's to read, and each image's
 * build proves what its RUNs do. A HEALTHCHECK in every image (DL3057, off by
 * default in hadolint): compose gives each service its probe, or none on
 * purpose. hadolint itself, which nothing here installs. And a Dockerfile's
 * user against the image it builds on: a base that sets a user of its own, as
 * Stalwart's does, still ends as root by this file's reading when the
 * Dockerfile names none, which is how the check read it.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

export type Rule = 'non-root' | 'numeric-user' | 'exec-form' | 'pipefail' | 'no-add' | 'tagged';

/**
 * The files that keep a rule broken, by rule, with why. Each is checked to
 * break it still: one fixed since fails until it leaves this list.
 */
export const EXCEPTIONS: Readonly<Record<string, Partial<Record<Rule, string>>>> = {
  'deploy/compose/caddy/Dockerfile': {
    'non-root':
      'trigger-tls runs as root: on every stack that ran it, its volumes trigger_tls_data, with the CA `tls internal` minted, ' +
      "and trigger_tls_config are root's, and a user needs their ownership moved once first (workplan 0119, 2026-11-19)",
  },

  'deploy/compose/docker-socket-proxy/Dockerfile': {
    'non-root':
      "Tecnativa's docker-socket-proxy v0.5.0 as upstream ships it, `USER root` included. HAProxy connects to the host's Docker " +
      "socket, root:docker at mode 0660, whose group id differs from host to host, so another user would need each host's " +
      'docker group id passed in from its .env (group_add), for little: the socket is the power either way. The ' +
      "Dockerfile's WHY ROOT says so, and what managed.yml gives the proxy instead",
    'numeric-user': "upstream's own line, `USER root`: a-tag-upstream-never-rebuilds holds every instruction but the FROM and the check to upstream's",
  },

  'deploy/compose/pgbouncer/Dockerfile': {
    'numeric-user':
      "`USER root` for the one RUN apk needs and `USER postgres` after it, by the name upstream's config gives its user: " +
      "images.yml's build (pgbouncer) holds the built image's User to upstream's, and the RUN after it proves postgres is uid 70",
  },

  'deploy/compose/supervisor/Dockerfile': {
    'numeric-user':
      "upstream's `node` after the RUN as root that removes what nothing here runs, which a-binary-the-stack-never-runs reads " +
      'line by line; not in the lines this round read (workplan 0119, 2026-11-19)',
    pipefail: 'the RUN as root that removes what nothing here runs pipes in its walks, held line by line by a-binary-the-stack-never-runs; not in this round',
  },

  'deploy/compose/trigger.dev/Dockerfile': {
    'numeric-user':
      "upstream's `node` after the RUNs as root that remove what nothing here runs and purge the Debian packages nothing loads, " +
      'which a-binary-the-stack-never-runs and an-essential-nothing-runs read line by line; not in this round (workplan 0119, 2026-11-19)',
    pipefail: 'the RUNs as root that remove what nothing here runs pipe in their walks, held line by line by those two guards; not in this round',
  },

  'packages/testing/fixtures/stalwart/Dockerfile': {
    'non-root':
      'it names no USER, though its base runs as its own stalwart, uid and gid 2000; nothing here builds it, and the line that ' +
      'says so is a change of its own (workplan 0119, 2026-11-19)',
  },
};

/** Every Dockerfile in the repository, as git lists them, tracked or new. */
export function dockerfiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /(^|\/)(Dockerfile|Containerfile)([.-][^/]*)?$|\.(Dockerfile|Containerfile)$/i.test(f) && existsSync(join(REPO_ROOT, f)))
    .sort();
}

/** The Dockerfiles this was written against: the walk must find each, so it cannot pass on a short list. */
export const KNOWN = [
  'apps/api/Dockerfile',
  'apps/selfhost/Dockerfile',
  'apps/web/Dockerfile',
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
