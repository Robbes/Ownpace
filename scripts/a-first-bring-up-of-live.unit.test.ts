// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FIRST BRING-UP OF LIVE (workplan 0132 T1b to T1e, with T2's check and T5).
 *
 * `ownpace-live`, the stack testers use, is stood up once and deployed ever
 * after. `deploy-live.sh` does every deploy after the first and cannot do the
 * first: it reads the hold from live's own database, which does not exist
 * yet, and it treats the bring-up's "your turn" stops as a deploy that did
 * not take. Until `deploy/compose/stand-up-live.sh` the first bring-up was
 * eighteen steps in a research note and in 0132's task rows, several of them
 * easy to get wrong in a way nothing would report: a port the OTA stack
 * already uses, the Trigger.dev CLI profile both stacks would share, a
 * database password left at the value this repository publishes (the
 * migration creates `app_user` with `app_password` unless the role exists
 * first), the demo seeded onto live, production names routed after the
 * bring-up that needs them, a secret typed into a shell's history.
 *
 * WHAT IS ASSERTED, against the real script in a checkout of its own.
 *
 *   Every refusal fires before anything changes: `--with-demo`; a shell
 *   under tracing, or with COMPOSE_FILE, COMPOSE_ENV_FILES,
 *   MANAGED_ENV_PERSIST_DIR or another project's name; a checkout that is not
 *   `~/ownpace-live`; a `.env` that is not a link to live's persisted file,
 *   or without live's marker and project name; a HEAD on a branch, at no
 *   tag, or at a tag that is not a release (release-tag.sh's rule, the one
 *   deploy-live.sh applies); a tag without the four scripts live needs; a
 *   tree that is not clean; a deploy log that already has a line; live's
 *   database volume already there without `--resume`; and each setting of
 *   live's `.env` that is wrong for live, named by its key and never by its
 *   value. None of them reaches the bring-up, generates a password or
 *   writes to the `.env`.
 *
 *   The passwords it generates never appear on any command line or in
 *   anything it prints: `openssl`'s output goes to `env-upsert.sh --stdin`,
 *   `app_user`'s to psql's stdin, the controls' to `docker run` through
 *   `PGPASSWORD` by name. Every stub logs its argv, and `env-upsert.sh` is
 *   wrapped so its argv is logged too. Nor does any bind address or port.
 *
 *   The order is the plan's: the passwords, then preflight, env and data,
 *   the rendered DOCKER_RUNNER_NETWORKS, `app_user` created from
 *   APP_DB_PASSWORD before anything migrates, the password check on live's
 *   own network (the controls open, the three published values do not),
 *   and only then `--from trigger`.
 *
 *   The two stops exit 2 and say what to do and to run it again with
 *   `--resume`, which asks each step whether it is done (no state file):
 *   no password is generated twice and `app_user` is not created twice.
 *
 *   After the app and the tasks it runs the checks (`/api/version` names the
 *   tag's commit and version, `/api/ready`, `/api/auth/mode`, NODE_ENV, the
 *   issuer at id.ownpace.eu, live's networks, `exposure-check.sh`), and any
 *   failure exits 3 without logging. It puts back `apps/worker/package.json`
 *   when only its last newline changed, appends the first `deploys.log` line
 *   (took, one-way), copies the timer's units, and prints what is left to the
 *   owner.
 *
 * HOW IT RUNS. Each case builds `~/ownpace-live` under a HOME of its own: a
 * real git repository with a bare origin, whose release tag carries the
 * script, what it sources, the real `managed.yml`, and stand-ins for
 * `bootstrap-managed.sh` (records its arguments; creates the volumes a phase
 * would; stops where it is told to) and `exposure-check.sh`. `docker`,
 * `psql`, `curl`, `openssl`, `getent`, `ss`, `systemctl`, `pnpm` and `npx`
 * are stubs on the PATH. The `docker` stub runs `compose exec postgres sh -c`
 * here, so the script's own psql line runs against the `psql` stub, which
 * remembers the password `CREATE ROLE` gave `app_user`; its `run` answers the
 * password checks from that and from the `.env`, as a database would.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const SCRIPT = 'stand-up-live.sh';
const RELEASE_SENTENCE = 'live runs releases: name a release tag';
const TAG = 'v0.2.0-alpha.1';
const VERSION = '0.2.0-alpha.1';
const CASE_MS = 90_000;

/** The front's address and the OTA stack's, documentation addresses (RFC 5737). */
const FRONT = '192.0.2.10';
const OTA_FRONT = '192.0.2.20';
/** Live's ports: none is the OTA stack's, and none can turn up by chance in what it prints. */
const PORTS: Record<string, string> = {
  POSTGRES_PORT: '45432',
  TRIGGER_PORT: '43090',
  TRIGGER_TLS_PORT: '43443',
  ZITADEL_PORT: '43126',
  API_PORT: '43001',
  WEB_PORT: '43123',
  STATUS_PORT: '43124',
  REGISTRY_PORT: '45000',
  MAILPIT_PORT: '43127',
};
const PASSWORD_KEYS = ['POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'CLICKHOUSE_PASSWORD', 'MINIO_ROOT_PASSWORD', 'TRIGGER_DB_PASSWORD'];

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// live's .env and the OTA stack's
// ---------------------------------------------------------------------------

const LIVE_ENV: Record<string, string> = {
  COMPOSE_PROJECT_NAME: 'ownpace-live',
  STACK_KIND: 'production',
  POSTGRES_USER: 'openmigrate',
  POSTGRES_PASSWORD: 'change-me-openmigrate',
  POSTGRES_DB: 'openmigrate',
  APP_DB_USER: 'app_user',
  APP_DB_PASSWORD: 'app_password',
  // A real relay from the first day, no catcher (0133, 2026-09-28).
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  NOTIFY_FROM: 'sender-q6@example.test',
  NOTIFY_TO: 'operator-q6@example.test',
  MAILPIT_BIND: '',
  TRIGGER_APP_ORIGIN: `https://localhost:${PORTS.TRIGGER_TLS_PORT}`,
  TRIGGER_LOGIN_ORIGIN: `https://localhost:${PORTS.TRIGGER_TLS_PORT}`,
  TRIGGER_API_ORIGIN: `http://127.0.0.1:${PORTS.TRIGGER_PORT}`,
  TRIGGER_CLI_PROFILE: 'live-plane-q9',
  CLICKHOUSE_USER: 'default',
  CLICKHOUSE_PASSWORD: 'change-me-clickhouse',
  MINIO_ROOT_USER: 'admin',
  MINIO_ROOT_PASSWORD: 'change-me-minio',
  TRIGGER_DB_PASSWORD: '',
  OWNPACE_REACHABLE_HOSTS: '',
  // The most days a dump taken before a deploy is kept (0134, 2026-09-28).
  BACKUP_RETENTION_DAYS: '7',
  POSTGRES_BIND: '',
  API_BIND: '',
  TRIGGER_BIND: '',
  TRIGGER_TLS_BIND: '',
  ZITADEL_BIND: FRONT,
  WEB_BIND: FRONT,
  STATUS_BIND: FRONT,
  EXPOSURE_ALLOW: `${FRONT},${OTA_FRONT}`,
  CORS_ORIGIN: 'https://app.ownpace.eu',
  WEB_URL: 'https://app.ownpace.eu',
  NODE_ENV: 'production',
  ZITADEL_EXTERNALDOMAIN: 'id.ownpace.eu',
  ZITADEL_EXTERNALPORT: '443',
  ZITADEL_EXTERNALSECURE: 'true',
  ZITADEL_TLS_MODE: 'external',
  GOOGLE_OAUTH_CLIENT_ID: '',
  DROPBOX_OAUTH_CLIENT_ID: '',
  OWNPACE_STAGE: 'alpha',
  VITE_SUPPORT_EMAIL: 'owner-q7@example.test',
  ...PORTS,
};

/** The OTA stack's: its ports are the defaults, its binds its own. */
const OTA_ENV: Record<string, string> = {
  WEB_URL: 'https://app.ota.example.test',
  WEB_BIND: OTA_FRONT,
  ZITADEL_BIND: OTA_FRONT,
  TRIGGER_CLI_PROFILE: 'openmig',
};

const envText = (vars: Record<string, string | undefined>): string =>
  `${Object.entries(vars)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')}\n`;

/** Every value in live's .env that is not the script's own constant: none may be printed. */
const PRIVATE_VALUES = [
  FRONT,
  OTA_FRONT,
  ...Object.values(PORTS),
  'live-plane-q9',
  'owner-q7@example.test',
  'smtp.example.test',
  'sender-q6@example.test',
  'operator-q6@example.test',
];

/**
 * The kernel's ephemeral range as Linux ships it, and live's nine ports
 * reserved in it: some one by one, some as a range (the fixture's
 * /proc/sys/net/ipv4, STAND_UP_LIVE_PROC_NET_DIR).
 */
const EPHEMERAL_RANGE = '32768\t60999\n';
const RESERVED = '43001,43090,43123-43127,43443,45000,45432';
/** The same, and the 41xxx ports the cases on the OTA stack's ports use, which are about those alone. */
const OTA_CASES_RESERVED = `${RESERVED},41000-41999\n`;

// ---------------------------------------------------------------------------
// The stubs
// ---------------------------------------------------------------------------

const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >>"$STUB_LOG"
[ -z "\${STUB_DOCKER_DOWN:-}" ] || { echo 'Cannot connect to the Docker daemon' >&2; exit 1; }
env_file="$STUB_ENV_FILE"
value() { sed -n "s/^$1=//p" "$env_file" | tail -n 1; }
case "$1" in
  volume)
    [ "$2" = ls ] || exit 95
    cat "$STUB_STATE/volumes"
    exit 0
    ;;
  network)
    case "$2" in
      ls)
        echo "ownpace-live_ownpace-network"
        [ -n "\${STUB_NO_STATUS_NET:-}" ] || echo "ownpace-live_status-probe"
        exit 0
        ;;
      inspect)
        case "$3" in
          ownpace-managed_ownpace-network)
            printf 'ownpace-managed-db ownpace-managed-api %s\\n' "\${STUB_ON_OTA_NET:-}"; exit 0 ;;
          ownpace-live_ownpace-network)
            printf 'ownpace-live-db ownpace-live-api \\n'; exit 0 ;;
        esac
        exit 1
        ;;
    esac
    exit 94
    ;;
  run)
    # docker run --rm -e PGPASSWORD --network <net> <image> psql -h postgres -U <user> -d <db> -tAc 'SELECT 1'
    shift
    net='' user=''
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --network) net="$2"; shift 2 ;;
        -U) user="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    printf 'dbcheck %s %s\\n' "$net" "$user" >>"$STUB_LOG"
    [ -z "\${STUB_DB_DOWN:-}" ] || exit 2
    pw="\${PGPASSWORD:-}"
    owner="$(value POSTGRES_USER)"; owner="\${owner:-openmigrate}"
    if [ "$user" = "$owner" ] && [ "$pw" = "$(value POSTGRES_PASSWORD)" ]; then exit 0; fi
    if [ "$user" = app_user ] && [ -f "$STUB_STATE/app_user_password" ] && [ "$pw" = "$(cat "$STUB_STATE/app_user_password")" ]; then exit 0; fi
    for pair in \${STUB_DB_ALSO:-}; do [ "$pair" = "$user:$pw" ] && exit 0; done
    exit 2
    ;;
  compose)
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -f | --env-file) shift 2 ;;
        *) break ;;
      esac
    done
    project="$(value COMPOSE_PROJECT_NAME)"
    case "$1" in
      config)
        printf 'name: %s\\nservices:\\n  postgres:\\n    environment:\\n      POSTGRES_PASSWORD: %s\\n  trigger-supervisor:\\n    environment:\\n      DOCKER_RUNNER_NETWORKS: %s\\n' \\
          "$project" "$(value POSTGRES_PASSWORD)" "\${STUB_RUNNER_NETWORK:-\${project}_ownpace-network}"
        exit 0
        ;;
      exec)
        shift
        [ "$1" = -T ] && shift
        svc="$1"; shift
        case "$svc" in
          postgres)
            [ "$1" = sh ] && [ "$2" = -c ] || exit 93
            export POSTGRES_USER=openmigrate POSTGRES_DB=openmigrate
            exec sh -c "$3"
            ;;
          api)
            [ "$*" = "printenv NODE_ENV" ] || exit 92
            echo "\${STUB_NODE_ENV:-production}"
            exit 0
            ;;
        esac
        exit 91
        ;;
    esac
    exit 96
    ;;
esac
exit 97
`;

const PSQL_STUB = `#!/usr/bin/env bash
printf 'psql %s\\n' "$*" >>"$STUB_LOG"
sql="$(cat)"
printf '%s\\n-- (end of one psql call)\\n' "$sql" >>"$STUB_SQL_LOG"
[ -z "\${STUB_PSQL_FAIL:-}" ] || { echo 'psql: error: connection to server on socket failed' >&2; exit 2; }
case "$sql" in
  *"CREATE ROLE app_user"*)
    [ ! -f "$STUB_STATE/app_user_password" ] || { echo 'ERROR:  role "app_user" already exists' >&2; exit 3; }
    sed -n "s/^CREATE ROLE app_user LOGIN PASSWORD '\\(.*\\)';$/\\1/p" <<<"$sql" | tr -d '\\n' >"$STUB_STATE/app_user_password"
    ;;
  *pg_roles*)
    [ ! -f "$STUB_STATE/app_user_password" ] || echo 1
    ;;
esac
exit 0
`;

/** curl: answers from STUB_HTTP/<host and path, / as _>.code and .body; no file, no connection. */
const CURL_STUB = `#!/usr/bin/env bash
out='' fmt='' url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) fmt="$2"; shift 2 ;;
    --max-time | -m | --connect-timeout) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf 'curl %s\\n' "$url" >>"$STUB_LOG"
name="\${url#*://}"
name="\${name//\\//_}"
[ -f "$STUB_HTTP/$name.code" ] || exit 7
if [ -n "$out" ]; then cp "$STUB_HTTP/$name.body" "$out"; else cat "$STUB_HTTP/$name.body"; fi
[ -n "$fmt" ] && cat "$STUB_HTTP/$name.code"
exit 0
`;

/** openssl rand -hex N: a value nobody could mistake for another, different every call. */
const OPENSSL_STUB = `#!/usr/bin/env bash
printf 'openssl %s\\n' "$*" >>"$STUB_LOG"
[ "$1 $2" = "rand -hex" ] || exit 90
n="$(cat "$STUB_STATE/openssl" 2>/dev/null || echo 0)"; n=$((n + 1)); echo "$n" >"$STUB_STATE/openssl"
v="5ec2e7$(printf '%04d' "$n")"
while [ "\${#v}" -lt $(( $3 * 2 )) ]; do v="\${v}d"; done
printf '%s\\n' "$v"
`;

const GETENT_STUB = `#!/usr/bin/env bash
printf 'getent %s\\n' "$*" >>"$STUB_LOG"
[ "$1" = hosts ] || exit 1
case ",\${STUB_UNRESOLVED:-}," in *",$2,"*) exit 2 ;; esac
printf '%s %s\\n' '${FRONT}' "$2"
`;

const SS_STUB = `#!/usr/bin/env bash
printf 'ss %s\\n' "$*" >>"$STUB_LOG"
echo 'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*'
for p in \${STUB_LISTENING//,/ }; do echo "LISTEN 0 4096 127.0.0.1:$p 0.0.0.0:*"; done
`;

const LOGGING_STUB = (name: string, exitVar = '') => `#!/usr/bin/env bash
printf '${name} %s\\n' "$*" >>"$STUB_LOG"
exit ${exitVar ? `"\${${exitVar}:-0}"` : '0'}
`;

/**
 * The bring-up, as a stand-in committed in the tag: it records its arguments,
 * makes the volumes a phase would, and stops where STUB_TRIGGER_STOP says.
 */
const BOOTSTRAP_STUB = `#!/usr/bin/env bash
printf 'bootstrap %s\\n' "$*" >>"$STUB_LOG"
here="$(cd "$(dirname "$0")" && pwd)"
env_file="$here/.env"
project="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$env_file" | tail -n 1)"
volume() { grep -qx "\${project}_$1" "$STUB_STATE/volumes" || echo "\${project}_$1" >>"$STUB_STATE/volumes"; }
case "$*" in
  "--only preflight" | "--only env") exit "\${STUB_BOOTSTRAP_ONLY_EXIT:-0}" ;;
  "--only data")
    volume postgres_data
    exit "\${STUB_BOOTSTRAP_ONLY_EXIT:-0}"
    ;;
  "--from trigger")
    volume trigger_db_data; volume clickhouse_data_v2; volume minio_data
    if [ "\${STUB_TRIGGER_STOP:-}" = account ]; then
      echo '--- Your turn. When you have done the above, carry on with:'
      echo '      ./deploy/compose/bootstrap-managed.sh --from account'
      exit 2
    fi
    grep -q '^TRIGGER_PROJECT_REF=.' "$env_file" || printf 'TRIGGER_PROJECT_REF=proj_live\\nTRIGGER_SECRET_KEY=tr_prod_live\\n' >>"$env_file"
    if [ "\${STUB_TRIGGER_STOP:-}" = login ]; then
      echo '--- Your turn. When you have done the above, carry on with:'
      echo '      ./deploy/compose/bootstrap-managed.sh --from login'
      exit 2
    fi
    worker="$here/../../apps/worker/package.json"
    case "\${STUB_WORKER:-}" in
      newline) printf '%s' "$(cat "$worker")" >"$worker" ;;
      content) printf '{ "changed": true }\\n' >"$worker" ;;
    esac
    exit "\${STUB_BOOTSTRAP_EXIT:-0}"
    ;;
esac
exit 99
`;

/**
 * exposure-check.sh as the tag carries it here: its argv logged; asked about
 * recorded lines (--from), the real one answers, which is how the script
 * reads EXPOSURE_ALLOW before anything changes; asked of the machine at the
 * end (step 7), STUB_EXPOSURE_EXIT.
 */
const EXPOSURE_WRAPPER = `#!/usr/bin/env bash
printf 'exposure-check %s\\n' "$*" >>"$STUB_LOG"
for a in "$@"; do
  [ "$a" = --from ] && exec "$(dirname "$0")/exposure-check.real.sh" "$@"
done
exit "\${STUB_EXPOSURE_EXIT:-0}"
`;

/** env-upsert.sh as the tag carries it here: its argv logged, then the real one. */
const UPSERT_WRAPPER = `#!/usr/bin/env bash
printf 'env-upsert %s\\n' "$*" >>"$STUB_LOG"
exec "$(dirname "$0")/env-upsert.real.sh" "$@"
`;

// ---------------------------------------------------------------------------
// ~/ownpace-live, of its own
// ---------------------------------------------------------------------------

interface StageOptions {
  /** live's .env, as key/value; undefined leaves a key out. */
  env?: Record<string, string | undefined>;
  /** Raw text before and after those lines, for lines the key/value form cannot make. */
  envPrefix?: string;
  envSuffix?: string;
  /** The OTA stack's .env (null: none on this machine). */
  otaEnv?: Record<string, string> | null;
  /** How deploy/compose/.env is made. */
  link?: 'link' | 'file' | 'elsewhere' | 'dangling';
  /** Leave these out of the tag's deploy/compose/. */
  omit?: string[];
  /** The tag: lightweight, not pushed, another package.json version. */
  tag?: { lightweight?: boolean; push?: boolean; version?: string; name?: string };
  /** Where HEAD is: the tag (default), the branch, or a commit after the tag. */
  head?: 'tag' | 'branch' | 'untagged';
  /** Volumes that exist before the run. */
  volumes?: string[];
  /** The fixture's ip_local_port_range and ip_local_reserved_ports; null leaves the file out. */
  proc?: { range?: string | null; reserved?: string | null };
  /** An edit to the tag's managed.yml. */
  managedYml?: (text: string) => string;
}

interface Stage {
  root: string;
  work: string;
  compose: string;
  envFile: string;
  log: string;
  sqlLog: string;
  http: string;
  state: string;
  deployLog: string;
  env: NodeJS.ProcessEnv;
  commit: string;
}

const gitEnv = (home: string): NodeJS.ProcessEnv => ({
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
  LANG: 'C',
});

function git(root: string, cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(root) });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function writeExec(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

const WORKER_PACKAGE = `${JSON.stringify({ name: '@openmig/worker', dependencies: { '@trigger.dev/sdk': '4.5.16' } }, null, 2)}\n`;

function stage(opts: StageOptions = {}): Stage {
  const root = mkdtempSync(join(tmpdir(), 'stand-up-live-'));
  tempDirs.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'ownpace-live');
  const compose = join(work, 'deploy', 'compose');
  git(root, root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, root, 'init', '-q', '-b', 'main', work);
  git(root, work, 'remote', 'add', 'origin', origin);

  const tagName = opts.tag?.name ?? TAG;
  writeFileSync(join(work, '.gitignore'), '.env\n');
  writeFileSync(join(work, 'package.json'), `${JSON.stringify({ name: 'ownpace', version: opts.tag?.version ?? VERSION, private: true }, null, 2)}\n`);
  mkdirSync(join(work, 'apps', 'worker'), { recursive: true });
  writeFileSync(join(work, 'apps', 'worker', 'package.json'), WORKER_PACKAGE);
  mkdirSync(join(compose, 'systemd'), { recursive: true });
  for (const f of [SCRIPT, 'release-tag.sh', 'env-read.sh', 'stack-kind.sh', 'trigger-cli-lib.sh', 'deploy-live.sh', 'box-duties.sh']) {
    if (opts.omit?.includes(f)) continue;
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    chmodSync(join(compose, f), 0o755);
  }
  copyFileSync(join(COMPOSE_DIR, 'env-upsert.sh'), join(compose, 'env-upsert.real.sh'));
  chmodSync(join(compose, 'env-upsert.real.sh'), 0o755);
  writeExec(join(compose, 'env-upsert.sh'), UPSERT_WRAPPER);
  const managed = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
  writeFileSync(join(compose, 'managed.yml'), opts.managedYml ? opts.managedYml(managed) : managed);
  copyFileSync(join(COMPOSE_DIR, 'www.yml'), join(compose, 'www.yml'));
  for (const unit of ['ownpace-box-duties.service', 'ownpace-box-duties.timer']) {
    copyFileSync(join(COMPOSE_DIR, 'systemd', unit), join(compose, 'systemd', unit));
  }
  writeExec(join(compose, 'bootstrap-managed.sh'), BOOTSTRAP_STUB);
  if (!opts.omit?.includes('exposure-check.sh')) {
    writeExec(join(compose, 'exposure-check.sh'), EXPOSURE_WRAPPER);
    copyFileSync(join(COMPOSE_DIR, 'exposure-check.sh'), join(compose, 'exposure-check.real.sh'));
    chmodSync(join(compose, 'exposure-check.real.sh'), 0o755);
  }
  git(root, work, 'add', '-A');
  git(root, work, 'commit', '-q', '-m', 'the release');
  if (opts.tag?.lightweight) git(root, work, 'tag', tagName);
  else git(root, work, 'tag', '-a', tagName, '-m', `Ownpace ${tagName}`);
  const commit = git(root, work, 'rev-parse', 'HEAD');
  git(root, work, 'push', '-q', 'origin', 'main');
  if (opts.tag?.push !== false) git(root, work, 'push', '-q', 'origin', `refs/tags/${tagName}`);
  if (opts.head === 'untagged') {
    writeFileSync(join(work, 'AFTER'), 'a commit after the tag\n');
    git(root, work, 'add', '-A');
    git(root, work, 'commit', '-q', '-m', 'after the release');
    git(root, work, 'checkout', '-q', '--detach', 'HEAD');
  } else if (opts.head !== 'branch') {
    git(root, work, 'checkout', '-q', '--detach', `refs/tags/${tagName}`);
  }

  // Live's .env, persisted, and the checkout's link to it (T1b step 2).
  const persist = join(root, '.persistent', 'ownpace-live');
  mkdirSync(persist, { recursive: true });
  const envFile = join(persist, '.env');
  writeFileSync(envFile, `${opts.envPrefix ?? ''}${envText({ ...LIVE_ENV, ...(opts.env ?? {}) })}${opts.envSuffix ?? ''}`);
  const link = join(compose, '.env');
  switch (opts.link ?? 'link') {
    case 'link':
      symlinkSync(envFile, link);
      break;
    case 'file':
      copyFileSync(envFile, link);
      break;
    case 'elsewhere': {
      const other = join(root, 'elsewhere');
      mkdirSync(other);
      copyFileSync(envFile, join(other, '.env'));
      symlinkSync(join(other, '.env'), link);
      break;
    }
    case 'dangling':
      rmSync(envFile);
      symlinkSync(envFile, link);
      break;
  }
  if (opts.otaEnv !== null) {
    const ota = join(root, '.persistent', 'ownpace-managed');
    mkdirSync(ota, { recursive: true });
    writeFileSync(join(ota, '.env'), envText(opts.otaEnv ?? OTA_ENV));
  }

  const bin = join(root, 'bin');
  writeExec(join(bin, 'docker'), DOCKER_STUB);
  writeExec(join(bin, 'psql'), PSQL_STUB);
  writeExec(join(bin, 'curl'), CURL_STUB);
  writeExec(join(bin, 'openssl'), OPENSSL_STUB);
  writeExec(join(bin, 'getent'), GETENT_STUB);
  writeExec(join(bin, 'ss'), SS_STUB);
  writeExec(join(bin, 'systemctl'), LOGGING_STUB('systemctl', 'STUB_SYSTEMCTL_EXIT'));
  writeExec(join(bin, 'pnpm'), LOGGING_STUB('pnpm'));
  writeExec(join(bin, 'npx'), LOGGING_STUB('npx'));

  const log = join(root, 'calls.log');
  const sqlLog = join(root, 'sql.log');
  const state = join(root, 'state');
  const http = join(root, 'http');
  const proc = join(root, 'proc-sys-net-ipv4');
  mkdirSync(state);
  mkdirSync(http);
  mkdirSync(proc);
  const range = opts.proc?.range === undefined ? EPHEMERAL_RANGE : opts.proc.range;
  const reserved = opts.proc?.reserved === undefined ? `${RESERVED}\n` : opts.proc.reserved;
  if (range !== null) writeFileSync(join(proc, 'ip_local_port_range'), range);
  if (reserved !== null) writeFileSync(join(proc, 'ip_local_reserved_ports'), reserved);
  writeFileSync(log, '');
  writeFileSync(sqlLog, '');
  writeFileSync(join(state, 'volumes'), (opts.volumes ?? []).map((v) => `${v}\n`).join(''));

  const env: NodeJS.ProcessEnv = {
    ...gitEnv(root),
    PATH: `${bin}:${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    STUB_LOG: log,
    STUB_SQL_LOG: sqlLog,
    STUB_STATE: state,
    STUB_HTTP: http,
    STUB_ENV_FILE: envFile,
    STAND_UP_LIVE_CHECK_TRIES: '1',
    STAND_UP_LIVE_CHECK_INTERVAL: '0',
    STAND_UP_LIVE_PROC_NET_DIR: proc,
  };
  const s: Stage = { root, work, compose, envFile, log, sqlLog, http, state, deployLog: join(persist, 'deploys.log'), env, commit };
  answer(s, 'app.ownpace.eu/api/version', 200, { version: VERSION, commit });
  answer(s, 'app.ownpace.eu/api/ready', 200, { status: 'ok' });
  answer(s, 'app.ownpace.eu/api/auth/mode', 200, { mode: 'managed', acceptsSeedToken: false });
  answer(s, 'id.ownpace.eu/.well-known/openid-configuration', 200, { issuer: 'https://id.ownpace.eu' });
  return s;
}

function answer(s: Stage, hostPath: string, code: number, body: unknown): void {
  const name = hostPath.replace(/\//g, '_');
  writeFileSync(join(s.http, `${name}.code`), String(code));
  writeFileSync(join(s.http, `${name}.body`), typeof body === 'string' ? body : JSON.stringify(body));
}

function run(s: Stage, args: string[] = [], extra: NodeJS.ProcessEnv = {}, via?: string[]) {
  const [cmd, ...pre] = via ?? [join(s.compose, SCRIPT)];
  const r = spawnSync(cmd!, via ? [...pre, join(s.compose, SCRIPT), ...args] : args, {
    encoding: 'utf8',
    env: { ...s.env, ...extra },
    cwd: s.work,
    timeout: 120_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const calls = (s: Stage): string[] => readFileSync(s.log, 'utf8').split('\n').filter(Boolean);
const called = (s: Stage, what: string): string[] => calls(s).filter((l) => l.startsWith(`${what} `));
const envNow = (s: Stage): string => readFileSync(s.envFile, 'utf8');
const valueOf = (s: Stage, key: string): string =>
  envNow(s)
    .split('\n')
    .filter((l) => l.startsWith(`${key}=`))
    .map((l) => l.slice(key.length + 1))
    .at(-1) ?? '';
const deployLines = (s: Stage): string[] =>
  existsSync(s.deployLog) ? readFileSync(s.deployLog, 'utf8').split('\n').filter(Boolean) : [];

/** Nothing changed: no bring-up, no password, no write, no line. */
function expectNothingChanged(s: Stage, before: string, out: string, docker: 'none' | 'reads' = 'none'): void {
  expect(called(s, 'bootstrap'), `the bring-up ran:\n${out}`).toEqual([]);
  expect(called(s, 'openssl'), 'a password was generated').toEqual([]);
  expect(called(s, 'env-upsert'), '.env was written').toEqual([]);
  expect(called(s, 'psql'), 'the database was asked').toEqual([]);
  expect(called(s, 'curl'), 'the app was asked').toEqual([]);
  expect(called(s, 'systemctl'), 'systemd was touched').toEqual([]);
  expect(deployLines(s)).toEqual([]);
  if (existsSync(s.envFile)) expect(envNow(s)).toBe(before);
  if (docker === 'none') expect(called(s, 'docker'), 'docker was called before the refusal').toEqual([]);
  else expect(called(s, 'docker').filter((l) => !/^docker volume ls\b/.test(l))).toEqual([]);
  expect(out).toContain('[stand-up-live] refused: ');
}

/** Refused before anything changed, with `why` in what it said. */
function expectRefused(s: Stage, r: { status: number; out: string }, why: RegExp | string, docker: 'none' | 'reads' = 'none', before?: string): void {
  expect(r.status, r.out).toBe(1);
  if (typeof why === 'string') expect(r.out).toContain(why);
  else expect(r.out).toMatch(why);
  expectNothingChanged(s, before ?? envText({ ...LIVE_ENV }), r.out, docker);
}

/**
 * What it printed, with each commit id masked. It prints the tag's commit, and
 * a random 40-hex id holds a five-digit port by chance often enough to fail a
 * run now and then (d8f6d46…84843126…, 2026-09-28).
 */
const shown = (out: string): string => out.replace(/\b[0-9a-f]{40}\b/g, '<commit>');

/** No private value, no bind address, no port, no generated password in what it printed or on any argv. */
function expectNothingLeaked(s: Stage, out: string, secrets: string[] = []): void {
  const argv = readFileSync(s.log, 'utf8');
  for (const v of [...PRIVATE_VALUES, ...secrets]) {
    expect(shown(out), `printed: ${v}`).not.toContain(v);
  }
  for (const v of secrets) {
    expect(argv, `on a command line: ${v}`).not.toContain(v);
  }
}

// ---------------------------------------------------------------------------
// Refused before anything changes
// ---------------------------------------------------------------------------

describe('refused before anything changes: the arguments, the shell and the checkout', () => {
  it.each([[['--with-demo']], [['--resume', '--with-demo']], [['--with-demo', '--resume']]])(
    '--with-demo, wherever it stands: %j',
    (args) => {
      const s = stage();
      const r = run(s, args);
      expectRefused(s, r, /refused: --with-demo/);
      expect(r.out).toMatch(/never has the demo/);
    },
    CASE_MS,
  );

  it(
    'an argument it does not know',
    () => {
      const s = stage();
      expectRefused(s, run(s, ['--yes']), /unknown argument '--yes'/);
    },
    CASE_MS,
  );

  it(
    'started under tracing, which would print every password it handles',
    () => {
      const s = stage();
      const r = run(s, [], {}, ['bash', '-x']);
      expectRefused(s, r, /tracing/);
    },
    CASE_MS,
  );

  it.each([
    ['COMPOSE_FILE', { COMPOSE_FILE: '/elsewhere/managed.yml' }, /this shell has COMPOSE_FILE set/],
    ['COMPOSE_ENV_FILES', { COMPOSE_ENV_FILES: '/elsewhere/.env' }, /this shell has COMPOSE_ENV_FILES set/],
    ["another stack's project name", { COMPOSE_PROJECT_NAME: 'ownpace-managed' }, /COMPOSE_PROJECT_NAME/],
    ['an empty project name, which Compose follows too', { COMPOSE_PROJECT_NAME: '' }, /COMPOSE_PROJECT_NAME/],
    ['MANAGED_ENV_PERSIST_DIR elsewhere', { MANAGED_ENV_PERSIST_DIR: '/elsewhere' }, /MANAGED_ENV_PERSIST_DIR/],
  ] as const)(
    'a shell with %s',
    (_label, extra, why) => {
      const s = stage();
      expectRefused(s, run(s, [], extra), why);
    },
    CASE_MS,
  );

  it(
    'a checkout that is not ~/ownpace-live, where the timer looks',
    () => {
      const s = stage();
      const r = run(s, [], { HOME: join(s.root, 'someone-else') });
      expectRefused(s, r, /~\/ownpace-live/);
    },
    CASE_MS,
  );

  it.each([
    ['a plain file, not a link', 'file' as const, /is not a link/],
    ["a link to a file that is not live's persisted .env", 'elsewhere' as const, /\.persistent\/ownpace-live\/\.env/],
    ['a link to a file that does not exist yet', 'dangling' as const, /does not exist/],
  ])(
    'a .env that is %s',
    (_label, link, why) => {
      const s = stage({ link });
      const r = run(s);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toMatch(why);
      expect(called(s, 'bootstrap')).toEqual([]);
      expect(called(s, 'docker')).toEqual([]);
      expect(called(s, 'openssl')).toEqual([]);
    },
    CASE_MS,
  );

  it.each([
    ["no live's marker", { STACK_KIND: undefined }, /STACK_KIND=production/],
    ['another kind, not printed', { STACK_KIND: 'staging-q7' }, /STACK_KIND=production/],
    ['no project name', { COMPOSE_PROJECT_NAME: undefined }, /COMPOSE_PROJECT_NAME/],
    ["the OTA stack's project name", { COMPOSE_PROJECT_NAME: 'ownpace-managed' }, /COMPOSE_PROJECT_NAME=ownpace-live/],
  ] as const)(
    'a .env with %s',
    (_label, env, why) => {
      const s = stage({ env });
      const before = envNow(s);
      const r = run(s);
      expectRefused(s, r, why, 'none', before);
      expect(r.out).not.toContain('staging-q7');
    },
    CASE_MS,
  );
});

describe('refused before anything changes: the tag live is to run', () => {
  it(
    'HEAD on a branch',
    () => {
      const s = stage({ head: 'branch' });
      const r = run(s);
      expectRefused(s, r, /HEAD is on the branch 'main'/);
      expect(r.out).toContain(RELEASE_SENTENCE);
    },
    CASE_MS,
  );

  it(
    'HEAD at no v… tag',
    () => {
      const s = stage({ head: 'untagged' });
      const r = run(s);
      expectRefused(s, r, /at no tag named v/);
      expect(r.out).toContain(RELEASE_SENTENCE);
    },
    CASE_MS,
  );

  it.each([
    ['a lightweight tag', { lightweight: true }, /is a lightweight tag/],
    ['a tag only this clone has', { push: false }, /is not on origin/],
    ["a tag whose package.json says another version", { version: '0.2.0-alpha.9' }, /says version '0\.2\.0-alpha\.9', and the tag says '0\.2\.0-alpha\.1'/],
  ] as const)(
    '%s (release-tag.sh, the rule deploy-live.sh applies)',
    (_label, tag, why) => {
      const s = stage({ tag });
      const r = run(s);
      expectRefused(s, r, why);
      expect(r.out).toContain(RELEASE_SENTENCE);
    },
    CASE_MS,
  );

  it(
    "a tag here that is not origin's",
    () => {
      const s = stage();
      // Moved here after it was pushed: the same name, another object.
      git(s.root, s.work, 'tag', '-f', '-a', TAG, '-m', 'moved', 'HEAD');
      const r = run(s);
      expectRefused(s, r, /here is not origin's/);
    },
    CASE_MS,
  );

  it.each(['deploy-live.sh', 'exposure-check.sh', 'box-duties.sh', 'stack-kind.sh'])(
    'a tag without %s',
    (file) => {
      const s = stage({ omit: [file] });
      const r = run(s);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain(`deploy/compose/${file}`);
      expect(called(s, 'bootstrap')).toEqual([]);
      expect(called(s, 'openssl')).toEqual([]);
    },
    CASE_MS,
  );

  it.each([
    ['a changed file', (s: Stage) => writeFileSync(join(s.work, 'package.json'), '{}\n'), 'package.json'],
    ['a file git does not know', (s: Stage) => writeFileSync(join(s.work, 'stray.txt'), 'x\n'), 'stray.txt'],
  ] as const)(
    'a working tree with %s',
    (_label, dirty, name) => {
      const s = stage();
      dirty(s);
      const r = run(s);
      expectRefused(s, r, /not clean/);
      expect(r.out).toContain(name);
    },
    CASE_MS,
  );
});

describe('refused before anything changes: a live that stands, or is half-built', () => {
  it(
    'a deploy log with a line: live stands, and deploy-live.sh is the way from here',
    () => {
      const s = stage();
      const line = `2026-09-28T10:00:00Z\t${TAG}\t${s.commit}\ttook\tone-way\n`;
      writeFileSync(s.deployLog, line);
      const r = run(s, ['--resume']);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('[stand-up-live] refused: ');
      expect(r.out).toMatch(/deploy-live\.sh/);
      expect(r.out).toMatch(/deploys\.log/);
      expect(readFileSync(s.deployLog, 'utf8')).toBe(line);
      for (const what of ['bootstrap', 'openssl', 'env-upsert', 'docker', 'psql', 'curl']) {
        expect(called(s, what), `${what} ran`).toEqual([]);
      }
    },
    CASE_MS,
  );

  it(
    "live's database volume already there, without --resume",
    () => {
      const s = stage({ volumes: ['ownpace-live_postgres_data'] });
      const r = run(s);
      expectRefused(s, r, /ownpace-live_postgres_data/, 'reads');
      expect(r.out).toMatch(/--resume/);
    },
    CASE_MS,
  );

  it(
    "the OTA stack's volumes are not live's",
    () => {
      // Only live's own name counts: the daemon holds both stacks.
      const s = stage({ volumes: ['ownpace-managed_postgres_data'] });
      const r = run(s, [], { STUB_TRIGGER_STOP: 'account' });
      expect(r.status, r.out).toBe(2);
    },
    CASE_MS,
  );

  it(
    'a daemon that does not answer is never taken for one without volumes',
    () => {
      const s = stage();
      const r = run(s, [], { STUB_DOCKER_DOWN: '1' });
      expectRefused(s, r, /could not list the volumes/, 'reads');
    },
    CASE_MS,
  );
});

describe("refused before anything changes: live's .env, key by key, never a value", () => {
  type Case = [string, Record<string, string | undefined>, string, string?];
  const CASES: Case[] = [
    ['WEB_BIND empty', { WEB_BIND: '' }, 'WEB_BIND'],
    ['ZITADEL_BIND empty', { ZITADEL_BIND: '' }, 'ZITADEL_BIND'],
    ['STATUS_BIND empty', { STATUS_BIND: '' }, 'STATUS_BIND'],
    ['POSTGRES_BIND set', { POSTGRES_BIND: FRONT, EXPOSURE_ALLOW: `${FRONT},${OTA_FRONT}` }, 'POSTGRES_BIND'],
    ['API_BIND set', { API_BIND: FRONT }, 'API_BIND'],
    ['TRIGGER_BIND set', { TRIGGER_BIND: FRONT }, 'TRIGGER_BIND'],
    ['a bind that is a name', { WEB_BIND: 'front-q3.example.test' }, 'WEB_BIND', 'front-q3.example.test'],
    ['a bind on every interface', { STATUS_BIND: '0.0.0.0' }, 'STATUS_BIND'],
    ["TRIGGER_API_ORIGIN not on TRIGGER_PORT", { TRIGGER_API_ORIGIN: 'http://127.0.0.1:3090' }, 'TRIGGER_API_ORIGIN'],
    ['TRIGGER_APP_ORIGIN not on TRIGGER_TLS_PORT', { TRIGGER_APP_ORIGIN: 'https://localhost:3443' }, 'TRIGGER_APP_ORIGIN'],
    ['TRIGGER_LOGIN_ORIGIN not on TRIGGER_TLS_PORT', { TRIGGER_LOGIN_ORIGIN: 'https://localhost' }, 'TRIGGER_LOGIN_ORIGIN'],
    ['TRIGGER_CLI_PROFILE the default', { TRIGGER_CLI_PROFILE: 'openmig' }, 'TRIGGER_CLI_PROFILE'],
    ['TRIGGER_CLI_PROFILE empty', { TRIGGER_CLI_PROFILE: '' }, 'TRIGGER_CLI_PROFILE'],
    ["EXPOSURE_ALLOW without live's front", { EXPOSURE_ALLOW: OTA_FRONT }, 'EXPOSURE_ALLOW'],
    ["EXPOSURE_ALLOW without the OTA stack's", { EXPOSURE_ALLOW: FRONT }, 'EXPOSURE_ALLOW'],
    ['WEB_URL not the production name', { WEB_URL: 'http://localhost:3123' }, 'WEB_URL'],
    ['CORS_ORIGIN not the production name', { CORS_ORIGIN: 'https://app.ota.example.test' }, 'CORS_ORIGIN'],
    ['ZITADEL_EXTERNALDOMAIN not id.ownpace.eu', { ZITADEL_EXTERNALDOMAIN: 'ownpace-idp' }, 'ZITADEL_EXTERNALDOMAIN'],
    ['ZITADEL_EXTERNALPORT not 443', { ZITADEL_EXTERNALPORT: '3126' }, 'ZITADEL_EXTERNALPORT'],
    ['ZITADEL_EXTERNALSECURE not true', { ZITADEL_EXTERNALSECURE: 'false' }, 'ZITADEL_EXTERNALSECURE'],
    ['ZITADEL_TLS_MODE not external', { ZITADEL_TLS_MODE: 'disabled' }, 'ZITADEL_TLS_MODE'],
    ['NODE_ENV not production', { NODE_ENV: 'development' }, 'NODE_ENV'],
    ['OWNPACE_REACHABLE_HOSTS set', { OWNPACE_REACHABLE_HOSTS: 'nextcloud' }, 'OWNPACE_REACHABLE_HOSTS', 'nextcloud'],
    ["the gate's placeholder Google client", { GOOGLE_OAUTH_CLIENT_ID: 'gate-google-q1' }, 'GOOGLE_OAUTH_CLIENT_ID', 'gate-google-q1'],
    ["the gate's placeholder Dropbox key", { DROPBOX_OAUTH_CLIENT_ID: 'gatedropboxappkey' }, 'DROPBOX_OAUTH_CLIENT_ID', 'gatedropboxappkey'],
    ['APP_DB_USER not app_user', { APP_DB_USER: 'someone-q4' }, 'APP_DB_USER', 'someone-q4'],
    ['a port left empty', { MAILPIT_PORT: '' }, 'MAILPIT_PORT'],
    ["a port the OTA stack uses by default", { WEB_PORT: '3123' }, 'WEB_PORT'],
    ['two of live\'s ports the same', { STATUS_PORT: PORTS.WEB_PORT }, 'STATUS_PORT'],
    ['a password a URL cannot carry as it is', { POSTGRES_PASSWORD: 'abc@def-q5' }, 'POSTGRES_PASSWORD', 'abc@def-q5'],
  ];

  it.each(CASES)(
    '%s',
    (_label, env, key, secretValue) => {
      const s = stage({ env });
      const before = envNow(s);
      const r = run(s);
      expectRefused(s, r, `- ${key}`, 'reads', before);
      if (secretValue) expect(shown(r.out)).not.toContain(secretValue);
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );

  it(
    "a port the OTA stack's own .env sets, read from its persisted file and never printed",
    () => {
      const s = stage({ otaEnv: { ...OTA_ENV, API_PORT: '41999' }, env: { API_PORT: '41999' }, proc: { reserved: OTA_CASES_RESERVED } });
      const r = run(s);
      expectRefused(s, r, '- API_PORT', 'reads', envNow(s));
      expect(r.out).toMatch(/OTA stack/);
      expect(shown(r.out)).not.toContain('41999');
    },
    CASE_MS,
  );

  it.each([
    ["live's WEB_PORT the OTA stack's API_PORT, managed.yml's default", { WEB_PORT: '3001' }, OTA_ENV, 'WEB_PORT'],
    ["live's MAILPIT_PORT the TRIGGER_PORT the OTA stack's .env sets", { MAILPIT_PORT: '41090' }, { ...OTA_ENV, TRIGGER_PORT: '41090' }, 'MAILPIT_PORT'],
    ["live's STATUS_PORT the OTA stack's NEXTCLOUD_PORT, by default", { STATUS_PORT: '8083' }, OTA_ENV, 'STATUS_PORT'],
    ["live's API_PORT the site's WWW_PORT, www.yml's default", { API_PORT: '3125' }, OTA_ENV, 'API_PORT'],
    ["live's REGISTRY_PORT a *_PORT only the OTA stack's .env names", { REGISTRY_PORT: '41555' }, { ...OTA_ENV, SOMETHING_ELSE_PORT: '41555' }, 'REGISTRY_PORT'],
  ] as const)(
    'a port the OTA stack uses under another key, with nothing listening on it: %s',
    (_label, env, otaEnv, key) => {
      const s = stage({ env, otaEnv, proc: { reserved: OTA_CASES_RESERVED } });
      const r = run(s);
      expectRefused(s, r, `- ${key}`, 'reads', envNow(s));
      expect(r.out).toMatch(/OTA stack's ports/);
      expect(r.out).not.toMatch(/in use/);
      expect(shown(r.out)).not.toContain('41090');
      expect(shown(r.out)).not.toContain('41555');
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );

  it(
    "a port the OTA stack uses under another key, on a resume, where nothing asks what listens",
    () => {
      const s = stage({
        env: { WEB_PORT: '3001', POSTGRES_PASSWORD: 'f00d'.repeat(12), APP_DB_PASSWORD: 'beef'.repeat(12) },
        volumes: ['ownpace-live_postgres_data'],
      });
      const r = run(s, ['--resume']);
      expectRefused(s, r, '- WEB_PORT', 'reads', envNow(s));
      expect(called(s, 'ss'), 'a resume asks ss nothing: the port is live\'s own by then').toEqual([]);
      expect(r.out).toMatch(/OTA stack's ports/);
    },
    CASE_MS,
  );

  it.each([
    ['an indented POSTGRES_BIND after the empty one', `  POSTGRES_BIND=${FRONT}\n`, 'POSTGRES_BIND', FRONT],
    ['an indented OWNPACE_REACHABLE_HOSTS', '  OWNPACE_REACHABLE_HOSTS=nextcloud\n', 'OWNPACE_REACHABLE_HOSTS', 'nextcloud'],
    ["API_BIND with a space around '='", `API_BIND = ${FRONT}\n`, 'API_BIND', FRONT],
    ["TRIGGER_BIND with ':' for '='", `TRIGGER_BIND: ${FRONT}\n`, 'TRIGGER_BIND', FRONT],
    ['an indented export of NODE_ENV', '\texport NODE_ENV=staging-q8\n', 'NODE_ENV', 'staging-q8'],
  ] as const)(
    'a line Compose reads and env_value does not, which would set what the checks read as empty: %s',
    (_label, suffix, key, value) => {
      const s = stage({ envSuffix: suffix });
      const before = envNow(s);
      const r = run(s);
      expectRefused(s, r, `- ${key}: set on line `, 'reads', before);
      expect(r.out).toMatch(/does not read/);
      expect(shown(r.out)).not.toContain(value);
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );

  it(
    'the shipped managed.env.example has no such line: a .env copied from it is not refused for one',
    () => {
      const s = stage({ envPrefix: readFileSync(join(COMPOSE_DIR, 'managed.env.example'), 'utf8') });
      const r = run(s);
      expect(r.out).not.toMatch(/in a form this script does not read/);
    },
    CASE_MS,
  );

  it(
    'a port something on the machine already listens on',
    () => {
      const s = stage();
      const r = run(s, [], { STUB_LISTENING: PORTS.REGISTRY_PORT! });
      expectRefused(s, r, '- REGISTRY_PORT', 'reads');
      expect(r.out).toMatch(/in use/);
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a production name that does not resolve from the machine: routed after the bring-up, which needs it',
    () => {
      const s = stage();
      const r = run(s, [], { STUB_UNRESOLVED: 'id.ownpace.eu' });
      expectRefused(s, r, '- id.ownpace.eu', 'reads');
      expect(r.out).toMatch(/NetBird|route/i);
    },
    CASE_MS,
  );

  it(
    'names every problem at once, not one per run',
    () => {
      const s = stage({ env: { NODE_ENV: 'development', WEB_BIND: '' } });
      const r = run(s);
      expectRefused(s, r, '- NODE_ENV', 'reads', envNow(s));
      expect(r.out).toContain('- WEB_BIND');
    },
    CASE_MS,
  );

  it.each([
    ['APP_DB_PASSWORD', { APP_DB_PASSWORD: 'app_password', POSTGRES_PASSWORD: 'f00d'.repeat(12) }, 'ownpace-live_postgres_data', /0132 T2/],
    ['TRIGGER_DB_PASSWORD', { TRIGGER_DB_PASSWORD: '', POSTGRES_PASSWORD: 'f00d'.repeat(12), APP_DB_PASSWORD: 'beef'.repeat(12) }, 'ownpace-live_trigger_db_data', /reset-trigger\.sh/],
  ] as const)(
    'a published %s whose volume exists already: the volume keeps what it was given',
    (key, env, volume, remedy) => {
      const s = stage({ env, volumes: ['ownpace-live_postgres_data', 'ownpace-live_trigger_db_data'] });
      const before = envNow(s);
      const r = run(s, ['--resume']);
      expectRefused(s, r, `- ${key}`, 'reads', before);
      expect(r.out).toContain(volume);
      expect(r.out).toMatch(remedy);
      expect(r.out).not.toContain('f00d'.repeat(12));
    },
    CASE_MS,
  );
});

/** Past every refusal, as far as the first stop (exit 2), with nothing said about `what`. */
function expectPassed(r: { status: number; out: string }, what: string | RegExp): void {
  expect(r.status, r.out).toBe(2);
  expect(r.out).toContain('[stand-up-live] every refusal passed');
  if (typeof what === 'string') expect(r.out).not.toContain(what);
  else expect(r.out).not.toMatch(what);
}

describe("live's BACKUP_RETENTION_DAYS is the most days a dump taken before a deploy is kept (0134): 7 from the first bring-up, never 0 or empty", () => {
  it.each([
    ['0, which would tell a closing organisation live keeps no copy', { BACKUP_RETENTION_DAYS: '0' }],
    ['empty, which the api reads as 7 and refuses on the alpha', { BACKUP_RETENTION_DAYS: '' }],
    ['empty on a live whose .env does not say alpha', { BACKUP_RETENTION_DAYS: '', OWNPACE_STAGE: '' }],
    ['left out', { BACKUP_RETENTION_DAYS: undefined }],
    ['a word', { BACKUP_RETENTION_DAYS: 'seven' }],
    ['below 0', { BACKUP_RETENTION_DAYS: '-7' }],
    ['not a whole number', { BACKUP_RETENTION_DAYS: '7.5' }],
  ] as const)(
    'refused: %s',
    (_label, env) => {
      const s = stage({ env });
      const r = run(s);
      expectRefused(s, r, '- BACKUP_RETENTION_DAYS', 'reads', envNow(s));
      expect(r.out).toMatch(/the most days a dump of its databases taken before a deploy is kept, 7 \(workplan 0134/);
      expect(r.out).not.toContain('seven');
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );

  it(
    'the refusal says the dump and its deletion are the owner\'s, as long as deploy-live.sh says it takes none',
    () => {
      // deploy-live.sh leaves step 4, the dump, to the owner, and nothing
      // deletes one (0132 T6; 0134 T0). A refusal that said live keeps a copy
      // would have the owner deploy believing a way back exists. When a
      // script takes the dump, this fails, and the refusal changes with it.
      const deployLive = readFileSync(join(COMPOSE_DIR, 'deploy-live.sh'), 'utf8');
      expect(deployLive).toMatch(/It does not open the hold \(step 2\) or dump the database\s*#?\s*\(step 4\): both are the owner's/);
      const s = stage({ env: { BACKUP_RETENTION_DAYS: '0' } });
      const r = run(s);
      expectRefused(s, r, '- BACKUP_RETENTION_DAYS', 'reads', envNow(s));
      expect(r.out).toContain('Taking the dump and deleting it by then are your steps (0132 T6 step 4): no script takes it or deletes it yet.');
      expect(r.out).not.toMatch(/\blive (takes|keeps) a copy\b/i);
    },
    CASE_MS,
  );

  it.each([
    ["7, the owner's number", '7'],
    ['another whole number of days', '14'],
  ])(
    'taken: %s, on the alpha',
    (_label, days) => {
      const s = stage({ env: { BACKUP_RETENTION_DAYS: days, OWNPACE_STAGE: 'alpha' } });
      expectPassed(run(s, [], { STUB_TRIGGER_STOP: 'account' }), 'BACKUP_RETENTION_DAYS');
    },
    CASE_MS,
  );
});

describe("live's mail goes through a real relay from its first day, and no catcher (0133)", () => {
  it.each([
    ['SMTP_HOST empty, which sends nothing', { SMTP_HOST: '' }, 'SMTP_HOST'],
    ['SMTP_HOST the catcher', { SMTP_HOST: 'mailpit' }, 'SMTP_HOST'],
    ["SMTP_PORT empty, where setup-zitadel.sh would take the catcher's 1025", { SMTP_PORT: '' }, 'SMTP_PORT'],
    ['SMTP_PORT not a port', { SMTP_PORT: 'port-q9' }, 'SMTP_PORT'],
    ['NOTIFY_FROM empty', { NOTIFY_FROM: '' }, 'NOTIFY_FROM'],
    ['NOTIFY_TO empty', { NOTIFY_TO: '' }, 'NOTIFY_TO'],
    ["NOTIFY_FROM the example's, in .invalid", { NOTIFY_FROM: 'ownpace@ownpace.invalid' }, 'NOTIFY_FROM'],
    ['NOTIFY_FROM in .invalid, behind a name', { NOTIFY_FROM: "'Ownpace <ownpace@ownpace.invalid>'" }, 'NOTIFY_FROM'],
    ['NOTIFY_TO a list with one address in .invalid', { NOTIFY_TO: 'operator-q6@example.test,someone@ownpace.invalid' }, 'NOTIFY_TO'],
  ] as const)(
    'refused: %s',
    (_label, env, key) => {
      const s = stage({ env });
      const r = run(s);
      expectRefused(s, r, `- ${key}`, 'reads', envNow(s));
      expect(r.out).toMatch(/workplan 0133/);
      expect(shown(r.out)).not.toContain('ownpace.invalid');
      expect(r.out).not.toContain('port-q9');
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );

  // env_value takes off single quotes and not double ones, Compose takes off
  // both, and setup-zitadel.sh reads with env_value: a value in double quotes
  // is one thing to the containers and another to the identity provider.
  it.each([
    ['SMTP_HOST="", which Compose hands the containers as no host at all', { SMTP_HOST: '""' }, 'SMTP_HOST'],
    ['NOTIFY_TO="", which Compose hands the api as no address at all', { NOTIFY_TO: '""' }, 'NOTIFY_TO'],
    ['NOTIFY_FROM=""', { NOTIFY_FROM: '""' }, 'NOTIFY_FROM'],
    ['SMTP_HOST="mailpit", the catcher in double quotes', { SMTP_HOST: '"mailpit"' }, 'SMTP_HOST'],
    ['SMTP_PORT="587", which setup-zitadel.sh would hand on with its quotes', { SMTP_PORT: '"587"' }, 'SMTP_PORT'],
    ['a real sender in double quotes, which setup-zitadel.sh would hand on with its quotes', { NOTIFY_FROM: '"sender-q6@example.test"' }, 'NOTIFY_FROM'],
  ] as const)(
    'refused, in double quotes: %s',
    (_label, env, key) => {
      const s = stage({ env });
      const r = run(s);
      expectRefused(s, r, `- ${key}: in double quotes.`, 'reads', envNow(s));
      expect(r.out).toMatch(/Write it bare, or in single quotes \(workplan 0133\)/);
      // One refusal for the key: the checks after it are not asked of a quoted value.
      expect(r.out.split('\n').filter((l) => l.startsWith(`  - ${key}: `))).toHaveLength(1);
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );

  it.each([
    ['a sender behind a name', { NOTIFY_FROM: "'Ownpace <sender-q6@example.test>'" }],
    ['two operators', { NOTIFY_TO: 'operator-q6@example.test,second-q6@example.test' }],
    ['a relay in single quotes, which env_value and Compose both take off', { SMTP_HOST: "'smtp.example.test'" }],
  ] as const)(
    'taken: %s',
    (_label, env) => {
      const s = stage({ env });
      expectPassed(run(s, [], { STUB_TRIGGER_STOP: 'account' }), /- (SMTP_|NOTIFY_)/);
    },
    CASE_MS,
  );
});

describe('EXPOSURE_ALLOW is read by exposure-check.sh itself, so the list it takes is the one step 7 takes', () => {
  it.each([
    ["in double quotes, as bootstrap-managed.sh's remedy for a space writes it", { EXPOSURE_ALLOW: `"${FRONT},${OTA_FRONT}"` }, OTA_ENV],
    ['with a space after the comma, in double quotes', { EXPOSURE_ALLOW: `"${FRONT}, ${OTA_FRONT}"` }, OTA_ENV],
    ["live's TRIGGER_TLS_BIND on loopback, which exposure-check.sh never needs listed", { TRIGGER_TLS_BIND: '127.0.0.1' }, OTA_ENV],
    ["the OTA stack's MAILPIT_BIND on loopback, likewise", {}, { ...OTA_ENV, MAILPIT_BIND: '127.0.0.1' }],
  ] as const)(
    'taken: %s',
    (_label, env, otaEnv) => {
      const s = stage({ env, otaEnv });
      const r = run(s, [], { STUB_TRIGGER_STOP: 'account' });
      expectPassed(r, '- EXPOSURE_ALLOW');
      expect(called(s, 'exposure-check').some((l) => l.endsWith(' --from -')), 'exposure-check.sh was not asked').toBe(true);
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );

  it.each([
    ['a name in it', `${FRONT},${OTA_FRONT},front-q3.example.test`],
    ['every interface in it', `${FRONT},${OTA_FRONT},0.0.0.0`],
  ])(
    'refused, before anything changes, and not only at step 7: %s',
    (_label, allow) => {
      const s = stage({ env: { EXPOSURE_ALLOW: allow } });
      const r = run(s);
      expectRefused(s, r, '- EXPOSURE_ALLOW: exposure-check.sh refuses it', 'reads', envNow(s));
      expect(r.out).toMatch(/entry 3/);
      expect(r.out).not.toContain('front-q3.example.test');
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );
});

describe("a port live publishes in the kernel's ephemeral range is refused until it is reserved", () => {
  /** The eight of live's nine but WEB_PORT, reserved, after a port of something else. */
  const ALL_BUT_WEB = '8080,43001,43090,43124-43127,43443,45000,45432';

  it(
    'one of the nine in the range and not reserved: named with its port, and the fix keeps what is reserved',
    () => {
      const s = stage({ proc: { reserved: `${ALL_BUT_WEB}\n` } });
      const r = run(s);
      expectRefused(s, r, `- WEB_PORT: ${PORTS.WEB_PORT} lies in this machine's ephemeral port range (net.ipv4.ip_local_port_range, 32768 to 60999)`, 'reads');
      expect(r.out).toMatch(/fails to start with "address already in use"/);
      expect(r.out).toContain(
        `echo 'net.ipv4.ip_local_reserved_ports = ${ALL_BUT_WEB},${PORTS.WEB_PORT}' | sudo tee /etc/sysctl.d/90-ownpace-reserved-ports.conf`,
      );
      expect(r.out).toContain('sudo sysctl --system');
      // Only WEB_PORT is named; nothing else that is private is printed.
      expect(r.out.match(/_PORT: \d+ lies in/g)).toHaveLength(1);
      for (const v of [FRONT, OTA_FRONT, 'live-plane-q9', 'owner-q7@example.test', 'sender-q6@example.test']) expect(shown(r.out)).not.toContain(v);
    },
    CASE_MS,
  );

  it(
    'nothing reserved: each of the nine named, and the fix lists them in order',
    () => {
      const s = stage({ proc: { reserved: '\n' } });
      const r = run(s);
      expectRefused(s, r, '- POSTGRES_PORT: ', 'reads');
      for (const [key, port] of Object.entries(PORTS)) expect(r.out).toContain(`- ${key}: ${port} lies in`);
      const sorted = Object.values(PORTS)
        .map(Number)
        .sort((a, b) => a - b)
        .join(',');
      expect(r.out).toContain(`echo 'net.ipv4.ip_local_reserved_ports = ${sorted}' | sudo tee`);
    },
    CASE_MS,
  );

  it(
    'on a resume too: a port is bound at every start, not only the first',
    () => {
      const s = stage({
        proc: { reserved: `${ALL_BUT_WEB}\n` },
        env: { POSTGRES_PASSWORD: 'f00d'.repeat(12), APP_DB_PASSWORD: 'beef'.repeat(12) },
        volumes: ['ownpace-live_postgres_data'],
      });
      const r = run(s, ['--resume']);
      expectRefused(s, r, `- WEB_PORT: ${PORTS.WEB_PORT} lies in`, 'reads', envNow(s));
    },
    CASE_MS,
  );

  it(
    "WWW_PORT while WWW_LIVE=true, the site's switch (0139 T10)",
    () => {
      const s = stage({ env: { WWW_LIVE: 'true', WWW_PORT: '44003' } });
      const r = run(s);
      expectRefused(s, r, '- WWW_PORT: 44003 lies in', 'reads', envNow(s));
    },
    CASE_MS,
  );

  it("one rule for which ports are live's: the bring-up starts Mailpit for an SMTP_HOST live's .env can hold, and Nextcloud only for --with-demo, which both of live's scripts refuse", () => {
    // stand-up-live.sh's reason for asking MAILPIT_PORT and not NEXTCLOUD_PORT.
    // A bare `docker compose up` would start both and decides nothing:
    // bootstrap-managed.sh names its services.
    const bootstrap = readFileSync(join(COMPOSE_DIR, 'bootstrap-managed.sh'), 'utf8');
    const list = /local services=\(\n([\s\S]*?)\n {2}\)\n/.exec(bootstrap)?.[1] ?? '';
    expect(list, "bootstrap-managed.sh's list of services not found").toContain('api web');
    expect(list.replace(/#.*$/gm, '')).not.toMatch(/\bnextcloud\b|\bmailpit\b/);
    expect([...bootstrap.matchAll(/services\+=\(nextcloud\)/g)]).toHaveLength(1);
    expect(bootstrap).toContain('[ "$WITH_DEMO" -eq 1 ] && services+=(nextcloud)');
    expect(bootstrap).toMatch(/catcher_needed\(\) \{\n {2}\[ "\$WITH_DEMO" -eq 1 \] && return 0\n {2}\[ "\$\(env_get SMTP_HOST\)" = "mailpit" \]\n\}/);
    const deployLive = readFileSync(join(COMPOSE_DIR, 'deploy-live.sh'), 'utf8');
    expect(deployLive).toMatch(/if \[ "\$arg" = --with-demo \]; then\n\s+refuse /);
    expect(deployLive, 'deploy-live.sh now asks SMTP_HOST: the reason in stand-up-live.sh changes with it').not.toMatch(/SMTP_HOST/);
    const standUp = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8');
    expect(/^LIVE_PORT_KEYS=\(([^)]*)\)$/m.exec(standUp)?.[1]?.split(' ')).toContain('MAILPIT_PORT');
    expect(/^DEMO_PORT_KEYS='([^']*)'$/m.exec(standUp)?.[1]?.trim().split(/\s+/)).toEqual(['NEXTCLOUD_PORT']);
  });

  // 0139 T10's switch is on its own branch on 2026-09-28, and no script here
  // reads WWW_LIVE yet. Once one does, the name and the value this script
  // asks must be the ones deploy-live.sh acts on, or WWW_PORT is never asked.
  const siteSwitchReadElsewhere = readdirSync(COMPOSE_DIR).some(
    (f) => f.endsWith('.sh') && f !== SCRIPT && readFileSync(join(COMPOSE_DIR, f), 'utf8').includes('WWW_LIVE'),
  );
  it.skipIf(!siteSwitchReadElsewhere)(
    "the site's switch it asks is the one deploy-live.sh acts on, by its name and its value, once 0139 T10 has landed",
    () => {
      const owner = join(COMPOSE_DIR, 'www-live.sh');
      expect(existsSync(owner), "a script reads WWW_LIVE and www-live.sh, which defines the switch on 0139 T10's branch, is not here: point this at where it went").toBe(true);
      const standUp = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8');
      const key = /^SITE_SWITCH_KEY=(\w+)$/m.exec(standUp)?.[1];
      const on = /"\$SITE_SWITCH_KEY"\)" != (\w+) \] \|\| echo WWW_PORT/.exec(standUp)?.[1];
      expect(key, 'SITE_SWITCH_KEY= not found').toBeTruthy();
      expect(on, "the value live_port_keys takes for on, not found").toBeTruthy();
      const dir = mkdtempSync(join(tmpdir(), 'site-switch-'));
      tempDirs.push(dir);
      const envFile = join(dir, '.env');
      writeFileSync(envFile, `${key}=${on}\n`);
      const r = spawnSync('bash', ['-c', '. "$1" && www_live_switch "$2"', 'switch', owner, envFile], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe('on');
    },
  );

  it(
    'a *_PORT beyond the nine that managed.yml publishes',
    () => {
      const mailpitPorts = '      - "${MAILPIT_BIND:-127.0.0.1}:${MAILPIT_PORT:-3127}:8025"\n';
      const s = stage({
        env: { EXTRA_Q_PORT: '44001' },
        managedYml: (text) => {
          expect(text).toContain(mailpitPorts);
          return text.replace(mailpitPorts, `${mailpitPorts}      - "127.0.0.1:\${EXTRA_Q_PORT:-3998}:8026"\n`);
        },
      });
      const r = run(s);
      expectRefused(s, r, '- EXTRA_Q_PORT: 44001 lies in', 'reads', envNow(s));
    },
    CASE_MS,
  );

  it.each([
    ['the range', { range: null }, 'ip_local_port_range'],
    ['the reserved list', { reserved: null }, 'ip_local_reserved_ports'],
  ] as const)(
    '%s cannot be read, which is never taken for a port outside it',
    (_label, proc, key) => {
      const s = stage({ proc });
      const r = run(s);
      expectRefused(s, r, `- ${key}: `, 'reads');
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );

  it.each([
    ['reserved one by one', { reserved: '43001,43090,43123,43124,43126,43127,43443,45000,45432\n' }, {}],
    ['reserved as one range', { reserved: '43000-45999\n' }, {}],
    ['reserved in a list among other entries', { reserved: '8080,9100-9200,43000-43999,45000,45432,50000-50010\n' }, {}],
    ['below the range, and nothing reserved', { range: '46000\t60999\n', reserved: '\n' }, {}],
    ['WWW_PORT in the range, unreserved, with the site switched off', {}, { WWW_LIVE: 'false', WWW_PORT: '44003' }],
    ["the demo's NEXTCLOUD_PORT in the range, unreserved: live never publishes it", {}, { NEXTCLOUD_PORT: '44002' }],
  ] as const)(
    'taken: %s',
    (_label, proc, env) => {
      const s = stage({ proc, env });
      const r = run(s, [], { STUB_TRIGGER_STOP: 'account' });
      expectPassed(r, /ephemeral|ip_local_/);
      expectNothingLeaked(s, r.out);
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// The bring-up, its two stops, and the resume
// ---------------------------------------------------------------------------

describe('the first bring-up: the stops, the resume, the checks and the first log line', () => {
  it(
    'runs in the plan\'s order, stops twice for the owner, resumes by asking each step, and ends with the checks and one line',
    () => {
      const s = stage();

      // ---- The first run: stops for the dashboard (exit 2) ----
      const first = run(s, [], { STUB_TRIGGER_STOP: 'account' });
      expect(first.status, first.out).toBe(2);

      // The passwords: generated on the machine, five of them, 48 hex each,
      // all different, written into the persisted file through the link.
      const secrets = PASSWORD_KEYS.map((k) => valueOf(s, k));
      for (const [i, v] of secrets.entries()) expect(v, PASSWORD_KEYS[i]).toMatch(/^[0-9a-f]{48}$/);
      expect(new Set(secrets).size).toBe(5);
      expect(lstatSync(join(s.compose, '.env')).isSymbolicLink(), 'the link was replaced by a file').toBe(true);
      expect(called(s, 'openssl')).toEqual(Array(5).fill('openssl rand -hex 24'));
      // Through env-upsert.sh, on stdin: no KEY=VALUE on its command line.
      expect(called(s, 'env-upsert')).toEqual([`env-upsert --stdin ${join(s.compose, '.env')}`]);

      // The order: passwords, preflight, env, data, the runner network,
      // app_user, the password check, then --from trigger.
      const order = calls(s)
        .map((l) =>
          l.startsWith('env-upsert ')
            ? 'passwords'
            : l.startsWith('bootstrap ')
              ? l.slice('bootstrap '.length)
              : / compose .* config$/.test(l)
                ? 'config'
                : / exec -T postgres /.test(l)
                  ? 'postgres'
                  : l.startsWith('dbcheck ')
                    ? 'dbcheck'
                    : '',
        )
        .filter(Boolean)
        .filter((x, i, a) => a[i - 1] !== x);
      expect(order).toEqual(['passwords', '--only preflight', '--only env', 'config', '--only data', 'postgres', 'dbcheck', '--from trigger']);

      // app_user, from APP_DB_PASSWORD, on psql's stdin, before anything migrates.
      const sql = readFileSync(s.sqlLog, 'utf8');
      expect(sql).toContain(`CREATE ROLE app_user LOGIN PASSWORD '${valueOf(s, 'APP_DB_PASSWORD')}';`);
      expect(sql).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE)\b/);

      // The check, over live's own network, the password by name.
      const checks = called(s, 'dbcheck');
      expect(checks.length).toBeGreaterThanOrEqual(8);
      for (const c of checks) expect(c).toMatch(/^dbcheck ownpace-live_ownpace-network /);
      for (const d of called(s, 'docker').filter((l) => l.startsWith('docker run'))) {
        expect(d).toContain('-e PGPASSWORD --network ownpace-live_ownpace-network postgres:');
        expect(d).toContain('psql -h postgres ');
      }

      // What it said: the dashboard, the tunnel's shape, the magic link, and
      // to run it again with --resume, not bootstrap's own resume line.
      expect(first.out).toMatch(/trigger-magic-link\.sh/);
      expect(first.out).toMatch(/ssh -N -L <TRIGGER_TLS_PORT>:127\.0\.0\.1:<TRIGGER_TLS_PORT>/);
      expect(first.out).toContain('./deploy/compose/stand-up-live.sh --resume');
      expect(deployLines(s)).toEqual([]);
      expectNothingLeaked(s, first.out, secrets);

      // ---- Run again without --resume: live's database exists now ----
      const bare = run(s, [], { STUB_TRIGGER_STOP: 'login' });
      expect(bare.status, bare.out).toBe(1);
      expect(bare.out).toMatch(/--resume/);
      expect(called(s, 'bootstrap').length).toBe(4);

      // ---- The resume: stops for the CLI login (exit 2) ----
      const second = run(s, ['--resume'], { STUB_TRIGGER_STOP: 'login' });
      expect(second.status, second.out).toBe(2);
      expect(second.out).toMatch(/login/);
      expect(second.out).toContain('./deploy/compose/stand-up-live.sh --resume');
      // Nothing generated twice, app_user not created twice.
      expect(called(s, 'openssl')).toHaveLength(5);
      expect(PASSWORD_KEYS.map((k) => valueOf(s, k))).toEqual(secrets);
      expect(readFileSync(s.sqlLog, 'utf8').match(/CREATE ROLE/g)).toHaveLength(1);
      expect(called(s, 'bootstrap').slice(4)).toEqual([
        'bootstrap --only preflight',
        'bootstrap --only env',
        'bootstrap --only data',
        'bootstrap --from trigger',
      ]);
      expectNothingLeaked(s, second.out, secrets);

      // ---- The last resume: the app, the tasks, the checks, the log ----
      const third = run(s, ['--resume'], { STUB_WORKER: 'newline' });
      expect(third.status, third.out).toBe(0);

      // apps/worker/package.json lost only its newline, and got it back.
      expect(git(s.root, s.work, 'status', '--porcelain')).toBe('');
      expect(third.out).toMatch(/apps\/worker\/package\.json/);

      // The checks.
      expect(called(s, 'curl').slice(-4)).toEqual([
        'curl https://app.ownpace.eu/api/version',
        'curl https://app.ownpace.eu/api/ready',
        'curl https://app.ownpace.eu/api/auth/mode',
        'curl https://id.ownpace.eu/.well-known/openid-configuration',
      ]);
      expect(called(s, 'docker').some((l) => l.endsWith('exec -T api printenv NODE_ENV'))).toBe(true);
      expect(called(s, 'docker').some((l) => l.startsWith('docker network ls --filter name=ownpace-live_'))).toBe(true);
      // Asked of the machine once, at the end; before that only of recorded lines, for EXPOSURE_ALLOW.
      expect(called(s, 'exposure-check').filter((l) => !l.endsWith(' --from -'))).toEqual([`exposure-check --env-file ${join(s.compose, '.env')}`]);

      // The first line of the deploy log, in deploy-live.sh's format.
      const lines = deployLines(s);
      expect(lines).toHaveLength(1);
      const fields = lines[0]!.split('\t');
      expect(fields[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      expect(fields.slice(1)).toEqual([TAG, s.commit, 'took', 'one-way']);

      // The timer's units, copied, and systemd told; linger is the owner's.
      for (const unit of ['ownpace-box-duties.service', 'ownpace-box-duties.timer']) {
        expect(readFileSync(join(s.root, '.config', 'systemd', 'user', unit), 'utf8')).toBe(
          readFileSync(join(COMPOSE_DIR, 'systemd', unit), 'utf8'),
        );
      }
      expect(called(s, 'systemctl')).toEqual(['systemctl --user daemon-reload']);

      // What is left, the owner's.
      expect(third.out).toMatch(/ownpace-live stands/);
      for (const step of [
        'operator.sh add',
        'sudo loginctl enable-linger',
        'systemctl --user enable --now ownpace-box-duties.timer',
        `./deploy/compose/deploy-live.sh --dry-run ${TAG}`,
        'EXPOSURE_PROBE_LIVE_PORTS',
        'Status block',
      ]) {
        expect(third.out).toContain(step);
      }
      expectNothingLeaked(s, third.out, secrets);

      // Never pnpm or npx itself: that is the bring-up's.
      expect(called(s, 'pnpm')).toEqual([]);
      expect(called(s, 'npx')).toEqual([]);

      // ---- And once it stands, it refuses: deploy-live.sh from here ----
      const after = run(s, ['--resume']);
      expect(after.status, after.out).toBe(1);
      expect(after.out).toMatch(/deploy-live\.sh/);
      expect(deployLines(s)).toHaveLength(1);
    },
    CASE_MS * 2,
  );

  it(
    "keeps the owner's own passwords, and generates only what is empty or published",
    () => {
      const own = 'a1b2'.repeat(12);
      const s = stage({ env: { POSTGRES_PASSWORD: own } });
      const r = run(s, [], { STUB_TRIGGER_STOP: 'account' });
      expect(r.status, r.out).toBe(2);
      expect(valueOf(s, 'POSTGRES_PASSWORD')).toBe(own);
      expect(called(s, 'openssl')).toHaveLength(4);
      expectNothingLeaked(s, r.out, [own]);
    },
    CASE_MS,
  );
});

describe('after it began, a step that fails stops it, says so, and logs nothing', () => {
  type Breakage = [string, NodeJS.ProcessEnv, RegExp, ((s: Stage) => void)?];
  const BEFORE_TRIGGER: Breakage[] = [
    ['the first half of the bring-up fails', { STUB_BOOTSTRAP_ONLY_EXIT: '1' }, /bootstrap-managed\.sh --only preflight failed/],
    ['DOCKER_RUNNER_NETWORKS renders to another stack\'s network', { STUB_RUNNER_NETWORK: 'other_ownpace-network' }, /DOCKER_RUNNER_NETWORKS/],
    ['the database cannot be asked', { STUB_PSQL_FAIL: '1' }, /app_user/],
    ['the control does not open, so the check tells nothing', { STUB_DB_DOWN: '1' }, /CONTROL FAILED/],
    ['a published password opens', { STUB_DB_ALSO: 'openmigrate:change-me-openmigrate' }, /OPENS: openmigrate/],
  ];

  it.each(BEFORE_TRIGGER)(
    '%s: stopped before --from trigger',
    (_label, extra, why) => {
      const s = stage();
      const r = run(s, [], { STUB_TRIGGER_STOP: 'account', ...extra });
      expect(r.status, r.out).toBe(3);
      expect(r.out).toMatch(why);
      expect(r.out).toContain('./deploy/compose/stand-up-live.sh --resume');
      expect(called(s, 'bootstrap')).not.toContain('bootstrap --from trigger');
      expect(deployLines(s)).toEqual([]);
      expectNothingLeaked(s, r.out, PASSWORD_KEYS.map((k) => valueOf(s, k)).filter(Boolean));
    },
    CASE_MS,
  );

  it(
    'an app_user a migration made with the published password: the control fails',
    () => {
      const s = stage({ volumes: ['ownpace-live_postgres_data'], env: { POSTGRES_PASSWORD: 'f00d'.repeat(12), APP_DB_PASSWORD: 'beef'.repeat(12) } });
      writeFileSync(join(s.state, 'app_user_password'), 'app_password');
      const r = run(s, ['--resume'], { STUB_TRIGGER_STOP: 'account' });
      expect(r.status, r.out).toBe(3);
      expect(r.out).toMatch(/CONTROL FAILED/);
      expect(r.out).toMatch(/OPENS: app_user/);
      expect(readFileSync(s.sqlLog, 'utf8')).not.toMatch(/CREATE ROLE/);
      expect(called(s, 'bootstrap')).not.toContain('bootstrap --from trigger');
    },
    CASE_MS,
  );

  const AFTER_TRIGGER: Breakage[] = [
    ['the bring-up fails', { STUB_BOOTSTRAP_EXIT: '1' }, /bootstrap-managed\.sh --from trigger failed/],
    ['/api/version names another commit', {}, /\/api\/version names commit/, (s) => answer(s, 'app.ownpace.eu/api/version', 200, { version: VERSION, commit: 'unknown' })],
    ['/api/version names another version', {}, /\/api\/version names version/, (s) => answer(s, 'app.ownpace.eu/api/version', 200, { version: '0.2.0-alpha.0', commit: s.commit })],
    ['/api/ready answers 503', {}, /\/api\/ready/, (s) => answer(s, 'app.ownpace.eu/api/ready', 503, { status: 'down' })],
    ['/api/auth/mode answers dev', {}, /\/api\/auth\/mode/, (s) => answer(s, 'app.ownpace.eu/api/auth/mode', 200, { mode: 'dev' })],
    ['the app is not reached', {}, /\/api\/version/, (s) => rmSync(join(s.http, 'app.ownpace.eu_api_version.code'))],
    ['NODE_ENV in the api is development', { STUB_NODE_ENV: 'development' }, /NODE_ENV/],
    ['the issuer is another', {}, /issuer/, (s) => answer(s, 'id.ownpace.eu/.well-known/openid-configuration', 200, { issuer: 'https://id.ota.example.test' })],
    ["live's status-probe network is missing", { STUB_NO_STATUS_NET: '1' }, /status-probe/],
    ["a live container on the OTA stack's network", { STUB_ON_OTA_NET: 'ownpace-live-api' }, /ownpace-live-api/],
    ['the exposure check finds a port', { STUB_EXPOSURE_EXIT: '1' }, /exposure check/],
  ];

  it.each(AFTER_TRIGGER)(
    '%s: stopped after the bring-up, with the checkout clean again',
    (_label, extra, why, prep) => {
      const s = stage();
      prep?.(s);
      const r = run(s, [], { STUB_WORKER: 'newline', ...extra });
      expect(r.status, r.out).toBe(3);
      expect(r.out).toMatch(why);
      expect(r.out).toContain('./deploy/compose/stand-up-live.sh --resume');
      expect(r.out).not.toMatch(/ownpace-live stands/);
      expect(deployLines(s)).toEqual([]);
      expect(called(s, 'systemctl')).toEqual([]);
      expect(git(s.root, s.work, 'status', '--porcelain'), 'the newline was not put back').toBe('');
      expectNothingLeaked(s, r.out, PASSWORD_KEYS.map((k) => valueOf(s, k)).filter(Boolean));
    },
    CASE_MS,
  );

  it(
    'apps/worker/package.json changed beyond its newline is left alone, and said',
    () => {
      const s = stage();
      const r = run(s, [], { STUB_WORKER: 'content' });
      expect(r.status, r.out).toBe(0);
      expect(git(s.root, s.work, 'status', '--porcelain')).toContain('apps/worker/package.json');
      expect(r.out).toMatch(/NOTE: apps\/worker\/package\.json changed beyond its last newline/);
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// env-upsert.sh --stdin, which keeps a value off every command line
// ---------------------------------------------------------------------------

describe('env-upsert.sh --stdin', () => {
  const upsert = join(COMPOSE_DIR, 'env-upsert.sh');
  const dir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'upsert-stdin-'));
    tempDirs.push(d);
    return d;
  };

  it('takes the pairs from stdin, replaces a key where it is, and appends a new one', () => {
    const d = dir();
    const file = join(d, '.env');
    writeFileSync(file, '# note\nA=1\nB=old\n');
    const r = spawnSync(upsert, ['--stdin', file], { input: 'B=new\n\nC=two words\n', encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe("# note\nA=1\nB=new\nC='two words'\n");
  });

  it('follows a link, as it does for an argument', () => {
    const d = dir();
    mkdirSync(join(d, 'persist'));
    writeFileSync(join(d, 'persist', '.env'), 'A=1\n');
    symlinkSync(join(d, 'persist', '.env'), join(d, '.env'));
    const r = spawnSync(upsert, ['--stdin', join(d, '.env')], { input: 'A=2\n', encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(lstatSync(join(d, '.env')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(d, 'persist', '.env'), 'utf8')).toBe('A=2\n');
  });

  it('holds a pair on stdin to the rules an argument meets, and writes nothing on a refusal', () => {
    const d = dir();
    const file = join(d, '.env');
    writeFileSync(file, 'A=1\n');
    const r = spawnSync(upsert, ['--stdin', file], { input: "A=2\nB=it's\n", encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REFUSED B');
    expect(readFileSync(file, 'utf8')).toBe('A=1\n');
  });

  it('no pair at all is a usage error', () => {
    const d = dir();
    const file = join(d, '.env');
    writeFileSync(file, 'A=1\n');
    appendFileSync(file, '');
    const r = spawnSync(upsert, ['--stdin', file], { input: '', encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/usage/);
  });
});
