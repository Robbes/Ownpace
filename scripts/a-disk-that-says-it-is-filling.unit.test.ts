// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DISK THAT SAYS IT IS FILLING, AND DUTIES THAT SAY THEY FAILED (workplan
 * 0142 T3).
 *
 * Live's daily duties (`box-duties.sh`, 0132 T7) keep promises with clocks on
 * them: the identity provider's provisioning token (seven days, replaced in its
 * last three; past its deadline only a person in the console can mint another),
 * the copy before an update (never kept past day 7, and its day-6 failure is
 * the warning to roll back), the sign-in accounts privacy §9 says go after 30
 * days. Until this change a failed run said so in the user journal and nowhere
 * else: *"Nobody is told when it fails (0142 is where that changes)"*. A
 * timer that stopped, or was never enabled, said nothing at all, because
 * systemd's `OnFailure=` fires when a run fails and never when no run happens.
 * And both stacks fill one disk beside the nightly gate, which nothing watched
 * after the bring-up's preflight.
 *
 * So, on live's machine:
 *
 *   - `deploy/compose/tell-owner.sh` sends one plain-text mail through the
 *     relay the status page's alerts use (0142 T1), with the same fallbacks;
 *   - `ownpace-box-duties.service` has `OnFailure=` a template unit that runs
 *     it, so a failed run is a mail naming the duties that failed;
 *   - `deploy/compose/box-checks.sh`, every ten minutes, watches the free space
 *     on Docker's filesystem and on live's persisted directory, and the age of
 *     the duties' last pass (the dead man's switch), and once a day sends a
 *     summary of numbers.
 *
 * WHAT IS ASSERTED.
 *
 *   `box-checks.sh`, in a staged checkout of live with `df`, `docker`,
 *   `systemctl`, `date` and `tell-owner.sh` replaced by stubs on PATH and
 *   beside it, as `seed-managed.unit.test.ts` stubs `docker`: 14 GB free sends
 *   one message naming the mount point; a second run at 14 GB sends nothing;
 *   16 GB sends one recovery; the floor is live's `ALERT_DISK_FREE_GB`; two
 *   paths on one filesystem are one message; a `df` or a `docker` that cannot
 *   answer is a message of its own, never free space, and a failed exit; a
 *   message that could not be sent is sent again by the next run. The duties'
 *   last pass more than 26 hours ago, or none in the first 26 hours of
 *   watching, is one message, and a fresh pass arms it again. The summary goes
 *   once a day at the first run from 07:00 UTC, or with `--summary`, and holds
 *   numbers only: a pattern sweep over everything it sent and printed finds no
 *   e-mail address, no UUID, no IPv4 address and no secret from the `.env`.
 *   It refuses, before any check, a `.env` that is not live's.
 *
 *   `tell-owner.sh`, run for real with `curl` stubbed: the relay, the login
 *   and the addresses reach curl in a config on a file descriptor, never on its
 *   command line or in its environment; STARTTLS is required on 587 and
 *   implicit TLS used on 465 or with `SMTP_SECURE=true`; the envelope sender is
 *   the bare address; `ALERT_*` comes before `SMTP_*` and `NOTIFY_*`, as
 *   `managed.yml` gives them to the status page; a `"` or `\` in the password
 *   reaches curl escaped; a curl that fails is a failed exit; it refuses a
 *   `.env` that is not live's, a relay that is a placeholder, and a traced
 *   shell. `--unit` composes the message systemd's template unit sends, from
 *   the record `box-duties.sh` leaves.
 *
 *   End to end: `box-checks.sh` with the real `tell-owner.sh` sends a low disk
 *   and a summary, and the bodies hold no address and no secret.
 *
 * The units themselves, and the record `box-duties.sh` writes, are asserted in
 * `a-duty-the-gate-used-to-do.unit.test.ts`, beside the duties' own; the rows
 * in `docs/incident-runbook.md` in `a-runbook-for-every-alert.unit.test.ts`.
 *
 * Addresses here are documentation shapes: `example.test`, `100.64.0.1`.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(ROOT, 'deploy/compose');
const CHECKS_REL = 'deploy/compose/box-checks.sh';
const TELL_REL = 'deploy/compose/tell-owner.sh';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
}, 60_000);

function writeExec(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

const REAL_DATE = (spawnSync('sh', ['-c', 'command -v date'], { encoding: 'utf8' }).stdout ?? '').trim() || '/usr/bin/date';

/** 2026-10-21T08:00:00Z: after the summary's hour, so a plain run on a day without one sends it. */
const NOW = Date.UTC(2026, 9, 21, 8, 0, 0) / 1000;
const HOUR = 3600;
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const day = (epoch: number): string => iso(epoch).slice(0, 10);

/** This machine's mesh address, and a secret, in live's `.env`: neither may be sent or printed. */
const MESH = '100.64.0.1';
const SENTINEL = 'sentinel-7c41b2';
const RELAY_PASSWORD = `pa"ss\\${SENTINEL}`;

const LIVE_ENV = [
  'COMPOSE_PROJECT_NAME=ownpace-live',
  'STACK_KIND=production',
  'ZITADEL_PAT_EXPIRY=2026-10-25T13:17:00Z',
  `WEB_BIND=${MESH}`,
  `POSTGRES_PASSWORD=${SENTINEL}`,
  'SMTP_HOST=smtp.example.test',
  'SMTP_PORT=587',
  'SMTP_SECURE=',
  'SMTP_USER=relay-login@example.test',
  `SMTP_PASSWORD='${RELAY_PASSWORD}'`,
  `NOTIFY_FROM='"Ownpace" <alerts@example.test>'`,
  'NOTIFY_TO=owner@example.test, second@example.test',
  'ALERT_ENABLED=true',
  'ALERT_SMTP_HOST=',
  'ALERT_SMTP_PORT=',
  'ALERT_SMTP_USER=',
  'ALERT_SMTP_PASSWORD=',
  'ALERT_FROM=',
  'ALERT_TO=',
  '',
].join('\n');
/** The OTA stack's `.env`: no marker, no project. */
const OTA_ENV = LIVE_ENV.split('\n')
  .filter((l) => !/^(COMPOSE_PROJECT_NAME|STACK_KIND)=/.test(l))
  .join('\n');

/** What `docker system df -v` prints, in the shape Docker 29 prints it: one volume of nobody's stack among them. */
const SYSTEM_DF = `Images space usage:

REPOSITORY   TAG       IMAGE ID       CREATED       SIZE      SHARED SIZE   UNIQUE SIZE   CONTAINERS
postgres     18        0123456789ab   2 weeks ago   456MB     0B            456MB         2

Containers space usage:

CONTAINER ID   IMAGE         COMMAND                  LOCAL VOLUMES   SIZE      CREATED       STATUS       NAMES
0123456789ab   postgres:18   "docker-entrypoint.s…"   1               63B       2 weeks ago   Up 2 weeks   ownpace-live-postgres

Local Volumes space usage:

VOLUME NAME                          LINKS     SIZE
ownpace-live_postgres_data           1         1.5GB
ownpace-live_trigger_clickhouse      1         12.3GB
ownpace-managed_postgres_data        1         3.21GB
ownpace-managed_trigger_minio        1         800MB
not-ours_data                        1         99GB
ownpace-live_gatus_data              1         45.1kB
ownpace-managed_trigger_registry     1         5.6GB
ownpace-live_zitadel_machinekey      1         0B

Build cache usage: 0B

CACHE ID   CACHE TYPE   SIZE      CREATED   LAST USED   USAGE     SHARED
`;
const TOP_FIVE = [
  'ownpace-live_trigger_clickhouse',
  'ownpace-managed_trigger_registry',
  'ownpace-managed_postgres_data',
  'ownpace-live_postgres_data',
  'ownpace-managed_trigger_minio',
];

// ---------------------------------------------------------------------------
// The stand-ins
// ---------------------------------------------------------------------------

/** df -P -k <path>: the filesystem whose prefix in STUB_DF_MAP is the longest, `prefix|mount|kB free` or `prefix|mount|fail`. */
const DF_STUB = `#!/usr/bin/env bash
echo "df $*" >>"$STUB_LOG"
path="\${@: -1}"
best=''; mount=''; avail=''
while IFS='|' read -r prefix m a; do
  [ -n "$prefix" ] || continue
  case "$path" in
    "$prefix" | "$prefix"/*) if [ "\${#prefix}" -gt "\${#best}" ]; then best="$prefix"; mount="$m"; avail="$a"; fi ;;
  esac
done <"$STUB_DF_MAP"
[ -n "$best" ] || { echo "df: $path: No such file or directory" >&2; exit 1; }
[ "$avail" != fail ] || { echo "df: $path: Input/output error" >&2; exit 1; }
echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"
echo "/dev/stub        999999999         1 $avail        1% $mount"
`;

/**
 * docker: info names the data root; ps finds a stack's service by its compose
 * labels when STUB_RUNNING names the project; exec answers psql by what the
 * SQL asks; system df -v prints SYSTEM_DF.
 */
const DOCKER_STUB = `#!/usr/bin/env bash
echo "docker $*" >>"$STUB_LOG"
case "$1" in
  info)
    [ -z "\${STUB_DOCKER_INFO_FAIL:-}" ] || { echo "Cannot connect to the Docker daemon. Is the docker daemon running?" >&2; exit 1; }
    echo "$STUB_DOCKER_ROOT" ;;
  ps)
    p=''; s=''
    for a in "$@"; do
      case "$a" in
        label=com.docker.compose.project=*) p="\${a#label=com.docker.compose.project=}" ;;
        label=com.docker.compose.service=*) s="\${a#label=com.docker.compose.service=}" ;;
      esac
    done
    case " \${STUB_RUNNING:-} " in *" $p "*) echo "id-\${p}-\${s}" ;; esac ;;
  exec)
    id="$3"; sql="$(cat)"
    printf '%s\\n-- %s\\n' "$sql" "$id" >>"$STUB_SQL_LOG"
    case ",\${STUB_EXEC_FAIL:-}," in *",$id,"*) echo "psql: error: connection to server on socket failed" >&2; exit 2 ;; esac
    case "$id" in
      *-postgres)
        if [[ "$sql" == *pg_database_size* ]]; then
          printf 'openmigrate 1288490188\\npostgres 7655727\\nzitadel 268435456\\n'
        else
          echo "\${STUB_COUNTS:-yes|1234|567890|12345|678|42}"
        fi ;;
      *-trigger-db) printf 'postgres 7655727\\ntriggerdb 2254857830\\n' ;;
    esac ;;
  system)
    [ -z "\${STUB_SYSTEM_DF_FAIL:-}" ] || { echo "Error response from daemon: a disk usage operation is already running" >&2; exit 1; }
    cat "$STUB_SYSTEM_DF" ;;
  *) echo "docker stub: not expected: $*" >&2; exit 99 ;;
esac
`;

const SYSTEMCTL_STUB = `#!/usr/bin/env bash
echo "systemctl $*" >>"$STUB_LOG"
case "$*" in
  *is-active*) echo "\${STUB_TIMER:-active}"; [ "\${STUB_TIMER:-active}" = active ] ;;
  *show*Result*) echo "\${STUB_RESULT:-exit-code}" ;;
  *) exit 1 ;;
esac
`;

/** date, at STUB_NOW, whenever it is not handed a date of its own. */
const DATE_STUB = `#!/usr/bin/env bash
for a in "$@"; do case "$a" in -d | -d* | --date | --date=*) exec ${REAL_DATE} "$@" ;; esac; done
[ -z "\${STUB_NOW:-}" ] || exec ${REAL_DATE} -d "@\${STUB_NOW}" "$@"
exec ${REAL_DATE} "$@"
`;

/** tell-owner.sh, recording each message: `=== <name>`, `--- <detail>`, then the body. */
const TELL_STUB = `#!/usr/bin/env bash
body="$(cat)"
printf '=== %s\\n--- %s\\n%s\\n' "$1" "\${2:-}" "$body" >>"$STUB_TOLD"
[ -z "\${STUB_TELL_FAIL:-}" ] || { echo "[tell-owner] not sent (the stub says no)" >&2; exit 1; }
`;

/** curl: its arguments, its environment, the config on fd 3 and the message on stdin, each call apart. */
const CURL_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$STUB_CURL_ARGS"
env >>"$STUB_CURL_ENV"
{ cat /dev/fd/3 2>/dev/null || echo "NO CONFIG ON FD 3"; echo "=== end"; } >>"$STUB_CURL_CONFIG"
{ cat; echo "=== end"; } >>"$STUB_CURL_MAIL"
[ -z "\${STUB_CURL_FAIL:-}" ] || { echo "curl: (67) Login denied" >&2; exit 67; }
`;

// ---------------------------------------------------------------------------
// A checkout of live
// ---------------------------------------------------------------------------

interface Stage {
  root: string;
  compose: string;
  persist: string;
  log: string;
  told: string;
  sqlLog: string;
  dfMap: string;
  curl: { args: string; env: string; config: string; mail: string };
  env: NodeJS.ProcessEnv;
}

interface StageOptions {
  dotEnv?: string;
  /** The real tell-owner.sh, with curl stubbed, instead of the stand-in. */
  realTell?: boolean;
}

function stage(opts: StageOptions = {}): Stage {
  for (const rel of [CHECKS_REL, TELL_REL]) {
    if (!existsSync(join(ROOT, rel))) throw new Error(`${rel} does not exist`);
  }
  const root = tempDir('box-checks-');
  const compose = join(root, 'ownpace-live', 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of ['box-checks.sh', 'env-read.sh', 'stack-kind.sh', 'managed.yml']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  }
  chmodSync(join(compose, 'box-checks.sh'), 0o755);
  if (opts.realTell) {
    copyFileSync(join(COMPOSE_DIR, 'tell-owner.sh'), join(compose, 'tell-owner.sh'));
    chmodSync(join(compose, 'tell-owner.sh'), 0o755);
  } else {
    writeExec(join(compose, 'tell-owner.sh'), TELL_STUB);
  }
  writeFileSync(join(compose, '.env'), opts.dotEnv ?? LIVE_ENV);

  const bin = join(root, 'bin');
  writeExec(join(bin, 'df'), DF_STUB);
  writeExec(join(bin, 'docker'), DOCKER_STUB);
  writeExec(join(bin, 'systemctl'), SYSTEMCTL_STUB);
  writeExec(join(bin, 'date'), DATE_STUB);
  writeExec(join(bin, 'curl'), CURL_STUB);

  const persist = join(root, '.persistent', 'ownpace-live');
  mkdirSync(persist, { recursive: true });
  const log = join(root, 'calls.log');
  const told = join(root, 'told.log');
  const sqlLog = join(root, 'sql.log');
  const dfMap = join(root, 'df.map');
  const systemDf = join(root, 'system-df.txt');
  const curl = {
    args: join(root, 'curl.args'),
    env: join(root, 'curl.env'),
    config: join(root, 'curl.config'),
    mail: join(root, 'curl.mail'),
  };
  for (const f of [log, told, sqlLog, curl.args, curl.env, curl.config, curl.mail]) writeFileSync(f, '');
  writeFileSync(systemDf, SYSTEM_DF);
  const s: Stage = {
    root,
    compose,
    persist,
    log,
    told,
    sqlLog,
    dfMap,
    curl,
    env: {
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: root,
      LANG: 'C',
      STUB_LOG: log,
      STUB_TOLD: told,
      STUB_SQL_LOG: sqlLog,
      STUB_DF_MAP: dfMap,
      STUB_DOCKER_ROOT: '/var/lib/docker',
      STUB_SYSTEM_DF: systemDf,
      STUB_RUNNING: 'ownpace-live ownpace-managed',
      STUB_NOW: String(NOW),
      STUB_CURL_ARGS: curl.args,
      STUB_CURL_ENV: curl.env,
      STUB_CURL_CONFIG: curl.config,
      STUB_CURL_MAIL: curl.mail,
    },
  };
  // Docker on a filesystem of its own, live's persisted directory on another,
  // both with room.
  free(s, { docker: 100, persist: 100 });
  // Today's summary already sent, so a plain run checks and says nothing more.
  writeState(s, 'summary', day(NOW));
  return s;
}

/** Free space, in GB, on Docker's filesystem and on live's persisted directory's; `fail` is a df that cannot say; `same` puts the second on the first. */
function free(s: Stage, f: { docker: number | 'fail'; persist: number | 'fail' | 'same' }): void {
  const kb = (gb: number | 'fail'): string => (gb === 'fail' ? 'fail' : String(gb * 1024 * 1024));
  const lines = [`/var/lib/docker|/var/lib/docker|${kb(f.docker)}`];
  if (f.persist === 'same') lines.push(`${s.root}|/var/lib/docker|${kb(f.docker)}`);
  else lines.push(`${s.root}|/home|${kb(f.persist)}`);
  writeFileSync(s.dfMap, `${lines.join('\n')}\n`);
}

function writeState(s: Stage, name: string, value: string): void {
  mkdirSync(join(s.persist, 'box-checks'), { recursive: true });
  writeFileSync(join(s.persist, 'box-checks', name), `${value}\n`);
}

/** A record as box-duties.sh writes it: `<epoch> <iso> <result> <names or ->`. */
function writeRecord(s: Stage, file: 'last-run' | 'last-pass', epoch: number, result: string, names = '-'): void {
  mkdirSync(join(s.persist, 'box-duties'), { recursive: true });
  writeFileSync(join(s.persist, 'box-duties', file), `${epoch} ${iso(epoch)} ${result} ${names}\n`);
}

/** The duties passed an hour ago, so the dead man's switch is quiet. */
function dutiesPassed(s: Stage, epoch = NOW - HOUR): void {
  writeRecord(s, 'last-run', epoch, 'passed');
  writeRecord(s, 'last-pass', epoch, 'passed');
}

function checks(s: Stage, args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(join(s.compose, 'box-checks.sh'), args, {
    encoding: 'utf8',
    env: { ...s.env, ...extra },
    cwd: join(s.root, 'ownpace-live'),
    timeout: 60_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

interface Told {
  name: string;
  detail: string;
  body: string;
}

/** Every message box-checks.sh handed tell-owner.sh, oldest first. */
function told(s: Stage): Told[] {
  return readFileSync(s.told, 'utf8')
    .split(/^=== /m)
    .filter(Boolean)
    .map((chunk) => {
      const [name = '', detailLine = '', ...body] = chunk.split('\n');
      return { name, detail: detailLine.replace(/^--- /, ''), body: body.join('\n') };
    });
}
const clearTold = (s: Stage): void => writeFileSync(s.told, '');
const calls = (s: Stage, what: string): string[] =>
  readFileSync(s.log, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith(`${what} `));

/** What must never leave the machine in a message: an address of any kind, an id, a secret. */
function expectNothingIdentifying(text: string, where: string): void {
  expect(text, `${where} holds an e-mail address`).not.toMatch(/[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}/i);
  expect(text, `${where} holds a UUID`).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  expect(text, `${where} holds an IPv4 address`).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  expect(text, `${where} holds a secret from the .env`).not.toContain(SENTINEL);
}

// ===========================================================================
// box-checks.sh
// ===========================================================================

describe('box-checks.sh keeps to live', () => {
  it("refuses the OTA stack's .env before any check, and asks nothing", () => {
    const s = stage({ dotEnv: OTA_ENV });
    const r = checks(s);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toMatch(/REFUSED/);
    expect(r.out).toContain('STACK_KIND');
    expect(calls(s, 'df')).toEqual([]);
    expect(calls(s, 'docker')).toEqual([]);
    expect(told(s)).toEqual([]);
  });

  it('refuses an argument it does not know, and a floor that is not a whole number, naming the key', () => {
    const s = stage();
    const bad = checks(s, ['--now']);
    expect(bad.status, bad.out).toBe(2);
    expect(bad.out).toMatch(/Usage: .*box-checks\.sh \[--summary\]/);
    for (const value of ['fifteen', '0', '15.5', '-3']) {
      const f = stage({ dotEnv: `${LIVE_ENV}ALERT_DISK_FREE_GB=${value}\n` });
      const r = checks(f);
      expect(r.status, `${value}: ${r.out}`).toBe(2);
      expect(r.out).toContain('ALERT_DISK_FREE_GB');
      expect(calls(f, 'df')).toEqual([]);
    }
  });
});

describe('the disk: one message when it goes below the floor, one when it recovers', () => {
  it('with room, the first run says nothing', () => {
    const s = stage();
    dutiesPassed(s);
    const r = checks(s);
    expect(r.status, r.out).toBe(0);
    expect(told(s)).toEqual([]);
    // Both filesystems were asked.
    expect(calls(s, 'df').map((l) => l.split(' ').at(-1))).toEqual(['/var/lib/docker', s.persist]);
  });

  it('14 GB free is one message naming the mount point; 14 again is none; 16 is one recovery', () => {
    const s = stage();
    dutiesPassed(s);
    free(s, { docker: 14, persist: 100 });
    const first = checks(s);
    expect(first.status, first.out).toBe(0);
    const low = told(s);
    expect(low.map((m) => m.name)).toEqual(['Disk below the floor']);
    expect(low[0]!.detail).toBe('/var/lib/docker has 14 GB free, under 15');
    expect(low[0]!.body).toContain('ALERT_DISK_FREE_GB');
    expect(low[0]!.body).toContain('docker system df');

    clearTold(s);
    const second = checks(s);
    expect(second.status, second.out).toBe(0);
    expect(told(s), 'the same state twice is said once').toEqual([]);

    free(s, { docker: 16, persist: 100 });
    const third = checks(s);
    expect(third.status, third.out).toBe(0);
    const back = told(s);
    expect(back.map((m) => m.name)).toEqual(['Disk recovered']);
    expect(back[0]!.detail).toBe('/var/lib/docker has 16 GB free, the floor is 15');

    clearTold(s);
    checks(s);
    expect(told(s)).toEqual([]);
  });

  it("the floor is live's ALERT_DISK_FREE_GB", () => {
    const s = stage({ dotEnv: `${LIVE_ENV}ALERT_DISK_FREE_GB=20\n` });
    dutiesPassed(s);
    free(s, { docker: 100, persist: 18 });
    const r = checks(s);
    expect(r.status, r.out).toBe(0);
    expect(told(s).map((m) => `${m.name}: ${m.detail}`)).toEqual(['Disk below the floor: /home has 18 GB free, under 20']);
  });

  it('two paths on one filesystem are one message', () => {
    const s = stage();
    dutiesPassed(s);
    free(s, { docker: 9, persist: 'same' });
    const r = checks(s);
    expect(r.status, r.out).toBe(0);
    expect(told(s).map((m) => m.detail)).toEqual(['/var/lib/docker has 9 GB free, under 15']);
  });

  it('a df that cannot answer is "Disk not read", once, a failed exit every run, and never free space (hard rule 9)', () => {
    const s = stage();
    dutiesPassed(s);
    free(s, { docker: 100, persist: 'fail' });
    const first = checks(s);
    expect(first.status, first.out).toBe(1);
    expect(first.out).toContain('Input/output error');
    expect(told(s).map((m) => m.name)).toEqual(['Disk not read']);
    expect(told(s)[0]!.detail).toBe("live's persisted directory");

    clearTold(s);
    const second = checks(s);
    expect(second.status, second.out).toBe(1);
    expect(told(s)).toEqual([]);

    free(s, { docker: 100, persist: 100 });
    const third = checks(s);
    expect(third.status, third.out).toBe(0);
    expect(told(s).map((m) => `${m.name}: ${m.detail}`)).toEqual(['Disk recovered: /home has 100 GB free, the floor is 15']);
  });

  it("a docker that cannot be asked leaves Docker's filesystem not read, and the persisted directory is still checked", () => {
    const s = stage();
    dutiesPassed(s);
    free(s, { docker: 100, persist: 12 });
    const r = checks(s, [], { STUB_DOCKER_INFO_FAIL: '1' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('Cannot connect to the Docker daemon');
    expect(told(s).map((m) => `${m.name}: ${m.detail}`)).toEqual([
      "Disk not read: Docker's data root",
      'Disk below the floor: /home has 12 GB free, under 15',
    ]);
  });

  it('a message that could not be sent is sent again by the next run, and the run fails', () => {
    const s = stage();
    dutiesPassed(s);
    free(s, { docker: 14, persist: 100 });
    const failed = checks(s, [], { STUB_TELL_FAIL: '1' });
    expect(failed.status, failed.out).toBe(1);
    expect(failed.out).toMatch(/could not be sent/);
    clearTold(s);
    const again = checks(s);
    expect(again.status, again.out).toBe(0);
    expect(told(s).map((m) => m.name)).toEqual(['Disk below the floor']);
  });

  it("what it remembers is this account's alone", () => {
    const s = stage();
    dutiesPassed(s);
    free(s, { docker: 14, persist: 100 });
    checks(s);
    const state = join(s.persist, 'box-checks', 'disk-docker');
    expect(readFileSync(state, 'utf8').trim()).toBe('low');
    expect(statSync(state).mode & 0o077).toBe(0);
  });
});

describe("the duties' last pass: the dead man's switch OnFailure= cannot be", () => {
  it('a pass 27 hours ago is one "Daily duties late"; again is none; a fresh pass arms it again', () => {
    const s = stage();
    dutiesPassed(s, NOW - 27 * HOUR);
    const first = checks(s);
    expect(first.status, first.out).toBe(0);
    const late = told(s);
    expect(late.map((m) => `${m.name}: ${m.detail}`)).toEqual(['Daily duties late: no pass in 27 hours']);
    expect(late[0]!.body).toContain(iso(NOW - 27 * HOUR));
    expect(late[0]!.body).toContain('systemctl --user list-timers ownpace-box-duties.timer');
    expect(late[0]!.body).toContain('ZITADEL_PAT_EXPIRY');
    expect(late[0]!.body).toContain('2026-10-25T13:17:00Z');

    clearTold(s);
    checks(s);
    expect(told(s)).toEqual([]);

    dutiesPassed(s, NOW - HOUR);
    checks(s);
    expect(told(s), 'on time again is said by the next summary, not by a mail of its own').toEqual([]);

    dutiesPassed(s, NOW - 30 * HOUR);
    checks(s);
    expect(told(s).map((m) => m.name)).toEqual(['Daily duties late']);
  });

  it('a pass 25 hours ago is on time', () => {
    const s = stage();
    dutiesPassed(s, NOW - 25 * HOUR);
    checks(s);
    expect(told(s)).toEqual([]);
  });

  it('no pass recorded is quiet for the first 26 hours of watching, then one message', () => {
    const s = stage();
    const first = checks(s);
    expect(first.status, first.out).toBe(0);
    expect(told(s)).toEqual([]);
    expect(readFileSync(join(s.persist, 'box-checks', 'since'), 'utf8').trim()).toBe(String(NOW));

    const later = NOW + 27 * HOUR;
    writeState(s, 'summary', day(later));
    const r = checks(s, [], { STUB_NOW: String(later) });
    expect(r.status, r.out).toBe(0);
    const late = told(s);
    expect(late.map((m) => `${m.name}: ${m.detail}`)).toEqual(['Daily duties late: no pass in 27 hours']);
    expect(late[0]!.body).toContain(`since box-checks.sh started watching, at ${iso(NOW)}`);
  });

  it('a timer that is not active is named in the message', () => {
    const s = stage();
    dutiesPassed(s, NOW - 40 * HOUR);
    checks(s, [], { STUB_TIMER: 'inactive' });
    expect(told(s)[0]!.body).toMatch(/timer[^\n]*: inactive/);
  });
});

describe('one summary a day, numbers only', () => {
  it('--summary sends it now: the disk, the duties, the databases of both stacks, the five largest volumes, live\'s rows and beat', () => {
    const s = stage();
    writeRecord(s, 'last-run', NOW - 2 * HOUR, 'failed', 'copies,strays');
    writeRecord(s, 'last-pass', NOW - 26 * HOUR + 60, 'passed');
    const r = checks(s, ['--summary']);
    expect(r.status, r.out).toBe(0);
    const sent = told(s);
    expect(sent.map((m) => m.name)).toEqual(['Daily summary']);
    const { detail, body } = sent[0]!;
    expect(detail).toBe(day(NOW));

    // Free space.
    expect(body).toContain('/var/lib/docker: 100 GB free');
    expect(body).toContain('/home: 100 GB free');
    expect(body).toMatch(/floor[^\n]*15 GB/);
    // The duties: the last run with what failed, the last pass, the timer, the token's date.
    expect(body).toContain(`Last run: ${iso(NOW - 2 * HOUR)}, failed: copies, strays`);
    expect(body).toContain(`Last pass: ${iso(NOW - 26 * HOUR + 60)}, 25 hours ago`);
    expect(body).toMatch(/timer[^\n]*: active/);
    expect(body).toContain('ZITADEL_PAT_EXPIRY): 2026-10-25T13:17:00Z, 4 days from now');
    // Each stack's databases, in MB, from both containers.
    for (const project of ['ownpace-live', 'ownpace-managed']) {
      const line = body.split('\n').find((l) => l.trim().startsWith(`${project}:`)) ?? '';
      expect(line, `no databases line for ${project}`).toContain('postgres: openmigrate 1229 MB, postgres 7 MB, zitadel 256 MB');
      expect(line).toContain('trigger-db: postgres 7 MB, triggerdb 2150 MB');
    }
    // The five largest volumes of the two stacks, largest first, and nobody else's.
    const volumes = body
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[0] ?? '')
      .filter((name) => /_/.test(name) && !name.includes(':'));
    expect(volumes).toEqual(TOP_FIVE);
    expect(body).not.toContain('not-ours');
    // Live's rows, and the tick's beat.
    expect(body).toContain('run 1234, run_event 567890, item 12345, app_event 678');
    expect(body).toContain("The sync tick's beat: 42 seconds old");
    expect(readFileSync(join(s.persist, 'box-checks', 'summary'), 'utf8').trim()).toBe(day(NOW));
    // It reads; every statement it sent is a SELECT, through each container's own socket.
    const sql = readFileSync(s.sqlLog, 'utf8');
    expect(sql).toMatch(/pg_database_size/);
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
    expect(calls(s, 'docker').filter((l) => l.startsWith('docker exec')).every((l) => l.includes('psql'))).toBe(true);
    expect(calls(s, 'docker').some((l) => /--filter label=com\.docker\.compose\.service=trigger-db/.test(l))).toBe(true);
  });

  it('goes once a day, at the first run from 07:00 UTC', () => {
    const s = stage();
    dutiesPassed(s);
    rmSync(join(s.persist, 'box-checks', 'summary'));
    const at = (h: number, m = 0, d = 0) => Date.UTC(2026, 9, 21 + d, h, m, 0) / 1000;
    const run = (epoch: number) => checks(s, [], { STUB_NOW: String(epoch) });
    dutiesPassed(s, at(6, 50) - HOUR);
    run(at(6, 50));
    expect(told(s), 'not before 07:00 UTC').toEqual([]);
    dutiesPassed(s, at(7, 0) - HOUR);
    run(at(7, 0));
    expect(told(s).map((m) => `${m.name}: ${m.detail}`)).toEqual(['Daily summary: 2026-10-21']);
    clearTold(s);
    run(at(7, 10));
    run(at(23, 50));
    expect(told(s), 'once a day').toEqual([]);
    dutiesPassed(s, at(7, 0, 1) - HOUR);
    run(at(7, 0, 1));
    expect(told(s).map((m) => `${m.name}: ${m.detail}`)).toEqual(['Daily summary: 2026-10-22']);
  });

  it('a summary that could not be sent goes at the next run', () => {
    const s = stage();
    dutiesPassed(s);
    rmSync(join(s.persist, 'box-checks', 'summary'));
    expect(checks(s, [], { STUB_TELL_FAIL: '1' }).status).toBe(1);
    clearTold(s);
    expect(checks(s).status).toBe(0);
    expect(told(s).map((m) => m.name)).toEqual(['Daily summary']);
  });

  it("the OTA stack not running here is said, and is not a failure", () => {
    const s = stage();
    dutiesPassed(s);
    const r = checks(s, ['--summary'], { STUB_RUNNING: 'ownpace-live' });
    expect(r.status, r.out).toBe(0);
    const line = told(s)[0]!.body.split('\n').find((l) => l.trim().startsWith('ownpace-managed:')) ?? '';
    expect(line).toContain('postgres: not running here');
    expect(line).toContain('trigger-db: not running here');
  });

  it('a database that cannot be read says so in the summary, which still goes, and the run fails (hard rule 9)', () => {
    const s = stage();
    dutiesPassed(s);
    const r = checks(s, ['--summary'], { STUB_EXEC_FAIL: 'id-ownpace-live-trigger-db,id-ownpace-live-postgres' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('connection to server on socket failed');
    const body = told(s)[0]!.body;
    expect(body).toContain('trigger-db: not read');
    expect(body).toMatch(/Live's rows: not read/);
    expect(body).toMatch(/What could not be read/);
    expect(body).not.toContain('connection to server on socket failed');
  });

  it('a role that row security binds gives no counts, and says why, rather than counting nobody\'s rows', () => {
    const s = stage();
    dutiesPassed(s);
    checks(s, ['--summary'], { STUB_COUNTS: 'no|0|0|0|0|42' });
    const body = told(s)[0]!.body;
    expect(body).not.toContain('run 0,');
    expect(body).toMatch(/row security/);
  });

  it('volumes that cannot be listed are not read, and the rest still goes', () => {
    const s = stage();
    dutiesPassed(s);
    const r = checks(s, ['--summary'], { STUB_SYSTEM_DF_FAIL: '1' });
    expect(r.status, r.out).toBe(1);
    expect(told(s)[0]!.body).toMatch(/volumes[^\n]*\n\s*not read/i);
  });

  it('sends and prints no address, no UUID and no secret: a sweep over everything', () => {
    const s = stage();
    writeRecord(s, 'last-run', NOW - 2 * HOUR, 'failed', 'token');
    writeRecord(s, 'last-pass', NOW - 30 * HOUR, 'passed');
    free(s, { docker: 3, persist: 'fail' });
    rmSync(join(s.persist, 'box-checks', 'summary'));
    const r = checks(s);
    expect(r.status, r.out).toBe(1);
    expect(told(s).map((m) => m.name)).toEqual([
      'Disk below the floor',
      'Disk not read',
      'Daily duties late',
      'Daily summary',
    ]);
    expectNothingIdentifying(readFileSync(s.told, 'utf8'), 'what it sent');
    expectNothingIdentifying(r.out, 'what it printed');
  });
});

// ===========================================================================
// tell-owner.sh
// ===========================================================================

function tell(s: Stage, args: string[], body = '', extra: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(join(s.compose, 'tell-owner.sh'), args, {
    encoding: 'utf8',
    input: body,
    env: { ...s.env, ...extra },
    cwd: join(s.root, 'ownpace-live'),
    timeout: 30_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Each call's config, as curl read it from fd 3. */
const configs = (s: Stage): string[] =>
  readFileSync(s.curl.config, 'utf8')
    .split(/^=== end\n?/m)
    .filter(Boolean);
const mails = (s: Stage): string[] =>
  readFileSync(s.curl.mail, 'utf8')
    .split(/^=== end\n?/m)
    .filter(Boolean);

/** A config's lines as `key value`, the value unquoted the way curl reads it: quoted with escapes, or one bare word. */
function configLines(cfg: string): string[] {
  return cfg
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const m = /^([a-z-]+)(?:\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s"]+)))?$/.exec(l);
      if (!m) return `UNREADABLE ${l}`;
      if (m[2] !== undefined) return `${m[1]} ${m[2].replace(/\\(.)/g, '$1')}`;
      return m[3] !== undefined ? `${m[1]} ${m[3]}` : m[1]!;
    });
}

describe('tell-owner.sh sends one mail through the alert relay, and puts nothing on a command line', () => {
  it('STARTTLS required on 587, the bare sender, each recipient and the login, all on fd 3', () => {
    const s = stage({ realTell: true });
    const r = tell(s, ['Disk below the floor', '/ has 14 GB free, under 15'], 'Free space on /: 14 GB.\n');
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('sent');
    const cfgs = configs(s);
    expect(cfgs).toHaveLength(1);
    const lines = configLines(cfgs[0]!);
    expect(lines).toContain('url smtp://smtp.example.test:587');
    expect(lines).toContain('ssl-reqd');
    expect(lines).toContain('mail-from alerts@example.test');
    expect(lines.filter((l) => l.startsWith('mail-rcpt '))).toEqual([
      'mail-rcpt owner@example.test',
      'mail-rcpt second@example.test',
    ]);
    expect(lines).toContain(`user relay-login@example.test:${RELAY_PASSWORD}`);
    expect(lines).toContain('upload-file -');
    expect(lines.some((l) => l.startsWith('UNREADABLE'))).toBe(false);
    // Never on its command line, never in its environment, never printed.
    const argv = readFileSync(s.curl.args, 'utf8');
    expect(argv.trim()).toBe('--config /dev/fd/3');
    expect(readFileSync(s.curl.env, 'utf8')).not.toContain(SENTINEL);
    expect(r.out).not.toContain(SENTINEL);
    expect(r.out).not.toMatch(/example\.test/);
  });

  it('the message: From, To, the subject with the stack, the body as given, and the runbook row; no address in the body', () => {
    const s = stage({ realTell: true });
    tell(s, ['Disk below the floor', '/ has 14 GB free, under 15'], 'Free space on /: 14 GB.\nThe floor is 15 GB.\n');
    const mail = mails(s)[0]!;
    const [head = '', ...rest] = mail.split('\n\n');
    const body = rest.join('\n\n');
    expect(head).toContain('From: "Ownpace" <alerts@example.test>');
    expect(head).toContain('To: owner@example.test, second@example.test');
    expect(head).toContain('Subject: [ownpace-live] Disk below the floor: / has 14 GB free, under 15');
    expect(head).toMatch(/^Date: \w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} \+0000$/m);
    expect(head).toContain('Content-Type: text/plain; charset=utf-8');
    expect(head).toContain('Auto-Submitted: auto-generated');
    expect(body).toContain('Free space on /: 14 GB.\nThe floor is 15 GB.');
    expect(body).toContain('docs/incident-runbook.md, the row "Disk below the floor"');
    expectNothingIdentifying(body, 'the body');
  });

  it('implicit TLS on 465, and with SMTP_SECURE=true on SMTP_PORT, as the product mails', () => {
    for (const env of ['SMTP_PORT=465\n', 'SMTP_PORT=2465\nSMTP_SECURE=true\n']) {
      const s = stage({ realTell: true, dotEnv: `${LIVE_ENV}${env}` });
      const r = tell(s, ['Test mail', 'by hand'], 'x\n');
      expect(r.status, r.out).toBe(0);
      const lines = configLines(configs(s)[0]!);
      expect(lines.find((l) => l.startsWith('url '))).toMatch(/^url smtps:\/\/smtp\.example\.test:(465|2465)$/);
      expect(lines).not.toContain('ssl-reqd');
    }
    // SMTP_SECURE is the product's relay's: with a port of the alerts' own it does not apply.
    const s = stage({ realTell: true, dotEnv: `${LIVE_ENV}SMTP_SECURE=true\nALERT_SMTP_PORT=587\n` });
    tell(s, ['Test mail'], 'x\n');
    const lines = configLines(configs(s)[0]!);
    expect(lines).toContain('url smtp://smtp.example.test:587');
    expect(lines).toContain('ssl-reqd');
  });

  it("ALERT_* before SMTP_* and NOTIFY_*, as managed.yml hands them to the status page", () => {
    const own = [
      'ALERT_SMTP_HOST=alerts-relay.example.test',
      'ALERT_SMTP_PORT=2587',
      'ALERT_SMTP_USER=alerts-login',
      'ALERT_SMTP_PASSWORD=alerts-secret',
      'ALERT_FROM=status@example.test',
      'ALERT_TO=pager@example.test',
      '',
    ].join('\n');
    const s = stage({ realTell: true, dotEnv: `${LIVE_ENV}${own}` });
    const r = tell(s, ['Test mail'], 'x\n');
    expect(r.status, r.out).toBe(0);
    const lines = configLines(configs(s)[0]!);
    expect(lines).toContain('url smtp://alerts-relay.example.test:2587');
    expect(lines).toContain('mail-from status@example.test');
    expect(lines.filter((l) => l.startsWith('mail-rcpt '))).toEqual(['mail-rcpt pager@example.test']);
    expect(lines).toContain('user alerts-login:alerts-secret');
    expect(readFileSync(s.curl.config, 'utf8')).not.toContain(SENTINEL);
  });

  it('no login is no user line', () => {
    const s = stage({ realTell: true, dotEnv: `${LIVE_ENV}SMTP_USER=\nSMTP_PASSWORD=\n` });
    expect(tell(s, ['Test mail'], 'x\n').status).toBe(0);
    expect(configLines(configs(s)[0]!).some((l) => l.startsWith('user '))).toBe(false);
  });

  it('a curl that fails is a failed exit, with what curl said', () => {
    const s = stage({ realTell: true });
    const r = tell(s, ['Test mail'], 'x\n', { STUB_CURL_FAIL: '1' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/NOT SENT/);
    expect(r.out).toContain('Login denied');
    expect(r.out).toContain('67');
  });

  it("refuses, sending nothing: the OTA stack's .env, a relay that is a placeholder, a traced shell, a name of two lines", () => {
    const cases: Array<[string, StageOptions, string[], NodeJS.ProcessEnv, RegExp]> = [
      ['the OTA .env', { realTell: true, dotEnv: OTA_ENV }, ['Test mail'], {}, /STACK_KIND/],
      [
        'no relay',
        { realTell: true, dotEnv: `${LIVE_ENV}SMTP_HOST=\n` },
        ['Test mail'],
        {},
        /ALERT_SMTP_HOST/,
      ],
      [
        "managed.yml's placeholder",
        { realTell: true, dotEnv: `${LIVE_ENV}ALERT_TO=owner@alert-to-is-not-set.invalid\n` },
        ['Test mail'],
        {},
        /ALERT_TO/,
      ],
      ['xtrace', { realTell: true }, ['Test mail'], { SHELLOPTS: 'xtrace' }, /xtrace/],
      ['two lines', { realTell: true }, ['Test mail\nBcc: x'], {}, /one line/],
      ['no name', { realTell: true }, [], {}, /Usage/],
    ];
    for (const [what, opts, args, extra, says] of cases) {
      const s = stage(opts);
      const r = tell(s, args, 'x\n', extra);
      expect(r.status, `${what}: ${r.out}`).toBe(2);
      expect(r.out, what).toMatch(says);
      expect(readFileSync(s.curl.args, 'utf8'), `${what}: curl was called`).toBe('');
      expect(r.out, what).not.toContain(SENTINEL);
    }
  });
});

describe('tell-owner.sh --unit: what systemd sends when a unit fails', () => {
  it("live's duties failed: their names from the record, the unit's result and the token's date", () => {
    const s = stage({ realTell: true });
    writeRecord(s, 'last-run', NOW - 60, 'failed', 'token,strays');
    const r = tell(s, ['--unit', 'ownpace-box-duties.service'], '', { STUB_RESULT: 'exit-code' });
    expect(r.status, r.out).toBe(0);
    const mail = mails(s)[0]!;
    expect(mail).toContain('Subject: [ownpace-live] Daily duties failed: token, strays');
    expect(mail).toContain(`Failed: token, strays, at ${iso(NOW - 60)}.`);
    expect(mail).toContain('result: exit-code');
    expect(mail).toContain('2026-10-25T13:17:00Z');
    expect(mail).toContain('journalctl --user -u ownpace-box-duties -n 200 --no-pager');
    expectNothingIdentifying(mail.split('\n\n').slice(1).join('\n\n'), 'the body');
  });

  it('a run that left no record of its own (refused, stopped, timed out) is said so, never yesterday\'s record', () => {
    const s = stage({ realTell: true });
    writeRecord(s, 'last-run', NOW - 26 * HOUR, 'passed');
    const r = tell(s, ['--unit', 'ownpace-box-duties.service'], '', { STUB_RESULT: 'timeout' });
    expect(r.status, r.out).toBe(0);
    const mail = mails(s)[0]!;
    expect(mail).toContain('Subject: [ownpace-live] Daily duties failed: result timeout');
    expect(mail).toMatch(/left no record of its own/);
    expect(mail).not.toContain(iso(NOW - 26 * HOUR));
  });

  it('test is the test mail, and another unit is "A unit failed"', () => {
    const s = stage({ realTell: true });
    expect(tell(s, ['--unit', 'test']).status).toBe(0);
    expect(tell(s, ['--unit', 'something-else.service']).status).toBe(0);
    const [test = '', other = ''] = mails(s);
    expect(test).toContain('Subject: [ownpace-live] Test mail: sent by hand');
    expect(other).toContain('Subject: [ownpace-live] A unit failed: something-else.service');
  });

  it('refuses a unit name that is not one', () => {
    const s = stage({ realTell: true });
    const r = tell(s, ['--unit', 'a b; rm -rf ~']);
    expect(r.status, r.out).toBe(2);
    expect(readFileSync(s.curl.args, 'utf8')).toBe('');
  });
});

// ===========================================================================
// End to end
// ===========================================================================

describe('end to end: box-checks.sh with the real tell-owner.sh', () => {
  it('a low disk and a summary reach curl, and their bodies hold no address and no secret', () => {
    const s = stage({ realTell: true });
    dutiesPassed(s);
    free(s, { docker: 14, persist: 100 });
    rmSync(join(s.persist, 'box-checks', 'summary'));
    const r = checks(s);
    expect(r.status, r.out).toBe(0);
    const sent = mails(s);
    expect(sent.map((m) => /^Subject: (.*)$/m.exec(m)?.[1])).toEqual([
      '[ownpace-live] Disk below the floor: /var/lib/docker has 14 GB free, under 15',
      `[ownpace-live] Daily summary: ${day(NOW)}`,
    ]);
    for (const m of sent) expectNothingIdentifying(m.split('\n\n').slice(1).join('\n\n'), 'a body');
    expect(readFileSync(s.curl.args, 'utf8').trim().split('\n')).toEqual(['--config /dev/fd/3', '--config /dev/fd/3']);
    expectNothingIdentifying(r.out, 'what it printed');
  });
});
