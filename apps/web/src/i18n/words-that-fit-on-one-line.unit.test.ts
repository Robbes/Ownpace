// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The copy budget (workplan 0118): a line on screen is one line.
 *
 * The owner read the wizard on 2026-09-05 and found every field carrying
 * three thoughts at once — what goes in the box, why, and a caveat. The
 * rule since then: a hint is one sentence of at most twelve words, an intro
 * at most fifteen or none, a placeholder shows the shape of a value, and
 * anything else that stays on screen fits in fifteen. What does not fit
 * folds: a `.why`, a `.more` or a checklist `.detail` opens under a word
 * and has no budget, because nobody reads it until they ask.
 *
 * Scope grows one prefix at a time, as each screen is brought under the
 * rule — a prefix listed here is a promise about every key under it, in
 * both languages. A sentence that must stay long verbatim (a consent, a
 * remedy) is named in ALLOWED_OVER with its reason, never deleted from the
 * dictionary to get green.
 */
import { describe, it, expect } from 'vitest';
import { STRINGS, LOCALES, type StringKey } from './strings.ts';

/** The screens brought under the rule so far. */
export const BUDGETED_PREFIXES: ReadonlyArray<string> = ['wizard.', 'setup.', 'fold.', 'connections.', 'probe.'];

/** Folded copy: opens under a word, so it has no budget. */
const FOLDED = /\.(why|more|detail)$/;

/** key → why it may run over. Keep this SHORT. */
const ALLOWED_OVER: Readonly<Record<string, string>> = {
  // The three invitation-safety sentences on a calendar target (0106 T0):
  // measured, unmeasured, absent. Safety sentences stay verbatim — owner,
  // 2026-09-05 — because a shorter one would promise less than is measured.
  'probe.scheduling.autoSchedule': 'safety sentence, verbatim by owner decision',
  'probe.scheduling.none': 'safety sentence, verbatim by owner decision',
  'probe.scheduling.unknown': 'safety sentence, verbatim by owner decision',
};

export type Budget = { readonly words: number; readonly oneSentence: boolean };

/** What a key of this shape may spend on screen. */
export function budgetFor(key: string): Budget | null {
  if (FOLDED.test(key)) return null;
  if (/\.hint(\.|$)/.test(key)) return { words: 12, oneSentence: true };
  if (/\.intro$/.test(key)) return { words: 15, oneSentence: false };
  if (/\.placeholder$/.test(key)) return { words: 8, oneSentence: false };
  if (/\.title$/.test(key)) return { words: 8, oneSentence: false };
  return { words: 15, oneSentence: false };
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** A second sentence starts after a full stop and a capital (or a digit). */
export function sentenceCount(text: string): number {
  return text.trim().split(/[.!?]\s+(?=[A-Z0-9À-Þ"“(])/).length;
}

export function overBudget(key: string, text: string): string | null {
  const budget = budgetFor(key);
  if (!budget) return null;
  const words = wordCount(text);
  if (words > budget.words) return `${key}: ${words} words, budget ${budget.words}`;
  if (budget.oneSentence && sentenceCount(text) > 1) return `${key}: ${sentenceCount(text)} sentences, budget 1`;
  return null;
}

describe('the copy budget — the counter itself', () => {
  it('counts words and sentences the way a reader does', () => {
    expect(wordCount('Only needed if this account will also receive mail.')).toBe(9);
    expect(sentenceCount('Only needed if this account will also receive mail.')).toBe(1);
    expect(sentenceCount('Treat it as a password. Never share it.')).toBe(2);
    // An abbreviation before a value is not a sentence break.
    expect(sentenceCount('e.g. /Team Docs')).toBe(1);
  });

  it('refuses a hint of thirteen words, a two-sentence hint, and a placeholder that is a sentence', () => {
    expect(overBudget('x.hint', 'one two three four five six seven eight nine ten eleven twelve thirteen')).toMatch(
      /13 words, budget 12/,
    );
    expect(overBudget('x.hint', 'One sentence here. And a second one.')).toMatch(/2 sentences/);
    expect(overBudget('x.placeholder', 'Empty means the whole account is used, every folder of it')).toMatch(
      /budget 8/,
    );
    // …and passes what fits.
    expect(overBudget('x.hint', 'one two three four five six seven eight nine ten eleven twelve')).toBeNull();
    expect(overBudget('x.why', 'a'.repeat(10) + ' word '.repeat(80))).toBeNull();
  });
});

describe('the copy budget — every budgeted key, in every language', () => {
  for (const locale of LOCALES) {
    it(`${locale}: fits the line it is on`, () => {
      const over: string[] = [];
      for (const [key, text] of Object.entries(STRINGS[locale]) as Array<[StringKey, string]>) {
        if (!BUDGETED_PREFIXES.some((p) => key.startsWith(p))) continue;
        if (ALLOWED_OVER[key]) continue;
        const problem = overBudget(key, text);
        if (problem) over.push(problem);
      }
      expect(over).toEqual([]);
    });
  }

  it('names only real keys in the allowance, so a removed sentence takes its excuse with it', () => {
    for (const key of Object.keys(ALLOWED_OVER)) expect(key in STRINGS.en).toBe(true);
  });
});
