// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * DELETING BY HAND NEEDS NO SWITCH (alpha.21; workplan 0173 T1, ADR-0024's
 * amendment of 2026-11-25).
 *
 * Until alpha.21 every delete by hand passed ADR-0024's gate 1 first: a
 * per-mapping switch, `allowApplyDeletions` (managed: the column
 * `mailbox_mapping.allow_apply_deletions`), off unless turned on, refused as
 * `not_enabled`. The owner, 2026-11-25: *"Manual deleting in by default. I
 * don't think I makes sense then to keep the feature for turning it off."*
 * Every delete is two presses on the page already, and the switch checked
 * nothing about WHICH item may go; gates 2 to 7 do.
 *
 * The switch left traces that would bring it back quietly: a column still in
 * the schema, a key the appliance still parses so an old file loads, and a
 * refusal code three layers knew. So this holds:
 *
 * 1. `not_enabled` is not a refusal code any more, and stops no run.
 * 2. No shipped code in `apps/` or `packages/` reads `allowApplyDeletions` or
 *    `allow_apply_deletions`, comments aside, except the places named in
 *    `ALLOWED` with how many times: the appliance's parser and its one
 *    warning, the ledger's schema (the column waits for a later release to
 *    drop it), and the managed PATCH that refuses the old key by name.
 * 3. A mapping file saying `false` still loads, and is warned about once;
 *    `true` and absent say nothing. That its deletions are not refused is
 *    shown on the appliance's own path by
 *    `packages/orchestration/src/an-apply-pressed-after-cutover-on-the-appliance.unit.test.ts`,
 *    whose mapping says `false`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { APPLY_REFUSAL_CODES } from './operating-contract.ts';
import { RUN_STOPPING_REFUSALS } from './apply-each-in-turn.ts';
import { ignoredDeleteSwitchWarning, parseMappingConfig } from './config.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const NAMES = /allowApplyDeletions|allow_apply_deletions/;

/**
 * Where the names may still appear in code, and how often. A count, not a
 * yes: a new read in one of these files fails here too.
 */
const ALLOWED: Record<string, { readonly count: number; readonly why: string }> = {
  'packages/shared/src/config.ts': {
    count: 9,
    why: 'the field, its strict boolean parse (so an old file loads), and ignoredDeleteSwitchWarning',
  },
  'packages/ledger/src/schema-pg.ts': {
    count: 2,
    why: 'the column, unread, until a later release drops it',
  },
  'apps/api/src/routes/migrations/operating-routes.ts': {
    count: 3,
    why: 'the PATCH refuses a body that still sends the old key, by name',
  },
};

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '__tests__', '__testing__']);

function shippedSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...shippedSources(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/**
 * How many identifiers, property names and string or template parts of a file
 * name the old switch. PARSED, not searched: a comment is prose about code,
 * and the history of the switch is told in comments all over.
 */
function codeMentions(path: string): number {
  const text = readFileSync(path, 'utf-8');
  if (!NAMES.test(text)) return 0;
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    false,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isIdentifier(node) ||
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      NAMES.test(node.text)
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

describe('deleting by hand needs no switch', () => {
  it('1. not_enabled is no refusal code, and stops no run', () => {
    expect(APPLY_REFUSAL_CODES as readonly string[]).not.toContain('not_enabled');
    expect(RUN_STOPPING_REFUSALS.has('not_enabled')).toBe(false);
  });

  it('2. no shipped code reads the old switch, but where ALLOWED says and as often', () => {
    const found: Record<string, number> = {};
    for (const top of ['apps', 'packages']) {
      for (const path of shippedSources(join(ROOT, top))) {
        const n = codeMentions(path);
        if (n > 0) found[relative(ROOT, path)] = n;
      }
    }
    const expected = Object.fromEntries(Object.entries(ALLOWED).map(([path, a]) => [path, a.count]));
    expect(
      found,
      'Deleting by hand has no switch since alpha.21 (ADR-0024, 2026-11-25). Code that reads ' +
        '`allowApplyDeletions` or `allow_apply_deletions` brings gate 1 back. If this is a ' +
        'deliberate place that only parses, warns or refuses the old key, add it to ALLOWED with why.',
    ).toEqual(expected);
  });

  it('3. a mapping file saying false still loads, and is warned about once; true and absent say nothing', () => {
    const base = {
      tenantId: 'tenant-1',
      mappingId: 'old-file',
      source: { type: 'imap-oauth2', host: 'imap.example.invalid', port: 993, user: 'a@example.invalid', auth: { kind: 'login', passwordFromEnv: 'NOPE' } },
      target: { type: 'jmap', baseUrl: 'https://jmap.example.invalid', user: 'a@example.invalid', auth: { kind: 'basic', passwordFromEnv: 'NOPE' } },
    };
    const off = parseMappingConfig({ ...base, allowApplyDeletions: false });
    expect(off.allowApplyDeletions).toBe(false);
    const said = ignoredDeleteSwitchWarning(off);
    expect(said).toMatch(/old-file/);
    expect(said).toMatch(/no longer turns deleting by hand off/);
    expect(ignoredDeleteSwitchWarning(parseMappingConfig({ ...base, allowApplyDeletions: true }))).toBeUndefined();
    expect(ignoredDeleteSwitchWarning(parseMappingConfig(base))).toBeUndefined();
  });
});
