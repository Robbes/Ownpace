// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The permission report in the reader's language (workplan 0144).
 *
 * The document a person downloads from every migration's Finish page was
 * English only, and the Alpha's testers are mostly Dutch. The report now takes
 * a `lang`, and every fixed sentence, heading and table header follows it.
 *
 * The boundary is the one `permission-report.unit.test.ts` already names:
 * translate the frame, never the finding. Addresses, folder names, rights as
 * the source names them (FullAccess, Send-As) and a blind spot's reason stay
 * exactly as they arrived.
 *
 * WHAT THIS HOLDS:
 *
 * - English stays the default, word for word;
 * - the Dutch report carries Dutch headings and table headers, and not one of
 *   the English report's fixed sentences, over a fixture that reaches every
 *   branch the renderer has;
 * - every data value is in the Dutch report verbatim;
 * - the inventory pass titles its sections, and says its own fallback
 *   reasons, in the same language.
 */

import { describe, it, expect } from 'vitest';
import type { PermissionGrant } from '@openmig/shared';
import { renderPermissionReport, type PermissionReportInput } from './permission-report.ts';
import { runPermissionInventory } from './run-permission-inventory.ts';

const grant = (overrides: Partial<PermissionGrant>): PermissionGrant => ({
  subject: 'calendar',
  on: 'Pat — Calendar',
  grantee: 'anna@acme.nl',
  role: 'read',
  raw: '{}',
  ...overrides,
});

/** The words that came from the source or the caller: never translated. */
const DATA = {
  label: 'pat@acme.nl',
  date: '2026-10-16',
  conduct: 'TARGET-CONDUCT-LINE-AS-MEASURED',
  blindTitle: 'BLIND-SECTION-TITLE',
  blindReason: 'BLIND-REASON-AS-THE-SOURCE-SAID-IT',
  foundTitle: 'FOUND-SECTION-TITLE',
  readCalendar: 'Pat — Agenda',
  writeCalendar: 'Team calendar',
  linkFile: '/Budget 2026.xlsx',
  personFolder: '/Projecten/Offertes',
  sharedMailbox: 'info@acme.nl',
  sendAsMailbox: 'sales@acme.nl',
  oddRight: 'SomeExchangeRoleFrom2027',
  grantee: 'anna@acme.nl',
} as const;

/** A report that reaches every branch: conduct, a blind spot, each mapping, a manual step. */
const everything: PermissionReportInput = {
  mappingLabel: DATA.label,
  generatedOn: DATA.date,
  targetConduct: [DATA.conduct],
  sections: [
    { title: DATA.blindTitle, listing: { kind: 'not_discoverable', reason: DATA.blindReason } },
    {
      title: DATA.foundTitle,
      listing: {
        kind: 'listed',
        grants: [
          grant({ on: DATA.readCalendar, role: 'read' }),
          grant({ on: DATA.writeCalendar, role: 'write' }),
          grant({ subject: 'drive_item', on: DATA.linkFile, role: 'read', viaLink: true }),
          grant({ subject: 'drive_item', on: DATA.personFolder, role: 'write' }),
          grant({ subject: 'drive_item', on: DATA.personFolder, role: 'read', grantee: undefined }),
          grant({ subject: 'mailbox', on: DATA.sharedMailbox, role: 'FullAccess' }),
          grant({ subject: 'mailbox', on: DATA.sendAsMailbox, role: 'SendAs' }),
          grant({ subject: 'mailbox', on: DATA.sharedMailbox, role: DATA.oddRight }),
        ],
      },
    },
  ],
};

/** The report's other branches: nothing found, so nothing by hand. */
const nothing: PermissionReportInput = {
  sections: [{ title: DATA.foundTitle, listing: { kind: 'listed', grants: [] } }],
};

/**
 * The English report's own sentences: its text cut at punctuation and table
 * bars, without anything that carries a data value, and long enough to be a
 * sentence rather than a word Dutch shares (`Send-As`, `Nextcloud`).
 */
function englishSentencesOf(md: string): string[] {
  const values = Object.values(DATA) as string[];
  return md
    .split(/\n|\||(?<=[.;:])\s|\s—\s|\*\*|_/)
    .map((s) => s.replace(/^[#\s-]+/, '').trim())
    .filter((s) => s.length >= 12)
    .filter((s) => !values.some((v) => s.includes(v)));
}

describe('English stays the default', () => {
  it('renders the same document with no lang as with lang en', () => {
    expect(renderPermissionReport({ ...everything, lang: 'en' })).toBe(renderPermissionReport(everything));
    expect(renderPermissionReport({ ...nothing, lang: 'en' })).toBe(renderPermissionReport(nothing));
  });
});

describe('the Dutch report', () => {
  const nl = renderPermissionReport({ ...everything, lang: 'nl' });
  const nlEmpty = renderPermissionReport({ ...nothing, lang: 'nl' });

  it('carries Dutch headings and table headers', () => {
    expect(nl).toContain('# Wie kan wat zien, en wat gebeurt ermee');
    expect(nl).toContain('**Migratie:** pat@acme.nl');
    expect(nl).toContain('**Gemaakt op:** 2026-10-16');
    expect(nl).toContain('## Wat het nieuwe systeem doet met wat wij schrijven');
    expect(nl).toContain('## Lees dit eerst: wat NIET is gelezen');
    expect(nl).toContain('## Wat is gevonden');
    expect(nl).toContain('| Wat | Wie | Recht | Op het nieuwe systeem |');
    expect(nl).toContain('## De stappen die alleen u kunt doen');
    expect(nlEmpty).toContain('## Wat is gevonden');
    expect(nlEmpty).toContain('## De stappen die alleen u kunt doen');
  });

  it('says the deferred apply step in Dutch, before the first finding', () => {
    const disclaimer = nl.indexOf('Niets in dit document is toegepast');
    expect(disclaimer).toBeGreaterThan(-1);
    expect(disclaimer).toBeLessThan(nl.indexOf(DATA.readCalendar));
  });

  it('keeps the blind spots above the findings', () => {
    expect(nl.indexOf('wat NIET is gelezen')).toBeLessThan(nl.indexOf('## Wat is gevonden'));
  });

  it('carries none of the English fixed sentences, in any branch', () => {
    const english = [
      ...englishSentencesOf(renderPermissionReport(everything)),
      ...englishSentencesOf(renderPermissionReport(nothing)),
    ];
    // Not vacuous: the English report has sentences to find.
    expect(english.length).toBeGreaterThan(25);
    const left = english.filter((s) => nl.includes(s) || nlEmpty.includes(s));
    expect(left).toEqual([]);
  });

  it('says the mapping on the target in Dutch, and marks a manual one by hand', () => {
    expect(nl).toContain('een gedeelde Nextcloud-agenda, alleen lezen');
    expect(nl).toContain('een gedeelde Nextcloud-agenda met schrijfrechten');
    expect(nl).toContain('**handmatig**');
    expect(nl).toContain('_iedereen met de link_');
    expect(nl).toContain('_niet vermeld_');
  });

  it('keeps every data value exactly as it arrived', () => {
    for (const value of Object.values(DATA)) expect(nl).toContain(value);
    // Rights as the source names them, in the table's Right column.
    expect(nl).toContain('| FullAccess |');
    expect(nl).toContain('| SendAs |');
  });

  it('says the empty cases in Dutch', () => {
    expect(nlEmpty).toContain('Er zijn geen rechten gevonden');
    expect(nlEmpty).toContain('Niets in de onderdelen die zijn gelezen, vraagt een beslissing van u.');
  });
});

describe("a blind spot's own Dutch, where it has one (#1605)", () => {
  const blindWith = (reasonNl?: string): PermissionReportInput => ({
    sections: [
      {
        title: DATA.blindTitle,
        listing: { kind: 'not_discoverable', reason: DATA.blindReason, ...(reasonNl ? { reasonNl } : {}) },
      },
    ],
  });

  it('says reasonNl to a Dutch reader, and reason to an English one', () => {
    const nl = renderPermissionReport({ ...blindWith('DE-REDEN-IN-HET-NEDERLANDS'), lang: 'nl' });
    expect(nl).toContain('DE-REDEN-IN-HET-NEDERLANDS');
    expect(nl).not.toContain(DATA.blindReason);
    expect(renderPermissionReport(blindWith('DE-REDEN-IN-HET-NEDERLANDS'))).toContain(DATA.blindReason);
  });

  it('says the English is English only when some reason has no Dutch', () => {
    const note = 'Een deel van de uitleg hieronder staat nog in het Engels.';
    expect(renderPermissionReport({ ...blindWith(), lang: 'nl' })).toContain(note);
    expect(renderPermissionReport({ ...blindWith('DE-REDEN'), lang: 'nl' })).not.toContain(note);
  });

  it("says the target's measurements are English, unless the line is the pass's own", async () => {
    const note = 'Deze metingen staan nog in het Engels.';
    expect(renderPermissionReport({ ...nothing, targetConduct: ['measured'], lang: 'nl' })).toContain(note);
    expect(
      renderPermissionReport({ ...nothing, targetConduct: ['gemeten'], targetConductLang: 'nl', lang: 'nl' }),
    ).not.toContain(note);
    expect(renderPermissionReport({ ...nothing, targetConduct: ['measured'] })).not.toContain(note);
  });
});

describe('the inventory pass, in the same language', () => {
  const deps = {
    delegationReason: DATA.blindReason,
    measureTargetConduct: async (): Promise<readonly string[]> => {
      throw new Error('MEASUREMENT-FAILED');
    },
  };

  it('titles its sections and says its own fallback reasons in Dutch', async () => {
    const md = await runPermissionInventory({ ...deps, lang: 'nl' });

    expect(md).toContain('### Wie verder toegang had tot het postvak');
    expect(md).toContain("### Gedeelde agenda's");
    expect(md).toContain('### Gedeelde bestanden en mappen');
    expect(md).toContain('Deze bron heeft hier niets van om te inventariseren');
    expect(md).toContain('Het gedrag van het nieuwe systeem kon niet worden gemeten: MEASUREMENT-FAILED');
    // The delegation reason is the source's, and stays as it was given.
    expect(md).toContain(DATA.blindReason);
    // The pass's own unmeasured line is Dutch, so no note says otherwise.
    expect(md).not.toContain('Deze metingen staan nog in het Engels.');
    expect(md).not.toContain('Who else had access to the mailbox');
    expect(md).not.toContain('Calendar sharing');
    expect(md).not.toContain('This source has nothing of this kind');
  });

  it("carries the delegation reason's Dutch through to a Dutch report", async () => {
    const md = await runPermissionInventory({ ...deps, delegationReasonNl: 'DELEGATIE-IN-HET-NEDERLANDS', lang: 'nl' });
    expect(md).toContain('DELEGATIE-IN-HET-NEDERLANDS');
    expect(md).not.toContain(DATA.blindReason);
  });

  it('says a failed scan in Dutch, keeping the error as it was', async () => {
    const md = await runPermissionInventory({
      ...deps,
      lang: 'nl',
      scanCalendars: async () => {
        throw new Error('SCAN-FAILED');
      },
    });
    expect(md).toContain('de scan is mislukt: SCAN-FAILED');
  });

  it('stays English when no lang is given', async () => {
    const md = await runPermissionInventory(deps);
    expect(md).toContain('### Who else had access to the mailbox');
    expect(md).toContain('### Calendar sharing');
    expect(md).toContain('# Who can see what');
  });
});
