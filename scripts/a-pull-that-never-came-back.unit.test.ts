// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PULL THAT NEVER CAME BACK (live's deploy of alpha.2, 2026-10-28).
 *
 * The bring-up's app phase asks compose for the identity provider's image
 * before it reads the user off it (`prepare_machinekey_volume`): `inspect`
 * reads the LOCAL image, and on a fresh machine the image only arrives with
 * `up`, which is later. On live the image was there already, from the deploy
 * the day before. `docker compose pull -q zitadel` printed "Pulled" in 0.6s and
 * then never returned: sixteen minutes, waiting on the daemon's socket, with
 * compose drawing its progress in a terminal (the nights run it with none and
 * never met it). The same pull from a second terminal came back in 0.7s. The
 * deploy only moved on once the pull was killed, and so did not take.
 *
 * Two things answer it, and both are run here, against the function as it is
 * in bootstrap-managed.sh, with a stub `docker` that records every call:
 *   - an image that is here is not pulled at all;
 *   - a pull that is needed has an end (ZITADEL_PULL_TIMEOUT), after which the
 *     bring-up stops with a sentence saying what to do, never a wait.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP = readFileSync(join(REPO_ROOT, 'deploy/compose/bootstrap-managed.sh'), 'utf8');

const start = BOOTSTRAP.indexOf('prepare_machinekey_volume() {');
const FUNCTION = BOOTSTRAP.slice(start, BOOTSTRAP.indexOf('\n}\n', start) + 3);
const DEFAULT_LINE = BOOTSTRAP.split('\n').find((l) => l.startsWith('ZITADEL_PULL_TIMEOUT=')) ?? '';

const IMAGE = 'ghcr.io/zitadel/zitadel:v9.9.9';

// The stub: answers the four calls the function makes, records each, and fails
// loudly on anything else, so a new docker call cannot pass unnoticed.
const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  "compose -f /stub/managed.yml config --format json")
    printf '{"services":{"zitadel":{"image":"${IMAGE}"}}}\\n' ;;
  "image inspect ${IMAGE}")
    [ "$PRESENT" = 1 ] ;;
  "image inspect ${IMAGE} --format {{.Config.User}}")
    echo 1000 ;;
  "compose -f /stub/managed.yml pull -q zitadel")
    case "$PULL" in hang) exec sleep 60 ;; fail) exit 18 ;; *) exit 0 ;; esac ;;
  "compose -f /stub/managed.yml run --rm --quiet-pull zitadel-machinekey")
    exit 0 ;;
  *) echo "stub docker: unexpected call: $*" >&2; exit 99 ;;
esac
`;

function run(env: { PRESENT: '0' | '1'; PULL?: 'ok' | 'hang' | 'fail'; timeout?: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'pull-never-came-back-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'docker'), STUB);
    chmodSync(join(bin, 'docker'), 0o755);
    const calls = join(dir, 'calls');
    writeFileSync(calls, '');
    const script = [
      'set -euo pipefail',
      'die() { printf "DIE: %s\\n" "$*" >&2; exit 1; }',
      'note() { printf "NOTE: %s\\n" "$*"; }',
      'resolve_image_uid() { echo 1000; }',
      'COMPOSE=(docker compose -f /stub/managed.yml)',
      'COMPOSE_PROJECT=stub',
      DEFAULT_LINE,
      FUNCTION,
      'prepare_machinekey_volume',
    ].join('\n');
    const began = Date.now();
    const r = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        CALLS: calls,
        PRESENT: env.PRESENT,
        PULL: env.PULL ?? 'ok',
        ...(env.timeout ? { ZITADEL_PULL_TIMEOUT: env.timeout } : {}),
      },
    });
    return {
      status: r.status,
      stderr: r.stderr,
      seconds: (Date.now() - began) / 1000,
      calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('a pull that never came back (live, 2026-10-28)', () => {
  it('read the real function', () => {
    expect(start, 'prepare_machinekey_volume is gone or renamed').toBeGreaterThan(-1);
    expect(FUNCTION).toContain('pull -q zitadel');
    expect(DEFAULT_LINE).toBe('ZITADEL_PULL_TIMEOUT="${ZITADEL_PULL_TIMEOUT:-600}"');
  });

  it('gives the pull no terminal: input from /dev/null, output through a pipe', () => {
    // Read, not run: a test has no terminal to take away. With one, compose
    // draws its progress (the mode that hung on live), and `timeout`, which
    // starts it in a process group of its own, would see it stopped the moment
    // it touched the terminal's settings, and stop it after 600 seconds instead.
    const code = FUNCTION.replace(/^\s*#.*$/gm, '');
    expect(code).toMatch(
      /timeout --kill-after=\d+ "\$ZITADEL_PULL_TIMEOUT" "\$\{COMPOSE\[@\]\}" pull -q zitadel <\/dev\/null 2>&1 \|\n\s+sed 's\/\^\/    \/' \|\| pull_rc=\$\?/,
    );
  });

  it('does not pull an image that is already here', () => {
    const r = run({ PRESENT: '1' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.some((c) => c.includes(' pull ')), r.calls.join('\n')).toBe(false);
    // And still reads the user off it, and prepares the volume.
    expect(r.calls).toContain(`image inspect ${IMAGE} --format {{.Config.User}}`);
    expect(r.calls.at(-1)).toBe('compose -f /stub/managed.yml run --rm --quiet-pull zitadel-machinekey');
  });

  it('pulls an image that is not here, before it reads the user off it', () => {
    const r = run({ PRESENT: '0' });
    expect(r.status, r.stderr).toBe(0);
    const pull = r.calls.indexOf('compose -f /stub/managed.yml pull -q zitadel');
    const user = r.calls.indexOf(`image inspect ${IMAGE} --format {{.Config.User}}`);
    expect(pull, r.calls.join('\n')).toBeGreaterThan(-1);
    expect(pull).toBeLessThan(user);
  });

  it('stops a pull that does not end, and says what to do, instead of waiting', () => {
    const r = run({ PRESENT: '0', PULL: 'hang', timeout: '1' });
    expect(r.status).not.toBe(0);
    expect(r.seconds, 'it waited for the stub instead of stopping it').toBeLessThan(15);
    expect(r.stderr).toMatch(/the pull of ghcr\.io\/zitadel\/zitadel:v9\.9\.9 did not end within 1s/);
    expect(r.stderr).toMatch(/Run the same command again/);
    // Nothing after the pull ran: no user read, no volume prepared.
    expect(r.calls.some((c) => c.includes('--format {{.Config.User}}'))).toBe(false);
    expect(r.calls.some((c) => c.includes('zitadel-machinekey'))).toBe(false);
  });

  it('names a pull that failed by its exit, rather than as a timeout', () => {
    const r = run({ PRESENT: '0', PULL: 'fail' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/the pull of ghcr\.io\/zitadel\/zitadel:v9\.9\.9 failed \(exit 18, above\)/);
  });
});
