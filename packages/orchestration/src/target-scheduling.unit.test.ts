// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The once-per-mapping verdict record (0105 T0) — what `schedulingRecorder`
 * promises the calendar pass: measured on the endpoint the pass writes to,
 * recorded exactly once per mapping, and NEVER the reason a migration fails.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CALENDAR_TARGET_SCHEDULING_ACTION,
  schedulingRecorder,
} from './target-scheduling.ts';
import { asMappingId, asTenantId } from '@openmig/shared';

const TENANT = asTenantId('11111111-1111-4111-8111-111111111111');
const MAPPING = asMappingId('22222222-2222-4222-8222-222222222222');
const ENDPOINT = { url: 'https://dav.example.net/dav/', username: 'probe', password: 'pw' };

/** A ledger that remembers what was recorded and answers "was it already?". */
function fakeLedger(alreadyAt?: string) {
  const recorded: Array<{ action: string; detail?: Record<string, unknown> }> = [];
  return {
    recorded,
    latestAuditEventAt: vi.fn(async () => alreadyAt),
    recordAuditEvent: vi.fn(async (_tenant: unknown, event: { action: string; detail?: Record<string, unknown> }) => {
      recorded.push(event);
    }),
  };
}

const optionsAnsweringFetch = (dav?: string) =>
  vi.fn(async () =>
    new Response('', { status: 200, headers: dav === undefined ? {} : { DAV: dav } }),
  );

describe('schedulingRecorder: measured before the first write, once per mapping (0105 T0)', () => {
  it('records the verdict with the capability the target actually advertised', async () => {
    const ledger = fakeLedger();
    vi.stubGlobal('fetch', optionsAnsweringFetch('1, 2, calendar-access, calendar-auto-schedule'));
    try {
      await schedulingRecorder(ENDPOINT, { ledger, tenantId: TENANT, mappingId: MAPPING })();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(ledger.recorded).toHaveLength(1);
    const event = ledger.recorded[0]!;
    expect(event.action).toBe(CALENDAR_TARGET_SCHEDULING_ACTION);
    expect(event.detail).toMatchObject({
      mappingId: MAPPING,
      capability: 'auto-schedule',
      url: ENDPOINT.url,
    });
    // The sentence rides along, so the audit row answers "what did we tell
    // the owner" without a join against a build's dictionary.
    expect(String(event.detail?.sentence)).toContain('measured on this target, not assumed');
  });

  it('a mapping already carrying the record measures NOTHING again — no OPTIONS, no second row', async () => {
    const ledger = fakeLedger('2026-08-01T00:00:00Z');
    const fetchMock = optionsAnsweringFetch('calendar-auto-schedule');
    vi.stubGlobal('fetch', fetchMock);
    try {
      await schedulingRecorder(ENDPOINT, { ledger, tenantId: TENANT, mappingId: MAPPING })();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ledger.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('NEVER kills the pass: a ledger that refuses the write resolves, not throws', async () => {
    // The writer neutralises unconditionally (ADR-0043); an advisory record
    // failing must not be the reason somebody's calendar did not migrate.
    const ledger = fakeLedger();
    ledger.recordAuditEvent.mockRejectedValueOnce(new Error('audit table on fire'));
    vi.stubGlobal('fetch', optionsAnsweringFetch('calendar-access'));
    try {
      await expect(
        schedulingRecorder(ENDPOINT, { ledger, tenantId: TENANT, mappingId: MAPPING })(),
      ).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a target that answers no DAV header is recorded as unknown — unmeasured, never dropped', async () => {
    const ledger = fakeLedger();
    vi.stubGlobal('fetch', optionsAnsweringFetch(undefined));
    try {
      await schedulingRecorder(ENDPOINT, { ledger, tenantId: TENANT, mappingId: MAPPING })();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(ledger.recorded[0]?.detail).toMatchObject({ capability: 'unknown' });
    expect(String(ledger.recorded[0]?.detail?.sentence)).toContain('UNMEASURED');
  });
});
