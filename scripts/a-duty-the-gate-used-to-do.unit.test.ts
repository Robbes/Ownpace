// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DUTY THE GATE USED TO DO (workplan 0132 T7).
 *
 * The nightly managed gate, `.github/workflows/e2e-managed.yml`, tests the OTA
 * stack, and on the way it keeps that stack alive. Two of its steps are not
 * tests at all. `setup-zitadel.sh` runs the identity provider's provisioning
 * token's clock: the token lives seven days and every run replaces it in its
 * last three, and nothing else renews it. `trigger-version.sh drill` dumps the
 * Trigger.dev database (the account, the project and its API keys, the
 * deployments and the encrypted task environment, none of which can be rebuilt
 * without a person and a browser) and proves the dump loads. Live, the second
 * stack on the same machine (0132 D7), is never touched by CI (T1g), so it had
 * neither: four days without a manual run of `setup-zitadel.sh` and live's
 * token could leave its window, and past its deadline no successor can be
 * minted, because minting needs the token that died.
 *
 * `deploy/compose/box-duties.sh` does them for live, from `~/ownpace-live`, on
 * a daily systemd timer, with the two more T7 names: T3's exposure check and
 * 0135 T3's organisation count, which fails the duty above one. And a fifth,
 * `site` (0139 T10): `www-live.sh check`, which fails when live's project
 * holds a `www` service, where a bare `docker compose -f www.yml` in live's
 * checkout puts the site and one `--remove-orphans` removes live or the site,
 * and, when live's `.env` switches the site on, when `ownpace-live-www` is not
 * running and healthy. And a sixth, `strays` (0135 T8): `idp-strays.sh
 * --remove --at-most 20`, which removes the sign-in accounts nobody let in,
 * older than 30 days, and removes none when more than 20 would go.
 *
 * WHAT IS ASSERTED.
 *
 *   The rule. Every `run:` block of `e2e-managed.yml` is read for the scripts
 *   under `deploy/compose/` it runs, in command position (not in an `echo`, not
 *   in a comment), with the first bare word after the script as its
 *   subcommand. Each command is classified, in a closed table: it MAINTAINS the
 *   stack (its effect would be needed on a stack whose code never changed:
 *   renewing what expires, proving the backup of what cannot be rebuilt), or it
 *   is not maintenance (the gate's own plumbing, the deploy of `main`, the
 *   tests, the evidence). An unclassified command fails, so a new step is
 *   classified by whoever adds it. Today the maintenance commands are
 *   `setup-zitadel.sh` and `trigger-version.sh drill`, and each has a form for
 *   live that `box-duties.sh` must run: `setup-zitadel.sh --token-only` (only
 *   the clock, since the rest reconciles the provider's configuration, which a
 *   timer must not do behind the owner's back) and `trigger-version.sh drill`.
 *   The rule reads scripts; a duty written inline in a `run:` block is not
 *   seen, and the table's own comment says so.
 *
 *   `box-duties.sh`, run in a staged checkout with the scripts it calls
 *   replaced by stubs beside it: all six duties run, in order, whatever the
 *   one before did; the exit is non-zero and names every duty that failed and
 *   no other; a missing script or a duty that hangs past its time is a failed
 *   duty, and the next one still runs; a Ctrl-C (SIGINT to the script's
 *   process group, as a terminal sends it) or a SIGTERM during a duty stops
 *   that duty, whose process group `timeout` keeps apart from the terminal's,
 *   asks no later one and exits non-zero; `--token-only` and `drill` are what it
 *   passes; it refuses, before any duty, a `.env` that is not live's
 *   (`stack_is_live`), a project the reader refuses, and an argument; the
 *   drill never takes its dump directory or container from the shell; files
 *   the duties write are the owner's alone (umask 077, the dumps are
 *   secret-bearing); a failure line carries the journal's error priority under
 *   systemd; and this machine's addresses in a duty's output are replaced, on
 *   its stderr as on its stdout (every FATAL of `setup-zitadel.sh` and all of
 *   `trigger-version.sh`'s words are on stderr).
 *
 *   `setup-zitadel.sh`'s two new modes, run for real against a stand-in
 *   identity provider (`curl` and `docker` stubs on PATH). `--token-only` asks
 *   only what the clock asks, rotates when due, and changes nothing in `.env`
 *   but the token's note; it never starts the provider or runs the secret or
 *   alias writers. `--count-organisations` makes reads only, writes nothing,
 *   exits 0 on one and non-zero above one or on no answer, and prints no name.
 *   The default run still reaches the project after the clock. And end to end:
 *   `box-duties.sh` with the real `setup-zitadel.sh` fails `organisations`, and
 *   only it, when the provider answers two.
 *
 *   `www-live.sh check`, run for real with a `docker` stub on PATH: a `www`
 *   container in live's project fails it, named, whatever the switch; with the
 *   switch on, `ownpace-live-www` missing or not healthy fails it; a switch
 *   that is neither `true` nor `false`, and docker that cannot be asked, fail
 *   it too, never pass it; with the switch off it never asks about
 *   `ownpace-live-www`. And end to end, `box-duties.sh` with the real
 *   `www-live.sh` fails `site`, and only it.
 *
 *   The timer. The unit files under `deploy/compose/systemd/` are in
 *   `docs/managed-bring-up.md` word for word, run `box-duties.sh` from
 *   `~/ownpace-live`, daily with `Persistent=true`, at a time in UTC outside
 *   the appliance nightly's hours as `e2e.yml`'s crons give them, plus the five
 *   hours late GitHub has dispatched them and a run's length; and so that a
 *   whole run, as long as the service's `TimeoutStartSec` lets it last, ends
 *   before the next nightly firing.
 *
 * Addresses here are documentation shapes: `100.64.0.1` and RFC 5737's.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(ROOT, 'deploy/compose');
const DUTIES_REL = 'deploy/compose/box-duties.sh';
const DUTIES = join(ROOT, DUTIES_REL);
const GATE_REL = '.github/workflows/e2e-managed.yml';
const NIGHTLY_REL = '.github/workflows/e2e.yml';
const DOC_REL = 'docs/managed-bring-up.md';
const SERVICE_REL = 'deploy/compose/systemd/ownpace-box-duties.service';
const TIMER_REL = 'deploy/compose/systemd/ownpace-box-duties.timer';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const readIfThere = (rel: string): string => (existsSync(join(ROOT, rel)) ? read(rel) : '');
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Shell comments removed: a rule must not be satisfied by its own explanation. */
const code = (text: string): string =>
  text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function writeExec(path: string, lines: string[]): void {
  writeFileSync(path, `${lines.join('\n')}\n`);
  chmodSync(path, 0o755);
}

// ===========================================================================
// The rule: which of the gate's commands maintain the stack
// ===========================================================================

/**
 * Commands of the gate that MAINTAIN the stack, and the form of each that
 * `box-duties.sh` runs for live. Maintenance is what a stack whose code never
 * changed would still need: renewing what expires, proving the backup of what
 * cannot be rebuilt. The rule reads scripts under `deploy/compose/`; a duty
 * written inline in a `run:` block is not seen by it.
 */
const MAINTENANCE: Record<string, { live: string; why: string }> = {
  'setup-zitadel.sh': {
    live: 'setup-zitadel.sh --token-only',
    why:
      "the provisioning token's clock: the token lives seven days and every run replaces it in its last three. " +
      "For live only the clock runs; the rest reconciles the provider's configuration, which a timer must not do (0135).",
  },
  'trigger-version.sh drill': {
    live: 'trigger-version.sh drill',
    why: 'the Trigger.dev database dumped and restored into a throwaway: the backup of what nobody can rebuild unattended, proved',
  },
};

/** Commands of the gate that do not maintain the stack, and what each is for. */
const NOT_MAINTENANCE: Record<string, string> = {
  'env-read.sh': 'the reader of a .env, sourced by a step',
  'refuse-live-env.sh': "the gate's refusal of live's .env before its restore (T1g)",
  'own-addresses.sh': "the job's log: masks this machine's addresses",
  'ensure-env-secrets.sh': "fills the .env the gate restores; live's is the owner's (T1b, D8)",
  'env-upsert.sh': 'the same, one key at a time',
  'bootstrap-managed.sh': 'deploys main, with the demo: live moves by hand, from a tag (T1g, T6)',
  'smoke-managed.sh': 'the test itself',
  'redact-evidence.sh': "the job's evidence, before it is uploaded",
};

/**
 * The duties that are not a gate step: T3's check and 0135 T3's count (T7),
 * the site's (0139 T10), and the accounts nobody let in (0135 T8).
 */
const MORE_DUTIES = [
  'exposure-check.sh',
  'setup-zitadel.sh --count-organisations',
  'www-live.sh check',
  'idp-strays.sh --remove --at-most 20',
];

interface Invocation {
  step: string;
  script: string;
  sub: string | null;
}

/**
 * A script under deploy/compose/ in command position: at the start of a line,
 * after `$(`, `&&`, `||`, `;`, `|`, `{`, `!`, or a shell keyword, optionally
 * through `bash`, `source` or `.`.
 */
const INVOKED =
  /(?:^|\$\(|&&|\|\||[;|{]|\b(?:if|then|else|do|exec|time)[ \t]|![ \t])[ \t]*(?:(?:bash|source|\.)[ \t]+)?(?:\.\/)?deploy\/compose\/([A-Za-z0-9._-]+\.sh)\b([^\n]*)/gm;

/** The first word after the script, when it is a bare word: a subcommand. */
function subcommand(rest: string): string | null {
  const first = rest.trim().split(/\s+/)[0] ?? '';
  if (first === '' || /^[|;&)<>]/.test(first) || /^\d*>/.test(first)) return null;
  return /^[a-z][a-z0-9-]*$/.test(first) ? first : null;
}

function invocationsIn(step: string, run: string): Invocation[] {
  const out: Invocation[] = [];
  for (const m of code(run).matchAll(INVOKED)) {
    out.push({ step, script: m[1] ?? '', sub: subcommand(m[2] ?? '') });
  }
  return out;
}

interface Step {
  name?: string;
  run?: unknown;
}
function gateInvocations(): Invocation[] {
  const doc = parseYaml(read(GATE_REL)) as { jobs?: Record<string, { steps?: Step[] }> };
  const out: Invocation[] = [];
  for (const job of Object.values(doc.jobs ?? {})) {
    for (const [i, step] of (job.steps ?? []).entries()) {
      if (typeof step.run !== 'string') continue;
      out.push(...invocationsIn(step.name ?? `step ${i + 1}`, step.run));
    }
  }
  return out;
}

/** The table key a command falls under: script and subcommand first, then the script. */
function classify(inv: Invocation): { key: string; maintenance: boolean } | null {
  const keys = inv.sub ? [`${inv.script} ${inv.sub}`, inv.script] : [inv.script];
  for (const key of keys) {
    if (key in MAINTENANCE) return { key, maintenance: true };
    if (key in NOT_MAINTENANCE) return { key, maintenance: false };
  }
  return null;
}

describe("the rule: which of the gate's commands maintain the stack", () => {
  it('reads commands, not prose: a comment, an echo or a path in an argument is not a command', () => {
    const run = [
      '# ./deploy/compose/deploy-tasks.sh is in a comment',
      'echo "prerequisites in deploy/compose/deploy-tasks.sh: create the account"',
      '. deploy/compose/env-read.sh',
      'out="$(./deploy/compose/setup-zitadel.sh 2>&1)" || { printf "%s" "$out"; exit 1; }',
      './deploy/compose/trigger-version.sh drill',
      'cp "${PERSIST_DIR}/.env" deploy/compose/.env && ./deploy/compose/env-upsert.sh deploy/compose/.env A=b',
      'if ./deploy/compose/own-addresses.sh --mask deploy/compose/.env; then :; fi',
    ].join('\n');
    expect(invocationsIn('t', run).map((i) => `${i.script}${i.sub ? ` ${i.sub}` : ''}`)).toEqual([
      'env-read.sh',
      'setup-zitadel.sh',
      'trigger-version.sh drill',
      'env-upsert.sh',
      'own-addresses.sh',
    ]);
  });

  const found = gateInvocations();

  it(`finds the gate's commands in ${GATE_REL}`, () => {
    expect(found.length, 'the reader found no command in the gate: it has stopped reading it').toBeGreaterThan(5);
  });

  it('every command the gate runs is classified, as maintenance or as not', () => {
    const unclassified = found.filter((i) => classify(i) === null).map((i) => `${i.step}: ${i.script} ${i.sub ?? ''}`);
    expect(
      unclassified,
      'a new command in the gate. If it maintains the stack (live would need it too), add it to MAINTENANCE with\n' +
        'the form box-duties.sh runs for live, and run it there; otherwise add it to NOT_MAINTENANCE, saying why',
    ).toEqual([]);
  });

  it('every entry of the tables is still something the gate runs', () => {
    const used = new Set(found.map((i) => classify(i)?.key));
    const stale = [...Object.keys(MAINTENANCE), ...Object.keys(NOT_MAINTENANCE)].filter((k) => !used.has(k));
    expect(
      stale,
      'the gate no longer runs this. If it was a maintenance command that 0134 retired, take it out of\n' +
        'box-duties.sh too, and out of the table',
    ).toEqual([]);
  });

  it('today the maintenance commands are setup-zitadel.sh and trigger-version.sh drill', () => {
    const maintenance = [...new Set(found.flatMap((i) => (classify(i)?.maintenance ? [classify(i)?.key] : [])))];
    expect(maintenance.sort()).toEqual(['setup-zitadel.sh', 'trigger-version.sh drill']);
  });
});

describe('box-duties.sh runs every maintenance command, in its form for live, and the duties T7, 0139 T10 and 0135 T8 add', () => {
  const text = readIfThere(DUTIES_REL);
  const lines = code(text).split('\n');

  it('exists', () => {
    expect(existsSync(DUTIES), `${DUTIES_REL} is 0132 T7's script, and it is not there`).toBe(true);
  });

  const forms = [...Object.values(MAINTENANCE).map((m) => m.live), ...MORE_DUTIES];
  it.each(forms)('runs `%s` from beside itself', (form) => {
    const [script = '', ...args] = form.split(' ');
    const re = new RegExp(`\\$\\{SCRIPT_DIR\\}/${esc(script)}"?${args.map((a) => `\\s+${esc(a)}`).join('')}(?![\\w-])`);
    expect(
      lines.filter((l) => re.test(l)),
      `${DUTIES_REL} does not run "\${SCRIPT_DIR}/${script}"${args.length ? ` ${args.join(' ')}` : ''}`,
    ).not.toEqual([]);
  });

  it('reads the .env and live\'s marker the way the other scripts do, and never traces itself', () => {
    for (const helper of ['env-read.sh', 'stack-kind.sh', 'own-addresses.sh']) {
      expect(text, `sources ${helper}`).toMatch(new RegExp(`^\\. "\\$\\{SCRIPT_DIR\\}/${esc(helper)}"$`, 'm'));
    }
    expect(code(text)).toMatch(/\bstack_is_live\b/);
    expect(code(text)).toMatch(/\bcompose_project\b/);
    expect(code(text), 'set -x would print every value it reads').not.toMatch(/set\s+-[a-wyz]*x/);
    expect(text).toMatch(/^set -euo pipefail$/m);
  });
});

// ===========================================================================
// box-duties.sh, with the scripts it runs replaced by stubs
// ===========================================================================

const DUTY_NAMES = ['token', 'drill', 'exposure', 'organisations', 'site', 'strays'] as const;
type Duty = (typeof DUTY_NAMES)[number];

/** This machine, in a live `.env`: a mesh address, a front address, and a secret. */
const MESH = '100.64.0.1';
const FRONT = '192.0.2.10';
const SENTINEL = 'sentinel-5d2e9a';
const LIVE_ENV = [
  'COMPOSE_PROJECT_NAME=ownpace-live',
  'STACK_KIND=production',
  'ZITADEL_EXTERNALDOMAIN=id.example.test',
  'ZITADEL_EXTERNALPORT=443',
  'ZITADEL_EXTERNALSECURE=true',
  'ZITADEL_PORT=3126',
  'ZITADEL_PAT_EXPIRY=2026-10-01T00:00:00Z',
  'WEB_URL=https://app.example.test',
  `WEB_BIND=${MESH}`,
  `STATUS_BIND=${FRONT}`,
  `POSTGRES_PASSWORD=${SENTINEL}`,
  '',
].join('\n');
/** The OTA stack's `.env`: no marker, no project. */
const OTA_ENV = LIVE_ENV.split('\n')
  .filter((l) => !/^(COMPOSE_PROJECT_NAME|STACK_KIND)=/.test(l))
  .join('\n');

/**
 * A stand-in for a script box-duties.sh runs. It records what it was asked,
 * the drill's three overrides and the umask, says one address on stdout and
 * the other on stderr, fails or hangs when the test says so, and notes in
 * STUB_DONE that it ran to its end.
 */
const DUTY_STUB = [
  '#!/usr/bin/env bash',
  'asked="$(basename "$0")${1:+ $*}"',
  'case "$asked" in',
  '  "setup-zitadel.sh --token-only") duty=token ;;',
  '  "trigger-version.sh drill") duty=drill ;;',
  '  "exposure-check.sh") duty=exposure ;;',
  '  "setup-zitadel.sh --count-organisations") duty=organisations ;;',
  '  "www-live.sh check") duty=site ;;',
  '  "idp-strays.sh --remove --at-most 20") duty=strays ;;',
  '  *) duty="unknown" ;;',
  'esac',
  'printf "%s|%s|%s|%s|%s\\n" "$asked" "${MANAGED_BACKUP_DIR-unset}" "${MANAGED_ENV_PERSIST_DIR-unset}" "${TRIGGER_DB_CONTAINER-unset}" "$(umask)" >>"$STUB_LOG"',
  `echo "[stub] \${duty}: reached ${MESH} on the way"`,
  `echo "[stub] \${duty}: and ${FRONT}, said on stderr" >&2`,
  'case ",${STUB_HANG:-}," in *",${duty},"*) sleep 30 ;; esac',
  '[ -z "${STUB_DONE:-}" ] || echo "$duty" >>"$STUB_DONE"',
  'case ",${STUB_FAIL:-}," in *",${duty},"*) echo "[stub] ${duty}: failed" >&2; exit 1 ;; esac',
  'echo "[stub] ${duty}: ok"',
];

interface Stage {
  root: string;
  compose: string;
  log: string;
}

/** A checkout of live: box-duties.sh, what it sources, managed.yml, a `.env`, and stubs beside it. */
function stage(dotEnv: string = LIVE_ENV): Stage {
  if (!existsSync(DUTIES)) throw new Error(`${DUTIES_REL} does not exist`);
  const root = tempDir('box-duties-');
  const compose = join(root, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of ['box-duties.sh', 'env-read.sh', 'stack-kind.sh', 'own-addresses.sh', 'managed.yml']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  }
  chmodSync(join(compose, 'box-duties.sh'), 0o755);
  for (const f of ['setup-zitadel.sh', 'trigger-version.sh', 'exposure-check.sh', 'www-live.sh', 'idp-strays.sh']) {
    writeExec(join(compose, f), DUTY_STUB);
  }
  writeFileSync(join(compose, '.env'), dotEnv);
  const log = join(root, 'stub.log');
  writeFileSync(log, '');
  return { root, compose, log };
}

function runDuties(s: Stage, extra: NodeJS.ProcessEnv = {}, args: string[] = []) {
  // A clean environment, so the shell this test runs in cannot choose a stack.
  const r = spawnSync(join(s.compose, 'box-duties.sh'), args, {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: s.root, STUB_LOG: s.log, ...extra },
    cwd: s.root,
    timeout: 60_000,
  });
  const asked = readFileSync(s.log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('|'));
  return {
    status: r.status ?? -1,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    asked,
  };
}

/** The duties the closing line names as failed. */
function failed(out: string): string[] {
  const m = /FAILED: ([a-z, ]+) \(/.exec(out);
  return m?.[1] ? m[1].split(', ') : [];
}

const IN_ORDER = [
  'setup-zitadel.sh --token-only',
  'trigger-version.sh drill',
  'exposure-check.sh',
  'setup-zitadel.sh --count-organisations',
  'www-live.sh check',
  'idp-strays.sh --remove --at-most 20',
];

describe('box-duties.sh runs every duty, and names every one that failed', () => {
  it('runs the six duties in order, token first so the count and the strays use a live token, and passes when all pass', () => {
    const r = runDuties(stage());
    expect(r.status, r.out).toBe(0);
    expect(r.asked.map((a) => a[0])).toEqual(IN_ORDER);
    expect(r.out).toMatch(/all 6 duties passed/);
    expect(failed(r.out)).toEqual([]);
  });

  it.each(DUTY_NAMES.map((d) => [d]))('a failing %s does not stop the next, and is the one named', (duty: Duty) => {
    const r = runDuties(stage(), { STUB_FAIL: duty });
    expect(r.status, r.out).toBe(1);
    expect(r.asked.map((a) => a[0]), 'a duty after the failing one did not run').toEqual(IN_ORDER);
    expect(failed(r.out)).toEqual([duty]);
  });

  it('names every duty that failed, and no other', () => {
    const two = runDuties(stage(), { STUB_FAIL: 'token,exposure' });
    expect(two.status).toBe(1);
    expect(failed(two.out)).toEqual(['token', 'exposure']);
    const all = runDuties(stage(), { STUB_FAIL: DUTY_NAMES.join(',') });
    expect(all.status).toBe(1);
    expect(all.asked).toHaveLength(6);
    expect(failed(all.out)).toEqual([...DUTY_NAMES]);
  });

  it('a script that is not in the checkout is a failed duty, named, and the rest still run', () => {
    // A checkout copied in part, or a script removed by hand.
    const s = stage();
    rmSync(join(s.compose, 'exposure-check.sh'));
    const r = runDuties(s);
    expect(r.status, r.out).toBe(1);
    expect(failed(r.out)).toEqual(['exposure']);
    expect(r.out).toMatch(/exposure-check\.sh is not in this checkout/);
    expect(r.asked.map((a) => a[0])).toEqual(IN_ORDER.filter((a) => a !== 'exposure-check.sh'));
  });

  it('a duty that hangs past its time is a failed duty, and the next one runs', () => {
    const r = runDuties(stage(), { STUB_HANG: 'drill', BOX_DUTY_TIMEOUT: '1' });
    expect(r.status, r.out).toBe(1);
    expect(failed(r.out)).toEqual(['drill']);
    expect(r.out).toMatch(/drill: timed out after 1s/);
    expect(r.asked.map((a) => a[0])).toEqual(IN_ORDER);
  });

  // A terminal's Ctrl-C is a SIGINT to its foreground process group, which is
  // box-duties.sh and its filter. `timeout` (without --foreground) moves the
  // duty into a process group of its own, so the signal never reaches it: left
  // alone, the duty runs on, the filter dies, the duty's next line is a
  // SIGPIPE, and the next duty starts, the drill on live's database among
  // them. A SIGTERM to the script alone (a `kill` by hand) is the same.
  // Stand in for the terminal with a process group of the test's own.
  it.each([
    ['a Ctrl-C (SIGINT to its process group)', 'SIGINT', 130, 'group'],
    ['a SIGTERM to the script', 'SIGTERM', 143, 'script'],
  ] as const)(
    '%s during a duty stops that duty, asks no later one, and exits non-zero',
    async (_what, signal, code, target) => {
      const s = stage();
      const done = join(s.root, 'done.log');
      writeFileSync(done, '');
      const child = spawn(join(s.compose, 'box-duties.sh'), [], {
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: s.root,
          STUB_LOG: s.log,
          STUB_DONE: done,
          STUB_HANG: 'token',
        },
        cwd: s.root,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
      let gone = false;
      const exited = new Promise<number | null>((resolve) =>
        child.on('exit', (c) => {
          gone = true;
          resolve(c);
        }),
      );
      const pid = child.pid ?? 0;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      try {
        for (let i = 0; i < 400 && !readFileSync(s.log, 'utf8').includes('setup-zitadel.sh --token-only'); i++) {
          await sleep(50);
        }
        expect(readFileSync(s.log, 'utf8'), 'the token duty never started').toContain('setup-zitadel.sh --token-only');
        process.kill(target === 'group' ? -pid : pid, signal);
        // The stub would sleep 30 seconds: well before that, it is stopped.
        const status = await Promise.race([exited, sleep(15_000).then(() => 'still running' as const)]);
        expect(status, `box-duties.sh did not stop within 15 seconds:\n${out}`).toBe(code);
        const asked = readFileSync(s.log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => l.split('|')[0]);
        expect(asked, `a later duty ran after ${signal}:\n${out}`).toEqual(['setup-zitadel.sh --token-only']);
        expect(readFileSync(done, 'utf8'), `the token duty ran on to its end after ${signal}`).not.toContain('token');
        expect(out).toMatch(new RegExp(`interrupted \\(${signal}\\) during token; no later duty ran`));
        expect(out, 'what the stopped duty said was lost').toContain('[stub] token: reached <WEB_BIND> on the way');
        expect(out, 'what the stopped duty said on stderr was lost').toContain('[stub] token: and <STATUS_BIND>, said on stderr');
      } finally {
        if (!gone) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            // Gone meanwhile.
          }
        }
      }
    },
    30_000,
  );

  it('refuses a duty time that is not a number of seconds, before any duty', () => {
    const r = runDuties(stage(), { BOX_DUTY_TIMEOUT: '10m' });
    expect(r.status).toBe(2);
    expect(r.asked).toEqual([]);
  });

  it("under systemd a failure line carries the journal's error priority, and not otherwise", () => {
    // systemd names the stream it connected in JOURNAL_STREAM (device:inode).
    // Stand in for it with a file on stderr, and name that file.
    const s = stage();
    const errFile = join(s.root, 'stderr.journal');
    writeFileSync(errFile, '');
    const fd = openSync(errFile, 'a');
    const { dev, ino } = statSync(errFile);
    try {
      const r = spawnSync(join(s.compose, 'box-duties.sh'), [], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: s.root,
          STUB_LOG: s.log,
          STUB_FAIL: 'drill',
          JOURNAL_STREAM: `${dev}:${ino}`,
        },
        cwd: s.root,
        stdio: ['ignore', 'pipe', fd],
        timeout: 60_000,
      });
      const journal = readFileSync(errFile, 'utf8');
      expect(r.status, journal).toBe(1);
      expect(journal).toMatch(/^<3>\[box-duties\] FAILED: drill \(/m);
      expect(journal).toMatch(/^<3>\[box-duties\] drill: failed/m);
    } finally {
      closeSync(fd);
    }
    // A shell that inherited the variable, with a terminal (here a pipe) on stderr.
    const inherited = runDuties(stage(), { STUB_FAIL: 'drill', JOURNAL_STREAM: `${dev}:${ino}` });
    expect(inherited.out).not.toMatch(/^<\d>/m);
    const terminal = runDuties(stage(), { STUB_FAIL: 'drill' });
    expect(terminal.out).not.toMatch(/^<\d>/m);
    expect(failed(terminal.out)).toEqual(['drill']);
  });
});

describe('box-duties.sh keeps to live, and to what it may print', () => {
  it("refuses the OTA stack's .env before any duty: those are the gate's", () => {
    const r = runDuties(stage(OTA_ENV));
    expect(r.status, r.out).toBe(2);
    expect(r.asked, 'a duty ran on a .env that is not live').toEqual([]);
    expect(r.out).toContain('STACK_KIND');
  });

  it("refuses a value that is not exactly live's marker, and never prints it", () => {
    const r = runDuties(stage(LIVE_ENV.replace('STACK_KIND=production', 'STACK_KIND=alpha-stack')));
    expect(r.status).toBe(2);
    expect(r.asked).toEqual([]);
    expect(r.out).toContain('STACK_KIND');
    expect(r.out).not.toContain('alpha-stack');
  });

  it("refuses live's marker on the OTA stack's project, and a shell that names the other stack", () => {
    const noProject = runDuties(stage(LIVE_ENV.replace('COMPOSE_PROJECT_NAME=ownpace-live\n', '')));
    expect(noProject.status).toBe(2);
    expect(noProject.asked).toEqual([]);
    const otherShell = runDuties(stage(), { COMPOSE_PROJECT_NAME: 'somebody-else' });
    expect(otherShell.status).toBe(2);
    expect(otherShell.asked).toEqual([]);
  });

  it('refuses a missing .env, and an argument, before any duty', () => {
    const s = stage();
    rmSync(join(s.compose, '.env'));
    const none = runDuties(s);
    expect(none.status).toBe(2);
    expect(none.asked).toEqual([]);
    const arg = runDuties(stage(), {}, ['--only', 'token']);
    expect(arg.status).toBe(2);
    expect(arg.asked).toEqual([]);
  });

  it("the drill's dumps go where T1 derives them: never to a directory or container the shell names", () => {
    const r = runDuties(stage(), {
      MANAGED_BACKUP_DIR: '/elsewhere/trigger-backups',
      MANAGED_ENV_PERSIST_DIR: '/elsewhere',
      TRIGGER_DB_CONTAINER: 'another-stacks-database',
    });
    expect(r.status, r.out).toBe(0);
    const drill = r.asked.find((a) => a[0] === 'trigger-version.sh drill');
    expect(drill?.slice(1, 4)).toEqual(['unset', 'unset', 'unset']);
  });

  it('what the duties write is the owner\'s alone: the dumps are secret-bearing', () => {
    const r = runDuties(stage(), { STUB_FAIL: '' });
    for (const a of r.asked) expect(a[4], a[0]).toBe('0077');
  });

  it("replaces this machine's addresses in a duty's stdout and stderr alike, and prints no value of its own from the .env", () => {
    // The stub says the mesh address on stdout and the front address on
    // stderr, as trigger-version.sh says everything and setup-zitadel.sh its
    // FATALs.
    const r = runDuties(stage(), { STUB_FAIL: 'exposure' });
    for (const [stream, text] of [
      ['stdout', r.stdout],
      ['stderr', r.stderr],
    ] as const) {
      expect(text, `box-duties.sh's ${stream} names the mesh address`).not.toContain(MESH);
      expect(text, `box-duties.sh's ${stream} names the front address`).not.toContain(FRONT);
      expect(text, `box-duties.sh's ${stream} prints a value from the .env`).not.toContain(SENTINEL);
    }
    // Replaced, not dropped: the stdout line and the stderr line both arrive.
    expect(r.out, "the duty's stdout line did not arrive, filtered").toContain('<WEB_BIND>');
    expect(r.out, "the duty's stderr line did not arrive, filtered").toContain('<STATUS_BIND>');
  });
});

// ===========================================================================
// The site's duty, run for real: www-live.sh check (workplan 0139 T10)
// ===========================================================================

const SITE_CHECK_REL = 'deploy/compose/www-live.sh';
/** Live's `.env` with the site switched on (the front's address as its bind). */
const SITE_ON_ENV = `${LIVE_ENV}WWW_LIVE=true\nWWW_PORT=20125\nWWW_BIND=${FRONT}\n`;

/**
 * docker for the site's duty. `ps` filtered on live's project and the `www`
 * service answers STUB_LIVE_WWW (names, comma-separated); on
 * `ownpace-live-www` it answers a container id when STUB_SITE_STATE is set,
 * and `inspect` answers that state. STUB_DOCKER_FAIL fails every call.
 */
const SITE_DOCKER_STUB = [
  '#!/usr/bin/env bash',
  'printf "docker %s\\n" "$*" >>"$STUB_LOG"',
  'if [ -n "${STUB_DOCKER_FAIL:-}" ]; then echo "Cannot connect to the Docker daemon" >&2; exit 1; fi',
  'case "$1 $*" in',
  '  "ps "*label=com.docker.compose.project=ownpace-live-www\\ *label=com.docker.compose.service=www*)',
  '    [ -z "${STUB_SITE_STATE:-}" ] || echo 5173e0001 ;;',
  '  "ps "*label=com.docker.compose.project=ownpace-live\\ *label=com.docker.compose.service=www*)',
  '    [ -z "${STUB_LIVE_WWW:-}" ] || echo "$STUB_LIVE_WWW" | tr , "\\n" ;;',
  '  "inspect "*5173e0001) echo "$STUB_SITE_STATE" ;;',
  '  *) echo "docker stub: unexpected call: $*" >&2; exit 98 ;;',
  'esac',
];

describe("the site's duty, run for real: www-live.sh check (0139 T10)", () => {
  function siteStage(dotEnv: string) {
    if (!existsSync(join(ROOT, SITE_CHECK_REL))) throw new Error(`${SITE_CHECK_REL} does not exist`);
    const s = stage(dotEnv);
    copyFileSync(join(ROOT, SITE_CHECK_REL), join(s.compose, 'www-live.sh'));
    chmodSync(join(s.compose, 'www-live.sh'), 0o755);
    const bin = join(s.root, 'bin');
    mkdirSync(bin);
    writeExec(join(bin, 'docker'), SITE_DOCKER_STUB);
    return { ...s, bin };
  }
  function check(s: ReturnType<typeof siteStage>, extra: NodeJS.ProcessEnv = {}) {
    const r = spawnSync(join(s.compose, 'www-live.sh'), ['check'], {
      encoding: 'utf8',
      env: { PATH: `${s.bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: s.root, STUB_LOG: s.log, ...extra },
      cwd: s.root,
      timeout: 30_000,
    });
    const docker = readFileSync(s.log, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('docker '));
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, docker };
  }
  const expectQuiet = (out: string) => {
    for (const v of [MESH, FRONT, SENTINEL, '20125']) expect(out, `it printed ${v}`).not.toContain(v);
  };

  it("switched off, and no www service in live's project: passes, and never asks about ownpace-live-www", () => {
    const r = check(siteStage(LIVE_ENV), { STUB_SITE_STATE: 'running unhealthy' });
    expect(r.status, r.out).toBe(0);
    expect(r.docker.some((l) => /label=com\.docker\.compose\.project=ownpace-live /.test(l)), r.docker.join('\n')).toBe(true);
    expect(r.docker.filter((l) => l.includes('ownpace-live-www') || l.startsWith('docker inspect'))).toEqual([]);
    expectQuiet(r.out);
  });

  it.each([
    ['switched off', LIVE_ENV],
    ['switched on, the site healthy', SITE_ON_ENV],
  ])("a www container in live's project fails it, named (%s): one --remove-orphans there removes live or the site", (_l, dotEnv) => {
    const r = check(siteStage(dotEnv), { STUB_LIVE_WWW: 'ownpace-live', STUB_SITE_STATE: 'running healthy' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/a container of ownpace-live has the compose service www: ownpace-live\b/);
    expect(r.out).toContain('docker rm -f');
    expectQuiet(r.out);
  });

  it('switched on, and ownpace-live-www running and healthy: passes', () => {
    const r = check(siteStage(SITE_ON_ENV), { STUB_SITE_STATE: 'running healthy' });
    expect(r.status, r.out).toBe(0);
    expect(r.docker.some((l) => l.includes('label=com.docker.compose.project=ownpace-live-www'))).toBe(true);
    expectQuiet(r.out);
  });

  it.each([
    ['not there at all', {}, /ownpace-live-www has no container/],
    ['unhealthy', { STUB_SITE_STATE: 'running unhealthy' }, /running unhealthy/],
    ['still starting', { STUB_SITE_STATE: 'running starting' }, /running starting/],
    ['stopped', { STUB_SITE_STATE: 'exited none' }, /exited none/],
  ] as const)('switched on, and ownpace-live-www %s: fails, saying what it found', (_l, extra, why) => {
    const r = check(siteStage(SITE_ON_ENV), { ...extra });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(why);
    expectQuiet(r.out);
  });

  it('a switch that is neither true nor false fails it, naming the key and not the value', () => {
    const r = check(siteStage(SITE_ON_ENV.replace('WWW_LIVE=true', 'WWW_LIVE=maybe-later')), { STUB_SITE_STATE: 'running healthy' });
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain('WWW_LIVE');
    expect(r.out).not.toContain('maybe-later');
  });

  it('docker that cannot be asked fails it, and is never taken for nothing there (hard rule 9)', () => {
    for (const dotEnv of [LIVE_ENV, SITE_ON_ENV]) {
      const r = check(siteStage(dotEnv), { STUB_DOCKER_FAIL: '1' });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/docker could not be asked/);
    }
  });

  it("refuses the OTA stack's .env, and an argument it does not know", () => {
    const ota = check(siteStage(OTA_ENV));
    expect(ota.status, ota.out).toBe(2);
    expect(ota.out).toContain('STACK_KIND');
    expect(ota.docker).toEqual([]);
    const s = siteStage(LIVE_ENV);
    const r = spawnSync(join(s.compose, 'www-live.sh'), ['up'], {
      encoding: 'utf8',
      env: { PATH: `${s.bin}:${process.env.PATH ?? ''}`, HOME: s.root, STUB_LOG: s.log },
    });
    expect(r.status).toBe(2);
  });

  it('end to end: box-duties.sh with the real www-live.sh fails site, and only it', () => {
    const s = siteStage(LIVE_ENV);
    const r = runDuties(s, { PATH: `${s.bin}:${process.env.PATH ?? ''}`, STUB_LIVE_WWW: 'ownpace-live' });
    expect(r.status, r.out).toBe(1);
    expect(failed(r.out)).toEqual(['site']);
    expect(r.out).toMatch(/\(1 of 6 duties\)/);
    // The stubbed duties, in order; the site's duty asked docker itself.
    expect(r.asked.map((a) => a[0] ?? '').filter((a) => !a.startsWith('docker '))).toEqual(
      IN_ORDER.filter((a) => a !== 'www-live.sh check'),
    );
  });
});

// ===========================================================================
// setup-zitadel.sh's two modes, against a stand-in identity provider
// ===========================================================================

const SETUP_UID = '310000000000000009';
const OLD_TOKEN = 'old-token-0123456789abcdefghij';
const MINTED = 'minted-token-0123456789abcdefghij';
const TWO_ORGS = {
  details: { totalResult: '2' },
  result: [
    { id: '310000000000000001', name: 'ZITADEL', primaryDomain: 'zitadel.example.test' },
    { id: '310000000000000002', name: 'Acme Stranger BV', primaryDomain: 'acme-stranger-bv.example.test' },
  ],
};
const ONE_ORG = { details: { totalResult: '1' }, result: [TWO_ORGS.result[0]] };

/** The pinned provider's answers to the calls the modes make; anything else answers `{}`. */
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
  `  'POST /management/v1/users/${SETUP_UID}/pats') body='{"token":"${MINTED}","tokenId":"310000000000000012"}' ;;`,
  `  'POST /admin/v1/orgs/_search') body="$STUB_ORGS"; status="\${STUB_ORGS_STATUS:-200}" ;;`,
  'esac',
  '[ "$out" = /dev/null ] || printf "%s" "$body"',
  `if [ -n "$wfmt" ]; then w="\${wfmt//'%{http_code}'/$status}"; printf '%b' "$w"; fi`,
  'exit 0',
];

/** Compose, as far as the modes reach it: the token volume, read and written, and `ps`. */
const DOCKER_STUB = [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$*" >>"$STUB_DOCKER"',
  'case " $* " in',
  '  *" run "*" zitadel-machinekey sh -c "*) cat >"$STUB_PAT_FILE"; exit 0 ;;',
  '  *" run "*" zitadel-machinekey cat /machinekey/pat.txt "*) cat "$STUB_PAT_FILE"; exit 0 ;;',
  `  *" ps "*) printf '%s\\n' '{"Service":"zitadel","State":"running"}'; exit 0 ;;`,
  'esac',
  'exit 0',
];

interface Provider {
  root: string;
  compose: string;
  env: NodeJS.ProcessEnv;
  calls: () => string[];
  docker: () => string[];
  token: () => string;
  dotEnv: () => string;
}

const isoIn = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A whole copy of deploy/compose, live's `.env`, and the stand-in provider on PATH. */
function provider(opts: { expiresInDays: number; orgs?: unknown; orgsStatus?: number }): Provider {
  const root = tempDir('box-duties-idp-');
  const compose = join(root, 'deploy', 'compose');
  cpSync(COMPOSE_DIR, compose, {
    recursive: true,
    filter: (src) => !['.env', 'userlist.txt'].includes(basename(src)),
  });
  writeFileSync(join(compose, '.env'), LIVE_ENV);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeExec(join(bin, 'curl'), CURL_STUB);
  writeExec(join(bin, 'docker'), DOCKER_STUB);
  const calls = join(root, 'calls.log');
  const docker = join(root, 'docker.log');
  const pat = join(root, 'pat.txt');
  writeFileSync(calls, '');
  writeFileSync(docker, '');
  writeFileSync(pat, `${OLD_TOKEN}\n`);
  const lines = (f: string) => readFileSync(f, 'utf8').split('\n').filter(Boolean);
  return {
    root,
    compose,
    env: {
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: root,
      STUB_CALLS: calls,
      STUB_DOCKER: docker,
      STUB_PAT_FILE: pat,
      STUB_PAT_EXPIRES: isoIn(opts.expiresInDays),
      STUB_ORGS: JSON.stringify(opts.orgs ?? ONE_ORG),
      STUB_ORGS_STATUS: String(opts.orgsStatus ?? 200),
    },
    calls: () => lines(calls),
    docker: () => lines(docker),
    token: () => readFileSync(pat, 'utf8').trim(),
    dotEnv: () => readFileSync(join(compose, '.env'), 'utf8'),
  };
}

function runSetup(p: Provider, args: string[]) {
  const r = spawnSync(join(p.compose, 'setup-zitadel.sh'), args, {
    encoding: 'utf8',
    env: p.env,
    cwd: p.root,
    timeout: 60_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Every line of a `.env` but the token's note. */
const withoutNote = (text: string) =>
  text
    .split('\n')
    .filter((l) => !l.startsWith('ZITADEL_PAT_EXPIRY='))
    .join('\n');
const note = (text: string) => /^ZITADEL_PAT_EXPIRY=(.*)$/m.exec(text)?.[1] ?? '';

/** A call that changes nothing at the provider: a GET, or a search. */
const isRead = (call: string) => call.startsWith('GET ') || /^POST \S*\/_search$/.test(call);

describe('setup-zitadel.sh --token-only runs the clock and nothing else', () => {
  it('with days to spare: asks when the token dies, notes it, and asks nothing more', () => {
    const p = provider({ expiresInDays: 5 });
    const before = p.dotEnv();
    const r = runSetup(p, ['--token-only']);
    expect(r.status, r.out).toBe(0);
    expect(p.calls()).toEqual([
      'GET /debug/healthz',
      'GET /debug/ready',
      'GET /auth/v1/users/me',
      `POST /management/v1/users/${SETUP_UID}/pats/_search`,
    ]);
    expect(p.token()).toBe(OLD_TOKEN);
    expect(withoutNote(p.dotEnv()), 'the secret or alias writer ran').toBe(withoutNote(before));
    expect(note(p.dotEnv())).toBe(p.env.STUB_PAT_EXPIRES);
    expect(p.docker().filter((d) => / up /.test(` ${d} `)), 'it started the provider').toEqual([]);
    expect(r.out).not.toContain('generating any missing secrets');
    expect(r.out).not.toContain(OLD_TOKEN);
  });

  it('in its last three days: mints, proves, lands and reads back the successor, deletes the old one, and stops there', () => {
    const p = provider({ expiresInDays: 1 });
    const before = p.dotEnv();
    const r = runSetup(p, ['--token-only']);
    expect(r.status, r.out).toBe(0);
    expect(p.token(), 'the volume does not hold the successor').toBe(MINTED);
    const calls = p.calls();
    expect(calls).toContain(`POST /management/v1/users/${SETUP_UID}/pats`);
    expect(calls).toContain(`DELETE /management/v1/users/${SETUP_UID}/pats/310000000000000011`);
    expect(
      calls.filter((c) => /\/projects|\/admin\/|\/policies|\/idps|\/smtp|\/email|\/domains/.test(c)),
      'it went on past the clock',
    ).toEqual([]);
    expect(withoutNote(p.dotEnv())).toBe(withoutNote(before));
    const days = (Date.parse(note(p.dotEnv())) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(r.out).not.toContain(MINTED);
    expect(r.out).not.toContain(OLD_TOKEN);
  });
});

describe('setup-zitadel.sh --count-organisations reads, and fails above one', () => {
  it('one: exit 0, said plainly, reads only, writes nothing', () => {
    const p = provider({ expiresInDays: 5, orgs: ONE_ORG });
    const before = p.dotEnv();
    const r = runSetup(p, ['--count-organisations']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('organisations on this instance: 1, as it should be');
    expect(p.calls()).toContain('POST /admin/v1/orgs/_search');
    expect(p.calls().filter((c) => !isRead(c)), 'a call that writes').toEqual([]);
    expect(p.calls().filter((c) => c.includes('/pats')), 'it ran the clock').toEqual([]);
    expect(p.dotEnv(), 'it wrote the .env').toBe(before);
    expect(p.docker().filter((d) => / up | sh -c /.test(` ${d} `))).toEqual([]);
  });

  it('two: non-zero, the loud warning, and no name or domain', () => {
    const p = provider({ expiresInDays: 5, orgs: TWO_ORGS });
    const before = p.dotEnv();
    const r = runSetup(p, ['--count-organisations']);
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain('WARNING: THIS INSTANCE HOLDS 2 ORGANISATIONS, AND IT SHOULD HOLD ONE.');
    for (const org of TWO_ORGS.result) {
      expect(r.out).not.toContain(org.name);
      expect(r.out).not.toContain(org.primaryDomain);
    }
    expect(p.dotEnv()).toBe(before);
  });

  it('an answer with no count fails rather than passing as one', () => {
    // proto3 JSON leaves a zero out, so an empty search answers without the field.
    const p = provider({ expiresInDays: 5, orgs: { details: {} } });
    const r = runSetup(p, ['--count-organisations']);
    expect(p.calls(), r.out).toContain('POST /admin/v1/orgs/_search');
    expect(r.status).not.toBe(0);
  });

  it('a search the provider refuses fails, with its reason, rather than counting nothing', () => {
    // count_organisations reads the answer through a here-string, where the
    // search's own failure does not stop the script: what comes back is empty.
    const p = provider({
      expiresInDays: 5,
      orgs: { code: 7, message: 'No matching permissions found' },
      orgsStatus: 403,
    });
    const r = runSetup(p, ['--count-organisations']);
    expect(p.calls(), r.out).toContain('POST /admin/v1/orgs/_search');
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain('No matching permissions found');
  });
});

describe('the default run is the one it was', () => {
  it('generates what is missing, starts the provider, runs the clock and goes on to the project', () => {
    const p = provider({ expiresInDays: 5 });
    const r = runSetup(p, []);
    expect(r.out).toContain('generating any missing secrets');
    expect(p.docker().filter((d) => /\bup -d zitadel\b/.test(d))).toHaveLength(1);
    const calls = p.calls();
    const clock = calls.indexOf(`POST /management/v1/users/${SETUP_UID}/pats/_search`);
    const project = calls.indexOf('POST /management/v1/projects/_search');
    expect(clock, r.out).toBeGreaterThan(-1);
    expect(project, `the default run stopped at the clock:\n${r.out}`).toBeGreaterThan(clock);
  });
});

describe('end to end: the organisation count fails its duty, and only it', () => {
  function liveWithRealSetup(orgs: unknown) {
    const p = provider({ expiresInDays: 5, orgs });
    // The real setup-zitadel.sh; the drill, the exposure check, the site's duty and the strays stubbed.
    for (const f of ['trigger-version.sh', 'exposure-check.sh', 'www-live.sh', 'idp-strays.sh']) {
      writeExec(join(p.compose, f), DUTY_STUB);
    }
    if (!existsSync(join(p.compose, 'box-duties.sh'))) throw new Error(`${DUTIES_REL} does not exist`);
    const log = join(p.root, 'stub.log');
    writeFileSync(log, '');
    const r = spawnSync(join(p.compose, 'box-duties.sh'), [], {
      encoding: 'utf8',
      env: { ...p.env, STUB_LOG: log },
      cwd: p.root,
      timeout: 120_000,
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, calls: p.calls() };
  }

  it('two organisations: box-duties.sh exits non-zero naming organisations, and prints no name', () => {
    const r = liveWithRealSetup(TWO_ORGS);
    expect(r.status, r.out).toBe(1);
    expect(failed(r.out)).toEqual(['organisations']);
    expect(r.out).toContain('THIS INSTANCE HOLDS 2 ORGANISATIONS');
    for (const org of TWO_ORGS.result) expect(r.out).not.toContain(org.name);
    expect(r.out).not.toContain(MESH);
    expect(r.out).not.toContain(FRONT);
  });

  it('one organisation: every duty passes', () => {
    const r = liveWithRealSetup(ONE_ORG);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/all 6 duties passed/);
    expect(r.calls.filter((c) => c.includes('/projects')), 'a duty reconciled the project').toEqual([]);
  });
});

// ===========================================================================
// The timer, and the bring-up that installs it
// ===========================================================================

/** How late GitHub has dispatched the nightly crons (e2e.yml's own note), and a run's length, in minutes. */
const LATE = 5 * 60;
const RUN = 2 * 60;

/** A systemd time span (`90min`, `1h 30min`, `5400`, `5400s`), in minutes; NaN when it is not one. */
function spanMinutes(span: string): number {
  const text = span.trim();
  if (/^\d+$/.test(text)) return Number(text) / 60;
  const per: Record<string, number> = {
    s: 1 / 60,
    sec: 1 / 60,
    second: 1 / 60,
    seconds: 1 / 60,
    m: 1,
    min: 1,
    minute: 1,
    minutes: 1,
    h: 60,
    hr: 60,
    hour: 60,
    hours: 60,
  };
  const parts = [...text.matchAll(/(\d+)\s*([a-z]+)\s*/g)];
  if (parts.length === 0 || parts.map((m) => m[0]).join('') !== text.replace(/^\s+/, '')) return Number.NaN;
  let total = 0;
  for (const m of parts) {
    const unit = per[m[2] ?? ''];
    if (unit === undefined) return Number.NaN;
    total += Number(m[1]) * unit;
  }
  return total;
}

describe('the timer: daily, from live, away from the appliance nightly', () => {
  const service = readIfThere(SERVICE_REL);
  const timer = readIfThere(TIMER_REL);
  const doc = read(DOC_REL);

  it('both unit files exist, and the bring-up carries each word for word', () => {
    expect(service, `${SERVICE_REL} is missing`).not.toBe('');
    expect(timer, `${TIMER_REL} is missing`).not.toBe('');
    expect(doc.includes(service.trimEnd()), `${DOC_REL} does not carry ${SERVICE_REL} as it is`).toBe(true);
    expect(doc.includes(timer.trimEnd()), `${DOC_REL} does not carry ${TIMER_REL} as it is`).toBe(true);
  });

  it("the service runs box-duties.sh from live's checkout, once, into the journal", () => {
    expect(service).toMatch(/^Type=oneshot$/m);
    expect(service).toMatch(/^WorkingDirectory=%h\/ownpace-live$/m);
    expect(service).toMatch(/^ExecStart=%h\/ownpace-live\/deploy\/compose\/box-duties\.sh$/m);
    expect(service).toMatch(/^SyslogIdentifier=ownpace-box-duties$/m);
    expect(service).toMatch(/^TimeoutStartSec=/m);
  });

  it("the timer is daily and persistent, at a time in UTC outside the appliance nightly's hours", () => {
    expect(timer).toMatch(/^Persistent=true$/m);
    expect(timer).toMatch(/^WantedBy=timers\.target$/m);
    const at = /^OnCalendar=\*-\*-\* (\d{2}):(\d{2}):\d{2} UTC$/m.exec(timer);
    expect(at, 'OnCalendar is not a daily time in UTC').not.toBeNull();
    const minute = Number(at?.[1]) * 60 + Number(at?.[2]);
    const nightly = [...read(NIGHTLY_REL).matchAll(/cron: '(\d+) (\d+) \* \* \*'/g)].map(
      (m) => Number(m[2]) * 60 + Number(m[1]),
    );
    expect(nightly.length, `no daily cron found in ${NIGHTLY_REL}`).toBeGreaterThan(0);
    // Two windows on a day's circle overlap exactly when one starts inside the
    // other. The nightly's lasts from its firing to LATE + RUN after it; a run
    // of the duties from the timer to as long as the service lets it last.
    const lasts = /^TimeoutStartSec=(.+)$/m.exec(service)?.[1] ?? '';
    const runFor = spanMinutes(lasts);
    expect(Number.isFinite(runFor) && runFor > 0, `TimeoutStartSec=${lasts} is not a bounded time span`).toBe(true);
    // Every duty at its longest (BOX_DUTY_TIMEOUT's default, 20 minutes), or the unit stops a run mid-duty.
    expect(runFor, `TimeoutStartSec=${lasts} is shorter than ${DUTY_NAMES.length} duties of 20 minutes`).toBeGreaterThan(
      DUTY_NAMES.length * 20,
    );
    for (const start of nightly) {
      const hhmm = `${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}`;
      const after = (minute - start + 24 * 60) % (24 * 60);
      expect(after, `the timer fires ${after} minutes after the nightly's ${hhmm} UTC firing`).toBeGreaterThan(
        LATE + RUN,
      );
      const before = (start - minute + 24 * 60) % (24 * 60);
      expect(
        before,
        `the nightly's ${hhmm} UTC firing comes ${before} minutes after the timer, inside a run that may last ${runFor} (TimeoutStartSec)`,
      ).toBeGreaterThan(runFor);
    }
  });

  it('reads a time span the way systemd writes it', () => {
    expect(spanMinutes('90min')).toBe(90);
    expect(spanMinutes('1h 30min')).toBe(90);
    expect(spanMinutes('5400')).toBe(90);
    expect(spanMinutes('5400s')).toBe(90);
    expect(spanMinutes('infinity')).toBeNaN();
  });

  it('the bring-up says how to install it, as a user unit that runs when nobody is signed in', () => {
    for (const step of [
      'loginctl enable-linger',
      '~/.config/systemd/user',
      'systemctl --user daemon-reload',
      'systemctl --user enable --now ownpace-box-duties.timer',
      'journalctl --user -u ownpace-box-duties',
    ]) {
      expect(doc.includes(step), `${DOC_REL} does not say \`${step}\``).toBe(true);
    }
  });
});
