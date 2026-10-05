// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VISIT COUNT THAT KEPT THE VISITOR (the owner, 2026-10-05: *"go with
 * GoAccess on the logs and the sentence. id and status we skip for now, no
 * netbird api tokens..."*; privacy §4.5, §5 and §9).
 *
 * Privacy §4.5 says: *"From these logs we also count visits to this website
 * (pages, the site you came from, the kind of browser), as totals only, which
 * identify nobody."* The counting is GoAccess, reading the access log live's
 * copy of `www.ownpace.eu` already writes (`deploy/compose/www-nginx.conf`,
 * format `ownpace_site`), on the machine: no script, cookie or banner on the
 * page, nothing leaving the machine, nothing counted on `app.`, `id.` or
 * `status.ownpace.eu`, and no NetBird API token.
 *
 * THE OBVIOUS RUN WOULD HAVE MADE THE SENTENCE FALSE. GoAccess's own way to
 * keep totals across runs is `--persist --restore --db-path`, and its own way
 * to hide addresses is `--anonymize-ip`. Read in its source at the tag
 * `v1.12` (github.com/allinurl/goaccess, `ef3c4f3c`):
 *
 *   - `--persist` writes, for every day, one fingerprint per visitor: a 64-bit
 *     FNV hash of the full address and the browser string (`visitor_fingerprint`
 *     in `src/util.c`, `U6432_UNIQUE_KEYS.db`), and per panel which of those
 *     visitors asked for which page (`MTRC_UNIQMAP`). Unsalted: anybody holding
 *     the file tries every IPv4 address with a common browser string and learns
 *     who came, when, and what they read. Rows per visitor, not totals.
 *   - `--anonymize-ip` and `--anonymize-level` mask the address only when the
 *     HOSTS panel is drawn (`add_host_to_holder` in `src/gholder.c`). The parser
 *     stores the address whole (`case 'h'` in `src/parser.c`), and so does every
 *     table built from it.
 *   - A log FILE given to GoAccess with `--persist` also has its first 4096
 *     bytes kept, to recognise the file next time (`set_initial_persisted_data`,
 *     `IGLP_LAST_PARSE.db`): the first lines of the log, addresses and all.
 *
 * So `deploy/compose/site-visits.sh` keeps GoAccess's REPORT of totals and no
 * database, and does not rely on GoAccess to hide anybody: GoAccess is never
 * given an address at all. A filter reads the container's output from Docker
 * and hands on only the requests that came through the public name (those with
 * an `X-Forwarded-For`; the healthcheck and the deploy's own checks have none),
 * each with its address replaced by a number that exists only while the run
 * lasts (`v1`, `v2`: the same visitor, the same number, so GoAccess still
 * counts visitors), its first field (NetBird's address on the mesh) dropped,
 * and its referrer cut to the site it names. GoAccess runs with no network, no
 * port and no disk, and its HTML comes back on its output.
 *
 * WHAT IS ASSERTED, by running the real script with `docker` replaced by a
 * stub whose GoAccess is the worst one possible: it puts everything it is
 * given into its report, and on failure says all of it on stderr.
 *
 *   - GoAccess is given exactly the requests that came through the public
 *     name, each in the combined format with a number for a host; the same
 *     visitor gets the same number; no address, no first field, and a referrer
 *     cut to its site. Not the status page's Website row, which asks through
 *     the public name every 60 seconds as `Gatus/1.0` (`gatus.yaml`; Gatus's
 *     own User-Agent at v5.36.0): it is ours, not a visit.
 *   - No address from the recorded log, the visitors', NetBird's, the
 *     healthcheck's or the one in nginx's error line, appears in anything the
 *     script prints or writes, or in what GoAccess was given: on success, on
 *     GoAccess's failure, and on `docker logs`' failure.
 *   - The flags: HOSTS, GEO_LOCATION, ASN, REFERRERS and REMOTE_USER ignored;
 *     `--anonymize-ip --anonymize-level=3`, which change nothing while HOSTS is
 *     ignored and its hosts are numbers, and say so if a later edit drops the
 *     panel's ignore; `--no-query-string`, `--ignore-crawlers`,
 *     `--log-format=COMBINED`, `--no-ip-validation`, `-o html`. Never
 *     `--persist`, `--restore`, `--db-path`, `--keep-last`, an agent list, a
 *     real-time server, a resolver or a GeoIP database.
 *   - The image is pinned by digest, and runs with `--network none`, read-only,
 *     with no port and no mount (`a-service-that-phones-home` names it too).
 *   - One report per container of the site, under live's persistent
 *     directory (`~/.persistent/<project>/site-visits/`), and nothing else
 *     left there: a deploy recreates the container and its log, and the
 *     earlier report stays beside the new one.
 *   - It refuses the OTA stack's `.env`, a project the reader refuses, a
 *     switch that is neither true nor false, and an argument, before asking
 *     Docker anything; and while `WWW_LIVE` is not true it reads nothing and
 *     says so.
 *   - A failure is one: no container, `docker logs` or GoAccess failing, or a
 *     report that is not HTML, each exits 1, and an earlier report is kept.
 *
 * WHAT THIS CANNOT SEE. GoAccess itself, and its image. No daemon runs here,
 * so the image's digest was read from Docker Hub's listing of the tag, not
 * pulled. GoAccess 1.12 was built from the tag `v1.12` on 2026-10-05 and run
 * by hand on this file's log, through this script: it took every flag, wrote
 * HTML with no hosts, referrers or place in it and nothing loaded from another
 * host, counted 2 visitors and 5 requests (the crawler's in no panel, the
 * campaign as `linkedin`), and printed nothing. That build has no GeoIP, the
 * image has, and neither is in a test. The first run on the machine is the check
 * (`docs/managed-bring-up.md`, *Counting its visits*).
 *
 * Addresses here are documentation shapes: `100.64.0.7` for NetBird's on the
 * mesh, RFC 5737's and RFC 3849's for visitors.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
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
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(ROOT, 'deploy/compose');
const SCRIPT_REL = 'deploy/compose/site-visits.sh';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

/** NetBird's proxy on the mesh: the first field of every line that came through the public name. */
const NETBIRD = '100.64.0.7';
const VISITOR_A = '198.51.100.23';
const VISITOR_B = '203.0.113.45';
const VISITOR_C = '2001:db8::5';
/** Where the deploy's own check on loopback comes from: Docker's gateway, in a documentation shape. */
const GATEWAY = '192.0.2.1';
/** The address in nginx's error line, which `docker logs` hands back on stderr. */
const IN_ERROR_LOG = '203.0.113.99';
/** Where the status page's probe leaves the machine, as NetBird sees it. */
const OWN_FRONT = '198.51.100.200';
const ADDRESSES = [NETBIRD, VISITOR_A, VISITOR_B, VISITOR_C, GATEWAY, IN_ERROR_LOG, OWN_FRONT, '127.0.0.1'];

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

/** A recorded output of live's site container, in `ownpace_site` (www-nginx.conf). */
const LOG = [
  '/docker-entrypoint.sh: Configuration complete; ready for start up',
  `127.0.0.1 - - [07/Oct/2026:03:13:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "Wget" "-"`,
  `${NETBIRD} - - [07/Oct/2026:09:01:02 +0000] "GET /?utm_source=linkedin&utm_campaign=alpha HTTP/1.1" 200 5120 "https://www.linkedin.com/feed/update/urn:li:activity:1/" "${FIREFOX}" "${VISITOR_A}"`,
  `${NETBIRD} - - [07/Oct/2026:09:01:09 +0000] "GET /prices.html HTTP/1.1" 200 4096 "https://www.ownpace.eu/" "${FIREFOX}" "${VISITOR_A}"`,
  `${NETBIRD} - - [07/Oct/2026:10:15:00 +0000] "GET /nl/ HTTP/1.1" 200 5300 "https://someone:secret@mail.example.net/inbox/4711?user=someone%40example.net" "${IPHONE}" "${VISITOR_B}"`,
  `${NETBIRD} - - [07/Oct/2026:11:00:00 +0000] "GET /robots.txt HTTP/1.1" 200 60 "-" "${GOOGLEBOT}" "${VISITOR_C}"`,
  `${NETBIRD} - - [07/Oct/2026:11:30:00 +0000] "GET /wp-login.php HTTP/1.1" 404 512 "-" "curl/8.5.0" "${VISITOR_B}"`,
  `${GATEWAY} - - [07/Oct/2026:12:00:00 +0000] "GET /robots.txt HTTP/1.1" 200 60 "-" "curl/8.5.0" "-"`,
  // The status page's Website row (gatus.yaml), asking through the public name every 60 seconds.
  `${NETBIRD} - - [07/Oct/2026:12:01:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "Gatus/1.0" "${OWN_FRONT}"`,
  `${NETBIRD} - - [07/Oct/2026:12:02:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "Gatus/1.0" "${OWN_FRONT}"`,
  '',
].join('\n');

/** What GoAccess must be given for that log: the public name's requests, numbered, cut. */
const GIVEN = [
  `v1 - - [07/Oct/2026:09:01:02 +0000] "GET /?utm_source=linkedin&utm_campaign=alpha HTTP/1.1" 200 5120 "https://www.linkedin.com" "${FIREFOX}"`,
  `v1 - - [07/Oct/2026:09:01:09 +0000] "GET /prices.html HTTP/1.1" 200 4096 "https://www.ownpace.eu" "${FIREFOX}"`,
  `v2 - - [07/Oct/2026:10:15:00 +0000] "GET /nl/ HTTP/1.1" 200 5300 "https://mail.example.net" "${IPHONE}"`,
  `v3 - - [07/Oct/2026:11:00:00 +0000] "GET /robots.txt HTTP/1.1" 200 60 "-" "${GOOGLEBOT}"`,
  `v2 - - [07/Oct/2026:11:30:00 +0000] "GET /wp-login.php HTTP/1.1" 404 512 "-" "curl/8.5.0"`,
];

const ID_FIRST = '3f1c2b9a8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a';
const ID_SECOND = '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a3f1c2b9a8d7e6f5a4b3c2d1e0f';

const LIVE_ENV = [
  'COMPOSE_PROJECT_NAME=ownpace-live',
  'STACK_KIND=production',
  'WEB_BIND=100.64.0.1',
  'WWW_LIVE=true',
  'WWW_PORT=3135',
  'WWW_BIND=100.64.0.1',
  '',
].join('\n');
const OTA_ENV = LIVE_ENV.split('\n')
  .filter((l) => !/^(COMPOSE_PROJECT_NAME|STACK_KIND)=/.test(l))
  .join('\n');

/**
 * `docker`, as the script uses it. Its GoAccess (`docker run`) is the worst
 * one possible: everything it is given goes into its report, and on failure
 * it says all of it on stderr. `docker logs` says nginx's error line, with an
 * address, on stderr, as the real one does.
 */
const DOCKER_STUB = [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$*" >>"$STUB_DIR/asked"',
  'case "$1" in',
  '  ps)',
  '    [ -z "${STUB_PS_FAIL:-}" ] || { echo "Cannot connect to the Docker daemon" >&2; exit 1; }',
  '    for id in ${STUB_IDS:-}; do echo "$id"; done',
  '    ;;',
  '  inspect)',
  '    id="${*: -1}"',
  '    cat "$STUB_DIR/created.$id"',
  '    ;;',
  '  logs)',
  '    id="${*: -1}"',
  `    echo '2026/10/07 11:30:00 [error] 29#29: *7 open() "/usr/share/nginx/html/wp-login.php" failed (2: No such file or directory), client: ${IN_ERROR_LOG}, server: _' >&2`,
  '    [ -z "${STUB_LOGS_FAIL:-}" ] || exit 1',
  '    cat "$STUB_DIR/log.$id"',
  '    ;;',
  '  run)',
  '    shift',
  '    printf "%s\\n" "$@" >"$STUB_DIR/run.argv"',
  '    cat >"$STUB_DIR/given"',
  '    if [ -n "${STUB_GOACCESS_FAIL:-}" ]; then cat "$STUB_DIR/given" >&2; echo "goaccess: it failed" >&2; exit 1; fi',
  '    if [ -n "${STUB_GOACCESS_EMPTY:-}" ]; then exit 0; fi',
  '    printf "<!DOCTYPE html>\\n<html><body><pre>\\n"',
  '    cat "$STUB_DIR/given"',
  '    printf "</pre></body></html>\\n"',
  '    ;;',
  '  *) echo "docker $1: not expected" >&2; exit 99 ;;',
  'esac',
].join('\n');

interface Stage {
  root: string;
  compose: string;
  home: string;
  stub: string;
  bin: string;
}

/** Live's checkout: the script, what it sources, managed.yml, a `.env`, and `docker` on PATH. */
function stage(dotEnv: string = LIVE_ENV): Stage {
  if (!existsSync(join(ROOT, SCRIPT_REL))) throw new Error(`${SCRIPT_REL} does not exist`);
  const root = mkdtempSync(join(tmpdir(), 'site-visits-'));
  tempDirs.push(root);
  const compose = join(root, 'checkout', 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of ['site-visits.sh', 'env-read.sh', 'stack-kind.sh', 'own-addresses.sh', 'www-live.sh', 'managed.yml']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  }
  chmodSync(join(compose, 'site-visits.sh'), 0o755);
  writeFileSync(join(compose, '.env'), dotEnv);
  const home = join(root, 'home');
  mkdirSync(home);
  const stub = join(root, 'stub');
  mkdirSync(stub);
  writeFileSync(join(stub, 'asked'), '');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `${DOCKER_STUB}\n`);
  chmodSync(join(bin, 'docker'), 0o755);
  container({ root, compose, home, stub, bin }, ID_FIRST, '2026-10-07T03:12:45.123456789Z', LOG);
  return { root, compose, home, stub, bin };
}

/** A container of the site's project, as `docker inspect` and `docker logs` answer for it. */
function container(s: Stage, id: string, created: string, log: string): void {
  writeFileSync(join(s.stub, `created.${id}`), `${created}\n`);
  writeFileSync(join(s.stub, `log.${id}`), log);
}

function run(s: Stage, extra: NodeJS.ProcessEnv = {}, args: string[] = []) {
  // A clean environment, so the shell this test runs in cannot choose a stack.
  const r = spawnSync(join(s.compose, 'site-visits.sh'), args, {
    encoding: 'utf8',
    env: {
      PATH: `${s.bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: s.home,
      STUB_DIR: s.stub,
      STUB_IDS: ID_FIRST,
      ...extra,
    },
    cwd: s.root,
    timeout: 60_000,
  });
  const asked = readFileSync(join(s.stub, 'asked'), 'utf8').split('\n').filter(Boolean);
  const argvFile = join(s.stub, 'run.argv');
  const givenFile = join(s.stub, 'given');
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    asked,
    argv: existsSync(argvFile) ? readFileSync(argvFile, 'utf8').split('\n').filter(Boolean) : [],
    given: existsSync(givenFile) ? readFileSync(givenFile, 'utf8') : null,
  };
}

const visitsDir = (s: Stage): string => join(s.home, '.persistent', 'ownpace-live', 'site-visits');

/** Every file under a directory, with its text. */
function filesUnder(dir: string): Array<{ path: string; text: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ path: string; text: string }> = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ path: relative(dir, p), text: readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

/** No recorded address in anything the run printed, wrote under HOME, or gave GoAccess. */
function expectNoAddress(s: Stage, r: ReturnType<typeof run>): void {
  const places = [
    { where: 'stdout', text: r.stdout },
    { where: 'stderr', text: r.stderr },
    { where: 'what GoAccess was given', text: r.given ?? '' },
    ...filesUnder(s.home).map((f) => ({ where: `~/${f.path}`, text: f.text })),
  ];
  for (const { where, text } of places) {
    for (const a of ADDRESSES) expect(text.includes(a), `${where} holds ${a}`).toBe(false);
    expect(text, `${where} holds an address in the mesh's range`).not.toMatch(/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b/);
  }
}

describe('site-visits.sh gives GoAccess the visits, and no visitor', () => {
  it('hands on exactly the requests that came through the public name: a number for each visitor, no address, the referrer cut to its site', () => {
    const s = stage();
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(r.given?.split('\n').filter(Boolean)).toEqual(GIVEN);
    expect(r.out).toMatch(/5 request\(s\) came through the public name/);
    expect(r.out).toMatch(/2 did not \(the healthcheck, the deploy's own checks\)/);
    expect(r.out, "the status page's probe is ours, not a visit").toMatch(/2 were the status page's probe/);
    expectNoAddress(s, r);
  });

  it('prints and writes no address: on success, when GoAccess fails and says what it was given, and when docker logs fails', () => {
    const ok = stage();
    expectNoAddress(ok, run(ok));
    const goaccess = stage();
    const g = run(goaccess, { STUB_GOACCESS_FAIL: '1' });
    expect(g.status, g.out).toBe(1);
    expect(g.out, "GoAccess's own words are shown").toContain('goaccess: it failed');
    expectNoAddress(goaccess, g);
    const logs = stage();
    const l = run(logs, { STUB_LOGS_FAIL: '1' });
    expect(l.status, l.out).toBe(1);
    expect(l.out).toMatch(/docker logs .* failed/);
    expect(l.given, 'GoAccess ran on a log docker could not give').toBeNull();
    expectNoAddress(logs, l);
  });

  it('reads the site container of live’s project only, through Docker, and never with a timestamp cursor of its own', () => {
    const s = stage();
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    const ps = r.asked.filter((a) => a.startsWith('ps '));
    expect(ps).toEqual([
      `ps -a --filter label=com.docker.compose.project=ownpace-live-www --filter label=com.docker.compose.service=www --format {{.ID}}`,
    ]);
    expect(r.asked.filter((a) => a.startsWith('logs '))).toEqual([`logs ${ID_FIRST}`]);
  });
});

describe('GoAccess keeps totals: the flags, the image and what it may touch', () => {
  /** One run, made when the first test asks, so a missing script fails the tests and not the file's collection. */
  let once: { r: ReturnType<typeof run>; image: number; docker: string[]; goaccess: string[] } | undefined;
  const ran = () => {
    if (!once) {
      const r = run(stage());
      const image = r.argv.findIndex((a) => /^allinurl\/goaccess[:@]/.test(a));
      once = { r, image, docker: r.argv.slice(0, Math.max(image, 0)), goaccess: image < 0 ? [] : r.argv.slice(image + 1) };
    }
    return once;
  };

  it('ran', () => {
    const { r, image } = ran();
    expect(r.status, r.out).toBe(0);
    expect(image, `no allinurl/goaccess image among: ${r.argv.join(' ')}`).toBeGreaterThan(-1);
  });

  it.each([
    ['--ignore-panel=HOSTS', 'the panel of addresses: never built'],
    ['--ignore-panel=GEO_LOCATION', 'a place, which the sentence does not name'],
    ['--ignore-panel=ASN', "a visitor's network, the same"],
    ['--ignore-panel=REFERRERS', 'the whole address of the page a visitor came from; "the site you came from" is REFERRING_SITES'],
    ['--ignore-panel=REMOTE_USER', 'a user name, which the site never has'],
    ['--anonymize-ip', 'masks the HOSTS panel if a later edit draws it'],
    ['--anonymize-level=3', 'at its widest: a /8 or a /32'],
    ['--no-query-string', 'pages without their parameters; the UTM panel still counts campaigns'],
    ['--ignore-crawlers', 'visits, not robots'],
    ['--log-format=COMBINED', 'the shape the filter hands on'],
    ['--no-ip-validation', 'a host is a number for the run, never an address'],
    ['--no-global-config', "nothing from a configuration file in the image"],
  ])('passes %s (%s)', (flag) => {
    const { goaccess } = ran();
    expect(goaccess, goaccess.join(' ')).toContain(flag);
  });

  it('writes its HTML on its output, and reads the log from its input', () => {
    const { goaccess } = ran();
    const o = goaccess.indexOf('-o');
    expect(o, goaccess.join(' ')).toBeGreaterThan(-1);
    expect(goaccess[o + 1]).toBe('html');
    expect(goaccess[goaccess.length - 1]).toBe('-');
  });

  it('never keeps a store of its own, nor a list, a server, a resolver or a map', () => {
    const { goaccess } = ran();
    const kept = goaccess.filter((a) =>
      /^(--persist|--restore|--db-path|--keep-last|-a|--agent-list|--real-time-html|--enable-html-resolver|--geoip-database|--ws-url|--port|--addr|--unknowns-log|--invalid-requests|--debug-file|--daemonize|--pid-file|--fifo-in|--fifo-out)\b/.test(
        a,
      ),
    );
    expect(kept, 'privacy §4.5: totals only. --persist keeps a fingerprint per visitor and per day').toEqual([]);
  });

  it('is pinned by digest, and runs with no network, no port, no mount and nothing to write', () => {
    const { r, image, docker } = ran();
    expect(r.argv[image]).toMatch(/^allinurl\/goaccess:[0-9][0-9.]*@sha256:[0-9a-f]{64}$/);
    expect(docker).toContain('--rm');
    expect(docker).toContain('-i');
    expect(docker.join(' ')).toMatch(/(^| )--network none( |$)/);
    expect(docker).toContain('--read-only');
    const reach = docker.filter((a) => /^(-p|-P|--publish|--publish-all|-v|--volume|--mount|--network=(?!none$)|--net\b|--add-host)/.test(a));
    expect(reach, docker.join(' ')).toEqual([]);
  });
});

describe('one report per container of the site, kept under live’s persistent directory', () => {
  it('writes the report for the container in ~/.persistent/<project>/site-visits, named after when the container was made, and nothing else', () => {
    const s = stage();
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    const files = filesUnder(visitsDir(s));
    expect(files.map((f) => f.path)).toEqual([`2026-10-07-031245-${ID_FIRST.slice(0, 12)}.html`]);
    expect(files[0]?.text).toMatch(/^<!DOCTYPE html>/);
    expect(statSync(visitsDir(s)).mode & 0o077, 'the directory is the owner’s alone').toBe(0);
    expect(statSync(join(visitsDir(s), files[0]?.path ?? '')).mode & 0o077, 'the report is the owner’s alone').toBe(0);
    expect(r.out).toContain(`~/.persistent/ownpace-live/site-visits/2026-10-07-031245-${ID_FIRST.slice(0, 12)}.html`);
  });

  it('a deploy recreates the site: the new container gets a report of its own, and the earlier one stays as it was', () => {
    const s = stage();
    expect(run(s).status).toBe(0);
    const first = filesUnder(visitsDir(s));
    container(s, ID_SECOND, '2026-10-21T08:00:01.5Z', LOG.replace(/07\/Oct\/2026/g, '21/Oct/2026'));
    const r = run(s, { STUB_IDS: ID_SECOND });
    expect(r.status, r.out).toBe(0);
    const both = filesUnder(visitsDir(s));
    expect(both.map((f) => f.path).sort()).toEqual(
      [`2026-10-07-031245-${ID_FIRST.slice(0, 12)}.html`, `2026-10-21-080001-${ID_SECOND.slice(0, 12)}.html`].sort(),
    );
    expect(both.find((f) => f.path === first[0]?.path)?.text).toBe(first[0]?.text);
  });

  it('a second run on the same container writes its report again, from the whole log', () => {
    const s = stage();
    expect(run(s).status).toBe(0);
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(filesUnder(visitsDir(s))).toHaveLength(1);
    expect(r.given?.split('\n').filter(Boolean)).toEqual(GIVEN);
  });
});

describe('it refuses what is not live’s, and reads nothing while the site is off', () => {
  it("refuses the OTA stack's .env before asking docker anything", () => {
    const s = stage(OTA_ENV);
    const r = run(s);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('STACK_KIND');
    expect(r.asked).toEqual([]);
    expect(existsSync(join(s.home, '.persistent')), 'it made a directory for a stack it refused').toBe(false);
  });

  it("refuses live's marker on a .env without live's project, which the reader refuses", () => {
    const s = stage(LIVE_ENV.replace('COMPOSE_PROJECT_NAME=ownpace-live\n', ''));
    const r = run(s);
    expect(r.status, r.out).toBe(2);
    expect(r.asked).toEqual([]);
  });

  it('refuses a shell that exported the other stack’s project', () => {
    const s = stage();
    const r = run(s, { COMPOSE_PROJECT_NAME: 'ownpace-managed' });
    expect(r.status, r.out).toBe(2);
    expect(r.asked).toEqual([]);
  });

  it.each([
    ['false', LIVE_ENV.replace('WWW_LIVE=true', 'WWW_LIVE=false')],
    ['absent', LIVE_ENV.replace('WWW_LIVE=true\n', '')],
  ])('with WWW_LIVE %s: reads nothing, writes nothing, says why, and exits 0', (_l, dotEnv) => {
    const s = stage(dotEnv);
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/WWW_LIVE is not true/);
    expect(r.out).toMatch(/[Nn]othing was read/);
    expect(r.asked).toEqual([]);
    expect(existsSync(join(s.home, '.persistent'))).toBe(false);
  });

  it('a switch that is neither true nor false is refused, naming the key and not the value', () => {
    const s = stage(LIVE_ENV.replace('WWW_LIVE=true', 'WWW_LIVE=maybe-later'));
    const r = run(s);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('WWW_LIVE');
    expect(r.out).not.toContain('maybe-later');
    expect(r.asked).toEqual([]);
  });

  it('takes no argument', () => {
    const s = stage();
    const r = run(s, {}, ['--all']);
    expect(r.status, r.out).toBe(2);
    expect(r.asked).toEqual([]);
  });
});

describe('a failure is a failure, and an earlier report stays', () => {
  it('no container of the site: exit 1, naming the project', () => {
    const s = stage();
    const r = run(s, { STUB_IDS: '' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/ownpace-live-www has no container/);
  });

  it('docker that cannot be asked: exit 1, never "nothing there" (hard rule 9)', () => {
    const s = stage();
    const r = run(s, { STUB_PS_FAIL: '1' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/docker could not be asked/);
  });

  it.each([
    ['docker logs fails', { STUB_LOGS_FAIL: '1' }, /docker logs .* failed/],
    ['GoAccess fails', { STUB_GOACCESS_FAIL: '1' }, /GoAccess failed/],
    ['GoAccess writes no HTML', { STUB_GOACCESS_EMPTY: '1' }, /not an HTML report/],
  ] as const)('%s: exit 1, and the report from the run before is kept as it was', (_l, extra, why) => {
    const s = stage();
    expect(run(s).status).toBe(0);
    const before = filesUnder(visitsDir(s));
    const r = run(s, extra);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(why);
    expect(filesUnder(visitsDir(s))).toEqual(before);
  });

  it('no request through the public name yet: GoAccess is not run, no report, exit 0', () => {
    const s = stage();
    container(s, ID_FIRST, '2026-10-07T03:12:45Z', LOG.split('\n').filter((l) => !l.includes(NETBIRD)).join('\n'));
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/0 request\(s\) came through the public name/);
    expect(r.given).toBeNull();
    expect(filesUnder(visitsDir(s))).toEqual([]);
  });
});

describe('the script is written the way the others are', () => {
  const text = existsSync(join(ROOT, SCRIPT_REL)) ? readFileSync(join(ROOT, SCRIPT_REL), 'utf8') : '';
  const code = text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  it("reads the .env and live's marker with the repository's readers, and never traces itself", () => {
    for (const helper of ['env-read.sh', 'stack-kind.sh', 'own-addresses.sh', 'www-live.sh']) {
      expect(text, `sources ${helper}`).toMatch(new RegExp(`^\\. "\\$\\{SCRIPT_DIR\\}/${helper.replace('.', '\\.')}"$`, 'm'));
    }
    expect(code).toMatch(/\bstack_is_live\b/);
    expect(code).toMatch(/\bcompose_project\b/);
    expect(code).toMatch(/\bwww_live_switch\b/);
    expect(code, 'set -x would print every value it reads').not.toMatch(/set\s+-[a-wyz]*x/);
    expect(text).toMatch(/^set -euo pipefail$/m);
  });

  it('keeps what it writes under ~/.persistent/<project>, never a directory the shell names', () => {
    expect(code).toMatch(/"\$\{HOME\}\/\.persistent\/\$\{COMPOSE_PROJECT\}\/site-visits"/);
    expect(code, 'MANAGED_ENV_PERSIST_DIR is the gate’s, and a shell could point it at the OTA stack').not.toMatch(
      /MANAGED_ENV_PERSIST_DIR/,
    );
  });
});
