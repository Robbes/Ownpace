// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE DUTCH FOR A GRANT LINK (workplan 0174, settled when its six tasks met
 * on one branch, 2026-11-25).
 *
 * Six tasks wrote the grant link's Dutch side by side, and it drifted three
 * ways: an account *gekoppeld* beside the approved *verbonden*; the link
 * called a *persoonlijke link* on one screen and a *toegangslink* on the
 * others (27 uses in 13 files on `main`, against one); and tries counted
 * *met deze link* and a card locked *voor deze link* on the person's page,
 * but locked *op deze link* on the owner's. Each is the owner's to read in
 * one table, so the words are held here:
 *
 * - *verbinden* / *verbonden*, never *koppelen* / *gekoppeld* (the approved
 *   Google and Microsoft cards; *loskoppelen*, the Accounts page's way to
 *   disconnect, is another verb and stays);
 * - the link is a *toegangslink*, never a *persoonlijke link*;
 * - locked *voor deze link*, never *op deze link*.
 */
import { describe, it, expect } from 'vitest';
import { STRINGS } from './strings.ts';

/** The screens a grant link touches: the person's page, the owner's lines about it, the wizard's. */
const GRANT_LINK_KEYS = /^(grant\.|person\.awaiting\.|person\.links\.|connections\.(waitingFor|connectedBy)$|start\.(forPerson|to\.whose|check\.linkAsks|who\.someoneElse)\b)/;

const dutch = Object.entries(STRINGS.nl as Record<string, string>).filter(([k]) => GRANT_LINK_KEYS.test(k));

describe('the grant link’s Dutch', () => {
  it('finds the keys it holds, so the checks are not vacuous', () => {
    // `grant.continue.cirrux` left with the cards (2026-11-26, workplan 0176 T1): a person's
    // page connects each account by its address, on the accounts screen.
    for (const key of ['grant.password.submit', 'grant.state.locked', 'person.awaiting.locked', 'connections.waitingFor', 'grant.person.connectAccount']) {
      expect(dutch.map(([k]) => k)).toContain(key);
    }
  });

  it('says verbinden, never koppelen', () => {
    expect(dutch.filter(([, v]) => /(^|[^s])\b(ge)?koppel/i.test(v.replace(/loskoppel/gi, '')))).toEqual([]);
  });

  it('calls the link a toegangslink, never a persoonlijke link', () => {
    expect(dutch.filter(([, v]) => /persoonlijke link/i.test(v))).toEqual([]);
  });

  it('locks a card voor deze link, never op deze link', () => {
    expect(dutch.filter(([, v]) => /op deze link/i.test(v))).toEqual([]);
  });
});
