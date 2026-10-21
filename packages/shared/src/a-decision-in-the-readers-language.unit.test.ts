// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DECISION SAYS ITS QUESTION IN THE READER'S LANGUAGE (the UX sweep, the
 * owner's answer of 2026-10-18 on `queues-decisions-server-english`).
 *
 * *Wacht op u* showed Dutch category chips above English sentences, and a new
 * mailbox's button promised *Create a mapping for this mailbox* though
 * pressing it only records the answer. The sentence is now built from the
 * decision's category and its detail, in English and Dutch, here in shared
 * (class 4 of `docs/i18n-prose-boundary.md`); the detectors store the English
 * of the same function, and the stored summary is what a decision the
 * builder cannot say falls back to.
 */

import { describe, it, expect } from 'vitest';
import {
  NEW_MAILBOX_ANSWER,
  decisionAcceptLabel,
  decisionEffectFields,
  decisionEffectText,
  decisionResolvedEffect,
  decisionSummary,
  newMailboxSummary,
  sharedAddressSummary,
} from './decision-words.ts';
import { DECISION_EFFECTS } from './operating-contract.ts';
import type { DecisionRow } from './decisions.ts';

type Said = Pick<DecisionRow, 'category' | 'summary' | 'detail' | 'proposedDefault'>;

const row = (over: Partial<DecisionRow>): Said => ({
  category: 'new_mailbox',
  summary: 'stored english',
  detail: {},
  ...over,
});

describe('a new mailbox', () => {
  it('says the owner’s words, in English and in Dutch', () => {
    expect(newMailboxSummary('info@acme.nl', 'en')).toBe(
      'info@acme.nl is on the old system, and no migration covers it. Nothing is copied from it.',
    );
    expect(newMailboxSummary('info@acme.nl', 'nl')).toBe(
      'info@acme.nl staat op het oude systeem, en geen migratie omvat het. Er wordt niets van gemigreerd.',
    );
  });

  it('is built from the detail’s address, whatever the stored sentence said', () => {
    // A row raised before 2026-10-18 stored "exists on the source"; it reads
    // like a new one now, in either language.
    const old = row({
      summary: 'info@acme.nl exists on the source and no migration covers it. Nothing is being copied from it.',
      detail: { address: 'info@acme.nl' },
    });
    expect(decisionSummary(old, 'nl')).toEqual({
      text: 'info@acme.nl staat op het oude systeem, en geen migratie omvat het. Er wordt niets van gemigreerd.',
      lang: 'nl',
    });
    expect(decisionSummary(old, 'en').text).toBe(
      'info@acme.nl is on the old system, and no migration covers it. Nothing is copied from it.',
    );
  });

  it('offers a button that records, and says so, never one that promises a mapping', () => {
    expect(NEW_MAILBOX_ANSWER).toEqual({
      en: 'Noted, I will handle it',
      nl: 'Genoteerd, ik regel het zelf',
    });
    // An old row's stored proposal said "Create a mapping for this mailbox".
    // Pressing it never made one, so the button says what pressing does.
    const old = row({ proposedDefault: 'Create a mapping for this mailbox' });
    expect(decisionAcceptLabel(old, 'en')).toEqual({ text: 'Noted, I will handle it', lang: 'en' });
    expect(decisionAcceptLabel(old, 'nl')).toEqual({ text: 'Genoteerd, ik regel het zelf', lang: 'nl' });
    for (const lang of ['en', 'nl'] as const) {
      expect(decisionAcceptLabel(old, lang)?.text).not.toMatch(/mapping/i);
    }
  });

  it('falls back to the stored English when the detail has no address', () => {
    expect(decisionSummary(row({ detail: {} }), 'nl')).toEqual({ text: 'stored english', lang: 'en' });
    expect(decisionSummary(row({ detail: { address: '  ' } }), 'nl')).toEqual({
      text: 'stored english',
      lang: 'en',
    });
    expect(decisionSummary(row({ detail: { address: 42 } }), 'en')).toEqual({
      text: 'stored english',
      lang: 'en',
    });
  });
});

describe('a shared address the old system did not describe', () => {
  const REASON = 'the source did not say';
  const REASON_NL = 'de bron gaf het niet aan';

  it('asks the owner’s question with the classifier’s reason, in each language', () => {
    expect(
      sharedAddressSummary({ address: 'info@acme.nl', displayName: 'Info', reason: REASON }, 'en'),
    ).toBe(
      'Do the people who get mail at Info (info@acme.nl) read it together in one shared mailbox, ' +
        'or should each of them get their own copy (a distribution list)? ' +
        'We could not tell from the old system: the source did not say.',
    );
    expect(
      sharedAddressSummary({ address: 'info@acme.nl', displayName: 'Info', reason: REASON_NL }, 'nl'),
    ).toBe(
      'Lezen de mensen die mail krijgen op Info (info@acme.nl) die samen in één gedeeld postvak, ' +
        'of moet ieder een eigen kopie krijgen (een distributielijst)? ' +
        'Dat konden we niet zien op het oude systeem: de bron gaf het niet aan.',
    );
  });

  it('reads the reason in the reader’s language from the detail', () => {
    const d = row({
      category: 'shared_address_pattern',
      detail: { address: 'info@acme.nl', reason: REASON, reasonNl: REASON_NL },
    });
    expect(decisionSummary(d, 'nl').text).toContain(': de bron gaf het niet aan.');
    expect(decisionSummary(d, 'nl').text).not.toContain(REASON);
    expect(decisionSummary(d, 'en').text).toContain(': the source did not say.');
  });

  it('asks without a reason for a row stored before reasons were kept', () => {
    // A row raised before 2026-10-18 has no reason in its detail. Its stored
    // summary has one, in English only; the Dutch is never half English.
    const old = row({ category: 'shared_address_pattern', detail: { address: 'info@acme.nl' } });
    expect(decisionSummary(old, 'en')).toEqual({
      text:
        'Do the people who get mail at info@acme.nl read it together in one shared mailbox, ' +
        'or should each of them get their own copy (a distribution list)? We could not tell from the old system.',
      lang: 'en',
    });
    expect(decisionSummary(old, 'nl').text).toMatch(/Dat konden we niet zien op het oude systeem\.$/);
    // An English reason with no Dutch twin is not pasted into the Dutch.
    const halfway = row({
      category: 'shared_address_pattern',
      detail: { address: 'info@acme.nl', reason: REASON },
    });
    expect(decisionSummary(halfway, 'nl').text).not.toContain(REASON);
  });

  it('offers no accept button: it has no default, which is why it is asked', () => {
    expect(decisionAcceptLabel(row({ category: 'shared_address_pattern' }), 'nl')).toBeUndefined();
  });
});

describe('a category nothing here can say', () => {
  it('shows the stored English, marked as English', () => {
    const quota = row({ category: 'quota', summary: 'The mailbox is 98% full', detail: { usedGb: 49 } });
    expect(decisionSummary(quota, 'nl')).toEqual({ text: 'The mailbox is 98% full', lang: 'en' });
    expect(decisionSummary(quota, 'en')).toEqual({ text: 'The mailbox is 98% full', lang: 'en' });
  });

  it('keeps the detector’s own proposal as the button, as served', () => {
    const quota = row({ category: 'quota', proposedDefault: 'raise the quota' });
    expect(decisionAcceptLabel(quota, 'nl')).toEqual({ text: 'raise the quota', lang: 'en' });
    expect(decisionAcceptLabel(row({ category: 'quota' }), 'nl')).toBeUndefined();
  });
});

describe('what answering says it did', () => {
  it('claims the migration acts only where the answer changed something', () => {
    // A shared address's pattern, written back to its discovered group, is
    // the one answer the migration reads, and the resolve says whether it
    // was: a new mailbox's answer, or a shared address's answer that names
    // no pattern (the API accepts one), is only recorded.
    expect(decisionResolvedEffect(true)).toBe(DECISION_EFFECTS.resolved);
    expect(decisionResolvedEffect(false)).toBe(DECISION_EFFECTS.recorded);
    expect(DECISION_EFFECTS.recorded.en).not.toMatch(/acts on it/);
    expect(DECISION_EFFECTS.recorded.nl).not.toMatch(/handelt er/);
  });
});

/**
 * THE LINE UNDER A DECIDED DECISION, IN THE READER'S LANGUAGE (workplan 0159
 * §6 item 12). *Wacht op u* said its questions in Dutch from 2026-10-18 on,
 * and then, under the answer, *Answer recorded. Nothing in your migrations
 * changes because of it.*, in English, marked `lang="en"`: the effect lines
 * had no Dutch twin. The Dutch lives beside the English here (class 4 of
 * `docs/i18n-prose-boundary.md`), both editions serve it as `effectNl` beside
 * `effect`, and the page says the half in its reader's language.
 */
describe('what answering says it did, in English and in Dutch', () => {
  it('has a Dutch twin beside every English line', () => {
    for (const [key, said] of Object.entries(DECISION_EFFECTS)) {
      expect(said.en, key).toMatch(/\S/);
      expect(said.nl, key).toMatch(/\S/);
      expect(said.nl, key).not.toBe(said.en);
    }
  });

  it('says each line in the builder’s words, the Dutch in the glossary’s', () => {
    // The English is unchanged: a page from before the twin reads it.
    // The Dutch is the builder's, for the owner to read; it sets aside
    // (*terzijde leggen*), never rejects, as the glossary and the button do.
    expect(DECISION_EFFECTS).toEqual({
      resolved: {
        en: 'Answer recorded — the migration acts on it from here on.',
        nl: 'Antwoord vastgelegd. De migratie handelt er vanaf nu naar.',
      },
      recorded: {
        en: 'Answer recorded. Nothing in your migrations changes because of it.',
        nl: 'Antwoord vastgelegd. Er verandert daardoor niets aan uw migraties.',
      },
      dismissed: {
        en: 'Closed without acting; the detector may raise it again if the situation persists.',
        nl: 'Terzijde gelegd; er is niets mee gedaan. Blijft de situatie zo, dan kan de vraag terugkomen.',
      },
    });
  });

  it('travels as `effect` in English and `effectNl` in Dutch', () => {
    expect(decisionEffectFields(DECISION_EFFECTS.dismissed)).toEqual({
      effect: DECISION_EFFECTS.dismissed.en,
      effectNl: DECISION_EFFECTS.dismissed.nl,
    });
    expect(decisionEffectFields(decisionResolvedEffect(false))).toEqual({
      effect: DECISION_EFFECTS.recorded.en,
      effectNl: DECISION_EFFECTS.recorded.nl,
    });
  });

  it('says the half in the reader’s language', () => {
    const served = decisionEffectFields(DECISION_EFFECTS.recorded);
    expect(decisionEffectText(served, 'nl')).toEqual({ text: DECISION_EFFECTS.recorded.nl, lang: 'nl' });
    expect(decisionEffectText(served, 'en')).toEqual({ text: DECISION_EFFECTS.recorded.en, lang: 'en' });
  });

  it('says the English as served, marked English, when the server sent no Dutch', () => {
    // An appliance from before the twin answers with `effect` alone.
    expect(decisionEffectText({ effect: 'Closed without acting.' }, 'nl')).toEqual({
      text: 'Closed without acting.',
      lang: 'en',
    });
    expect(decisionEffectText({ effect: 'Closed without acting.', effectNl: '' }, 'nl')).toEqual({
      text: 'Closed without acting.',
      lang: 'en',
    });
  });

  it('says nothing when nothing was served', () => {
    expect(decisionEffectText({}, 'nl')).toBeUndefined();
    expect(decisionEffectText({ effectNl: 'Alleen Nederlands.' }, 'en')).toBeUndefined();
  });
});
