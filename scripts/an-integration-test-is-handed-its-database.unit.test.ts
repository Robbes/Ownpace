// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN INTEGRATION TEST IS HANDED ITS DATABASE. IT MAY NOT GO LOOKING FOR ONE.
 *
 * The Testcontainers harness publishes its Postgres as `TEST_DATABASE_URL`
 * (`vitest.global-setup.ts`). It does NOT set `DATABASE_URL` — that variable
 * belongs to a deployed appliance, and on the runner it is simply absent.
 *
 * `buildDeps` and `buildDomainDeps` build the whole dependency bundle, ledger
 * included, and their ledger arm falls back to `process.env.DATABASE_URL` when
 * no handle is passed. So an integration test that calls either without
 * `ledgerDb` is not flaky and not environment-dependent: it fails every time,
 * on every architecture, with
 *
 *   Error: DATABASE_URL environment variable is required.
 *
 * That is exactly how PR #534 went red on both `integration-tests` jobs. The
 * file was written, typechecked, linted and unit-tested green here — because
 * the fast local path never starts a container, so the integration project
 * never runs and the missing argument is invisible until CI. It is the same
 * shape as the e2e-importing-workspace-code mistake that `test/e2e/
 * no-workspace-imports.unit.test.ts` was written to catch, one layer down:
 * a test that passes on this machine and dies on the runner.
 *
 * THE FIX IS ALWAYS TO PASS THE HANDLE, never to set `DATABASE_URL` from a
 * test. `LedgerOptions.ledgerDb` exists for precisely this, and the appliance
 * uses the same door (`apps/selfhost/src/index.ts`):
 *
 *   const ledgerDb = createPgDb(TEST_DATABASE_URL);
 *   const deps = await buildDeps(config, { ledgerDb });
 *   // ...and close it yourself: deps.close() leaves a caller's handle open.
 *
 * Writing `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL` would
 * make the symptom go away and leave a mutation of global state behind for
 * every other file sharing the worker.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The builders whose ledger arm reads `DATABASE_URL` when handed nothing. */
const BUILDERS = ['buildDeps', 'buildDomainDeps'] as const;

/**
 * Source with comments blanked out.
 *
 * Prose is not code: this very file, and the header of the test that provoked
 * it, both spell out `buildDeps(config)` as the WRONG form. A scanner that
 * cannot tell an example from a call flags its own explanation. Newlines are
 * preserved so reported line numbers still point at the right place.
 */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/**
 * The argument text of a call starting at `open` (the index of its `(`),
 * read by counting parentheses rather than by regex — arguments nest.
 */
function argumentsOf(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  // Unbalanced source would not compile; treat it as empty rather than throw.
  return source.slice(open + 1);
}

export interface Reach {
  readonly line: number;
  readonly why: string;
}

/** Every place in one integration test that goes looking for a database. */
export function reachesForADatabase(source: string): Reach[] {
  const code = withoutComments(source);
  const lineOf = (index: number) => code.slice(0, index).split('\n').length;
  const found: Reach[] = [];

  for (const match of code.matchAll(/process\.env\.DATABASE_URL/g)) {
    found.push({
      line: lineOf(match.index),
      why: 'reads process.env.DATABASE_URL, which the integration harness never sets (it publishes TEST_DATABASE_URL)',
    });
  }

  for (const builder of BUILDERS) {
    // A bare identifier, so `buildDepsFromMapping(` — which takes an explicit
    // pool and never touches the environment — is not mistaken for one.
    for (const match of code.matchAll(new RegExp(`\\b${builder}\\s*\\(`, 'g'))) {
      const open = match.index + match[0].length - 1;
      if (!/\bledgerDb\b/.test(argumentsOf(code, open))) {
        found.push({
          line: lineOf(match.index),
          why: `calls ${builder}() without a ledgerDb, so its ledger arm falls back to DATABASE_URL and throws on the runner`,
        });
      }
    }
  }

  return found.sort((a, b) => a.line - b.line);
}

function integrationTests(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) integrationTests(full, acc);
    else if (entry.endsWith('.integration.test.ts')) acc.push(full);
  }
  return acc;
}

describe('the scanner tells a call from a cautionary tale', () => {
  it('catches a builder called with no options at all', () => {
    expect(reachesForADatabase('const deps = await buildDeps(config);')).toHaveLength(1);
  });

  it('catches a builder whose options carry everything but the handle', () => {
    const found = reachesForADatabase("const d = buildDomainDeps(config, 'calendar', { throttle: 1 });");
    expect(found).toHaveLength(1);
    expect(found[0]!.why).toContain('buildDomainDeps');
  });

  it('accepts a builder handed a ledgerDb', () => {
    expect(reachesForADatabase('const deps = await buildDeps(config, { ledgerDb });')).toEqual([]);
    expect(
      reachesForADatabase('const deps = await buildDeps(config, { ledgerDb: createPgDb(url) });'),
    ).toEqual([]);
  });

  it('reads past nested parentheses to find the handle', () => {
    expect(
      reachesForADatabase('const deps = await buildDeps(parse(json(x)), { ledgerDb: open(url) });'),
    ).toEqual([]);
  });

  it('leaves buildDepsFromMapping alone — it is handed a pool', () => {
    expect(reachesForADatabase('await buildDepsFromMapping(pool, tenantId, mappingId);')).toEqual([]);
  });

  it('ignores an example inside a comment', () => {
    const source = [
      '// The first version called buildDeps(config) and died on the runner.',
      '/* Never write process.env.DATABASE_URL from a test. */',
      'const deps = await buildDeps(config, { ledgerDb });',
    ].join('\n');
    expect(reachesForADatabase(source)).toEqual([]);
  });

  it('reports the line the call is on, not the line the file starts on', () => {
    const source = ['', '', 'const deps = await buildDeps(config);'].join('\n');
    expect(reachesForADatabase(source)[0]!.line).toBe(3);
  });

  it('catches a test that assigns DATABASE_URL rather than passing a handle', () => {
    const found = reachesForADatabase('process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;');
    expect(found).toHaveLength(1);
    expect(found[0]!.why).toContain('TEST_DATABASE_URL');
  });
});

describe('no integration test in this repository goes looking for a database', () => {
  const files = integrationTests(ROOT).filter((f) => existsSync(f));

  it('found integration tests to check', () => {
    // A scanner that silently matches nothing is a scanner that passes forever.
    expect(files.length).toBeGreaterThan(20);
  });

  it('every one of them is handed its handle', () => {
    const offences: string[] = [];
    for (const file of files) {
      for (const reach of reachesForADatabase(readFileSync(file, 'utf8'))) {
        offences.push(`${relative(ROOT, file)}:${reach.line} — ${reach.why}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
