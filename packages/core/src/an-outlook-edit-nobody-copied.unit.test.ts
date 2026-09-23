// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN OUTLOOK EDIT NOBODY COPIED (found 2026-09-23, tracing the owner's
 * contact that reached Nextcloud without its photo).
 *
 * `classifyKnownItem` SKIPS a copied item whose listing gives no version, and
 * the Graph contact and calendar listings gave none. So a contact or an event
 * edited in Outlook after its first copy was never copied again: Graph's delta
 * put the edited item in front of every pass, and every pass skipped it. It is
 * `an-edit-nobody-copied`'s defect (#1083) in the two Microsoft listings that
 * fix did not reach, and it is proved the same way: the real sources, on a fake
 * Graph a test can change between passes, across passes.
 *
 *  - an edit is copied on the next pass;
 *  - nothing changed means nothing rewritten;
 *  - a copy made before versions existed is not rewritten by the upgrade, and
 *    the first real edit after it is copied.
 */

import { describe, it, expect } from 'vitest';
import { GraphCalendarSource, GraphContactsSource } from '@openmig/connectors';
import {
  asMappingId,
  asTenantId,
  type ContactSource,
  type OAuth2Token,
  type RawCalendarEvent,
  type RawContact,
  type TokenProvider,
  type UpsertResult,
} from '@openmig/shared';
import { runCalendarSync, runContactSync } from './dav-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('0e300000-e29b-41d4-a716-446655440001');
const MAPPING = asMappingId('0e300000-e29b-41d4-a716-446655440002');

const TOKEN: OAuth2Token = { accessToken: 'token', tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000 };
const tokens: TokenProvider = {
  getToken: async () => TOKEN,
  refresh: async () => TOKEN,
  isTokenValid: () => true,
  getTokenStatus: () => ({ isValid: true, timeUntilExpiry: 3600 }),
} as unknown as TokenProvider;

interface FakeItem {
  id: string;
  subject: string;
  changeKey?: string;
}

/**
 * A mailbox's contacts and one calendar, which a test can change between
 * passes. Every delta answers the whole state: that is a full listing, which
 * is the case where an unchanged item must be told from a changed one.
 */
function fakeGraph(initial: { contacts?: FakeItem[]; events?: FakeItem[] }) {
  const state = { contacts: initial.contacts ?? [], events: initial.events ?? [] };
  const json = (body: unknown) => ({ status: 200, body: JSON.stringify(body), headers: {} });
  const client = {
    request: async ({ url }: { url: string }) => {
      if (url.endsWith('/contactFolders')) return json({ value: [] });
      if (url.includes('/contacts/delta')) {
        return json({
          value: state.contacts.map((c) => ({
            id: c.id,
            displayName: c.subject,
            ...(c.changeKey ? { changeKey: c.changeKey } : {}),
          })),
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/contacts/delta?$deltatoken=t',
        });
      }
      if (url.includes('/photo/$value')) return { status: 404, body: '{}', headers: {} };
      if (url.endsWith('/me/calendars')) {
        return json({ value: [{ id: 'cal-1', name: 'Calendar', isDefaultCalendar: true, changeKey: 'cal' }] });
      }
      if (url.includes('/events/delta')) {
        return json({
          value: state.events.map((e) => ({
            id: e.id,
            subject: e.subject,
            isAllDay: false,
            isCancelled: false,
            isRecurring: false,
            ...(e.changeKey ? { changeKey: e.changeKey } : {}),
          })),
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendars/cal-1/events/delta?$deltatoken=t',
        });
      }
      const event = /\/events\/([^/]+)\/\$value$/.exec(url);
      if (event) {
        const e = state.events.find((x) => x.id === event[1]);
        return {
          status: 200,
          headers: {},
          body: [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            `UID:${e?.id}`,
            'DTSTART:20260924T090000Z',
            'DTEND:20260924T100000Z',
            `SUMMARY:${e?.subject}`,
            'END:VEVENT',
            'END:VCALENDAR',
          ].join('\r\n'),
        };
      }
      return { status: 404, body: `no fake route for ${url}`, headers: {} };
    },
  };
  return { state, client };
}

/** Keeps what it was handed, and which writes were rewrites of something it holds. */
function memoryTarget() {
  const rewrites: string[] = [];
  const write = (key: string, options?: { overwrite?: boolean }): UpsertResult => {
    if (options?.overwrite) {
      rewrites.push(key);
      return { targetId: key, created: false, updated: true };
    }
    return { targetId: key, created: true };
  };
  return {
    rewrites,
    ensureContactFolder: async (folder: { path: string }) => `t${folder.path}`,
    upsertContact: async (_folder: string, raw: RawContact, options?: { overwrite?: boolean }) =>
      write(raw.item.uid, options),
    ensureCalendar: async (folder: { path: string }) => `t${folder.path}`,
    upsertCalendarEvent: async (_calendar: string, raw: RawCalendarEvent, options?: { overwrite?: boolean }) =>
      write(raw.item.uid, options),
  };
}

const run = {
  contacts: (source: ContactSource, target: ReturnType<typeof memoryTarget>, ledger: MemoryLedger, cursors: MemoryCursorStore) =>
    runContactSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target: target as never,
      ledger,
      cursors,
      sourceIsAuthorityOnExistence: true,
    }),
  events: (source: GraphCalendarSource, target: ReturnType<typeof memoryTarget>, ledger: MemoryLedger, cursors: MemoryCursorStore) =>
    runCalendarSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target: target as never,
      ledger,
      cursors,
      sourceIsAuthorityOnExistence: true,
    }),
};

describe('an Outlook contact edited after its first copy', () => {
  it('is copied again on the next pass', async () => {
    const { state, client } = fakeGraph({ contacts: [{ id: 'c-1', subject: 'Ada', changeKey: 'ck-1' }] });
    const source = new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: client });
    const target = memoryTarget();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();

    expect((await run.contacts(source, target, ledger, cursors)).created).toBe(1);

    state.contacts = [{ id: 'c-1', subject: 'Ada Lovelace', changeKey: 'ck-2' }];
    const second = await run.contacts(source, target, ledger, cursors);

    // Before: `skipped: 1`, `updated: 0`, and the card on Nextcloud stayed as it was.
    expect(second.updated).toBe(1);
    expect(target.rewrites).toEqual(['c-1']);
  });

  it('is left alone when nothing changed', async () => {
    const { client } = fakeGraph({ contacts: [{ id: 'c-1', subject: 'Ada', changeKey: 'ck-1' }] });
    const source = new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: client });
    const target = memoryTarget();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();

    await run.contacts(source, target, ledger, cursors);
    const second = await run.contacts(source, target, ledger, cursors);

    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(target.rewrites).toEqual([]);
  });
});

describe('an Outlook event edited after its first copy', () => {
  it('is copied again on the next pass, and left alone when unchanged', async () => {
    const { state, client } = fakeGraph({ events: [{ id: 'e-1', subject: 'Standup', changeKey: 'ek-1' }] });
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: client });
    const target = memoryTarget();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();

    expect((await run.events(source, target, ledger, cursors)).created).toBe(1);
    expect((await run.events(source, target, ledger, cursors)).skipped).toBe(1);

    state.events = [{ id: 'e-1', subject: 'Standup, moved', changeKey: 'ek-2' }];
    const edited = await run.events(source, target, ledger, cursors);

    expect(edited.updated).toBe(1);
    expect(target.rewrites).toEqual(['e-1']);
  });
});

describe('a copy made before Outlook items had versions', () => {
  it('is not rewritten by the upgrade, and the first real edit after it is copied', async () => {
    // Every Microsoft contact and event copied so far has no version. Rewriting
    // them all on the first pass after this ships would rewrite whole address
    // books and calendars; recording what each is now costs a ledger write.
    const { state, client } = fakeGraph({ contacts: [{ id: 'c-1', subject: 'Ada' }] });
    const source = new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: client });
    const target = memoryTarget();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();

    // The copy as it was made before: Graph sent no version the listing kept.
    await run.contacts(source, target, ledger, cursors);

    state.contacts = [{ id: 'c-1', subject: 'Ada', changeKey: 'ck-1' }];
    const upgraded = await run.contacts(source, target, ledger, cursors);
    expect(upgraded.updated, 'the upgrade itself rewrites nothing').toBe(0);
    expect(target.rewrites).toEqual([]);

    state.contacts = [{ id: 'c-1', subject: 'Ada Lovelace', changeKey: 'ck-2' }];
    const edited = await run.contacts(source, target, ledger, cursors);
    expect(edited.updated, 'and the first real edit after it is copied').toBe(1);
  });
});
