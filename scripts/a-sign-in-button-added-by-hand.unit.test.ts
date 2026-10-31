// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SIGN-IN BUTTON ADDED BY HAND (workplan 0140 T10, the follow-up its Status
 * of 2026-10-21 left open).
 *
 * Live's sign-in page offers email and password only: privacy §4.4, §7 and §8
 * say so, and the owner chose it (ops-social-signin (a), 0139 T0 fact 4).
 * `setup-zitadel.sh` adds Google, Microsoft, GitHub or Apple to the sign-in
 * page whenever that provider's `IDP_*` keys hold a value, and deletes none,
 * since a person may be linked to one. Live's `.env` carries the OTA stack's
 * Google client for the migration consent (0140 T11), a pair easily copied
 * into `IDP_GOOGLE_*` too. `stand-up-live.sh` and `deploy-live.sh` refuse
 * live's `.env` while any of those keys holds a value (#1644, their own guards
 * are `a-first-bring-up-of-live` and `a-deploy-from-a-named-tag`). A
 * `setup-zitadel.sh` run by hand on live, or a `bootstrap-managed.sh` run by
 * hand, which runs it, was checked by nothing: one run, and every tester saw
 * a Google button until every key was emptied and the bring-up ran again.
 *
 * WHAT IS ASSERTED, by running the real script in a copy of `deploy/compose`
 * with `docker` and `curl` replaced by stand-ins that record every call:
 *
 *   Refused, before anything moves: on live's `.env` (and on a slip of its
 *   marker, since a refusal errs towards live: `stack_may_be_live`), a
 *   default run or `--offer-one` while any sign-in key holds a value. Each key
 *   the example declares is tried alone; the list is read from
 *   `managed.env.example` (every `IDP_*` key but `IDP_UPSTREAM_CALLBACK_URL`),
 *   so a provider added there is refused the same day, or this fails. The
 *   refusal names each key and never its value, says email and password only
 *   with the privacy sections, gives the one `env-upsert.sh` line that empties
 *   them, and says that with every key empty the next run turns 'External IDP
 *   allowed' off, so nobody is sent to delete a provider a tester may be
 *   linked to. Nothing was called, the `.env` is byte for byte as it was, and
 *   no secret was generated. A value in double quotes counts, empty ones too,
 *   as the script's own reader takes them.
 *
 *   Not refused: live's `.env` with every key empty or in empty single quotes
 *   (and the three `IDP_*` keys that are not a provider's), with the migration
 *   consent's clients set as live sets them (`GOOGLE_`, `MICROSOFT_` and
 *   `DROPBOX_OAUTH_*`, other keys, which make no button); the OTA stack's
 *   `.env`, which carries no marker, with a pair set, as the nightly gate's
 *   placeholder is; and on live with a pair set, `--print` and the two timer
 *   modes. `--token-only` is the provisioning token's clock, which
 *   `box-duties.sh` runs on live daily: refusing it would let the token die,
 *   and past its deadline no successor can be minted (0132 T7).
 *
 *   The reader is the one the other two scripts use: the script calls
 *   `live_sign_in_keys_set` from `stack-kind.sh` and spells no key itself.
 *
 * Values here are documentation shapes; none is a real client.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(ROOT, 'deploy/compose');
const SETUP = readFileSync(join(ROOT, 'deploy/compose/setup-zitadel.sh'), 'utf8');

const EXAMPLE = readFileSync(join(ROOT, 'deploy/compose/managed.env.example'), 'utf8');
/** Every IDP_* key managed.env.example declares but the identity provider's own return address. */
const SIGN_IN_KEYS = [...EXAMPLE.matchAll(/^(IDP_[A-Z0-9_]+)=/gm)]
  .map((m) => m[1]!)
  .filter((key) => key !== 'IDP_UPSTREAM_CALLBACK_URL');
/**
 * The migration consent's clients (0140 T11), which live's `.env` DOES set: other
 * keys, read by the api and the worker, which make no sign-in button.
 */
const CONSENT_KEYS = [...EXAMPLE.matchAll(/^((?:GOOGLE|MICROSOFT|DROPBOX)_OAUTH_[A-Z_]+)=/gm)].map((m) => m[1]!);

const LIVE_ENV = [
  'COMPOSE_PROJECT_NAME=ownpace-live',
  'STACK_KIND=production',
  'ZITADEL_EXTERNALDOMAIN=id.example.test',
  'ZITADEL_EXTERNALPORT=443',
  'ZITADEL_EXTERNALSECURE=true',
  'ZITADEL_PORT=3126',
  'ZITADEL_PAT_EXPIRY=2026-10-01T00:00:00Z',
  'WEB_URL=https://app.example.test',
  '',
].join('\n');
/** The OTA stack's `.env`: no marker, no project. */
const OTA_ENV = LIVE_ENV.split('\n')
  .filter((l) => !/^(COMPOSE_PROJECT_NAME|STACK_KIND)=/.test(l))
  .join('\n');

const SETUP_UID = '310000000000000009';
const ONE_ORG = { details: { totalResult: '1' }, result: [{ id: '310000000000000001', name: 'ZITADEL' }] };

/** The identity provider, as far as the runs here reach it; anything else answers `{}`. */
const CURL_STUB = [
  '#!/usr/bin/env bash',
  'method=""; url=""; wfmt=""; out=""; prev=""',
  'for a in "$@"; do',
  '  case "$prev" in -X) method="$a" ;; -w) wfmt="$a" ;; -o) out="$a" ;; esac',
  '  case "$a" in http://*|https://*) url="$a" ;; esac',
  '  prev="$a"',
  'done',
  '[ -n "$method" ] || method=GET',
  'rest="${url#*://}"; path="/${rest#*/}"',
  'printf "%s %s\\n" "$method" "$path" >>"$STUB_CALLS"',
  "status=200; body='{}'",
  'case "$method $path" in',
  "  'GET /debug/ready'|'GET /debug/healthz') body='' ;;",
  `  'GET /auth/v1/users/me') body='{"user":{"id":"${SETUP_UID}"}}' ;;`,
  `  'POST /management/v1/users/${SETUP_UID}/pats/_search')`,
  `    body="{\\"result\\":[{\\"id\\":\\"310000000000000011\\",\\"expirationDate\\":\\"$STUB_PAT_EXPIRES\\"}]}" ;;`,
  `  'POST /admin/v1/orgs/_search') body='${JSON.stringify(ONE_ORG)}' ;;`,
  'esac',
  '[ "$out" = /dev/null ] || printf "%s" "$body"',
  `if [ -n "$wfmt" ]; then w="\${wfmt//'%{http_code}'/$status}"; printf '%b' "$w"; fi`,
  'exit 0',
];

/** Compose, as far as the runs reach it: the token volume, read, and `ps`. */
const DOCKER_STUB = [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$*" >>"$STUB_DOCKER"',
  'case " $* " in',
  '  *" run "*" zitadel-machinekey cat /machinekey/pat.txt "*) printf "%s\\n" "old-token-0123456789abcdefghij"; exit 0 ;;',
  `  *" ps "*) printf '%s\\n' '{"Service":"zitadel","State":"running"}'; exit 0 ;;`,
  'esac',
  'exit 0',
];

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
}, 120_000);

function writeExec(path: string, lines: string[]): void {
  writeFileSync(path, `${lines.join('\n')}\n`);
  chmodSync(path, 0o755);
}

interface Run {
  status: number;
  out: string;
  /** What the identity provider was asked, `METHOD /path`. */
  calls: string[];
  /** What docker was asked. */
  docker: string[];
  /** The `.env` after the run. */
  dotEnv: string;
}

/** The real setup-zitadel.sh, in a copy of deploy/compose holding this `.env`. */
function runSetup(dotEnv: string, args: string[] = []): Run {
  const root = mkdtempSync(join(tmpdir(), 'sign-in-by-hand-'));
  tempDirs.push(root);
  const compose = join(root, 'deploy', 'compose');
  cpSync(COMPOSE_DIR, compose, {
    recursive: true,
    filter: (src) => !['.env', 'userlist.txt'].includes(basename(src)),
  });
  const envFile = join(compose, '.env');
  writeFileSync(envFile, dotEnv);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeExec(join(bin, 'curl'), CURL_STUB);
  writeExec(join(bin, 'docker'), DOCKER_STUB);
  const calls = join(root, 'calls.log');
  const docker = join(root, 'docker.log');
  writeFileSync(calls, '');
  writeFileSync(docker, '');
  const r = spawnSync(join(compose, 'setup-zitadel.sh'), args, {
    encoding: 'utf8',
    cwd: root,
    timeout: 60_000,
    env: {
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: root,
      STUB_CALLS: calls,
      STUB_DOCKER: docker,
      STUB_PAT_EXPIRES: new Date(Date.now() + 5 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    },
  });
  const lines = (f: string) => readFileSync(f, 'utf8').split('\n').filter(Boolean);
  return {
    status: r.status ?? -1,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    calls: lines(calls),
    docker: lines(docker),
    dotEnv: readFileSync(envFile, 'utf8'),
  };
}

const CASE_MS = 90_000;
const REFUSED = "refused: the .env has a STACK_KIND line, live's marker (STACK_KIND=production) or something that could be a slip of it";

/** A run stopped by the refusal, before it generated, started or asked anything. */
function expectRefused(r: Run, dotEnv: string, keys: string[]): void {
  expect(r.status, r.out).toBe(1);
  expect(r.out.replace(/: \S+\/deploy\/compose\/\.env has/, ': the .env has')).toContain(`[setup-zitadel] FATAL: ${REFUSED}`);
  for (const key of keys) expect(r.out).toContain(`\n  - ${key}: set.\n`);
  expect(r.out).toContain("Live's sign-in page offers email and password only (privacy §4.4, §7 and §8;\nops-social-signin (a))");
  expect(r.out, 'the line that empties them, every key at once').toMatch(
    new RegExp(`\\n {4}\\S+/deploy/compose/env-upsert\\.sh \\S+/deploy/compose/\\.env ${keys.map((k) => `${k}=`).join(' ')}\\n`),
  );
  expect(r.out, 'with every key empty the next run hides the buttons itself').toContain(
    "with every\none of these keys empty, this script's next run turns 'External IDP allowed'\noff",
  );
  expect(r.out, 'no provider needs deleting, and a tester may be linked to one').not.toMatch(/remove it in the console|delete the provider/);
  expect(r.out).not.toContain('generating any missing secrets');
  expect(r.calls, 'the identity provider was asked something').toEqual([]);
  expect(r.docker, 'docker was asked something').toEqual([]);
  expect(r.dotEnv, 'the .env changed: a secret was generated, or a date written').toBe(dotEnv);
}

/** A run that went past the refusal, to the identity provider. */
function expectWentOn(r: Run): void {
  expect(r.out).not.toContain('refused: ');
  expect(r.out).toContain('generating any missing secrets');
  expect(r.docker.filter((d) => /\bup -d zitadel\b/.test(d)), r.out).toHaveLength(1);
  expect(r.calls, `the run never reached the project:\n${r.out}`).toContain('POST /management/v1/projects/_search');
}

describe("live's sign-in keys, as the example declares them", () => {
  it('are the four providers, eleven keys, and the script spells none of them in its refusal', () => {
    expect(SIGN_IN_KEYS).toEqual([
      'IDP_GOOGLE_CLIENT_ID',
      'IDP_GOOGLE_CLIENT_SECRET',
      'IDP_MICROSOFT_CLIENT_ID',
      'IDP_MICROSOFT_CLIENT_SECRET',
      'IDP_MICROSOFT_TENANT',
      'IDP_GITHUB_CLIENT_ID',
      'IDP_GITHUB_CLIENT_SECRET',
      'IDP_APPLE_CLIENT_ID',
      'IDP_APPLE_TEAM_ID',
      'IDP_APPLE_KEY_ID',
      'IDP_APPLE_PRIVATE_KEY',
    ]);
    // One reader for the three scripts: the list is stack-kind.sh's, and the
    // script asks it, rather than keeping a copy that drifts.
    const start = SETUP.indexOf("case \"${1:-}\" in\n  ''|--offer-one)");
    expect(start, 'the refusal is no longer recognisable in setup-zitadel.sh').toBeGreaterThan(-1);
    const refusal = SETUP.slice(start, SETUP.indexOf('\nesac\n', start));
    expect(refusal).toContain('stack_may_be_live "$ENV_FILE"');
    expect(refusal).toContain('done <<<"$(live_sign_in_keys_set "$ENV_FILE")"');
    expect(refusal, 'the refusal spells a key of its own').not.toMatch(/IDP_[A-Z]/);
  });
});

describe('setup-zitadel.sh refuses a sign-in provider key on live, before anything moves', () => {
  it.each(SIGN_IN_KEYS.map((key, i) => [key, `signin-value-q${i}`] as const))(
    '%s alone, in a default run',
    (key, value) => {
      const dotEnv = `${LIVE_ENV}${key}=${value}\n`;
      const r = runSetup(dotEnv);
      expectRefused(r, dotEnv, [key]);
      expect(r.out, "the file's own value is never printed").not.toContain(value);
    },
    CASE_MS,
  );

  it(
    "the OTA client's pair copied in double quotes, and empty double quotes, which the script's reader takes for a value: every key named, one line empties them",
    () => {
      const dotEnv = `${LIVE_ENV}IDP_GOOGLE_CLIENT_ID="ota-client-q1.apps.example.test"\nIDP_GOOGLE_CLIENT_SECRET="ota-secret-q2"\nIDP_GITHUB_CLIENT_ID=""\nIDP_APPLE_TEAM_ID=\n`;
      const r = runSetup(dotEnv);
      expectRefused(r, dotEnv, ['IDP_GOOGLE_CLIENT_ID', 'IDP_GOOGLE_CLIENT_SECRET', 'IDP_GITHUB_CLIENT_ID']);
      expect(r.out).not.toContain('IDP_APPLE_TEAM_ID');
      expect(r.out).not.toContain('ota-client-q1');
      expect(r.out).not.toContain('ota-secret-q2');
    },
    CASE_MS,
  );

  it(
    'half a pair is refused too: on live a lone key is not a stale leftover to skip aloud, it is a button one paste away',
    () => {
      const dotEnv = `${LIVE_ENV}IDP_MICROSOFT_CLIENT_ID=entra-app-q3\n`;
      expectRefused(runSetup(dotEnv), dotEnv, ['IDP_MICROSOFT_CLIENT_ID']);
    },
    CASE_MS,
  );

  it(
    '--offer-one, which reaches the providers too',
    () => {
      const dotEnv = `${LIVE_ENV}IDP_GOOGLE_CLIENT_ID=signin-q4\nIDP_GOOGLE_CLIENT_SECRET=signin-q5\n`;
      expectRefused(runSetup(dotEnv, ['--offer-one', 'Google']), dotEnv, ['IDP_GOOGLE_CLIENT_ID', 'IDP_GOOGLE_CLIENT_SECRET']);
    },
    CASE_MS,
  );

  it.each([
    ['another value than production', 'STACK_KIND=prod'],
    ['indented, where the reader cannot read it', '  STACK_KIND=production'],
  ])(
    'a slip of the marker, %s: a refusal errs towards live',
    (_label, marker) => {
      const dotEnv = `${LIVE_ENV.replace('STACK_KIND=production', marker)}IDP_GOOGLE_CLIENT_ID=signin-q6\n`;
      expectRefused(runSetup(dotEnv), dotEnv, ['IDP_GOOGLE_CLIENT_ID']);
    },
    CASE_MS,
  );
});

describe('and nothing else', () => {
  it(
    "live's .env as live has it: every sign-in key empty or in empty single quotes, the consent clients set, and the three IDP_* keys that are no provider's: the run goes on",
    () => {
      expect(CONSENT_KEYS, 'the consent clients are no longer found in the example').toEqual([
        'GOOGLE_OAUTH_CLIENT_ID',
        'GOOGLE_OAUTH_CLIENT_SECRET',
        'DROPBOX_OAUTH_CLIENT_ID',
        'DROPBOX_OAUTH_CLIENT_SECRET',
        'MICROSOFT_OAUTH_CLIENT_ID',
        'MICROSOFT_OAUTH_CLIENT_SECRET',
        'MICROSOFT_OAUTH_TENANT',
      ]);
      const keys = SIGN_IN_KEYS.map((key, i) => `${key}=${i % 2 ? "''" : ''}\n`).join('');
      const consent = CONSENT_KEYS.map((key, i) => `${key}=consent-value-q${20 + i}\n`).join('');
      const r = runSetup(
        `${LIVE_ENV}${keys}${consent}IDP_UPSTREAM_CALLBACK_URL=https://id.example.test/ui/login/login/externalidp/callback\nIDP_READY_TIMEOUT=600\nIDP_READ_ATTEMPTS=6\n`,
      );
      expectWentOn(r);
    },
    CASE_MS,
  );

  it(
    "the OTA stack's .env, which carries no marker, with a pair set, as the nightly gate's placeholder is: the run goes on",
    () => {
      const r = runSetup(`${OTA_ENV}IDP_GOOGLE_CLIENT_ID=gate-signin-q7\nIDP_GOOGLE_CLIENT_SECRET=gate-q8\n`);
      expectWentOn(r);
    },
    CASE_MS,
  );

  const WITH_PAIR = `${LIVE_ENV}IDP_GOOGLE_CLIENT_ID=signin-q9\nIDP_GOOGLE_CLIENT_SECRET=signin-q10\n`;

  it(
    "--token-only on live with a pair set: the token's clock runs, as box-duties.sh asks it every day",
    () => {
      const r = runSetup(WITH_PAIR, ['--token-only']);
      expect(r.status, r.out).toBe(0);
      expect(r.out).not.toContain('refused: ');
      expect(r.calls).toContain(`POST /management/v1/users/${SETUP_UID}/pats/_search`);
    },
    CASE_MS,
  );

  it(
    '--count-organisations on live with a pair set: it counts',
    () => {
      const r = runSetup(WITH_PAIR, ['--count-organisations']);
      expect(r.status, r.out).toBe(0);
      expect(r.out).not.toContain('refused: ');
      expect(r.out).toContain('organisations on this instance: 1, as it should be');
    },
    CASE_MS,
  );

  it(
    '--print on live with a pair set: it shows what is configured',
    () => {
      const r = runSetup(WITH_PAIR, ['--print']);
      expect(r.status, r.out).toBe(0);
      expect(r.out).not.toContain('refused: ');
      expect(r.out).toContain('issuer:      https://id.example.test\n');
    },
    CASE_MS,
  );
});
