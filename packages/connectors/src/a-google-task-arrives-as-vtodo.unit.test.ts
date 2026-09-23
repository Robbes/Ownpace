// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GOOGLE TASK ARRIVES AS VTODO.
 *
 * Workplan 0126 T1. Google's CalDAV carries no tasks, so the VTODO a target
 * receives is built here from the Tasks API's JSON: the mapping is the
 * connector, and this file is its specification. The shapes are the ones
 * Google's discovery document gives (revision 20260920); nothing here has met
 * a live account yet (T8).
 *
 * Each rule is one a person would notice broken: tasks they ticked off in
 * Google's app missing, a due date moved a day, a subtask loose from its
 * parent, the email a task was made from gone, an edit in Google that never
 * arrives, a deleted task nobody is told about. The owner took D1–D5 on
 * 2026-09-23, and each one is pinned below.
 */

import { describe, it, expect, vi } from 'vitest';
import type { OAuth2Token, TokenProvider } from '@openmig/shared';
import { naturalKeyForTask } from '@openmig/shared';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import {
  GoogleTasksSource,
  googleTaskAsCalendarItem,
  googleTaskSourcePath,
  googleTaskToIcalendar,
  googleTaskUid,
} from './google-tasks-source.ts';
import type { GoogleTask } from './google-tasks-source.types.ts';

const TOKEN: OAuth2Token = { accessToken: 'mock-access-token', tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000 };

function tokenProvider(): TokenProvider {
  return {
    getToken: vi.fn().mockResolvedValue(TOKEN),
    refresh: vi.fn().mockResolvedValue(TOKEN),
    isTokenValid: vi.fn().mockReturnValue(true),
    getTokenStatus: vi.fn().mockReturnValue({ isValid: true, timeUntilExpiry: 3600 }),
  };
}

/**
 * Answers BY URL, so a page asked for twice is a defect the test can see. A
 * route may hold a list of answers, handed out in turn (a refusal, then a page).
 */
function httpByUrl(routes: Record<string, unknown>) {
  const seen: HttpRequestOptions[] = [];
  const served = new Map<string, number>();
  const client: HttpClient = {
    request: vi.fn().mockImplementation((options: HttpRequestOptions) => {
      seen.push(options);
      if (!(options.url in routes)) {
        return Promise.resolve({ status: 404, body: `no route for ${options.url}`, headers: {} });
      }
      const route = routes[options.url];
      const n = served.get(options.url) ?? 0;
      served.set(options.url, n + 1);
      const answer = Array.isArray(route) ? route[Math.min(n, route.length - 1)] : route;
      if (answer && typeof answer === 'object' && 'status' in answer && typeof answer.status === 'number') {
        return Promise.resolve(answer as HttpResponse);
      }
      return Promise.resolve({ status: 200, body: JSON.stringify(answer), headers: {} });
    }),
  };
  return { client, seen };
}

const API = 'https://tasks.googleapis.com/tasks/v1';
const LISTS = `${API}/users/@me/lists?maxResults=1000`;
const EVERY = 'showCompleted=true&showHidden=true&showAssigned=true&showDeleted=true';
const TASKS = (list: string) => `${API}/lists/${list}/tasks?maxResults=100&${EVERY}`;
const LIST = { path: '/tasks/lists/L1', name: 'My Tasks' };

function source(client: HttpClient) {
  return new GoogleTasksSource(tokenProvider(), 'tenant-1', undefined, { httpClient: client });
}

/** RFC 5545 folding undone, so assertions read whole properties. */
const unfold = (ical: string) => ical.replace(/\r\n[ \t]/g, '');

const OPEN: GoogleTask = {
  id: 'dGFza09wZW4',
  etag: '"LTE2NjUwNjU2NjA"',
  title: 'Pay the invoice; the big one, today',
  notes: 'Ask for the\r\nreference first',
  status: 'needsAction',
  due: '2026-09-25T00:00:00.000Z',
  updated: '2026-09-21T08:30:00.000Z',
  position: '00000000000000000001',
};

/** Ticked off in Google's own app, then cleared from the list: `hidden`. */
const DONE_AND_CLEARED: GoogleTask = {
  id: 'dGFza0RvbmU',
  etag: '"MTAyMjQ5MzQ4Nw"',
  title: 'Renew the passport',
  status: 'completed',
  completed: '2026-09-20T10:15:00.000Z',
  updated: '2026-09-20T10:15:00.000Z',
  hidden: true,
};

describe('lists are folders that hold tasks', () => {
  it('lists every task list across pages, by URL, with the Bearer on every request', async () => {
    const { client, seen } = httpByUrl({
      [LISTS]: { items: [{ id: 'L1', title: 'My Tasks' }], nextPageToken: 'p2' },
      [`${LISTS}&pageToken=p2`]: { items: [{ id: 'L2', title: 'Groceries' }] },
    });
    const folders = await source(client).listFolders();

    expect(folders.map((f) => [f.path, f.name])).toEqual([
      ['/tasks/lists/L1', 'My Tasks'],
      ['/tasks/lists/L2', 'Groceries'],
    ]);
    expect(seen).toHaveLength(2);
    for (const r of seen) expect(r.headers?.Authorization).toBe('Bearer mock-access-token');
  });

  it('declares VTODO, so the target makes a task list and not a calendar', async () => {
    const { client } = httpByUrl({ [LISTS]: { items: [{ id: 'L1', title: 'My Tasks' }] } });
    const [folder] = await source(client).listFolders();
    expect(folder?.components).toEqual(['VTODO']);
  });
});

describe('the listing leaves out nothing of the person’s', () => {
  it('asks for completed, hidden, assigned and deleted tasks, 100 a page', async () => {
    // Without showHidden every task ticked off in Google's own apps is
    // missing (trap 1, D1); without showAssigned, every task assigned from Docs
    // or Chat (trap 2, D2); without showDeleted, every deletion (D5).
    const { client, seen } = httpByUrl({ [TASKS('L1')]: { items: [OPEN] } });
    await source(client).listSince(LIST);

    const asked = new URL(seen[0]!.url).searchParams;
    for (const flag of ['showCompleted', 'showHidden', 'showAssigned', 'showDeleted']) {
      expect(asked.get(flag), flag).toBe('true');
    }
    expect(asked.get('maxResults')).toBe('100');
  });

  it('carries a task completed and cleared in Google’s app', async () => {
    const { client } = httpByUrl({ [TASKS('L1')]: { items: [OPEN, DONE_AND_CLEARED] } });
    const { items } = await source(client).listSince(LIST);
    expect(items.map((i) => i.item.summary)).toEqual([
      'Pay the invoice; the big one, today',
      'Renew the passport',
    ]);
  });

  it('follows nextPageToken to the end, by URL, keeping the flags on every page', async () => {
    const { client, seen } = httpByUrl({
      [TASKS('L1')]: { items: [OPEN], nextPageToken: 'n/2' },
      [`${TASKS('L1')}&pageToken=n%2F2`]: { items: [DONE_AND_CLEARED] },
    });
    const { items } = await source(client).listSince(LIST);

    expect(items).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(new URL(seen[1]!.url).searchParams.get('showHidden')).toBe('true');
  });

  it('refuses a page token Google hands back twice, instead of paging forever', async () => {
    const { client } = httpByUrl({
      [TASKS('L1')]: { items: [OPEN], nextPageToken: 'again' },
      [`${TASKS('L1')}&pageToken=again`]: { items: [OPEN], nextPageToken: 'again' },
    });
    await expect(source(client).listSince(LIST)).rejects.toThrow(/same page token twice/);
  });

  it('marks its cursor as a full listing, not a position', async () => {
    const { client } = httpByUrl({ [TASKS('L1')]: { items: [] } });
    const { nextCursor } = await source(client).listSince(LIST);
    expect(nextCursor.value).toBe('full-listing:/tasks/lists/L1');
  });
});

describe('a task is a VTODO', () => {
  const ical = unfold(googleTaskToIcalendar(OPEN));

  it('is a VCALENDAR holding one VTODO, with CRLF line ends', () => {
    const raw = googleTaskToIcalendar(OPEN);
    expect(raw.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(raw).toContain('\r\nBEGIN:VTODO\r\n');
    expect(raw.endsWith('END:VTODO\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(raw).not.toMatch(/[^\r]\n/);
  });

  it('carries the title and notes with TEXT escaping', () => {
    expect(ical).toContain('SUMMARY:Pay the invoice\\; the big one\\, today\r\n');
    expect(ical).toContain('DESCRIPTION:Ask for the\\nreference first\r\n');
  });

  it('writes the due date as a DATE, the day Google wrote, and no time', () => {
    // Google keeps no time of day (trap 3). A DATE-TIME at UTC midnight would
    // read as the evening before anywhere west of Greenwich.
    expect(ical).toContain('DUE;VALUE=DATE:20260925\r\n');
    expect(ical).not.toMatch(/DUE:[0-9]/);
    expect(googleTaskAsCalendarItem(OPEN, 'L1').item.start).toBe('2026-09-25T00:00:00.000Z');
  });

  it('is NEEDS-ACTION while open, with no completion claimed', () => {
    expect(ical).toContain('STATUS:NEEDS-ACTION\r\n');
    expect(ical).not.toContain('PERCENT-COMPLETE');
    expect(ical).not.toContain('COMPLETED:');
  });

  it('a completed task is COMPLETED, with its UTC time and 100 percent (D1)', () => {
    const done = unfold(googleTaskToIcalendar(DONE_AND_CLEARED));
    expect(done).toContain('STATUS:COMPLETED\r\n');
    expect(done).toContain('PERCENT-COMPLETE:100\r\n');
    expect(done).toContain('COMPLETED:20260920T101500Z\r\n');
  });

  it('stamps it with its last change, and names an untitled one', () => {
    expect(ical).toContain('DTSTAMP:20260921T083000Z\r\n');
    expect(ical).toContain('LAST-MODIFIED:20260921T083000Z\r\n');
    const untitled = unfold(googleTaskToIcalendar({ id: 'x', title: '  ' }));
    expect(untitled).toContain('SUMMARY:Untitled task\r\n');
    expect(untitled).toContain('DTSTAMP:19700101T000000Z\r\n');
  });

  it('keeps Google’s id and its place among siblings, in properties no client shows', () => {
    expect(ical).toContain('X-GOOGLE-TASKS-ID:dGFza09wZW4\r\n');
    expect(ical).toContain('X-GOOGLE-TASKS-POSITION:00000000000000000001\r\n');
  });

  it('folds every line at 75 octets without splitting a character', () => {
    const raw = googleTaskToIcalendar({ id: 'long', title: 'é'.repeat(120) });
    for (const line of raw.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8'), `over 75 octets: ${line}`).toBeLessThanOrEqual(75);
    }
    expect(unfold(raw)).toContain(`SUMMARY:${'é'.repeat(120)}\r\n`);
  });
});

describe('a subtask stays under its parent', () => {
  it('names its parent’s own UID in RELATED-TO, which is how Nextcloud Tasks nests it', () => {
    const child: GoogleTask = { id: 'Y2hpbGQ', title: 'Find the reference', parent: OPEN.id };
    const parentUid = /\r\nUID:([^\r]+)\r\n/.exec(unfold(googleTaskToIcalendar(OPEN)))![1];

    expect(unfold(googleTaskToIcalendar(child))).toContain(`RELATED-TO;RELTYPE=PARENT:${parentUid}\r\n`);
    expect(googleTaskToIcalendar(OPEN)).not.toContain('RELATED-TO');
  });
});

describe('links and assignments become lines a person can read (D2, D3)', () => {
  it('puts the notes first, then one line per link', () => {
    const fromMail: GoogleTask = {
      id: 'bWFpbA',
      title: 'Answer the landlord',
      notes: 'Before Friday',
      links: [
        { type: 'email', description: 'Re: the lease', link: 'https://mail.google.com/mail/#all/abc' },
        { type: 'keep_note', description: '', link: 'https://keep.google.com/#NOTE/xyz' },
        { type: 'something_new', link: 'https://example.invalid/new' },
        { type: 'generic', description: 'nothing to open' },
      ],
    };
    expect(googleTaskAsCalendarItem(fromMail, 'L1').item.description).toBe(
      'Before Friday\n\n' +
        'Email: Re: the lease <https://mail.google.com/mail/#all/abc>\n' +
        'Keep note: https://keep.google.com/#NOTE/xyz\n' +
        'Link (something_new): https://example.invalid/new',
    );
  });

  it('says where an assigned task came from, with the link back', () => {
    const assigned: GoogleTask = {
      id: 'YXNzaWduZWQ',
      title: 'Review section 3',
      assignmentInfo: {
        surfaceType: 'DOCUMENT',
        linkToTask: 'https://docs.google.com/document/d/doc-1/edit?disco=task-1',
      },
    };
    const ical = unfold(googleTaskToIcalendar(assigned));
    expect(ical).toContain(
      'DESCRIPTION:Assigned to you in a Google Doc: https://docs.google.com/document/d/doc-1/edit?disco=task-1\r\n',
    );
  });
});

describe('a deletion is Google’s own statement (D5)', () => {
  it('is not an item, and names the path the live task was recorded under', async () => {
    const gone: GoogleTask = { ...DONE_AND_CLEARED, deleted: true };
    const { client } = httpByUrl({ [TASKS('L1')]: { items: [OPEN, gone] } });
    const { items, removed } = await source(client).listSince(LIST);

    expect(items.map((i) => i.item.summary)).toEqual(['Pay the invoice; the big one, today']);
    // The loop matches a removal to the ledger row that recorded this SAME
    // path when the task was copied. A different spelling would match nothing.
    const recordedWhenLive = googleTaskAsCalendarItem(DONE_AND_CLEARED, 'L1').item.sourcePath;
    expect(removed).toEqual([recordedWhenLive]);
    expect(recordedWhenLive).toBe(googleTaskSourcePath('L1', DONE_AND_CLEARED.id));
  });

  it('reports no removals when nothing was deleted', async () => {
    const { client } = httpByUrl({ [TASKS('L1')]: { items: [OPEN] } });
    const result = await source(client).listSince(LIST);
    expect(result.removed).toBeUndefined();
  });
});

describe('identity and version', () => {
  it('is versioned by Google’s etag, so an edit in Google reaches the copy (trap 5)', () => {
    expect(googleTaskAsCalendarItem(OPEN, 'L1').item.etag).toBe('"LTE2NjUwNjU2NjA"');
    const edited = googleTaskAsCalendarItem({ ...OPEN, etag: '"b3RoZXI"' }, 'L1');
    expect(edited.item.etag).not.toBe(googleTaskAsCalendarItem(OPEN, 'L1').item.etag);
  });

  it('falls back to the last change when Google gives no etag, never to nothing', () => {
    const { etag: _dropped, ...noEtag } = OPEN;
    expect(googleTaskAsCalendarItem(noEtag, 'L1').item.etag).toBe('2026-09-21T08:30:00.000Z');
  });

  it('keys two ids that differ only in case as two tasks (trap 6)', () => {
    // Google's ids are case-sensitive and the task key lowercases the UID.
    const a = googleTaskAsCalendarItem({ id: 'aBc', title: 'one' }, 'L1').item;
    const b = googleTaskAsCalendarItem({ id: 'AbC', title: 'two' }, 'L1').item;
    expect(naturalKeyForTask(a)).not.toBe(naturalKeyForTask(b));
  });

  it('gives a UID that is safe as the name the target writes it under', () => {
    // The target names the object `{uid}.ics`, unencoded.
    expect(googleTaskUid('a/b+c=?#')).toMatch(/^google-task-[0-9a-f]+$/);
    expect(googleTaskAsCalendarItem(OPEN, 'L1').item.uid).toBe(googleTaskUid(OPEN.id));
  });
});

describe('a refusal says what it is', () => {
  const googleError = (code: number, reason: string, message: string) =>
    JSON.stringify({ error: { code, message, errors: [{ message, domain: 'global', reason }] } });

  it('a grant without Tasks names the tick, in Google’s words and without the envelope', async () => {
    const { client } = httpByUrl({
      [LISTS]: {
        status: 403,
        body: googleError(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.'),
        headers: {},
      },
    });
    const failure = source(client).listFolders();
    await expect(failure).rejects.toThrow(
      'Failed to list Google Tasks lists (403): insufficientPermissions — Request had insufficient ' +
        'authentication scopes. — the Google grant this connection holds does not include Google Tasks. ' +
        'Reconnect the account with Tasks ticked.',
    );
  });

  it('a Tasks API the project never enabled is Google’s sentence alone, not a reconnect', async () => {
    const message =
      'Google Tasks API has not been used in project 123 before or it is disabled. Enable it by visiting ' +
      'https://console.developers.google.com/apis/api/tasks.googleapis.com/overview?project=123 then retry.';
    const { client } = httpByUrl({
      [LISTS]: { status: 403, body: googleError(403, 'accessNotConfigured', message), headers: {} },
    });
    const error = await source(client).listFolders().catch((e: Error) => e);
    expect(String(error)).toContain(`accessNotConfigured — ${message}`);
    expect(String(error)).not.toMatch(/[Rr]econnect/);
  });

  it('a sign-in Google no longer takes says to reconnect', async () => {
    const { client } = httpByUrl({
      [LISTS]: { status: 401, body: googleError(401, 'authError', 'Invalid Credentials'), headers: {} },
    });
    await expect(source(client).listFolders()).rejects.toThrow(/Reconnect the account\.$/);
  });
});

describe('a rate limit is waited out, not failed', () => {
  it('retries a 429 after Retry-After', async () => {
    const { client, seen } = httpByUrl({
      [LISTS]: [{ status: 429, body: '', headers: { 'retry-after': '0' } }, { items: [{ id: 'L1', title: 'My Tasks' }] }],
    });
    expect(await source(client).listFolders()).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });

  it('reads Google’s 403 rate limit as one, and does not blame the grant', async () => {
    const limited = {
      status: 403,
      body: JSON.stringify({
        error: {
          code: 403,
          message: 'Rate Limit Exceeded',
          errors: [{ message: 'Rate Limit Exceeded', domain: 'usageLimits', reason: 'userRateLimitExceeded' }],
        },
      }),
      headers: { 'retry-after': '0' },
    };
    const { client, seen } = httpByUrl({ [LISTS]: [limited, { items: [{ id: 'L1', title: 'My Tasks' }] }] });
    expect(await source(client).listFolders()).toHaveLength(1);
    expect(seen).toHaveLength(2);

    const twice = httpByUrl({ [LISTS]: [limited, limited] });
    const error = await source(twice.client).listFolders().catch((e: Error) => e);
    expect(String(error)).toContain('userRateLimitExceeded — Rate Limit Exceeded');
    expect(String(error)).not.toMatch(/[Rr]econnect/);
  });
});
