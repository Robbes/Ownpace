// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN AUDIT LINE A COLLECTOR CAN READ (workplan 0129 T4; the owner's D4: "One
 * JSON line per audit event, using OpenTelemetry field names ... Email
 * addresses and file names replaced by pseudonyms in the export by default").
 *
 * The line's shape, and what may leave in it:
 *
 *  - OpenTelemetry's field names, with the time in nanoseconds;
 *  - an address or a name is a pseudonym, the same one every time under one
 *    key and a different one under another;
 *  - a detail field nobody has classified does not leave at all;
 *  - an address inside a kept string is replaced too;
 *  - a URL leaves as its origin, and an action that is not a name from code as
 *    `audit.unnamed`, as the log page shows it.
 *
 * The addresses and names below are invented.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  AUDIT_DETAIL_FIELDS,
  auditExportLine,
  exportAuditEvent,
  nanosSinceEpoch,
  pseudonymizer,
  setAuditExportSink,
  type AuditExportEvent,
} from './audit-export.ts';

const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(8);
const pseudonym = pseudonymizer(KEY);
const RESOURCE = { 'service.name': 'ownpace-test' };

const EVENT: AuditExportEvent = {
  id: '0e330000-e29b-41d4-a716-446655440001',
  at: '2026-09-24T00:12:34.123456Z',
  tenantId: '0e330000-e29b-41d4-a716-446655440002',
  actor: 'jan@example.invalid',
  action: 'share.decided',
  entity: 'share_grant',
  detail: {
    mappingId: '0e330000-e29b-41d4-a716-446655440003',
    on: 'Salaries 2026.xlsx',
    grantee: 'anna@example.invalid',
    role: 'reader',
    sentence: 'Invitations go to anna@example.invalid and piet@example.invalid from the target.',
    url: 'https://cloud.example.invalid/remote.php/dav/calendars/jan/',
    to: { provider: 'nextcloud', host: 'cloud.example.invalid', account: 'jan@example.invalid' },
    leftForChecklist: { links: 2, manual: 1 },
    somethingNew: 'must not leave',
  },
};

const line = (event: AuditExportEvent = EVENT) => auditExportLine(event, { pseudonym, resource: RESOURCE });

afterEach(() => setAuditExportSink(undefined));

describe('the line, by OpenTelemetry field names', () => {
  it('has the time, severity, body, attributes and resource a collector expects', () => {
    const out = line();

    expect(out).toMatchObject({
      Timestamp: '1790208754123456000',
      SeverityText: 'INFO',
      SeverityNumber: 9,
      Body: 'share.decided',
      Resource: RESOURCE,
    });
    expect(out.Attributes).toMatchObject({
      'event.name': 'share.decided',
      'ownpace.audit.id': EVENT.id,
      'ownpace.tenant.id': EVENT.tenantId,
      'ownpace.audit.entity': 'share_grant',
    });
  });

  it('keeps the time to the nanosecond the row has it to', () => {
    expect(nanosSinceEpoch('2026-09-24T00:12:34Z')).toBe('1790208754000000000');
    expect(nanosSinceEpoch('2026-09-24T00:12:34.000001Z')).toBe('1790208754000001000');
    expect(() => nanosSinceEpoch('24-09-2026')).toThrow();
  });

  it('serves an action that is not a name from code as audit.unnamed, as the page does', () => {
    const out = line({ ...EVENT, action: 'Moved the Salaris folder for jan' });

    expect(out.Body).toBe('audit.unnamed');
    expect(JSON.stringify(out)).not.toContain('Salaris');
  });
});

describe('nobody is named', () => {
  it('replaces the acting address, and keeps an actor that is a process', () => {
    expect((line().Attributes as Record<string, unknown>)['ownpace.audit.actor']).toBe(
      pseudonym('jan@example.invalid'),
    );
    expect(
      (line({ ...EVENT, actor: 'system:digest' }).Attributes as Record<string, unknown>)['ownpace.audit.actor'],
    ).toBe('system:digest');
  });

  it('replaces every address and file name, wherever in the detail it is', () => {
    const body = JSON.stringify(line());

    for (const plain of [
      'jan@example.invalid',
      'anna@example.invalid',
      'piet@example.invalid',
      'Salaries 2026.xlsx',
      '/calendars/jan/',
    ]) {
      expect(body, plain).not.toContain(plain);
    }
    const detail = (line().Attributes as Record<string, Record<string, unknown>>)['ownpace.audit.detail']!;
    expect(detail.on).toBe(pseudonym('Salaries 2026.xlsx'));
    expect(detail.grantee).toBe(pseudonym('anna@example.invalid'));
    expect(detail.sentence).toBe(
      `Invitations go to ${pseudonym('anna@example.invalid')} and ${pseudonym('piet@example.invalid')} from the target.`,
    );
    expect(detail.to).toEqual({ provider: 'nextcloud', host: 'cloud.example.invalid', account: pseudonym('jan@example.invalid') });
  });

  it("keeps what names nobody: ids, codes, counts and a URL's origin", () => {
    const detail = (line().Attributes as Record<string, Record<string, unknown>>)['ownpace.audit.detail']!;

    expect(detail).toMatchObject({
      mappingId: EVENT.detail!.mappingId,
      role: 'reader',
      url: 'https://cloud.example.invalid',
      leftForChecklist: { links: 2, manual: 1 },
    });
  });

  it('sends nothing for a URL it cannot read, rather than its path', () => {
    const out = line({ ...EVENT, detail: { url: 'cloud.example.invalid/remote.php/dav/calendars/jan/' } });

    expect((out.Attributes as Record<string, Record<string, unknown>>)['ownpace.audit.detail']).toEqual({ url: null });
  });

  it('drops a field nobody has classified, rather than letting it leave', () => {
    const detail = (line().Attributes as Record<string, Record<string, unknown>>)['ownpace.audit.detail']!;

    expect(detail).not.toHaveProperty('somethingNew');
    expect(JSON.stringify(line())).not.toContain('must not leave');
  });
});

describe('a pseudonym', () => {
  it('is the same person every time under one key, however the address was typed', () => {
    expect(pseudonym('Jan@Example.invalid')).toBe(pseudonym('jan@example.invalid'));
    expect(pseudonym(' jan@example.invalid ')).toBe(pseudonym('jan@example.invalid'));
    expect(pseudonym('jan@example.invalid')).toMatch(/^pseudo:[0-9a-f]{16}$/);
  });

  it('is the same name whichever way its accents were encoded', () => {
    expect(pseudonym('Cafe\u0301.pdf')).toBe(pseudonym('Caf\u00e9.pdf'));
  });

  it("is somebody else under another deployment's key", () => {
    expect(pseudonymizer(OTHER_KEY)('jan@example.invalid')).not.toBe(pseudonym('jan@example.invalid'));
  });

  it("keeps a name's case: two files that differ in it are two files", () => {
    expect(pseudonym('Report.pdf')).not.toBe(pseudonym('report.pdf'));
  });
});

describe('writing the line', () => {
  it('never fails the event: a sink that throws costs the line', async () => {
    setAuditExportSink({
      record: async () => {
        throw new Error('stdout is closed');
      },
    });

    expect(() => exportAuditEvent(EVENT)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('writes nothing where no sink was set', () => {
    expect(() => exportAuditEvent(EVENT)).not.toThrow();
  });

  it('classifies every field as one of three kinds, and nothing else', () => {
    for (const kind of Object.values(AUDIT_DETAIL_FIELDS)) {
      expect(['keep', 'pseudonym', 'origin']).toContain(kind);
    }
  });
});
