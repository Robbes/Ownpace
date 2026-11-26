// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A SENDER NAMED, NOT DESCRIBED (workplan 0176 §6, §21.3, T3; the owner,
 * 2026-11-26).
 *
 * Until step B a person's pages had no name for whoever sent their link, so a
 * few sentences described them instead: *Whoever set this up can do it.*,
 * *whoever sent you the link can turn it off*, *a new link from whoever sent
 * this one*. The plan kept them so (*"Whoever set this up stays until T3"*):
 * they named nobody, and they were true. T3 gives the pages a name, and the
 * pages say it: every such sentence says `{who}`, the name the member gave,
 * else their address on the link page, else the organisation.
 *
 * What the server writes itself (a refused link, the ending after a sign-in)
 * is not here: it is written before a page has a name to give it.
 */
import { describe, it, expect } from 'vitest';
import { STRINGS } from './strings.ts';

const en = STRINGS.en as Record<string, string>;
const nl = STRINGS.nl as Record<string, string>;

/** The sentences a person's pages say that described the sender, and now name them. */
const NAMED = [
  // The progress page: a row's failure, said to the person.
  'view.failure.authExpired',
  'view.failure.internalAddress',
  'view.failure.formatRefused',
  'view.failure.unknown',
  // A destination's password removed, and the question before removing it.
  'view.state.destinationRemoved',
  'view.destination.confirm',
  // The person's new address, sent back or left (both pages).
  'addresses.grant.returned',
  'addresses.grant.leaveIt',
  // The link page's line under the person's own progress page.
  'grant.person.keepIt',
] as const;

/** How the sender was described, in either language. */
const DESCRIBED =
  /whoever|person who sent|the one who sent|wie dit heeft ingesteld|wie het heeft ingesteld|wie dit uitvoert|wie u de link stuurde|persoon die u de link stuurde|degene die|van de afzender/i;

describe('a person’s pages name the sender where they described them (T3, §6)', () => {
  it('in English and in Dutch, each sentence says {who}', () => {
    const missing = NAMED.flatMap((key) => [
      ...(en[key]?.includes('{who}') ? [] : [`en ${key}: ${en[key]}`]),
      ...(nl[key]?.includes('{who}') ? [] : [`nl ${key}: ${nl[key]}`]),
    ]);
    expect(missing).toEqual([]);
  });

  it('and none of them describes the sender any more', () => {
    const described = NAMED.flatMap((key) =>
      [`en ${key}: ${en[key]}`, `nl ${key}: ${nl[key]}`].filter((line) => DESCRIBED.test(line)),
    );
    expect(described).toEqual([]);
  });

  it('and the English of a row’s failure says no form of migration, as its Dutch does not (D1)', () => {
    expect(en['view.failure.unknown']).not.toMatch(/migrat/i);
  });
});
