// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOGIN THAT OUTLIVED ITS INSTANCE, AND THE DANCE IT COST.
 *
 * The Trigger.dev CLI keeps its credential in `~/.config/trigger/config.json`
 * — on the HOST, outside every container. So it survives what the instance
 * does not: a `down -v`, a wipe, a rename cutover. What is left afterwards is
 * a token for an account that no longer exists, and `deploy-tasks.sh` says so
 * correctly ("Not logged in under the profile 'openmig'") while
 * `trigger.dev login` answers "You are already logged in" — because login
 * short-circuits on a token it finds without validating it against the server.
 * An operator following the refusal's advice therefore loops.
 *
 * The owner met that wall twice on the same machine. The second time
 * (2026-09-03) it cost four commands and a browser round trip through a
 * self-signed https front, mid-deploy, and his verdict was the reason this
 * file exists: *"this is no fun at all.... please investigate if we can
 * automate this."*
 *
 * TWO THINGS ARE PINNED HERE, and they are different in kind.
 *
 *   1. **The refusal names `logout` FIRST.** Not a preference: `login` alone
 *      cannot fix a stale profile, so a message that prints only `login` is a
 *      message that sends the reader in a circle. This is the one assertion
 *      that would have saved the morning.
 *   2. **The token is remembered, and never printed.** `TRIGGER_ACCESS_TOKEN`
 *      short-circuits the whole login path — the CLI's `deploy` reads it
 *      before it looks at any profile file and validates it server-side, which
 *      is the CLI's own documented answer for CI. Lifting the token the CLI
 *      has already minted into `.env` makes the wall a one-time event rather
 *      than a recurring one. It is a credential with the reach of the deploy
 *      itself, so it moves from one file to another and appears in no output,
 *      not even masked — that is the assertion below, and it is the one worth
 *      breaking the build over.
 *
 * The extraction is deliberately NOT a hard-coded JSON path. The CLI owns that
 * file's shape and has moved it across major versions; a path that reads as
 * working right up until an upgrade would find nothing and look exactly like
 * "not logged in", which is the wall again. What is stable is the token's own
 * prefix, which the CLI prints when it mints one. So the tests below feed it
 * two different shapes and expect both to work.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE = join(HERE, '..', 'deploy', 'compose');
const REMEMBER = join(COMPOSE, 'trigger-remember-token.sh');
const DEPLOY_TASKS = readFileSync(join(COMPOSE, 'deploy-tasks.sh'), 'utf8');

/** A token that looks like the CLI's own, and is not one anybody holds. */
const TOKEN = 'tr_pat_0000000000000000000000000000test';
const OTHER = 'tr_pat_1111111111111111111111111111other';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remember-token-'));
  // The script writes through env-upsert.sh, which it finds beside itself, so
  // the pair is copied rather than the one file: what is under test is the
  // whole write path, including the refusal to duplicate a key.
  for (const name of ['trigger-remember-token.sh', 'env-upsert.sh']) {
    copyFileSync(join(COMPOSE, name), join(dir, name));
    chmodSync(join(dir, name), 0o755);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(join(dir, 'trigger-remember-token.sh'), args, {
    encoding: 'utf8',
    env: { ...process.env, TRIGGER_CLI_CONFIG: join(dir, 'config.json'), ...env },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const config = (json: unknown) =>
  writeFileSync(join(dir, 'config.json'), JSON.stringify(json), 'utf8');
const envFile = (text = 'FOO=bar\n') => writeFileSync(join(dir, '.env'), text, 'utf8');
const readEnv = () => readFileSync(join(dir, '.env'), 'utf8');

describe('the token is remembered', () => {
  it('lifts it out of the CLI profile and into .env', () => {
    config({ version: '2', profiles: { openmig: { accessToken: TOKEN } } });
    envFile();

    const r = run([], { TRIGGER_CLI_PROFILE: 'openmig' });

    expect(r.status).toBe(0);
    expect(readEnv()).toContain(`TRIGGER_ACCESS_TOKEN=${TOKEN}`);
    // The key it already had is undisturbed — env-upsert's contract, asserted
    // here because this script is a new caller of it.
    expect(readEnv()).toContain('FOO=bar');
  });

  it('reads a shape the CLI has not shipped yet, because the PREFIX is what is stable', () => {
    // No `profiles` wrapper, and the key is called something else. A
    // hard-coded `.profiles[p].accessToken` finds nothing here — and finding
    // nothing looks exactly like "not logged in", which is the wall this
    // whole file exists to remove.
    config({ openmig: { credential: { value: TOKEN } } });
    envFile();

    expect(run([], { TRIGGER_CLI_PROFILE: 'openmig' }).status).toBe(0);
    expect(readEnv()).toContain(`TRIGGER_ACCESS_TOKEN=${TOKEN}`);
  });

  it('takes the named profile’s token, not whichever comes first', () => {
    config({ profiles: { first: { accessToken: OTHER }, openmig: { accessToken: TOKEN } } });
    envFile();

    run([], { TRIGGER_CLI_PROFILE: 'openmig' });

    expect(readEnv()).toContain(TOKEN);
    expect(readEnv()).not.toContain(OTHER);
  });
});

describe('what it refuses', () => {
  it('refuses to choose between tokens when the profile is not in the file', () => {
    config({ profiles: { a: { accessToken: TOKEN }, b: { accessToken: OTHER } } });
    envFile();

    const r = run([], { TRIGGER_CLI_PROFILE: 'ghost' });

    // Naming both beats picking one — `trigger_env` refuses an ambiguity the
    // same way, and for the same reason.
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refusing to pick one/);
    expect(readEnv()).not.toContain('TRIGGER_ACCESS_TOKEN');
  });

  it('leaves a token .env already holds alone, until --force says otherwise', () => {
    config({ profiles: { openmig: { accessToken: TOKEN } } });
    envFile(`TRIGGER_ACCESS_TOKEN=${OTHER}\n`);

    expect(run([], { TRIGGER_CLI_PROFILE: 'openmig' }).status).toBe(0);
    // One placed there deliberately — a long-lived PAT minted at the
    // dashboard — outranks whatever a profile happens to hold.
    expect(readEnv()).toContain(OTHER);

    expect(run(['--force'], { TRIGGER_CLI_PROFILE: 'openmig' }).status).toBe(0);
    expect(readEnv()).toContain(TOKEN);
    expect(readEnv()).not.toContain(OTHER);
  });

  it('says so plainly when nobody has logged in yet', () => {
    config({ profiles: {} });
    envFile();

    const r = run([], { TRIGGER_CLI_PROFILE: 'openmig' });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Log in once first/);
  });
});

describe('the token never reaches a terminal', () => {
  it('prints nothing containing it — not the value, not a masked half of it', () => {
    config({ profiles: { openmig: { accessToken: TOKEN } } });
    envFile();

    const r = run([], { TRIGGER_CLI_PROFILE: 'openmig' });

    expect(r.stdout).not.toContain(TOKEN);
    expect(r.stderr).not.toContain(TOKEN);
    // Not even the leading half. A credential with the deploy's own reach is
    // not a thing to render, and a masked prefix is still a prefix.
    expect(r.stdout + r.stderr).not.toContain(TOKEN.slice(0, 20));
    // It did do the job, and said which key it wrote — that much is needed.
    expect(r.stderr).toMatch(/TRIGGER_ACCESS_TOKEN written/);
  });

  it('prints nothing containing it on the ambiguous path either', () => {
    config({ profiles: { a: { accessToken: TOKEN }, b: { accessToken: OTHER } } });
    envFile();

    const r = run([], { TRIGGER_CLI_PROFILE: 'ghost' });

    expect(r.stdout + r.stderr).not.toContain(TOKEN);
    expect(r.stdout + r.stderr).not.toContain(OTHER);
    // It may say HOW MANY it found; that is a count, not a credential.
    expect(r.stderr).toMatch(/holds 2 tokens/);
  });
});

describe('the refusal that used to send an operator in a circle', () => {
  /**
   * The block the operator actually reads when the deploy stops — from the
   * refusal's first line to its `exit 1`. Scoped deliberately: the first
   * draft of this test compared the two commands' positions in the WHOLE
   * file and failed, because the header's own step 4 still said `login`
   * alone. That was not a false positive — the header is what `--help`
   * prints, so it was giving the same advice that loops — but it is a
   * different place, and each is asserted where it lives.
   */
  const refusal = DEPLOY_TASKS.slice(
    DEPLOY_TASKS.indexOf("Not logged in under the profile"),
    DEPLOY_TASKS.indexOf('exit 1', DEPLOY_TASKS.indexOf("Not logged in under the profile")),
  );

  it('names logout BEFORE login, in the refusal an operator reads', () => {
    const logout = refusal.indexOf('logout --profile');
    const login = refusal.indexOf('login -a');

    expect(logout, 'the refusal never mentions logout — the loop is back').toBeGreaterThan(-1);
    expect(login).toBeGreaterThan(-1);
    // Order is the assertion. `login` alone short-circuits on the stale token
    // and reports success, so a message that prints it first is a message
    // that does not work.
    expect(logout).toBeLessThan(login);
  });

  it('never advises a bare login — ANYWHERE in the file, the header included', () => {
    // The first draft of this test only looked at the refusal, and the file
    // still told an operator to run `login` alone in step 4 of its own header
    // — which is what `--help` prints. Same wrong advice, different place. So
    // the rule is stated once and applied to every mention: a `login` command
    // has a `logout` in front of it, close enough to read as one instruction.
    const offsets: number[] = [];
    for (let i = DEPLOY_TASKS.indexOf('login -a'); i !== -1; i = DEPLOY_TASKS.indexOf('login -a', i + 1)) {
      offsets.push(i);
    }
    expect(offsets.length, 'no login command at all — this file lost its point').toBeGreaterThan(0);
    for (const at of offsets) {
      const before = DEPLOY_TASKS.slice(Math.max(0, at - 300), at);
      expect(
        before,
        `a login command at offset ${at} has no logout before it — the loop is back`,
      ).toContain('logout --profile');
    }
  });

  it('says why that order matters, rather than leaving it to be discovered', () => {
    expect(DEPLOY_TASKS).toMatch(/logout FIRST/);
    expect(DEPLOY_TASKS).toMatch(/short-circuits/);
  });

  it('offers the way out of ever seeing it again', () => {
    expect(DEPLOY_TASKS).toMatch(/trigger-remember-token\.sh/);
  });

  it('remembers the token on the success path, without being able to stop a deploy', () => {
    // Best-effort by construction: the convenience step in front of a deploy
    // that CAN run must never be the reason it does not.
    const call = DEPLOY_TASKS.match(/trigger-remember-token\.sh"?\s*\|\|\s*true/);
    expect(call, 'the remember step can fail a deploy').not.toBeNull();
  });
});
