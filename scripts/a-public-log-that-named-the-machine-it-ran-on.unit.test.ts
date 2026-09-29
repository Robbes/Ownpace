// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PUBLIC LOG THAT NAMED THE MACHINE IT RAN ON.
 *
 * The managed gate runs on the owner's own machine, and its log and its
 * evidence artifact are public: anybody can read a run of this repository,
 * and any signed-in account can download its artifacts. The stack's `.env`
 * holds that machine's mesh address, in every `*_BIND` a laptop or a front
 * reaches, in `TRIGGER_TLS_HOST`, in the dashboard's origins and in Nextcloud's
 * trusted domains. `an-address-that-was-not-an-example` took it out of the
 * repository in 2026-09. The runs kept printing it.
 *
 * A read-only sweep on 2026-09-27 found sixteen places, each checked against a
 * public run. On EVERY run: `docker compose ps` in the last step printed the
 * PORTS column, one publish per bind (E2E (managed) #201); the bring-up's
 * `dashboard:` note printed `TRIGGER_APP_ORIGIN`; `setup-nextcloud-users.sh`
 * said "External DAV ready at" its URL, twice; and the Trigger.dev CLI printed
 * its "View deployment" links on the dashboard's origin and appended them to
 * `$GITHUB_ENV`, whose every variable the runner prints again in the header of
 * each later step: nine more copies (#198). On FAILURE: a curl to Mailpit or
 * Nextcloud names the host it could not reach, the bring-up dumps container
 * logs whose TLS front names its site address (#77, #199), Docker names the
 * address it could not bind, and a `.env` line bash could not read was echoed
 * whole. And the evidence artifact carried whatever the smoke printed:
 * `redact-evidence.sh` knew secrets, not addresses.
 *
 * NONE OF IT WAS A SECRET, so nothing masked it. GitHub hides the values of
 * registered secrets only; an address read from a `.env` is ordinary text.
 *
 * SO THERE ARE THREE LAYERS, each covering what the one before cannot:
 *
 * - the sources stop printing it: `ps` without its PORTS column, an origin
 *   printed only when its host is loopback, the CLI run without the Actions
 *   files and without its links, a bad `.env` line named by its key;
 * - the job masks this machine's own values before anything reads the
 *   stack (`own-addresses.sh --mask`, right after the `.env` is restored),
 *   so a message nobody has found yet prints `***`;
 * - and what is written to a file is filtered by value and by the mesh
 *   range (`own-addresses.sh`'s sed): the smoke's own stream, the container
 *   logs the bring-up dumps (`explain_failure`'s and `setup-zitadel.sh`'s),
 *   and the artifact, which a mask never touches.
 *
 * AND A VISITOR'S ADDRESS (review of 2026-09-29, ops-trust-proxy (b)). Since
 * both nginx logs record the `X-Forwarded-For` NetBird passes on as their last
 * field, an access line names the visitor's own public address, which is
 * neither this machine's nor in the mesh's range: most likely the owner's,
 * browsing the test stack. The same filter replaces that field with
 * `<client-ip>`, whatever it holds but the `-` of a request without one.
 *
 * Addresses here are documentation shapes: `100.64.0.1`, the mesh placeholder
 * `an-address-that-was-not-an-example` permits, and RFC 5737's. A second mesh
 * peer is assembled at run time, so the sweep in that guard never sees one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
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
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const COMPOSE_DIR = join(ROOT, 'deploy/compose');
const OWN = join(COMPOSE_DIR, 'own-addresses.sh');
const ENV_READ = join(COMPOSE_DIR, 'env-read.sh');

/** How a script here reaches the helpers: its own source lines, and no others. */
const SOURCES_OWN = /^\. "\$\{SCRIPT_DIR\}\/own-addresses\.sh"$/m;
function sourceLines(script: string): string {
  return read(script)
    .split('\n')
    .filter((l) => /^\. "\$\{SCRIPT_DIR\}\/(env-read|own-addresses)\.sh"$/.test(l))
    .join('\n');
}

/** Shell comments removed: a comment may name a flag without passing it. */
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** The machine, in a `.env` shaped like the reference box's. */
const MESH = '100.64.0.1';
const FRONT = '192.0.2.10';
const NEXTCLOUD = '203.0.113.5';
const TRUSTED = '198.51.100.7';
const NAME = 'spark.mesh.example';
/** The mesh's own domain, inside NAME and inside FILES, and met before FILES. */
const ZONE = 'mesh.example';
const FILES = 'files.mesh.example';
/** Another peer on the mesh: in the range, and in no key. */
const PEER = ['100', '97', '12', '34'].join('.');
/** Visitors, as an access line's last field names them: in no key and no range. */
const VISITOR = '203.0.113.77';
const VISITOR6 = '2001:db8::77';

const ENV = [
  '# the OTA stack, as the gate restores it',
  `WEB_BIND=${MESH}`,
  `ZITADEL_BIND=${MESH}`,
  `STATUS_BIND=${FRONT}`,
  'POSTGRES_BIND=',
  'API_BIND=127.0.0.1',
  'TRIGGER_BIND=0.0.0.0',
  `TRIGGER_TLS_BIND=${MESH}`,
  `MAILPIT_BIND=${MESH}`,
  `export NEXTCLOUD_BIND=${NEXTCLOUD}`,
  `TRIGGER_TLS_HOST=${NAME}`,
  `TRIGGER_APP_ORIGIN=https://${NAME}:3443`,
  `TRIGGER_LOGIN_ORIGIN='https://${NAME}:3443'`,
  'TRIGGER_API_ORIGIN=http://127.0.0.1:3090',
  `NEXTCLOUD_TRUSTED_DOMAINS='localhost nextcloud ${ZONE} ${FILES} ${TRUSTED}'`,
  'SMTP_HOST=mailpit',
  '',
].join('\n');

/** Exactly what the job must hide: every value above that names this machine. */
const OWN_VALUES = [MESH, FRONT, NEXTCLOUD, NAME, ZONE, FILES, TRUSTED];

/** A name a shorter value inside it replaced first, leaving a label behind. */
const CUT = /[\w-]\.<[A-Z_,]+>|<[A-Z_,]+>\.[\w-]/;

/**
 * The value as a whole address or name, so the near miss `192.0.2.100` in a
 * fixture is not read as `192.0.2.10` surviving.
 */
const whole = (v: string) => new RegExp(`(?<![\\w.])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`);

let dir: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'own-addresses-'));
  envFile = join(dir, '.env');
  writeFileSync(envFile, ENV);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function bash(program: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync('bash', ['-c', program, 'guard', ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

describe('the job-level mask', () => {
  it('masks every value that names this machine, and nothing else', () => {
    expect(existsSync(OWN), 'deploy/compose/own-addresses.sh does not exist').toBe(true);
    const r = spawnSync('bash', [OWN, '--mask', envFile], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const masks = r.stdout.split('\n').filter((l) => l.startsWith('::add-mask::'));
    expect(masks.map((l) => l.slice('::add-mask::'.length)).sort()).toEqual([...OWN_VALUES].sort());
    // Loopback, every interface, empty, and a compose service's own name are
    // not this machine's address. `nextcloud` masked would blank the word out
    // of every line of the job.
    for (const never of ['127.0.0.1', '0.0.0.0', 'localhost', 'nextcloud', 'mailpit', '']) {
      expect(masks, `masked ${never || 'an empty value'}`).not.toContain(`::add-mask::${never}`);
    }
    // Each value once, however many keys hold it.
    expect(new Set(masks).size).toBe(masks.length);
    // And the values appear on the mask lines only: a mask line is consumed by
    // the runner, any other line is printed.
    const others = r.stdout.split('\n').filter((l) => !l.startsWith('::add-mask::'));
    for (const v of OWN_VALUES) expect(others.join('\n')).not.toContain(v);
  });

  it("masks EXPOSURE_ALLOW's addresses too, the other stack's among them (0132 T3 b)", () => {
    // The exposure check reads every container on the machine, so each stack's
    // list names the other stack's and the site's binds, which no *_BIND line
    // of this file holds.
    const LIVE_FRONT = '198.51.100.20';
    writeFileSync(envFile, `${ENV}EXPOSURE_ALLOW="${FRONT},${LIVE_FRONT},127.0.0.1"\n`);
    const r = spawnSync('bash', [OWN, '--mask', envFile], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const masks = r.stdout.split('\n').filter((l) => l.startsWith('::add-mask::'));
    expect(masks).toContain(`::add-mask::${LIVE_FRONT}`);
    expect(masks).not.toContain('::add-mask::127.0.0.1');
    expect(masks.filter((l) => l === `::add-mask::${FRONT}`)).toHaveLength(1);
  });

  it('reads a double-quoted value as bash does, the form the bring-up guide writes', () => {
    // `managed.env.example` and load_env's own remedy both say
    // NEXTCLOUD_TRUSTED_DOMAINS="localhost nextcloud …", and the mask runs
    // before check-env-agreement.sh would refuse it. A quote kept masked
    // `"localhost` and hid a last entry only together with its quote.
    const BOX = 'box.mesh.example';
    const APP = 'app.mesh.example';
    const quoted = join(dir, 'quoted.env');
    writeFileSync(
      quoted,
      [
        `NEXTCLOUD_BIND=${MESH}`,
        `TRIGGER_TLS_HOST="${NAME}"`,
        `TRIGGER_APP_ORIGIN="https://${APP}"`,
        `NEXTCLOUD_TRUSTED_DOMAINS="localhost nextcloud ${MESH} ${BOX}"`,
        '',
      ].join('\n'),
    );
    const r = spawnSync('bash', [OWN, '--mask', quoted], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const masked = r.stdout
      .split('\n')
      .filter((l) => l.startsWith('::add-mask::'))
      .map((l) => l.slice('::add-mask::'.length));
    expect(masked.filter((m) => m.includes('"')), 'a mask kept a quote').toEqual([]);
    expect(masked.sort()).toEqual([MESH, NAME, APP, BOX].sort());
    const redacted = spawnSync('bash', [OWN, '--redact', quoted], {
      encoding: 'utf8',
      input: `External at ${BOX}:8083 via ${NAME}\n{"host":"localhost"}\n`,
    });
    expect(redacted.status, redacted.stderr).toBe(0);
    expect(redacted.stdout).toContain('External at <NEXTCLOUD_TRUSTED_DOMAINS>:8083 via <TRIGGER_TLS_HOST>');
    expect(redacted.stdout).toContain('{"host":"localhost"}');
  });

  it('masks nothing, and succeeds, when there is no .env to read', () => {
    const r = spawnSync('bash', [OWN, '--mask', join(dir, 'absent.env')], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toContain('::add-mask::');
  });

  it('runs in the managed gate right after the .env is restored, before anything reads the stack', () => {
    const wf = parse(read('.github/workflows/e2e-managed.yml')) as {
      jobs: Record<string, { steps: Array<{ name?: string; run?: string; uses?: string }> }>;
    };
    const steps = wf.jobs['e2e-managed']!.steps;
    const runOf = (s: { run?: string }) => code(s.run ?? '');
    const restore = steps.findIndex((s) => runOf(s).includes('cp "${PERSIST_DIR}/.env" deploy/compose/.env'));
    const mask = steps.findIndex((s) => /own-addresses\.sh --mask deploy\/compose\/\.env/.test(runOf(s)));
    const first = steps.findIndex((s) =>
      /bootstrap-managed\.sh|docker compose|smoke-managed\.sh|setup-zitadel\.sh|trigger-version\.sh|ensure-env-secrets\.sh/.test(
        runOf(s),
      ),
    );
    expect(restore, 'the restore step is no longer recognisable').toBeGreaterThanOrEqual(0);
    // The step right after: any step between them could read the .env, and a
    // list of the ones that do is a list somebody forgets to extend.
    expect(mask, 'the mask is not the step right after the restore').toBe(restore + 1);
    expect(first, 'no step reads the stack').toBeGreaterThan(mask);
    // A trace prints each value before the runner has been told to hide it.
    expect(runOf(steps[mask]!)).not.toMatch(/set -[a-z]*x|set -o xtrace/);
  });
});

describe('what the gate prints about the stack', () => {
  /** Every job that can land on the owner's machine. */
  function selfHostedRuns(): Array<{ where: string; line: string }> {
    const found: Array<{ where: string; line: string }> = [];
    const dirPath = '.github/workflows';
    const files = spawnSync('git', ['ls-files', dirPath], { cwd: ROOT, encoding: 'utf8' })
      .stdout.split('\n')
      .filter((f) => /\.ya?ml$/.test(f));
    for (const file of files) {
      const wf = parse(read(file)) as { jobs?: Record<string, { 'runs-on'?: unknown; steps?: Array<{ run?: string }> }> };
      for (const [job, def] of Object.entries(wf.jobs ?? {})) {
        if (!JSON.stringify(def['runs-on'] ?? '').includes('self-hosted')) continue;
        for (const step of def.steps ?? []) {
          // A line ending in a backslash goes on: `docker compose $X \` then `ps`.
          const lines = code(step.run ?? '').replace(/\\\n\s*/g, ' ').split('\n');
          for (const line of lines) found.push({ where: `${file} ${job}`, line });
        }
      }
    }
    return found;
  }

  /**
   * The `ps` fields that name no address. The default table has PORTS, and
   * `json` and `{{.Publishers}}` carry the same publishes as a URL each.
   */
  const SAFE_PS_FIELD = /^\.(Name|Names|Service|Status|State|Health|ID|Image|RunningFor|CreatedAt)$/;
  function psPrintsABind(line: string): boolean {
    const format = /--format(?:=|\s+)('[^']*'|"[^"]*"|\S+)/.exec(line)?.[1];
    if (format === undefined) return true;
    const actions = [...format.matchAll(/\{\{(.*?)\}\}/g)].map((m) => m[1]!.trim());
    return actions.length === 0 || actions.some((a) => !SAFE_PS_FIELD.test(a));
  }

  it('lists containers without the PORTS column, which prints every bind', () => {
    // Two jobs list containers on this machine: `.github/workflows/e2e.yml`
    // (the self-host gate) and `.github/workflows/e2e-managed.yml`.
    const ps = selfHostedRuns().filter(({ line }) => /\bdocker\b(\s+compose\b)?[^|;&]*\sps\b/.test(line));
    expect(ps.length, 'no `ps` found in a self-hosted job: the scan is looking at nothing').toBeGreaterThan(0);
    const wrong = ps.filter(({ line }) => psPrintsABind(line));
    expect(wrong.map((w) => `${w.where}: ${w.line.trim()}`)).toEqual([]);
  });

  it('tells a `ps` that prints a bind from one that does not, so the scan is not vacuous', () => {
    for (const bad of [
      'docker compose $X ps',
      'docker compose $X ps --format json',
      'docker compose $X ps --format=json',
      "docker compose $X ps --format 'table {{.Name}}\\t{{.Publishers}}'",
      "docker compose $X ps --format '{{.Name}} {{json .}}'",
      "docker compose $X ps --format 'table'",
    ]) {
      expect(psPrintsABind(bad), bad).toBe(true);
    }
    for (const good of [
      "docker compose $X ps --format 'table {{.Name}}\\t{{.Image}}\\t{{.Service}}\\t{{.RunningFor}}\\t{{.Status}}' || true",
      "docker compose $X ps --format '{{.Name}} {{.Health}}' 2>/dev/null || true",
    ]) {
      expect(psPrintsABind(good), good).toBe(false);
    }
  });

  it('runs the deploy CLI without the Actions files and without its links', () => {
    // The CLI (4.5.16, commands/deploy.js) appends TRIGGER_DEPLOYMENT_URL and
    // TRIGGER_TEST_URL to $GITHUB_ENV whenever that is set, and the runner
    // prints both in every later step's header. In --plain mode it prints the
    // links only when TRIGGER_DEPLOYMENT_LINK_OUTPUT_DISABLED is not 1.
    const text = code(read('deploy/compose/deploy-tasks.sh'));
    const from = text.indexOf('TRIGGER_PROJECT_REF="${TRIGGER_PROJECT_REF}"');
    const invocation = text.slice(from, text.indexOf('\n', text.indexOf('deploy --profile', from)));
    expect(invocation, 'the deploy invocation is no longer recognisable').toContain('npx -y "trigger.dev@');
    const cli = invocation.indexOf('npx -y');
    const unset = invocation.indexOf('env -u GITHUB_ENV -u GITHUB_OUTPUT');
    expect(unset, 'the CLI still sees $GITHUB_ENV and $GITHUB_OUTPUT').toBeGreaterThan(-1);
    expect(unset).toBeLessThan(cli);
    expect(invocation.slice(0, cli)).toContain('TRIGGER_DEPLOYMENT_LINK_OUTPUT_DISABLED=1');
    expect(invocation.slice(cli)).toMatch(/\s--plain\b/);
  });

  it('prints an origin only when its host is loopback', () => {
    const shown = (url: string, key: string) =>
      bash(`. "${ENV_READ}"; . "${OWN}"; shown_origin "$1" "$2"`, [url, key]).stdout;
    expect(shown('https://localhost:3443', 'TRIGGER_APP_ORIGIN')).toBe('https://localhost:3443');
    expect(shown('http://127.0.0.1:3090', 'TRIGGER_API_ORIGIN')).toBe('http://127.0.0.1:3090');
    for (const [url, host] of [
      [`https://${MESH}:3443`, MESH],
      [`https://${NAME}:3443/login`, NAME],
      ['http://[2001:db8::1]:3443', '2001:db8::1'],
    ] as const) {
      const out = shown(url, 'TRIGGER_APP_ORIGIN');
      expect(out, url).toContain('TRIGGER_APP_ORIGIN');
      expect(out, url).not.toContain(host);
    }
  });

  it('never expands an address key straight into what the bring-up prints', () => {
    // The dashboard note and the account phase's instructions both did. Every
    // one now goes through shown_origin.
    const bootstrap = code(read('deploy/compose/bootstrap-managed.sh'));
    const direct = bootstrap
      .split('\n')
      .filter((l) => /\$\{?(TRIGGER_APP_ORIGIN|TRIGGER_LOGIN_ORIGIN|TRIGGER_TLS_HOST|[A-Z_]+_BIND)\b/.test(l))
      .filter((l) => !/shown_origin\s+"\$\{(TRIGGER_APP_ORIGIN|TRIGGER_LOGIN_ORIGIN)/.test(l));
    expect(direct.map((l) => l.trim())).toEqual([]);
  });

  it('names the key and the line of a .env line bash cannot read, never its value', () => {
    const bootstrap = read('deploy/compose/bootstrap-managed.sh');
    const at = bootstrap.indexOf('load_env() {');
    const loadEnv = bootstrap.slice(at, bootstrap.indexOf('\n}\n', at) + 3);
    const bad = join(dir, 'bad.env');
    // Indented, which the refusal's own pattern allows.
    writeFileSync(bad, `WEB_BIND=${MESH}\n  NEXTCLOUD_TRUSTED_DOMAINS=localhost nextcloud ${MESH}\n`);
    const r = bash(['die() { echo "!!! $*" >&2; exit 1; }', `ENV_FILE="${bad}"`, loadEnv, 'load_env'].join('\n'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NEXTCLOUD_TRUSTED_DOMAINS');
    expect(r.stderr).toMatch(/line 2\b/);
    expect(r.stderr).not.toContain(MESH);
    expect(r.stderr).not.toContain('localhost nextcloud');
  });

  it('says where Nextcloud answered without naming a host that is not loopback', () => {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const stubs: Record<string, string> = {
      docker: '#!/usr/bin/env bash\ncase "$*" in *"occ status"*) echo \'{"installed":true}\' ;; *status.php*) echo 200 ;; esac\nexit 0\n',
      curl: '#!/usr/bin/env bash\ncase "$*" in *"OCS-APIRequest"*) echo "<statuscode>100</statuscode>"; exit 0 ;; *"Depth: 1"*) exit 0 ;; esac\necho "$PROPFIND_CODE"\n',
      sleep: '#!/usr/bin/env bash\nexit 0\n',
    };
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(join(bin, name), body);
      chmodSync(join(bin, name), 0o755);
    }
    const run = (code: string, url?: string) =>
      spawnSync('bash', [join(ROOT, 'deploy/selfhost/setup-nextcloud-users.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          PROPFIND_CODE: code,
          NEXTCLOUD_HOST_PORT: '8083',
          NEXTCLOUD_SOURCE_PASSWORD: 'stub-source-pw',
          NEXTCLOUD_TARGET_PASSWORD: 'stub-target-pw',
          ...(url ? { NEXTCLOUD_URL: url } : {}),
        },
      });
    const ready = run('207', `http://${MESH}:8083`);
    expect(ready.status, ready.stderr).toBe(0);
    expect(ready.stdout).toContain('External DAV ready');
    expect(ready.stdout + ready.stderr).not.toContain(MESH);
    const unreachable = run('000', `http://${MESH}:8083`);
    expect(unreachable.status).toBe(1);
    expect(unreachable.stderr).toContain('000 =');
    expect(unreachable.stdout + unreachable.stderr).not.toContain(MESH);
    // On loopback the URL is the useful thing to print, and is printed.
    expect(run('207').stdout).toContain('http://127.0.0.1:8083');
  });
});

/** Everything a filtered log must not name: this machine, a peer, a visitor. */
const HIDDEN = [...OWN_VALUES, PEER, VISITOR, VISITOR6];

describe('what is written to a file', () => {
  const LOG = [
    `mailpit is not answering at http://${MESH}:3127 — the mail path is unproven`,
    `curl: (7) Failed to connect to ${NEXTCLOUD} port 8083 after 0 ms: Couldn't connect to server`,
    `the status page at http://${FRONT}:3124 answered 502`,
    `{"logger":"http","msg":"enabling automatic TLS certificate management","domains":["${NAME}"]}`,
    `${PEER} - - [27/Sep/2026] "GET / HTTP/1.1" 200 from another peer`,
    `trusted domains: localhost nextcloud ${ZONE} ${FILES} ${TRUSTED}`,
    // The web container's access lines, with the visitor NetBird passes on
    // last (apps/web/nginx.conf.template, ownpace_combined).
    `${PEER} - - [27/Sep/2026:22:54:34 +0000] "GET /grant/:link HTTP/1.1" 200 512 "-" "Mozilla/5.0" "${VISITOR}"`,
    `${PEER} - - [27/Sep/2026:22:54:35 +0000] "GET /api/version HTTP/1.1" 200 64 "-" "curl/8.5.0" "${VISITOR6}, ${PEER}"`,
    `${PEER} - - [27/Sep/2026:22:54:36 +0000] "GET / HTTP/1.1" 200 512 "-" "Mozilla/5.0" "-"`,
    // Near misses, which must survive: a longer address sharing a prefix, and
    // loopback.
    'a neighbour at 192.0.2.100, and the API on http://127.0.0.1:3001',
  ].join('\n');

  it('the artifact keeps neither this machine\'s values nor a mesh address', () => {
    const evidence = join(dir, 'evidence');
    mkdirSync(evidence);
    writeFileSync(join(evidence, 'smoke-managed-1.log'), LOG);
    const r = spawnSync('bash', [join(ROOT, 'deploy/compose/redact-evidence.sh'), evidence], {
      encoding: 'utf8',
      env: { ...process.env, REDACT_ENV_FILE: envFile },
    });
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(join(evidence, 'smoke-managed-1.log'), 'utf8');
    for (const v of HIDDEN) expect(out, `${v} survived`).not.toMatch(whole(v));
    expect(out).not.toMatch(CUT);
    // Replaced by what it is, so the line still reads.
    expect(out).toContain('WEB_BIND');
    expect(out).toContain('<NEXTCLOUD_BIND>');
    expect(out).toContain('<mesh-ip>');
    expect(out).toContain('192.0.2.100');
    expect(out).toContain('http://127.0.0.1:3001');
    expect(out).toContain('localhost nextcloud');
    // The visitor's field says what it was, and a request without one says so.
    expect(out).toContain('"Mozilla/5.0" "<client-ip>"');
    expect(out).toContain('"curl/8.5.0" "<client-ip>"');
    expect(out).toContain('"Mozilla/5.0" "-"');
  });

  it('the smoke filters its own stream, so its log and its evidence are clean at the source', () => {
    // RUN, from the smoke's first line through its `exec`, in a directory laid
    // out like deploy/compose: a smoke that stopped sourcing own-addresses.sh
    // built an empty program, which sed accepts, and filtered nothing.
    const lines = read('deploy/compose/smoke-managed.sh').split('\n');
    const exec = lines.findIndex((l) => /^exec > >\(sed -u -E -e "\$REDACT_OWN_ADDRESSES" \| tee "\$OUT"\) 2>&1$/.test(l));
    expect(exec, 'the smoke tees its output unfiltered').toBeGreaterThan(-1);
    const box = join(dir, 'box');
    mkdirSync(box);
    writeFileSync(join(box, '.env'), ENV);
    for (const f of ['env-read.sh', 'own-addresses.sh', 'managed.yml']) symlinkSync(join(COMPOSE_DIR, f), join(box, f));
    const preamble = join(box, 'preamble.sh');
    writeFileSync(preamble, [...lines.slice(0, exec + 1), 'printf \'%s\\n\' "$1"', 'printf \'%s\\n\' "$1" >&2', ''].join('\n'));
    const kept = join(box, 'smoke.txt');
    const env: Record<string, string | undefined> = { ...process.env, SMOKE_OUT: kept };
    delete env.COMPOSE_PROJECT_NAME;
    const r = spawnSync('bash', [preamble, LOG], { encoding: 'utf8', env });
    expect(r.status, r.stderr).toBe(0);
    const file = readFileSync(kept, 'utf8');
    for (const v of HIDDEN) {
      expect(r.stdout, `${v} reached the stream`).not.toMatch(whole(v));
      expect(file, `${v} reached ${kept}`).not.toMatch(whole(v));
    }
    expect(file).toContain('MAILPIT_BIND');
    expect(file).toContain('<mesh-ip>');
    expect(file).toContain('192.0.2.100');
  });

  it('the filter the smoke uses cleans the lines the smoke prints', () => {
    const piped = spawnSync('bash', ['-c', `. "${ENV_READ}"; . "${OWN}"; sed -u -E -e "$(own_address_sed "$1")"`, 'guard', envFile], {
      encoding: 'utf8',
      input: LOG,
    });
    expect(piped.status, piped.stderr).toBe(0);
    for (const v of HIDDEN) expect(piped.stdout, `${v} survived`).not.toMatch(whole(v));
    expect(piped.stdout).not.toMatch(CUT);
    expect(piped.stdout).toContain('192.0.2.100');
  });

  it('the bring-up\'s container-log dump is filtered the same way', () => {
    const bootstrap = read('deploy/compose/bootstrap-managed.sh');
    const at = bootstrap.indexOf('explain_failure() {');
    const explain = bootstrap.slice(at, bootstrap.indexOf('\n}\n', at) + 3);
    const logFile = join(dir, 'container.log');
    writeFileSync(logFile, LOG);
    const program = [
      // As bootstrap reaches the helper: its own source lines, under its own
      // `set -e`, so a bootstrap that stopped sourcing it is a 127 here.
      'set -euo pipefail',
      `SCRIPT_DIR="${COMPOSE_DIR}"`,
      sourceLines('deploy/compose/bootstrap-managed.sh'),
      `ENV_FILE="${envFile}"`,
      'COMPOSE_PROJECT=ownpace-managed',
      `FATAL_LINE_RE='(ERROR|Error:)'`,
      // A compose that knows one service, and a docker that answers the probe.
      `fake_compose() { case "$1" in ps) if [ "$3" = '{{.Name}}' ]; then echo ownpace-managed-trigger-tls; else echo 'running unhealthy'; fi ;; logs) cat "${logFile}" ;; esac; }`,
      'COMPOSE=(fake_compose)',
      `docker() { echo "--- exit=1: Error: could not reach https://${NAME}:3443 from ${MESH}"; }`,
      explain,
      'explain_failure trigger-tls',
    ].join('\n');
    const r = bash(program);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('trigger-tls');
    for (const v of HIDDEN) expect(r.stderr, `${v} survived`).not.toMatch(whole(v));
  });

  it('setup-zitadel\'s log tail is filtered the same way', () => {
    // Printed when the provider exits during start-up or never answers ready,
    // and in the gate by "The provider step, run a second time" on a failure.
    const setup = read('deploy/compose/setup-zitadel.sh');
    const raw = code(setup)
      .split('\n')
      .filter((l) => /COMPOSE\[@\]\}"\s+logs\b.*>&2\s*$/.test(l));
    expect(raw.map((l) => l.trim()), 'a container log printed unfiltered').toEqual([]);
    const at = setup.indexOf('zitadel_log_tail() {');
    expect(at, 'setup-zitadel.sh has no filtered log tail').toBeGreaterThan(-1);
    const tail = setup.slice(at, setup.indexOf('\n}\n', at) + 3);
    const logFile = join(dir, 'zitadel.log');
    writeFileSync(logFile, LOG);
    const r = bash(
      [
        'set -euo pipefail',
        `SCRIPT_DIR="${COMPOSE_DIR}"`,
        sourceLines('deploy/compose/setup-zitadel.sh'),
        `ENV_FILE="${envFile}"`,
        `fake_compose() { case "$1" in logs) cat "${logFile}" ;; esac; }`,
        'COMPOSE=(fake_compose)',
        tail,
        'zitadel_log_tail',
      ].join('\n'),
    );
    expect(r.status, r.stderr).toBe(0);
    for (const v of HIDDEN) expect(r.stderr, `${v} survived`).not.toMatch(whole(v));
    expect(r.stderr).toContain('<mesh-ip>');
  });

  it('every script that calls the helpers sources them itself', () => {
    // The cases above source what each script sources; this one says so for
    // every script, the ones not tested by name included.
    const users = readdirSync(COMPOSE_DIR)
      .filter((f) => f.endsWith('.sh') && f !== 'own-addresses.sh')
      .filter((f) => /\b(own_address_\w+|shown_origin)\b/.test(code(read(`deploy/compose/${f}`))));
    expect(users.length, 'no script calls the helpers: the scan is looking at nothing').toBeGreaterThan(2);
    expect(users.filter((f) => !SOURCES_OWN.test(read(`deploy/compose/${f}`)))).toEqual([]);
  });
});
