// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * An End or a Keep copying of one data type, sent where each edition's door
 * is, and its choices read from each edition's payload (workplan 0128 T3,
 * T5 slice 7b).
 *
 * The press is one call on both editions, under the mapping's own path:
 * `/mappings/{id}` on the appliance, `/migrations/{id}` on managed. Pinned in
 * both, because a press that reached the door in one and a 404 in the other
 * would be a button that works on the edition its author looked at. A refusal
 * keeps the door's own sentence and whether force goes over it; anything else
 * stays a plain failure, which never offers the force. And the choices are
 * read from each edition's payload, where a press the page has no button for
 * drops rather than failing the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMock, postMock, edition } = vi.hoisted(() => ({
  getMock: vi.fn(),
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
        get: getMock,
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

import { endOrKeepDataType, fetchMappingDataTypes, PathEndingRefusedError } from './operating-service.ts';
import { MappingSchema } from './mapping-service.ts';

const refusal = (data: Record<string, unknown>, status = 409) =>
  Object.assign(new Error('Request failed'), { response: { status, data } });

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  postMock.mockResolvedValue({ data: { id: 'm-1', domain: 'email', ending: 'end', changed: true } });
});

describe('the press, on each edition', () => {
  it('reaches the appliance’s door under /mappings', async () => {
    edition.selfhost = true;
    await endOrKeepDataType('m-1', 'calendar', 'keep');
    expect(postMock).toHaveBeenCalledWith('/mappings/m-1/domains/calendar/keep');
  });

  it('reaches managed’s door under /migrations, and asks the force of End only', async () => {
    edition.selfhost = false;
    expect(await endOrKeepDataType('m-1', 'email', 'end')).toMatchObject({ changed: true });
    expect(postMock).toHaveBeenLastCalledWith('/migrations/m-1/domains/email/end');
    await endOrKeepDataType('m-1', 'email', 'end', true);
    expect(postMock).toHaveBeenLastCalledWith('/migrations/m-1/domains/email/end?force=true');
    await endOrKeepDataType('m-1', 'email', 'keep', true);
    expect(postMock).toHaveBeenLastCalledWith('/migrations/m-1/domains/email/keep');
  });
});

describe('a refusal, told from a failure', () => {
  it('keeps the door’s sentence, and that force goes over open failures', async () => {
    postMock.mockRejectedValue(
      refusal({
        error: 'end_refused',
        refused: 'unresolved_failures',
        count: 2,
        message: '2 item(s) of email could not be migrated and are awaiting a decision.',
        forceable: true,
      }),
    );
    const err = await endOrKeepDataType('m-1', 'email', 'end').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PathEndingRefusedError);
    expect((err as PathEndingRefusedError).refusal).toEqual({
      error: 'end_refused',
      refused: 'unresolved_failures',
      message: '2 item(s) of email could not be migrated and are awaiting a decision.',
      forceable: true,
      count: 2,
    });
  });

  it('a refusal force cannot satisfy says so by leaving it out', async () => {
    postMock.mockRejectedValue(refusal({ error: 'keep_refused', refused: 'stopped', message: 'email is stopped.' }));
    const err = (await endOrKeepDataType('m-1', 'email', 'keep').catch((e: unknown) => e)) as PathEndingRefusedError;
    expect(err.refusal).toEqual({ error: 'keep_refused', refused: 'stopped', message: 'email is stopped.' });
  });

  it('anything else stays the error it was, never a refusal', async () => {
    const down = refusal({ error: 'Internal' }, 500);
    postMock.mockRejectedValue(down);
    expect(await endOrKeepDataType('m-1', 'email', 'end').catch((e: unknown) => e)).toBe(down);
    const other = refusal({ error: 'Not found' }, 409);
    postMock.mockRejectedValue(other);
    expect(await endOrKeepDataType('m-1', 'email', 'end').catch((e: unknown) => e)).toBe(other);
  });
});

describe('the choices, from each edition’s payload', () => {
  const endings = [
    { domain: 'email', phase: 'active', stopped: false, offers: ['end', 'keep'] },
    { domain: 'file', phase: 'continuous', stopped: false, offers: ['end', 'something_new'] },
  ];
  const read = [
    endings[0],
    { domain: 'file', phase: 'continuous', stopped: false, offers: ['end'] },
  ];

  it('reads the appliance’s /status, this migration’s own', async () => {
    edition.selfhost = true;
    getMock.mockResolvedValue({
      data: {
        status: 'ok',
        mappings: [
          { mappingId: 'someone-else', migrationStatus: 'active', domains: [], endings: [] },
          { mappingId: 'acme-mail', migrationStatus: 'active', domains: [], endings },
        ],
      },
    });
    expect(await fetchMappingDataTypes('acme-mail')).toEqual({ domains: [], endings: read });
    expect(getMock).toHaveBeenCalledWith('/status');
  });

  it('reads managed’s detail, and none from a payload that predates them', async () => {
    edition.selfhost = false;
    getMock.mockResolvedValue({ data: { id: 'acme-mail', domainStatus: [], endingChoices: endings } });
    expect(await fetchMappingDataTypes('acme-mail')).toEqual({ domains: [], endings: read });
    expect(getMock).toHaveBeenCalledWith('/migrations/acme-mail');
    getMock.mockResolvedValue({ data: { id: 'acme-mail', domainStatus: [] } });
    expect(await fetchMappingDataTypes('acme-mail')).toEqual({ domains: [] });
  });

  it('keeps when a grace period ended, which the page says (0128 D7)', async () => {
    edition.selfhost = false;
    const ended = { domain: 'email', phase: 'cutover', stopped: false, offers: ['end', 'keep'], graceEndedAt: '2026-09-23T10:00:00.000Z' };
    getMock.mockResolvedValue({ data: { id: 'acme-mail', domainStatus: [], endingChoices: [ended] } });
    expect((await fetchMappingDataTypes('acme-mail')).endings).toEqual([ended]);
  });

  it('keeps them on managed’s detail schema, which strips what it does not name', () => {
    const detail = {
      id: 'm-1',
      tenantId: 't-1',
      name: 'Acme',
      sourceType: 'imap',
      targetType: 'jmap',
      sourceConfig: {},
      targetConfig: {},
      syncConfig: { domains: ['email', 'file'] },
      status: 'active',
      mode: 'mirror',
      domainStatus: [],
      endingChoices: endings,
      createdAt: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-26T00:00:00.000Z',
    };
    expect(MappingSchema.parse(detail).endingChoices).toEqual(read);
    const { endingChoices: _none, ...older } = detail;
    expect(MappingSchema.parse(older).endingChoices).toBeUndefined();
  });
});
