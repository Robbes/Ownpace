// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Every environment variable an integration test waits for is one the harness
 * actually sets.
 *
 * WHY. The integration tier degrades to green. Each suite guards on the env vars
 * its dependency needs — `STALWART_JMAP_URL`, `NEXTCLOUD_WEBDAV_URL` and friends
 * — and when they are absent it calls `describe.skip` and passes. That is the
 * right behaviour for a developer without Docker. It is also indistinguishable,
 * in a CI summary, from the suite having run.
 *
 * Postgres is the one exception: `TEST_DATABASE_URL` missing THROWS. Everything
 * else warns and skips. So a Stalwart container that failed to start, a
 * `SKIP_NEXTCLOUD` that leaked from the unit job into the integration job, or a
 * renamed variable, all produce the same output as success.
 *
 * WHAT THIS CATCHES, precisely: a test guarding on a variable the global setup
 * never exports. That test does not fail — it skips, on every run, forever, and
 * the only visible symptom is a number nobody is comparing against anything. It
 * is the env-var form of the uncollected test file.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody trusts it further than it goes: this
 * is STATIC. It reads both files as text. It cannot tell you the containers
 * actually started, only that the wiring names match. A runtime assertion in the
 * global setup — refusing to proceed when a service it was asked to start did
 * not export its variables — is the complementary guard, and is NOT written yet.
 * Deliberately a unit test: it needs no Docker, so it runs on every pull request,
 * which is exactly when the wiring drifts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GLOBAL_SETUP = join(REPO_ROOT, 'vitest.global-setup.ts');

/** Variables that name an external dependency, as opposed to ordinary config. */
const DEPENDENCY_VAR = /^(STALWART|NEXTCLOUD)_[A-Z0-9_]+$|^TEST_DATABASE_URL$/;

/** Set by CI or a developer to opt OUT of a service, so never harness-exported. */
const OPT_OUT_VARS = new Set(['SKIP_STALWART', 'SKIP_NEXTCLOUD']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith('.integration.test.ts')) out.push(full);
  }
  return out;
}

const setupSource = readFileSync(GLOBAL_SETUP, 'utf8');

/** `process.env.FOO = ...` — what the harness promises to provide. */
const exported = new Set(
  [...setupSource.matchAll(/process\.env\.([A-Z0-9_]+)\s*=/g)].map((m) => m[1]!),
);

const integrationTests = walk(REPO_ROOT);

/** `process.env.FOO` read anywhere in an integration test — what suites wait for. */
const guardedOn = new Map<string, string[]>();
for (const file of integrationTests) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    const name = m[1]!;
    if (!DEPENDENCY_VAR.test(name) || OPT_OUT_VARS.has(name)) continue;
    const list = guardedOn.get(name) ?? [];
    if (!list.includes(file)) list.push(file);
    guardedOn.set(name, list);
  }
}

describe('the integration harness exports what the integration tests wait for', () => {
  it('found a real global setup, and real integration tests', () => {
    // The vacuity guard. Every assertion below passes trivially against empty
    // sets — a moved file or a changed assignment syntax would otherwise report
    // perfect agreement between nothing and nothing, which is the exact failure
    // this file exists to prevent one level down.
    expect(setupSource.length, `${GLOBAL_SETUP} is empty or unreadable`).toBeGreaterThan(500);
    expect(exported.size, 'no process.env assignments parsed out of the global setup').toBeGreaterThan(4);
    expect(integrationTests.length, 'no *.integration.test.ts files found').toBeGreaterThan(10);
    expect(guardedOn.size, 'no dependency env vars found in any integration test').toBeGreaterThan(3);
  });

  it('sets every dependency variable an integration test guards on', () => {
    const orphans = [...guardedOn.entries()]
      .filter(([name]) => !exported.has(name))
      .map(([name, files]) => ({
        name,
        files: files.map((f) => relative(REPO_ROOT, f)),
      }));

    expect(
      orphans.map((o) => o.name),
      'these variables are read by an integration test but NEVER set by ' +
        'vitest.global-setup.ts, so those suites skip — silently and on every ' +
        'run — rather than fail:\n' +
        orphans
          .map((o) => `  - ${o.name}\n` + o.files.map((f) => `      ${f}`).join('\n'))
          .join('\n') +
        '\nEither export it from the global setup or stop guarding on it.',
    ).toEqual([]);
  });

  it('still throws, rather than skips, when the database is missing', () => {
    // TEST_DATABASE_URL is the one dependency whose absence is fatal rather than
    // quietly skipped, and that asymmetry is load-bearing: it is the only reason
    // a completely unprovisioned integration run fails at all. If someone
    // "harmonises" it into a skip to match the others, the tier can go green
    // having started no containers whatsoever.
    expect(
      /TEST_DATABASE_URL[\s\S]{0,400}?throw new Error/.test(
        readFileSync(join(REPO_ROOT, 'packages/core/src/dav-sync.integration.test.ts'), 'utf8'),
      ),
      'dav-sync.integration.test.ts no longer THROWS on a missing TEST_DATABASE_URL',
    ).toBe(true);
  });
});
