// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The §14.2 permission runbook (workplan 0029 T3).
 *
 * Turns T1's findings and T2's mapping table into the document an owner
 * actually reads before a cutover. Pure: it takes listings and renders
 * Markdown, so what it says can be tested without a tenant.
 *
 * TWO STRUCTURAL CHOICES, both about what a reader does with this.
 *
 * **Blind spots come FIRST, above the findings.** The instinct is to lead
 * with what was found, but a section headed "could not be inventoried" placed
 * under two pages of successful findings gets skipped — and it is the
 * dangerous half. Mailbox delegation is always in it (Graph does not expose
 * FullAccess or SendAs), and those are precisely the rights whose silent loss
 * on cutover day §14.2 exists to prevent.
 *
 * **`clean` never reads as `handled`.** §14.2's apply step is deferred by
 * owner decision, so a clean mapping means *this is what it corresponds to on
 * the target*, not *we will create it*. Every item in this document is a step
 * for a person, and the document says so before the first finding rather than
 * leaving `clean` to be read as done.
 */

import type { PermissionGrant, PermissionListing } from '@openmig/shared';
import { mapGrant, type ReportLanguage } from './permission-map.ts';

/**
 * The reader's language (workplan 0144). English is the default and the
 * language every other caller reads; Dutch is what the Alpha's testers read.
 *
 * It covers the FRAME: headings, table headers and every sentence this module
 * writes, and the target each mapping names. It never covers the FINDING: an
 * address, a folder name, a right as the source names it (FullAccess, SendAs)
 * and a blind spot's reason are rendered exactly as they arrived.
 */
export type { ReportLanguage };

export interface PermissionSection {
  /** What this group of rights is, in the owner's terms. */
  readonly title: string;
  readonly listing: PermissionListing;
}

export interface PermissionReportInput {
  readonly sections: readonly PermissionSection[];
  /** Which migration this is, rendered into the header. */
  readonly mappingLabel?: string;
  /** ISO date, passed in rather than read: this module stays pure. */
  readonly generatedOn?: string;
  /**
   * What the TARGET will do with what this migration writes (0105 T0) —
   * will-do/cannot-do sentences MEASURED against the target, never assumed.
   * Rendered right after the header, before the blind spots: it answers the
   * owner's first question ("will this make noise?") before the document
   * asks them for any work. Omitted entirely when nothing was measured —
   * an empty section would read as "nothing to say", which is `unknown`
   * wearing a safe face.
   */
  readonly targetConduct?: readonly string[];
  /** The language of the frame; English when omitted. */
  readonly lang?: ReportLanguage;
}

/** Every fixed word the report says, in each language. */
const WORDS = {
  en: {
    title: '# Who can see what, and what happens to it',
    migration: '**Migration:**',
    generated: '**Generated:**',
    nothingApplied:
      '**Nothing in this document has been applied, and nothing will be applied automatically.** ' +
      'Where a right has a clean equivalent on the target, that equivalent is named — but ' +
      'creating it is a step for a person. This report is read-only by construction: it never ' +
      'writes to either system.',
    breaksQuietly:
      'Permissions are the part of a migration that breaks quietly. Mail, calendars and files ' +
      'move and you can see that they moved; a delegation that did not move shows up as ' +
      'somebody unable to do their job on the first Monday after cutover.',
    conduct: '## What the target will do with what we write',
    blind: '## Read this first: what could NOT be inventoried',
    blindIntro:
      'Nobody looked at the rights below — not "there are none". Anything granted here will ' +
      'stop working at cutover without warning unless you capture it by hand.',
    found: '## What was found',
    noneFound:
      '_No rights were found in the categories that could be inventoried._ Read the section ' +
      'above before concluding that nothing is shared.',
    tableHead: '| What | Who | Right | On the target |',
    viaLink: '_anyone with the link_',
    notStated: '_not stated_',
    byHand: '**by hand**',
    steps: '## The steps only you can do',
    noSteps:
      '_Nothing in the inventoried categories needs a manual decision._ That is not the same ' +
      'as "nothing needs doing" — everything above still has to be created on the target, ' +
      'and anything in the first section is uninventoried.',
  },
  // The owner's conventions: short sentences, "u", *migratie*, and the app's
  // own words for the same things (postvak, rechten, het nieuwe systeem,
  // overstap, handmatig, iedereen met de link).
  nl: {
    title: '# Wie kan wat zien, en wat gebeurt ermee',
    migration: '**Migratie:**',
    generated: '**Gemaakt op:**',
    nothingApplied:
      '**Niets in dit document is toegepast, en niets wordt vanzelf toegepast.** ' +
      'Heeft een recht een duidelijke tegenhanger op het nieuwe systeem, dan staat die erbij. ' +
      'Die aanmaken doet u zelf. Dit rapport leest alleen: het schrijft nooit naar het oude ' +
      'of het nieuwe systeem.',
    breaksQuietly:
      'Rechten zijn het deel van een migratie dat stil misgaat. E-mail, agenda\'s en bestanden ' +
      'worden gemigreerd, en u ziet dat ze er zijn. Een recht dat niet is meegegaan, merkt u ' +
      'pas als iemand op de eerste maandag na de overstap zijn werk niet kan doen.',
    conduct: '## Wat het nieuwe systeem doet met wat wij schrijven',
    blind: '## Lees dit eerst: wat NIET kon worden geïnventariseerd',
    blindIntro:
      'Niemand heeft de rechten hieronder bekeken. Dat is iets anders dan "er zijn er geen". ' +
      'Wat hier is toegekend, werkt na de overstap zonder waarschuwing niet meer, tenzij u ' +
      'het zelf vastlegt. De uitleg bij elk onderdeel staat soms nog in het Engels.',
    found: '## Wat is gevonden',
    noneFound:
      '_Er zijn geen rechten gevonden in de onderdelen die konden worden geïnventariseerd._ ' +
      'Lees eerst het deel hierboven, voordat u concludeert dat er niets is gedeeld.',
    tableHead: '| Wat | Wie | Recht | Op het nieuwe systeem |',
    viaLink: '_iedereen met de link_',
    notStated: '_niet vermeld_',
    byHand: '**handmatig**',
    steps: '## De stappen die alleen u kunt doen',
    noSteps:
      '_Niets in de geïnventariseerde onderdelen vraagt een beslissing van u._ Dat is niet ' +
      'hetzelfde als "er hoeft niets te gebeuren". Alles hierboven moet u nog aanmaken op het ' +
      'nieuwe systeem. En wat in het eerste deel staat, is niet geïnventariseerd.',
  },
} as const satisfies Record<ReportLanguage, Record<string, string>>;

/** Render the permission inventory as Markdown. Always returns a document. */
export function renderPermissionReport(input: PermissionReportInput): string {
  const lang = input.lang ?? 'en';
  const w = WORDS[lang];
  const out: string[] = [];
  const blind = input.sections.filter((s) => s.listing.kind === 'not_discoverable');
  const found = input.sections.filter((s) => s.listing.kind === 'listed');

  out.push(w.title);
  out.push('');
  if (input.mappingLabel) out.push(`${w.migration} ${input.mappingLabel}  `);
  if (input.generatedOn) out.push(`${w.generated} ${input.generatedOn}  `);
  out.push('');
  out.push(w.nothingApplied);
  out.push('');
  out.push(w.breaksQuietly);
  out.push('');

  if (input.targetConduct && input.targetConduct.length > 0) {
    out.push(w.conduct);
    out.push('');
    for (const line of input.targetConduct) out.push(`- ${line}`);
    out.push('');
  }

  // Blind spots first, deliberately — see the module comment.
  if (blind.length > 0) {
    out.push(w.blind);
    out.push('');
    out.push(w.blindIntro);
    out.push('');
    for (const section of blind) {
      if (section.listing.kind !== 'not_discoverable') continue;
      out.push(`### ${section.title}`);
      out.push('');
      out.push(section.listing.reason);
      out.push('');
    }
  }

  const manual: Array<{ readonly grant: PermissionGrant; readonly target: string }> = [];

  out.push(w.found);
  out.push('');
  const total = found.reduce(
    (n, s) => n + (s.listing.kind === 'listed' ? s.listing.grants.length : 0),
    0,
  );
  if (total === 0) {
    out.push(w.noneFound);
    out.push('');
  }

  for (const section of found) {
    if (section.listing.kind !== 'listed' || section.listing.grants.length === 0) continue;
    out.push(`### ${section.title}`);
    out.push('');
    out.push(w.tableHead);
    out.push('|---|---|---|---|');
    for (const g of section.listing.grants) {
      const m = mapGrant(g, lang);
      // The grantee column says LINK rather than a name when there is no
      // person: "anyone with this link" is a different risk, and a blank
      // cell would read as an oversight.
      const who = g.viaLink ? w.viaLink : (g.grantee ?? w.notStated);
      const verdict = m.verdict === 'clean' ? m.target : `${w.byHand} — ${m.target}`;
      out.push(`| ${cell(g.on)} | ${cell(who)} | ${cell(g.role)} | ${cell(verdict)} |`);
      if (m.verdict === 'manual') manual.push({ grant: g, target: m.target });
    }
    out.push('');
  }

  out.push(w.steps);
  out.push('');
  if (manual.length === 0) {
    out.push(w.noSteps);
    out.push('');
  }
  for (const item of manual) {
    out.push(`- **${item.grant.on}**${item.grant.grantee ? ` (${item.grant.grantee})` : ''} — ${item.target}`);
  }
  if (manual.length > 0) out.push('');

  return out.join('\n');
}

/** Keep a source's own words from breaking the table they sit in. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
