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
import { mapGrant } from './permission-map.ts';

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
}

/** Render the permission inventory as Markdown. Always returns a document. */
export function renderPermissionReport(input: PermissionReportInput): string {
  const out: string[] = [];
  const blind = input.sections.filter((s) => s.listing.kind === 'not_discoverable');
  const found = input.sections.filter((s) => s.listing.kind === 'listed');

  out.push('# Who can see what, and what happens to it');
  out.push('');
  if (input.mappingLabel) out.push(`**Migration:** ${input.mappingLabel}  `);
  if (input.generatedOn) out.push(`**Generated:** ${input.generatedOn}  `);
  out.push('');
  out.push(
    '**Nothing in this document has been applied, and nothing will be applied automatically.** ' +
      'Where a right has a clean equivalent on the target, that equivalent is named — but ' +
      'creating it is a step for a person. This report is read-only by construction: it never ' +
      'writes to either system.',
  );
  out.push('');
  out.push(
    'Permissions are the part of a migration that breaks quietly. Mail, calendars and files ' +
      'move and you can see that they moved; a delegation that did not move shows up as ' +
      'somebody unable to do their job on the first Monday after cutover.',
  );
  out.push('');

  // Blind spots first, deliberately — see the module comment.
  if (blind.length > 0) {
    out.push('## Read this first: what could NOT be inventoried');
    out.push('');
    out.push(
      'Nobody looked at the rights below — not "there are none". Anything granted here will ' +
        'stop working at cutover without warning unless you capture it by hand.',
    );
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

  out.push('## What was found');
  out.push('');
  const total = found.reduce(
    (n, s) => n + (s.listing.kind === 'listed' ? s.listing.grants.length : 0),
    0,
  );
  if (total === 0) {
    out.push(
      '_No rights were found in the categories that could be inventoried._ Read the section ' +
        'above before concluding that nothing is shared.',
    );
    out.push('');
  }

  for (const section of found) {
    if (section.listing.kind !== 'listed' || section.listing.grants.length === 0) continue;
    out.push(`### ${section.title}`);
    out.push('');
    out.push('| What | Who | Right | On the target |');
    out.push('|---|---|---|---|');
    for (const g of section.listing.grants) {
      const m = mapGrant(g);
      // The grantee column says LINK rather than a name when there is no
      // person: "anyone with this link" is a different risk, and a blank
      // cell would read as an oversight.
      const who = g.viaLink ? '_anyone with the link_' : (g.grantee ?? '_not stated_');
      const verdict = m.verdict === 'clean' ? m.target : `**by hand** — ${m.target}`;
      out.push(`| ${cell(g.on)} | ${cell(who)} | ${cell(g.role)} | ${cell(verdict)} |`);
      if (m.verdict === 'manual') manual.push({ grant: g, target: m.target });
    }
    out.push('');
  }

  out.push('## The steps only you can do');
  out.push('');
  if (manual.length === 0) {
    out.push(
      '_Nothing in the inventoried categories needs a manual decision._ That is not the same ' +
        'as "nothing needs doing" — everything above still has to be created on the target, ' +
        'and anything in the first section is uninventoried.',
    );
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
