// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CATCHER ONLY WHERE IT CATCHES (workplan 0133 T3 (b), the owner's D5).
 *
 * Mailpit keeps what it is handed and delivers nothing. `phase_app` started it
 * on every stack, unconditionally, so a production stack whose mail went to a
 * real relay still ran an idle catcher, beside the testers' addresses and grant
 * mails it had caught while the relay was not yet set. Run, not read:
 *
 * - the catcher is not in the list every stack starts;
 * - `catcher_needed` says yes with the demo, whose Nextcloud sends to it, and
 *   while `SMTP_HOST` is `mailpit`, and no on a stack whose mail goes to a
 *   relay, or nowhere;
 * - a catcher still running there is named, with the command that stops it,
 *   and the bring-up never stops it itself: what it caught is the owner's to
 *   read and delete first.
 *
 * It fails today: `mailpit` sits in `phase_app`'s unconditional list.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');
const bootstrap = readFileSync(join(COMPOSE_DIR, 'bootstrap-managed.sh'), 'utf8');

/** A function of the real script, lifted whole, so the text under test is the text that ships. */
function fn(name: string): string {
  const at = bootstrap.indexOf(`${name}() {`);
  return at < 0 ? '' : bootstrap.slice(at, bootstrap.indexOf('\n}\n', at) + 3);
}

/** Shell comments removed: a comment may name the catcher without starting it. */
const code = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');

/** Run a few lines against a written `.env`, with the lifted helpers and a stand-in `docker compose`. */
function run(env: Record<string, string>, lines: string[], running: string[] = []) {
  const home = mkdtempSync(join(tmpdir(), 'catcher-'));
  try {
    const envFile = join(home, '.env');
    const calls = join(home, 'calls');
    writeFileSync(
      envFile,
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n',
    );
    writeFileSync(calls, '');
    const program = [
      'set -uo pipefail',
      `. "${join(COMPOSE_DIR, 'env-read.sh')}"`,
      `ENV_FILE="${envFile}"`,
      'note() { echo "    $*"; }',
      // `docker compose` for this stack: records every call, and answers `ps`
      // with the services the case says are running.
      `fake_compose() { echo "$*" >> "${calls}"; [ "$1" = ps ] && printf '%s\\n' ${running.map((s) => `'${s}'`).join(' ')}; return 0; }`,
      'COMPOSE=(fake_compose)',
      fn('env_get'),
      fn('env_or'),
      fn('catcher_needed'),
      fn('note_catcher_left_running'),
      ...lines,
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
    return {
      said: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
      calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean),
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const needed = (env: Record<string, string>, withDemo: 0 | 1) =>
  run(env, [`WITH_DEMO=${withDemo}`, 'catcher_needed && echo yes || echo no']).said;

describe('the app phase', () => {
  it('does not start the catcher on every stack', () => {
    const app = fn('phase_app');
    expect(app, 'phase_app is no longer recognisable').not.toBe('');
    const list = app.slice(app.indexOf('local services=('), app.indexOf('\n  )\n', app.indexOf('local services=(')));
    expect(list, 'the list every stack starts is no longer recognisable').toContain('api web');
    expect(code(list)).not.toMatch(/\bmailpit\b/);
  });

  it('adds it where something sends to it, and says so where nothing does', () => {
    expect(code(fn('phase_app'))).toMatch(
      /if catcher_needed; then\s+services\+=\(mailpit\)\s+else\s+note_catcher_left_running\s+fi/,
    );
  });
});

describe('where the catcher is needed', () => {
  it('with the demo, whose Nextcloud sends to it, whatever SMTP_HOST says', () => {
    expect(needed({ SMTP_HOST: 'smtp.relay.test' }, 1)).toBe('yes');
  });

  it('while SMTP_HOST is mailpit, as on the OTA stack and in development', () => {
    expect(needed({ SMTP_HOST: 'mailpit' }, 0)).toBe('yes');
  });

  it('not where mail goes to a relay, or nowhere, and there is no demo', () => {
    expect(needed({ SMTP_HOST: 'smtp.relay.test' }, 0)).toBe('no');
    expect(needed({ SMTP_HOST: '' }, 0)).toBe('no');
  });
});

describe('a catcher left running where nothing sends to it', () => {
  it('is named, with the command that stops it, and never stopped here', () => {
    const { said, calls } = run({ SMTP_HOST: 'smtp.relay.test' }, ['note_catcher_left_running'], ['api', 'mailpit']);
    expect(said).toContain('THE MAIL CATCHER IS STILL RUNNING');
    expect(said).toContain('Read and delete that');
    expect(said).toContain('docker compose -f deploy/compose/managed.yml stop mailpit');
    expect(calls.every((call) => call.startsWith('ps ')), `the bring-up ran: ${calls.join('; ')}`).toBe(true);
  });

  it('says nothing when it is not running', () => {
    expect(run({ SMTP_HOST: 'smtp.relay.test' }, ['note_catcher_left_running'], ['api', 'web']).said).toBe('');
  });
});
