// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * One migration's data-type rows, from whichever payload its edition serves
 * them on (workplan 0125 T7).
 *
 * The Finish checklist names a stopped data type in both of its modes. Per
 * mapping it has no `/status` of its own to read, so `fetchMappingDomains`
 * asks the edition's own source: the appliance's `/status`, filtered to this
 * mapping, or managed's `GET /migrations/{id}`. Pinned in both editions,
 * because a reader that worked in one and answered "none" in the other would
 * say nothing is stopped exactly where it is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMock, edition } = vi.hoisted(() => ({
  getMock: vi.fn(),
  edition: { selfhost: false },
}));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: () => ({
        get: getMock,
        post: vi.fn(),
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

import { fetchMappingDomains } from './operating-service.ts';

const stopped = {
  domain: 'calendar',
  state: 'stopped',
  itemsSynced: 412,
  itemsFailed: 0,
  bytesTransferred: 0,
  itemsRetrying: 0,
  itemsNeedingDecision: 0,
};

beforeEach(() => {
  getMock.mockReset();
});

describe('the appliance', () => {
  beforeEach(() => {
    edition.selfhost = true;
  });

  it('reads /status and keeps only this migration’s rows', async () => {
    getMock.mockResolvedValue({
      data: {
        status: 'ok',
        mappings: [
          { mappingId: 'someone-else', migrationStatus: 'active', domains: [{ ...stopped, itemsSynced: 1 }] },
          { mappingId: 'acme-mail', migrationStatus: 'active', domains: [stopped] },
        ],
      },
    });
    expect(await fetchMappingDomains('acme-mail')).toEqual([stopped]);
    expect(getMock).toHaveBeenCalledWith('/status');
  });

  it('answers none for a migration /status does not know', async () => {
    getMock.mockResolvedValue({ data: { status: 'ok', mappings: [] } });
    expect(await fetchMappingDomains('nope')).toEqual([]);
  });
});

describe('managed', () => {
  beforeEach(() => {
    edition.selfhost = false;
  });

  it('reads the migration’s own detail', async () => {
    getMock.mockResolvedValue({ data: { id: 'acme-mail', domainStatus: [stopped] } });
    expect(await fetchMappingDomains('acme-mail')).toEqual([stopped]);
    expect(getMock).toHaveBeenCalledWith('/migrations/acme-mail');
  });

  it('answers none when the detail carries no rows yet', async () => {
    getMock.mockResolvedValue({ data: { id: 'acme-mail' } });
    expect(await fetchMappingDomains('acme-mail')).toEqual([]);
  });
});
