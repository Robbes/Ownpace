// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DEPLOY FROM A NAMED TAG (workplan 0132 T6 (a), with 0146 T5 (a)).
 *
 * `ownpace-live` is the stack testers use, beside the OTA stack on one
 * machine. The OTA stack follows `main` every night through the gate; live
 * moves only by hand, and only to a release tag (0132 T1g, 0146 T5). Until
 * `deploy/compose/deploy-live.sh`, the managed edition had three written
 * procedures for an update that disagreed with each other, and a `git pull`
 * in live's checkout would have put whatever `main` held in front of testers.
 *
 * The script runs T6's steps 3 and 5 to 7 and writes step 9, and each of
 * these can go wrong in a way nobody would see:
 *
 *   It deploys something that is not a release. A branch, a commit, a tag
 *   that exists only on this machine, a lightweight tag, a tag whose
 *   `package.json` says another version: each is refused before anything
 *   changes, with 0146's sentence, "live runs releases: name a release tag".
 *
 *   It deploys where it should not, or over work. A `.env` without live's
 *   marker (`stack_is_live`, `stack-kind.sh`), `COMPOSE_ENV_FILES` or
 *   `COMPOSE_FILE` in the shell, a project `docker compose config` reports
 *   that is not the one the checkout chooses, no open hold, a pass still in
 *   flight, a hold so new that a pass queued before it may not have started,
 *   a database it cannot read (never taken for "nothing in flight", hard
 *   rule 9), a working tree that is not clean, and `--with-demo` are all
 *   refused before the checkout moves. None of them may reach the bring-up.
 *
 *   Its dry run moves something, or refuses less. `--dry-run` is what the
 *   owner runs, with the hold on, to learn whether a dump is the only way
 *   back before taking one. It must refuse all that the deploy refuses, say
 *   the same one-way or reversible the deploy then logs, and stop: the
 *   checkout, the working tree and the deploy log (not even created) as they
 *   were, and no install, bring-up or check.
 *
 *   It says a deploy took when it did not. After the bring-up it asks the app
 *   at the origin in `WEB_URL`: `/api/version` must name the tag's commit AND
 *   its version (0146 T5: a right commit with the wrong version is a deploy
 *   that did not take), `/api/ready` 200, `/api/auth/mode` `managed`, and the
 *   exposure check must pass. Any failure says the deploy did not take, keeps
 *   the hold, and exits non-zero.
 *
 *   It lifts the hold. It must not: step 8 is the owner's, after looking. So
 *   no statement it sends the database writes anything.
 *
 *   It calls a one-way deploy reversible. A migration file added to either
 *   chain, or a Trigger.dev or identity-provider pin moved in `managed.yml`,
 *   since the tag that is running, makes it one-way; neither makes it
 *   reversible (0146 T5). "The tag that is running" is the last deploy the
 *   log says took. It is not the only thing compared: a deploy that did not
 *   take since may have run its bring-up, and its API applies its migrations
 *   when it starts, so going back to the running tag after one is one-way too
 *   (review of the first build). Every such deploy, and the checkout's HEAD,
 *   are compared as well; and with no deploy that took, what ran before the
 *   log's first line is named nowhere, and a first deploy that was one-way
 *   over it keeps the next one-way.
 *
 *   It lets the log decide the exit. A log that cannot be written at the end
 *   once made a deploy past the checkout exit 1, "refused, as they were",
 *   without saying it did not take or that the hold stays on. The log is
 *   checked before the checkout, and a line that still cannot be written is
 *   printed for the owner, after the outcome, with the outcome's exit.
 *
 *   It serves www.ownpace.eu wrong, or from the wrong project (workplan 0139
 *   T10, with 0132 T6). With `WWW_LIVE=true` in live's `.env` the script
 *   builds the tag's site with `--public` and brings it up under the project
 *   `ownpace-live-www` (live's, with `-www`), never typed by hand. In live's
 *   checkout a bare
 *   `docker compose -f deploy/compose/www.yml` puts the site in live's own
 *   project (#1275's header), where one `--remove-orphans` removes live or the
 *   site. So, before the checkout moves and in a dry run too: a missing
 *   `WWW_PORT` or `WWW_BIND`, a switch that is neither `true` nor `false`, a
 *   `www` service in live's project, a tag whose `www.yml` gives its
 *   container a fixed name or that has no
 *   site, a tag whose texts still carry placeholders, naming the count, and a
 *   tag whose full `--public` build refuses for any other reason (the tag's
 *   own site, test-built from git's objects: `--check` for the count, then
 *   the build the deploy runs after the checkout) are each refused. After
 *   the bring-up the site is built in the checkout, brought up with `-p
 *   ownpace-live-www` and live's `--env-file`, waited for until healthy, and
 *   asked on loopback: 200, no `noindex`, `robots.txt` allowing, and every
 *   request-access link on the production app. Any of that failing is a
 *   deploy that did not take, with the hold on, like any other check. And
 *   with the switch off, nothing about the site runs at all.
 *
 * HOW IT RUNS. Every case builds a checkout of its own: a real git repository
 * with a bare `origin` beside it, whose commits carry the script under test,
 * the two helpers it sources, the real `managed.yml`, one file in each
 * migration chain, and two stand-ins committed beside the script:
 * `bootstrap-managed.sh`, which records its arguments and the commit checked
 * out when it was called, and `exposure-check.sh`, which records its arguments
 * and exits as told. The real check (0132 T3 (b)) is on `main` since #1271 and
 * has a guard of its own; this one asks only that the deploy runs it with
 * live's `.env` and fails when it fails. git is real,
 * so tags, `ls-remote` and the diff between two tags behave as they do on the
 * machine. `docker`, `psql`, `curl` and `pnpm` are stubs on the PATH. The
 * `docker` stub runs `compose exec postgres sh -c …` here, so the script's own
 * psql command line is what runs, against the `psql` stub; that stub answers
 * a fixture, or, in the last block, hands the SQL to PGlite with both
 * migration chains applied. `HOME` is the case's own directory, so the
 * deploy log lands in `~/.persistent/<project>` under it.
 *
 * For the site, every commit also carries `www.yml` (the real one, its
 * container named after its project as #1275 makes it) and a stand-in
 * `site/build.mjs` that keeps the real one's contract: `--public` with an app
 * URL that is not production refuses, `--check` prints the real summary line
 * with the count a release commits in `site/drafts` and stops, a `--public`
 * build with a count refuses, and one at a release that commits
 * `site/refuses` refuses with those words, its count 0. The `docker` stub answers `ps` and `inspect` for the
 * site and records `compose -p … up`; the `curl` stub serves the checkout's
 * `site/dist` on 127.0.0.1 once that `up` ran, as nginx would. One case builds
 * the real `site/` from its tag, with the real count, or the real full
 * build's verdict when that count is 0.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const SCRIPT = 'deploy-live.sh';

/** 0146 T5's sentence, which every refusal of a ref carries. */
const RELEASE_SENTENCE = 'live runs releases: name a release tag';

/** The running release and the one being deployed, as the cases name them. */
const RUNNING = { tag: 'v0.2.0-alpha.1', version: '0.2.0-alpha.1' };
const NEXT = { tag: 'v0.2.0-alpha.2', version: '0.2.0-alpha.2' };

/** The public origin in the fixture's `.env`. It must never be printed. */
const APP_HOST = 'app.example.test';

const CASE_MS = 60_000;
const PGLITE_CASE_MS = 180_000;

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// PGlite for the `psql` stub, a separate node process. Resolved from the
// ledger package, which is where the dependency is declared.
const requireFromLedger = createRequire(join(REPO_ROOT, 'packages', 'ledger', 'package.json'));
const PGLITE_CJS = requireFromLedger.resolve('@electric-sql/pglite');
const PGCRYPTO_CJS = requireFromLedger.resolve('@electric-sql/pglite/contrib/pgcrypto');

interface PgliteLike {
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}
type PgliteCtor = new (dir: string, opts: unknown) => PgliteLike;
const { PGlite } = requireFromLedger('@electric-sql/pglite') as { PGlite: PgliteCtor };
const { pgcrypto } = requireFromLedger('@electric-sql/pglite/contrib/pgcrypto') as { pgcrypto: unknown };

// ---------------------------------------------------------------------------
// The stubs
// ---------------------------------------------------------------------------

/** The site's project, and the container id the stub gives it once it is up. */
const SITE_PROJECT = 'ownpace-live-www';
const SITE_ID = '5173e0001';

/**
 * docker: `compose config`, `compose exec -T postgres sh -c …`, and for the
 * site `ps` of a project's `www` containers (never the whole daemon),
 * `inspect` of the site's container, and `compose -p ownpace-live-www … up`.
 * Nothing else.
 */
const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >>"$STUB_LOG"
case "$1" in
  ps)
    shift
    project='' service=''
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -a) shift ;;
        --filter)
          case "$2" in
            label=com.docker.compose.project=*) project="\${2#label=com.docker.compose.project=}" ;;
            label=com.docker.compose.service=*) service="\${2#label=com.docker.compose.service=}" ;;
            *) echo "docker stub: unexpected filter: $2" >&2; exit 95 ;;
          esac
          shift 2
          ;;
        --format) shift 2 ;;
        *) echo "docker stub: unexpected ps argument: $1" >&2; exit 95 ;;
      esac
    done
    if [ -n "\${STUB_DOCKER_PS_FAIL:-}" ]; then echo 'Cannot connect to the Docker daemon' >&2; exit 1; fi
    [ -n "$project" ] || { echo "docker stub: a ps of the whole daemon: $*" >&2; exit 95; }
    [ "$service" = www ] || { echo "docker stub: unexpected service filter: $service" >&2; exit 95; }
    if [ "$project" = ${SITE_PROJECT} ]; then
      [ ! -f "$STUB_SITE_UP" ] || echo ${SITE_ID}
      exit 0
    fi
    # Another project's www service: STUB_WWW_IN is <project>:<name>.
    if [ -n "\${STUB_WWW_IN:-}" ] && [ "$project" = "\${STUB_WWW_IN%%:*}" ]; then echo "\${STUB_WWW_IN#*:}"; fi
    exit 0
    ;;
  inspect)
    [ "\${*: -1}" = ${SITE_ID} ] || { echo "docker stub: unexpected inspect: $*" >&2; exit 93; }
    printf '%s\\n' "\${STUB_SITE_STATE:-running healthy}"
    exit 0
    ;;
  compose) shift ;;
  *) echo "docker stub: unexpected call: $*" >&2; exit 98 ;;
esac
file='' env_file='' named=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -p) named="$2"; shift 2 ;;
    -f) file="$2"; shift 2 ;;
    --env-file) env_file="$2"; shift 2 ;;
    *) break ;;
  esac
done
[ -n "$env_file" ] || env_file="$(dirname "$file")/.env"
# The project, picked the way Compose picks it.
project="\${COMPOSE_PROJECT_NAME:-}"
[ -n "$project" ] || project="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$env_file" 2>/dev/null | tail -n 1)"
[ -n "$project" ] || project="$(sed -n 's/^name: *//p' "$file")"
project="\${STUB_PROJECT:-$project}"
[ -z "$named" ] || project="$named"
case "$1" in
  up)
    # Only the site is ever brought up by the script itself.
    [ "$project" = ${SITE_PROJECT} ] || { echo "docker stub: up in $project" >&2; exit 94; }
    bind="$(sed -n 's/^WWW_BIND=//p' "$env_file" | tail -n 1)"
    if [ -n "\${STUB_WWW_UP_EXIT:-}" ]; then
      echo "Error response from daemon: failed to bind host port for $bind: address already in use" >&2
      exit "$STUB_WWW_UP_EXIT"
    fi
    : >"$STUB_SITE_UP"
    echo " Container ${SITE_PROJECT}  Started, published on $bind"
    exit 0
    ;;
  config) printf 'name: %s\\nservices: {}\\n' "$project"; exit 0 ;;
  exec)
    shift
    [ "$1" = -T ] && shift
    svc="$1"; shift
    if [ "$svc" != postgres ] || [ "$1" != sh ] || [ "$2" != -c ]; then
      echo "docker stub: unexpected exec: $svc $*" >&2; exit 97
    fi
    export POSTGRES_USER=openmigrate POSTGRES_DB=openmigrate
    exec sh -c "$3"
    ;;
esac
echo "docker stub: unexpected compose call: $*" >&2
exit 96
`;

/** psql: a fixture answer, a failure, or PGlite when STUB_PGLITE names a data directory. */
const PSQL_STUB = (node: string) => `#!${node}
const fs = require('fs');
const args = process.argv.slice(2);
const ci = args.indexOf('-c');
const sql = ci >= 0 ? args[ci + 1] : fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.STUB_LOG, 'psql ' + args.join(' ') + '\\n');
fs.appendFileSync(process.env.STUB_SQL_LOG, sql + '\\n-- (end of one psql call)\\n');
if (process.env.STUB_PSQL_FAIL) {
  process.stderr.write('psql: error: connection to server on socket failed\\n');
  process.exit(2);
}
if (!process.env.STUB_PGLITE) {
  process.stdout.write(process.env.STUB_PSQL_ANSWER || '');
  process.exit(0);
}
(async () => {
  const { PGlite } = require(${JSON.stringify(PGLITE_CJS)});
  const { pgcrypto } = require(${JSON.stringify(PGCRYPTO_CJS)});
  const db = new PGlite(process.env.STUB_PGLITE, { extensions: { pgcrypto } });
  let code = 0;
  try {
    // One statement, its columns by position, the way psql -At prints them.
    const r = await db.query(sql, [], { rowMode: 'array' });
    for (const row of r.rows) {
      process.stdout.write(row.map((v) => (v == null ? '' : String(v))).join('|') + '\\n');
    }
  } catch (e) {
    process.stderr.write('ERROR:  ' + (e && e.message ? e.message : String(e)) + '\\n');
    code = 3;
  } finally {
    await db.close();
  }
  process.exit(code);
})();
`;

/** curl: answers from STUB_HTTP/<path with / as _>.code and .body; no file, no connection. */
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
host="\${url#*://}"
host="\${host%%/*}"
path="\${url#*://}"
path="\${path#*/}"
name="\${path//\\//_}"
case "$host" in
  127.0.0.1:*)
    # The site, on loopback: an answer the case wrote, or else nginx over the
    # checkout's site/dist once the site is up.
    name="site_\${name}"
    if [ ! -f "$STUB_HTTP/$name.code" ]; then
      [ -f "$STUB_SITE_UP" ] || exit 7
      file="$STUB_SITE_DIST/\${path:-index.html}"
      if [ -f "$file" ]; then code=200; else code=404; file=/dev/null; fi
      if [ -n "$out" ]; then cp "$file" "$out"; else cat "$file"; fi
      [ -z "$fmt" ] || printf '%s' "$code"
      exit 0
    fi
    ;;
esac
[ -f "$STUB_HTTP/$name.code" ] || exit 7
if [ -n "$out" ]; then cp "$STUB_HTTP/$name.body" "$out"; else cat "$STUB_HTTP/$name.body"; fi
[ -n "$fmt" ] && cat "$STUB_HTTP/$name.code"
exit 0
`;

const PNPM_STUB = `#!/usr/bin/env bash
printf 'pnpm %s\\n' "$*" >>"$STUB_LOG"
exit "\${STUB_PNPM_EXIT:-0}"
`;

/** The bring-up, as a stand-in committed beside the script: what it was asked, and at which commit. */
const BOOTSTRAP_STUB = `#!/usr/bin/env bash
printf 'bootstrap %s head=%s\\n' "$*" "$(git -C "$(dirname "$0")/../.." rev-parse HEAD)" >>"$STUB_LOG"
# A tracked file changed, as the task deploy changes apps/worker/package.json.
[ -z "\${STUB_BOOTSTRAP_DIRTIES:-}" ] || printf 'changed by the deploy\\n' >>"$(dirname "$0")/../../RELEASE"
# The deploy log's directory made a file while the deploy runs, so that the
# line at the end cannot be written, whoever runs this.
if [ -n "\${STUB_BREAK_LOG_DIR:-}" ]; then
  rm -rf "$STUB_BREAK_LOG_DIR"
  mkdir -p "$(dirname "$STUB_BREAK_LOG_DIR")"
  printf 'not a directory\\n' >"$STUB_BREAK_LOG_DIR"
fi
exit "\${STUB_BOOTSTRAP_EXIT:-0}"
`;

/** 0132 T3 (b)'s check, as a stand-in: what it was asked, and the exit it was told to give. */
const EXPOSURE_STUB = `#!/usr/bin/env bash
printf 'exposure-check %s\\n' "$*" >>"$STUB_LOG"
exit "\${STUB_EXPOSURE_EXIT:-0}"
`;

/** The production app, the one URL a `--public` build accepts (site/prices.mjs). */
const PUBLIC_APP = 'https://app.ownpace.eu';

/**
 * `site/build.mjs`, as a stand-in committed at each release: the real one's
 * contract, with the count of unfilled placeholders the release commits in
 * `site/drafts`. `--check` prints the count and stops, as the real one does,
 * before every other refusal: a release that commits `site/refuses` has a
 * `--public` build that throws its words with a count of 0, as the real one
 * does for a refusal beyond the count. `STUB_SITE_BUILD_EXIT` fails only the
 * build in the checkout (a disk that filled, say), not the test build. It
 * records its arguments, the three settings it reads and the directory it
 * lives in.
 */
const SITE_BUILD_STUB = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const e = process.env;
appendFileSync(
  e.STUB_LOG,
  \`site-build \${args.join(' ')} app=\${e.OWNPACE_APP_URL ?? '-'} sha=\${e.GIT_SHA ?? '-'} status=\${e.OWNPACE_STATUS_URL ?? '-'} here=\${HERE}\\n\`,
);
const pub = args.includes('--public');
const app = (e.OWNPACE_APP_URL ?? '').trim();
if (!app) throw new Error('OWNPACE_APP_URL is not set');
if (pub && app !== '${PUBLIC_APP}') throw new Error('--public builds the site for ${PUBLIC_APP}');
const drafts = Number(readFileSync(join(HERE, 'drafts'), 'utf8').trim());
if (args.includes('--check')) {
  console.log(\`[site] 3 pages across 2 locales, \${drafts} unfilled placeholder(s)\`);
  process.exit(0);
}
if (pub && drafts > 0) throw new Error(\`\${drafts} placeholder token(s) are still unfilled\`);
if (pub && existsSync(join(HERE, 'refuses'))) throw new Error(readFileSync(join(HERE, 'refuses'), 'utf8').trim());
const dist = join(HERE, 'dist');
if (e.STUB_SITE_BUILD_EXIT && dist === e.STUB_SITE_DIST) process.exit(Number(e.STUB_SITE_BUILD_EXIT));
mkdirSync(dist, { recursive: true });
for (const f of readdirSync(dist)) rmSync(join(dist, f), { recursive: true, force: true });
writeFileSync(
  join(dist, 'index.html'),
  \`<html><head>\${pub ? '' : '<meta name="robots" content="noindex, nofollow" />'}</head>\` +
    \`<body><a href="\${app}/request-access?tier=family">Request access</a></body></html>\\n\`,
);
writeFileSync(join(dist, 'robots.txt'), pub ? 'User-agent: *\\nAllow: /\\n' : 'User-agent: *\\nDisallow: /\\n');
console.log(pub ? '[site] PUBLIC build' : '[site] test build');
`;

// ---------------------------------------------------------------------------
// A checkout of its own
// ---------------------------------------------------------------------------

/** A release after the running one, and what it changes. */
interface Release {
  tag: string;
  /** The root package.json's version at this commit (default: the tag without its v). */
  version?: string;
  /** A migration file this commit adds to the shared chain. */
  ledger?: string;
  /** A migration file this commit adds to the managed chain. */
  managed?: string;
  /** Move the Trigger.dev pin in managed.yml to this version. */
  trigger?: string;
  /** Move the identity provider's pin in managed.yml to this version. */
  zitadel?: string;
  /** Tag it without -a. */
  lightweight?: boolean;
  /** Push the tag to origin (default true). */
  push?: boolean;
  /** Remove exposure-check.sh at this commit. */
  noExposureCheck?: boolean;
  /** The count of unfilled placeholders the site at this commit has (default 0). */
  siteDrafts?: number;
  /** What the site's `--public` build at this commit refuses with, beyond the count (its `--check` passes). */
  siteRefuses?: string;
  /** Give www.yml's container a fixed name at this commit, as before #1275. */
  fixedSiteName?: boolean;
  /** Remove site/build.mjs at this commit. */
  noSite?: boolean;
  /** Put the real site/ at this commit, in place of the stand-in. */
  realSite?: boolean;
}

interface Stage {
  root: string;
  work: string;
  compose: string;
  log: string;
  sqlLog: string;
  http: string;
  deployLog: string;
  /** Made by the docker stub when the site is brought up. */
  siteUp: string;
  env: NodeJS.ProcessEnv;
  commit: Record<string, string>;
}

const LIVE_ENV = [
  'COMPOSE_PROJECT_NAME=ownpace-live',
  'STACK_KIND=production',
  `WEB_URL=https://${APP_HOST}`,
  'POSTGRES_USER=openmigrate',
  'POSTGRES_DB=openmigrate',
  '',
].join('\n');

/** Live's copy of the site: its port, and the front's address (RFC 5737), never to be printed. */
const SITE_PORT = '20125';
const SITE_BIND = '192.0.2.10';
/** Live's `.env` with the site switched on. */
const SITE_ENV = `${LIVE_ENV}WWW_LIVE=true\nWWW_PORT=${SITE_PORT}\nWWW_BIND=${SITE_BIND}\n`;

/** www.yml as #1275 makes it: the container named after its project. Idempotent once #1275 is on main. */
function wwwYml(fixed = false): string {
  const real = readFileSync(join(COMPOSE_DIR, 'www.yml'), 'utf8');
  const derived = real.replace(/^(\s*container_name:\s*)ownpace-www\s*$/m, '$1${COMPOSE_PROJECT_NAME}');
  if (!/^\s*container_name:\s*\$\{COMPOSE_PROJECT_NAME\}\s*$/m.test(derived)) {
    throw new Error("www.yml's container_name is neither ownpace-www nor ${COMPOSE_PROJECT_NAME}: this fixture needs a look");
  }
  return fixed ? derived.replace(/^(\s*container_name:\s*).*$/m, '$1ownpace-www') : derived;
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

function packageJson(version: string): string {
  return `${JSON.stringify({ name: 'ownpace', version, private: true }, null, 2)}\n`;
}

/** managed.yml with one of its pins moved. Fails the case if the pin was not found. */
function movePin(yml: string, which: 'trigger' | 'zitadel', to: string): string {
  const moved =
    which === 'trigger'
      ? yml.replace(/(ghcr\.io\/triggerdotdev\/(?:trigger\.dev|supervisor):\$\{TRIGGER_IMAGE_TAG:-)v[0-9.]+\}/g, `$1${to}}`)
      : yml.replace(/(ghcr\.io\/zitadel\/zitadel:)v[0-9.]+/g, `$1${to}`);
  if (moved === yml) throw new Error(`managed.yml carries no ${which} pin this fixture knows how to move`);
  return moved;
}

interface StageOptions {
  releases?: Release[];
  /** Which tag the checkout holds when the script starts (default the running one). */
  checkout?: string;
  dotEnv?: string;
}

function stage(opts: StageOptions = {}): Stage {
  const root = tempDir('deploy-live-');
  const origin = join(root, 'origin.git');
  const work = join(root, 'ownpace-live');
  const compose = join(work, 'deploy', 'compose');
  const commit: Record<string, string> = {};

  git(root, root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, root, 'init', '-q', '-b', 'main', work);
  git(root, work, 'remote', 'add', 'origin', origin);

  // The running release: the script under test, what it sources, the real
  // managed.yml and www.yml, one file in each migration chain, and the
  // stand-ins. site/dist is ignored, as the repository's .gitignore has it.
  writeFileSync(join(work, '.gitignore'), '.env\nsite/dist/\n');
  writeFileSync(join(work, 'package.json'), packageJson(RUNNING.version));
  mkdirSync(compose, { recursive: true });
  for (const f of [SCRIPT, 'env-read.sh', 'stack-kind.sh', 'own-addresses.sh', 'www-live.sh']) {
    // A helper the script does not source yet is simply not there.
    if (!existsSync(join(COMPOSE_DIR, f))) continue;
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    chmodSync(join(compose, f), 0o755);
  }
  copyFileSync(join(COMPOSE_DIR, 'managed.yml'), join(compose, 'managed.yml'));
  writeFileSync(join(compose, 'www.yml'), wwwYml());
  writeExec(join(compose, 'bootstrap-managed.sh'), BOOTSTRAP_STUB);
  writeExec(join(compose, 'exposure-check.sh'), EXPOSURE_STUB);
  const siteDir = join(work, 'site');
  writeExec(join(siteDir, 'build.mjs'), SITE_BUILD_STUB);
  writeFileSync(join(siteDir, 'drafts'), '0\n');
  mkdirSync(join(work, 'packages', 'ledger', 'migrations'), { recursive: true });
  mkdirSync(join(work, 'packages', 'managed', 'migrations'), { recursive: true });
  writeFileSync(join(work, 'packages', 'ledger', 'migrations', '0001_first.sql'), 'SELECT 1;\n');
  writeFileSync(join(work, 'packages', 'managed', 'migrations', '0001_managed.sql'), 'SELECT 1;\n');
  git(root, work, 'add', '-A');
  git(root, work, 'commit', '-q', '-m', 'the running release');
  git(root, work, 'tag', '-a', RUNNING.tag, '-m', `Ownpace ${RUNNING.tag}`);
  commit[RUNNING.tag] = git(root, work, 'rev-parse', 'HEAD');
  git(root, work, 'push', '-q', 'origin', 'main', `refs/tags/${RUNNING.tag}`);

  for (const r of opts.releases ?? []) {
    writeFileSync(join(work, 'package.json'), packageJson(r.version ?? r.tag.replace(/^v/, '')));
    if (r.ledger) writeFileSync(join(work, 'packages', 'ledger', 'migrations', r.ledger), 'SELECT 2;\n');
    if (r.managed) writeFileSync(join(work, 'packages', 'managed', 'migrations', r.managed), 'SELECT 2;\n');
    let yml = readFileSync(join(compose, 'managed.yml'), 'utf8');
    if (r.trigger) yml = movePin(yml, 'trigger', r.trigger);
    if (r.zitadel) yml = movePin(yml, 'zitadel', r.zitadel);
    writeFileSync(join(compose, 'managed.yml'), yml);
    if (r.noExposureCheck) rmSync(join(compose, 'exposure-check.sh'));
    writeFileSync(join(compose, 'www.yml'), wwwYml(r.fixedSiteName));
    if (r.realSite) {
      rmSync(siteDir, { recursive: true, force: true });
      cpSync(join(REPO_ROOT, 'site'), siteDir, {
        recursive: true,
        filter: (src) => !/[\\/]site[\\/]dist(?:[\\/]|$)/.test(src),
      });
    } else {
      writeExec(join(siteDir, 'build.mjs'), SITE_BUILD_STUB);
      writeFileSync(join(siteDir, 'drafts'), `${r.siteDrafts ?? 0}\n`);
      rmSync(join(siteDir, 'refuses'), { force: true });
      if (r.siteRefuses) writeFileSync(join(siteDir, 'refuses'), `${r.siteRefuses}\n`);
      if (r.noSite) rmSync(join(siteDir, 'build.mjs'));
    }
    // A release always changes something, so that it is a commit of its own.
    writeFileSync(join(work, 'RELEASE'), `${r.tag}\n`);
    git(root, work, 'add', '-A');
    git(root, work, 'commit', '-q', '-m', `release ${r.tag}`);
    if (r.lightweight) git(root, work, 'tag', r.tag);
    else git(root, work, 'tag', '-a', r.tag, '-m', `Ownpace ${r.tag}`);
    commit[r.tag] = git(root, work, 'rev-parse', 'HEAD');
    git(root, work, 'push', '-q', 'origin', 'main');
    if (r.push !== false) git(root, work, 'push', '-q', 'origin', `refs/tags/${r.tag}`);
  }

  git(root, work, 'checkout', '-q', '--detach', `refs/tags/${opts.checkout ?? RUNNING.tag}`);
  writeFileSync(join(compose, '.env'), opts.dotEnv ?? LIVE_ENV);

  const bin = join(root, 'bin');
  writeExec(join(bin, 'docker'), DOCKER_STUB);
  writeExec(join(bin, 'psql'), PSQL_STUB(process.execPath));
  writeExec(join(bin, 'curl'), CURL_STUB);
  writeExec(join(bin, 'pnpm'), PNPM_STUB);

  const log = join(root, 'calls.log');
  const sqlLog = join(root, 'sql.log');
  writeFileSync(log, '');
  writeFileSync(sqlLog, '');
  const http = join(root, 'http');
  mkdirSync(http);

  const persist = join(root, '.persistent', 'ownpace-live');
  const deployLog = join(persist, 'deploys.log');
  const siteUp = join(root, 'site-is-up');

  const env: NodeJS.ProcessEnv = {
    ...gitEnv(root),
    PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
    STUB_LOG: log,
    STUB_SQL_LOG: sqlLog,
    STUB_HTTP: http,
    STUB_SITE_UP: siteUp,
    STUB_SITE_DIST: join(work, 'site', 'dist'),
    // A superuser, one open hold fifteen minutes old, nothing in flight.
    STUB_PSQL_ANSWER: 'yes|1|900|0\n',
    DEPLOY_LIVE_CHECK_TRIES: '1',
    DEPLOY_LIVE_CHECK_INTERVAL: '0',
    DEPLOY_LIVE_SITE_WAIT: '0',
  };
  const s: Stage = { root, work, compose, log, sqlLog, http, deployLog, siteUp, env, commit };

  // The app answers as the next release, when there is one.
  const next = opts.releases?.[0];
  if (next) {
    answer(s, '/api/version', 200, { version: next.version ?? next.tag.replace(/^v/, ''), commit: commit[next.tag] });
  }
  answer(s, '/api/ready', 200, { status: 'ok', database: 'up', signIn: 'up' });
  answer(s, '/api/auth/mode', 200, { mode: 'managed', acceptsSeedToken: false });
  return s;
}

function answer(s: Stage, path: string, code: number, body: unknown): void {
  const name = path.replace(/^\//, '').replace(/\//g, '_');
  writeFileSync(join(s.http, `${name}.code`), String(code));
  writeFileSync(join(s.http, `${name}.body`), typeof body === 'string' ? body : JSON.stringify(body));
}

function silence(s: Stage, path: string): void {
  const name = path.replace(/^\//, '').replace(/\//g, '_');
  rmSync(join(s.http, `${name}.code`), { force: true });
}

function run(s: Stage, args: string[], extra: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(join(s.compose, SCRIPT), args, {
    encoding: 'utf8',
    env: { ...s.env, ...extra },
    cwd: s.work,
    timeout: 120_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const head = (s: Stage): string => git(s.root, s.work, 'rev-parse', 'HEAD');
const calls = (s: Stage): string[] => readFileSync(s.log, 'utf8').split('\n').filter(Boolean);
const called = (s: Stage, what: string): string[] => calls(s).filter((l) => l.startsWith(`${what} `));
const deployLines = (s: Stage): string[] =>
  existsSync(s.deployLog) ? readFileSync(s.deployLog, 'utf8').split('\n').filter(Boolean) : [];
const sqlSent = (s: Stage): string => readFileSync(s.sqlLog, 'utf8');

/** Nothing moved: the checkout, the stack and the log are as they were. */
function expectNothingChanged(s: Stage, out: string, docker: 'none' | 'reads' = 'none'): void {
  expect(head(s), `the checkout moved:\n${out}`).toBe(s.commit[RUNNING.tag]);
  expect(called(s, 'bootstrap'), 'the bring-up ran').toEqual([]);
  expect(called(s, 'pnpm'), 'dependencies were installed').toEqual([]);
  expect(called(s, 'curl'), 'the app was asked').toEqual([]);
  expect(called(s, 'exposure-check'), 'the exposure check ran').toEqual([]);
  expect(deployLines(s), 'a refusal is not a deploy, and is not logged as one').toEqual([]);
  if (docker === 'none') expect(called(s, 'docker'), 'docker was called before the refusal').toEqual([]);
  expect(sqlSent(s)).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
}

// ---------------------------------------------------------------------------
// Refused before anything changes
// ---------------------------------------------------------------------------

describe('a ref that is not a release is refused, and nothing changes', () => {
  it(
    'a branch name',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, ['main']);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain("'main' is not a tag");
      expect(r.out).toContain(RELEASE_SENTENCE);
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a commit',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [s.commit[NEXT.tag]!]);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('is not a tag');
      expect(r.out).toContain(RELEASE_SENTENCE);
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a name that is no tag here or on origin',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, ['v9.9.9']);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('v9.9.9');
      expect(r.out).toContain(RELEASE_SENTENCE);
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a lightweight tag (0146 T5)',
    () => {
      const s = stage({ releases: [{ ...NEXT, lightweight: true }] });
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/lightweight/);
      expect(r.out).toMatch(/annotated/);
      expect(r.out).toContain(RELEASE_SENTENCE);
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a tag that is not on origin (0146 T5)',
    () => {
      const s = stage({ releases: [{ ...NEXT, push: false }] });
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('not on origin');
      expect(r.out).toContain(RELEASE_SENTENCE);
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a tag whose name is not a release name',
    () => {
      const s = stage({ releases: [{ tag: 'alpha-2', version: '0.2.0-alpha.2' }] });
      const r = run(s, ['alpha-2']);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/does not start with v/);
      expect(r.out).toContain(RELEASE_SENTENCE);
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    "a tag whose package.json says another version, naming both (0146 T5)",
    () => {
      const s = stage({ releases: [{ ...NEXT, version: '0.2.0-alpha.1' }] });
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain("'0.2.0-alpha.1'");
      expect(r.out).toContain("'0.2.0-alpha.2'");
      expect(r.out).toContain('package.json');
      expect(r.out).toContain(RELEASE_SENTENCE);
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );
});

describe('a stack, a checkout or a moment that is not ready is refused, and nothing changes', () => {
  const NOT_LIVE = [
    ['no marker at all', LIVE_ENV.replace('STACK_KIND=production\n', '')],
    ['a kind that is not live', LIVE_ENV.replace('STACK_KIND=production', 'STACK_KIND=staging-q7')],
    ['the marker commented out', LIVE_ENV.replace('STACK_KIND=production', '# STACK_KIND=production')],
    ['the marker indented, which the reader does not read', LIVE_ENV.replace('STACK_KIND=production', '  STACK_KIND=production')],
  ] as const;

  it.each(NOT_LIVE)(
    "a .env without live's marker: %s",
    (_label, dotEnv) => {
      const s = stage({ releases: [NEXT], dotEnv });
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('STACK_KIND');
      expect(r.out, "the file's own value is never printed").not.toContain('staging-q7');
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a .env with no WEB_URL, the origin the checks ask',
    () => {
      const s = stage({ releases: [NEXT], dotEnv: LIVE_ENV.replace(`WEB_URL=https://${APP_HOST}\n`, '') });
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('WEB_URL');
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a working tree with a changed file',
    () => {
      const s = stage({ releases: [NEXT] });
      writeFileSync(join(s.work, 'package.json'), packageJson('0.2.0-alpha.9'));
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('not clean');
      expect(r.out).toContain('package.json');
      // Put back, so that the rest of the check reads the checkout as it was.
      git(s.root, s.work, 'checkout', '-q', '--', 'package.json');
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a working tree with a file git does not know',
    () => {
      const s = stage({ releases: [NEXT] });
      writeFileSync(join(s.work, 'stray.txt'), 'left behind\n');
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('not clean');
      expect(r.out).toContain('stray.txt');
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it.each([[['--with-demo']], [[NEXT.tag, '--with-demo']], [['--with-demo', NEXT.tag]]])(
    '--with-demo, wherever it stands: %j',
    (args) => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, args);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('refused: --with-demo');
      expect(r.out).toMatch(/never has the demo/);
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a shell that points Compose at another env file',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { COMPOSE_ENV_FILES: join(s.root, 'other.env') });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('COMPOSE_ENV_FILES');
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a shell that points Compose at another compose file',
    () => {
      // The docker stub ignores COMPOSE_FILE, as the script's own `-f` would
      // not: without this refusal the deploy goes through.
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { COMPOSE_FILE: join(s.root, 'other', 'managed.yml') });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('this shell has COMPOSE_FILE set');
      expectNothingChanged(s, r.out);
    },
    CASE_MS,
  );

  it(
    'a project Compose reports that is not the one this checkout chooses, asked before the database',
    () => {
      // Whatever the reader did not see, Compose answering for the OTA
      // stack's project means the database read would go there.
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_PROJECT: 'ownpace-managed' });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain("docker compose reports the project 'ownpace-managed', and this checkout chooses 'ownpace-live'");
      expect(called(s, 'docker')).toEqual([
        `docker compose -f ${join(s.compose, 'managed.yml')} --env-file ${join(s.compose, '.env')} config`,
      ]);
      expect(called(s, 'psql'), 'the database was read').toEqual([]);
      expectNothingChanged(s, r.out, 'reads');
    },
    CASE_MS,
  );

  it(
    'no open hold',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_PSQL_ANSWER: 'yes|0|-1|0\n' });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/no hold is open/);
      expectNothingChanged(s, r.out, 'reads');
    },
    CASE_MS,
  );

  it(
    'passes still in flight',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_PSQL_ANSWER: 'yes|1|900|3\n' });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/3 pass\(es\) still in flight/);
      expectNothingChanged(s, r.out, 'reads');
    },
    CASE_MS,
  );

  it(
    'a hold so new that a pass queued before it may not have started',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_PSQL_ANSWER: 'yes|1|60|0\n' });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/the hold began 1 minute\(s\) ago/);
      expectNothingChanged(s, r.out, 'reads');
    },
    CASE_MS,
  );

  it.each([
    ['psql fails', { STUB_PSQL_FAIL: '1' }],
    ['psql answers nothing', { STUB_PSQL_ANSWER: '' }],
    ['psql answers something else', { STUB_PSQL_ANSWER: 'yes|1|900|?\n' }],
  ] as const)(
    'a database it cannot read is never taken for "nothing in flight": %s',
    (_label, extra) => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { ...extra });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/could not read/);
      expectNothingChanged(s, r.out, 'reads');
    },
    CASE_MS,
  );

  it(
    'a role that row security would bind, which would count no pass at all',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_PSQL_ANSWER: 'no|1|900|0\n' });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/superuser/);
      expectNothingChanged(s, r.out, 'reads');
    },
    CASE_MS,
  );

  it(
    'a deploy log it cannot append to, which would leave a deploy nobody could read back',
    () => {
      const s = stage({ releases: [NEXT] });
      // A directory under a file: mkdir cannot make it, whoever runs this.
      const r = run(s, [NEXT.tag], { MANAGED_ENV_PERSIST_DIR: join(s.log, 'persist') });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toMatch(/cannot be appended to/);
      expect(r.out).toContain('MANAGED_ENV_PERSIST_DIR');
      expectNothingChanged(s, r.out, 'reads');
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// The deploy
// ---------------------------------------------------------------------------

describe('a deploy that took', () => {
  it(
    'checks out the tag, brings it up without the demo, checks it, logs it, and leaves the hold on',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).toBe(0);
      const tagCommit = s.commit[NEXT.tag]!;

      // The checkout: detached at the tag's commit (T6 step 5).
      expect(head(s)).toBe(tagCommit);
      expect(git(s.root, s.work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');

      // Dependencies for the tag, then the bring-up from `data`, never with the
      // demo, with the tag's commit checked out, so the images carry it as
      // GIT_SHA (T6 step 6, 0146 T5).
      expect(called(s, 'pnpm')).toEqual(['pnpm install --frozen-lockfile']);
      expect(called(s, 'bootstrap')).toEqual([`bootstrap --from data head=${tagCommit}`]);
      const order = calls(s).map((l) => l.split(' ')[0]);
      expect(order.indexOf('pnpm')).toBeLessThan(order.indexOf('bootstrap'));

      // The checks, at the origin in WEB_URL (T6 step 7).
      expect(called(s, 'curl')).toEqual([
        `curl https://${APP_HOST}/api/version`,
        `curl https://${APP_HOST}/api/ready`,
        `curl https://${APP_HOST}/api/auth/mode`,
      ]);
      expect(called(s, 'exposure-check')).toEqual([`exposure-check --env-file ${join(s.compose, '.env')}`]);
      expect(r.out).toMatch(/the deploy took/);
      expect(r.out).toMatch(/NODE_ENV/);

      // The hold stays on: step 8 is the owner's, after looking.
      expect(r.out).toMatch(/The hold is still on/);
      expect(sqlSent(s)).toMatch(/platform_pause/);
      expect(sqlSent(s)).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);

      // One line in the deploy log (T6 step 9), under ~/.persistent/<project>.
      const lines = deployLines(s);
      expect(lines).toHaveLength(1);
      const fields = lines[0]!.split('\t');
      expect(fields).toHaveLength(5);
      expect(fields[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      expect(fields.slice(1)).toEqual([NEXT.tag, tagCommit, 'took', 'reversible']);

      // No address from the .env in what it printed.
      expect(r.out).not.toContain(APP_HOST);
    },
    CASE_MS,
  );

  it(
    'says so when the deploy left the working tree changed, which the next deploy would refuse',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_BOOTSTRAP_DIRTIES: '1' });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/NOTE: the deploy left the working tree changed/);
      expect(r.out).toContain('RELEASE');
      // And the next deploy does refuse it.
      const again = run(s, [NEXT.tag]);
      expect(again.status, again.out).not.toBe(0);
      expect(again.out).toContain('not clean');
    },
    CASE_MS,
  );

  it(
    'a second deploy after it reads the first from the log',
    () => {
      const NEXT3 = { tag: 'v0.2.0-alpha.3', version: '0.2.0-alpha.3' };
      const s = stage({ releases: [NEXT, NEXT3] });
      expect(run(s, [NEXT.tag]).status).toBe(0);
      answer(s, '/api/version', 200, { version: NEXT3.version, commit: s.commit[NEXT3.tag] });
      const r = run(s, [NEXT3.tag]);
      expect(r.status, r.out).toBe(0);
      expect(head(s)).toBe(s.commit[NEXT3.tag]);
      expect(r.out).toContain(NEXT.tag);
      expect(deployLines(s).map((l) => l.split('\t').slice(1, 4).join(' '))).toEqual([
        `${NEXT.tag} ${s.commit[NEXT.tag]} took`,
        `${NEXT3.tag} ${s.commit[NEXT3.tag]} took`,
      ]);
    },
    CASE_MS,
  );
});

describe('a deploy that did not take keeps the hold and exits non-zero', () => {
  type Breakage = (s: Stage) => NodeJS.ProcessEnv | void;
  const BREAKAGES: Array<[string, Breakage, RegExp]> = [
    [
      '/api/version names the right commit and another version (0146 T5)',
      (s) => answer(s, '/api/version', 200, { version: '0.2.0-alpha.1', commit: s.commit[NEXT.tag] }),
      /version '0\.2\.0-alpha\.1'/,
    ],
    [
      '/api/version names another commit',
      (s) => answer(s, '/api/version', 200, { version: NEXT.version, commit: s.commit[RUNNING.tag] }),
      /commit/,
    ],
    [
      '/api/version answers unknown',
      (s) => answer(s, '/api/version', 200, { version: NEXT.version, commit: 'unknown' }),
      /commit/,
    ],
    ['/api/version is not reachable', (s) => silence(s, '/api/version'), /\/api\/version/],
    ['/api/ready answers 503', (s) => answer(s, '/api/ready', 503, { status: 'down' }), /\/api\/ready/],
    [
      '/api/auth/mode answers another mode',
      (s) => answer(s, '/api/auth/mode', 200, { mode: 'dev', acceptsSeedToken: true }),
      /\/api\/auth\/mode/,
    ],
    ['the exposure check finds a port', () => ({ STUB_EXPOSURE_EXIT: '1' }), /exposure/],
    ['the bring-up fails', () => ({ STUB_BOOTSTRAP_EXIT: '1' }), /bootstrap-managed\.sh/],
    ['the bring-up stops for the owner', () => ({ STUB_BOOTSTRAP_EXIT: '2' }), /bootstrap-managed\.sh/],
    ['the dependencies do not install', () => ({ STUB_PNPM_EXIT: '1' }), /pnpm install/],
  ];

  it.each(BREAKAGES)(
    '%s',
    (_label, breakage, why) => {
      const s = stage({ releases: [NEXT] });
      const extra = breakage(s) ?? {};
      const r = run(s, [NEXT.tag], extra);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/the deploy did not take/);
      expect(r.out).toMatch(why);
      expect(r.out).toMatch(/The hold stays on/);
      expect(r.out).not.toMatch(/the deploy took/);
      expect(sqlSent(s)).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
      const lines = deployLines(s);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.split('\t').slice(1)).toEqual([NEXT.tag, s.commit[NEXT.tag], 'did-not-take', 'reversible']);
      expect(r.out).not.toContain(APP_HOST);
    },
    CASE_MS,
  );

  it(
    'a tag without the exposure check cannot pass it',
    () => {
      const s = stage({ releases: [{ ...NEXT, noExposureCheck: true }] });
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/the deploy did not take/);
      expect(r.out).toMatch(/exposure-check\.sh/);
    },
    CASE_MS,
  );

  it(
    'a bring-up that stops before the checks asks nothing of the app',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_BOOTSTRAP_EXIT: '1' });
      expect(r.status, r.out).not.toBe(0);
      expect(called(s, 'curl')).toEqual([]);
      expect(called(s, 'exposure-check')).toEqual([]);
    },
    CASE_MS,
  );
});

describe('a deploy log that cannot be written at the end changes neither the exit nor what it says', () => {
  // The log was writable when the script checked, before the checkout; the
  // bring-up stand-in makes its directory a file, as a full or lost disk
  // might. Exit 1 would say "refused, the checkout and the stack as they
  // were", which is false once the checkout has moved.
  it(
    'a deploy that took still says so, exits 0, keeps the hold, and prints the line to add by hand',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_BREAK_LOG_DIR: dirname(s.deployLog) });
      expect(r.status, r.out).toBe(0);
      expect(called(s, 'bootstrap')).toHaveLength(1);
      expect(r.out).toMatch(/the deploy took/);
      expect(r.out).toMatch(/The hold is still on/);
      expect(r.out).toMatch(/could not append to/);
      expect(r.out).toContain([NEXT.tag, s.commit[NEXT.tag], 'took', 'reversible'].join('\t'));
    },
    CASE_MS,
  );

  it(
    'a deploy that did not take still says so and which check failed, exits 3, and keeps the hold',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_BREAK_LOG_DIR: dirname(s.deployLog), STUB_EXPOSURE_EXIT: '1' });
      expect(r.status, r.out).toBe(3);
      expect(r.out).toMatch(/the deploy did not take/);
      expect(r.out).toMatch(/the exposure check did not pass/);
      expect(r.out).toMatch(/The hold stays on/);
      expect(r.out).toMatch(/could not append to/);
      expect(r.out).toContain([NEXT.tag, s.commit[NEXT.tag], 'did-not-take', 'reversible'].join('\t'));
      expect(r.out).not.toMatch(/the deploy took/);
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// One-way or reversible (0146 T5)
// ---------------------------------------------------------------------------

describe('before the hold is lifted it says whether the deploy can be undone (0146 T5)', () => {
  it(
    'no migration file and no pin moved: reversible',
    () => {
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/reversible/);
      expect(r.out).not.toMatch(/one-way/);
      expect(r.out).toContain(RUNNING.tag);
    },
    CASE_MS,
  );

  const ONE_WAY: Array<[string, Release, RegExp]> = [
    ['a migration file in the shared chain', { ...NEXT, ledger: '0002_a_column.sql' }, /packages\/ledger\/migrations\/0002_a_column\.sql/],
    ['a migration file in the managed chain', { ...NEXT, managed: '0002_a_table.sql' }, /packages\/managed\/migrations\/0002_a_table\.sql/],
    ['the Trigger.dev pin moved', { ...NEXT, trigger: 'v4.9.9' }, /Trigger\.dev[\s\S]*v4\.9\.9/],
    ['the identity provider pin moved', { ...NEXT, zitadel: 'v4.99.1' }, /identity provider[\s\S]*v4\.99\.1/],
  ];

  it.each(ONE_WAY)(
    '%s: one-way',
    (_label, release, names) => {
      const s = stage({ releases: [release] });
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/one-way/);
      expect(r.out).not.toMatch(/\breversible\b/);
      expect(r.out).toMatch(names);
      expect(deployLines(s)[0]!.split('\t')[4]).toBe('one-way');
    },
    CASE_MS,
  );

  it(
    'the running tag is the last deploy that took, not only what a deploy that did not take left checked out',
    () => {
      // alpha.2 added a migration and did not take; the checkout holds it.
      // Deploying alpha.3, which adds nothing over alpha.2, is still one-way
      // over alpha.1, the tag that is running.
      const NEXT3 = { tag: 'v0.2.0-alpha.3', version: '0.2.0-alpha.3' };
      const s = stage({ releases: [{ ...NEXT, ledger: '0002_a_column.sql' }, NEXT3], checkout: NEXT.tag });
      answer(s, '/api/version', 200, { version: NEXT3.version, commit: s.commit[NEXT3.tag] });
      mkdirSync(dirname(s.deployLog), { recursive: true });
      writeFileSync(
        s.deployLog,
        `2026-09-27T10:00:00Z\t${RUNNING.tag}\t${s.commit[RUNNING.tag]}\ttook\treversible\n` +
          `2026-09-28T10:00:00Z\t${NEXT.tag}\t${s.commit[NEXT.tag]}\tdid-not-take\tone-way\n`,
      );

      const r = run(s, [NEXT3.tag]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/one-way/);
      expect(r.out).toContain('0002_a_column.sql');
      expect(r.out).toContain(RUNNING.tag);
    },
    CASE_MS,
  );

  /** Deploy `tag` with the app answering as it, and return the run. */
  const deployAs = (s: Stage, rel: { tag: string; version: string }, extra: NodeJS.ProcessEnv = {}) => {
    answer(s, '/api/version', 200, { version: rel.version, commit: s.commit[rel.tag] });
    return run(s, [rel.tag], extra);
  };
  const logged = (s: Stage): string[] => deployLines(s).map((l) => l.split('\t').slice(1).join(' '));

  it(
    'and a deploy that did not take since: A took, B with a migration did not take after its bring-up ran, and A again is one-way',
    () => {
      // B's API applied 0002 when it started; the exposure check failed after.
      // Going back to A meets a database A's API refuses (migrate.ts).
      const s = stage({ releases: [{ ...NEXT, ledger: '0002_a_column.sql' }] });
      expect(deployAs(s, RUNNING).status).toBe(0);
      const b = deployAs(s, NEXT, { STUB_EXPOSURE_EXIT: '1' });
      expect(b.status, b.out).toBe(3);
      expect(called(s, 'bootstrap')).toHaveLength(2);

      const r = deployAs(s, RUNNING);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/one-way/);
      expect(r.out).not.toMatch(/\breversible\b/);
      expect(r.out).toContain('packages/ledger/migrations/0002_a_column.sql');
      // Both are named: the release that took, and the one that did not.
      expect(r.out).toContain(`${RUNNING.tag}: the last deploy that took`);
      expect(r.out).toContain(`${NEXT.tag}: a deploy that did not take`);
      expect(logged(s)).toEqual([
        `${RUNNING.tag} ${s.commit[RUNNING.tag]} took reversible`,
        `${NEXT.tag} ${s.commit[NEXT.tag]} did-not-take one-way`,
        `${RUNNING.tag} ${s.commit[RUNNING.tag]} took one-way`,
      ]);
    },
    CASE_MS,
  );

  it(
    'every deploy that did not take since, not only the one checked out: A took, B with a migration and then C without it did not take, and A again is one-way over B',
    () => {
      // alpha.2 adds nothing; alpha.3 adds a migration. Deployed alpha.3 and
      // then alpha.2, the checkout ends at a tag without it.
      const THREE = { tag: 'v0.2.0-alpha.3', version: '0.2.0-alpha.3' };
      const s = stage({ releases: [NEXT, { ...THREE, ledger: '0002_a_column.sql' }] });
      expect(deployAs(s, RUNNING).status).toBe(0);
      expect(deployAs(s, THREE, { STUB_EXPOSURE_EXIT: '1' }).status).toBe(3);
      expect(deployAs(s, NEXT, { STUB_EXPOSURE_EXIT: '1' }).status).toBe(3);
      expect(head(s)).toBe(s.commit[NEXT.tag]);

      const r = deployAs(s, RUNNING);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/one-way/);
      expect(r.out).not.toMatch(/\breversible\b/);
      expect(r.out).toContain('0002_a_column.sql');
      expect(r.out).toContain(`over ${THREE.tag}`);
      expect(deployLines(s).at(-1)!.split('\t')[4]).toBe('one-way');
    },
    CASE_MS,
  );

  it(
    'and the checkout, when no line names it: A took, B with a migration checked out by hand, and A again is one-way over B',
    () => {
      // The procedures before this script checked out and brought up by hand.
      const s = stage({ releases: [{ ...NEXT, ledger: '0002_a_column.sql' }], checkout: NEXT.tag });
      mkdirSync(dirname(s.deployLog), { recursive: true });
      writeFileSync(s.deployLog, `2026-09-27T10:00:00Z\t${RUNNING.tag}\t${s.commit[RUNNING.tag]}\ttook\treversible\n`);
      const r = deployAs(s, RUNNING);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/one-way/);
      expect(r.out).not.toMatch(/\breversible\b/);
      expect(r.out).toContain(`${NEXT.tag}: this checkout's HEAD`);
      expect(r.out).toContain('removes packages/ledger/migrations/0002_a_column.sql');
    },
    CASE_MS,
  );

  it(
    'with no deploy that took in the log, and the first that did not one-way over what ran before it, retrying it is one-way',
    () => {
      // A first deploy on live can fail a check: the exposure check, say,
      // before EXPOSURE_ALLOW in live's .env names every address published
      // on purpose. What ran before the first is in no line of the log.
      const s = stage({ releases: [{ ...NEXT, ledger: '0002_a_column.sql' }] });
      const b = deployAs(s, NEXT, { STUB_EXPOSURE_EXIT: '1' });
      expect(b.status, b.out).toBe(3);
      expect(b.out).toContain('packages/ledger/migrations/0002_a_column.sql');

      const r = deployAs(s, NEXT);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/one-way/);
      expect(r.out).not.toMatch(/\breversible\b/);
      expect(r.out).toMatch(/deploys\.log does not name it/);
      expect(logged(s)).toEqual([
        `${NEXT.tag} ${s.commit[NEXT.tag]} did-not-take one-way`,
        `${NEXT.tag} ${s.commit[NEXT.tag]} took one-way`,
      ]);
    },
    CASE_MS,
  );

  it(
    'with no deploy that took in the log, and the first that did not reversible over what ran before it, retrying it is reversible',
    () => {
      const s = stage({ releases: [NEXT] });
      expect(deployAs(s, NEXT, { STUB_EXPOSURE_EXIT: '1' }).status).toBe(3);
      const r = deployAs(s, NEXT);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/reversible/);
      expect(r.out).not.toMatch(/one-way/);
      expect(logged(s)).toEqual([
        `${NEXT.tag} ${s.commit[NEXT.tag]} did-not-take reversible`,
        `${NEXT.tag} ${s.commit[NEXT.tag]} took reversible`,
      ]);
    },
    CASE_MS,
  );

  it('compares the two chains and the two pins the repository has', () => {
    // Vacuity: a list naming a directory that is not there compares nothing,
    // and every deploy would come out reversible.
    const script = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8');
    const chains = /^MIGRATION_CHAINS=\(([^)]*)\)$/m.exec(script)?.[1]?.trim().split(/\s+/) ?? [];
    expect(chains.sort()).toEqual(['packages/ledger/migrations', 'packages/managed/migrations']);
    for (const chain of chains) {
      expect(readdirSync(join(REPO_ROOT, chain)).filter((f) => f.endsWith('.sql')).length, chain).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// A dry run: every refusal, the verdict, and nothing moved
// ---------------------------------------------------------------------------

describe('a dry run refuses what the deploy refuses, says one-way or reversible, and moves nothing', () => {
  /** What a dry run must leave as it found it. */
  interface Before {
    head: string;
    tree: string;
    log: string | null;
    logDir: boolean;
    calls: number;
    sql: number;
  }
  const tree = (s: Stage): string => git(s.root, s.work, 'status', '--porcelain', '--untracked-files=all');
  const before = (s: Stage): Before => ({
    head: head(s),
    tree: tree(s),
    log: existsSync(s.deployLog) ? readFileSync(s.deployLog, 'utf8') : null,
    logDir: existsSync(dirname(s.deployLog)),
    calls: calls(s).length,
    sql: sqlSent(s).length,
  });
  function expectMovedNothing(s: Stage, was: Before, out: string): void {
    expect(head(s), `the checkout moved:\n${out}`).toBe(was.head);
    expect(tree(s), 'the working tree changed').toBe(was.tree);
    expect(existsSync(s.deployLog) ? readFileSync(s.deployLog, 'utf8') : null, 'the deploy log changed').toBe(was.log);
    expect(existsSync(dirname(s.deployLog)), "the deploy log's directory was made").toBe(was.logDir);
    const since = calls(s).slice(was.calls);
    for (const what of ['bootstrap', 'pnpm', 'curl', 'exposure-check']) {
      expect(
        since.filter((l) => l.startsWith(`${what} `)),
        `${what} ran during a dry run`,
      ).toEqual([]);
    }
    expect(sqlSent(s).slice(was.sql)).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
    expect(out).not.toMatch(/checking out|the deploy took|the deploy did not take/);
  }
  const STOPPED = /dry run: stopped before the checkout\. Nothing was checked out, installed, built or deployed/;

  it.each([[['--dry-run', NEXT.tag]], [[NEXT.tag, '--dry-run']]])(
    'on a tag that agrees, %j: every refusal passed, the verdict, a line that nothing moved, exit 0; the checkout, the tree and the log as they were, and no bring-up',
    (args) => {
      const s = stage({ releases: [NEXT] });
      const was = before(s);
      const r = run(s, args);
      expect(r.status, r.out).toBe(0);
      // It got as far as the real run does before the checkout.
      expect(r.out).toContain(`${NEXT.tag} is an annotated release tag on origin, at ${s.commit[NEXT.tag]}`);
      expect(r.out).toMatch(/the hold is on and nothing is in flight/);
      expect(sqlSent(s)).toMatch(/platform_pause/);
      // The verdict, compared with what runs, by the same function.
      expect(r.out).toContain(`${RUNNING.tag}: this checkout's HEAD`);
      expect(r.out).toContain(`dry run: a deploy of ${NEXT.tag} now would be reversible.`);
      expect(r.out).not.toMatch(/one-way/);
      expect(r.out).toMatch(STOPPED);
      expect(r.out).toContain('without --dry-run');
      expectMovedNothing(s, was, r.out);
      expect(existsSync(s.deployLog), 'a dry run made the deploy log').toBe(false);
      expect(called(s, 'bootstrap')).toEqual([]);
      expect(r.out).not.toContain(APP_HOST);
    },
    CASE_MS,
  );

  it(
    'after a deploy that took: compared with it from the log, and the log, the checkout and the bring-up count as they were',
    () => {
      const NEXT3 = { tag: 'v0.2.0-alpha.3', version: '0.2.0-alpha.3' };
      const s = stage({ releases: [NEXT, { ...NEXT3, managed: '0002_a_table.sql' }] });
      expect(run(s, [NEXT.tag]).status).toBe(0);
      expect(called(s, 'bootstrap')).toHaveLength(1);
      const was = before(s);
      expect(was.log).not.toBeNull();

      const r = run(s, ['--dry-run', NEXT3.tag]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain(`${NEXT.tag}: the last deploy that took (deploys.log)`);
      expect(r.out).toContain(`over ${NEXT.tag}, ${NEXT3.tag}`);
      expect(r.out).toContain('adds packages/managed/migrations/0002_a_table.sql');
      expect(r.out).toContain(`dry run: a deploy of ${NEXT3.tag} now would be one-way.`);
      expect(r.out).toMatch(STOPPED);
      expectMovedNothing(s, was, r.out);
      expect(head(s)).toBe(s.commit[NEXT.tag]);
      expect(called(s, 'bootstrap')).toHaveLength(1);
    },
    CASE_MS,
  );

  type Setup = {
    releases?: Release[];
    dotEnv?: string;
    extra?: (s: Stage) => NodeJS.ProcessEnv;
    prep?: (s: Stage) => void;
    args?: string[];
  };
  const REFUSED: Array<[string, Setup, RegExp]> = [
    ['no open hold', { extra: () => ({ STUB_PSQL_ANSWER: 'yes|0|-1|0\n' }) }, /no hold is open/],
    ['a pass still in flight', { extra: () => ({ STUB_PSQL_ANSWER: 'yes|1|900|3\n' }) }, /3 pass\(es\) still in flight/],
    ['a hold under five minutes old', { extra: () => ({ STUB_PSQL_ANSWER: 'yes|1|60|0\n' }) }, /the hold began 1 minute\(s\) ago/],
    ['a database it cannot read', { extra: () => ({ STUB_PSQL_FAIL: '1' }) }, /could not read the hold/],
    ['a role row security would bind', { extra: () => ({ STUB_PSQL_ANSWER: 'no|1|900|0\n' }) }, /not a superuser/],
    ['a lightweight tag', { releases: [{ ...NEXT, lightweight: true }] }, /is a lightweight tag/],
    ['a tag not on origin', { releases: [{ ...NEXT, push: false }] }, /is not on origin/],
    [
      "a tag whose package.json says another version",
      { releases: [{ ...NEXT, version: '0.2.0-alpha.1' }] },
      /the root package\.json at v0\.2\.0-alpha\.2 says version '0\.2\.0-alpha\.1'/,
    ],
    [
      "a .env without live's marker",
      { dotEnv: LIVE_ENV.replace('STACK_KIND=production\n', '') },
      /does not carry STACK_KIND=production/,
    ],
    ['a working tree that is not clean', { prep: (s) => writeFileSync(join(s.work, 'stray.txt'), 'x\n') }, /the working tree is not clean/],
    ['COMPOSE_FILE in the shell', { extra: (s) => ({ COMPOSE_FILE: join(s.root, 'other.yml') }) }, /this shell has COMPOSE_FILE set/],
    ['a project Compose reports differently', { extra: () => ({ STUB_PROJECT: 'ownpace-managed' }) }, /docker compose reports the project 'ownpace-managed'/],
    [
      'a deploy log it cannot append to',
      { extra: (s) => ({ MANAGED_ENV_PERSIST_DIR: join(s.log, 'persist') }) },
      /deploys\.log cannot be appended to/,
    ],
    ['--with-demo', { args: ['--with-demo'] }, /refused: --with-demo/],
  ];

  it.each(REFUSED)(
    'still refused in a dry run: %s',
    (_label, setup, why) => {
      const s = stage({ releases: setup.releases ?? [NEXT], ...(setup.dotEnv ? { dotEnv: setup.dotEnv } : {}) });
      setup.prep?.(s);
      const was = before(s);
      const r = run(s, ['--dry-run', NEXT.tag, ...(setup.args ?? [])], setup.extra?.(s) ?? {});
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('[deploy-live] refused: ');
      expect(r.out).toMatch(why);
      expect(r.out).not.toMatch(/would be (one-way|reversible)/);
      expect(r.out).not.toMatch(STOPPED);
      expectMovedNothing(s, was, r.out);
      expect(existsSync(s.deployLog), 'a refused dry run made the deploy log').toBe(false);
    },
    CASE_MS,
  );

  const VERDICTS: Array<[string, 'one-way' | 'reversible', Release, RegExp]> = [
    [
      'a tag that adds a migration to the shared chain',
      'one-way',
      { ...NEXT, ledger: '0002_a_column.sql' },
      /adds packages\/ledger\/migrations\/0002_a_column\.sql/,
    ],
    [
      'a tag that adds a migration to the managed chain',
      'one-way',
      { ...NEXT, managed: '0002_a_table.sql' },
      /adds packages\/managed\/migrations\/0002_a_table\.sql/,
    ],
    [
      'a tag that adds no migration and moves no pin',
      'reversible',
      NEXT,
      /over each of those, v0\.2\.0-alpha\.2 adds, changes or removes no migration file/,
    ],
  ];

  it.each(VERDICTS)(
    '%s: the dry run says %s, and the deploy after it logs the same',
    (_label, verdict, release, names) => {
      const s = stage({ releases: [release] });
      const was = before(s);
      const dry = run(s, ['--dry-run', NEXT.tag]);
      expect(dry.status, dry.out).toBe(0);
      expect(dry.out).toContain(`dry run: a deploy of ${NEXT.tag} now would be ${verdict}.`);
      expect(dry.out).not.toMatch(verdict === 'one-way' ? /\breversible\b/ : /one-way/);
      expect(dry.out).toMatch(names);
      if (verdict === 'one-way') {
        expect(dry.out).toMatch(/dump live's database now/);
      } else {
        expect(dry.out).not.toMatch(/dump live's database now/);
      }
      expect(dry.out).toMatch(STOPPED);
      expectMovedNothing(s, was, dry.out);

      // The deploy it stood in for comes to the same verdict.
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).toBe(0);
      expect(deployLines(s)).toHaveLength(1);
      expect(deployLines(s)[0]!.split('\t')[4]).toBe(verdict);
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// The database read, against the real schema
// ---------------------------------------------------------------------------

describe('the hold and the drain, read from a database with both chains applied', () => {
  let dataDir = '';
  const TENANT = 'd0000000-0000-4000-8000-000000000001';

  const withDb = async (fn: (db: PgliteLike) => Promise<void>) => {
    const db = new PGlite(dataDir, { extensions: { pgcrypto } });
    try {
      await fn(db);
    } finally {
      await db.close();
    }
  };

  /** The database as each case needs it: every hold and every run replaced. */
  const setState = (sql: string) =>
    withDb(async (db) => {
      await db.exec(`DELETE FROM run; DELETE FROM platform_pause; ${sql}`);
    });
  const HOLD_TEN_MINUTES = `
    INSERT INTO platform_pause (started_at, message, started_by)
      VALUES (now() - interval '10 minutes', 'We werken het platform bij.', 'owner-subject');`;

  beforeAll(async () => {
    dataDir = join(tempDir('deploy-live-db-'), 'pg');
    const driver = pgliteDriver({ dataDir });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await driver.end();
    await withDb(async (db) => {
      await db.exec(`INSERT INTO tenant (id, name) VALUES ('${TENANT}', 'A tester');`);
    });
  }, PGLITE_CASE_MS);

  it(
    'no hold: refused',
    async () => {
      await setState('');
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_PGLITE: dataDir });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/no hold is open/);
      expectNothingChanged(s, r.out, 'reads');
    },
    PGLITE_CASE_MS,
  );

  // Rows accumulate (managed migration 0023, "A log, not a switch"): after the
  // first hold is lifted, the table is never empty again.
  const LIFTED_TWO_HOURS_AGO = `
    INSERT INTO platform_pause (started_at, ended_at, message, started_by, ended_by)
      VALUES (now() - interval '3 hours', now() - interval '2 hours', 'We werkten het platform bij.',
              'owner-subject', 'owner-subject');`;

  it(
    'only a hold that was lifted: refused, as no hold at all',
    async () => {
      await setState(LIFTED_TWO_HOURS_AGO);
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_PGLITE: dataDir });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/no hold is open/);
      expectNothingChanged(s, r.out, 'reads');
    },
    PGLITE_CASE_MS,
  );

  it(
    'a hold lifted long ago and one opened two minutes ago: refused on the open one, as too new',
    async () => {
      // The state live is in before most deploys. It does not pin the age's
      // own `ended_at IS NULL`: while a hold is open, the partial unique index
      // (0023) means every lifted one began before it, so the newest
      // `started_at` of all rows is the open one's either way.
      await setState(`${LIFTED_TWO_HOURS_AGO}
        INSERT INTO platform_pause (started_at, message, started_by)
          VALUES (now() - interval '2 minutes', 'We werken het platform bij.', 'owner-subject');`);
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_PGLITE: dataDir });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/the hold began 2 minute\(s\) ago/);
      expectNothingChanged(s, r.out, 'reads');
    },
    PGLITE_CASE_MS,
  );

  it(
    'a hold ten minutes old and a pass that started five minutes ago: refused',
    async () => {
      await setState(`${HOLD_TEN_MINUTES}
        INSERT INTO run (tenant_id, kind, status, started_at)
          VALUES ('${TENANT}', 'incremental', 'running', now() - interval '5 minutes');`);
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_PGLITE: dataDir });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/1 pass\(es\) still in flight/);
      expectNothingChanged(s, r.out, 'reads');
    },
    PGLITE_CASE_MS,
  );

  it(
    "a `running` row older than the tick's window is a pass that died, and is not waited for",
    async () => {
      await setState(`${HOLD_TEN_MINUTES}
        INSERT INTO run (tenant_id, kind, status, started_at)
          VALUES ('${TENANT}', 'incremental', 'running', now() - interval '3 hours'),
                 ('${TENANT}', 'incremental', 'succeeded', now() - interval '5 minutes');`);
      const s = stage({ releases: [NEXT] });
      const r = run(s, [NEXT.tag], { STUB_PGLITE: dataDir });
      expect(r.status, r.out).toBe(0);
      expect(head(s)).toBe(s.commit[NEXT.tag]);
      // And the hold is still open in the database afterwards.
      await withDb(async (db) => {
        const res = (await db.exec(`SELECT count(*)::int AS n FROM platform_pause WHERE ended_at IS NULL`)) as Array<{
          rows: Array<{ n: number }>;
        }>;
        expect(res[0]!.rows[0]!.n).toBe(1);
      });
    },
    PGLITE_CASE_MS,
  );

  it(
    'counts a pass in flight with the same window the tick uses',
    async () => {
      // Importing the tick opens a Pool; it is never used here.
      process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/none';
      const { STALE_RUN_AFTER_MS } = await import('../apps/worker/src/jobs/managed-sync-tick.ts');
      const script = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8');
      const seconds = Number(/^STALE_RUN_AFTER_SECONDS=(\d+)$/m.exec(script)?.[1]);
      expect(seconds * 1000).toBe(STALE_RUN_AFTER_MS);
    },
    PGLITE_CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// The site: www.ownpace.eu, from the tag (workplan 0139 T10, with 0132 T6)
// ---------------------------------------------------------------------------

describe("the site, www.ownpace.eu: built from the tag and served as ownpace-live-www, only when live's .env switches it on (0139 T10)", () => {
  const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Every call the stubs recorded that is about the site. */
  const siteCalls = (s: Stage): string[] =>
    calls(s).filter(
      (l) =>
        l.startsWith('site-build ') ||
        /^docker (ps|inspect)\b/.test(l) ||
        l.includes(`-p ${SITE_PROJECT}`) ||
        l.startsWith('curl http://127.0.0.1'),
    );
  /** The site's own build in the checkout, not the test build in a directory of its own. */
  const buildsInCheckout = (s: Stage): string[] =>
    called(s, 'site-build').filter((l) => l.endsWith(`here=${join(s.work, 'site')}`));
  const broughtUp = (s: Stage): string[] => calls(s).filter((l) => l.includes(`-p ${SITE_PROJECT}`));
  const upLine = (s: Stage): string =>
    `docker compose -p ${SITE_PROJECT} -f ${join(s.compose, 'www.yml')} --env-file ${join(s.compose, '.env')} up -d --force-recreate`;
  /** An answer from the site on loopback, in place of what its site/dist holds. */
  const siteAnswer = (s: Stage, path: string, code: number, body: string): void => {
    const name = `site_${path.replace(/^\//, '').replace(/\//g, '_')}`;
    writeFileSync(join(s.http, `${name}.code`), String(code));
    writeFileSync(join(s.http, `${name}.body`), body);
  };
  const LIVE_WWW = /^docker ps -a --filter label=com\.docker\.compose\.project=ownpace-live --filter label=com\.docker\.compose\.service=www\b/;

  it.each([
    ['no WWW_LIVE at all', LIVE_ENV],
    ['WWW_LIVE=false', `${LIVE_ENV}WWW_LIVE=false\nWWW_PORT=${SITE_PORT}\nWWW_BIND=${SITE_BIND}\n`],
  ])(
    'switched off (%s): nothing about the site runs, and a tag with placeholders still deploys',
    (_label, dotEnv) => {
      const s = stage({ releases: [{ ...NEXT, siteDrafts: 22 }], dotEnv });
      const r = run(s, [NEXT.tag]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/the deploy took/);
      expect(siteCalls(s), 'the site was built, asked about or brought up').toEqual([]);
      expect(r.out).not.toMatch(/ownpace-live-www|WWW_|unfilled placeholder/);
      expect(existsSync(join(s.work, 'site', 'dist')), 'the site was built').toBe(false);
    },
    CASE_MS,
  );

  type SiteSetup = { dotEnv?: string; release?: Partial<Release>; extra?: NodeJS.ProcessEnv };
  const REFUSED: Array<[string, SiteSetup, RegExp]> = [
    ['no WWW_PORT', { dotEnv: SITE_ENV.replace(`WWW_PORT=${SITE_PORT}\n`, '') }, /WWW_PORT is not set/],
    ['no WWW_BIND', { dotEnv: SITE_ENV.replace(`WWW_BIND=${SITE_BIND}\n`, '') }, /WWW_BIND is not set/],
    ['a WWW_PORT that is not a port number', { dotEnv: SITE_ENV.replace(`WWW_PORT=${SITE_PORT}`, 'WWW_PORT=20x25') }, /WWW_PORT .*not one port number/],
    ['a switch that is neither true nor false', { dotEnv: SITE_ENV.replace('WWW_LIVE=true', 'WWW_LIVE=yes') }, /WWW_LIVE .*neither true nor false/],
    [
      "a www service in live's project (option 4)",
      { extra: { STUB_WWW_IN: 'ownpace-live:ownpace-live' } },
      /a container of ownpace-live has the compose service www: ownpace-live\b/,
    ],
    ['docker that cannot be asked', { extra: { STUB_DOCKER_PS_FAIL: '1' } }, /docker could not be asked/],
    ['a tag whose texts still have placeholders, naming the count', { release: { siteDrafts: 22 } }, /22 unfilled placeholder\(s\)/],
    [
      "a tag whose --public build refuses for another reason, though its --check counts 0: the full build's verdict, not the count's",
      { release: { siteRefuses: '--public makes this site indexable, and 4 legal page(s) say on their version line that they are a draft' } },
      /no unfilled placeholder, and its --public build refused it all the same[\s\S]*4 legal page\(s\) say on their version line that they are a draft|4 legal page\(s\) say on their version line that they are a draft[\s\S]*no unfilled placeholder, and its --public build refused it all the same/,
    ],
    ['a tag with no site', { release: { noSite: true } }, /site\/build\.mjs/],
    ["a tag whose www.yml gives the site's container a fixed name (before #1275)", { release: { fixedSiteName: true } }, /container_name/],
  ];

  it.each(REFUSED.flatMap(([label, setup, why]) => [[label, 'deploy', setup, why] as const, [label, 'dry run', setup, why] as const]))(
    'refused before the checkout: %s (%s)',
    (_label, mode, setup, why) => {
      const s = stage({ releases: [{ ...NEXT, ...setup.release }], dotEnv: setup.dotEnv ?? SITE_ENV });
      const r = run(s, mode === 'dry run' ? ['--dry-run', NEXT.tag] : [NEXT.tag], setup.extra ?? {});
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('[deploy-live] refused: ');
      expect(r.out).toMatch(why);
      expect(r.out).not.toMatch(/would be (one-way|reversible)/);
      expectNothingChanged(s, r.out, 'reads');
      expect(buildsInCheckout(s), 'the site was built in the checkout').toEqual([]);
      expect(broughtUp(s), 'the site was brought up').toEqual([]);
      // A refusal names the key, never the value.
      expect(r.out).not.toContain(SITE_BIND);
      expect(r.out).not.toContain(SITE_PORT);
      expect(r.out).not.toContain('20x25');
    },
    CASE_MS,
  );

  it(
    "the real site at this commit: a tag that carries it is refused with the count the site's own --check gives, or else with what its own --public build refuses, or passes when that build does",
    () => {
      const env = { PATH: process.env.PATH ?? '', OWNPACE_APP_URL: PUBLIC_APP };
      const check = spawnSync(process.execPath, ['site/build.mjs', '--public', '--check'], { cwd: REPO_ROOT, encoding: 'utf8', env });
      const count = Number(/, (\d+) unfilled placeholder\(s\)$/m.exec(check.stdout)?.[1] ?? NaN);
      expect(Number.isInteger(count), `site/build.mjs --public --check printed no count:\n${check.stdout}${check.stderr}`).toBe(true);
      // With no count, the full --public build decides, which writes site/dist:
      // run it on a copy, never in this checkout.
      let refusal: string | undefined;
      if (check.status === 0 && count === 0) {
        const scratch = mkdtempSync(join(tmpdir(), 'real-site-public-'));
        try {
          cpSync(join(REPO_ROOT, 'site'), join(scratch, 'site'), {
            recursive: true,
            filter: (src) => !/[\\/]site[\\/]dist(?:[\\/]|$)/.test(src),
          });
          copyFileSync(join(REPO_ROOT, 'package.json'), join(scratch, 'package.json'));
          const full = spawnSync(process.execPath, ['site/build.mjs', '--public'], { cwd: scratch, encoding: 'utf8', env });
          if (full.status !== 0) refusal = /^Error: (.+)$/m.exec(full.stderr)?.[1] ?? `exit ${full.status}`;
        } finally {
          rmSync(scratch, { recursive: true, force: true });
        }
      }
      const s = stage({ releases: [{ ...NEXT, realSite: true }], dotEnv: SITE_ENV });
      const r = run(s, ['--dry-run', NEXT.tag]);
      if (check.status !== 0) {
        // --check under --public refuses by itself: so does the dry run.
        expect(r.status, r.out).toBe(1);
        expect(r.out).toContain('did not build with --public --check');
      } else if (count > 0) {
        expect(r.status, r.out).toBe(1);
        expect(r.out).toContain(`has ${count} unfilled placeholder(s)`);
      } else if (refusal !== undefined) {
        expect(r.status, r.out).toBe(1);
        expect(r.out).toContain('its --public build refused it all the same');
        expect(r.out).toContain(refusal);
      } else {
        expect(r.status, r.out).toBe(0);
        expect(r.out).toContain('0 unfilled placeholder(s), and a --public build that passed');
      }
      expectNothingChanged(s, r.out, 'reads');
    },
    CASE_MS,
  );

  it(
    "switched on: the tag's site test-built before the checkout, then built in the checkout after the bring-up, brought up as ownpace-live-www with live's .env, found healthy and asked, all before the exposure check",
    () => {
      const s = stage({ releases: [NEXT], dotEnv: SITE_ENV });
      // A status address a shell exported for another site does not reach this build.
      const r = run(s, [NEXT.tag], { OWNPACE_STATUS_URL: 'https://status.ota.ownpace.eu' });
      expect(r.status, r.out).toBe(0);
      const tagCommit = s.commit[NEXT.tag]!;
      const log = calls(s);
      const at = (line: string | RegExp, what: string): number => {
        const i = log.findIndex((l) => (typeof line === 'string' ? l === line : line.test(l)));
        expect(i, `${what} is not in the calls:\n${log.join('\n')}`).toBeGreaterThanOrEqual(0);
        return i;
      };

      // Before the checkout: the tag's own site, from git's objects, in a
      // directory of its own that is gone afterwards: --check for the count,
      // then the full --public build the deploy runs after the checkout.
      const builds = called(s, 'site-build');
      expect(builds, log.join('\n')).toHaveLength(3);
      const pre = new RegExp(`^site-build --public --check app=${esc(PUBLIC_APP)} sha=${tagCommit} status=- here=(.+)$`).exec(builds[0]!);
      expect(pre, builds[0]).not.toBeNull();
      expect(pre![1]).not.toBe(join(s.work, 'site'));
      expect(builds[1]).toBe(`site-build --public app=${PUBLIC_APP} sha=${tagCommit} status=- here=${pre![1]}`);
      expect(existsSync(dirname(pre![1]!)), 'the test build left its directory behind').toBe(false);
      // After the bring-up: the build in the checkout, stamped with the tag's commit.
      expect(builds[2]).toBe(`site-build --public app=${PUBLIC_APP} sha=${tagCommit} status=- here=${join(s.work, 'site')}`);

      const preBuild = at(builds[1]!, 'the full test build');
      const liveWww = at(LIVE_WWW, "the question whether live's project holds a www service");
      const bootstrap = at(/^bootstrap /, 'the bring-up');
      const build = at(builds[2]!, 'the build');
      const up = at(upLine(s), "the site's up, with -p ownpace-live-www and live's .env");
      const healthy = at(new RegExp(`^docker inspect .*${SITE_ID}$`), "the site's health");
      const home = at(`curl http://127.0.0.1:${SITE_PORT}/`, 'the home page on loopback');
      const robots = at(`curl http://127.0.0.1:${SITE_PORT}/robots.txt`, 'robots.txt on loopback');
      const exposure = at(/^exposure-check /, 'the exposure check');
      expect(Math.max(preBuild, liveWww)).toBeLessThan(bootstrap);
      expect(bootstrap).toBeLessThan(build);
      expect(build).toBeLessThan(up);
      expect(up).toBeLessThan(healthy);
      expect(healthy).toBeLessThan(home);
      expect(Math.max(home, robots)).toBeLessThan(exposure);
      // The only thing it ever brings up itself is the site, under its own project.
      expect(log.filter((l) => /^docker compose .* up\b/.test(l))).toEqual([upLine(s)]);

      expect(r.out).toMatch(/the deploy took/);
      expect(r.out).toContain(SITE_PROJECT);
      expect(deployLines(s).map((l) => l.split('\t')[3])).toEqual(['took']);
      // site/dist is ignored, so the next deploy's clean-tree refusal is not tripped.
      expect(r.out).not.toMatch(/NOTE: the deploy left the working tree changed/);
      // Compose's own words went through the address filter.
      expect(r.out).toContain('<WWW_BIND>');
      expect(r.out).not.toContain(SITE_BIND);
      expect(r.out).not.toContain(APP_HOST);
    },
    CASE_MS,
  );

  it(
    'a dry run with the site on: the site checks and the test build pass and are said, then it stops; nothing built in the checkout, nothing brought up',
    () => {
      const s = stage({ releases: [NEXT], dotEnv: SITE_ENV });
      const r = run(s, ['--dry-run', NEXT.tag]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain('0 unfilled placeholder(s)');
      expect(r.out).toContain(`dry run: a deploy of ${NEXT.tag} now would be reversible.`);
      // --check for the count, then the full --public build, both in a directory of their own.
      expect(called(s, 'site-build').map((l) => l.split(' app=')[0])).toEqual(['site-build --public --check', 'site-build --public']);
      expect(buildsInCheckout(s)).toEqual([]);
      expect(broughtUp(s)).toEqual([]);
      expect(existsSync(s.siteUp)).toBe(false);
      expect(existsSync(join(s.work, 'site', 'dist'))).toBe(false);
      expectNothingChanged(s, r.out, 'reads');
      expect(r.out).not.toContain(SITE_BIND);
    },
    CASE_MS,
  );

  const BREAKAGES: Array<[string, (s: Stage) => NodeJS.ProcessEnv | void, RegExp]> = [
    ["the site's build in the checkout fails, though its test build passed", () => ({ STUB_SITE_BUILD_EXIT: '1' }), /site\/build\.mjs --public/],
    ['the site cannot be brought up', () => ({ STUB_WWW_UP_EXIT: '1' }), /-p ownpace-live-www/],
    ['the site never becomes healthy', () => ({ STUB_SITE_STATE: 'running unhealthy' }), /not healthy/],
    ['its home page answers 500', (s) => siteAnswer(s, '/', 500, 'oops'), /home page/],
    [
      'its home page asks not to be indexed',
      (s) => siteAnswer(s, '/', 200, `<meta name="robots" content="noindex" /><a href="${PUBLIC_APP}/request-access">x</a>`),
      /noindex/,
    ],
    ['its robots.txt disallows', (s) => siteAnswer(s, '/robots.txt', 200, 'User-agent: *\nDisallow: /\n'), /robots\.txt/],
    [
      'a request-access link leads to another app',
      (s) => siteAnswer(s, '/', 200, '<a href="https://app.ota.ownpace.eu/request-access?tier=family">x</a>'),
      /request-access/,
    ],
  ];

  it.each(BREAKAGES)(
    '%s: the deploy did not take, the hold stays, it is logged, and the exposure check still ran',
    (_label, breakage, why) => {
      const s = stage({ releases: [NEXT], dotEnv: SITE_ENV });
      const extra = breakage(s) ?? {};
      const r = run(s, [NEXT.tag], extra);
      expect(r.status, r.out).toBe(3);
      expect(r.out).toMatch(/the deploy did not take/);
      expect(r.out).toMatch(why);
      expect(r.out).toMatch(/The hold stays on/);
      expect(r.out).not.toMatch(/the deploy took/);
      expect(deployLines(s).map((l) => l.split('\t').slice(1, 4))).toEqual([[NEXT.tag, s.commit[NEXT.tag], 'did-not-take']]);
      expect(called(s, 'exposure-check')).toHaveLength(1);
      expect(r.out).not.toContain(SITE_BIND);
    },
    CASE_MS,
  );

  it("site/dist is ignored in the repository, so the site's build leaves the tree the next deploy reads clean", () => {
    const r = spawnSync('git', ['check-ignore', '-q', 'site/dist/index.html'], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
  });

  it('the switch, the port and the commands are where the owner reads them', () => {
    const example = readFileSync(join(COMPOSE_DIR, 'managed.env.example'), 'utf8');
    expect(example, 'managed.env.example lists WWW_PORT').toMatch(/^WWW_PORT=$/m);
    expect(example, 'managed.env.example lists the switch, off').toMatch(/^WWW_LIVE=false$/m);
    const exact = `docker compose -p ${SITE_PROJECT} -f deploy/compose/www.yml --env-file deploy/compose/.env`;
    for (const doc of ['docs/managed-bring-up.md', 'docs/incident-runbook.md']) {
      expect(readFileSync(join(REPO_ROOT, doc), 'utf8'), `${doc} gives live's copy's commands with its -p`).toContain(exact);
    }
    const header = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8').split(/^set -euo pipefail$/m)[0]!;
    for (const word of ['WWW_LIVE', 'WWW_PORT', 'WWW_BIND', '-p <project>-www', 'unfilled placeholder']) {
      expect(header, `the header of ${SCRIPT} says ${word}`).toContain(word);
    }
  });
});

describe('the script survives its own checkout', () => {
  it('ends with `main "$@"; exit` on one line, so nothing after main is read from the tag\'s copy', () => {
    // `git checkout --detach <tag>` replaces deploy-live.sh on disk while it
    // runs, and bash reads a script as it goes: a line after `main` would come
    // from whatever file is there by then.
    const lines = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy/compose', SCRIPT), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !/^\s*#/.test(line));
    expect(lines.at(-1)).toMatch(/^main "\$@"; exit\b/);
  });
});
