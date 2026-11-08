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
  deletionRemovedEffect,
  failureEffect,
  failureGroupEffect,
  newMailboxSummary,
  oldCopyRemovedEffect,
  sharedAddressSummary,
} from './decision-words.ts';
import { DECISION_EFFECTS, QUEUE_EFFECTS } from './operating-contract.ts';
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
 *
 * The item queues' lines joined them on 2026-11-08 (workplan 0159 §6 item
 * 18): `QUEUE_EFFECTS`, which this guard reads beside `DECISION_EFFECTS`.
 */
describe('what answering says it did, in English and in Dutch', () => {
  /** Every line a decision's answer can say, by its table and key. */
  const EVERY_EFFECT = [
    ...Object.entries(DECISION_EFFECTS).map(([key, said]) => [`DECISION_EFFECTS.${key}`, said] as const),
    ...Object.entries(QUEUE_EFFECTS).map(([key, said]) => [`QUEUE_EFFECTS.${key}`, said] as const),
  ];
  const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();

  it('has a Dutch twin beside every English line', () => {
    // Both tables, so a line added to either without its Dutch fails here.
    expect(EVERY_EFFECT.length).toBe(Object.keys(DECISION_EFFECTS).length + Object.keys(QUEUE_EFFECTS).length);
    for (const [key, said] of EVERY_EFFECT) {
      expect(typeof said.en, `${key} has no English`).toBe('string');
      expect(typeof said.nl, `${key} has no Dutch`).toBe('string');
      expect(said.en, key).toMatch(/\S/);
      expect(said.nl, `${key}'s Dutch is empty`).toMatch(/\S/);
      expect(said.nl, key).not.toBe(said.en);
      // A count is said in both languages or in neither.
      expect(placeholders(said.nl), key).toEqual(placeholders(said.en));
      // The register the glossary sets for all the Dutch: *u*, never *je* or *jij*.
      expect(said.nl, key).not.toMatch(/\b(je|jij|jou|jouw)\b/i);
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

/**
 * WHAT A DECISION ON DELETIONS, MOVES OR FAILURES SAYS IT DID, IN ENGLISH AND
 * IN DUTCH (workplan 0159 §6 item 18). The line where the buttons were was
 * the server's English under a Dutch page, each edition writing its own copy.
 * Both now answer from `QUEUE_EFFECTS`, the English as `effect` and the Dutch
 * as `effectNl`, and the queues say the half in the reader's language.
 */
describe('what a queue decision says it did', () => {
  it('says the English both editions sent before, and the Dutch in the builder’s words', () => {
    // The English is word for word what both editions sent until 2026-11-08
    // (each old `effect` expression was evaluated against these when the
    // table was built): a page from before the Dutch reads it unchanged.
    // The Dutch is the builder's, for the owner to read.
    expect(QUEUE_EFFECTS).toEqual({
      deletionKept: {
        en: 'Acknowledged. The target keeps its copy and this stops being reported unless the item reappears on the source and vanishes again.',
        nl: 'Beslissing vastgelegd. De kopie blijft op het nieuwe systeem staan, en dit wordt niet meer gemeld, tenzij het item op het oude systeem terugkomt en weer verdwijnt.',
      },
      deletionRemoved: {
        en: 'Removed from the target with no recovery path from here.',
        nl: 'Verwijderd op het nieuwe systeem, zonder herstelmogelijkheid vanaf hier.',
      },
      deletionRemovedToBin: {
        en: "Removed from the target. The target's own bin still has it for whatever retention window that server keeps — this tool cannot restore it, but the server might still be able to.",
        nl: 'Verwijderd op het nieuwe systeem. Het staat daar nog in de prullenbak, zolang dat systeem het bewaart; Ownpace kan het niet terughalen, maar het nieuwe systeem misschien nog wel.',
      },
      moveKept: {
        en: 'Acknowledged. Nothing changed on the source or the target; this move stops being reported unless the item moves somewhere else again.',
        nl: 'Beslissing vastgelegd. Aan geen van beide kanten is iets veranderd; deze verplaatsing wordt niet meer gemeld, tenzij het item weer ergens anders heen wordt verplaatst.',
      },
      oldCopyRemoved: {
        en: 'The old copy has been removed from the target. The file itself is still there, under the name and folder the source moved it to — that copy was made before this removal and was checked again just now.',
        nl: 'De oude kopie is verwijderd op het nieuwe systeem. Het bestand zelf staat er nog, onder de naam en in de map die het op het oude systeem kreeg; die kopie is gemaakt vóór deze verwijdering en is zojuist opnieuw gecontroleerd.',
      },
      oldCopyInBin: {
        en: "The target's own bin still holds the old copy for whatever retention window that server keeps.",
        nl: 'De oude kopie staat nog in de prullenbak van het nieuwe systeem, zolang dat systeem die bewaart.',
      },
      failureRetried: {
        en: 'Attempts reset and cursors cleared; the next scheduled pass will try again.',
        nl: 'De telling van de pogingen is teruggezet; de volgende geplande ronde doorloopt alles opnieuw en probeert het nog eens.',
      },
      failureAccepted: {
        en: 'Left behind for good: no further retries, and excluded from the verification gate.',
        nl: 'Dit item gaat definitief niet mee: het wordt niet meer opnieuw geprobeerd en telt niet mee bij de verificatie.',
      },
      failuresMatchedNothing: {
        en: 'Nothing matched, so nothing changed. Check the domain and the wording — the substring is matched literally, not as a pattern.',
        nl: 'Er paste niets, dus er is niets veranderd. Controleer de soort en de tekst; wat u typt, wordt precies zo vergeleken als u het typt, niet als patroon.',
      },
      failuresRetried: {
        en: 'Attempts reset on {count} item(s) and cursors cleared; the next scheduled pass will try them again.',
        nl: 'De telling van de pogingen is teruggezet voor {count} items; de volgende geplande ronde doorloopt alles opnieuw en probeert ze nog eens.',
      },
      failuresRetriedOne: {
        en: 'Attempts reset on 1 item(s) and cursors cleared; the next scheduled pass will try them again.',
        nl: 'De telling van de pogingen is teruggezet voor 1 item; de volgende geplande ronde doorloopt alles opnieuw en probeert het nog eens.',
      },
      failuresAccepted: {
        en: 'Left behind for good: {count} item(s) will not be retried, and are excluded from the verification gate.',
        nl: '{count} items gaan definitief niet mee: ze worden niet meer opnieuw geprobeerd en tellen niet mee bij de verificatie.',
      },
      failuresAcceptedOne: {
        en: 'Left behind for good: 1 item(s) will not be retried, and are excluded from the verification gate.',
        nl: '1 item gaat definitief niet mee: het wordt niet meer opnieuw geprobeerd en telt niet mee bij de verificatie.',
      },
    });
  });

  it('says the queues’ own Dutch words, and no new ones', () => {
    for (const [key, said] of Object.entries(QUEUE_EFFECTS)) {
      // The old and the new system, as `QUEUE_GUIDANCE` and the decided rows
      // say them: never *bron* or *doel* for the source and the target.
      expect(said.nl, key).not.toMatch(/\b(bron|doel)\b/i);
      // A pass is a *ronde* (the glossary), and a cursor is no word a tester
      // reads: the retry hint says *doorloopt alles opnieuw* for it.
      expect(said.nl, key).not.toMatch(/cursor|\bpass\b|\bpassage\b/i);
    }
    // A group of one says the English it always did: the template's, with 1.
    expect(QUEUE_EFFECTS.failuresRetriedOne.en).toBe(QUEUE_EFFECTS.failuresRetried.en.replace('{count}', '1'));
    expect(QUEUE_EFFECTS.failuresAcceptedOne.en).toBe(QUEUE_EFFECTS.failuresAccepted.en.replace('{count}', '1'));
  });

  it('says whether the new system’s bin still holds what was removed', () => {
    expect(deletionRemovedEffect('binned')).toBe(QUEUE_EFFECTS.deletionRemovedToBin);
    expect(deletionRemovedEffect('deleted')).toBe(QUEUE_EFFECTS.deletionRemoved);
    expect(oldCopyRemovedEffect('deleted')).toBe(QUEUE_EFFECTS.oldCopyRemoved);
    // The bin's sentence follows the removal's, in each language.
    expect(oldCopyRemovedEffect('binned')).toEqual({
      en: `${QUEUE_EFFECTS.oldCopyRemoved.en} ${QUEUE_EFFECTS.oldCopyInBin.en}`,
      nl: `${QUEUE_EFFECTS.oldCopyRemoved.nl} ${QUEUE_EFFECTS.oldCopyInBin.nl}`,
    });
  });

  it('says what a retry or an accept did to one item', () => {
    expect(failureEffect('retry')).toBe(QUEUE_EFFECTS.failureRetried);
    expect(failureEffect('accept')).toBe(QUEUE_EFFECTS.failureAccepted);
  });

  it('says how many items a group decision changed, in each language, and when it matched none', () => {
    for (const action of ['retry', 'accept'] as const) {
      expect(failureGroupEffect(action, 0)).toBe(QUEUE_EFFECTS.failuresMatchedNothing);
    }
    expect(failureGroupEffect('retry', 1)).toBe(QUEUE_EFFECTS.failuresRetriedOne);
    expect(failureGroupEffect('accept', 1)).toBe(QUEUE_EFFECTS.failuresAcceptedOne);
    expect(failureGroupEffect('retry', 82)).toEqual({
      en: 'Attempts reset on 82 item(s) and cursors cleared; the next scheduled pass will try them again.',
      nl: 'De telling van de pogingen is teruggezet voor 82 items; de volgende geplande ronde doorloopt alles opnieuw en probeert ze nog eens.',
    });
    expect(failureGroupEffect('accept', 3)).toEqual({
      en: 'Left behind for good: 3 item(s) will not be retried, and are excluded from the verification gate.',
      nl: '3 items gaan definitief niet mee: ze worden niet meer opnieuw geprobeerd en tellen niet mee bij de verificatie.',
    });
  });

  it('travels as `effect` in English and `effectNl` in Dutch, and is said in the reader’s half', () => {
    const served = decisionEffectFields(failureGroupEffect('retry', 3));
    expect(served.effect).toBe('Attempts reset on 3 item(s) and cursors cleared; the next scheduled pass will try them again.');
    expect(decisionEffectText(served, 'nl')).toEqual({ text: served.effectNl, lang: 'nl' });
    expect(decisionEffectText(served, 'en')).toEqual({ text: served.effect, lang: 'en' });
  });
});
