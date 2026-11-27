// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * HOW A PERSON'S OWN PAGES SPEAK TO THEM (workplan 0176 §11, T7; D8 (a); the
 * owner, 2026-11-26: *"Yes"* to *je* or *u* as the member chooses, per person).
 *
 * The member chooses, where they make a person's link: Dutch with *u*, Dutch
 * with *je*, or English (`person.voice`, managed migration 0068). Unset is
 * today's page: the reader's browser language, with *u*. English has one
 * *you*, so three pairs of a language and a register exist, and one column
 * holds them.
 *
 * The pages are told the two halves (`language`, `register`), so the
 * dictionary reads its informal layer for an informal page and the language
 * switch still wins. The server says its own Dutch in the register too: a
 * sentence it writes for a person's link has its *je* twin (`Bilingual.nlJe`),
 * chosen by `inLocale` and `reasonPair`.
 */

/** The three, in the order the member's form offers them. */
export const PERSON_VOICES = ['nl-u', 'nl-je', 'en'] as const;
export type PersonVoice = (typeof PERSON_VOICES)[number];

/** *u* or *je*: formal unless the person's pages say *je*. English is formal: it has one *you*. */
export type Register = 'formal' | 'informal';

export function isPersonVoice(value: unknown): value is PersonVoice {
  return typeof value === 'string' && (PERSON_VOICES as readonly string[]).includes(value);
}

/** The page's language the person was given, or null: the browser's, as before. */
export function languageOf(voice: PersonVoice | null | undefined): 'en' | 'nl' | null {
  if (voice === 'en') return 'en';
  if (voice === 'nl-u' || voice === 'nl-je') return 'nl';
  return null;
}

/** *je* for a person whose pages say *je*; *u* for everybody else. */
export function registerOf(voice: PersonVoice | null | undefined): Register {
  return voice === 'nl-je' ? 'informal' : 'formal';
}
