// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LEDGER THAT OUTLIVED ITS MAIL SERVER (workplan 0119; the owner's choice of
 * 2026-11-20, quoted in ADR-0022's update of that date).
 *
 * Stalwart v1.1.1 refuses the data volume the OTA demo's v0.16 Stalwart made,
 * and v0.16.27 refuses one v1 made. Making the volume again is not enough on
 * its own: the stack's database outlives it, and demo organisation A's mail
 * migration still holds the seeded messages as copied. Mail has no source
 * version, so a pass skips them, nothing reaches the empty v1 target, and the
 * managed smoke fails at its verify floor and at its cutover gate. Asked how
 * the switch should go, the owner chose "One-time reset (Recommended)": one
 * command, run by hand on the OTA stack right after a nightly, that clears
 * only the test fixtures' mail data and their copy records.
 *
 * `deploy/compose/reset-demo-mail.sh` is that command. What it may never do is
 * what this holds, with a stand-in `docker` that records every call and the
 * SQL piped to `psql`, and answers as the database would (what that SQL does
 * on a real Postgres was run once on a throwaway cluster, `scripts/local-pg.sh`,
 * when it was written: the demo's rows cleared, another migration of the same
 * organisation and organisation B's untouched, each refusal raised):
 *
 *   - it refuses live's `.env`, any value of the marker that could be a slip of
 *     it, the marker exported into the shell and a shell that names another
 *     stack, before Docker is asked anything;
 *   - without --yes it changes nothing: one read-only transaction, no removal;
 *     an argument it does not know is refused before anything is asked;
 *   - with --yes it removes the container, then the data volume, and only
 *     then clears the rows, in one transaction that ends with a commit; the
 *     config volume stays;
 *   - every statement it sends names the demo's ids and no other, every
 *     DELETE names the organisation and the migration, and nothing else is
 *     written; the ids are seed-managed.ts's organisation A and the mail
 *     migration smoke-managed.sh verifies and cuts over;
 *   - its header names every table it clears, and it clears every table the
 *     header names;
 *   - an answer saying the ids are not the demo's, a pass still running, an
 *     image that is not Stalwart and a Docker that cannot be asked each stop
 *     it before anything is removed; a volume Docker will not remove stops it
 *     before any row is cleared;
 *   - nothing in the gate, the bring-up or any other script runs it;
 *   - it parses (`bash -n`).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_NAME = 'reset-demo-mail.sh';
const SCRIPT_REL = `deploy/compose/${SCRIPT_NAME}`;
const SEED_REL = 'apps/api/src/scripts/seed-managed.ts';
const SMOKE_REL = 'deploy/compose/smoke-managed.sh';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
}, 120_000);

/**
 * The stand-in `docker`. Every call is logged; the SQL piped to the postgres
 * exec is kept, one file per call, and answered the way the database answers
 * it: the read-only call with its counts and `checked`, the clearing with
 * what it deleted, the counts after and `committed`.
 */
const DOCKER_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$STUB_LOG"
# STUB_DOCKER_DOWN names the call that fails as a daemon that cannot be asked
# does, so each of the script's readings is held on its own.
if [ -n "\${STUB_DOCKER_DOWN:-}" ] && [[ "$*" == "$STUB_DOCKER_DOWN"* ]]; then
  echo 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' >&2
  exit 1
fi
case "$*" in
  "container inspect "*)
    if [ -n "\${STUB_NO_CONTAINER:-}" ]; then
      echo 'Error response from daemon: No such container: ownpace-stalwart' >&2; exit 1
    fi
    echo "\${STUB_IMAGE:-stalwartlabs/stalwart:v0.16.27}|running" ;;
  "volume inspect "*)
    name="\${*: -1}"
    if [ -n "\${STUB_NO_DATA:-}" ] && [ "$name" = ownpace-stalwart-data ]; then
      echo "Error response from daemon: get $name: no such volume" >&2; exit 1
    fi
    echo "$name" ;;
  "compose "*" exec -T postgres sh -c "*)
    n=$(( $(find "$STUB_SQL" -name '*.sql' | wc -l) + 1 ))
    cat >"$STUB_SQL/$n.sql"
    case "$(cat "$STUB_SQL/$n.sql")" in
      *"BEGIN TRANSACTION READ ONLY;"*)
        if [ -n "\${STUB_NOT_THE_DEMO:-}" ]; then
          echo 'psql:<stdin>:20: ERROR:  reset-demo-mail: refused: a0000000-0000-4000-8000-0000000000d1 is not the demo mail migration seed-managed.ts writes' >&2
          exit 3
        fi
        printf 'count|run_event|4\\ncount|item|5\\ncount|cursor|1\\nitems|copied|5\\n'
        [ -n "\${STUB_RUNNING:-}" ] && printf 'running|2026-11-20 03:41\\n'
        printf 'checked\\n' ;;
      *) printf 'deleted|item|5\\nafter|item|0\\ncommitted\\n' ;;
    esac ;;
  "rm -f ownpace-stalwart") ;;
  "volume rm "*)
    if [ -n "\${STUB_VOLUME_BUSY:-}" ]; then
      echo "Error response from daemon: remove \${*: -1}: volume is in use - [4f9c]" >&2; exit 1
    fi ;;
  *) echo "docker stub: unexpected call: $*" >&2; exit 98 ;;
esac
`;

/** The OTA stack's .env names no project and carries no marker (managed.env.example). */
const OTA_ENV = 'POSTGRES_USER=openmigrate\nPOSTGRES_DB=openmigrate\n';

interface Run {
  status: number;
  out: string;
  docker: string[];
  sql: string[];
}

function run(args: string[], opts: { env?: NodeJS.ProcessEnv; dotenv?: string } = {}): Run {
  const root = mkdtempSync(join(tmpdir(), 'reset-demo-mail-'));
  tempDirs.push(root);
  const compose = join(root, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of [SCRIPT_NAME, 'env-read.sh', 'stack-kind.sh', 'managed.yml']) {
    copyFileSync(join(ROOT, 'deploy/compose', f), join(compose, f));
  }
  chmodSync(join(compose, SCRIPT_NAME), 0o755);
  writeFileSync(join(compose, '.env'), opts.dotenv ?? OTA_ENV);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), DOCKER_STUB);
  chmodSync(join(bin, 'docker'), 0o755);
  const log = join(root, 'docker.log');
  const sql = join(root, 'sql');
  writeFileSync(log, '');
  mkdirSync(sql);
  const r = spawnSync(join(compose, SCRIPT_NAME), args, {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: root, STUB_LOG: log, STUB_SQL: sql, ...opts.env },
    cwd: root,
    timeout: 30_000,
  });
  const files = readdirSync(sql)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  return {
    status: r.status ?? -1,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    docker: readFileSync(log, 'utf8').split('\n').filter(Boolean),
    sql: files.map((f) => readFileSync(join(sql, f), 'utf8')),
  };
}

/** Docker calls that remove or stop something. */
const removals = (r: Run): string[] => r.docker.filter((d) => /^(?:rm|stop|kill|volume rm|container rm)\b/.test(d));
const execs = (r: Run): number[] =>
  r.docker.flatMap((d, i) => (/^compose .* exec -T postgres sh -c /.test(d) ? [i] : []));

// Demo organisation A as seed-managed.ts writes it: the first of DEMO_TENANTS.
const SEED = read(SEED_REL);
const tenantA = /tenantId: '(?<tenant>[^']+)',[\s\S]*?owner: \{ userId: '(?<owner>[^']+)'[\s\S]*?sourceConnectionId: '(?<sourceConnection>[^']+)',\s*targetConnectionId: '(?<targetConnection>[^']+)',\s*sourceMailboxId: '(?<sourceMailbox>[^']+)',\s*targetMailboxId: '(?<targetMailbox>[^']+)',\s*mappingId: '(?<mapping>[^']+)',\s*domains: \[(?<domains>[^\]]*)\],[\s\S]*?source: \{\s*kind: '(?<sourceKind>\w+)',\s*[\s\S]*?user: '(?<sourceUser>[^']+)'[\s\S]*?target: \{\s*kind: '(?<targetKind>\w+)',\s*config: \{ type: 'jmap', baseUrl: STALWART_MAIL\.jmapBaseUrl, user: '(?<targetUser>[^']+)'/.exec(
  SEED.slice(SEED.indexOf('const DEMO_TENANTS')),
)?.groups;
const stalwartMail = /const STALWART_MAIL = \{ host: '(?<host>[^']+)', imapsPort: \d+, jmapBaseUrl: '(?<jmap>[^']+)' \}/.exec(SEED)?.groups;
const SMOKE = read(SMOKE_REL);
const smokeDefault = (name: string): string | undefined =>
  new RegExp(`^${name}="\\$\\{SMOKE_${name}:-([^}]+)\\}"$`, 'm').exec(SMOKE)?.[1];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

describe('the one-time reset of the OTA demo mail lane never reaches live', () => {
  const LIVE_FILES = [
    'COMPOSE_PROJECT_NAME=ownpace-live\nSTACK_KIND=production\n',
    'STACK_KIND="Production "\n',
    'STACK_KIND=prod\n',
    '  STACK_KIND=production\n',
  ];

  it.each(LIVE_FILES)('refuses a .env carrying %j, before Docker is asked anything', (dotenv) => {
    for (const args of [[], ['--yes']]) {
      const r = run(args, { dotenv });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('refused');
      expect(r.out).toContain('STACK_KIND');
      expect(r.out).toContain('Nothing was changed');
      expect(r.docker, 'it asked Docker before it knew the stack is not live').toEqual([]);
    }
  });

  it("refuses live's marker exported into the shell", () => {
    const r = run(['--yes'], { env: { STACK_KIND: 'production' } });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('exported');
    expect(r.docker).toEqual([]);
  });

  it('refuses a shell that names another stack than the checkout chooses', () => {
    const r = run(['--yes'], { env: { COMPOSE_PROJECT_NAME: 'ownpace-live' } });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('unset COMPOSE_PROJECT_NAME');
    expect(r.docker).toEqual([]);
  });
});

describe('without --yes it shows what it would do, and changes nothing', () => {
  it('reads, in one read-only transaction, and removes nothing', () => {
    const r = run([]);
    expect(r.status, r.out).toBe(0);
    expect(removals(r)).toEqual([]);
    expect(execs(r)).toHaveLength(1);
    expect(r.sql).toHaveLength(1);
    expect(r.sql[0]).toMatch(/^BEGIN TRANSACTION READ ONLY;/);
    expect(r.sql[0]).toMatch(/\nROLLBACK;\nSELECT 'checked';\s*$/);
    expect(r.sql[0], 'a dry run that writes').not.toMatch(/\b(?:DELETE|UPDATE|INSERT|TRUNCATE|COMMIT)\b/);
    // With the counts it would act on.
    expect(r.out).toMatch(/item\s+5/);
    expect(r.out).toContain('ownpace-stalwart-data: present; --yes removes it');
    expect(r.out).toContain('nothing was changed');
  });

  it.each([['--force'], ['yes'], ['-y'], ['--yes', '--now']])(
    'refuses %j before anything is asked',
    (...args) => {
      const r = run(args);
      expect(r.status, r.out).toBe(2);
      expect(r.docker).toEqual([]);
    },
  );
});

describe('with --yes: the container, then its data volume, then the rows', () => {
  it('removes in that order, keeps the config volume, and commits', () => {
    const r = run(['--yes']);
    expect(r.status, r.out).toBe(0);
    const container = r.docker.indexOf('rm -f ownpace-stalwart');
    const volume = r.docker.indexOf('volume rm ownpace-stalwart-data');
    const [read, clear] = execs(r);
    expect(container, r.docker.join('\n')).toBeGreaterThan(read!);
    expect(volume).toBeGreaterThan(container);
    expect(clear).toBeGreaterThan(volume);
    expect(removals(r)).toEqual(['rm -f ownpace-stalwart', 'volume rm ownpace-stalwart-data']);
    expect(r.sql).toHaveLength(2);
    expect(r.sql[1]).toMatch(/^BEGIN;/);
    expect(r.sql[1]).toMatch(/\nCOMMIT;\nSELECT 'committed';\s*$/);
    expect(r.out).toMatch(/after:\n\[reset-demo-mail\]\s+item\s+0/);
  });

  it('asks the database as its owner, over its own socket, and stops at the first error', () => {
    const r = run(['--yes']);
    for (const i of execs(r)) {
      const exec = r.docker[i]!;
      expect(exec).toContain('-U "$POSTGRES_USER"');
      expect(exec).toContain('ON_ERROR_STOP=1');
      expect(exec).not.toMatch(/app_user|APP_DB_USER|pgbouncer|6432/);
    }
  });
});

describe('every statement names the demo mail migration, and no other', () => {
  const r = run(['--yes']);
  const all = r.sql.join('\n');
  const deletes = [...all.matchAll(/DELETE FROM public\.(\w+) WHERE (.+?) RETURNING 1\)/g)].map((m) => ({
    table: m[1]!,
    where: m[2]!,
  }));

  it('found the two calls and their deletes, so the rest of this is not vacuous', () => {
    expect(r.status, r.out).toBe(0);
    expect(r.sql).toHaveLength(2);
    expect(deletes.length).toBeGreaterThan(10);
    expect((all.match(/\bDELETE\b/g) ?? []).length, 'a DELETE this reading did not parse').toBe(deletes.length);
  });

  it("names seed-managed.ts's organisation A and the mail migration the smoke verifies", () => {
    expect(tenantA, `${SEED_REL}: organisation A's ids could not be read`).toBeDefined();
    expect(stalwartMail, `${SEED_REL}: STALWART_MAIL could not be read`).toBeDefined();
    const a = tenantA!;
    expect(a.domains, "organisation A's migration is the demo's mail").toBe("'email'");
    expect(smokeDefault('VERIFY_TENANT')).toBe(a.tenant);
    expect(smokeDefault('VERIFY_MAPPING')).toBe(a.mapping);
    for (const id of [a.tenant, a.mapping, a.sourceMailbox, a.targetMailbox, a.sourceConnection, a.targetConnection]) {
      expect(r.sql[0], `the check does not name ${id}`).toContain(`'${id}'`);
      expect(r.sql[1], `the clearing's check does not name ${id}`).toContain(`'${id}'`);
    }
    // And what makes those ids the demo Stalwart's: the two connections.
    expect(r.sql[0]).toContain(`sc.kind = '${a.sourceKind}'`);
    expect(r.sql[0]).toContain(`sc.config->>'host' = '${stalwartMail!.host}'`);
    expect(r.sql[0]).toContain(`sc.config->>'user' = '${a.sourceUser}'`);
    expect(r.sql[0]).toContain(`tc.kind = '${a.targetKind}'`);
    expect(r.sql[0]).toContain(`tc.config->>'baseUrl' = '${stalwartMail!.jmap}'`);
    expect(r.sql[0]).toContain(`tc.config->>'user' = '${a.targetUser}'`);
    expect(r.sql[0]).toContain(`user_id = '${a.owner}'`);
  });

  it("holds no id but the demo's", () => {
    const a = tenantA!;
    const demo = new Set([a.tenant, a.mapping, a.sourceMailbox, a.targetMailbox, a.sourceConnection, a.targetConnection]);
    const ids = new Set(all.match(UUID) ?? []);
    expect(ids.size).toBeGreaterThan(0);
    expect([...ids].filter((id) => !demo.has(id))).toEqual([]);
  });

  it('scopes every DELETE to the organisation and the migration', () => {
    const a = tenantA!;
    const mapping = `tenant_id = '${a.tenant}' AND mapping_id = '${a.mapping}'`;
    const throughRuns = `tenant_id = '${a.tenant}' AND run_id IN (SELECT id FROM public.run WHERE ${mapping})`;
    for (const d of deletes) {
      expect(d.where, `DELETE FROM ${d.table}`).toBe(d.table === 'run_event' ? throughRuns : mapping);
    }
  });

  it('writes nothing but those DELETEs', () => {
    expect(all).not.toMatch(/\b(?:UPDATE|INSERT|TRUNCATE|DROP|ALTER|GRANT|REVOKE|CREATE)\b/);
  });

  it('clears every table its header names, and no other, in the header\'s order', () => {
    const text = read(SCRIPT_REL);
    const header = text.slice(0, text.indexOf('\nset -euo pipefail'));
    const block = header.slice(header.indexOf('# WHAT IT CLEARS IN THE DATABASE'), header.indexOf('# WHAT IT KEEPS IN THE DATABASE'));
    const named = [...block.matchAll(/^# {3}([a-z_]+) {2,}\S/gm)].map((m) => m[1]);
    expect(named.length, 'the header lists no table').toBeGreaterThan(10);
    expect(deletes.map((d) => d.table)).toEqual(named);
  });
});

describe('what stops it before anything is removed', () => {
  it("an answer that the ids are not the demo's", () => {
    for (const args of [[], ['--yes']]) {
      const r = run(args, { env: { STUB_NOT_THE_DEMO: '1' } });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('is not the demo mail migration');
      expect(r.out).toContain('Nothing was changed');
      expect(removals(r)).toEqual([]);
      expect(r.sql).toHaveLength(1);
    }
  });

  it('a pass of the migration still running', () => {
    const r = run(['--yes'], { env: { STUB_RUNNING: '1' } });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('2026-11-20 03:41 UTC');
    expect(removals(r)).toEqual([]);
    expect(r.sql).toHaveLength(1);
    // Shown, not refused, without --yes.
    const dry = run([], { env: { STUB_RUNNING: '1' } });
    expect(dry.status, dry.out).toBe(0);
    expect(dry.out).toContain('--yes refuses until it has ended');
  });

  it('a container of that name that is not Stalwart', () => {
    const r = run(['--yes'], { env: { STUB_IMAGE: 'nginx:1.29' } });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('not Stalwart');
    expect(removals(r)).toEqual([]);
    expect(r.sql).toEqual([]);
  });

  it.each(['container inspect', 'volume inspect'])(
    'a Docker that cannot be asked (%s), which is never read as "absent"',
    (call) => {
      const r = run(['--yes'], { env: { STUB_DOCKER_DOWN: call } });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('Cannot connect to the Docker daemon');
      expect(removals(r)).toEqual([]);
      expect(r.sql).toEqual([]);
    },
  );

  it('and a volume Docker will not remove stops it before any row is cleared', () => {
    const r = run(['--yes'], { env: { STUB_VOLUME_BUSY: '1' } });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('volume is in use');
    expect(r.out).toContain('no row was changed');
    expect(r.sql).toHaveLength(1);
  });

  it('what is absent already is not removed again, and the rows are still cleared', () => {
    const r = run(['--yes'], { env: { STUB_NO_CONTAINER: '1', STUB_NO_DATA: '1' } });
    expect(r.status, r.out).toBe(0);
    expect(removals(r)).toEqual([]);
    expect(r.sql).toHaveLength(2);
    expect(r.out).toContain('ownpace-stalwart: absent, nothing to remove');
  });
});

describe('nothing runs it but a person', () => {
  it('no workflow, deploy file, script or package names it outside a comment', () => {
    const files: string[] = [];
    const walk = (rel: string): void => {
      for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
        const path = `${rel}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name !== 'node_modules' && e.name !== '__pycache__') walk(path);
        } else files.push(path);
      }
    };
    walk('.github/workflows');
    walk('deploy');
    for (const f of readdirSync(join(ROOT, 'scripts'))) {
      const path = `scripts/${f}`;
      if (!f.endsWith('.test.ts') && statSync(join(ROOT, path)).isFile()) files.push(path);
    }
    files.push('package.json', 'apps/api/package.json', 'apps/worker/package.json');
    const callers = files
      .filter((f) => f !== SCRIPT_REL)
      .flatMap((f) =>
        read(f)
          .split('\n')
          .map((line, i) => ({ f, n: i + 1, line }))
          .filter(({ line }) => line.includes('reset-demo-mail') && !/^\s*(?:#|;|\/\/)/.test(line)),
      )
      .map(({ f, n, line }) => `${f}:${n}: ${line.trim()}`);
    expect(files.length, 'read almost nothing: the walk is blind').toBeGreaterThan(100);
    expect(callers, 'the reset is run once, by hand: nothing in the gate or the bring-up calls it').toEqual([]);
  });
});

describe('it parses', () => {
  it('bash -n', () => {
    const r = spawnSync('bash', ['-n', join(ROOT, SCRIPT_REL)], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });
});
