// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The redactor, tested against the log it actually has to clean
 * (workplan 0084 T5).
 *
 * `smoke-managed.sh` warns in its own header that runner debug logs print the
 * FULL task environment — `DATABASE_URL`, `SECRET_ENCRYPTION_KEY`, the
 * `tr_prod_` key. The managed nightly uploads that as an artifact, and a CI
 * artifact is downloadable by anyone who can read the repository.
 *
 * So this is the one step whose bug is a credential disclosure, which is why it
 * is a script rather than a shell block inside the workflow: **a `run:` block
 * cannot be tested, and this one has to be.**
 *
 * The fixture is deliberately awkward rather than tidy — secrets appearing
 * bare, inside `KEY=value`, inside a connection string, inside JSON, and twice
 * on one line — because a redactor that only handles `KEY=value` looks correct
 * against a clean fixture and leaks against a real log.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'deploy/compose/redact-evidence.sh');

/** Real-shaped values. None of these is a credential to anything. */
const SECRET_ENCRYPTION_KEY = 'a3f5c9d18e2b47a6b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3';
const JWT_SECRET = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0';
const TRIGGER_SECRET_KEY = 'tr_prod_A1b2C3d4E5f6G7h8I9j0K1l2';
const POSTGRES_PASSWORD = 'sup3rs3cret-postgres-pw';
const DASHBOARD_ONLY_PASSWORD = 'set-only-in-the-trigger-dashboard-9911';

let dir: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'redact-'));
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  envFile = join(dir, '.env');
  writeFileSync(
    envFile,
    [
      '# a comment',
      '',
      `SECRET_ENCRYPTION_KEY=${SECRET_ENCRYPTION_KEY}`,
      `JWT_SECRET=${JWT_SECRET}`,
      `TRIGGER_SECRET_KEY=${TRIGGER_SECRET_KEY}`,
      `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
      'NODE_ENV=production',
      'TRIGGER_PORT=3090',
    ].join('\n'),
  );
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function redact(contents: string): string {
  const file = join(dir, 'evidence', 'runner.log');
  writeFileSync(file, contents);
  execFileSync('bash', [SCRIPT, join(dir, 'evidence')], {
    env: { ...process.env, REDACT_ENV_FILE: envFile },
  });
  return readFileSync(file, 'utf8');
}

describe('redact-evidence.sh', () => {
  it('removes every named secret, however it appears in the line', () => {
    const out = redact(
      [
        `SECRET_ENCRYPTION_KEY=${SECRET_ENCRYPTION_KEY}`,
        `bare on its own: ${SECRET_ENCRYPTION_KEY}`,
        `{"jwtSecret":"${JWT_SECRET}","note":"json"}`,
        `two on one line: ${JWT_SECRET} and ${POSTGRES_PASSWORD}`,
        `key=${TRIGGER_SECRET_KEY}`,
      ].join('\n'),
    );
    for (const secret of [
      SECRET_ENCRYPTION_KEY,
      JWT_SECRET,
      TRIGGER_SECRET_KEY,
      POSTGRES_PASSWORD,
    ]) {
      expect(out, secret.slice(0, 12)).not.toContain(secret);
    }
    expect(out).toContain('[REDACTED]');
  });

  it('removes a password we could NOT name, from a connection string', () => {
    // The case pass 1 cannot cover and pass 2 exists for: a value set directly
    // in the Trigger.dev dashboard never appears in .env, so nothing knows its
    // name. These are the ones nobody remembers to add to a list.
    const out = redact(
      `DATABASE_URL=postgresql://openmigrate:${DASHBOARD_ONLY_PASSWORD}@postgres:5432/openmigrate`,
    );
    expect(out).not.toContain(DASHBOARD_ONLY_PASSWORD);
    // The rest of the URL survives, because it is the part that makes the log
    // useful for debugging.
    expect(out).toContain('postgresql://openmigrate:[REDACTED]@postgres:5432/openmigrate');
  });

  it('removes a tr_ key it was never told about', () => {
    const out = redact('using key tr_prod_ZZZZZZZZ9999aaaaBBBB to enqueue');
    expect(out).not.toContain('tr_prod_ZZZZZZZZ9999aaaaBBBB');
    expect(out).toContain('tr_prod_[REDACTED]');
  });

  it('removes a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJ0ZW5hbnRJZCI6ImEifQ.abc123DEF456';
    const out = redact(`Authorization: Bearer ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toContain('[REDACTED_JWT]');
  });

  it('leaves the diagnostics that make the log worth keeping', () => {
    // A redactor that removes everything is safe and useless. The point of the
    // evidence is to explain a failure.
    const out = redact(
      [
        'NODE_ENV=production',
        'TRIGGER_PORT=3090',
        '[api] verification run 5e2b0000-e29b-41d4-a716-446655440001 -> done',
        'error: connect ECONNREFUSED 172.18.0.7:5432',
      ].join('\n'),
    );
    expect(out).toContain('NODE_ENV=production');
    expect(out).toContain('TRIGGER_PORT=3090');
    expect(out).toContain('verification run 5e2b0000-e29b-41d4-a716-446655440001 -> done');
    expect(out).toContain('ECONNREFUSED 172.18.0.7:5432');
  });

  it('does not mangle a short non-secret that happens to share a name', () => {
    // Values under eight characters are skipped: replacing a three-character
    // one would rewrite unrelated text all over the log.
    writeFileSync(envFile, 'API_KEY=abc\nNODE_ENV=production\n');
    const out = redact('abc appears in abcdef and in fiabcnal');
    expect(out).toContain('abcdef');
    expect(out).toContain('fiabcnal');
  });

  it('cleans every file in the directory, not just the first', () => {
    writeFileSync(join(dir, 'evidence', 'a.log'), `one ${JWT_SECRET}`);
    writeFileSync(join(dir, 'evidence', 'b.log'), `two ${JWT_SECRET}`);
    execFileSync('bash', [SCRIPT, join(dir, 'evidence')], {
      env: { ...process.env, REDACT_ENV_FILE: envFile },
    });
    expect(readFileSync(join(dir, 'evidence', 'a.log'), 'utf8')).not.toContain(JWT_SECRET);
    expect(readFileSync(join(dir, 'evidence', 'b.log'), 'utf8')).not.toContain(JWT_SECRET);
  });

  it('refuses a directory that is not there, rather than silently doing nothing', () => {
    // A redactor that no-ops on a bad path would report success over an
    // unredacted upload.
    expect(() =>
      execFileSync('bash', [SCRIPT, join(dir, 'nope')], {
        env: { ...process.env, REDACT_ENV_FILE: envFile },
        stdio: 'pipe',
      }),
    ).toThrow();
  });
});
