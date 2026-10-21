// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE NAME FOR A SHARE (the UX sweep; the owner's answer of 2026-10-18 on
 * `words-sharing-feature-names`).
 *
 * The sharing feature had six Dutch names for one thing: *Delen*,
 * *Deel-checklist*, *Share-recht*, *Share-toegang*, *Deelrechten* and
 * *rechtenlijst*, and the English said *grant*, *access* and *permission
 * list*. One share is now a *deelrecht* in Dutch and a *share* in English,
 * on the checklist, the report and Finish's list (GLOSSARY.md, *A single
 * share*). The checklist keeps its name, *Deel-checklist* / *Sharing
 * checklist*, and the folder line says plainly why it is not grouped.
 */
import { describe, it, expect } from 'vitest';
import { STRINGS, type StringKey } from './strings.ts';

/** Every line that names a single share, or the list of them. */
const SHARE_WORDS: readonly StringKey[] = [
  'sharing.intro',
  'sharing.intro.more',
  'migrationReport.sharing.heading',
  'permissions.download',
  'permissions.failed',
  'sharing.group.refused.one',
  'sharing.group.refused.many',
];

describe('one name for a share', () => {
  it('the owner’s words, in English and Dutch', () => {
    expect(STRINGS.en['sharing.intro']).toBe(
      'Everything someone else could reach on the old system, one row per share.',
    );
    expect(STRINGS.nl['sharing.intro']).toBe(
      'Alles wat met iemand was gedeeld op uw oude systeem, één regel per deelrecht.',
    );
    expect(STRINGS.nl['sharing.intro.more']).toContain('dat dit deelrecht handmatig opnieuw is ingericht');
    expect(STRINGS.en['migrationReport.sharing.heading']).toBe('Shares carried over');
    expect(STRINGS.nl['migrationReport.sharing.heading']).toBe('Meegenomen deelrechten');
    expect(STRINGS.en['migrationReport.access.lead']).toBe(
      'It still works after this migration, until you withdraw it.',
    );
    expect(STRINGS.nl['migrationReport.access.lead']).toBe(
      'Deze toegang werkt na de migratie nog, tot u hem intrekt.',
    );
    expect(STRINGS.en['permissions.download']).toBe('Get the list of shares');
    expect(STRINGS.nl['permissions.download']).toBe('Haal de lijst met deelrechten op');
    expect(STRINGS.en['permissions.failed']).toBe('The list of shares could not be fetched.');
    expect(STRINGS.nl['permissions.failed']).toBe('De lijst met deelrechten kon niet worden opgehaald.');
  });

  it('no line that names a share uses one of the old names', () => {
    for (const key of SHARE_WORDS) {
      expect(STRINGS.nl[key], key).not.toMatch(/Share-recht|Share-toegang|rechtenlijst/);
      expect(STRINGS.en[key], key).not.toMatch(/\bgrant\b|permission list|Access carried over/);
    }
  });

  it('the checklist’s buttons say what they do, as the row’s buttons do', () => {
    // The row's button is *Afvinken*; the folder's said *Alles op Gedaan zetten*.
    expect(STRINGS.nl['sharing.done']).toBe('Afvinken');
    expect(STRINGS.nl['sharing.group.doneAll']).toBe('Alles afvinken');
    expect(STRINGS.nl['sharing.applyArmed']).toBe('Druk nogmaals: dit deelt en stuurt een uitnodiging');
  });
});

describe('a checklist not grouped by folder', () => {
  it('says why, and never that its rows predate a feature', () => {
    // Microsoft 365 never says which folder an item is in, so every Microsoft
    // checklist showed "found before this tool could group by folder" and
    // told the tester to refresh, which changes nothing.
    expect(STRINGS.en['sharing.notPlacedYet']).toBe(
      'Not grouped by folder: your old system did not say which folder each item is in.',
    );
    expect(STRINGS.nl['sharing.notPlacedYet']).toBe(
      'Niet per map gegroepeerd: uw oude systeem gaf niet aan in welke map elk item staat.',
    );
  });
});
