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
 *    service of `managed.yml`, with the capabilities this file says it keeps.
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
    'zitadel-machinekey': { caps: ['CHOWN', 'FOWNER'], readOnly: [] },
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

/**
 * The guide's table, read back: one row per service, `| \`name\` | runs as | kept | … |`,
 * under its *How the containers run* heading. The kept column is `none`, `Docker's default`
 * or capabilities separated by commas.
 */
export function guideRows(guide: string): Map<string, string[] | 'docker-default'> {
  const start = guide.indexOf('\n## How the containers run\n');
  const rows = new Map<string, string[] | 'docker-default'>();
  if (start < 0) return rows;
  const end = guide.indexOf('\n## ', start + 1);
  for (const line of guide.slice(start, end < 0 ? undefined : end).split('\n')) {
    const m = /^\| `([a-z][a-z0-9-]*)` \|[^|]*\|([^|]*)\|/.exec(line);
    if (!m) continue;
    const kept = m[2]!.trim();
    rows.set(
      m[1]!,
      /^docker's default$/i.test(kept) ? 'docker-default' : kept === 'none' ? [] : kept.split(',').map((c) => capName(c)),
    );
  }
  return rows;
}

/** What is wrong with the guide's table against the policy of `managed.yml`; empty when nothing is. */
export function guideProblems(guide: string, policy: Readonly<Record<string, Policy>>): string[] {
  const rows = guideRows(guide);
  const problems: string[] = [];
  if (!rows.size) return [`${GUIDE} has no table under "## How the containers run"`];
  for (const [name, p] of Object.entries(policy)) {
    const row = rows.get(name);
    if (row === undefined) {
      problems.push(`${GUIDE}'s table has no row for ${name}`);
      continue;
    }
    const same = p.caps === 'docker-default' ? row === 'docker-default' : row !== 'docker-default' && sameSet(row, p.caps.map(capName));
    if (!same) {
      problems.push(`${GUIDE}'s table says ${name} keeps ${row === 'docker-default' ? "Docker's default" : row.join(', ') || 'none'}, the policy ${p.caps === 'docker-default' ? "Docker's default" : p.caps.join(', ') || 'none'}`);
    }
  }
  for (const name of rows.keys()) {
    if (!(name in policy)) problems.push(`${GUIDE}'s table has a row for ${name}, which is not a service of ${MANAGED}`);
  }
  return problems;
}

const files = Object.keys(POLICIES);
const parsed = Object.fromEntries(files.map((f) => [f, parseCompose(read(f))])) as Record<string, Compose>;

describe('every service runs with no new privileges and only the capabilities it uses', () => {
  it.each(files.map((f) => [f]))('%s holds every rule', (file) => {
    expect(privilegeProblems(file, parsed[file]!, POLICIES[file]!)).toEqual([]);
  });

  it('every service of managed.yml is found, the one-offs among them, so the rule above is not vacuous', () => {
    expect(Object.keys(parsed[MANAGED]!.services ?? {}).sort()).toEqual(Object.keys(POLICIES[MANAGED]!).sort());
    expect(Object.keys(POLICIES[MANAGED]!)).toContain('zitadel-machinekey');
    expect(Object.keys(POLICIES[MANAGED]!)).toContain('minio-init');
  });

  it("no overlay on the appliance's file touches a hardening key", () => {
    const overlays = applianceOverlays();
    expect(overlays.length, 'the overlays were found').toBeGreaterThan(0);
    expect(overlays.flatMap((f) => overlayProblems(f, parseCompose(read(f))))).toEqual([]);
  });

  it("the guide's table says what managed.yml's policy says", () => {
    expect(guideProblems(read(GUIDE), POLICIES[MANAGED]!)).toEqual([]);
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
    expect(guideProblems(guide.replace(/^\| `gatus` \|.*\n/m, ''), POLICIES[MANAGED]!).join('\n')).toMatch(/has no row for gatus/);
    expect(
      guideProblems(guide.replace(/^(\| `trigger-tls` \|[^|]*\|) NET_BIND_SERVICE \|/m, '$1 none |'), POLICIES[MANAGED]!).join('\n'),
    ).toMatch(/says trigger-tls keeps none, the policy NET_BIND_SERVICE/);
    expect(
      guideProblems(guide.replace(/^(\| `nextcloud` \|[^|]*\|) Docker's default \|/m, '$1 CHOWN |'), POLICIES[MANAGED]!).join('\n'),
    ).toMatch(/says nextcloud keeps CHOWN, the policy Docker's default/);
    expect(
      guideProblems(guide.replace(/^(\| `gatus` \|.*\n)/m, '$1| `worker` | root | none | no | read |\n'), POLICIES[MANAGED]!).join('\n'),
    ).toMatch(/has a row for worker, which is not a service/);
    expect(guideProblems(guide.replace('## How the containers run', '## How it runs'), POLICIES[MANAGED]!)).toEqual([
      `${GUIDE} has no table under "## How the containers run"`,
    ]);
  });

  it("a capability's spelling: CAP_, case and spaces are one name", () => {
    expect(['CAP_CHOWN', 'chown', ' Chown '].map(capName)).toEqual(['CHOWN', 'CHOWN', 'CHOWN']);
  });
});
