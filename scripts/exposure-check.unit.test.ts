// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE EXPOSURE CHECK ON THE MACHINE (workplan 0132 T3 (b)).
 *
 * Workplan 0132 D2 says the ports of both stacks cannot be reached from outside
 * the private network and the mesh. T3 (a) made that the default: every
 * `ports:` entry in `managed.yml` and `www.yml` answers on `127.0.0.1`, and a
 * `*_BIND` in a stack's `.env` adds one address (the front's, or the mesh's).
 * `a-port-published-on-purpose` holds the FILES to that. It cannot see the
 * machine: a container started before T3 (a) reached it still publishes on
 * every interface, and so does anything started by hand, or by a script
 * nobody has read, or by the appliance nightly's dev stack while it runs.
 *
 * So `deploy/compose/exposure-check.sh` reads what Docker says is published,
 * for EVERY container on the host, not one project's: one run covers the OTA
 * stack, `ownpace-live`, the site and the demo's Stalwart. It fails for each
 * port published on every interface (`0.0.0.0`, `::`), and for each port on an
 * address that is not loopback and not listed in `EXPOSURE_ALLOW` in the `.env`
 * of the stack that runs it. Workplan 0132 T6 runs it after every deploy of
 * live, and T7 daily.
 *
 * ITS OUTPUT NAMES THE CONTAINER AND THE PORT, NEVER THE ADDRESS. What it
 * prints may reach a public job log (T6, T7), and the address it would name is
 * this machine's mesh or front address (`a-public-log-that-named-the-machine-it-ran-on`).
 * The cases below assert that no address from the recorded input appears
 * anywhere in what the script prints, loopback included, and that a refusal of
 * a bad `EXPOSURE_ALLOW` entry, or Docker's own error, does not repeat one.
 *
 * TESTABLE WITHOUT DOCKER. `--from <file>` (or `--from -` for stdin) reads
 * recorded `docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Networks}}'` lines
 * instead of asking Docker; the cases feed the shapes Docker prints: an IPv4
 * and an IPv6 publish of one port, `[::]` and the older `:::` for IPv6 on every
 * interface, `[::1]`, a range, and a port that is exposed but not published.
 * A stub `docker` on the PATH covers the path the machine takes.
 *
 * Addresses here are documentation shapes: `100.64.0.1`, the mesh placeholder
 * `an-address-that-was-not-an-example` permits, and RFC 5737's.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(ROOT, 'deploy', 'compose');
const CHECK = join(COMPOSE_DIR, 'exposure-check.sh');

const MESH = '100.64.0.1';
const FRONT = '192.0.2.10';
const ELSEWHERE = '198.51.100.7';
const OTHER = '203.0.113.5';

let dir: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exposure-check-'));
  envFile = join(dir, '.env');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run the check on recorded `docker ps` lines, against a `.env` of the case's own. */
function check(psLines: readonly string[], envLines: readonly string[] = [], extraEnv: Record<string, string> = {}): Run {
  writeFileSync(envFile, `${envLines.join('\n')}\n`);
  const r = spawnSync('bash', [CHECK, '--env-file', envFile, '--from', '-'], {
    encoding: 'utf8',
    input: psLines.length ? `${psLines.join('\n')}\n` : '',
    env: { ...process.env, ...extraEnv },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Every IPv4 and IPv6 literal in the recorded input, as Docker prints them. */
function addressesIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g)) found.add(m[0]);
  for (const m of text.matchAll(/\[([0-9A-Fa-f:.]+)\]/g)) found.add(m[1]!);
  // The older form: `:::5432->5432/tcp` is `::` and port 5432.
  for (const m of text.matchAll(/(?:^|[\s,])(:[0-9A-Fa-f:]*):\d+->/g)) found.add(m[1]!);
  return [...found];
}

/** The output must name no address: not the machine's, not loopback, not `::`. */
function expectNoAddress(r: Run, input: string): void {
  const printed = `${r.stdout}\n${r.stderr}`;
  const addresses = addressesIn(input);
  for (const a of addresses) expect(printed, `the output names ${a}`).not.toContain(a);
  // Any IPv4 literal at all, and the IPv6 shapes Docker prints.
  expect(printed).not.toMatch(/(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/);
  expect(printed).not.toContain('::');
}

const HOST = [
  // The OTA stack after T3 (a): loopback, and the front's address on a routed port.
  `ota-db\t127.0.0.1:5432->5432/tcp`,
  `ota-web\t127.0.0.1:3123->80/tcp, ${FRONT}:3123->80/tcp`,
  `ota-idp\t127.0.0.1:3126->3126/tcp, ${FRONT}:3126->3126/tcp`,
  `ota-trigger-tls\t127.0.0.1:3443->3443/tcp, ${MESH}:3443->3443/tcp`,
  // Exposed by the image, published nowhere.
  `ota-pgbouncer\t5432/tcp`,
  // Nothing exposed at all.
  `ota-trigger-redis\t`,
  // Loopback in IPv6 too.
  `ota-api\t[::1]:3001->3001/tcp, 127.0.0.1:3001->3001/tcp`,
];
// The form the docs give: commas, no space. A bare space breaks the `.env` for
// bash, and bootstrap-managed.sh refuses it before sourcing (E2E (managed) #163).
const ALLOW = [`EXPOSURE_ALLOW=${FRONT},${MESH}`];

describe('the exposure check on the machine', () => {
  it('exists and is executable', () => {
    expect(existsSync(CHECK), 'deploy/compose/exposure-check.sh does not exist').toBe(true);
    expect(statSync(CHECK).mode & 0o111, 'exposure-check.sh is not executable').not.toBe(0);
  });

  it('passes a host where every publish is loopback or an allowed address', () => {
    const r = check(HOST, ALLOW);
    expect(r.stderr).toBe('');
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/7 running container/);
    expectNoAddress(r, HOST.join('\n'));
  });

  it('fails an all-interfaces Postgres, naming its container and its port', () => {
    const lines = [...HOST, `stray-postgres\t0.0.0.0:5432->5432/tcp, :::5432->5432/tcp`];
    const r = check(lines, ALLOW);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    const failing = r.stdout.split('\n').filter((l) => l.includes('every interface'));
    expect(failing, 'the IPv4 and IPv6 publish of one port are one finding').toHaveLength(1);
    expect(failing[0]).toContain('stray-postgres');
    expect(failing[0]).toContain('5432/tcp');
    // No other container is named as failing.
    for (const other of ['ota-db', 'ota-web', 'ota-idp', 'ota-api']) {
      expect(r.stdout.split('\n').filter((l) => l.includes(`${other} `) && /publishes/.test(l))).toEqual([]);
    }
    expectNoAddress(r, lines.join('\n'));
  });

  it.each([
    ['[::]', `v6-site\t[::]:3125->80/tcp`],
    ['the older :::', `v6-site\t:::3125->80/tcp`],
  ])('fails IPv6 on every interface, written %s', (_form, line) => {
    const r = check([line], ALLOW);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/v6-site publishes 3125\/tcp on every interface/);
    expectNoAddress(r, line);
  });

  it('fails a publish on an address EXPOSURE_ALLOW does not list, and says so', () => {
    const line = `ota-status\t127.0.0.1:3124->8080/tcp, ${ELSEWHERE}:3124->8080/tcp`;
    const r = check([line], ALLOW);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/ota-status publishes 3124\/tcp on an address EXPOSURE_ALLOW does not list/);
    expectNoAddress(r, `${line}\n${ALLOW.join('\n')}`);
  });

  it('allows nothing but loopback when the .env lists nothing', () => {
    const r = check([`ota-web\t127.0.0.1:3123->80/tcp, ${FRONT}:3123->80/tcp`], []);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('ota-web publishes 3123/tcp');
  });

  it('reads EXPOSURE_ALLOW as the .env holds it: quoted, comma-separated, the last line in force', () => {
    const line = `ota-web\t${FRONT}:3123->80/tcp, ${OTHER}:3123->80/tcp`;
    expect(check([line], [`EXPOSURE_ALLOW='${FRONT}, ${OTHER}'`]).status).toBe(0);
    // Double quotes: bootstrap-managed.sh's remedy for a bare space says
    // KEY="first second", and env_value keeps a double quote.
    expect(check([line], [`EXPOSURE_ALLOW="${FRONT} ${OTHER}"`]).status).toBe(0);
    expect(check([line], [`EXPOSURE_ALLOW="${FRONT},${OTHER}"`]).status).toBe(0);
    expect(check([line], [`EXPOSURE_ALLOW=${FRONT},${OTHER}   # the front and the second NIC`]).status).toBe(0);
    expect(check([line], [`EXPOSURE_ALLOW=${FRONT},${OTHER}`, `EXPOSURE_ALLOW=${FRONT}`]).status).toBe(1);
  });

  it('gives a form the nightly gate can source, and says commas wherever it describes the list', () => {
    // bootstrap-managed.sh SOURCES the .env with bash, and refuses first a
    // value with a bare space in it (load_env, E2E (managed) #163). Its own
    // pattern, read from the script, so the two cannot drift apart.
    const bootstrap = readFileSync(join(COMPOSE_DIR, 'bootstrap-managed.sh'), 'utf8');
    const preSource = bootstrap.split('\n').find((l) => /^\s*bad="\$\(grep -nE /.test(l) && l.includes('"$ENV_FILE"'));
    expect(preSource, 'load_env no longer has its pre-source refusal').toBeDefined();
    const refusedBeforeSourcing = (value: string): boolean => {
      writeFileSync(envFile, `${value}\n`);
      const r = spawnSync('bash', ['-c', `ENV_FILE="$1"\n${preSource!.trim()}\n[ -n "$bad" ]`, 'pre-source', envFile], { encoding: 'utf8' });
      return r.status === 0;
    };
    const agreement = (value: string): number | null => {
      writeFileSync(envFile, `${value}\n`);
      return spawnSync('bash', [join(COMPOSE_DIR, 'check-env-agreement.sh'), envFile], { encoding: 'utf8' }).status;
    };
    const documented = ALLOW[0]!;
    expect(refusedBeforeSourcing(documented), `${documented} is refused before sourcing`).toBe(false);
    expect(agreement(documented), `check-env-agreement.sh refuses ${documented}`).toBe(0);
    expect(check(HOST, ALLOW).status).toBe(0);
    // The pattern bites: a list separated by spaces is what it refuses.
    expect(refusedBeforeSourcing(`EXPOSURE_ALLOW=${FRONT} ${MESH}`)).toBe(true);
    expect(refusedBeforeSourcing(`EXPOSURE_ALLOW=${FRONT}, ${MESH}`)).toBe(true);

    // Everywhere the owner is told the list's format.
    const prose = (rel: string): string =>
      readFileSync(join(ROOT, rel), 'utf8').replace(/\n\s*#\s?/g, ' ').replace(/\s+/g, ' ');
    for (const rel of ['deploy/compose/exposure-check.sh', 'deploy/compose/managed.env.example', 'docs/managed-bring-up.md']) {
      const text = prose(rel);
      expect(/spaces or commas|separated by spaces/.test(text), `${rel} still says the list may be separated by spaces`).toBe(false);
      expect(/separated by commas/.test(text), `${rel} does not say the list is separated by commas`).toBe(true);
    }
  });

  it('takes the list from the stack\'s .env, never from the shell', () => {
    // A shell that sourced the other stack's .env must not widen this one's list.
    const line = `ota-web\t${FRONT}:3123->80/tcp`;
    const r = check([line], [], { EXPOSURE_ALLOW: FRONT });
    expect(r.status).toBe(1);
  });

  it('never allows every interface, whatever EXPOSURE_ALLOW lists', () => {
    for (const every of ['0.0.0.0', '::', '[::]']) {
      const r = check([`stray\t0.0.0.0:5432->5432/tcp`], [`EXPOSURE_ALLOW=${FRONT},${every}`]);
      expect(r.status, `EXPOSURE_ALLOW with ${every}`).toBe(2);
      expect(r.stderr).toContain('EXPOSURE_ALLOW');
      expect(r.stderr).toContain('every interface');
      expect(r.stderr).not.toContain(FRONT);
    }
  });

  it('refuses an EXPOSURE_ALLOW entry that is not an address, without repeating it', () => {
    for (const bad of ['spark.mesh.example', '192.0.2', '256.1.1.1', '192.0.2.10/24']) {
      const r = check([`ota-web\t127.0.0.1:3123->80/tcp`], [`EXPOSURE_ALLOW=${FRONT},${bad}`]);
      expect(r.status, bad).toBe(2);
      expect(r.stderr).toContain('EXPOSURE_ALLOW');
      expect(r.stderr).not.toContain(bad);
      expect(r.stderr).not.toContain(FRONT);
    }
  });

  it('fails a range on every interface, naming the range', () => {
    const line = `ranged\t0.0.0.0:8000-8002->8000-8002/tcp`;
    const r = check([line], ALLOW);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('ranged publishes 8000-8002/tcp on every interface');
  });

  it('fails a publish it cannot read, rather than passing it, and does not repeat it', () => {
    const line = `odd\t${OTHER}->80/tcp`;
    const r = check([line], ALLOW);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/odd publishes .*cannot read/);
    expectNoAddress(r, line);
  });

  it('says it did not check a container on the host network, which docker ps cannot see into', () => {
    const r = check([...HOST, `mesh-client\t\thost`], ALLOW);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/mesh-client .*host's network/);
  });

  it('fails a line that is not a recorded docker ps line, as a usage error', () => {
    const r = check(['no tab on this line'], ALLOW);
    expect(r.status).toBe(2);
  });

  it('reads the .env beside it when none is named', () => {
    // How T6 and T7 run it: from the stack's own checkout, no arguments.
    const here = join(dir, 'compose');
    mkdirSync(here);
    for (const f of ['exposure-check.sh', 'env-read.sh']) copyFileSync(join(COMPOSE_DIR, f), join(here, f));
    writeFileSync(join(here, '.env'), `EXPOSURE_ALLOW=${FRONT}\n`);
    const line = `ota-web\t127.0.0.1:3123->80/tcp, ${FRONT}:3123->80/tcp\n`;
    const ok = spawnSync('bash', [join(here, 'exposure-check.sh'), '--from', '-'], { encoding: 'utf8', input: line });
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    writeFileSync(join(here, '.env'), '');
    const bad = spawnSync('bash', [join(here, 'exposure-check.sh'), '--from', '-'], { encoding: 'utf8', input: line });
    expect(bad.status).toBe(1);
  });

  it('refuses an --env-file that does not exist, and an unknown argument', () => {
    const missing = spawnSync('bash', [CHECK, '--env-file', join(dir, 'nope'), '--from', '-'], { encoding: 'utf8', input: '' });
    expect(missing.status).toBe(2);
    const unknown = spawnSync('bash', [CHECK, '--nonsense'], { encoding: 'utf8', input: '' });
    expect(unknown.status).toBe(2);
  });
});

describe('asking Docker itself', () => {
  function withDocker(script: string): Run & { calls: string } {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const calls = join(dir, 'calls');
    writeFileSync(join(bin, 'docker'), `#!/bin/bash\nprintf '%s\\n' "$*" >>"${calls}"\n${script}\n`);
    chmodSync(join(bin, 'docker'), 0o755);
    writeFileSync(envFile, `EXPOSURE_ALLOW=${FRONT}\n`);
    const r = spawnSync('bash', [CHECK, '--env-file', envFile], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` },
    });
    return {
      status: r.status,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
      calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '',
    };
  }

  it('lists every running container on the host, not one project, with names, ports and networks', () => {
    const r = withDocker(`printf 'stray\\t0.0.0.0:5432->5432/tcp\\tbridge\\nota-web\\t${FRONT}:3123->80/tcp\\tx_net\\n'`);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain('stray publishes 5432/tcp on every interface');
    expect(r.calls.trim().split('\n')).toHaveLength(1);
    const call = r.calls.trim();
    expect(call).toMatch(/^ps /);
    // The whole daemon: no project filter, no compose.
    expect(call).not.toContain('--filter');
    expect(call).toContain('{{.Names}}');
    expect(call).toContain('{{.Ports}}');
    expect(call).toContain('{{.Networks}}');
    expectNoAddress(r, `0.0.0.0\n${FRONT}`);
  });

  it('exits 2 when Docker cannot answer, without repeating an address from its error', () => {
    const r = withDocker(`echo "Cannot connect to the Docker daemon at tcp://${OTHER}:2376. Is the docker daemon running?" >&2; exit 1`);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('docker ps');
    expect(r.stderr).toContain('Cannot connect to the Docker daemon');
    expect(r.stderr).not.toContain(OTHER);
  });

  it('exits 2 when there is no docker at all', () => {
    writeFileSync(envFile, '');
    const empty = join(dir, 'empty-bin');
    mkdirSync(empty);
    // bash is started by its full path; nothing at all is on this PATH, so the
    // check has to find out about docker before it needs any other command.
    const bash = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
    const r = spawnSync(bash, [CHECK, '--env-file', envFile], {
      encoding: 'utf8',
      env: { PATH: empty },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('docker');
  });
});
