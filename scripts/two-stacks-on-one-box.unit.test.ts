// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TWO STACKS ON ONE BOX, AND EVERY NAME FOLLOWS ITS PROJECT (workplan 0132 T1, D7, D9).
 *
 * On 2026-09-24 the owner decided to run a second compose project,
 * `ownpace-live`, beside the OTA stack, `ownpace-managed`, on the same machine
 * and the same Docker daemon (0132 D7). One daemon keeps two stacks apart by
 * NAMES and by nothing else, so every name has to belong to one of them. Three
 * kinds did not:
 *
 *   containers  17 services carried a fixed `container_name` (`ownpace-db`,
 *               `trigger-api`, ...). `docker compose -p` does not namespace
 *               `container_name`, so a second project could not start while the
 *               first one's containers existed, and a script that said
 *               `docker exec ownpace-db` reached whichever stack owned the name.
 *               The runbook's first example is the appliance's upgrade drill,
 *               which nearly took a live appliance down this way.
 *   networks    the supervisor starts every task run on the network named in
 *               `DOCKER_RUNNER_NETWORKS`, and that value was written out as
 *               `ownpace-managed_ownpace-network`. Under any other project, that
 *               stack's task runs would have joined the OTA stack's network,
 *               where `postgres` is the OTA stack's database (D9).
 *   volumes     `reset-trigger.sh` stopped its OWN stack's Trigger.dev
 *               containers and then removed `ownpace-managed_trigger_db_data` by
 *               name. Recipes printed for an operator to paste named
 *               `ownpace-managed_` volumes too: 13 lines in six files. Run or
 *               pasted in live's checkout, each would have acted on the OTA stack.
 *
 * WHAT IS ASSERTED, in two halves.
 *
 *   The first half reads the files that name things on the machine
 *   (`managed.yml`, every shell script under `deploy/compose/`, every workflow)
 *   and refuses a fixed stack name: a `container_name` not derived from the
 *   project, any of the 17 old container names used as a container, and the
 *   string `ownpace-managed` anywhere but the one default of the variable that
 *   selects the stack (`name:` in `managed.yml`). That holds in code, in a
 *   printed recipe and in a comment, because a comment's command gets pasted
 *   too. It also refuses any workflow that names `ownpace-live`: CI never
 *   touches live (T1g). And live's project written out as a name
 *   (`ownpace-live-…`, `ownpace-live_…`) anywhere at all.
 *
 *   Three more rules keep a script inside its own stack. Every `docker ps`
 *   filters by a name built from the project: the daemon holds both stacks,
 *   and the task runs' `runner-` names carry no project, so the smoke's
 *   runner-log watcher would have copied live's task-run logs into the OTA
 *   gate's public evidence. Every script that runs Compose asks the reader
 *   (`compose_project`) before its first Compose command, because Compose
 *   follows a name exported in the shell and the reader refuses one that
 *   disagrees with the checkout. The reader of shell text that tells a command
 *   from a printed recipe is checked to reach the end of every script.
 *
 *   The second half renders `managed.yml` the way Compose does, under two
 *   project names and two sets of port values. The two stacks may share no
 *   container name, volume, network or host port, and every network a stack's
 *   services or task runs join must start with that stack's own project name.
 *   The smoke's runner watcher must render to that stack's runner network. It
 *   then runs the one reader the scripts take the project from, and
 *   `reset-trigger.sh` itself, in each stack's checkout. The reader refuses a
 *   `.env` carrying live's exact marker (`stack-kind.sh`) whose project comes
 *   out as managed.yml's own name: a live checkout that forgot
 *   `COMPOSE_PROJECT_NAME` would otherwise drive the OTA stack with live's
 *   `.env` (0132 T1b, T1g). It reads the marker from the `stack-kind.sh`
 *   beside its own real file, so a directory that only links the reader in
 *   still tells; one with no `stack-kind.sh` there cannot tell and is refused
 *   as well. It names the keys, never a value. Last, it runs each
 *   script that reaches a stack through Compose in the OTA stack's checkout
 *   from a shell that exports live's name: each must refuse before its first
 *   `docker` call and leave the `.env` as it was.
 *
 * WHAT IT DOES NOT MAKE TRUE. Both stacks' `trigger-docker-proxy` hold the
 * host's Docker socket and may create containers on any network (0132 §1).
 * Names keep the stacks apart by configuration. They are not a boundary (D7).
 */

import { describe, it, expect } from 'vitest';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const MANAGED = 'deploy/compose/managed.yml';
/** The OTA stack's project: the default, and the one place it may be written. */
const OTA = 'ownpace-managed';
const LIVE = 'ownpace-live';
const DEFAULT_LINE = new RegExp(`^name: ${OTA}$`);

/** The fixed `container_name` values `managed.yml` carried until 0132 T1. */
const OLD_CONTAINER_NAMES = [
  'ownpace-db',
  'ownpace-pgbouncer',
  'trigger-db',
  'trigger-redis',
  'trigger-api',
  'trigger-clickhouse',
  'trigger-registry',
  'trigger-docker-proxy',
  'trigger-supervisor',
  'trigger-minio',
  'trigger-tls',
  'ownpace-idp',
  'ownpace-api',
  'ownpace-web',
  'ownpace-status',
  'ownpace-mailpit',
  'ownpace-nextcloud',
];

interface Source {
  file: string;
  text: string;
}
interface Line {
  file: string;
  n: number;
  line: string;
}

const sources: Source[] = [
  { file: MANAGED, text: read(MANAGED) },
  ...readdirSync(COMPOSE_DIR)
    .filter((f) => f.endsWith('.sh'))
    .sort()
    .map((f) => ({ file: `deploy/compose/${f}`, text: read(`deploy/compose/${f}`) })),
  ...readdirSync(WORKFLOW_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({ file: `.github/workflows/${f}`, text: read(`.github/workflows/${f}`) })),
];
const linesOf = (s: Source): Line[] =>
  s.text.split('\n').map((line, i) => ({ file: s.file, n: i + 1, line }));
const allLines = sources.flatMap(linesOf);
const where = (hits: Line[]): string[] => hits.map(({ file, n, line }) => `${file}:${n}: ${line.trim()}`);
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const scripts = sources.filter((s) => s.file.startsWith('deploy/compose/') && s.file.endsWith('.sh'));

/**
 * Which lines of a shell script bash reads as code: not a comment line, not
 * inside a heredoc, and not the continuation of a quoted string that an
 * earlier line opened. Printed recipes live in exactly those places, and a
 * recipe is not a command the script runs. `open` is the state the reader was
 * left in at the end of the file: anything but null means it lost its place,
 * and then its answers are not to be trusted.
 */
function shellCode(s: Source): { lines: Array<Line & { code: boolean }>; open: string | null } {
  const lines: Array<Line & { code: boolean }> = [];
  let quote: '"' | "'" | null = null;
  const heredocs: Array<{ delim: string; strip: boolean }> = [];
  s.text.split('\n').forEach((line, i) => {
    const here = heredocs[0];
    if (here) {
      if ((here.strip ? line.replace(/^\t+/, '') : line) === here.delim) heredocs.shift();
      lines.push({ file: s.file, n: i + 1, line, code: false });
      return;
    }
    lines.push({ file: s.file, n: i + 1, line, code: quote === null && !/^\s*#/.test(line) });
    for (let j = 0; j < line.length; j += 1) {
      const c = line[j]!;
      if (quote === "'") {
        if (c === "'") quote = null;
      } else if (quote === '"') {
        if (c === '\\') j += 1;
        else if (c === '"') quote = null;
      } else if (c === '\\') {
        j += 1;
      } else if (c === '#' && (j === 0 || /\s/.test(line[j - 1]!))) {
        break;
      } else if (c === "'" || c === '"') {
        quote = c;
      } else if (line.startsWith('<<', j) && !line.startsWith('<<<', j)) {
        const m = /^<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(line.slice(j));
        if (m) {
          heredocs.push({ delim: m[3]!, strip: m[1] === '-' });
          j += m[0].length - 1;
        }
      }
    }
  });
  const open = heredocs[0] ? `heredoc ${heredocs[0].delim}` : quote;
  return { lines, open };
}

/**
 * A line that RUNS Compose, as opposed to one that prints a Compose command
 * for somebody to paste: the command itself, the `COMPOSE` array expanded as
 * a command, a command substitution, or a command string the script `eval`s.
 */
function runsCompose(line: string, evals: boolean): boolean {
  return (
    /^\s*(?:(?:if|until|while|then|do|else|!)\s+)*(?:[A-Za-z_]\w*=\S*\s+)*docker\s+compose\b/.test(line) ||
    /\$\(\s*docker\s+compose\b/.test(line) ||
    line.includes('"${COMPOSE[@]}"') ||
    (evals && /^\s*(?:local\s+)?[A-Za-z_]\w*="docker\s+compose\b/.test(line))
  );
}

/** A call of the project reader, not its definition or a mention in prose. */
const READER_CALL = /\bcompose_project\s+"/;

// ---------------------------------------------------------------------------
// managed.yml, parsed
// ---------------------------------------------------------------------------

type Ports = Array<string | number | { published?: string | number; host_ip?: string }>;
interface Service {
  container_name?: string;
  ports?: Ports;
  networks?: string[] | Record<string, { aliases?: string[] } | null>;
  environment?: Record<string, unknown> | string[];
}
interface Compose {
  name?: string;
  services: Record<string, Service>;
  networks?: Record<string, { name?: string; external?: boolean } | null>;
  volumes?: Record<string, { name?: string; external?: boolean } | null>;
}
const compose = parseYaml(read(MANAGED)) as Compose;

/** Names that still mean something on a stack's own network: services and alias defaults. */
const networkNames = new Set<string>(Object.keys(compose.services));
for (const svc of Object.values(compose.services)) {
  if (svc.networks && !Array.isArray(svc.networks)) {
    for (const net of Object.values(svc.networks)) {
      for (const alias of net?.aliases ?? []) {
        const dflt = /:-([^}]+)\}$/.exec(alias)?.[1];
        networkNames.add(dflt ?? alias);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The first half: no fixed stack name where a stack is chosen
// ---------------------------------------------------------------------------

describe('the first half: nothing names a stack that the project does not', () => {
  it('read the files it guards', () => {
    // Vacuity: a guard that read nothing passes on everything.
    expect(sources.filter((s) => s.file.endsWith('.sh')).length).toBeGreaterThan(20);
    expect(sources.filter((s) => s.file.startsWith('.github/')).length).toBeGreaterThan(5);
    expect(
      linesOf(sources[0]!).filter(({ line }) => DEFAULT_LINE.test(line)),
      `managed.yml must keep \`name: ${OTA}\`: the OTA stack's volumes and networks are named after it`,
    ).toHaveLength(1);
    expect(Object.keys(compose.services).length).toBeGreaterThanOrEqual(OLD_CONTAINER_NAMES.length);
  });

  it('every container_name in managed.yml is derived from the project', () => {
    const fixed = linesOf(sources[0]!).filter(
      ({ line }) => /^\s+container_name:/.test(line) && !line.includes('${COMPOSE_PROJECT_NAME}'),
    );
    expect(
      where(fixed),
      '`docker compose -p` does not namespace container_name: a second project cannot start\n' +
        'while these exist, and a script naming one reaches whichever stack owns it',
    ).toEqual([]);
  });

  it('no network or volume name is written out with the OTA project in it (D9)', () => {
    const hits = allLines.filter(({ line }) => line.includes(`${OTA}_`));
    expect(
      where(hits),
      `a network or volume name is always built from the project: in live's checkout,\n` +
        `\`${OTA}_…\` is the OTA stack's`,
    ).toEqual([]);
  });

  it(`\`${OTA}\` is written only once, as the default in managed.yml`, () => {
    const hits = allLines.filter(
      ({ file, line }) => line.includes(OTA) && !(file === MANAGED && DEFAULT_LINE.test(line)),
    );
    expect(
      where(hits),
      'the stack is chosen by COMPOSE_PROJECT_NAME, then managed.yml\'s `name:`; a second\n' +
        'copy of the default is a place that does not follow when live sets its own',
    ).toEqual([]);
  });

  it('none of the 17 old container names is used as a container', () => {
    // A name that is no longer a service or an alias names a container that no
    // longer exists: any mention of it is wrong, comments included. A name that
    // is still a service (`trigger-api`) is fine in `docker compose … logs
    // trigger-api`, which Compose scopes to the project, and wrong as the
    // target of a bare `docker` container command, or as a script's default.
    const containerOnly = OLD_CONTAINER_NAMES.filter((n) => !networkNames.has(n));
    const verb =
      '(?:exec|logs|inspect|restart|stop|start|rm|kill|cp|top|port|wait|stats|attach|update|pause|unpause|rename)';
    const opt = `(?:\\s+-{1,2}[A-Za-z][-A-Za-z]*(?:=\\S+)?(?:\\s+(?:'[^']*'|"[^"]*"|[^\\s'"-]\\S*))?)`;
    const patterns = OLD_CONTAINER_NAMES.map((name) => ({
      name,
      res: [
        ...(containerOnly.includes(name)
          ? [new RegExp(`(?<![A-Za-z0-9_./-])${esc(name)}(?![A-Za-z0-9_-])`)]
          : []),
        new RegExp(`\\bdocker\\s+(?:container\\s+)?${verb}${opt}*\\s+["']?${esc(name)}(?![A-Za-z0-9_-])`),
        new RegExp(`[A-Z_]*CONTAINER[A-Z_]*(?::-|=)["']?${esc(name)}(?![A-Za-z0-9_-])`),
        new RegExp(`\\bname=\\^?${esc(name)}(?![A-Za-z0-9_-])`),
      ],
    }));
    const hits = allLines.flatMap((l) =>
      patterns
        .filter(({ res }) => res.some((re) => re.test(l.line)))
        .map(({ name }) => ({ ...l, line: `[${name}] ${l.line.trim()}` })),
    );
    expect(
      where(hits),
      'reach a service with `docker compose -f …/managed.yml exec|logs <service>`, or by a\n' +
        'name derived from the project, never by a fixed container name',
    ).toEqual([]);
  });

  it('no workflow names ownpace-live: CI never touches live (T1g)', () => {
    const hits = allLines.filter(({ file, line }) => file.startsWith('.github/') && line.includes(LIVE));
    expect(where(hits)).toEqual([]);
  });

  it("nothing is named with live's project written out", () => {
    // The OTA stack's name has a case of its own above; this is the same slip
    // the other way round. `ownpace-live-db`, `ownpace-live_ownpace-network`
    // or `ownpace-live_zitadel_machinekey` in a script is live's container,
    // network or volume whichever checkout runs it. Prose that names the
    // stack itself is fine.
    const hits = allLines.filter(({ line }) => new RegExp(`${esc(LIVE)}[-_]`).test(line));
    expect(
      where(hits),
      "a name is built from the project; written out, it is live's in the OTA stack's checkout too",
    ).toEqual([]);
  });

  it("every `docker ps` lists this stack's containers only", () => {
    // `docker ps` asks the whole daemon, and the daemon holds both stacks. The
    // smoke's runner-log watcher took every `runner-*` container, and the task
    // runs' names carry no project, so beside live it would have copied live's
    // task-run logs, and the task environment they print, into the OTA gate's
    // public job log and evidence. It would also have counted a live runner as
    // the OTA stack's own. A listing is narrowed by a `--filter` built from the
    // project, or from a name derived from it. Comments are prose.
    //
    // ONE SCRIPT ASKS THE WHOLE DAEMON ON PURPOSE: the exposure check (0132 T3
    // (b)) covers both stacks, the site and the demo's Stalwart in one run. It
    // reads names and ports and prints no log, no environment and no address;
    // `exposure-check.unit.test.ts` holds what it prints.
    const wholeDaemon = new Set(['deploy/compose/exposure-check.sh']);
    expect(
      sources.filter((s) => wholeDaemon.has(s.file)).map((s) => s.file),
      'an exemption for a script that is not there exempts nothing, and hides the next one',
    ).toEqual([...wholeDaemon]);
    const hits: Line[] = [];
    let listings = 0;
    for (const s of sources.filter((x) => x.file !== MANAGED && !wholeDaemon.has(x.file))) {
      const derived = new Set(['COMPOSE_PROJECT', 'COMPOSE_PROJECT_NAME']);
      for (let grew = true; grew; ) {
        grew = false;
        for (const m of s.text.matchAll(/^\s*(?:local\s+|export\s+|readonly\s+)?([A-Za-z_]\w*)=(.*)$/gm)) {
          const [, name, value] = m;
          if (derived.has(name!)) continue;
          if ([...derived].some((d) => new RegExp(`\\$\\{?${d}\\b`).test(value!))) {
            derived.add(name!);
            grew = true;
          }
        }
      }
      const byProject = new RegExp(
        `--filter[= ]["']?(?:network|label|name|volume)=[^\\s"']*\\$\\{?(?:${[...derived].join('|')})\\b`,
      );
      for (const l of linesOf(s)) {
        if (/^\s*#/.test(l.line) || !/\bdocker\s+(?:container\s+)?(?:ps|ls|list)\b/.test(l.line)) continue;
        listings += 1;
        if (!byProject.test(l.line)) hits.push(l);
      }
    }
    expect(listings, 'no `docker ps` found at all: the smoke has one').toBeGreaterThan(0);
    expect(
      where(hits),
      "filter by the project's network or label, e.g. --filter \"network=${COMPOSE_PROJECT}_ownpace-network\"",
    ).toEqual([]);
  });

  it('reads every script to its end without losing its place', () => {
    // The next case trusts this reader to tell a command from a printed
    // recipe. A heredoc or a quote it failed to close would hide the rest of
    // the file from it.
    const lost = scripts.map((s) => ({ file: s.file, open: shellCode(s).open })).filter((x) => x.open);
    expect(lost).toEqual([]);
    const counted = scripts.flatMap((s) => {
      const evals = shellCode(s).lines.some((l) => l.code && /\beval\b/.test(l.line));
      return shellCode(s).lines.filter((l) => l.code && runsCompose(l.line, evals));
    });
    expect(counted.length, 'found almost no Compose commands: the reader is blind').toBeGreaterThan(20);
  });

  it('every script that runs Compose asks the project reader first', () => {
    // Compose follows a COMPOSE_PROJECT_NAME exported in the shell over the
    // checkout's own .env. The reader refuses that mismatch, so a script is
    // safe only when it asks before its first Compose command. On the branch
    // that added the reader, operator.sh, seed-managed.sh and
    // trigger-magic-link.sh never asked, and trigger-credentials.sh asked
    // after it had copied the other stack's Trigger.dev key into this
    // checkout's .env.
    const late: string[] = [];
    for (const s of scripts.filter((x) => !x.file.endsWith('/env-read.sh'))) {
      const { lines } = shellCode(s);
      const evals = lines.some((l) => l.code && /\beval\b/.test(l.line));
      const first = lines.find((l) => l.code && runsCompose(l.line, evals));
      if (!first) continue;
      const reader = lines.find((l) => l.code && READER_CALL.test(l.line));
      if (!reader || reader.n > first.n) {
        late.push(
          `${s.file}:${first.n}: runs Compose (${first.line.trim()}) ` +
            (reader ? `before the reader at line ${reader.n}` : 'and never asks the reader'),
        );
      }
    }
    expect(
      late,
      'call `compose_project "${SCRIPT_DIR}" >/dev/null || exit 1` (from env-read.sh) before the first Compose command',
    ).toEqual([]);
  });

  it('the persisted .env and the Trigger.dev dumps default to ~/.persistent/<project>', () => {
    const persisted = allLines.flatMap((l) =>
      [...l.line.matchAll(/\.persistent\/([^\s"'`)]*)/g)].map((m) => ({ ...l, rest: m[1] ?? '' })),
    );
    expect(persisted.length, 'no ~/.persistent path found at all').toBeGreaterThan(5);
    expect(
      where(persisted.filter(({ rest }) => !/^(\$\{COMPOSE_PROJECT\}|<project>)(?![A-Za-z0-9_-])/.test(rest))),
      'each stack keeps its .env and dumps in its own directory, named after its project',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The second half: two stacks rendered side by side
// ---------------------------------------------------------------------------

/**
 * Compose's `${…}` interpolation, the part of it `managed.yml` uses. The
 * defaults nest (`${A:-http://${B:-b}:${C:-3126}}`), so this reads a whole
 * `${…}` before it resolves it.
 */
function interpolate(s: string, env: Record<string, string>): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c !== '$') {
      out += c;
      i += 1;
    } else if (s[i + 1] === '$') {
      out += '$';
      i += 2;
    } else if (s[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      for (; j < s.length; j += 1) {
        if (s[j] === '{') depth += 1;
        if (s[j] === '}') depth -= 1;
        if (depth === 0) break;
      }
      if (depth !== 0) throw new Error(`unterminated \${ in ${s}`);
      out += resolve(s.slice(i + 2, j), env);
      i = j + 1;
    } else {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i + 1))?.[0];
      if (name) {
        out += env[name] ?? '';
        i += 1 + name.length;
      } else {
        out += c;
        i += 1;
      }
    }
  }
  return out;
}

function resolve(body: string, env: Record<string, string>): string {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([\s\S]*))?$/.exec(body);
  if (!m) throw new Error(`cannot interpolate \${${body}}`);
  const [, name, op, rest = ''] = m;
  const value = env[name!];
  const set = value !== undefined;
  const filled = set && value !== '';
  switch (op) {
    case undefined:
      return value ?? '';
    case ':-':
      return filled ? value : interpolate(rest, env);
    case '-':
      return set ? value : interpolate(rest, env);
    case ':?':
    case '?':
      if (op === ':?' ? !filled : !set) throw new Error(`${name} is required: ${rest}`);
      return value ?? '';
    case ':+':
      return filled ? interpolate(rest, env) : '';
    case '+':
      return set ? interpolate(rest, env) : '';
    default:
      throw new Error(`unknown operator ${op} in \${${body}}`);
  }
}

/** Every `*_PORT` a published port reads, in the order the file uses them. */
const portVariables = [
  ...new Set(
    Object.values(compose.services).flatMap((svc) =>
      (svc.ports ?? []).flatMap((p) =>
        [...JSON.stringify(p).matchAll(/\$\{([A-Z_]+_PORT)\b/g)].map((m) => m[1]!),
      ),
    ),
  ),
];

interface Stack {
  project: string;
  containers: string[];
  volumes: string[];
  networks: string[];
  /** Every network a service joins, by its real name. */
  joined: Array<{ service: string; network: string }>;
  /** The networks the supervisor starts task runs on. */
  runners: string[];
  hostPorts: Array<{ service: string; port: string }>;
}

/** What Compose would name everything, for one project and one `.env`. */
function render(project: string, dotenv: Record<string, string>): Stack {
  const env = { ...dotenv, COMPOSE_PROJECT_NAME: project };
  const topName = (
    key: string,
    def: { name?: string; external?: boolean } | null | undefined,
  ): string => {
    if (def?.external) return def.name ? interpolate(def.name, env) : key;
    if (def?.name) return interpolate(def.name, env);
    return `${project}_${key}`;
  };
  const networks = Object.fromEntries(
    Object.entries(compose.networks ?? {}).map(([k, d]) => [k, topName(k, d)]),
  );
  const volumes = Object.entries(compose.volumes ?? {}).map(([k, d]) => topName(k, d));
  const stack: Stack = {
    project,
    containers: [],
    volumes,
    networks: Object.values(networks),
    joined: [],
    runners: [],
    hostPorts: [],
  };
  for (const [key, svc] of Object.entries(compose.services)) {
    stack.containers.push(
      svc.container_name ? interpolate(svc.container_name, env) : `${project}-${key}-1`,
    );
    const keys = !svc.networks
      ? ['default']
      : Array.isArray(svc.networks)
        ? svc.networks
        : Object.keys(svc.networks);
    for (const k of keys) {
      stack.joined.push({ service: key, network: networks[k] ?? `${project}_${k}` });
    }
    const envEntries = Array.isArray(svc.environment)
      ? svc.environment.map((e) => e.split('=', 2) as [string, string])
      : Object.entries(svc.environment ?? {});
    for (const [k, v] of envEntries) {
      if (k === 'DOCKER_RUNNER_NETWORKS') {
        stack.runners.push(...interpolate(String(v), env).split(',').map((n) => n.trim()));
      }
    }
    for (const p of svc.ports ?? []) {
      if (typeof p === 'object') {
        if (p.published !== undefined) {
          stack.hostPorts.push({ service: key, port: interpolate(String(p.published), env) });
        }
        continue;
      }
      const parts = interpolate(String(p), env).replace(/\/(tcp|udp)$/, '').split(':');
      // [ip:]host:container, or a bare container port Docker picks a host port for.
      if (parts.length === 1) continue;
      const host = parts.length === 3 ? parts[1]! : parts[0]!;
      if (!/^\d+$/.test(host)) throw new Error(`${key}: cannot read the host port of ${String(p)}`);
      stack.hostPorts.push({ service: key, port: host });
    }
  }
  return stack;
}

/** The OTA stack keeps compose's defaults; live gets a port of its own for each. */
const ota = render(OTA, {});
const live = render(
  LIVE,
  Object.fromEntries(portVariables.map((v, i) => [v, String(20001 + i)])),
);

const shared = (a: string[], b: string[]): string[] => a.filter((x) => b.includes(x));

describe('the second half: the OTA stack and live, rendered side by side', () => {
  it('rendered both stacks in full', () => {
    // Vacuity: an empty rendering shares nothing and would pass every case.
    expect(ota.containers.length).toBe(Object.keys(compose.services).length);
    expect(ota.volumes.length).toBeGreaterThanOrEqual(10);
    expect(ota.networks.length).toBeGreaterThanOrEqual(2);
    expect(ota.runners.length, 'no DOCKER_RUNNER_NETWORKS found in managed.yml').toBeGreaterThan(0);
    expect(portVariables.length).toBeGreaterThanOrEqual(8);
    expect(live.hostPorts.length).toBe(ota.hostPorts.length);
  });

  it('share no container name', () => {
    expect(shared(ota.containers, live.containers)).toEqual([]);
  });

  it('share no volume', () => {
    expect(shared(ota.volumes, live.volumes)).toEqual([]);
  });

  it('share no network, the task runs\' included', () => {
    expect(
      shared(
        [...ota.networks, ...ota.runners, ...ota.joined.map((j) => j.network)],
        [...live.networks, ...live.runners, ...live.joined.map((j) => j.network)],
      ),
    ).toEqual([]);
  });

  it('share no host port, once each stack sets its own', () => {
    // A port written as a number rather than a variable collides whatever the
    // two `.env` files say.
    expect(
      shared(
        ota.hostPorts.map((p) => p.port),
        live.hostPorts.map((p) => p.port),
      ),
    ).toEqual([]);
  });

  for (const stack of [ota, live]) {
    it(`every network ${stack.project}'s services join starts with its project name (D9)`, () => {
      const foreign = stack.joined.filter(({ network }) => !network.startsWith(`${stack.project}_`));
      expect(foreign.map(({ service, network }) => `${service} joins ${network}`)).toEqual([]);
    });

    it(`${stack.project}'s task runs start on a network of its own (D9)`, () => {
      expect(
        stack.runners.filter((n) => !n.startsWith(`${stack.project}_`) || !stack.networks.includes(n)),
        'DOCKER_RUNNER_NETWORKS names a network this stack does not create: its task runs\n' +
          'would join another stack\'s network, or none',
      ).toEqual([]);
    });

    it(`the smoke run in ${stack.project}'s checkout watches ${stack.project}'s task runs, and no others`, () => {
      // The runner-log watcher tells the two stacks' task runs apart by the one
      // thing that differs: the network the supervisor starts them on. So its
      // filter has to render to that stack's DOCKER_RUNNER_NETWORKS.
      const smoke = read('deploy/compose/smoke-managed.sh');
      const watcher = /docker ps --filter "network=([^"]+)"[^\n]*grep '\^runner-'/.exec(smoke);
      expect(watcher, "smoke-managed.sh's runner watcher lists every runner-* container on the daemon").not.toBeNull();
      const network = interpolate(watcher![1]!, { COMPOSE_PROJECT: stack.project });
      expect(stack.runners).toContain(network);
    });
  }
});

// ---------------------------------------------------------------------------
// The scripts take the project the way Compose does
// ---------------------------------------------------------------------------

/**
 * A copy of the compose directory's reader and `managed.yml`, with an optional
 * `.env`, and `compose_project` run in it. Compose reads the project from
 * COMPOSE_PROJECT_NAME in the environment, then from the `.env` beside the
 * file, then from its `name:`. Checked with Compose 5.1.1 on 2026-09-27: a
 * variable that is SET BUT EMPTY in the environment still wins over the
 * `.env`, and then falls through to `name:`.
 */
function projectOf(opts: { dotenv?: string; env?: string; withoutMarker?: boolean; linked?: boolean }): {
  status: number | null;
  out: string;
  err: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'two-stacks-'));
  try {
    const files = ['env-read.sh', 'managed.yml', ...(opts.withoutMarker ? [] : ['stack-kind.sh'])];
    for (const f of files) {
      // `linked`: the reader and managed.yml linked to the repository's, as a
      // fixture that runs a script's preamble lays them out.
      if (opts.linked) symlinkSync(join(COMPOSE_DIR, f), join(dir, f));
      else copyFileSync(join(COMPOSE_DIR, f), join(dir, f));
    }
    if (opts.dotenv !== undefined) writeFileSync(join(dir, '.env'), opts.dotenv);
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
    if (opts.env !== undefined) env.COMPOSE_PROJECT_NAME = opts.env;
    const r = spawnSync('bash', ['-c', '. "$1/env-read.sh" && compose_project "$1"', '_', dir], {
      env,
      encoding: 'utf8',
    });
    return { status: r.status, out: r.stdout, err: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("each stack's scripts find their own stack", () => {
  it("with nothing set, the project is managed.yml's own name", () => {
    expect(projectOf({})).toMatchObject({ status: 0, out: OTA });
    expect(projectOf({ dotenv: 'POSTGRES_PORT=55432\n' })).toMatchObject({ status: 0, out: OTA });
    expect(projectOf({ dotenv: 'COMPOSE_PROJECT_NAME=\n' })).toMatchObject({ status: 0, out: OTA });
  });

  it("live's .env selects live, quoted or not", () => {
    expect(projectOf({ dotenv: `COMPOSE_PROJECT_NAME=${LIVE}\n` })).toMatchObject({ status: 0, out: LIVE });
    expect(projectOf({ dotenv: `COMPOSE_PROJECT_NAME='${LIVE}'   # the alpha\n` })).toMatchObject({
      status: 0,
      out: LIVE,
    });
  });

  it('a shell that agrees with the checkout is followed', () => {
    // The bring-up sources the .env with `set -a`, so its own children see the
    // file's value in the environment too.
    expect(projectOf({ dotenv: `COMPOSE_PROJECT_NAME=${LIVE}\n`, env: LIVE })).toMatchObject({
      status: 0,
      out: LIVE,
    });
    expect(projectOf({ env: OTA })).toMatchObject({ status: 0, out: OTA });
    expect(projectOf({ env: '' })).toMatchObject({ status: 0, out: OTA });
  });

  it("a shell that disagrees is refused, because Compose would follow the shell into the other stack", () => {
    // `set -a; . deploy/compose/.env` in one checkout, then a script in the
    // other: Compose prefers the exported name, even an empty one, over the
    // checkout's own file. Following it would act on the other stack.
    for (const [dotenv, env] of [
      [`COMPOSE_PROJECT_NAME=${LIVE}\n`, ''],
      [`COMPOSE_PROJECT_NAME=${LIVE}\n`, OTA],
      ['', LIVE],
    ] as const) {
      const r = projectOf({ dotenv, env });
      expect(r.status, `.env ${JSON.stringify(dotenv)}, shell ${JSON.stringify(env)}`).not.toBe(0);
      expect(r.out).toBe('');
      expect(r.err).toContain('unset COMPOSE_PROJECT_NAME');
    }
  });

  it('refuses a name Compose would refuse, and says which key to fix', () => {
    const r = projectOf({ dotenv: 'COMPOSE_PROJECT_NAME=Ownpace.Live\n' });
    expect(r.status).not.toBe(0);
    expect(r.out).toBe('');
    expect(r.err).toContain('COMPOSE_PROJECT_NAME');
  });

  // Live's .env carries its marker, `STACK_KIND=production` (stack-kind.sh),
  // and `COMPOSE_PROJECT_NAME=ownpace-live` (0132 T1b). Without the second
  // line the reader fell back to managed.yml's `name:`, and every script in
  // live's checkout drove the OTA stack with live's .env: live's secrets,
  // ports and production names on the OTA stack's containers and volumes.
  const MARKED = [
    'STACK_KIND=production\n',
    "STACK_KIND='Production'   # the alpha\n",
    'export STACK_KIND=" production "\n',
  ];

  it("live's marker on the OTA stack's project is refused, naming the keys and never a value", () => {
    const cases: Array<{ dotenv: string; env?: string }> = [
      ...MARKED.map((m) => ({ dotenv: `POSTGRES_PORT=55432\n${m}` })),
      { dotenv: `COMPOSE_PROJECT_NAME=${OTA}\n${MARKED[0]}` },
      // A shell that agrees with the checkout is followed, into the same refusal.
      { dotenv: MARKED[0]!, env: OTA },
      { dotenv: MARKED[0]!, env: '' },
    ];
    for (const c of cases) {
      const r = projectOf(c);
      expect(r.status, `.env ${JSON.stringify(c.dotenv)}, shell ${JSON.stringify(c.env)}: ${r.out}`).not.toBe(0);
      expect(r.out).toBe('');
      expect(r.err).toContain('STACK_KIND');
      expect(r.err).toContain(`COMPOSE_PROJECT_NAME=${LIVE}`);
      expect(r.err.toLowerCase(), 'a value from the .env was printed').not.toContain('production');
    }
  });

  it("live's marker with live's project is live", () => {
    for (const m of MARKED) {
      expect(projectOf({ dotenv: `COMPOSE_PROJECT_NAME=${LIVE}\n${m}` })).toMatchObject({ status: 0, out: LIVE });
    }
    expect(projectOf({ dotenv: `${MARKED[0]}COMPOSE_PROJECT_NAME='${LIVE}'\n`, env: LIVE })).toMatchObject({
      status: 0,
      out: LIVE,
    });
  });

  it("only live's exact marker is refused here, as stack_is_live reads it", () => {
    // The reader answers every script, so it takes the exact marker. The
    // cautious reading, slips included, is the refusals' (stack_may_be_live).
    for (const dotenv of ['STACK_KIND=\n', 'STACK_KIND=prod\n', '# STACK_KIND=production\n']) {
      expect(projectOf({ dotenv }), dotenv).toMatchObject({ status: 0, out: OTA });
    }
  });

  it('a checkout whose stack-kind.sh is missing cannot tell, and is refused rather than taken for the OTA stack', () => {
    const r = projectOf({ dotenv: 'POSTGRES_PORT=55432\n', withoutMarker: true });
    expect(r.status).not.toBe(0);
    expect(r.out).toBe('');
    expect(r.err).toContain('stack-kind.sh');
  });

  it('a reader linked into a directory without stack-kind.sh finds the marker beside its own real file', () => {
    // PR #1264's guard runs the smoke's preamble in a directory that links
    // env-read.sh and managed.yml and nothing else. The reader looked for
    // stack-kind.sh beside the .env there, and refused every such run.
    expect(projectOf({ dotenv: 'POSTGRES_PORT=55432\n', withoutMarker: true, linked: true })).toMatchObject({
      status: 0,
      out: OTA,
    });
    const r = projectOf({ dotenv: MARKED[0]!, withoutMarker: true, linked: true });
    expect(r.status).not.toBe(0);
    expect(r.err).toContain(`COMPOSE_PROJECT_NAME=${LIVE}`);
    expect(r.err, 'refused for a missing stack-kind.sh, not for the marker').not.toContain('cannot read');
  });
});

/**
 * `reset-trigger.sh`, run for real with a `docker` that only writes down what
 * it was asked. The one script here that removes a volume by name.
 */
function resetTrigger(dotenv: string): { status: number | null; calls: string; err: string } {
  const dir = mkdtempSync(join(tmpdir(), 'two-stacks-reset-'));
  try {
    const compose = join(dir, 'deploy', 'compose');
    const bin = join(dir, 'bin');
    mkdirSync(compose, { recursive: true });
    mkdirSync(bin);
    for (const f of ['reset-trigger.sh', 'env-read.sh', 'stack-kind.sh', 'env-upsert.sh', 'managed.yml']) {
      copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    }
    writeFileSync(join(compose, '.env'), dotenv);
    const log = join(dir, 'docker.log');
    writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho "$*" >> "${log}"\n`);
    chmodSync(join(bin, 'docker'), 0o755);
    writeFileSync(log, '');
    const r = spawnSync('bash', [join(compose, 'reset-trigger.sh'), '--yes'], {
      env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: dir },
      encoding: 'utf8',
    });
    return { status: r.status, calls: readFileSync(log, 'utf8'), err: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('reset-trigger.sh removes its own stack\'s Trigger.dev database, and no other', () => {
  it("in live's checkout, live's volume", () => {
    const r = resetTrigger(`COMPOSE_PROJECT_NAME=${LIVE}\nTRIGGER_PROJECT_REF=proj_x\n`);
    expect(r.status, r.err).toBe(0);
    expect(r.calls).toContain(`volume rm ${LIVE}_trigger_db_data`);
    expect(r.calls).not.toContain(OTA);
  });

  it("in the OTA stack's checkout, the OTA stack's", () => {
    const r = resetTrigger('TRIGGER_PROJECT_REF=proj_x\n');
    expect(r.status, r.err).toBe(0);
    expect(r.calls).toContain(`volume rm ${OTA}_trigger_db_data`);
    expect(r.calls).not.toContain(LIVE);
  });
});

/**
 * A script run in the OTA stack's checkout from a shell that still exports
 * live's name (`set -a; . ~/ownpace-live/deploy/compose/.env` earlier in the
 * same shell). `docker` and `pnpm` only write down what they were asked, and
 * `docker` answers the way the other stack would: the queries with live's
 * Trigger.dev key, `port` with live's published port, `logs` with live's link.
 */
function inOtaCheckout(
  script: string,
  args: string[],
  shell: { COMPOSE_PROJECT_NAME?: string },
): { status: number | null; calls: string; err: string; envBefore: string; envAfter: string } {
  const dir = mkdtempSync(join(tmpdir(), 'two-stacks-shell-'));
  try {
    const compose = join(dir, 'deploy', 'compose');
    const bin = join(dir, 'bin');
    mkdirSync(compose, { recursive: true });
    mkdirSync(bin);
    for (const f of readdirSync(COMPOSE_DIR).filter((x) => x.endsWith('.sh') || x === 'managed.yml')) {
      copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    }
    // The OTA stack's .env names no project, on purpose (managed.env.example).
    const envBefore = [
      'POSTGRES_USER=openmigrate',
      'POSTGRES_PASSWORD=ota-stub-password',
      'POSTGRES_DB=openmigrate',
      'JWT_SECRET=ota-stub-jwt',
      'SECRET_ENCRYPTION_KEY=ota-stub-key',
      'TRIGGER_PROJECT_REF=proj_OTAref',
      'TRIGGER_SECRET_KEY=tr_prod_OTAkey',
      '',
    ].join('\n');
    writeFileSync(join(compose, '.env'), envBefore);
    const log = join(dir, 'calls.log');
    writeFileSync(log, '');
    writeFileSync(
      join(bin, 'docker'),
      [
        '#!/usr/bin/env bash',
        `echo "docker $*" >> "${log}"`,
        'case "$*" in',
        '  *"exec -T trigger-db"*)',
        '    sql="$(cat)"',
        '    case "$sql" in',
        "      *information_schema*) printf 'Project.externalRef\\nProject.id\\nProject.name\\nRuntimeEnvironment.apiKey\\nRuntimeEnvironment.slug\\nRuntimeEnvironment.projectId\\n' ;;",
        "      *) printf 'proj_LIVEref|tr_prod_LIVEkey|live\\n' ;;",
        '    esac ;;',
        "  *'port postgres'*) echo '0.0.0.0:25432' ;;",
        "  *' logs '*) echo 'https://trigger.example.test/magic?token=LIVE' ;;",
        'esac',
        'exit 0',
        '',
      ].join('\n'),
    );
    writeFileSync(join(bin, 'pnpm'), `#!/usr/bin/env bash\necho "pnpm $*" >> "${log}"\n`);
    chmodSync(join(bin, 'docker'), 0o755);
    chmodSync(join(bin, 'pnpm'), 0o755);
    const r = spawnSync('bash', [join(compose, script), ...args], {
      env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: dir, ...shell },
      encoding: 'utf8',
      input: '',
      timeout: 20_000,
    });
    return {
      status: r.status,
      calls: readFileSync(log, 'utf8'),
      err: r.stderr,
      envBefore,
      envAfter: readFileSync(join(compose, '.env'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("a script run from a shell that names the other stack touches neither", () => {
  // Every script here that reaches a stack through Compose. The first four
  // reached it without asking the reader, so they followed the shell into the
  // other stack; trigger-credentials.sh asked only after it had written.
  const SCRIPTS: Array<[string, string[]]> = [
    ['trigger-credentials.sh', ['--write']],
    ['operator.sh', ['list']],
    ['seed-managed.sh', []],
    ['trigger-magic-link.sh', []],
    ['reset-trigger.sh', ['--yes']],
  ];

  it.each(SCRIPTS)('%s reaches a stack when the shell names none', (script, args) => {
    // Vacuity: the stubs are on the path and the script would have used them.
    expect(inOtaCheckout(script, args, {}).calls).toMatch(/^docker /m);
  });

  it.each(SCRIPTS)("%s refuses before its first command when the shell names live", (script, args) => {
    const r = inOtaCheckout(script, args, { COMPOSE_PROJECT_NAME: LIVE });
    expect(r.status, r.err).not.toBe(0);
    expect(r.calls, 'it reached a stack, and Compose would have picked the shell\'s').toBe('');
    expect(r.envAfter, "it wrote the other stack's values into this checkout's .env").toBe(r.envBefore);
    expect(r.err).toContain('unset COMPOSE_PROJECT_NAME');
  });
});
