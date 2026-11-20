// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The once-per-mapping verdict record (0105 T0) — what `schedulingRecorder`
 * promises the calendar pass: measured on the endpoint the pass writes to,
 * recorded exactly once per mapping, and NEVER the reason a migration fails.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CALENDAR_TARGET_SCHEDULING_ACTION,
  measureTargetScheduling,
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

describe('a target that mails guests whatever the marker says is said to be one (workplan 0160)', () => {
  // The writer gives a kind on TARGETS_THAT_MAIL_GUESTS no guests, and the
  // sentence a person reads, and the audit row, say that instead of the
  // promise the marker was meant to keep. Cirrux was such a kind from
  // 2026-11-19, when it mailed invitations for events whose every attendee
  // carried SCHEDULE-AGENT=CLIENT, to 2026-11-20 (ADR-0043). The list is
  // empty since, so these cases hand the verdict a list of their own, and the
  // sentence stays proven for the next kind put on it.
  const answering = (dav: string) => ({
    request: async () => ({ status: 200, body: '', headers: { DAV: dav } }),
  });
  const MAILING = 'a-kind-that-mails';
  const KINDS_THAT_MAIL_GUESTS: ReadonlySet<string> = new Set([MAILING]);

  it('says no guests are written, whatever the server advertises, and keeps the capability as measured', async () => {
    for (const [dav, capability] of [
      ['1, 2, calendar-access, calendar-auto-schedule', 'auto-schedule'],
      ['1, 2, calendar-access', 'none'],
    ] as const) {
      const verdict = await measureTargetScheduling(ENDPOINT.url, 'probe', 'pw', answering(dav), MAILING, KINDS_THAT_MAIL_GUESTS);
      expect(verdict.capability).toBe(capability);
      expect(verdict.sentence).toContain('without their guests and organiser');
      expect(verdict.sentence).not.toContain('cannot happen here');
      expect(verdict.sentence).not.toContain('neutralises');
    }
  });

  it('records that sentence before the first calendar write', async () => {
    const ledger = fakeLedger();
    vi.stubGlobal('fetch', optionsAnsweringFetch('1, 2, calendar-access, calendar-auto-schedule'));
    try {
      await schedulingRecorder(ENDPOINT, { ledger, tenantId: TENANT, mappingId: MAPPING }, MAILING, KINDS_THAT_MAIL_GUESTS)();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(ledger.recorded[0]?.detail).toMatchObject({ capability: 'auto-schedule' });
    expect(String(ledger.recorded[0]?.detail?.sentence)).toContain('without their guests and organiser');
  });

  it('leaves every other kind, and an unnamed one, with the sentence its server earned', async () => {
    for (const kind of ['nextcloud', 'soverin', undefined]) {
      const verdict = await measureTargetScheduling(
        ENDPOINT.url,
        'probe',
        'pw',
        answering('1, 2, calendar-access, calendar-auto-schedule'),
        kind,
      );
      expect(verdict.sentence, String(kind)).toContain('measured on this target, not assumed');
    }
  });

  it('says of Infomaniak what its server earned, as of Nextcloud, at the Test and in the audit row (0161, 2026-11-20)', async () => {
    // Infomaniak left the list on 2026-11-20 (ADR-0043): its copies keep
    // their guests, each marked SCHEDULE-AGENT=CLIENT, as Nextcloud's do. So
    // nothing a person reads about it says it is untested, or that it is
    // written without guests.
    for (const [dav, capability, words] of [
      ['1, 2, calendar-access, calendar-auto-schedule', 'auto-schedule', 'measured on this target, not assumed'],
      ['1, 2, calendar-access', 'none', 'cannot happen here'],
    ] as const) {
      const verdict = await measureTargetScheduling(ENDPOINT.url, 'probe', 'pw', answering(dav), 'infomaniak');
      expect(verdict.capability).toBe(capability);
      expect(verdict.sentence).toContain(words);
      expect(verdict.sentence).not.toContain('has not been tested yet');
      expect(verdict.sentence).not.toContain('without their guests and organiser');
    }

    const ledger = fakeLedger();
    vi.stubGlobal('fetch', optionsAnsweringFetch('1, 2, calendar-access, calendar-auto-schedule'));
    try {
      await schedulingRecorder(ENDPOINT, { ledger, tenantId: TENANT, mappingId: MAPPING }, 'infomaniak')();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(ledger.recorded[0]?.detail).toMatchObject({ capability: 'auto-schedule' });
    expect(String(ledger.recorded[0]?.detail?.sentence)).toContain('measured on this target, not assumed');
  });

  it('says of Cirrux what its server earned, as of Nextcloud, at the Test and in the audit row (0160, 2026-11-20)', async () => {
    // Cirrux left the list on 2026-11-20 (ADR-0043): its copies keep their
    // guests, each marked SCHEDULE-AGENT=CLIENT, as Nextcloud's do. So nothing
    // a person reads about it says it is written without guests, or that it
    // emails them.
    for (const [dav, capability, words] of [
      ['1, 2, calendar-access, calendar-auto-schedule', 'auto-schedule', 'measured on this target, not assumed'],
      ['1, 2, calendar-access', 'none', 'cannot happen here'],
    ] as const) {
      const verdict = await measureTargetScheduling(ENDPOINT.url, 'probe', 'pw', answering(dav), 'cirrux');
      expect(verdict.capability).toBe(capability);
      expect(verdict.sentence).toContain(words);
      expect(verdict.sentence).not.toContain('This target emails every guest');
      expect(verdict.sentence).not.toContain('without their guests and organiser');
    }

    const ledger = fakeLedger();
    vi.stubGlobal('fetch', optionsAnsweringFetch('1, 2, calendar-access, calendar-auto-schedule'));
    try {
      await schedulingRecorder(ENDPOINT, { ledger, tenantId: TENANT, mappingId: MAPPING }, 'cirrux')();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(ledger.recorded[0]?.detail).toMatchObject({ capability: 'auto-schedule' });
    expect(String(ledger.recorded[0]?.detail?.sentence)).toContain('measured on this target, not assumed');
  });
});
