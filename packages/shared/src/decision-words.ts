// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A DECISION SAYS, IN ENGLISH AND IN DUTCH (the UX sweep; the owner's
 * answer of 2026-10-18 on `queues-decisions-server-english`).
 *
 * *Wacht op u* printed each decision's stored sentence, which the detectors
 * wrote in English only, under a Dutch category chip; and a new mailbox's
 * button read *Create a mapping for this mailbox*, though pressing it only
 * records the answer (`apps/api/src/routes/decisions.ts` acts on a shared
 * address's answer and on nothing else). So the sentence is built here, from
 * the decision's category and its detail, in both languages, and the button
 * says what pressing it does.
 *
 * THE DUTCH LIVES BESIDE ITS ENGLISH, in this file, updated together or
 * neither (`docs/i18n-prose-boundary.md`, class 4). The detectors store the
 * English of these same functions as the decision's `summary`, which the
 * notification mail says; the page says the half in its reader's language.
 * No schema change: what the sentence needs is in the detail already (the
 * address, a group's name), and a shared address's reason is kept there, in
 * both languages, from 2026-10-18 on.
 *
 * A decision these functions cannot say (another category, or a detail
 * without what the sentence needs) shows its stored summary, as served, and
 * says it is English. A row stored before reasons were kept asks its question
 * without one, rather than paste an English reason into a Dutch sentence.
 */

import type { DecisionRow } from './decisions.ts';
import { DECISION_EFFECTS } from './operating-contract.ts';

/** The two languages a decision is said in. */
export type DecisionLanguage = 'en' | 'nl';

/** A sentence, and the language it is in: the page marks English under Dutch. */
export interface DecisionText {
  readonly text: string;
  readonly lang: DecisionLanguage;
}

/**
 * A new mailbox's one answer. It records the answer and nothing more: no
 * migration starts and none is changed, so the button says the person will
 * see to it themselves. The detector stores the English as `proposedDefault`.
 */
export const NEW_MAILBOX_ANSWER = {
  en: 'Noted, I will handle it',
  nl: 'Genoteerd, ik regel het zelf',
} as const;

/** A mailbox on the old system that no migration covers. */
export function newMailboxSummary(address: string, lang: DecisionLanguage): string {
  return lang === 'nl'
    ? `${address} staat op het oude systeem, en geen migratie omvat het. Er wordt niets van gemigreerd.`
    : `${address} is on the old system, and no migration covers it. Nothing is copied from it.`;
}

/** What the shared-address question needs: the address, its name, and why we could not tell. */
export interface SharedAddressWords {
  readonly address: string;
  readonly displayName?: string;
  /** The classifier's reason, in the sentence's language. Absent on a row stored before 2026-10-18. */
  readonly reason?: string;
}

/**
 * §14.1's question about a shared address the old system did not describe:
 * one shared mailbox, or a distribution list. Asked about how the people at
 * the address use it, not about our data model.
 */
export function sharedAddressSummary(input: SharedAddressWords, lang: DecisionLanguage): string {
  const name = input.displayName ? `${input.displayName} (${input.address})` : input.address;
  if (lang === 'nl') {
    return (
      `Lezen de mensen die mail krijgen op ${name} die samen in één gedeeld postvak, ` +
      'of moet ieder een eigen kopie krijgen (een distributielijst)? ' +
      (input.reason
        ? `Dat konden we niet zien op het oude systeem: ${input.reason}.`
        : 'Dat konden we niet zien op het oude systeem.')
    );
  }
  return (
    `Do the people who get mail at ${name} read it together in one shared mailbox, ` +
    'or should each of them get their own copy (a distribution list)? ' +
    (input.reason
      ? `We could not tell from the old system: ${input.reason}.`
      : 'We could not tell from the old system.')
  );
}

/** One of the detail's facts when it is text with something in it, else nothing. */
function text(detail: DecisionRow['detail'] | undefined, key: string): string | undefined {
  const v = detail?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * The decision's sentence in the reader's language, built from its category
 * and detail; the stored summary, as served and marked English, when it
 * cannot be built.
 */
export function decisionSummary(
  decision: Pick<DecisionRow, 'category' | 'summary' | 'detail'>,
  lang: DecisionLanguage,
): DecisionText {
  const address = text(decision.detail, 'address');
  if (address && decision.category === 'new_mailbox') {
    return { text: newMailboxSummary(address, lang), lang };
  }
  if (address && decision.category === 'shared_address_pattern') {
    const displayName = text(decision.detail, 'displayName');
    // The reason in THIS language only: an English reason inside a Dutch
    // question is the half-translated sentence this file exists to end.
    const reason = text(decision.detail, lang === 'nl' ? 'reasonNl' : 'reason');
    return {
      text: sharedAddressSummary(
        { address, ...(displayName ? { displayName } : {}), ...(reason ? { reason } : {}) },
        lang,
      ),
      lang,
    };
  }
  return { text: decision.summary, lang: 'en' };
}

/**
 * The words on a decision's accept button, or nothing when it offers none.
 *
 * A new mailbox's says what pressing it does, whatever its row stored: rows
 * raised before 2026-10-18 stored *Create a mapping for this mailbox*. Any
 * other category's is the detector's own proposal, as served.
 */
export function decisionAcceptLabel(
  decision: Pick<DecisionRow, 'category' | 'proposedDefault'>,
  lang: DecisionLanguage,
): DecisionText | undefined {
  if (!decision.proposedDefault) return undefined;
  if (decision.category === 'new_mailbox') return { text: NEW_MAILBOX_ANSWER[lang], lang };
  return { text: decision.proposedDefault, lang: 'en' };
}

/**
 * What answering a decision says it did: that the migration acts on it only
 * where the answer changes something, which today is a shared address's
 * pattern. Both editions answer a resolve with this.
 */
export function decisionResolvedEffect(category: DecisionRow['category']): string {
  return category === 'shared_address_pattern' ? DECISION_EFFECTS.resolved : DECISION_EFFECTS.recorded;
}
