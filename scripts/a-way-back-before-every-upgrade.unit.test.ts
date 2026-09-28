// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WAY BACK BEFORE EVERY UPGRADE: the dump an identity provider upgrade needs
 * was four commands pasted from a chat (workplan 0135 T7, *Before an upgrade*).
 *
 * Zitadel moves its schema one way when a newer version starts, and during
 * the alpha nothing backs the stack up (0134 D1). So before each upgrade the
 * owner dumps the provider's database by hand. For v4.19.1, on 2026-09-28,
 * that was four commands from a chat, and the owner asked the same day for a
 * script to use before every update. `deploy/compose/dump-idp.sh` is that
 * script. What it must never get wrong, one case each:
 *
 *   Whose stack. It dumps the stack of the checkout it runs in, from the
 *   project `compose_project` reads, and refuses before any `docker` call
 *   when the shell names the other stack.
 *
 *   A dump that is no way back. A file with the final name has read back
 *   through the server's own `pg_restore --list`, with entries. An empty dump,
 *   empty roles, one that does not read, or one with no entries leaves nothing
 *   behind, not even its working files.
 *
 *   Who can read it. The directory is the owner's alone, and so is each file:
 *   the dump holds the provider's accounts, the roles their password hashes.
 *   Nothing is overwritten.
 *
 *   The note. It names the image that was running and the one managed.yml
 *   pins, the entries, and a fingerprint of the master key the dump needs,
 *   never the key. Its way back names the exact files: the database replaced
 *   with `--clean --if-exists --create`, and the roles only on a new server,
 *   since on the same one they would set the database password back.
 *
 *   It touches nothing. Every `docker` call is a read: the image, `pg_dump`,
 *   `pg_dumpall --roles-only` and `pg_restore --list`. No Compose command, no
 *   stop, no write to a database.
 *
 * `docker` and `date` are stubs on the PATH. The way back itself was
 * rehearsed against a real Postgres, as the script's header says.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const SCRIPT = 'dump-idp.sh';
const OTA = 'ownpace-managed';
const LIVE = 'ownpace-live';
const STAMP = '20260928T101500Z';
const IMAGE = 'ghcr.io/zitadel/zitadel:v4.19.1';
const MASTERKEY = 'MasterkeyNeedsToHave32Characters';
/** What the `pg_dump` stub writes: a custom-format dump starts with `PGDMP`. */
const DUMP_BYTES = 'PGDMP fixture dump of the identity provider\n';
const ROLES_SQL = 'CREATE ROLE zitadel;\nALTER ROLE zitadel WITH LOGIN;\n';

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const DOCKER_STUB = `#!/usr/bin/env bash
# The docker stub: logs every call, answers the four reads dump-idp.sh makes.
printf 'docker %s\\n' "$*" >>"$STUB_LOG"
case "$1" in
  inspect)
    [ "\${STUB_IDP:-}" = absent ] && exit 1
    printf '%s\\n' "$STUB_IMAGE" ;;
  exec)
    shift
    [ "$1" = -i ] && shift
    shift
    case "$*" in
      *'pg_dump '*)
        [ "\${STUB_DUMP:-}" = fail ] && exit 1
        [ "\${STUB_DUMP:-}" = empty ] || printf '%s' "$STUB_DUMP_BYTES" ;;
      *'pg_dumpall '*)
        [ "\${STUB_ROLES:-}" = empty ] || printf '%s' "$STUB_ROLES_SQL" ;;
      *'pg_restore --list'*)
        input="$(cat)"
        [ "\${STUB_LIST:-}" = fail ] && { echo 'pg_restore: error: input file is too short' >&2; exit 1; }
        case "$input" in PGDMP*) ;; *) echo 'pg_restore: error: input file does not appear to be a valid archive' >&2; exit 1 ;; esac
        printf ';\\n; Archive created at 2026-09-28 10:15:00 UTC\\n;     TOC Entries: %s\\n;\\n' "\${STUB_ENTRIES:-699}" ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
`;

/** `date -u +%Y%m%dT%H%M%SZ` answers a fixed moment; anything else goes to the real one. */
const DATE_STUB = `#!/usr/bin/env bash
if [ "$*" = '-u +%Y%m%dT%H%M%SZ' ]; then printf '%s\\n' "$STUB_STAMP"; exit 0; fi
exec /bin/date "$@"
`;

interface Run {
  status: number | null;
  out: string;
  err: string;
  calls: string[];
  home: string;
  dir: string;
  files: string[];
}

function run(opts: {
  dotenv?: string;
  args?: string[];
  shell?: Record<string, string>;
  stub?: Record<string, string>;
  before?: (home: string) => void;
} = {}): Run {
  const root = mkdtempSync(join(tmpdir(), 'dump-idp-'));
  tempDirs.push(root);
  const compose = join(root, 'checkout', 'deploy', 'compose');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  mkdirSync(compose, { recursive: true });
  mkdirSync(bin);
  mkdirSync(home);
  for (const f of [SCRIPT, 'env-read.sh', 'stack-kind.sh', 'managed.yml']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  }
  writeFileSync(
    join(compose, '.env'),
    opts.dotenv ?? `POSTGRES_USER=openmigrate\nZITADEL_MASTERKEY=${MASTERKEY}\n`,
  );
  const log = join(root, 'docker.log');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'docker'), DOCKER_STUB);
  writeFileSync(join(bin, 'date'), DATE_STUB);
  chmodSync(join(bin, 'docker'), 0o755);
  chmodSync(join(bin, 'date'), 0o755);
  opts.before?.(home);
  const r = spawnSync('bash', [join(compose, SCRIPT), ...(opts.args ?? [])], {
    cwd: join(root, 'checkout'),
    env: {
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: home,
      STUB_LOG: log,
      STUB_IMAGE: IMAGE,
      STUB_STAMP: STAMP,
      STUB_DUMP_BYTES: DUMP_BYTES,
      STUB_ROLES_SQL: ROLES_SQL,
      ...opts.stub,
      ...opts.shell,
    },
    encoding: 'utf8',
    timeout: 20_000,
  });
  const project = /COMPOSE_PROJECT_NAME=(\S+)/.exec(opts.dotenv ?? '')?.[1] ?? OTA;
  const dir = join(home, 'ownpace-dumps', project);
  return {
    status: r.status,
    out: r.stdout,
    err: r.stderr,
    calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
    home,
    dir,
    files: existsSync(dir) ? readdirSync(dir).sort() : [],
  };
}

const mode = (path: string) => (statSync(path).mode & 0o777).toString(8);

describe('whose stack', () => {
  it("dumps the identity provider of the OTA stack's own checkout, and says where", () => {
    const r = run();
    expect(r.status, r.err).toBe(0);
    expect(r.files).toEqual([
      `roles-${OTA}-${STAMP}.sql`,
      `zitadel-${OTA}-${STAMP}.dump`,
      `zitadel-${OTA}-${STAMP}.txt`,
    ]);
    expect(readFileSync(join(r.dir, `zitadel-${OTA}-${STAMP}.dump`), 'utf8')).toBe(DUMP_BYTES);
    expect(readFileSync(join(r.dir, `roles-${OTA}-${STAMP}.sql`), 'utf8')).toBe(ROLES_SQL);
    expect(r.out).toContain('dump done, 699 entries read back');
    expect(r.out).toContain(r.dir);
  });

  it("in live's checkout, dumps live, and names nothing of the OTA stack", () => {
    const r = run({
      dotenv: `COMPOSE_PROJECT_NAME=${LIVE}\nSTACK_KIND=production\nZITADEL_MASTERKEY=${MASTERKEY}\n`,
    });
    expect(r.status, r.err).toBe(0);
    expect(r.calls.join('\n')).toContain(`${LIVE}-db`);
    expect(r.calls.join('\n')).toContain(`${LIVE}-idp`);
    expect(r.calls.join('\n')).not.toContain(OTA);
    expect(r.files).toContain(`zitadel-${LIVE}-${STAMP}.dump`);
  });

  it('refuses before any docker call when the shell names the other stack', () => {
    const r = run({ shell: { COMPOSE_PROJECT_NAME: LIVE } });
    expect(r.status).not.toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.err).toContain('unset COMPOSE_PROJECT_NAME');
    expect(existsSync(join(r.home, 'ownpace-dumps'))).toBe(false);
  });

  it('dumps the database ZITADEL_DB_NAME names, and refuses one that is not a plain name before any docker call', () => {
    const named = run({ dotenv: `ZITADEL_DB_NAME=idp_db\nZITADEL_MASTERKEY=${MASTERKEY}\n` });
    expect(named.status, named.err).toBe(0);
    expect(named.calls.find((c) => c.includes('pg_dump '))).toMatch(/ sh idp_db$/);
    expect(named.files).toContain(`idp_db-${OTA}-${STAMP}.dump`);

    const odd = run({ dotenv: "ZITADEL_DB_NAME='zitadel; rm -rf /'\n" });
    expect(odd.status).not.toBe(0);
    expect(odd.calls).toEqual([]);
    expect(odd.err).toContain('not a plain database name');
  });
});

describe('a dump that is no way back leaves nothing behind', () => {
  it.each([
    ['an empty dump', { STUB_DUMP: 'empty' }],
    ['empty roles', { STUB_ROLES: 'empty' }],
    ['a pg_dump that fails', { STUB_DUMP: 'fail' }],
    ['a dump that does not read back', { STUB_LIST: 'fail' }],
    ['a dump that reads back with no entries', { STUB_ENTRIES: '0' }],
  ])('%s', (_name, stub) => {
    const r = run({ stub });
    expect(r.status).not.toBe(0);
    expect(r.files, 'a file with the final name must be a dump that reads back').toEqual([]);
    expect(r.out).not.toContain('dump done');
  });

  it('reads the dump back through the server\'s own pg_restore, fed the dump itself', () => {
    const r = run();
    expect(r.calls).toContain(`docker exec -i ${OTA}-db pg_restore --list`);
  });
});

describe('who can read it', () => {
  it('makes the directory and every file readable by the owner alone', () => {
    const r = run();
    expect(r.status, r.err).toBe(0);
    expect(mode(r.dir)).toBe('700');
    for (const f of r.files) expect(mode(join(r.dir, f)), f).toBe('600');
  });

  it('never overwrites a file, and writes nothing when one of its names is taken', () => {
    const taken = `roles-${OTA}-${STAMP}.sql`;
    const r = run({
      before: (home) => {
        const dir = join(home, 'ownpace-dumps', OTA);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(join(dir, taken), 'an earlier file\n');
      },
    });
    expect(r.status).not.toBe(0);
    expect(r.files).toEqual([taken]);
    expect(readFileSync(join(r.dir, taken), 'utf8')).toBe('an earlier file\n');
    expect(r.calls).toEqual([]);
  });

  it('writes into the directory --dir names, and refuses an argument it does not know before any docker call', () => {
    const r = run({ args: ['--dir', 'elsewhere'] });
    expect(r.status, r.err).toBe(0);
    expect(r.files).toEqual([]);
    expect(r.out).toContain('elsewhere');

    const bad = run({ args: ['--force'] });
    expect(bad.status).toBe(2);
    expect(bad.calls).toEqual([]);
  });
});

describe('the note', () => {
  const r = run();
  const note = readFileSync(join(r.dir, `zitadel-${OTA}-${STAMP}.txt`), 'utf8');
  const pinned = /^\s*image:\s*(ghcr\.io\/zitadel\/zitadel:\S+)/m.exec(
    readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8'),
  )![1]!;

  it('names the running image, the pin, the entries and the moment', () => {
    expect(note).toContain(`Running:     ${IMAGE}`);
    expect(note).toContain(`Pinned:      ${pinned}`);
    expect(note).toContain('699 entries read back');
    expect(note).toContain('dumped 2026-09-28 10:15:00 UTC');
  });

  it('names the master key by a fingerprint, and never the key, there or on the screen', () => {
    const fingerprint = createHash('sha256').update(MASTERKEY).digest('hex').slice(0, 12);
    expect(note).toContain(`sha256:${fingerprint}`);
    expect(r.out).toContain(`sha256:${fingerprint}`);
    for (const text of [note, r.out, r.err]) expect(text).not.toContain(MASTERKEY);
  });

  it('goes back by replacing the whole database with the exact dump, the roles only on a new server', () => {
    expect(note).toContain(
      `docker exec -i ${OTA}-db sh -c 'pg_restore -U "$POSTGRES_USER" -d postgres --clean --if-exists --create' < zitadel-${OTA}-${STAMP}.dump`,
    );
    const roles = note.indexOf(`< roles-${OTA}-${STAMP}.sql`);
    expect(roles).toBeGreaterThan(-1);
    expect(note.slice(note.lastIndexOf('\n', note.lastIndexOf('\n', roles) - 1), roles)).toMatch(/Only on a NEW server/);
    expect(note).toMatch(/set the\s+provider's database password back/);
    expect(note).toContain('docker compose -f deploy/compose/managed.yml stop zitadel');
    expect(note).toContain('docker compose -f deploy/compose/managed.yml up -d zitadel');
    expect(note).toMatch(/main must carry the revert too/);
  });
});

describe('it touches nothing', () => {
  it('asks docker for the image and three reads, and for nothing else', () => {
    const r = run();
    expect(r.status, r.err).toBe(0);
    expect(r.calls).toEqual([
      `docker inspect --format {{.Config.Image}} ${OTA}-idp`,
      `docker exec ${OTA}-db sh -c pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom sh zitadel`,
      `docker exec ${OTA}-db sh -c pg_dumpall -U "$POSTGRES_USER" --roles-only`,
      `docker exec -i ${OTA}-db pg_restore --list`,
    ]);
  });

  it('still dumps when the identity provider is not running, and says so in the note', () => {
    const r = run({ stub: { STUB_IDP: 'absent' } });
    expect(r.status, r.err).toBe(0);
    const note = readFileSync(join(r.dir, `zitadel-${OTA}-${STAMP}.txt`), 'utf8');
    expect(note).toContain(`Running:     unknown: no ${OTA}-idp container`);
  });
});

describe('where an upgrade is told to use it', () => {
  // The workplan names it too, but a workplan is not on a path CI runs the
  // tests for (a-doc-a-test-reads-that-ci-skipped), so it is not read here.
  it("the runbook's Backup & restore and the pin watch's issue name it", () => {
    const runbook = readFileSync(join(REPO_ROOT, 'docs', 'operator-runbook.md'), 'utf8');
    const start = runbook.indexOf('## Backup & restore');
    const backup = runbook.slice(start, runbook.indexOf('\n## ', start + 1));
    expect(backup).toContain('./deploy/compose/dump-idp.sh');
    const watch = readFileSync(join(REPO_ROOT, 'scripts', 'idp-pin-watch.mjs'), 'utf8');
    expect(watch).toContain('./deploy/compose/dump-idp.sh');
  });
});
