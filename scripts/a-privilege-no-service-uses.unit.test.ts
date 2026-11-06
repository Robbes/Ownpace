// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PRIVILEGE NO SERVICE USES (workplan 0119, 2026-11-03; the owner, the same
 * day: "make base images more lean/small and more hardened").
 *
 * Until then no service of `deploy/compose/managed.yml` set `security_opt`,
 * `cap_drop` or `read_only`, and the same held for the site's
 * `deploy/compose/www.yml` and the appliance's `deploy/selfhost/compose.yml`.
 * Every container started with Docker's default capabilities, root or not:
 * CHOWN, DAC_OVERRIDE, FOWNER, FSETID, KILL, SETGID, SETUID, SETPCAP,
 * NET_BIND_SERVICE, NET_RAW, SYS_CHROOT, MKNOD, AUDIT_WRITE and SETFCAP, on the
 * stack testers use and on the one that runs their migrations. Most of them
 * never used one. A process that took over the registry, the mail catcher or
 * the socket proxy could chown, open raw sockets and make device nodes; one
 * that took over a service started as another user could become root again
 * through any setuid binary its image carried (the Redis image carries `su`,
 * `mount` and `passwd`; ClickHouse's the same and more).
 *
 * So, held here for each of the three files:
 *
 *  - every service sets `no-new-privileges:true`, and none sets it false,
 *    `privileged`, or an `unconfined` seccomp or AppArmor profile;
 *  - every service is in `POLICIES`, and every service there is in its file,
 *    so a new service fails until somebody decides its set, and a renamed one
 *    cannot leave an entry checking nothing;
 *  - a service with a list drops `ALL` and adds back exactly its list: a
 *    capability beyond it fails, and so does one it no longer adds, so the list
 *    stays the record of what runs (`CAP_` and case are read as Compose reads
 *    them);
 *  - a service that keeps Docker's default set (`trigger-api`, `nextcloud`)
 *    sets neither `cap_drop` nor `cap_add`, so a half-made change is a
 *    decision recorded here rather than one found on live;
 *  - a read-only root is in the policy with the directories it keeps in
 *    memory, and a read-only root the policy does not name fails too;
 *  - no overlay layered on the appliance's file (`deploy/selfhost/compose.*.yml`)
 *    touches any of these keys;
 *  - `docs/managed-bring-up.md`, *How the containers run*, has one row for each
 *    service of the three files, with the capabilities this file says it keeps;
 *  - every `exec` and `run` into a service whose set is dropped, and every
 *    `docker exec` into its container, that a script, a workflow or a document
 *    makes (deploy/, scripts/, .github/workflows/, docs/), is in `REVIEWED` by
 *    the program it starts, with the capabilities that program needs, and
 *    those are in the service's list or in the invocation's own `--cap-add`
 *    (or it is `--privileged`). A new invocation fails until somebody has
 *    read what it does.
 *
 * WHY EACH SET IS WHAT IT IS is beside each service in the compose files, and
 * the table in the guide says whether it was measured on the service's own
 * image (its start and a restart on the volume it wrote, then one capability
 * fewer) or read from its Dockerfile. Two findings shaped the lists more than
 * any rule: Caddy's binary carries `cap_net_bind_service` as a file
 * capability, and the kernel refuses to start a binary whose file capability
 * the bounding set lacks, so `trigger-tls` keeps NET_BIND_SERVICE although it
 * binds 3443; and Redis's entrypoint `find`s through append-only directories
 * that are uid 999's and mode 0700, so without DAC_READ_SEARCH its first
 * restart on its own volume fails.
 *
 * THE RULE THE FIRST VERSION DID NOT HAVE (the review of 2026-11-03). The
 * lists were measured on each service's START, and the shape of the files was
 * all this held. `zitadel-machinekey` kept CHOWN and FOWNER, which its own
 * command needs, while `setup-zitadel.sh` runs it on every bring-up for two
 * other commands: `cat /machinekey/pat.txt`, and the rotation's write and
 * `mv`, in a directory the identity provider owns at mode 700. Root without
 * DAC_OVERRIDE does neither (`cat: can't open '/machinekey/pat.txt':
 * Permission denied`), so the first deploy to carry it would have stopped
 * half-way, and every rule above passed. `REVIEWED` is what holds that now.
 *
 * Each rule is also broken on purpose below, on a copy of the files, and must
 * fail. Before this change (`319a2d34`), every service of the three files
 * failed the first rule.
 *
 * WHAT THIS DOES NOT HOLD. The task runs: Trigger.dev's supervisor makes them
 * through the socket proxy with its own settings, and no compose file here
 * describes them. `deploy/compose/dev.yml`, which only a developer runs. And
 * whether a list is enough: that is E2E (managed), which brings up every
 * service of `managed.yml`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

export const MANAGED = 'deploy/compose/managed.yml';
export const WWW = 'deploy/compose/www.yml';
export const APPLIANCE = 'deploy/selfhost/compose.yml';
export const GUIDE = 'docs/managed-bring-up.md';

/** What a service keeps: its capabilities after `cap_drop: [ALL]`, or Docker's default set. */
export interface Policy {
  readonly caps: readonly string[] | 'docker-default';
  /** Present for a read-only root: the directories it keeps in memory (`tmpfs`). */
  readonly readOnly?: readonly string[];
}

/** nginx's master: port 80, its temp directories chowned to nginx, workers that become nginx. */
const NGINX: Policy = { caps: ['CHOWN', 'NET_BIND_SERVICE', 'SETGID', 'SETUID'] };

export const POLICIES: Readonly<Record<string, Readonly<Record<string, Policy>>>> = {
  [MANAGED]: {
    postgres: { caps: [] },
    pgbouncer: { caps: [], readOnly: ['/tmp'] },
    'trigger-db': { caps: [] },
    'trigger-redis': { caps: ['CHOWN', 'DAC_READ_SEARCH', 'SETGID', 'SETUID'] },
    'trigger-api': { caps: 'docker-default' },
    clickhouse: { caps: ['CHOWN', 'DAC_READ_SEARCH', 'SETGID', 'SETUID'] },
    'trigger-registry': { caps: [], readOnly: ['/tmp'] },
    'trigger-docker-proxy': { caps: [], readOnly: ['/tmp', '/run'] },
    'trigger-supervisor': { caps: [] },
    minio: { caps: [] },
    'minio-init': { caps: [], readOnly: ['/tmp'] },
    'trigger-tls': { caps: ['NET_BIND_SERVICE'] },
    zitadel: { caps: [] },
    'zitadel-machinekey': { caps: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER'], readOnly: [] },
    api: { caps: [] },
    web: NGINX,
    gatus: { caps: [] },
    mailpit: { caps: [], readOnly: ['/tmp'] },
    nextcloud: { caps: 'docker-default' },
  },
  [WWW]: { www: NGINX },
  [APPLIANCE]: { postgres: { caps: [] }, app: { caps: [] } },
};

/** The keys an overlay on the appliance's file may not set. */
export const HARDENING_KEYS = ['security_opt', 'cap_drop', 'cap_add', 'privileged', 'read_only', 'tmpfs'] as const;

interface Service {
  security_opt?: unknown;
  cap_drop?: unknown;
  cap_add?: unknown;
  privileged?: unknown;
  read_only?: unknown;
  tmpfs?: unknown;
}
interface Compose {
  services?: Record<string, Service | null>;
}

/** Compose's own tags (`!reset`) are not YAML the parser knows; the value is kept, so a `!reset` still reads as set. */
export const parseCompose = (text: string): Compose => parseYaml(text, { merge: true, logLevel: 'error' }) as Compose;

const list = (v: unknown): string[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v.map((x) => String(x)) : [String(v)];

/** A capability as Docker reads it: `cap_net_raw`, `CAP_NET_RAW` and `NET_RAW` are one. */
export const capName = (c: string): string => c.trim().toUpperCase().replace(/^CAP_/, '');

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** What is wrong with one compose file's services against its policy; empty when nothing is. */
export function privilegeProblems(file: string, compose: Compose, policy: Readonly<Record<string, Policy>>): string[] {
  const problems: string[] = [];
  const services = compose.services ?? {};
  if (Object.keys(services).length === 0) problems.push(`${file} has no services, so nothing here checks anything`);

  for (const name of Object.keys(policy)) {
    if (!(name in services)) {
      problems.push(`${file}: the policy names ${name}, which is not a service of the file: take it out, or put it back under that name`);
    }
  }

  for (const [name, svc] of Object.entries(services)) {
    const s = svc ?? {};
    const where = `${file}: ${name}`;

    const opts = list(s.security_opt);
    if (!opts.includes('no-new-privileges:true')) {
      problems.push(`${where} does not set security_opt: ["no-new-privileges:true"], so a setuid binary in its image gives back what it dropped`);
    }
    if (opts.some((o) => /^no-new-privileges(?:[:=]false)$/i.test(o.trim()))) {
      problems.push(`${where} sets no-new-privileges false`);
    }
    for (const o of opts) {
      if (/unconfined/i.test(o)) problems.push(`${where} sets security_opt ${o}, a profile Docker's default confines`);
    }
    if (s.privileged === true || String(s.privileged) === 'true') {
      problems.push(`${where} is privileged: every capability, every device, no profile`);
    }

    const p = policy[name];
    if (!p) {
      problems.push(
        `${where} is not in this guard's POLICIES, so nothing says which capabilities it keeps: measure its start, add it there and ` +
          `beside the service, and to the table in ${GUIDE}`,
      );
      continue;
    }

    const drop = list(s.cap_drop).map(capName);
    const add = list(s.cap_add).map(capName);
    if (p.caps === 'docker-default') {
      if (s.cap_drop !== undefined || s.cap_add !== undefined) {
        problems.push(
          `${where} keeps Docker's default capabilities in the policy, and sets cap_drop or cap_add: measure the set and write ` +
            'it into the policy, or take both out',
        );
      }
    } else {
      if (!sameSet(drop, ['ALL'])) {
        problems.push(`${where} does not drop ALL (cap_drop: ${JSON.stringify(s.cap_drop ?? null)}), so it keeps Docker's default capabilities`);
      }
      if (add.includes('ALL')) problems.push(`${where} adds ALL back`);
      const allowed = p.caps.map(capName);
      const beyond = add.filter((c) => c !== 'ALL' && !allowed.includes(c));
      const unused = allowed.filter((c) => !add.includes(c));
      if (beyond.length) {
        problems.push(`${where} adds ${beyond.join(', ')}, beyond its list (${allowed.join(', ') || 'none'}): say why beside it, and in the policy`);
      }
      if (unused.length) {
        problems.push(`${where} no longer adds ${unused.join(', ')}: take it out of the policy and the guide's table too, so they say what runs`);
      }
    }

    const ro = s.read_only === true || String(s.read_only) === 'true';
    const tmpfs = list(s.tmpfs).map((t) => t.split(':')[0]!.trim());
    if (p.readOnly === undefined) {
      if (ro) problems.push(`${where} has a read-only root the policy does not name: add it there, with the directories it keeps in memory`);
    } else {
      if (!ro) problems.push(`${where} is read-only in the policy and not in the file (read_only: ${String(s.read_only)})`);
      for (const dir of p.readOnly) {
        if (!tmpfs.includes(dir)) problems.push(`${where} is read-only and keeps no ${dir} in memory, where it writes at start`);
      }
    }
  }
  return problems;
}

/** Lines in an overlay that set a hardening key, under any service. */
export function overlayProblems(file: string, compose: Compose): string[] {
  const problems: string[] = [];
  for (const [name, svc] of Object.entries(compose.services ?? {})) {
    for (const key of HARDENING_KEYS) {
      if (svc && key in svc) {
        problems.push(`${file}: ${name} sets ${key}, which the file it is layered on decides (${APPLIANCE})`);
      }
    }
  }
  return problems;
}

/** The appliance's overlays, found rather than listed, so a new one is held too. */
export const applianceOverlays = (): string[] =>
  readdirSync(join(REPO_ROOT, 'deploy/selfhost'))
    .filter((f) => /^compose\..+\.ya?ml$/.test(f))
    .map((f) => `deploy/selfhost/${f}`)
    .sort();

/** How the guide's table names a service of each file: bare for `managed.yml`, with the file after it for the others. */
export const ROW_SUFFIX: Readonly<Record<string, string>> = { [MANAGED]: '', [WWW]: ' (www.yml)', [APPLIANCE]: ' (appliance)' };

/**
 * The guide's table, read back: one row per service, `| \`name\` (file) | runs as | kept | … |`,
 * under its *How the containers run* heading, keyed as `ROW_SUFFIX` names it. The kept column
 * is `none`, `Docker's default` or capabilities separated by commas.
 */
export function guideRows(guide: string): Map<string, string[] | 'docker-default'> {
  const start = guide.indexOf('\n## How the containers run\n');
  const rows = new Map<string, string[] | 'docker-default'>();
  if (start < 0) return rows;
  const end = guide.indexOf('\n## ', start + 1);
  for (const line of guide.slice(start, end < 0 ? undefined : end).split('\n')) {
    const m = /^\| `([a-z][a-z0-9-]*)`((?: \([a-z.]+\))?) \|[^|]*\|([^|]*)\|/.exec(line);
    if (!m) continue;
    const kept = m[3]!.trim();
    rows.set(
      `${m[1]!}${m[2]!}`,
      /^docker's default$/i.test(kept) ? 'docker-default' : kept === 'none' ? [] : kept.split(',').map((c) => capName(c)),
    );
  }
  return rows;
}

const shown = (caps: readonly string[] | 'docker-default'): string =>
  caps === 'docker-default' ? "Docker's default" : caps.join(', ') || 'none';

/** What is wrong with the guide's table against the policies of all three files; empty when nothing is. */
export function guideProblems(guide: string, policies: Readonly<Record<string, Readonly<Record<string, Policy>>>>): string[] {
  const rows = guideRows(guide);
  const problems: string[] = [];
  if (!rows.size) return [`${GUIDE} has no table under "## How the containers run"`];
  const expected = new Set<string>();
  for (const [file, policy] of Object.entries(policies)) {
    for (const [name, p] of Object.entries(policy)) {
      const key = `${name}${ROW_SUFFIX[file] ?? ` (${file})`}`;
      expected.add(key);
      const row = rows.get(key);
      if (row === undefined) {
        problems.push(`${GUIDE}'s table has no row for ${key}`);
        continue;
      }
      const same = p.caps === 'docker-default' ? row === 'docker-default' : row !== 'docker-default' && sameSet(row, p.caps.map(capName));
      if (!same) problems.push(`${GUIDE}'s table says ${key} keeps ${shown(row)}, the policy ${shown(p.caps)}`);
    }
  }
  for (const key of rows.keys()) {
    if (!expected.has(key)) problems.push(`${GUIDE}'s table has a row for ${key}, which is not a service of the three files`);
  }
  return problems;
}

// ---------------------------------------------------------------- invocations --

/** One `exec` or `run` into a service, or `docker exec` into its container, read from a line. */
export interface Invocation {
  readonly path: string;
  readonly line: number;
  readonly verb: 'exec' | 'run' | 'docker exec';
  /** The service it reaches, or `?<target>` for a `docker exec` this file cannot resolve. */
  readonly service: string;
  readonly program: string;
  readonly privileged: boolean;
  readonly capAdd: readonly string[];
}

/** Options of `docker compose` itself that take a value, before `exec` or `run`. */
const COMPOSE_VALUE_OPTS = new Set(['-f', '--file', '-p', '--project-name', '--env-file', '--profile', '--project-directory', '--ansi', '--progress', '--parallel']);
/** Options of `exec`, `run` and `docker exec` that take a value. */
const VERB_VALUE_OPTS = new Set([
  '-e', '--env', '-u', '--user', '-w', '--workdir', '--entrypoint', '--name', '-v', '--volume', '--cap-add', '--cap-drop',
  '-p', '--publish', '-l', '--label', '--env-file', '--pull', '--index', '--detach-keys', '--network', '--mount',
]);
const unquote = (t: string): string => t.replace(/^[`"']+/, '').replace(/[`"'),;:]+$/, '');
/** A name in prose standing for any service or command: `…`, `<service>`. */
const PLACEHOLDER = /^(?:…|\.\.\.|<[^>]*>?|)$/;
/** A word that can start a program: a name, a path, or a variable that holds one. */
const PROGRAM_WORD = /^[$\w./{}-]+$/;
const SHELLS = new Set(['sh', 'bash', 'ash']);

/**
 * The program a command starts, past `sh -c` and the assignments in front of it: `psql` for
 * `sh -c 'PGPASSWORD=… psql …'`, `(its command)` for none, and null for prose that only looks
 * like a command.
 */
export function programOf(tokens: readonly string[]): string | null {
  if (tokens.length === 0) return '(its command)';
  let t = tokens.map(unquote);
  if (SHELLS.has(t[0]!)) {
    let j = 1;
    let command = false;
    while (j < t.length && /^-[a-z]+$/.test(t[j]!)) {
      j += 1;
      if (t[j - 1]!.includes('c')) {
        command = true;
        break;
      }
    }
    // Without -c the shell itself is the program: an interactive shell, or one reading a script
    // file, never the word after it (prose like "`exec app sh` still opens a shell" included).
    if (!command) return t[0]!;
    const script = t.slice(j);
    if (script.length === 0 || script[0] === '') return t[0]!;
    t = script;
  }
  let i = 0;
  while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]!)) i += 1;
  if (t[i] === 'exec') i += 1;
  const word = t[i];
  if (word === undefined) return null;
  return PROGRAM_WORD.test(word) && !PLACEHOLDER.test(word) ? word : null;
}

/** The lines of a file with `\`-continuations joined, each with the number of the line it starts on. */
const logicalLines = (text: string): Array<[number, string]> => {
  const out: Array<[number, string]> = [];
  const raw = text.split('\n');
  for (let i = 0; i < raw.length; i += 1) {
    const start = i;
    let line = raw[i]!;
    while (/\\\s*$/.test(line) && i + 1 < raw.length) {
      i += 1;
      line = `${line.replace(/\\\s*$/, ' ')}${raw[i]!.replace(/^\s*>?\s*/, '')}`;
    }
    out.push([start + 1, line]);
  }
  return out;
};

/** Reads a verb's options, then its service or container and the command after it. */
function afterVerb(tokens: readonly string[]): { target: string; rest: string[]; privileged: boolean; capAdd: string[]; entrypoint?: string } | null {
  let privileged = false;
  const capAdd: string[] = [];
  let entrypoint: string | undefined;
  let k = 0;
  while (k < tokens.length) {
    const t = unquote(tokens[k]!);
    if (!t.startsWith('-')) break;
    const [name, value] = t.includes('=') ? [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)] : [t, undefined];
    const takes = VERB_VALUE_OPTS.has(name!) && value === undefined;
    const v = value ?? (takes ? unquote(tokens[k + 1] ?? '') : undefined);
    if (name === '--privileged') privileged = true;
    if (name === '--cap-add' && v) capAdd.push(capName(v));
    if (name === '--entrypoint' && v) entrypoint = v;
    k += takes ? 2 : 1;
  }
  if (k >= tokens.length) return null;
  return { target: unquote(tokens[k]!), rest: tokens.slice(k + 1), privileged, capAdd, entrypoint };
}

/**
 * Every `exec`/`run` into a service of `services`, and every `docker exec` into a container,
 * in one file. A `docker exec` target is resolved through the file's own assignment of it
 * (`DB_CONTAINER="${COMPOSE_PROJECT}-db"`), the container names `containers` maps to their
 * service, and `targets` (`<path>|<target>`), in that order; one none of them resolves comes
 * back as `?<target>`, and a target `targets` maps to null is outside the three files.
 */
export function invocationsIn(
  path: string,
  text: string,
  services: ReadonlySet<string>,
  containers: ReadonlyMap<string, string>,
  targets: Readonly<Record<string, string | null>>,
): Invocation[] {
  const out: Invocation[] = [];
  const assigned = new Map<string, string>();
  for (const m of text.matchAll(/^[ \t]*(?:local[ \t]+|readonly[ \t]+|export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm)) {
    const suffix = /COMPOSE_PROJECT(?:_NAME)?\}?-([a-z0-9-]+)\}*"?\s*$/.exec(m[2]!)?.[1];
    if (suffix && containers.has(`-${suffix}`) && !assigned.has(m[1]!)) assigned.set(m[1]!, containers.get(`-${suffix}`)!);
  }
  for (const [line, body] of logicalLines(text)) {
    if (/^\s*#/.test(body)) continue;
    for (const m of body.matchAll(/(?:docker[ -]compose|\$\{COMPOSE\[@\]\})(?=[\s"'`])/g)) {
      const tokens = body.slice(m.index + m[0].length).split(/\s+/).filter(Boolean);
      let k = 0;
      let verb: 'exec' | 'run' | undefined;
      while (k < tokens.length) {
        const t = unquote(tokens[k]!);
        if (t === 'exec' || t === 'run') {
          verb = t;
          k += 1;
          break;
        }
        if (t.startsWith('-')) k += COMPOSE_VALUE_OPTS.has(t) ? 2 : 1;
        else if (t.startsWith('$') || PLACEHOLDER.test(t)) k += 1;
        else break;
      }
      if (!verb) continue;
      const v = afterVerb(tokens.slice(k));
      if (!v || PLACEHOLDER.test(v.target) || !services.has(v.target)) continue;
      const program = v.entrypoint ?? programOf(v.rest);
      if (program === null) continue;
      out.push({ path, line, verb, service: v.target, program, privileged: v.privileged, capAdd: v.capAdd });
    }
    for (const m of body.matchAll(/\bdocker\s+exec(?=\s)/g)) {
      const v = afterVerb(body.slice(m.index + m[0].length).split(/\s+/).filter(Boolean));
      if (!v || PLACEHOLDER.test(v.target)) continue;
      const variable = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(v.target)?.[1];
      const key = `${path}|${v.target}`;
      const service =
        (variable && assigned.get(variable)) ??
        (containers.get(v.target) ?? [...containers].find(([suffix]) => suffix.startsWith('-') && v.target.endsWith(suffix) && v.target.startsWith('${'))?.[1]) ??
        (key in targets ? targets[key] : `?${v.target}`);
      if (service === null || service === undefined) continue;
      const program = programOf(v.rest);
      if (program === null) continue;
      out.push({ path, line, verb: 'docker exec', service, program, privileged: v.privileged, capAdd: v.capAdd });
    }
  }
  return out;
}

/** The files a script, a workflow or a document runs or tells somebody to run a command from. */
export function invocationFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, keep: RegExp): void => {
    for (const name of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      if (name.name === 'node_modules' || name.name.startsWith('.git')) continue;
      const rel = `${dir}/${name.name}`;
      if (name.isDirectory()) walk(rel, keep);
      else if (keep.test(name.name)) out.push(rel);
    }
  };
  walk('deploy', /\.(sh|mjs|ya?ml|md)$/);
  walk('.github/workflows', /\.ya?ml$/);
  walk('docs', /\.md$/);
  for (const name of readdirSync(join(REPO_ROOT, 'scripts'))) if (/\.(sh|mjs)$/.test(name)) out.push(`scripts/${name}`);
  // The records quote commands as they were run then, and LESSONS.md is generated.
  return out.filter((f) => !/^docs\/(workplans|adr)\//.test(f) && f !== 'docs/LESSONS.md').sort();
}

/** Each service of the three files by name, and its container by name or by the suffix after the project. */
export function serviceNames(parsedFiles: Readonly<Record<string, Compose>>): { services: Set<string>; containers: Map<string, string> } {
  const services = new Set<string>();
  const containers = new Map<string, string>();
  for (const compose of Object.values(parsedFiles)) {
    for (const [name, svc] of Object.entries(compose.services ?? {})) {
      services.add(name);
      const cn = (svc as { container_name?: string } | null)?.container_name;
      if (!cn) continue;
      const suffix = /^\$\{COMPOSE_PROJECT_NAME\}(-[a-z0-9-]+)$/.exec(cn)?.[1];
      containers.set(suffix ?? cn, name);
    }
  }
  return { services, containers };
}

/** What a program needs in a service, and why. */
export interface Review {
  readonly needs: readonly string[];
  readonly why: string;
}
const NONE = (why: string): Review => ({ needs: [], why });
const PSQL = NONE('a client of its own server, as the image user, over the socket or 127.0.0.1');

/**
 * Every program an `exec` or `run` starts in a service whose capabilities are dropped, by
 * service, with the capabilities it needs from the service's list (or from the invocation's
 * own `--cap-add`). Read before it was written down: a new program fails until it is here.
 */
export const REVIEWED: Readonly<Record<string, Readonly<Record<string, Review>>>> = {
  postgres: {
    psql: PSQL,
    pg_dump: PSQL,
    pg_dumpall: PSQL,
    pg_restore: PSQL,
    pg_isready: PSQL,
    sh: NONE("a script of its own, as uid 70: images.yml's check of the uids, zitadel-db-password.sh's `hostname -i`"),
    true: NONE('the smoke asking whether the container answers at all'),
    find: NONE('the guide\'s check that every file in PGDATA is uid 70\'s, which uid 70 reads'),
    chown: {
      needs: ['CHOWN', 'DAC_READ_SEARCH'],
      why: "the appliance's rootless chown of a bound host directory (docs/selfhost-quickstart.md), a one-off that adds both with --cap-add",
    },
  },
  'trigger-db': { psql: PSQL, pg_dump: PSQL },
  pgbouncer: { psql: NONE('SHOW POOLS and SHOW VERSION on its own admin console, as uid 70') },
  'trigger-redis': { 'redis-cli': NONE('a client over TCP; reads and writes no file') },
  clickhouse: {
    'clickhouse-client': NONE('a client over TCP; reads and writes no file'),
    sed: {
      needs: ['DAC_READ_SEARCH'],
      why: "the guide reads the server's preprocessed config under /var/lib/clickhouse, uid 101's, as root: the service keeps DAC_READ_SEARCH",
    },
  },
  minio: { mc: NONE('as uid 65532, with its config directory in /tmp') },
  'zitadel-machinekey': {
    '(its command)': { needs: ['CHOWN', 'FOWNER'], why: 'its own command: chown the volume to the identity provider, then chmod 700 what it no longer owns' },
    cat: {
      needs: ['DAC_OVERRIDE'],
      why:
        "setup-zitadel.sh's read of /machinekey/pat.txt on every bring-up, the runbooks' copy of it, and the rotation's " +
        '`cat > pat.txt.next && mv`: a directory the identity provider owns at mode 700, which root cannot search or write without it',
    },
  },
  zitadel: { cat: NONE('the guide showing what fails: the image carries no cat, whatever its capabilities') },
  api: {
    '$API_NODE': NONE("the image's node, by its path, as uid 65532"),
    '$api_node_path': NONE("the image's node, by its path, as uid 65532"),
    $p: NONE("each candidate path of the image's node, asked for --version"),
    '/nodejs/bin/node': NONE("the image's node, as uid 65532"),
    printenv: NONE('reads its own environment'),
    '(its command)': NONE('the API as its image starts it (or a command a document breaks over a line)'),
  },
  'trigger-supervisor': { node: NONE('the image\'s node, as node') },
  web: { wget: NONE("asks its own nginx over 127.0.0.1, as root, and writes nothing") },
  // Distroless since 2026-11-06 (workplan 0119 §3 item 12): Node by its path is
  // all there is to run, as uid 10001. Until then the drill ran `sh -c ls`,
  // E2E asked `dpkg-query`, and the README offered `exec app sh`.
  app: {
    '/nodejs/bin/node': NONE("E2E (self-hosted) asks the image's node which programs it has and its version, as uid 10001; reads only"),
    $p: NONE("the upgrade drill asks each candidate path of the released image's node for --version"),
    $released_node: NONE("the upgrade drill reads the released appliance's own state directory with its node, as uid 10001"),
  },
};

/**
 * `docker exec` targets the file around them cannot resolve, by `<path>|<target>`: the service
 * each reaches, or null for a container that is no service of the three files.
 */
export const TARGETS: Readonly<Record<string, string | null>> = {
  // psql_in <container>: box-checks.sh finds postgres's and trigger-db's containers by label.
  'deploy/compose/box-checks.sh|$1': 'postgres',
  // live's database by its name, as the runbooks write it for live.
  'docs/operator-runbook.md|ownpace-live-db': 'postgres',
  'docs/ending-the-alpha.md|ownpace-live-db': 'postgres',
  // The dev stack's Nextcloud and Stalwart, which no file here describes.
  'deploy/selfhost/setup-nextcloud-users.sh|$CONTAINER': null,
  'deploy/selfhost/setup-nextcloud-users.sh|${CONTAINER}': null,
  'deploy/selfhost/setup-stalwart.sh|$CONTAINER': null,
  'docs/stalwart-integration-fix.md|$CONTAINER': null,
  'docs/stalwart-integration-fix.md|ownpace-stalwart': null,
  // images.yml starts the upstream image as root on its own, to prove the build reads its volume.
  '.github/workflows/images.yml|root-initialised': null,
};

/** The capabilities a service's container has, read from its file: a list when it drops ALL, else null. */
export function droppedCaps(parsedFiles: Readonly<Record<string, Compose>>): Map<string, string[]> {
  const caps = new Map<string, string[]>();
  for (const compose of Object.values(parsedFiles)) {
    for (const [name, svc] of Object.entries(compose.services ?? {})) {
      if (!list(svc?.cap_drop).map(capName).includes('ALL')) continue;
      const own = list(svc?.cap_add).map(capName);
      // A name in two files (postgres) is held to the smaller set, so a review fits both.
      caps.set(name, caps.has(name) ? caps.get(name)!.filter((c) => own.includes(c)) : own);
    }
  }
  return caps;
}

/** What is wrong with the invocations against the reviews and the services' sets; empty when nothing is. */
export function invocationProblems(
  invocations: readonly Invocation[],
  caps: ReadonlyMap<string, readonly string[]>,
  reviewed: Readonly<Record<string, Readonly<Record<string, Review>>>>,
): string[] {
  const problems: string[] = [];
  const used = new Set<string>();
  for (const inv of invocations) {
    const at = `${inv.path}:${inv.line}`;
    if (inv.service.startsWith('?')) {
      problems.push(`${at}: docker exec into ${inv.service.slice(1)}, a container nothing here resolves: name the service it reaches in TARGETS (null if none of the three files')`);
      continue;
    }
    const has = caps.get(inv.service);
    if (!has) continue;
    const review = reviewed[inv.service]?.[inv.program];
    if (!review) {
      problems.push(
        `${at}: \`${inv.verb} ${inv.service} ${inv.program}\` is in no review: read what it does in a container with ` +
          `${has.join(', ') || 'no capability'}, then add it to REVIEWED with what it needs`,
      );
      continue;
    }
    used.add(`${inv.service} ${inv.program}`);
    if (inv.privileged) continue;
    const missing = review.needs.map(capName).filter((c) => !has.includes(c) && !inv.capAdd.includes(c));
    if (missing.length) {
      problems.push(`${at}: \`${inv.verb} ${inv.service} ${inv.program}\` needs ${missing.join(', ')} (${review.why}), which ${inv.service} does not keep and the invocation does not add`);
    }
  }
  for (const [service, programs] of Object.entries(reviewed)) {
    for (const program of Object.keys(programs)) {
      if (!used.has(`${service} ${program}`)) problems.push(`REVIEWED names \`${service} ${program}\`, which nothing runs any more: take it out`);
    }
  }
  return problems;
}

const files = Object.keys(POLICIES);
const parsed = Object.fromEntries(files.map((f) => [f, parseCompose(read(f))])) as Record<string, Compose>;
const invocations = (): Invocation[] => {
  const { services, containers } = serviceNames(parsed);
  return invocationFiles().flatMap((f) => invocationsIn(f, read(f), services, containers, TARGETS));
};

describe('every service runs with no new privileges and only the capabilities it uses', () => {
  it.each(files.map((f) => [f]))('%s holds every rule', (file) => {
    expect(privilegeProblems(file, parsed[file]!, POLICIES[file]!)).toEqual([]);
  });

  it('every service of managed.yml is found, the one-offs among them, so the rule above is not vacuous', () => {
    expect(Object.keys(parsed[MANAGED]!.services ?? {}).sort()).toEqual(Object.keys(POLICIES[MANAGED]!).sort());
    expect(Object.keys(POLICIES[MANAGED]!)).toContain('zitadel-machinekey');
    expect(Object.keys(POLICIES[MANAGED]!)).toContain('minio-init');
  });

  it('every exec and run into a service with a dropped set is reviewed, and has what it needs', () => {
    expect(invocationProblems(invocations(), droppedCaps(parsed), REVIEWED)).toEqual([]);
  });

  it('the invocations are found, the ones that decided a list among them, so the rule above is not vacuous', () => {
    const found = invocations().map((i) => `${i.path} ${i.verb} ${i.service} ${i.program}`);
    expect(found).toEqual(
      expect.arrayContaining([
        'deploy/compose/setup-zitadel.sh run zitadel-machinekey cat',
        'deploy/compose/bootstrap-managed.sh run zitadel-machinekey (its command)',
        'docs/operator-runbook.md run zitadel-machinekey cat',
        'deploy/compose/rotate-db-passwords.sh exec clickhouse clickhouse-client',
        'deploy/compose/plane-tokens.sh exec trigger-redis redis-cli',
        'deploy/compose/smoke-managed.sh docker exec trigger-supervisor node',
        'docs/selfhost-quickstart.md run postgres chown',
      ]),
    );
    // The rotation's write is the second `run … cat` in setup-zitadel.sh.
    expect(found.filter((f) => f === 'deploy/compose/setup-zitadel.sh run zitadel-machinekey cat')).toHaveLength(2);
  });

  it("no overlay on the appliance's file touches a hardening key", () => {
    const overlays = applianceOverlays();
    expect(overlays.length, 'the overlays were found').toBeGreaterThan(0);
    expect(overlays.flatMap((f) => overlayProblems(f, parseCompose(read(f))))).toEqual([]);
  });

  it("the guide's table says what each file's policy says, the site's and the appliance's rows too", () => {
    expect(guideProblems(read(GUIDE), POLICIES)).toEqual([]);
    expect([...guideRows(read(GUIDE)).keys()]).toEqual(expect.arrayContaining(['www (www.yml)', 'postgres (appliance)', 'app (appliance)']));
  });

  it("Caddy's settings say to revisit no-new-privileges if it ever runs as another user", () => {
    // Its binary binds through a file capability, which no-new-privileges stops for any user but root.
    const block = read(MANAGED).split('\n  trigger-tls:\n')[1]?.split('\n  zitadel:')[0] ?? '';
    expect(block).toMatch(/IF CADDY EVER RUNS AS A USER OTHER\s+#\s+THAN ROOT, revisit no-new-privileges/);
  });
});

describe('each rule fails when it is broken', () => {
  const copy = (file = MANAGED): Compose => structuredClone(parsed[file]!);
  const svc = (c: Compose, name: string): Service => c.services![name]!;
  const mutations: Array<[string, (c: Compose) => void, RegExp]> = [
    ['no-new-privileges taken off one service', (c) => delete svc(c, 'gatus').security_opt, /gatus does not set security_opt/],
    ['no-new-privileges set false', (c) => (svc(c, 'api').security_opt = ['no-new-privileges:false']), /api does not set[\s\S]*api sets no-new-privileges false/],
    ['seccomp unconfined', (c) => (svc(c, 'web').security_opt = ['no-new-privileges:true', 'seccomp:unconfined']), /web sets security_opt seccomp:unconfined/],
    ['apparmor unconfined', (c) => (svc(c, 'nextcloud').security_opt = ['no-new-privileges:true', 'apparmor=unconfined']), /nextcloud sets security_opt apparmor=unconfined/],
    ['privileged', (c) => (svc(c, 'trigger-docker-proxy').privileged = true), /trigger-docker-proxy is privileged/],
    ['a capability beyond the list', (c) => (svc(c, 'trigger-redis').cap_add = ['CHOWN', 'DAC_READ_SEARCH', 'SETGID', 'SETUID', 'SYS_ADMIN']), /trigger-redis adds SYS_ADMIN, beyond its list/],
    ['a capability spelt as Docker also takes it', (c) => (svc(c, 'minio').cap_add = ['cap_net_raw']), /minio adds NET_RAW, beyond its list \(none\)/],
    ['ALL added back', (c) => (svc(c, 'api').cap_add = ['ALL']), /api adds ALL back/],
    ['cap_drop taken off', (c) => delete svc(c, 'clickhouse').cap_drop, /clickhouse does not drop ALL/],
    ['cap_drop of one capability, not ALL', (c) => (svc(c, 'zitadel').cap_drop = ['NET_RAW']), /zitadel does not drop ALL/],
    ['a capability no longer added', (c) => (svc(c, 'web').cap_add = ['CHOWN', 'NET_BIND_SERVICE', 'SETGID']), /web no longer adds SETUID/],
    ['NET_BIND_SERVICE taken from Caddy', (c) => (svc(c, 'trigger-tls').cap_add = []), /trigger-tls no longer adds NET_BIND_SERVICE/],
    ['a default-set service half dropped', (c) => (svc(c, 'trigger-api').cap_drop = ['ALL']), /trigger-api keeps Docker's default capabilities in the policy, and sets cap_drop or cap_add/],
    ['a new service', (c) => (c.services!['probe'] = { security_opt: ['no-new-privileges:true'] }), /probe is not in this guard's POLICIES/],
    ['a service renamed', (c) => {
      c.services!['mail-catcher'] = c.services!['mailpit']!;
      delete c.services!['mailpit'];
    }, /the policy names mailpit, which is not a service of the file[\s\S]*mail-catcher is not in this guard's POLICIES/],
    ['read-only taken off', (c) => delete svc(c, 'trigger-registry').read_only, /trigger-registry is read-only in the policy and not in the file/],
    ['a directory taken out of memory', (c) => (svc(c, 'trigger-docker-proxy').tmpfs = ['/tmp']), /trigger-docker-proxy is read-only and keeps no \/run in memory/],
    ['tmpfs as one string, with options, still read', (c) => (svc(c, 'mailpit').tmpfs = '/var/tmp:size=1m'), /mailpit is read-only and keeps no \/tmp in memory/],
    ['a read-only root the policy does not name', (c) => (svc(c, 'postgres').read_only = true), /postgres has a read-only root the policy does not name/],
    ['no services at all', (c) => (c.services = {}), /has no services/],
  ];

  it.each(mutations)('%s', (_label, mutate, why) => {
    const c = copy();
    mutate(c);
    expect(privilegeProblems(MANAGED, c, POLICIES[MANAGED]!).join('\n')).toMatch(why);
  });

  it('every managed service fails without no-new-privileges, one by one', () => {
    for (const name of Object.keys(POLICIES[MANAGED]!)) {
      const c = copy();
      delete svc(c, name).security_opt;
      expect(privilegeProblems(MANAGED, c, POLICIES[MANAGED]!).join('\n'), name).toMatch(new RegExp(`: ${name} does not set security_opt`));
    }
  });

  it("the site's nginx with a capability beyond nginx's, and the appliance's app without no-new-privileges", () => {
    const www = copy(WWW);
    svc(www, 'www').cap_add = ['CHOWN', 'NET_BIND_SERVICE', 'SETGID', 'SETUID', 'NET_RAW'];
    expect(privilegeProblems(WWW, www, POLICIES[WWW]!).join('\n')).toMatch(/www adds NET_RAW, beyond its list/);
    const app = copy(APPLIANCE);
    delete svc(app, 'app').security_opt;
    expect(privilegeProblems(APPLIANCE, app, POLICIES[APPLIANCE]!).join('\n')).toMatch(/app does not set security_opt/);
  });

  it('the files before this change fail: no service set any of it', () => {
    for (const file of files) {
      const c = copy(file);
      for (const s of Object.values(c.services ?? {})) for (const k of HARDENING_KEYS) delete (s as Service)[k];
      const problems = privilegeProblems(file, c, POLICIES[file]!);
      expect(problems.filter((p) => p.includes('does not set security_opt')).length, file).toBe(Object.keys(c.services ?? {}).length);
    }
  });

  it('an overlay that sets a hardening key', () => {
    const overlay = parseCompose('services:\n  app:\n    cap_add: [SYS_ADMIN]\n  postgres:\n    security_opt: !reset []\n');
    expect(overlayProblems('deploy/selfhost/compose.x.yml', overlay)).toEqual([
      `deploy/selfhost/compose.x.yml: app sets cap_add, which the file it is layered on decides (${APPLIANCE})`,
      `deploy/selfhost/compose.x.yml: postgres sets security_opt, which the file it is layered on decides (${APPLIANCE})`,
    ]);
  });

  it("the guide's table: a row missing, a row that disagrees, a row too many", () => {
    const guide = read(GUIDE);
    expect(guideProblems(guide.replace(/^\| `gatus` \|.*\n/m, ''), POLICIES).join('\n')).toMatch(/has no row for gatus/);
    expect(
      guideProblems(guide.replace(/^(\| `trigger-tls` \|[^|]*\|) NET_BIND_SERVICE \|/m, '$1 none |'), POLICIES).join('\n'),
    ).toMatch(/says trigger-tls keeps none, the policy NET_BIND_SERVICE/);
    expect(
      guideProblems(guide.replace(/^(\| `nextcloud` \|[^|]*\|) Docker's default \|/m, '$1 CHOWN |'), POLICIES).join('\n'),
    ).toMatch(/says nextcloud keeps CHOWN, the policy Docker's default/);
    expect(
      guideProblems(guide.replace(/^(\| `gatus` \|.*\n)/m, '$1| `worker` | root | none | no | read |\n'), POLICIES).join('\n'),
    ).toMatch(/has a row for worker, which is not a service/);
    expect(
      guideProblems(guide.replace(/^(\| `www` \(www\.yml\) \|[^|]*\|) CHOWN, NET_BIND_SERVICE, SETGID, SETUID \|/m, '$1 CHOWN |'), POLICIES).join('\n'),
    ).toMatch(/says www \(www\.yml\) keeps CHOWN, the policy CHOWN, NET_BIND_SERVICE, SETGID, SETUID/);
    expect(guideProblems(guide.replace(/^\| `app` \(appliance\) \|.*\n/m, ''), POLICIES).join('\n')).toMatch(/has no row for app \(appliance\)/);
    expect(
      guideProblems(guide.replace(/^(\| `postgres` \(appliance\) \|[^|]*\|) none \|/m, '$1 CHOWN |'), POLICIES).join('\n'),
    ).toMatch(/says postgres \(appliance\) keeps CHOWN, the policy none/);
    expect(guideProblems(guide.replace('## How the containers run', '## How it runs'), POLICIES)).toEqual([
      `${GUIDE} has no table under "## How the containers run"`,
    ]);
  });

  it('the invocation rule: DAC_OVERRIDE taken from the one-off fails every read and the rotation of the token', () => {
    const c = structuredClone(parsed);
    c[MANAGED]!.services!['zitadel-machinekey']!.cap_add = ['CHOWN', 'FOWNER'];
    const problems = invocationProblems(invocations(), droppedCaps(c), REVIEWED);
    const zitadel = problems.filter((p) => /`run zitadel-machinekey cat` needs DAC_OVERRIDE/.test(p));
    expect(zitadel.map((p) => p.split(':')[0])).toEqual(
      expect.arrayContaining(['deploy/compose/setup-zitadel.sh', 'docs/operator-runbook.md', 'docs/managed-bring-up.md']),
    );
    expect(zitadel.filter((p) => p.startsWith('deploy/compose/setup-zitadel.sh'))).toHaveLength(2);
    // Its own command needs nothing it lost.
    expect(problems.join('\n')).not.toMatch(/zitadel-machinekey \(its command\)/);
  });

  it('the invocation rule: a program nobody reviewed, a review nothing uses, a container nothing resolves', () => {
    const caps = droppedCaps(parsed);
    const at = (service: string, program: string, extra: Partial<Invocation> = {}): Invocation => ({
      path: 'deploy/compose/x.sh', line: 1, verb: 'exec', service, program, privileged: false, capAdd: [], ...extra,
    });
    // Each on its own inputs, so a breakage of the real files does not decide it.
    expect(invocationProblems([at('postgres', 'chmod')], caps, {}).join('\n')).toMatch(/x\.sh:1: `exec postgres chmod` is in no review/);
    expect(invocationProblems([], caps, { minio: { rm: NONE('x') } })).toEqual([
      'REVIEWED names `minio rm`, which nothing runs any more: take it out',
    ]);
    expect(invocationProblems([at('?$WHO', 'psql', { verb: 'docker exec' })], caps, {}).join('\n')).toMatch(
      /docker exec into \$WHO, a container nothing here resolves/,
    );
    // A service that keeps Docker's default set is not this rule's.
    expect(invocationProblems([at('trigger-api', 'chown')], caps, {})).toEqual([]);
    // The quickstart's chown fails without its own --cap-add, and passes with it or --privileged.
    const chown = at('postgres', 'chown', { verb: 'run' });
    const reviews = { postgres: { chown: REVIEWED['postgres']!['chown']! } };
    expect(invocationProblems([chown], caps, reviews).join('\n')).toMatch(/`run postgres chown` needs CHOWN, DAC_READ_SEARCH/);
    expect(invocationProblems([{ ...chown, capAdd: ['CHOWN'] }], caps, reviews).join('\n')).toMatch(/needs DAC_READ_SEARCH \(/);
    expect(invocationProblems([{ ...chown, capAdd: ['CHOWN', 'DAC_READ_SEARCH'] }], caps, reviews)).toEqual([]);
    expect(invocationProblems([{ ...chown, privileged: true }], caps, reviews)).toEqual([]);
  });

  it('invocations are read as a shell reads them: options, continuations, sh -c, entrypoints and resolved containers', () => {
    const { services, containers } = serviceNames(parsed);
    const found = (text: string, path = 'deploy/compose/x.sh'): string[] =>
      invocationsIn(path, text, services, containers, TARGETS).map((i) => `${i.verb} ${i.service} ${i.program}${i.privileged ? ' privileged' : ''}${i.capAdd.length ? ` +${i.capAdd.join(',')}` : ''}`);
    expect(found('"${COMPOSE[@]}" exec -T -e PGPASSWORD pgbouncer \\\n  psql -h 127.0.0.1 -p 6432')).toEqual(['exec pgbouncer psql']);
    expect(found(`docker compose -f deploy/compose/managed.yml exec -T postgres sh -c 'PGPASSWORD=x exec psql -U "$POSTGRES_USER"'`)).toEqual(['exec postgres psql']);
    expect(found('docker compose $MANAGED_COMPOSE exec -T --user=0 trigger-redis bash -lc "redis-cli ping"')).toEqual(['exec trigger-redis redis-cli']);
    // Without -c the shell is the program, not the word after it.
    expect(found('`docker compose exec app sh` still opens a shell')).toEqual(['exec app sh']);
    expect(found('docker compose -f x.yml run --rm --no-deps -u 0 --cap-add CHOWN --entrypoint chown postgres -R 70:70 /d')).toEqual(['run postgres chown +CHOWN']);
    expect(found('docker compose -f x.yml exec --privileged -u 0 minio sh')).toEqual(['exec minio sh privileged']);
    expect(found('ZITADEL_UID="$u" "${COMPOSE[@]}" run --rm --quiet-pull zitadel-machinekey')).toEqual(['run zitadel-machinekey (its command)']);
    expect(found('DB_CONTAINER="${COMPOSE_PROJECT}-db"\ndocker exec -i "$DB_CONTAINER" pg_restore --list')).toEqual(['docker exec postgres pg_restore']);
    expect(found('C="${X:-${COMPOSE_PROJECT}-trigger-supervisor}"\ndocker exec "$C" node -e 1')).toEqual(['docker exec trigger-supervisor node']);
    expect(found('docker exec "$NOBODY" psql')).toEqual(['docker exec ?$NOBODY psql']);
    // Prose, placeholders and comments are not invocations.
    expect(found('`docker compose … exec postgres` (and `trigger-db`) runs as uid 70')).toEqual([]);
    expect(found('docker compose -f deploy/compose/managed.yml exec --privileged -u 0 <service> …')).toEqual([]);
    expect(found('# docker compose exec postgres chmod 777 /x')).toEqual([]);
    expect(found('run the CLI login once, and docker compose run the')).toEqual([]);
  });

  it("a capability's spelling: CAP_, case and spaces are one name", () => {
    expect(['CAP_CHOWN', 'chown', ' Chown '].map(capName)).toEqual(['CHOWN', 'CHOWN', 'CHOWN']);
  });
});
