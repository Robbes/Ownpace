// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A stop or a resume, sent where each edition's door is (workplan 0128 T4,
 * slice 3c), and the stop fields kept on managed's detail payload.
 *
 * The press is one call on both editions, under the mapping's own path:
 * `/mappings/{id}` on the appliance, `/migrations/{id}` on managed. Pinned in
 * both, because a press that reached the door in one and a 404 in the other
 * would be a button that works on the edition its author looked at. And the
 * detail schema is a `z.object`, which strips what it does not name: a stop
 * field left out of it is a field no screen can ever read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { postMock, edition } = vi.hoisted(() => ({
  postMock: vi.fn(),
  edition: { selfhost: false },
}));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: () => ({
        get: vi.fn(),
        post: postMock,
        put: vi.fn(),
        delete: vi.fn(),
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      }),
    },
  };
});

// VITE_EDITION is baked in at build time, so the edition is swapped here
// rather than through the environment (edition.unit.test.ts explains why).
vi.mock('./edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./edition.ts')>();
  return {
    ...actual,
    isSelfHost: () => edition.selfhost,
    mappingPath: (id: string) => actual.mappingPathFor(edition.selfhost ? 'selfhost' : 'managed', id),
  };
});

import { stopOrResumeDataType } from './operating-service.ts';
import { MappingSchema } from './mapping-service.ts';

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue({ data: { id: 'm-1', domain: 'email', stopped: true, changed: true } });
});

describe('the press, on each edition', () => {
  it('reaches the appliance’s door under /mappings', async () => {
    edition.selfhost = true;
    await stopOrResumeDataType('m-1', 'calendar', 'resume');
    expect(postMock).toHaveBeenCalledWith('/mappings/m-1/domains/calendar/resume');
  });

  it('reaches managed’s door under /migrations', async () => {
    edition.selfhost = false;
    expect(await stopOrResumeDataType('m-1', 'email', 'stop')).toEqual({
      id: 'm-1',
      domain: 'email',
      stopped: true,
      changed: true,
    });
    expect(postMock).toHaveBeenCalledWith('/migrations/m-1/domains/email/stop');
  });
});

describe("managed's detail payload keeps the stop fields", () => {
  const detail = {
    id: 'm-1',
    tenantId: 't-1',
    name: 'Acme',
    sourceType: 'imap',
    targetType: 'jmap',
    sourceConfig: {},
    targetConfig: {},
    syncConfig: { domains: ['email', 'calendar'] },
    status: 'active',
    mode: 'mirror',
    domainStatus: [
      {
        domain: 'email',
        state: 'stopped',
        itemsSynced: 12,
        itemsFailed: 0,
        bytesTransferred: 0,
        itemsRetrying: 0,
        itemsNeedingDecision: 0,
        stoppedByOwner: true,
      },
    ],
    stopChoices: [
      { domain: 'email', stopped: true, offer: 'resume' },
      { domain: 'calendar', stopped: false, offer: null, held: 'last_one_copying' },
    ],
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
  };

  it('keeps whose stop it is on the strip row, and each stop choice', () => {
    const parsed = MappingSchema.parse(detail);
    expect(parsed.domainStatus[0]!.stoppedByOwner).toBe(true);
    expect(parsed.stopChoices).toEqual(detail.stopChoices);
  });

  it('drops a reason the page has no words for, and parses a payload that predates the stops', () => {
    const newer = MappingSchema.parse({
      ...detail,
      stopChoices: [{ domain: 'calendar', stopped: false, offer: null, held: 'something_new' }],
    });
    expect(newer.stopChoices).toEqual([{ domain: 'calendar', stopped: false, offer: null }]);
    const { stopChoices: _none, ...older } = detail;
    expect(MappingSchema.parse(older).stopChoices).toBeUndefined();
  });
});
