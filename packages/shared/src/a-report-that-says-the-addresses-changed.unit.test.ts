// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * *ADDRESSES CHANGED* IN THE COMPLETION REPORT (workplan 0168 §6.3; ADR-0055).
 *
 * The closing document says how many address changes were confirmed, per
 * data type how many copies carry one and how many wait, and for what: the
 * next pass, or, past the data type's switch, somebody's press of *Apply the
 * new addresses here too* (D5; the screens' review S4), and how many were left
 * as they are for want of a version to guard the write (S1). And, always,
 * that mail was copied unchanged, in English and in Dutch. It narrates
 * counts, never addresses. A migration the table never touched reads exactly
 * as before.
 */

import { describe, it, expect } from 'vitest';
import {
  addressChangesSaid,
  buildCompletionReport,
  renderCompletionReportMarkdown,
  type CompletionReportInputs,
} from './completion-report.ts';

const BASE: CompletionReportInputs = {
  mappingId: 'm-0168',
  sourceType: 'carddav',
  targetType: 'carddav',
  lifecycle: 'active',
  generatedAt: '2026-11-22T00:00:00.000Z',
  domains: [],
  moves: [],
  deletions: [],
  failures: [],
};

const CHANGES = {
  rows: 2,
  digest: 'd'.repeat(64),
  byDomain: [
    { domain: 'contact' as const, changed: 12, older: 0 },
    { domain: 'calendar' as const, changed: 3, older: 1 },
  ],
};

describe('Addresses changed', () => {
  it('says the counts and that mail was copied unchanged, in the document', () => {
    const report = buildCompletionReport({ ...BASE, addressChanges: CHANGES });
    expect(report.addressChanges?.rows).toBe(2);
    const md = renderCompletionReportMarkdown(report);
    expect(md).toContain('## Addresses changed');
    expect(md).toContain('- 2 address changes were confirmed for this organisation.');
    expect(md).toContain('- Contacts: 12 copies carry a new address.');
    expect(md).toContain('- Calendars: 3 copies carry a new address. 1 waits for the next pass.');
    expect(md).toContain('- Mail was copied unchanged');
  });

  it('says every sentence in Dutch beside the English, line for line', () => {
    const said = addressChangesSaid(CHANGES);
    expect(said.heading).toEqual({ en: 'Addresses changed', nl: 'Gewijzigde adressen' });
    expect(said.lines.map((l) => l.nl)).toEqual([
      '2 adreswijzigingen zijn bevestigd voor deze organisatie.',
      'Contacten: 12 kopieën hebben een nieuw adres.',
      "Agenda's: 3 kopieën hebben een nieuw adres. 1 wacht op de volgende ronde.",
      'Mail is ongewijzigd gekopieerd: elk bericht is precies zoals het is verstuurd, zodat de handtekening en de geschiedenis ervan intact blijven.',
    ]);
    for (const l of said.lines) expect(l.en.length > 0 && l.nl.length > 0).toBe(true);
  });

  it('says a copy past its switch waits for the press, never for the next pass', () => {
    const said = addressChangesSaid({
      rows: 1,
      digest: 'd'.repeat(64),
      byDomain: [{ domain: 'contact', changed: 4, older: 2, unguarded: 0, waitsFor: 'press' }],
    });
    expect(said.lines[1]).toEqual({
      en: 'Contacts: 4 copies carry a new address. 2 wait for somebody to press Apply the new addresses here too.',
      nl: 'Contacten: 4 kopieën hebben een nieuw adres. 2 wachten tot iemand drukt op De nieuwe adressen hier ook toepassen.',
    });
    expect(said.lines[1]!.en).not.toContain('next pass');
    expect(said.lines[1]!.nl).not.toContain('volgende ronde');
  });

  it('says the copies left as they are with no version to guard the write, apart from those that wait', () => {
    const said = addressChangesSaid({
      rows: 1,
      digest: 'd'.repeat(64),
      byDomain: [
        { domain: 'calendar', changed: 0, older: 3, unguarded: 1, waitsFor: 'pass' },
        { domain: 'task', changed: 2, older: 2, unguarded: 2 },
      ],
    });
    expect(said.lines[1]).toEqual({
      en: 'Calendars: 0 copies carry a new address. 2 wait for the next pass. 1 was not changed, with no version to guard the write.',
      nl: "Agenda's: 0 kopieën hebben een nieuw adres. 2 wachten op de volgende ronde. 1 is niet gewijzigd, zonder versie om het schrijven te bewaken.",
    });
    expect(said.lines[2]).toEqual({
      en: 'Tasks: 2 copies carry a new address. 2 were not changed, with no version to guard the write.',
      nl: 'Taken: 2 kopieën hebben een nieuw adres. 2 zijn niet gewijzigd, zonder versie om het schrijven te bewaken.',
    });
  });

  it('says one change and one copy in the singular', () => {
    const said = addressChangesSaid({ rows: 1, digest: null, byDomain: [{ domain: 'task', changed: 1, older: 0 }] });
    expect(said.lines[0]).toEqual({
      en: '1 address change was confirmed for this organisation.',
      nl: '1 adreswijziging is bevestigd voor deze organisatie.',
    });
    expect(said.lines[1]).toEqual({ en: 'Tasks: 1 copy carries a new address.', nl: 'Taken: 1 kopie heeft een nieuw adres.' });
  });

  it('names no address, only counts', () => {
    const md = renderCompletionReportMarkdown(buildCompletionReport({ ...BASE, addressChanges: CHANGES }));
    expect(md).not.toMatch(/@/);
    expect(md).not.toContain(CHANGES.digest);
  });

  it('leaves the section out for a migration the table never touched, as before', () => {
    const untouched = buildCompletionReport({ ...BASE, addressChanges: { rows: 0, digest: null, byDomain: [] } });
    expect(untouched.addressChanges).toBeUndefined();
    expect(renderCompletionReportMarkdown(untouched)).not.toContain('Addresses changed');
    expect(buildCompletionReport(BASE).addressChanges).toBeUndefined();
  });
});
