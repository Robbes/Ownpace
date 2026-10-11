// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WORD NOBODY SAYS (the owner, 2026-10-11).
 *
 * The dictionary is written and reviewed in two languages, so a key no screen
 * says costs twice and shows nobody anything. On 2026-10-11 thirteen such keys
 * were found and deleted, among them the table headings of a Migrations list
 * that had been a list of people for weeks (*Source → Target*, *Last Sync*,
 * *Actions*), still translated into Dutch.
 *
 * A key counts as said when the code (the web app, and the packages that hand
 * it key names, such as the credential fields' labels) names it:
 *
 * - **literally**, in quotes: `t('billing.title')`, or a table of keys;
 * - **as a built name**: a template literal that starts with a prefix, such as
 *   `account.${provider}.connect`, says every key its shape fits;
 * - **by a prefix and a plus**: `'decisionCategory.' + category`;
 * - **as a plural**: `plural('view.copied', n)` says `view.copied.one` and
 *   `view.copied.many`.
 *
 * A key none of these reach is either dead, and goes from both languages, or
 * said in a way this guard cannot see, which is the thing to fix: a key
 * assembled where nobody can find it is one the next tidy-up deletes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { STRINGS } from './strings.ts';
import { OPERATOR_STRINGS } from './operator-strings.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** The source files that may name a key: the web app's, and every package's. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
    }
  };
  walk(join(ROOT, 'apps/web/src'));
  for (const pkg of readdirSync(join(ROOT, 'packages'))) {
    const src = join(ROOT, 'packages', pkg, 'src');
    try {
      if (statSync(src).isDirectory()) walk(src);
    } catch {
      // A package without a src folder names no key.
    }
  }
  // The dictionary itself is what is being asked about, not a speaker of it.
  return out.filter((f) => !/apps\/web\/src\/i18n\/(strings(\.ts|\/)|operator-strings\.ts)/.test(relative(ROOT, f)));
}

const SEGMENT = '[A-Za-z0-9_-]+';

/** Every way the code names a key, read once. */
function whatTheCodeSays(): { literal: Set<string>; shapes: RegExp[] } {
  const code = sources()
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const literal = new Set<string>();
  for (const m of code.matchAll(/['"`]([a-zA-Z]+(?:\.[A-Za-z0-9_-]+)+)['"`]/g)) literal.add(m[1]!);
  for (const m of code.matchAll(/plural\(\s*['"]([A-Za-z0-9_.-]+)['"]/g)) {
    literal.add(`${m[1]}.one`);
    literal.add(`${m[1]}.many`);
  }
  const escape = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  const shapes: RegExp[] = [];
  for (const m of code.matchAll(/`([a-zA-Z]+\.[^`]*\$\{[^`]*)`/g)) {
    const parts = m[1]!.split(/\$\{[^}]*\}/).map(escape);
    shapes.push(new RegExp(`^${parts.join(`${SEGMENT}(?:\\.${SEGMENT})*`)}$`));
  }
  for (const m of code.matchAll(/['"]([a-zA-Z]+(?:\.[A-Za-z0-9_-]+)*\.)['"]\s*\+/g)) {
    shapes.push(new RegExp(`^${escape(m[1]!)}`));
  }
  return { literal, shapes };
}

describe('every key in the dictionary is one the code says', () => {
  const { literal, shapes } = whatTheCodeSays();
  const said = (key: string) => literal.has(key) || shapes.some((shape) => shape.test(key));

  it('reads the code the keys are said in, so an empty walk cannot pass', () => {
    expect(literal.has('common.cancel')).toBe(true);
    expect(literal.has('support.heading')).toBe(true);
    expect(shapes.some((shape) => shape.test('account.google.connect'))).toBe(true);
  });

  it('says every bilingual key', () => {
    expect(Object.keys(STRINGS.en).filter((key) => !said(key))).toEqual([]);
  });

  it('says every operator key', () => {
    expect(Object.keys(OPERATOR_STRINGS).filter((key) => !said(key))).toEqual([]);
  });
});
