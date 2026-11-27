// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PERSON'S LINK SAYS *JE* WHERE THEIR PAGES DO (workplan 0176 §11, T7; D8
 * (a); the owner, 2026-11-26: *"Yes"*).
 *
 * The API's half of `every-server-u-has-its-je.unit.test.ts` in
 * `@openmig/shared`: what the routes of a person's link write themselves, and
 * the endings after a sign-in. §11: *"a guard on the dictionary alone would
 * pass with a u on a je page."*
 *
 *  - THE SENTENCES are read from the source of every file a person's link is
 *    answered from, parsed, so a new one cannot arrive unread: each `{ en, nl }`
 *    written there. Where its Dutch says *u* or *uw*, it has an `nlJe` that
 *    says neither and is not the same sentence; no formal half says *je*. A
 *    Dutch half written straight onto an answer (`reasonNl: '…'`) has no twin,
 *    so it says neither. What only the owner's own screens say is named below.
 *  - THE ENDINGS are rendered: every outcome of the page after a sign-in, and
 *    Cirrux Drive's, says no *u* in Dutch with *je*, and no *je* with *u*.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { grantResultPage } from './migrations/google-consent.ts';
import { cirruxResultPage } from './migrations/cirrux-consent.ts';
import { progressPageUrl } from './migrations/progress-page-url.ts';

/** *U*, *uw* and *uwe*, as words. */
const FORMAL = /\b(?:u|uw|uwe)\b/i;
/** *Je*, *jij*, *jou*, *jouw* and *jouwe*, as words. */
const INFORMAL = /\b(?:je|jij|jou|jouw|jouwe)\b/i;

/**
 * Every file a person's link is answered from, with what in it only the
 * owner's own screens say, by the name it is declared under.
 */
const A_PERSONS_LINK: Readonly<Record<string, readonly string[]>> = {
  'grant.ts': [],
  'grant-password.ts': [],
  'grant-providers.ts': [],
  'link-address-changes.ts': [],
  'person-progress.ts': [],
  'view.ts': [],
  'migrations/cirrux-consent.ts': ['CIRRUX_CONSENT_FOR_THE_OWNER'],
  'migrations/cirrux-link-ending.ts': [],
  'migrations/google-consent.ts': ['EXCHANGE_FOR_THE_OWNER'],
  'migrations/google-oauth-routes.ts': [],
  'migrations/link-ending.ts': [],
  'migrations/person-grant-ending.ts': [],
  'migrations/person-grant-subject.ts': [],
  'migrations/signed-in-account.ts': [],
};

/** A string the source spells out, with each `${…}` as `{x}`; null for anything computed. */
function textOf(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => `{x}${s.literal.text}`).join('');
  if (ts.isParenthesizedExpression(node)) return textOf(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const [l, r] = [textOf(node.left), textOf(node.right)];
    return l === null || r === null ? null : l + r;
  }
  return null;
}

/** The name the object is declared under, the nearest one out. */
function declaredUnder(node: ts.Node): string | null {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
    if (ts.isFunctionDeclaration(at) && at.name) return at.name.text;
  }
  return null;
}

interface Read {
  readonly pairs: number;
  readonly broken: string[];
}

/** Every `{ en, nl }` a file writes, and every Dutch half written onto an answer, held to §11. */
function readFile(file: string, owners: readonly string[]): Read {
  const path = join(import.meta.dirname, file);
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const broken: string[] = [];
  let pairs = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const prop = (name: string) =>
        node.properties.find(
          (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name,
        );
      const where = `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      const nl = prop('nl');
      const said = nl && prop('en') ? textOf(nl.initializer) : null;
      if (said !== null) {
        pairs += 1;
        const owners_ = owners.includes(declaredUnder(node) ?? '');
        const je = prop('nlJe');
        const twin = je ? textOf(je.initializer) : null;
        if (INFORMAL.test(said)) broken.push(`${where}: the formal Dutch says je: ${said}`);
        if (je === undefined && FORMAL.test(said) && !owners_) broken.push(`${where}: says u, and has no je twin: ${said}`);
        if (je !== undefined && twin === null) broken.push(`${where}: a je twin the source does not spell out`);
        if (twin !== null && FORMAL.test(twin)) broken.push(`${where}: the je twin says u: ${twin}`);
        if (twin !== null && twin === said) broken.push(`${where}: the je twin is the formal sentence again`);
      }
      for (const name of ['reasonNl', 'messageNl']) {
        const written = prop(name);
        const text = written ? textOf(written.initializer) : null;
        if (text !== null && (FORMAL.test(text) || INFORMAL.test(text))) {
          broken.push(`${where}: ${name} is written onto the answer, with no twin, and says u or je: ${text}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { pairs, broken };
}

describe('the sentences the routes of a person’s link write (§11, T7)', () => {
  const read = Object.entries(A_PERSONS_LINK).map(([file, owners]) => readFile(file, owners));

  it('are found, so the checks are not reading nothing', () => {
    expect(read.reduce((n, r) => n + r.pairs, 0)).toBeGreaterThanOrEqual(15);
  });

  it('say je beside every u, and no je where they say u', () => {
    expect(read.flatMap((r) => r.broken)).toEqual([]);
  });
});

/** What a reader reads on an ending: its text and the words its button carries, never its script. */
function readable(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, (tag) => ` ${[...tag.matchAll(/="([^"]*)"/g)].map((m) => m[1]).join(' ')} `);
}

/** Every way the page after a sign-in can end, for a person's link. */
function everyEnding(register: 'formal' | 'informal'): string[] {
  const progressUrl = progressPageUrl('https://app.example', 'a-view-token');
  const pages: string[] = [];
  for (const link of ['works', 'unused', undefined] as const) {
    pages.push(grantResultPage({ ok: false, reason: 'REASON', ...(link ? { link } : {}) }, 'nl', register));
  }
  for (const provider of ['google', 'microsoft', 'dropbox'] as const) {
    for (const permission of ['read-only', 'allows-changes', 'widened'] as const) {
      for (const page of [{}, { progressUrl }] as const) {
        for (const more of [undefined, { left: 1, backUrl: 'https://app.example/grant/x' }, { left: 2, backUrl: 'https://app.example/grant/x' }]) {
          pages.push(grantResultPage({ ok: true, provider, permission, ...page, ...(more ? { more } : {}) }, 'nl', register));
        }
      }
    }
  }
  const drive = { ok: true as const, connectionId: 'c', username: 'anna', workspace: 'w' };
  pages.push(cirruxResultPage({ outcome: drive, locale: 'nl', register }));
  return pages.map(readable);
}

describe('the ending after a sign-in, in Dutch (§11, T7)', () => {
  it('says je, and no u, to a person whose pages say je', () => {
    const offenders = everyEnding('informal').filter((text) => FORMAL.test(text));
    expect(offenders.map((text) => FORMAL.exec(text)?.input.slice(0, 200))).toEqual([]);
    expect(everyEnding('informal').every((text) => INFORMAL.test(text))).toBe(true);
  });

  it('and u, and no je, to everyone else', () => {
    expect(everyEnding('formal').filter((text) => INFORMAL.test(text))).toEqual([]);
  });

  it('and English is one you, whatever the register', () => {
    const page = (register: 'formal' | 'informal') =>
      grantResultPage({ ok: true, provider: 'google', permission: 'read-only' }, 'en', register);
    expect(page('informal')).toBe(page('formal'));
  });
});
