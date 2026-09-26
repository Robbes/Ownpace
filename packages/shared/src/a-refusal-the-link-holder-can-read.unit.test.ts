// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUSAL THE LINK HOLDER CAN READ (workplan 0145 T6).
 *
 * The grant page is read by somebody a tester asks for access: a family member
 * or a colleague, with no account and no reason to trust us. Its frame was
 * Dutch and every refusal on it was English, because the refusals were written
 * on the server, one language only: the link that cannot be used, the "not
 * ready" frame and its seven reasons, the two sign-in wrappers, and the
 * callback's own endings. A Dutch reader met *"This link cannot be used"*
 * under *"Verbind uw account"*.
 *
 * `docs/i18n-prose-boundary.md` class 4 names the cure: the Dutch sits beside
 * its English in `@openmig/shared`, updated together or neither. This file
 * holds every pair in `link-holder-refusals.ts` to three things:
 *
 * - both halves are there, and they are not the same sentence twice;
 * - the Dutch half is Dutch: none of the English words a frame is made of;
 * - a finding inside a pair (what Google said, an address, the operator's own
 *   detail) arrives verbatim in both halves. "Translate the frame, never the
 *   finding."
 *
 * The pairs are FOUND, not listed: every `{ en, nl }` the module exports is
 * checked, and every function it exports must be called below, so a new pair
 * cannot arrive unchecked.
 */

import { describe, it, expect } from 'vitest';
import * as prose from './link-holder-refusals.ts';
import type { Bilingual } from './link-holder-refusals.ts';

/**
 * The words an English frame cannot do without, and Dutch never uses. `is`,
 * `was` and `in` are left out on purpose: they are Dutch words too.
 */
const ENGLISH = /\b(?:the|and|your|you|this|not|with|from|have|has|that|it|been|can|could|will|would|please)\b/i;

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
    for (const [k, v] of Object.entries(value)) pairsIn(v, `${path}.${k}`, out);
  }
  return out;
}

/** The helpers that make no sentence of their own. */
const HELPERS = new Set(['inLocale', 'localeOf', 'reasonPair']);

/** Stand-ins for findings, so the Dutch check never reads a finding as English. */
const SAID = 'SAID_VERBATIM';
const DETAIL = 'DETAIL_VERBATIM: the operator sentence stays as it is';
const NAMED = 'named@example.invalid';
const OTHER = 'other@example.invalid';

/**
 * Each function the module exports, called the way its callers call it, with
 * the findings each call must carry through.
 */
const CALLS: Readonly<Record<string, () => Array<{ pair: Bilingual; findings: string[] }>>> = {
  notReady: () =>
    Object.values(prose.NOT_READY_BECAUSE).map((what) => ({ pair: prose.notReady(what), findings: [] })),
  cannotSignInYet: () => [{ pair: prose.cannotSignInYet(DETAIL), findings: [DETAIL] }],
  stoppedAtGoogle: () => [
    { pair: prose.stoppedAtGoogle('access_denied'), findings: [] },
    { pair: prose.stoppedAtGoogle(SAID), findings: [SAID] },
  ],
  unconfirmedAccount: () => [{ pair: prose.unconfirmedAccount(NAMED), findings: [NAMED] }],
  anotherAccount: () => [{ pair: prose.anotherAccount(OTHER, NAMED), findings: [OTHER, NAMED] }],
};

function withoutFindings(s: string, findings: ReadonlyArray<string>): string {
  return findings.reduce((acc, f) => acc.split(f).join(' '), s);
}

describe('every pair written for a link holder (0145 T6)', () => {
  const fixed = pairsIn(prose, 'link-holder-refusals', []);

  it('finds the pairs, so the checks below are not reading nothing', () => {
    // The link refusal, the check that failed, the migration that is gone,
    // seven reasons, five exchange refusals, and the callback's own four.
    expect(fixed.length).toBeGreaterThanOrEqual(19);
  });

  it('has a non-empty English and Dutch half, and they differ', () => {
    for (const [path, pair] of fixed) {
      expect(pair.en.trim(), `${path}.en`).not.toBe('');
      expect(pair.nl.trim(), `${path}.nl`).not.toBe('');
      expect(pair.nl, path).not.toBe(pair.en);
    }
  });

  it('says the Dutch half in Dutch', () => {
    for (const [path, pair] of fixed) {
      expect(ENGLISH.exec(pair.nl)?.[0], `${path}.nl reads as English: ${pair.nl}`).toBeUndefined();
    }
  });

  it('calls every function the module exports, so none makes a pair unchecked', () => {
    const functions = Object.entries(prose)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .filter((k) => !HELPERS.has(k));
    expect(functions.sort()).toEqual(Object.keys(CALLS).sort());
  });

  for (const [name, call] of Object.entries(CALLS)) {
    it(`${name}: both halves, different, Dutch in Dutch, and the finding verbatim in each`, () => {
      const made = call();
      expect(made.length).toBeGreaterThan(0);
      for (const { pair, findings } of made) {
        expect(pair.en.trim()).not.toBe('');
        expect(pair.nl.trim()).not.toBe('');
        expect(pair.nl).not.toBe(pair.en);
        for (const f of findings) {
          expect(pair.en, `${name}: the English half lost ${f}`).toContain(f);
          expect(pair.nl, `${name}: the Dutch half lost ${f}`).toContain(f);
        }
        const dutch = withoutFindings(pair.nl, findings);
        expect(ENGLISH.exec(dutch)?.[0], `${name}.nl reads as English: ${pair.nl}`).toBeUndefined();
      }
    });
  }
});

describe('the link refusal is ONE pair, which the ledger reads too', () => {
  it('keeps the English sentence the ledger has always answered with', () => {
    expect(prose.LINK_REFUSAL.en).toBe(
      'This link cannot be used. It may have been used already, it may have expired, or the ' +
        'person who sent it may have withdrawn it. Ask them for a fresh link — issuing one takes ' +
        'them a moment.',
    );
  });

  it('carries the Dutch the plan proposed', () => {
    expect(prose.LINK_REFUSAL.nl).toBe(
      'Deze link kan niet worden gebruikt. Misschien is hij al gebruikt, verlopen of ingetrokken ' +
        'door wie hem stuurde. Vraag om een nieuwe link; die is zo gemaakt.',
    );
  });
});

describe('which language a request asked for', () => {
  it('is Dutch only when it says exactly nl', () => {
    expect(prose.localeOf('nl')).toBe('nl');
  });

  it('is English for anything else, or for nothing', () => {
    for (const raw of ['en', 'de', 'NL', 'nl-NL', '', undefined, null, 1, {}, ['nl']]) {
      expect(prose.localeOf(raw), JSON.stringify(raw)).toBe('en');
    }
  });

  it('picks the half it names', () => {
    const pair = { en: 'English', nl: 'Nederlands' };
    expect(prose.inLocale(pair, 'nl')).toBe('Nederlands');
    expect(prose.inLocale(pair, 'en')).toBe('English');
  });

  it('puts a pair on the wire as `reason` and `reasonNl`', () => {
    expect(prose.reasonPair({ en: 'English', nl: 'Nederlands' })).toEqual({
      reason: 'English',
      reasonNl: 'Nederlands',
    });
  });
});
