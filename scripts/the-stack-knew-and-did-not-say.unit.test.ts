// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE STACK KNEW WHAT WAS WRONG AND MADE THE OPERATOR FIND OUT.
 *
 * Two refusals on 2026-08-24 (workplan 0099), both of which had the answer in
 * hand before they printed a word:
 *
 *  1. The `login` phase said "not logged in, run login --profile openmig". The
 *     operator WAS logged in — as `ownpace` — and nothing on screen suggested
 *     the profile name was a setting. They ran the printed command, watched it
 *     succeed, and were refused again by a phase still asking about a name
 *     that is pre-rename branding nobody would guess.
 *
 *  2. The `app` phase started Zitadel against a `.env` whose
 *     ZITADEL_DB_PASSWORD no longer matched the Postgres role. Zitadel does
 *     not reset an existing role's password — it logs `user already exists,
 *     skipping creation` and crash-loops — and a crash-looping container is
 *     indistinguishable from a slow one until the 300-second readiness
 *     timeout expires. Five minutes to be told about a password nobody had
 *     changed, when one query answers it in a second.
 *
 * Both are the same defect, and it is not "the check was missing". The checks
 * existed; they ran too late, or answered a narrower question than the one the
 * operator needed answered. So these tests are about WHEN and WHAT IS SAID,
 * which is why several of them assert on message content — that content is the
 * interface here, exactly as much as an exit code is.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');

const bootstrap = readFileSync(join(COMPOSE_DIR, 'bootstrap-managed.sh'), 'utf8');
const deployTasks = readFileSync(join(COMPOSE_DIR, 'deploy-tasks.sh'), 'utf8');
const cliLib = readFileSync(join(COMPOSE_DIR, 'trigger-cli-lib.sh'), 'utf8');
const envExample = readFileSync(join(COMPOSE_DIR, 'managed.env.example'), 'utf8');
const zitadelDbPassword = readFileSync(join(COMPOSE_DIR, 'zitadel-db-password.sh'), 'utf8');

describe('the profile name is a setting, and both refusals now say so', () => {
  // Both scripts refuse on the same condition. A fix in one of them is how the
  // class survives: deploy-tasks.sh was carrying the identical omission.
  const refusals: Array<[string, string]> = [
    ['bootstrap-managed.sh', bootstrap],
    ['deploy-tasks.sh', deployTasks],
  ];

  it.each(refusals)('%s names TRIGGER_CLI_PROFILE in its refusal', (_file, text) => {
    // Naming the profile without naming the variable is what left an operator
    // with nowhere to go.
    expect(text).toContain('TRIGGER_CLI_PROFILE');
  });

  it.each(refusals)('%s offers a command that sets it, not just the name', (_file, text) => {
    expect(text).toMatch(/env-upsert\.sh.*TRIGGER_CLI_PROFILE=/);
  });

  it.each(refusals)('%s lists the profiles the machine IS logged in under', (_file, text) => {
    expect(text).toContain('trigger_cli_profiles_present');
  });

  it('managed.env.example documents the knob, so it is findable before it bites', () => {
    expect(envExample).toMatch(/^TRIGGER_CLI_PROFILE=/m);
  });

  it('keeps `openmig` as the default rather than silently repointing it', () => {
    // A machine already logged in under the old name — the gate's runner, most
    // likely — would be stranded by a default that moved under it. The fix is
    // to make the name visible, not to change it.
    expect(bootstrap).toContain('TRIGGER_CLI_PROFILE:-openmig');
    expect(deployTasks).toContain('TRIGGER_CLI_PROFILE:-openmig');
  });
});

describe('trigger_cli_profiles_present, run for real', () => {
  function profiles(configPath: string | null, body?: string): { out: string; status: number } {
    const home = mkdtempSync(join(tmpdir(), 'cli-profiles-'));
    try {
      if (configPath) {
        const full = join(home, configPath);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, body ?? '{}');
      }
      const r = spawnSync(
        'bash',
        ['-c', `source "${join(COMPOSE_DIR, 'trigger-cli-lib.sh')}"; trigger_cli_profiles_present`],
        { encoding: 'utf8', env: { ...process.env, HOME: home } },
      );
      return { out: (r.stdout ?? '').trim(), status: r.status ?? -1 };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  it('finds profiles nested under a `profiles` key', () => {
    const r = profiles('.config/trigger/config.json', JSON.stringify({
      version: '2',
      profiles: { default: { accessToken: 'x' }, ownpace: { accessToken: 'y' } },
    }));
    expect(r.out.split('\n').sort()).toEqual(['default', 'ownpace']);
  });

  it('finds profiles held at the top level, which older CLIs wrote', () => {
    const r = profiles('.config/trigger/config.json', JSON.stringify({
      openmig: { accessToken: 'x' },
    }));
    expect(r.out).toBe('openmig');
  });

  it('says nothing when there is no config at all', () => {
    // Not an error: a machine that has never logged in is the ordinary first
    // run, and inventing prose here would put words where a list was expected.
    const r = profiles(null);
    expect(r.out).toBe('');
    expect(r.status).toBe(0);
  });

  it('says nothing, and does not fail, on a config it cannot parse', () => {
    // An unreadable config is not evidence about what is logged in. The caller
    // still prints its own advice; this must not take the phase down with it.
    const r = profiles('.config/trigger/config.json', 'not json at all');
    expect(r.out).toBe('');
    expect(r.status).toBe(0);
  });
});

describe('the zitadel role password is asked BEFORE the container is started', () => {
  it('checks it between bringing postgres up and starting zitadel', () => {
    // Order is the whole fix. The same check after `up -d zitadel` would still
    // be behind the readiness timeout, which is where the five minutes went.
    const pg = bootstrap.indexOf('up_wait postgres');
    const check = bootstrap.indexOf('assert_zitadel_role_password\n');
    const up = bootstrap.indexOf('up -d zitadel');

    expect(pg, 'postgres is not brought up before the check').toBeGreaterThan(-1);
    expect(check, 'the role check is never called').toBeGreaterThan(-1);
    expect(pg).toBeLessThan(check);
    expect(check, 'the check runs after zitadel has already started').toBeLessThan(up);
  });

  it('treats a missing role as a first bring-up rather than a failure', () => {
    // Zitadel creates both the role and the database itself, with the admin
    // credentials. Refusing here would break every fresh install.
    //
    // Asserted on the SCRIPT, not on bootstrap: the query and its branches now
    // live in one place, because two copies of this check is how the same
    // wrong answer came to be given by both of them. See
    // scripts/the-check-postgres-never-made.unit.test.ts.
    expect(zitadelDbPassword).toMatch(/\*"does not exist"\*\)/);
  });

  it('refuses to call an unreachable database an authentication failure', () => {
    // hard rule 9: a check that cannot run says so, rather than reporting the
    // most likely-sounding cause. Sending an operator to ALTER ROLE for a
    // Postgres that was merely still starting is a wrong answer with
    // consequences.
    expect(bootstrap).toContain('NOT verified here');
  });

  it('points at a script for the repair, not a paste that needs container-only vars', () => {
    expect(bootstrap).toContain('zitadel-db-password.sh --sync');
  });
});

describe('two .env files describing one stack are reported, not hidden', () => {
  it('is checked from INSIDE load_env, which every --from resume passes through', () => {
    // The failure arrived on `--from trigger` and `--from app`, both of which
    // skip the preflight phase entirely. A check that only ran on a full
    // bring-up would not have caught the day it was written for.
    //
    // Scoped to the function BODY, and it has to be: the first version of this
    // test searched from `load_env() {` to the end of the file, which found
    // the definition of `note_env_divergence` further down and passed with the
    // call deleted. A guard that cannot fail is not a guard — caught by
    // mutating the script it guards.
    const start = bootstrap.indexOf('load_env() {');
    expect(start, 'no load_env in bootstrap-managed.sh').toBeGreaterThan(-1);
    const body = bootstrap.slice(start, bootstrap.indexOf('\n}\n', start));

    expect(body, 'load_env does not check for divergence').toContain('note_env_divergence');
  });

  it('reports key NAMES and never values', () => {
    // The differing keys are passwords and tokens (hard rule 3). The names are
    // what an operator acts on; the values would be a leak in a log everyone
    // pastes into a chat window.
    const fn = bootstrap.slice(
      bootstrap.indexOf('note_env_divergence() {'),
      bootstrap.indexOf('# THE `zitadel` ROLE'),
    );
    expect(fn).toContain('note "      ${k}"');
    expect(fn, 'the divergence report prints a value').not.toMatch(/note ".*\$\{?[ab]\}?/);
  });

  it('speaks when there are TWO FILES, not only when they have already drifted', () => {
    // It used to return silently while every key matched — so the warning
    // arrived after the damage rather than before it. Two separate files
    // describing one stack WILL drift; the point is to be told while it is
    // still cheap.
    const fn = bootstrap.slice(
      bootstrap.indexOf('note_env_divergence() {'),
      bootstrap.indexOf('# THE `zitadel` ROLE'),
    );
    expect(fn).toContain('They agree right now:');
    expect(fn, 'the agreeing case offers no way to fix it').toMatch(
      /They agree right now[\s\S]*ln -sfn/,
    );
  });

  it('stays quiet about it under CI, where a symlink is impossible', () => {
    // Not noise-squeamishness: `actions/checkout` runs `git clean -ffdx` and
    // deletes the link like any other ignored file, which is why the workflow
    // restores a copy at all. Advice a runner structurally cannot take, printed
    // every run forever, is how a real warning gets tuned out.
    const fn = bootstrap.slice(
      bootstrap.indexOf('note_env_divergence() {'),
      bootstrap.indexOf('# THE `zitadel` ROLE'),
    );
    expect(fn).toMatch(/\[ -n "\$\{CI:-\}" \] && return 0/);
  });

  it('still reports the DISAGREEING case, which is the louder one', () => {
    const fn = bootstrap.slice(
      bootstrap.indexOf('note_env_divergence() {'),
      bootstrap.indexOf('# THE `zitadel` ROLE'),
    );
    expect(fn).toContain('they disagree on');
  });

  it('says nothing when the two are already one file', () => {
    const fn = bootstrap.slice(
      bootstrap.indexOf('note_env_divergence() {'),
      bootstrap.indexOf('# THE `zitadel` ROLE'),
    );
    // A symlink is the arrangement being recommended; complaining about it
    // would make the advice self-defeating. `-ef` covers a bind mount too.
    expect(fn).toContain('[ -L "$ENV_FILE" ] && return 0');
    expect(fn).toContain('-ef');
  });

  it('notes rather than refuses, because mid-run divergence is legitimate', () => {
    // During a gate run the checkout's copy moves ahead — setup-zitadel.sh
    // writes the issuer and rotated PAT expiry into it, and the workflow
    // persists it back at the end. Refusing that would break the mechanism
    // that keeps the two in step.
    const fn = bootstrap.slice(
      bootstrap.indexOf('note_env_divergence() {'),
      bootstrap.indexOf('# THE `zitadel` ROLE'),
    );
    expect(fn).not.toContain('exit 1');
    expect(fn).not.toContain('die ');
  });

  it('names the symlink that makes divergence impossible', () => {
    expect(bootstrap).toContain('ln -sfn');
  });
});

describe('the shared library keeps its own contract', () => {
  it('trigger_cli_profiles_present writes only its answer to stdout', () => {
    // The mint() rule: a function whose stdout IS its value must print nothing
    // else there. A stray `say` would be read as a profile name.
    const fn = cliLib.slice(cliLib.indexOf('trigger_cli_profiles_present() {'));
    expect(fn).not.toMatch(/^\s*(echo|printf|say)\b/m);
  });
});

/**
 * MAIL THAT REPORTS `sent` AND REACHES NOBODY.
 *
 * `SMTP_HOST` defaults to `mailpit`, the catcher in this stack. Right here and
 * wrong on a real deployment, and quiet in the worst way: every send reports
 * `sent`, because it WAS sent — to a server whose job is to keep it. Nobody
 * hears about a granted account until somebody asks why they never got the
 * email.
 *
 * `WEB_URL` already says which kind of deployment this is, so the two facts
 * can be compared instead of trusted to agree — the same shape as `--public`
 * against `OWNPACE_APP_URL` in the site build.
 *
 * RUN, not read. The condition is three cases of a `case` statement and a
 * string comparison, which is exactly the kind of thing that reads correct and
 * behaves otherwise.
 */
describe('a catcher serving what looks like a real deployment', () => {
  function noteFor(env: Record<string, string>): string {
    const home = mkdtempSync(join(tmpdir(), 'mailnote-'));
    try {
      const envFile = join(home, '.env');
      writeFileSync(
        envFile,
        Object.entries(env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n') + '\n',
      );
      // The three functions this one needs, lifted from the real script so the
      // text under test is the text that ships.
      const fn = (name: string) => {
        const at = bootstrap.indexOf(`${name}() {`);
        return at < 0 ? '' : bootstrap.slice(at, bootstrap.indexOf('\n}\n', at) + 3);
      };
      const program = [
        'set -uo pipefail',
        `ENV_FILE="${envFile}"`,
        'note() { echo "    $*"; }',
        fn('env_get'),
        // env_or too: the note's port default goes through it, and a harness
        // that lifts only half the helpers makes the note print an empty port
        // — which is exactly the production defect, reproduced in the test rig.
        fn('env_or'),
        fn('note_mail_goes_nowhere_real'),
        'note_mail_goes_nowhere_real',
      ].join('\n');
      const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
      return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  it('the function was found in the script, not silently skipped', () => {
    expect(bootstrap).toContain('note_mail_goes_nowhere_real() {');
    expect(bootstrap, 'defined but never called').toMatch(/^ {2}note_mail_goes_nowhere_real$/m);
  });

  it('speaks when a real https WEB_URL is served by the catcher', () => {
    const said = noteFor({ SMTP_HOST: 'mailpit', WEB_URL: 'https://app.ota.ownpace.eu' });
    expect(said).toContain('GOES TO THE CATCHER');
    expect(said, 'the note does not name the deployment it is about').toContain(
      'https://app.ota.ownpace.eu',
    );
    expect(said, 'no way to look at what was caught').toContain('http://localhost:');
  });

  it('says nothing on a local stack, which is the ordinary case', () => {
    expect(noteFor({ SMTP_HOST: 'mailpit', WEB_URL: 'http://localhost:3123' })).toBe('');
    expect(noteFor({ SMTP_HOST: 'mailpit', WEB_URL: 'https://localhost:3123' })).toBe('');
  });

  it('says nothing once a real relay is configured', () => {
    // The whole point is the pairing, not the hostname. A real deployment with
    // a real relay is the state this is steering towards and must be quiet.
    expect(noteFor({ SMTP_HOST: 'smtp.example.test', WEB_URL: 'https://app.ota.ownpace.eu' })).toBe(
      '',
    );
  });

  it('says nothing when SMTP is unset, because that is a different problem', () => {
    // Nothing is being sent anywhere, and `readNotifierConfig` already names
    // that. Two notes about one silence is how both get ignored.
    expect(noteFor({ SMTP_HOST: '', WEB_URL: 'https://app.ota.ownpace.eu' })).toBe('');
  });

  it('names the port from .env rather than assuming the default', () => {
    const said = noteFor({
      SMTP_HOST: 'mailpit',
      WEB_URL: 'https://app.ota.ownpace.eu',
      MAILPIT_PORT: '3999',
    });
    expect(said).toContain('http://localhost:3999');
  });

  it('still names a port when MAILPIT_PORT is not set at all', () => {
    // THE CASE THIS FILE DID NOT TEST, and the one an operator hit on
    // 2026-08-25: the note read `Read what it caught:  http://localhost:` with
    // nothing after the colon. The case above passes a port explicitly, so it
    // exercised the branch that worked and never the default.
    const said = noteFor({ SMTP_HOST: 'mailpit', WEB_URL: 'https://app.ota.ownpace.eu' });
    expect(said, 'the default port did not appear').toContain('http://localhost:3127');
  });

  it('and when it is present but empty, which is how the example ships it', () => {
    // managed.env.example carries `MAILPIT_PORT=3127`, but a key edited to
    // nothing is the same amount of port as no key at all.
    const said = noteFor({
      SMTP_HOST: 'mailpit',
      WEB_URL: 'https://app.ota.ownpace.eu',
      MAILPIT_PORT: '',
    });
    expect(said).toContain('http://localhost:3127');
  });
});
