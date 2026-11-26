// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHO SENT A PERSON THEIR LINK, AS THEIR PAGES SAY IT (workplan 0176 §7, T3 and
 * T6; D11; the owner, 2026-11-26).
 *
 * The reader was taught never to trust a link. The page cannot ask for that
 * trust; it gives them something to check (R6), and this is what:
 *
 * - **Who**, by the name the member gave as the people they send a link to
 *   know them, else their sign-in address (the link page only: the progress
 *   page carries none), else the organisation. Every `{who}` on a person's
 *   two pages is this one (`whoSent`), so the title, the question and the
 *   stop all name the same person.
 * - **Not how the reader knows them.** D7 had a fixed list for it; the owner,
 *   2026-11-26: *"Does the relationship matter and need to be registered? I
 *   would like not to..."* The name stands alone.
 * - **A number to check, never proof** (D11): the member's own where they gave
 *   one, else the organisation's, and then the sentence says it is the
 *   organisation's. A false page would print a number too, so the sentence
 *   offers the number the reader already has beside it. No number, no
 *   sentence.
 *
 * The number is a link a phone can dial, inside its sentence, so it is no
 * target of its own (criterion 2.5.8 exempts a link in a sentence).
 */
import React from 'react';
import { useT } from '../i18n/index.tsx';

/** What a page knows of who sent its link. */
export interface SenderFacts {
  /** Absent from a server before step B: the page then reads as step A did. */
  readonly sender?: {
    readonly name: string | null;
    readonly phone: string | null;
  } | null;
  /** The member's sign-in address, on the link page; the progress page carries none. */
  readonly askedBy?: string | null;
  readonly organisation: string;
  readonly organisationPhone?: string | null;
}

/** Whoever the page names as having sent the link: their name, else their address, else the organisation. */
export function whoSent(facts: SenderFacts): string {
  return facts.sender?.name ?? facts.askedBy ?? facts.organisation;
}

/** The number the page offers to check (D11), and whose it is; null when there is none. */
export function numberToCheck(facts: SenderFacts): { readonly phone: string; readonly whose: 'member' | 'organisation' } | null {
  if (facts.sender?.phone) return { phone: facts.sender.phone, whose: 'member' };
  if (facts.organisationPhone) return { phone: facts.organisationPhone, whose: 'organisation' };
  return null;
}

/** The sender's line: the name alone (D7, reversed). */
export const SenderName: React.FC<{ facts: SenderFacts }> = ({ facts }) => <>{whoSent(facts)}</>;

/** *Pat's number: … Or use the number you already have for Pat.*, with the number as a link; nothing without one. */
export const NumberToCheck: React.FC<{ facts: SenderFacts; className?: string }> = ({ facts, className }) => {
  const t = useT();
  const number = numberToCheck(facts);
  if (number === null) return null;
  const who = whoSent(facts);
  // `{phone}` is left in the sentence by `fill`, and drawn here as the link.
  const sentence =
    number.whose === 'member'
      ? t('grant.person.number', { who })
      : t('grant.person.number.organisation', { who, organisation: facts.organisation });
  const [before = '', after = ''] = sentence.split('{phone}');
  return (
    <p data-number className={className}>
      {before}
      <a className="text-blue-700 underline underline-offset-4 whitespace-nowrap" href={`tel:${number.phone.replace(/[^0-9+]/g, '')}`}>
        {number.phone}
      </a>
      {after}
    </p>
  );
};
