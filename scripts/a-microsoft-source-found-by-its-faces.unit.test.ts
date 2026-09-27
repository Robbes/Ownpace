// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MICROSOFT SOURCE FOUND BY ITS FACES (workplan 0141 T11).
 *
 * A tester who presses *Connect with Microsoft* gets a `microsoft` connection.
 * The drift detector, group discovery and the permission report looked for
 * the tenant's Microsoft source by `kind = 'o365'` alone, and group discovery
 * branched on `kind !== 'o365'`. So that tester's Finish page said the tenant
 * had no Microsoft 365 source connection, and group discovery answered their
 * account in IMAP's words.
 *
 * A Microsoft source is `o365`, the customer's own registration, or any kind
 * whose mail face is Graph: `microsoftSourceKinds()` in orchestration. This
 * guard reads the server code as text and refuses the two shapes that found it
 * by `o365` alone:
 *
 * - a query that names `kind = 'o365'`;
 * - a branch on `kind !== 'o365'`.
 *
 * A comparison that PREFERS `o365` among the Microsoft sources, as
 * `directorySourceOf` does, is not either shape. It failed on three files on
 * `main`: two queries (`managed-drift-detect.ts`, `permissions.ts`) and one
 * branch (`managed-group-discovery.ts`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const APPS = join(ROOT, 'apps');

/** Every server and web source file under `apps/`, tests excluded. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) found.push(path);
  }
  return found;
}

/** Comments removed: a comment may name the old shape to say why it is gone. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** A query that finds the Microsoft source by `o365` alone. */
const BY_O365_ALONE = /\bkind\s*=\s*'o365'/;
/** A branch that treats every other kind as not Microsoft. */
const NOT_O365_BRANCH = /\bkind\s*!==?\s*'o365'|'o365'\s*!==?\s*[\w.]*\bkind\b/;

const FILES = sourceFiles(APPS).map((path) => ({
  file: relative(ROOT, path),
  code: code(readFileSync(path, 'utf8')),
}));

describe('a Microsoft source is found by every Microsoft kind', () => {
  it('reads enough of apps/ for the checks below to mean something', () => {
    const read = FILES.map((f) => f.file);
    expect(read.length).toBeGreaterThan(200);
    for (const file of [
      'apps/api/src/routes/permissions.ts',
      'apps/worker/src/jobs/managed-drift-detect.ts',
      'apps/worker/src/jobs/managed-group-discovery.ts',
    ]) {
      expect(read, `${file} is no longer read`).toContain(file);
    }
  });

  it('recognises the two shapes it refuses, as they stood on main', () => {
    const shapes = {
      query: "WHERE tenant_id = $1 AND role = 'source' AND kind = 'o365' LIMIT 1",
      branch: "if (source.kind !== 'o365') return listImapGroups();",
      preference: "rows.find((row) => row.kind === 'o365') ?? rows[0]",
    };
    expect(BY_O365_ALONE.test(shapes.query)).toBe(true);
    expect(NOT_O365_BRANCH.test(shapes.branch)).toBe(true);
    // And not the preference among Microsoft sources, which is allowed.
    expect(BY_O365_ALONE.test(shapes.preference)).toBe(false);
    expect(NOT_O365_BRANCH.test(shapes.preference)).toBe(false);
  });

  it('has no query that finds it by o365 alone', () => {
    const offenders = FILES.filter((f) => BY_O365_ALONE.test(f.code)).map((f) => f.file);
    expect(
      offenders,
      "a query finds the tenant's Microsoft source by kind = 'o365' alone, so a Microsoft " +
        'account is missed. Ask for `kind = ANY($n::text[])` with `microsoftSourceKinds()`.',
    ).toEqual([]);
  });

  it('has no branch that takes a Microsoft account for another kind', () => {
    const offenders = FILES.filter((f) => NOT_O365_BRANCH.test(f.code)).map((f) => f.file);
    expect(
      offenders,
      "a branch treats every kind but 'o365' as not Microsoft. Ask " +
        '`microsoftSourceKinds().includes(kind)`.',
    ).toEqual([]);
  });

  it('asks the one list in each of the three places', () => {
    for (const file of [
      'apps/api/src/routes/permissions.ts',
      'apps/worker/src/jobs/managed-drift-detect.ts',
      'apps/worker/src/jobs/managed-group-discovery.ts',
    ]) {
      const found = FILES.find((f) => f.file === file)!;
      expect(found.code, `${file} no longer asks microsoftSourceKinds()`).toContain(
        'microsoftSourceKinds()',
      );
    }
  });
});
