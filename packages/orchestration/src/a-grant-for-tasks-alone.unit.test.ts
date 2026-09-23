// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT FOR TASKS ALONE (workplan 0126 T3, 2026-09-23).
 *
 * The connection Test of a Google account listed its CALENDAR face, always.
 * That was harmless while every Google grant carried the calendar. Since T2 a
 * person can tick Tasks alone, and Google then grants `tasks.readonly` and
 * nothing else: the Test asked for a calendar nobody had granted, Google
 * refused, and a connection whose preflight and pass would both work read as
 * broken.
 *
 * Now the Test reads the grant first and lists the first face it carries,
 * calendar first (Microsoft's shape, `probeMicrosoftAccount`). A grant it
 * cannot read keeps the old headline, so those answers do not change.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { probeSourceConnection } from './probe-connection.ts';
import { GOOGLE_ACCOUNT_CONNECTION_KIND } from './google-dav-source-factory.ts';

const CREDS = { clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' };
const ROW = { user: 'someone@example.com' };
const TASKS = 'https://www.googleapis.com/auth/tasks.readonly';
const CALENDAR = 'https://www.googleapis.com/auth/calendar';
const CARDDAV = 'https://www.googleapis.com/auth/carddav';

afterEach(() => {
  vi.unstubAllGlobals();
});

const grantOf = (scope: string) =>
  vi.fn(async () =>
    new Response(JSON.stringify({ access_token: 'at', scope }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

/** Probe the account, recording which face the Test chose to list. */
async function probe(creds: Record<string, string> = CREDS) {
  const asked: string[] = [];
  const result = await probeSourceConnection(GOOGLE_ACCOUNT_CONNECTION_KIND, ROW, creds, {
    googleTokenEndpoint: 'https://stub/token',
    googleFaceSource: (face) => {
      asked.push(face);
      return { listFolders: async () => [1, 2, 3] };
    },
  });
  return { asked, result };
}

describe("the Test lists a face the grant carries", () => {
  it('tests a grant for Tasks alone on its task lists, not on a calendar nobody granted', async () => {
    vi.stubGlobal('fetch', grantOf(TASKS));
    const { asked, result } = await probe();
    expect(asked).toEqual(['task']);
    expect(result).toMatchObject({ ok: true, outcome: { code: 'connected', count: 3, unit: 'taskList' } });
  });

  it('keeps the calendar as the headline whenever the grant carries it', async () => {
    vi.stubGlobal('fetch', grantOf(`${TASKS} ${CALENDAR}`));
    const { asked, result } = await probe();
    expect(asked).toEqual(['calendar']);
    expect(result).toMatchObject({ outcome: { unit: 'calendar' } });
  });

  it('takes the faces in order after the calendar: contacts before tasks', async () => {
    vi.stubGlobal('fetch', grantOf(`${TASKS} ${CARDDAV}`));
    expect((await probe()).asked).toEqual(['contact']);
  });

  it('counts a broader scope as carried, as the qualification does', async () => {
    // Read-write Tasks, granted elsewhere, satisfies the read-only face.
    vi.stubGlobal('fetch', grantOf('https://www.googleapis.com/auth/tasks'));
    expect((await probe()).asked).toEqual(['task']);
  });
});

describe('a grant it cannot read keeps the answer it always had', () => {
  it('a refused exchange falls to the calendar, whose builder refuses in its own words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })));
    expect((await probe()).asked).toEqual(['calendar']);
  });

  it('domain-wide delegation has no grant to read: no exchange, and the calendar', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { asked } = await probe({ serviceAccountKey: '{"type":"service_account"}' });
    expect(asked).toEqual(['calendar']);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
