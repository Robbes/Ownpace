// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOWNLOAD THAT RESUMES (workplan 0129 T4; the owner's D4: "a download
 * endpoint that resumes where the last one stopped, for backfill"): the cursor.
 *
 * A log store resumes from the newest line it holds, so the cursor is made of
 * that line alone: its `Timestamp` and its `ownpace.audit.id`, joined by a
 * hyphen. What these hold: it names the row it came from, to the microsecond
 * the row keeps; anything else is not a cursor; and a line whose event names no
 * actor says so by leaving the attribute out. And the query a download is asked
 * with, read by the same rules on the appliance, on managed and on the
 * operator's page: a cursor that is not one, or a page size out of range, is
 * refused by name.
 */

import { describe, it, expect } from 'vitest';
import {
  AUDIT_EXPORT_PAGE,
  AUDIT_EXPORT_PAGE_MAX,
  auditCursorAfter,
  auditExportLine,
  parseAuditCursor,
  parseAuditExportQuery,
  pseudonymizer,
} from './audit-export.ts';

const ID = '0e129000-e29b-41d4-a716-446655440001';
const EVENT = {
  id: ID,
  at: '2026-09-24T00:12:34.123456Z',
  tenantId: '0e129000-e29b-41d4-a716-446655440002',
  actor: 'jan@example.invalid',
  action: 'share.decided',
};

describe('the cursor after an event', () => {
  it("is the line's own Timestamp and id, joined by a hyphen", () => {
    const line = auditExportLine(EVENT, { pseudonym: pseudonymizer(new Uint8Array(32)), resource: {} });

    expect(auditCursorAfter(EVENT)).toBe(
      `${line.Timestamp as string}-${(line.Attributes as Record<string, string>)['ownpace.audit.id']}`,
    );
  });

  it('names the same row when it comes back', () => {
    expect(parseAuditCursor(auditCursorAfter(EVENT))).toEqual({ at: EVENT.at, id: ID });
  });

  it('is read to the microsecond the row keeps: a nanosecond under it names the same row', () => {
    expect(parseAuditCursor(`1790208754123456999-${ID}`)).toEqual({ at: EVENT.at, id: ID });
    expect(parseAuditCursor(`1790208754000000000-${ID}`)?.at).toBe('2026-09-24T00:12:34.000000Z');
  });

  it('keeps the leading zeros of the fraction', () => {
    const early = { at: '2026-09-24T00:12:34.000001Z', id: ID };

    expect(parseAuditCursor(auditCursorAfter(early))).toEqual(early);
  });

  it('forgives the case of the id and the space around it', () => {
    expect(parseAuditCursor(` 1790208754123456000-${ID.toUpperCase()} `)).toEqual({ at: EVENT.at, id: ID });
  });

  it.each([
    ['no id', '1790208754123456000'],
    ['no time', `-${ID}`],
    ['a time that is not a number', `2026-09-24-${ID}`],
    ['an id that is not one', '1790208754123456000-not-an-id'],
    ['a time with more digits than a time has', `${'9'.repeat(21)}-${ID}`],
  ])('refuses %s', (_why, text) => {
    expect(parseAuditCursor(text)).toBeUndefined();
  });
});

describe('an event that names no actor', () => {
  it('leaves the actor out, rather than exporting the pseudonym of nothing', () => {
    const line = auditExportLine({ ...EVENT, actor: '' }, { pseudonym: pseudonymizer(new Uint8Array(32)), resource: {} });

    expect(line.Attributes).not.toHaveProperty('ownpace.audit.actor');
  });
});

describe('the query a download is asked with', () => {
  it('asks from the start, a page of a thousand, when it names nothing', () => {
    expect(parseAuditExportQuery({})).toEqual({ limit: AUDIT_EXPORT_PAGE });
    expect(parseAuditExportQuery({ after: null, limit: null })).toEqual({ limit: 1000 });
  });

  it('resumes after a cursor, and keeps the cursor as it was sent', () => {
    const sent = auditCursorAfter(EVENT);

    expect(parseAuditExportQuery({ after: sent, limit: '2' })).toEqual({
      after: { at: EVENT.at, id: ID },
      afterText: sent,
      limit: 2,
    });
  });

  it('refuses a cursor that is not one, by name', () => {
    expect(parseAuditExportQuery({ after: 'yesterday' })).toMatchObject({ field: 'after' });
  });

  it(`serves a page of 1 to ${AUDIT_EXPORT_PAGE_MAX} lines, and refuses any other by name`, () => {
    expect(parseAuditExportQuery({ limit: '1' })).toEqual({ limit: 1 });
    expect(parseAuditExportQuery({ limit: '10000' })).toEqual({ limit: 10_000 });
    for (const limit of ['0', '10001', '2.5', 'many', '']) {
      expect(parseAuditExportQuery({ limit }), limit).toEqual({
        field: 'limit',
        message: 'A page is 1 to 10000 lines.',
      });
    }
  });
});
