// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BUNDLE BUILT FROM A STALE INSTALL (workplan 0150 T8; the owner,
 * 2026-09-28: *"yes, make deploy-tasks.sh run pnpm install"*).
 *
 * The api and web images install their own packages inside their builds. The
 * tasks do not: `trigger.dev deploy` bundles them with esbuild on the host,
 * from the checkout's own `node_modules`. The runbook's update steps were a
 * pull, the two image rebuilds and this script, with no install anywhere. So
 * on the OTA stack, whose checkout was last installed before `packages/shared`
 * took undici (workplan 0136), the images rebuilt and this script stopped at
 * `Could not resolve "undici/lib/dispatcher/agent.js"`. The api and web were
 * on the new code, and every pass stayed on the old bundle.
 *
 * What this holds, running the real script with `pnpm`, `curl` and `npx`
 * replaced by stubs that write down what they were asked:
 *
 *  1. It installs, at the repository's root, with `--frozen-lockfile`, before
 *     it reaches for the instance or the CLI.
 *  2. A failed install stops it there, with nothing after it tried.
 *  3. Without `pnpm` on PATH it refuses by name, rather than bundling from
 *     whatever is installed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = realpathSync(join(HERE, '..'));
const SCRIPT = join(ROOT, 'deploy', 'compose', 'deploy-tasks.sh');

/** Where this machine keeps a tool, found on the test's own PATH. */
function where(tool: string): string {
  const found = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
  if (!found) throw new Error(`${tool} is not on this machine's PATH`);
  return found;
}
const BASH = where('bash');

let dir: string;
let stubs: string;
let log: string;

/** A stub that writes its name, where it ran and its arguments, then exits as told. */
function stub(name: string, exitVariable: string, fallback: number): void {
  const file = join(stubs, name);
  writeFileSync(
    file,
    [
      '#!/bin/bash',
      `echo "${name}|$PWD|$*" >> "$STUB_LOG"`,
      `exit "\${${exitVariable}:-${fallback}}"`,
      '',
    ].join('\n'),
  );
  chmodSync(file, 0o755);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stale-install-'));
  stubs = join(dir, 'bin');
  log = join(dir, 'calls.log');
  mkdirSync(stubs);
  writeFileSync(log, '');
  // What the script runs before its install: the real ones, found first.
  symlinkSync(process.execPath, join(stubs, 'node'));
  symlinkSync(where('dirname'), join(stubs, 'dirname'));
  stub('pnpm', 'PNPM_EXIT', 0);
  // Unreachable: the script stops at its instance check, after the install,
  // and never reaches the CLI.
  stub('curl', 'CURL_EXIT', 7);
  stub('npx', 'NPX_EXIT', 0);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The PATH the script runs with. With `pnpm`, the stubs come first and shadow
 * the real `pnpm`, `curl` and `npx`, and the rest of this machine's PATH
 * follows. Without it, the stubs alone: before its install the script needs
 * only `dirname` and `node`, which are there, and no directory of this
 * machine's, where a real `pnpm` could be found.
 */
function pathFor(withPnpm: boolean): string {
  if (!withPnpm) {
    rmSync(join(stubs, 'pnpm'));
    return stubs;
  }
  return [stubs, process.env.PATH ?? ''].join(delimiter);
}

function run(env: Record<string, string> = {}, withPnpm = true) {
  // Run from elsewhere, so an install that did not move to the root shows.
  const r = spawnSync(BASH, [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: pathFor(withPnpm),
      HOME: dir,
      STUB_LOG: log,
      TRIGGER_PROJECT_REF: 'proj_test',
      ...env,
    },
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = '', cwd = '', args = ''] = line.split('|');
      return { name, cwd, args };
    });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}

describe('deploy-tasks.sh installs before it bundles', () => {
  it('installs at the repository root, frozen, before it reaches for the instance or the CLI', () => {
    const r = run();

    expect(r.calls[0]).toEqual({ name: 'pnpm', cwd: ROOT, args: 'install --frozen-lockfile' });
    // It went on to the instance check, which the stub fails, and stopped there.
    expect(r.calls.map((c) => c.name)).toEqual(['pnpm', 'curl']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is not reachable');
    expect(r.stdout).toContain('pnpm install --frozen-lockfile');
  });

  it('stops at a failed install, and tries nothing after it', () => {
    const r = run({ PNPM_EXIT: '1' });

    expect(r.status).not.toBe(0);
    expect(r.calls.map((c) => c.name)).toEqual(['pnpm']);
  });

  it('refuses by name without pnpm, rather than bundling from whatever is installed', () => {
    const r = run({}, false);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('pnpm is not on PATH');
    expect(r.stderr).toContain('corepack enable');
    expect(r.calls).toEqual([]);
  });
});
