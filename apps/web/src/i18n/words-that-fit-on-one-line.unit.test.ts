// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The copy budget (workplan 0118): what a hint, an intro, a placeholder and a
 * title may spend on screen.
 *
 * The owner read the wizard on 2026-09-05 and found every field carrying
 * three thoughts at once — what goes in the box, why, and a caveat. The
 * rule since then: a hint is one sentence of at most twelve words, an intro
 * at most fifteen or none, a placeholder shows the shape of a value, and a
 * title is a few words. What does not fit folds: a `.why`, a `.more` or a
 * checklist `.detail` opens under a word and has no budget, because nobody
 * reads it until they ask.
 *
 * Everything else has no budget since 2026-09-25. This guard used to hold
 * every other line to fifteen words as well, a cap none of the owner's
 * decisions named, and it made a sentence fold whenever its line ran one word
 * over. The owner: *"remove the generic 15-word cap rule and enforcement, it
 * forces you to hide additional text. We will have to work on what text to
 * actually show and what to fold. But now we fold to often."* What a screen
 * shows and what it folds is decided on the screen, not by a word count.
 *
 * A hint, an intro, a placeholder or a title that must stay long verbatim is
 * named in ALLOWED_OVER with its reason, never deleted from the dictionary to
 * get green.
 */
import { describe, it, expect } from 'vitest';
import { STRINGS, LOCALES, type StringKey } from './strings.ts';

/** Folded copy: opens under a word, so it has no budget. */
const FOLDED = /\.(why|more|detail)$/;

/**
 * key → why it may run over its budget. Keep this SHORT.
 *
 * Empty since 2026-09-25. Every sentence it named was a line of the kind that
 * no longer has a budget: the safety sentences on the Finish screen, the
 * failure remedies, the consent sentences and the alpha note's middle one.
 * They stay verbatim because the owner decided so (0118 T5, 0131 §3), not
 * because this list names them.
 */
const ALLOWED_OVER: Readonly<Record<string, string>> = {};

export type Budget = { readonly words: number; readonly oneSentence: boolean };

/** What a key of this shape may spend on screen. */
export function budgetFor(key: string): Budget | null {
  if (FOLDED.test(key)) return null;
  if (/\.hint(\.|$)/.test(key)) return { words: 12, oneSentence: true };
  if (/\.intro$/.test(key)) return { words: 15, oneSentence: false };
  if (/\.placeholder$/.test(key)) return { words: 8, oneSentence: false };
  if (/\.title$/.test(key)) return { words: 8, oneSentence: false };
  // No generic cap (owner, 2026-09-25): any other line says what it needs to.
  return null;
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

  it('holds no other line to a count: the generic fifteen is gone (owner, 2026-09-25)', () => {
    expect(budgetFor('confirm.progress.stopped')).toBeNull();
    expect(overBudget('x.body', 'word '.repeat(40))).toBeNull();
    expect(overBudget('x.intro', 'word '.repeat(16))).toMatch(/16 words, budget 15/);
  });
});

describe('the copy budget — every budgeted key, in every language', () => {
  for (const locale of LOCALES) {
    it(`${locale}: fits the line it is on`, () => {
      const over: string[] = [];
      for (const [key, text] of Object.entries(STRINGS[locale]) as Array<[StringKey, string]>) {
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

  it('names only keys that have a budget, so no excuse outlives its rule', () => {
    for (const key of Object.keys(ALLOWED_OVER)) expect(budgetFor(key), key).not.toBeNull();
  });
});
