// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ERROR THE OPERATOR CAN FIND (workplan 0129 T1): the recorder's half.
 *
 * An event is a name from code and a reference a person quotes, never a
 * message, and recording one can never fail the work it describes. The
 * database's half, the table and its CHECKs, is held in `@openmig/ledger`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  appEventProblem,
  newReference,
  recordAppEvent,
  setAppEventSink,
  APP_EVENT_REFERENCE,
  type AppEvent,
} from './app-event.ts';

const EVENT: AppEvent = {
  level: 'error',
  event: 'sync.domain-failed',
  reference: '0a1b2c3d',
  tenantId: '0e220000-e29b-41d4-a716-446655440001',
  mappingId: '0e220000-e29b-41d4-a716-446655440002',
  category: 'auth_expired',
};

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

describe('a reference', () => {
  it('is eight hex characters, as a failed request has always answered with', () => {
    for (let i = 0; i < 50; i += 1) expect(newReference()).toMatch(APP_EVENT_REFERENCE);
  });

  it('is new each time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newReference()));
    expect(seen.size).toBe(200);
  });
});

describe('an event is metadata, never a message', () => {
  it('accepts a name from code, a reference, and the ids and category', () => {
    expect(appEventProblem(EVENT)).toBeUndefined();
    expect(appEventProblem({ level: 'warn', event: 'api.list_failed', reference: 'ffffffff' })).toBeUndefined();
  });

  it.each([
    ['a sentence', 'the sync failed'],
    ['an address', 'someone@example.invalid'],
    ['a path', 'Documents/Q3 report.docx'],
    ['a capital', 'Sync.failed'],
    ['nothing', ''],
    ['a name longer than 64', `a${'b'.repeat(64)}`],
  ])('refuses %s as the event', (_what, event) => {
    expect(appEventProblem({ ...EVENT, event })).toBeDefined();
  });

  it.each([['XYZ'], ['0a1b2c3'], ['0A1B2C3D'], ['0a1b2c3d9']])('refuses %s as a reference', (reference) => {
    expect(appEventProblem({ ...EVENT, reference })).toBeDefined();
  });

  it('refuses a level other than warn or error, and a category that is not one', () => {
    expect(appEventProblem({ ...EVENT, level: 'info' as never })).toBeDefined();
    expect(appEventProblem({ ...EVENT, category: 'Could not reach the server' as never })).toBeDefined();
  });
});

describe('recording', () => {
  it('writes the event to the process sink', async () => {
    const record = vi.fn(async () => {});
    setAppEventSink({ record });

    await recordAppEvent(EVENT);

    expect(record).toHaveBeenCalledWith(EVENT);
  });

  it('writes nothing, and says so without repeating the text, when the event is malformed', async () => {
    const record = vi.fn(async () => {});
    setAppEventSink({ record });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await recordAppEvent({ ...EVENT, event: 'mail from someone@example.invalid failed' });

    expect(record).not.toHaveBeenCalled();
    const said = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(said).toContain('not recorded');
    expect(said).toContain(EVENT.reference);
    expect(said).not.toContain('someone@example.invalid');
  });

  it('never throws when the sink fails: the event is lost, not the work', async () => {
    setAppEventSink({
      record: async () => {
        throw new Error('the database is unavailable');
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(recordAppEvent(EVENT)).resolves.toBeUndefined();

    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toContain(EVENT.reference);
  });

  it('is a no-op in a process that never set a sink', async () => {
    await expect(recordAppEvent(EVENT)).resolves.toBeUndefined();
  });
});
