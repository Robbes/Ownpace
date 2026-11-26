// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PERSON'S OWN PAGE (workplan 0176 D14, T9): the link page and the progress
 * page a person opens from a link, with no account of their own.
 *
 * The parts these pages share with the member's screens (a row's stage, the
 * line under it, how long, why it waits, a fold, the language switch, the
 * build stamp) say a person's own words and draw a person's sizes inside one,
 * and nothing else: outside it the context is null, and the member's screens
 * draw what they always drew. D14: *"the rows of a person's progress page get
 * their own words"*, so that a stage says *Wordt gekopieerd* to the person and
 * *Wordt gemigreerd* to the member, about the same numbers.
 *
 * `who` is whoever the page names as having sent the link: the address of the
 * member who made it on the link page, the organisation on the progress page,
 * until T3 gives the pages a name. A pause at the data ceiling says copying
 * waits for their choice (T6.3), with no price in it.
 */
import React from 'react';

export interface PersonsPage {
  /** Whoever the page names as having sent the link. */
  readonly who: string;
}

const PersonsPageContext = React.createContext<PersonsPage | null>(null);

/** Around a person's own page: what it holds says a person's words and draws a person's sizes. */
export const PersonsPageProvider: React.FC<{ value: PersonsPage; children: React.ReactNode }> = ({ value, children }) => (
  <PersonsPageContext.Provider value={value}>{children}</PersonsPageContext.Provider>
);

/** The page a part is drawn on, when it is a person's own; null on the member's screens. */
export function usePersonsPage(): PersonsPage | null {
  return React.useContext(PersonsPageContext);
}
