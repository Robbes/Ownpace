// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The §14.2 permission runbook (workplan 0029 T3).
 *
 * Two structural properties carry most of the value, and both are about what
 * a reader does with the document: the blind spots have to come FIRST (a
 * "could not be inventoried" section buried under two pages of findings gets
 * skipped, and it is the dangerous half), and `clean` must never read as
 * `handled` (the apply step is deferred, so every item is a step for a
 * person).
 */

import { describe, it, expect } from 'vitest';
import type { PermissionGrant } from '@openmig/shared';
import { renderPermissionReport } from './permission-report.ts';

const grant = (overrides: Partial<PermissionGrant> = {}): PermissionGrant => ({
  subject: 'calendar',
  on: 'Rob — Calendar',
  grantee: 'anna@acme.nl',
  role: 'read',
  raw: '{}',
  ...overrides,
});

const listed = (title: string, grants: PermissionGrant[]) => ({
  title,
  listing: { kind: 'listed' as const, grants },
});

const blind = (title: string, reason: string) => ({
  title,
  listing: { kind: 'not_discoverable' as const, reason },
});

describe('the document as a whole', () => {
  it('says nothing has been applied, before the first finding', () => {
    const md = renderPermissionReport({ sections: [listed('Calendars', [grant()])] });

    const disclaimer = md.indexOf('has been applied');
    const firstFinding = md.indexOf('Rob — Calendar');
    // §14.2's apply step is deferred; `clean` must not be read as done.
    expect(disclaimer).toBeGreaterThan(-1);
    expect(disclaimer).toBeLessThan(firstFinding);
  });

  it('puts what could NOT be inventoried above what was found', () => {
    const md = renderPermissionReport({
      sections: [
        listed('Calendars', [grant()]),
        blind('Mailbox delegation', 'Graph does not expose FullAccess'),
      ],
    });

    // Ordering is the whole point: buried under the findings, this section
    // gets skipped, and it holds the rights that break on Monday.
    expect(md.indexOf('could NOT be inventoried')).toBeLessThan(md.indexOf('What was found'));
    expect(md).toContain('Graph does not expose FullAccess');
  });

  it('carries the blind spot’s reason verbatim', () => {
    const md = renderPermissionReport({
      sections: [blind('Mailbox delegation', 'use Get-MailboxPermission instead')],
    });
    // The source's own words — the prose boundary: translate the frame,
    // never the finding.
    expect(md).toContain('use Get-MailboxPermission instead');
  });
});

describe('the findings table', () => {
  it('names the target equivalent for a clean mapping', () => {
    const md = renderPermissionReport({ sections: [listed('Calendars', [grant({ role: 'write' })])] });
    expect(md).toContain('Nextcloud calendar share with write access');
  });

  it('marks a manual item as by hand, in the table AND in the steps', () => {
    const md = renderPermissionReport({
      sections: [
        listed('Files', [
          grant({ subject: 'drive_item', on: '/Budget.xlsx', role: 'write', viaLink: true }),
        ]),
      ],
    });

    expect(md).toContain('**by hand**');
    expect(md).toContain('The steps only you can do');
    expect(md).toContain('/Budget.xlsx');
  });

  it('says LINK rather than leaving the holder blank', () => {
    const md = renderPermissionReport({
      sections: [listed('Files', [grant({ subject: 'drive_item', role: 'write', viaLink: true })])],
    });

    // A blank cell would read as an oversight; "anyone with the link" is a
    // different risk from a named person and has to look different.
    expect(md).toContain('anyone with the link');
  });

  it('does not let a source’s own words break the table', () => {
    const md = renderPermissionReport({
      sections: [listed('Files', [grant({ on: 'weird | name', role: 'read' })])],
    });
    // The grant is rendered verbatim; a raw pipe would split the row.
    expect(md).toContain('weird \\| name');
  });
});

describe('the empty cases', () => {
  it('refuses to read "nothing found" as "nothing is shared"', () => {
    const md = renderPermissionReport({
      sections: [listed('Calendars', []), blind('Mailbox delegation', 'not readable')],
    });

    expect(md).toContain('No rights were found');
    // Pointed at the section that explains why that is not the whole story.
    expect(md).toContain('before concluding that nothing is shared');
  });

  it('refuses to read "no manual steps" as "nothing to do"', () => {
    const md = renderPermissionReport({ sections: [listed('Calendars', [grant()])] });

    // Everything still has to be created on the target — the apply step is
    // deferred, so a clean mapping is a step too.
    expect(md).toContain('not the same');
    expect(md).toContain('still has to be created on the target');
  });

  it('produces a document even with no sections at all', () => {
    const md = renderPermissionReport({ sections: [] });
    expect(md).toContain('Who can see what');
    expect(md).toContain('No rights were found');
  });
});

describe('the header', () => {
  it('carries the migration and the date, when given', () => {
    const md = renderPermissionReport({
      sections: [],
      mappingLabel: 'Acme BV — mail',
      generatedOn: '2026-08-04',
    });
    expect(md).toContain('Acme BV — mail');
    expect(md).toContain('2026-08-04');
  });

  it('omits the date rather than inventing one', () => {
    // Pure by construction: it never reads a clock.
    expect(renderPermissionReport({ sections: [] })).not.toContain('**Generated:**');
  });
});
