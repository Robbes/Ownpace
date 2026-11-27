// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY SERVER *U* HAS ITS *JE* (workplan 0176 §11, T7; D8 (a); the owner,
 * 2026-11-26: *"Yes"*).
 *
 * The member chooses, per person, whether that person's pages say *u* or
 * *je*. A person whose pages say *je* reads the server's own sentences on
 * them too: a link that cannot be used, a sign-in that did not finish, an
 * account that cannot be asked yet. The page shows the half the server
 * wrote, so the server writes the *je* form beside the *u* form, and a
 * person's link says it (`reasonPair(text, register)`, `inLocale(text,
 * locale, register)`). §11: *"a guard on the dictionary alone would pass with
 * a u on a je page."*
 *
 * Every pair this module exports is found, and every function it exports is
 * called, as `a-refusal-the-link-holder-can-read.unit.test.ts` does, so a new
 * one cannot arrive unchecked. Each is held to §11's rules:
 *
 *  - where its Dutch says *u* or *uw*, it has a *je* twin, unless only a
 *    migration's own link says it (named below: that link is for no person,
 *    so it has no register);
 *  - the twin says no *u* or *uw*, differs from the formal half, and keeps
 *    every finding verbatim;
 *  - the formal half says no *je*, *jij* or *jouw*.
 *
 * The API's own sentences for a person's link, and the ending after a
 * sign-in, are held to the same in `apps/api`
 * (`a-persons-link-says-je-where-their-pages-do.unit.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import * as prose from './link-holder-refusals.ts';
import type { Bilingual } from './link-holder-refusals.ts';

/** *U*, *uw* and *uwe*, as words. */
const FORMAL = /\b(?:u|uw|uwe)\b/i;
/** *Je*, *jij*, *jou*, *jouw* and *jouwe*, as words. */
const INFORMAL = /\b(?:je|jij|jou|jouw|jouwe)\b/i;

function isBilingual(v: unknown): v is Bilingual {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { en?: unknown }).en === 'string' &&
    typeof (v as { nl?: unknown }).nl === 'string'
  );
}

/** Every `{ en, nl }` reachable from `value`, by the path that reaches it. */
function pairsIn(value: unknown, path: string, out: Array<[string, Bilingual]>): Array<[string, Bilingual]> {
  if (isBilingual(value)) {
    out.push([path, value]);
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) pairsIn(v, path === '' ? k : `${path}.${k}`, out);
  }
  return out;
}

/** The helpers that make no sentence of their own. */
const HELPERS = new Set(['inLocale', 'localeOf', 'reasonPair']);

/**
 * WHAT ONLY A MIGRATION'S OWN LINK SAYS, by export (and by key, inside a
 * record). A migration's link, sent before 2026-10-03, is for no person, so
 * nothing on it has a register; a person's link says its own form of each
 * (`PERSON_PAGE_GONE`, `accountNotReady`, `…OnAPersonsLink`). Each is named
 * here because the API reaches it only from a migration's link: `view.ts` and
 * `grant.ts` on a mapping link, and `signedInAccountRefusal` when it is not
 * told a person's link asked.
 */
const ONLY_A_MIGRATIONS_OWN_LINK = new Set([
  'MIGRATION_GONE',
  'notReady',
  'cannotSignInYet',
  'NO_NAMED_ACCOUNT',
  'anotherAccount',
  'noNamedAccountAt',
  // A person's link overrides these two in `EXCHANGE_FOR_A_PERSONS_LINK`.
  'EXCHANGE_FOR_THE_LINK_HOLDER.refused',
  'EXCHANGE_FOR_THE_LINK_HOLDER.scope_missing',
]);

/** Stand-ins for findings, so a finding is never read as a pronoun. */
const SAID = 'SAID_VERBATIM';
const DETAIL = 'DETAIL_VERBATIM: the operator sentence stays as it is';
const NAMED = 'named@example.invalid';
const OTHER = 'other@example.invalid';
const PROVIDERS = ['google', 'microsoft', 'dropbox', 'apple'] as const;

type Made = { readonly pair: Bilingual; readonly findings: readonly string[] };

/** Each function the module exports, called the way its callers call it. */
const CALLS: Readonly<Record<string, () => Made[]>> = {
  notReady: () => Object.values(prose.NOT_READY_BECAUSE).map((what) => ({ pair: prose.notReady(what), findings: [] })),
  cannotSignInYet: () => [{ pair: prose.cannotSignInYet(DETAIL), findings: [DETAIL] }],
  stoppedAtGoogle: () => [
    { pair: prose.stoppedAtGoogle('access_denied'), findings: [] },
    { pair: prose.stoppedAtGoogle(SAID), findings: [SAID] },
  ],
  unconfirmedAccount: () => [{ pair: prose.unconfirmedAccount(NAMED), findings: [NAMED] }],
  anotherAccount: () => [{ pair: prose.anotherAccount(OTHER, NAMED), findings: [OTHER, NAMED] }],
  noNamedAccountAt: () => PROVIDERS.map((p) => ({ pair: prose.noNamedAccountAt(p), findings: [] })),
  unconfirmedAccountAt: () => PROVIDERS.map((p) => ({ pair: prose.unconfirmedAccountAt(p, NAMED), findings: [NAMED] })),
  anotherAccountAt: () => PROVIDERS.map((p) => ({ pair: prose.anotherAccountAt(p, OTHER, NAMED), findings: [OTHER, NAMED] })),
  stoppedAtProvider: () =>
    PROVIDERS.flatMap((p) => [
      { pair: prose.stoppedAtProvider(p, 'access_denied'), findings: [] },
      { pair: prose.stoppedAtProvider(p, SAID), findings: [SAID] },
    ]),
  nothingCameBackFrom: () => PROVIDERS.map((p) => ({ pair: prose.nothingCameBackFrom(p), findings: [] })),
  exchangeRefusedAt: () => PROVIDERS.map((p) => ({ pair: prose.exchangeRefusedAt(p), findings: [] })),
  twoClientsAt: () => PROVIDERS.map((p) => ({ pair: prose.twoClientsAt(p), findings: [] })),
  accountNotReady: () =>
    [prose.NOT_READY_BECAUSE, prose.NOT_READY_BECAUSE_MICROSOFT, prose.NOT_READY_BECAUSE_DROPBOX].flatMap((reasons) =>
      Object.values(reasons).map((what) => ({ pair: prose.accountNotReady(what), findings: [] })),
    ),
  cannotSignInYetOnAPersonsLink: () =>
    PROVIDERS.map((p) => ({ pair: prose.cannotSignInYetOnAPersonsLink(p, DETAIL), findings: [DETAIL] })),
  noNamedAccountOnAPersonsLinkAt: () => PROVIDERS.map((p) => ({ pair: prose.noNamedAccountOnAPersonsLinkAt(p), findings: [] })),
  anotherAccountOnAPersonsLink: () =>
    PROVIDERS.map((p) => ({ pair: prose.anotherAccountOnAPersonsLink(p, OTHER, NAMED), findings: [OTHER, NAMED] })),
};

const without = (s: string, findings: readonly string[]) => findings.reduce((acc, f) => acc.split(f).join(' '), s);

/** What breaks §11's rules in one pair, said so the failure names it. */
function broken(name: string, { pair, findings }: Made): string[] {
  const nl = without(pair.nl, findings);
  const out: string[] = [];
  if (INFORMAL.test(nl)) out.push(`${name}: the formal Dutch says je: ${pair.nl}`);
  if (pair.nlJe === undefined) {
    if (FORMAL.test(nl) && !ONLY_A_MIGRATIONS_OWN_LINK.has(name)) out.push(`${name}: says u, and has no je twin: ${pair.nl}`);
    return out;
  }
  const je = without(pair.nlJe, findings);
  if (FORMAL.test(je)) out.push(`${name}: the je twin says u: ${pair.nlJe}`);
  if (pair.nlJe === pair.nl) out.push(`${name}: the je twin is the formal sentence again`);
  for (const f of findings) if (!pair.nlJe.includes(f)) out.push(`${name}: the je twin lost ${f}`);
  return out;
}

describe('every server sentence a person’s link can say with u has its je (§11, T7)', () => {
  const fixed = pairsIn(prose, '', []);

  it('finds the pairs and calls every function, so none is unchecked', () => {
    expect(fixed.length).toBeGreaterThanOrEqual(19);
    const functions = Object.entries(prose)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .filter((k) => !HELPERS.has(k));
    expect(functions.sort()).toEqual(Object.keys(CALLS).sort());
  });

  it('in every pair the module exports', () => {
    const made = fixed.map(([path, pair]) => [path, { pair, findings: [] }] as const);
    expect(made.flatMap(([path, m]) => broken(path, m))).toEqual([]);
  });

  it('in every pair its functions make', () => {
    expect(Object.entries(CALLS).flatMap(([name, call]) => call().flatMap((m) => broken(name, m)))).toEqual([]);
  });

  it('and a person who says je is answered with it, everyone else as before', () => {
    const pair = prose.PERSON_PAGE_GONE;
    expect(prose.reasonPair(pair, 'informal').reasonNl).toBe(pair.nlJe);
    expect(prose.reasonPair(pair, 'formal').reasonNl).toBe(pair.nl);
    expect(prose.reasonPair(pair).reasonNl).toBe(pair.nl);
    expect(prose.inLocale(pair, 'nl', 'informal')).toBe(pair.nlJe);
    expect(prose.inLocale(pair, 'en', 'informal')).toBe(pair.en);
    // A pair with no twin says its formal half, whatever the register.
    expect(prose.inLocale({ en: 'E', nl: 'N' }, 'nl', 'informal')).toBe('N');
  });

  it('names as a migration’s own only what the module still exports', () => {
    const named = [...ONLY_A_MIGRATIONS_OWN_LINK].map((n) => n.split('.')[0]!);
    expect(named.filter((n) => !(n in prose))).toEqual([]);
  });
});
