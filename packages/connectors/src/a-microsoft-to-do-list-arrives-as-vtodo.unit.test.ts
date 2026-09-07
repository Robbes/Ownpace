// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MICROSOFT TO DO LIST ARRIVES AS VTODO.
 *
 * Workplan 0114 T9. Graph offers no iCalendar for tasks, so the VTODO a target
 * receives is built here from To Do's JSON — which makes the mapping the whole
 * connector, and this file its specification. Each rule below is one a person
 * would notice broken on the far side: a task marked done that arrives open, a
 * due date that slid a day across a zone, a checklist that vanished, a
 * fortnightly reminder that became a weekly one.
 *
 * The other half is the seam: lists are folders, tasks are calendar items
 * keyed by Graph's own id and versioned by their last change, paging follows
 * `@odata.nextLink` by URL (the sibling sources once re-fetched page one
 * forever because their mock answered by call order), the cursor is a marker,
 * and a 403 names the scope that is usually missing.
 */

import { describe, it, expect, vi } from 'vitest';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import type { OAuth2Token, TokenProvider } from '@openmig/shared';
import { naturalKeyForTask } from '@openmig/shared';
import {
  GraphTodoSource,
  fold,
  recurrenceToRrule,
  todoToIcalendar,
} from './graph-todo-source.ts';
import type { GraphTodoTask } from './graph-todo-source.types.ts';

const TOKEN: OAuth2Token = { accessToken: 'mock-access-token', tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000 };

function tokenProvider(): TokenProvider {
  return {
    getToken: vi.fn().mockResolvedValue(TOKEN),
    refresh: vi.fn().mockResolvedValue(TOKEN),
    isTokenValid: vi.fn().mockReturnValue(true),
    getTokenStatus: vi.fn().mockReturnValue({ isValid: true, timeUntilExpiry: 3600 }),
  };
}

/** Answers BY URL, so a page requested twice is a defect the test can see. */
function httpByUrl(routes: Record<string, unknown | HttpResponse>) {
  const seen: HttpRequestOptions[] = [];
  const client: HttpClient = {
    request: vi.fn().mockImplementation((options: HttpRequestOptions) => {
      seen.push(options);
      const hit = Object.entries(routes).find(([url]) => options.url === url);
      if (!hit) {
        return Promise.resolve({ status: 404, body: `no route for ${options.url}`, headers: {} });
      }
      const answer = hit[1] as HttpResponse | Record<string, unknown>;
      if ('status' in answer && typeof answer.status === 'number') return Promise.resolve(answer as HttpResponse);
      return Promise.resolve({ status: 200, body: JSON.stringify(answer), headers: {} });
    }),
  };
  return { client, seen };
}

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TASKS = (list: string) => `${GRAPH}/me/todo/lists/${list}/tasks?$top=100&$expand=checklistItems`;

const GROCERIES: GraphTodoTask = {
  id: 'T1',
  title: 'Buy milk; and eggs, today',
  status: 'inProgress',
  importance: 'high',
  body: { contentType: 'html', content: '<p>Get <b>whole</b> milk<br>and eggs &amp; bread</p>' },
  createdDateTime: '2026-09-01T10:00:00Z',
  lastModifiedDateTime: '2026-09-02T11:30:00.1234567Z',
  dueDateTime: { dateTime: '2026-09-10T00:00:00.0000000', timeZone: 'Europe/Amsterdam' },
  startDateTime: { dateTime: '2026-09-08T00:00:00.0000000', timeZone: 'Europe/Amsterdam' },
  categories: ['Home', 'Errands'],
  isReminderOn: true,
  reminderDateTime: { dateTime: '2026-09-09T08:00:00.0000000', timeZone: 'UTC' },
  checklistItems: [
    { id: 'c1', displayName: 'milk', isChecked: true },
    { id: 'c2', displayName: 'eggs', isChecked: false },
  ],
};

const DONE: GraphTodoTask = {
  id: 'T2',
  status: 'completed',
  completedDateTime: { dateTime: '2026-09-04T13:22:10.0000000', timeZone: 'UTC' },
  createdDateTime: '2026-08-30T09:00:00Z',
  lastModifiedDateTime: '2026-09-04T13:22:10Z',
};

const FORTNIGHTLY: GraphTodoTask = {
  id: 'T3',
  title: 'Water the plants',
  status: 'waitingOnOthers',
  importance: 'low',
  lastModifiedDateTime: '2026-09-03T08:00:00Z',
  recurrence: {
    pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday', 'thursday'], firstDayOfWeek: 'monday' },
    range: { type: 'endDate', startDate: '2026-09-07', endDate: '2026-12-31' },
  },
};

/** RFC 5545 folding undone, so assertions read whole properties. */
const unfold = (ical: string) => ical.replace(/\r\n[ \t]/g, '');

describe('lists are folders', () => {
  it('lists every To Do list across pages, by URL, with the Bearer on every request', async () => {
    const { client, seen } = httpByUrl({
      [`${GRAPH}/me/todo/lists`]: {
        value: [{ id: 'L1', displayName: 'Groceries', wellknownListName: 'none' }],
        '@odata.nextLink': `${GRAPH}/me/todo/lists?$skiptoken=page2`,
      },
      [`${GRAPH}/me/todo/lists?$skiptoken=page2`]: {
        value: [{ id: 'L2', displayName: 'Tasks', wellknownListName: 'defaultList' }],
      },
    });
    const source = new GraphTodoSource(tokenProvider(), 'tenant-1', undefined, { httpClient: client });
    const folders = await source.listFolders();
    expect(folders.map((f) => [f.path, f.name])).toEqual([
      ['/todo/lists/L1', 'Groceries'],
      ['/todo/lists/L2', 'Tasks'],
    ]);
    expect(seen).toHaveLength(2);
    for (const r of seen) expect(r.headers?.Authorization).toBe('Bearer mock-access-token');
  });
});

describe('a task is a VTODO', () => {
  const ical = unfold(todoToIcalendar(GROCERIES, 'Groceries'));

  it('is a VCALENDAR holding one VTODO, with CRLF line ends', () => {
    const raw = todoToIcalendar(GROCERIES, 'Groceries');
    expect(raw.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(raw.endsWith('END:VTODO\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(raw).not.toMatch(/[^\r]\n/);
  });

  it("keys on Graph's id and carries the title with TEXT escaping", () => {
    expect(ical).toContain('UID:T1\r\n');
    // `\;` and `\,` on the wire (RFC 5545 §3.3.11): a target that did not
    // get them would read one title as a property with a parameter.
    expect(ical).toContain('SUMMARY:Buy milk\\; and eggs\\, today\r\n');
  });

  it('maps status and importance, keeping the original word beside the lossy mapping', () => {
    expect(ical).toContain('STATUS:IN-PROCESS\r\n');
    expect(ical).toContain('X-MICROSOFT-TODO-STATUS:inProgress\r\n');
    expect(ical).toContain('PRIORITY:1\r\n');
    expect(ical).toContain('X-MICROSOFT-TODO-IMPORTANCE:high\r\n');
    expect(ical).not.toContain('PERCENT-COMPLETE');
  });

  it('writes due and start as calendar DATES — the day the person picked, in any zone', () => {
    // A midnight in Europe/Amsterdam is the evening before in UTC; a target
    // reading a DATE-TIME would have moved the task a day. A DATE cannot slide.
    expect(ical).toContain('DUE;VALUE=DATE:20260910\r\n');
    expect(ical).toContain('DTSTART;VALUE=DATE:20260908\r\n');
  });

  it('turns an HTML body and the checklist into one plain DESCRIPTION', () => {
    expect(ical).toContain(
      'DESCRIPTION:Get whole milk\\nand eggs & bread\\n\\n[x] milk\\n[ ] eggs\r\n',
    );
  });

  it('carries categories, timestamps, the reminder and the list it came from', () => {
    expect(ical).toContain('CATEGORIES:Home,Errands\r\n');
    expect(ical).toContain('CREATED:20260901T100000Z\r\n');
    expect(ical).toContain('LAST-MODIFIED:20260902T113000Z\r\n');
    expect(ical).toContain('DTSTAMP:20260902T113000Z\r\n');
    expect(ical).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20260909T080000Z\r\n');
    expect(ical).toContain('X-MICROSOFT-TODO-LIST:Groceries\r\n');
  });

  it('a completed task is COMPLETED with its UTC time and 100 percent, and an untitled one is named', () => {
    const done = unfold(todoToIcalendar(DONE));
    expect(done).toContain('STATUS:COMPLETED\r\n');
    expect(done).toContain('PERCENT-COMPLETE:100\r\n');
    expect(done).toContain('COMPLETED:20260904T132210Z\r\n');
    expect(done).toContain('SUMMARY:Untitled task\r\n');
    // No importance from Graph reads as normal, which RFC 5545 calls 5.
    expect(done).toContain('PRIORITY:5\r\n');
  });

  it('a recurring task carries its RRULE and anchors DTSTART on the range', () => {
    const plants = unfold(todoToIcalendar(FORTNIGHTLY));
    expect(plants).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=MO;UNTIL=20261231\r\n');
    expect(plants).toContain('DTSTART;VALUE=DATE:20260907\r\n');
    // Not done and not in progress: NEEDS-ACTION, with the real word kept.
    expect(plants).toContain('STATUS:NEEDS-ACTION\r\n');
    expect(plants).toContain('X-MICROSOFT-TODO-STATUS:waitingOnOthers\r\n');
    expect(plants).toContain('PRIORITY:9\r\n');
  });

  it('folds every line at 75 octets without splitting a character, and unfolds back to the title', () => {
    const long = 'é'.repeat(120);
    const raw = todoToIcalendar({ id: 'T9', title: long, lastModifiedDateTime: '2026-09-03T08:00:00Z' });
    for (const line of raw.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8'), `over 75 octets: ${line}`).toBeLessThanOrEqual(75);
    }
    expect(unfold(raw)).toContain(`SUMMARY:${long}\r\n`);
    expect(fold('short')).toBe('short');
  });
});

describe("Graph's recurrence as an RRULE", () => {
  it('covers every pattern Graph publishes, and declines the ones it does not know', () => {
    expect(recurrenceToRrule({ type: 'daily', interval: 1 }, { type: 'noEnd' })).toBe('FREQ=DAILY');
    expect(recurrenceToRrule({ type: 'daily', interval: 3 }, { type: 'numbered', numberOfOccurrences: 10 })).toBe(
      'FREQ=DAILY;INTERVAL=3;COUNT=10',
    );
    expect(
      recurrenceToRrule({ type: 'relativeMonthly', interval: 1, daysOfWeek: ['friday'], index: 'last' }, undefined),
    ).toBe('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1');
    expect(recurrenceToRrule({ type: 'absoluteMonthly', interval: 1, dayOfMonth: 15 }, undefined)).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=15',
    );
    expect(
      recurrenceToRrule({ type: 'absoluteYearly', interval: 1, month: 3, dayOfMonth: 15 }, { type: 'numbered', numberOfOccurrences: 5 }),
    ).toBe('FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15;COUNT=5');
    expect(
      recurrenceToRrule({ type: 'relativeYearly', interval: 1, month: 11, daysOfWeek: ['thursday'], index: 'fourth' }, undefined),
    ).toBe('FREQ=YEARLY;BYMONTH=11;BYDAY=TH;BYSETPOS=4');
    expect(recurrenceToRrule({ type: 'lunar' as never, interval: 1 }, undefined)).toBeUndefined();
    expect(recurrenceToRrule(undefined, undefined)).toBeUndefined();
  });
});

describe('tasks are calendar items the task pass can key and version', () => {
  const folder = { path: '/todo/lists/L1', name: 'Groceries' };

  it('lists every task across pages, keyed by id, versioned by last change, typed as a todo', async () => {
    const { client } = httpByUrl({
      [TASKS('L1')]: { value: [GROCERIES, DONE], '@odata.nextLink': `${GRAPH}/me/todo/lists/L1/tasks?$skiptoken=p2` },
      [`${GRAPH}/me/todo/lists/L1/tasks?$skiptoken=p2`]: { value: [FORTNIGHTLY] },
    });
    const source = new GraphTodoSource(tokenProvider(), 'tenant-1', undefined, { httpClient: client });
    const { items, nextCursor } = await source.listSince(folder);
    expect(items.map((i) => i.item.uid)).toEqual(['T1', 'T2', 'T3']);
    const [first] = items;
    expect(first!.item.type).toBe('todo');
    expect(first!.item.summary).toBe('Buy milk; and eggs, today');
    expect(first!.item.etag).toBe('2026-09-02T11:30:00.1234567Z');
    expect(first!.item.sourcePath).toBe('/todo/lists/L1/tasks/T1');
    // Stable: the start date the person set, not "now".
    expect(first!.item.start).toBe('2026-09-08T00:00:00.000Z');
    expect(first!.icalendar).toBe(first!.item.icalendar);
    // The natural key the task pass uses tells the three apart and is stable.
    const keys = items.map((i) => naturalKeyForTask(i.item));
    expect(new Set(keys).size).toBe(3);
    expect(naturalKeyForTask(items[0]!.item)).toBe(keys[0]);
    expect(nextCursor.value.startsWith('full-listing:')).toBe(true);
  });

  it('ignores a cursor — every pass lists everything', async () => {
    const { client, seen } = httpByUrl({ [TASKS('L1')]: { value: [DONE] } });
    const source = new GraphTodoSource(tokenProvider(), 'tenant-1', undefined, { httpClient: client });
    const first = await source.listSince(folder);
    const again = await source.listSince(folder, first.nextCursor);
    expect(again.items.map((i) => i.item.uid)).toEqual(['T2']);
    expect(seen.map((r) => r.url)).toEqual([TASKS('L1'), TASKS('L1')]);
  });

  it('names Tasks.Read when Graph answers 403 — the consent without the tasks face ticked', async () => {
    const { client } = httpByUrl({
      [`${GRAPH}/me/todo/lists`]: { status: 403, body: '{"error":{"code":"ErrorAccessDenied"}}', headers: {} },
    });
    const source = new GraphTodoSource(tokenProvider(), 'tenant-1', undefined, { httpClient: client });
    await expect(source.listFolders()).rejects.toThrow(/403.*Tasks\.Read/s);
  });

  it('reads another mailbox’s lists under /users/{address} when told to', async () => {
    const { client, seen } = httpByUrl({
      [`${GRAPH}/users/shared%40contoso.example/todo/lists`]: { value: [] },
    });
    const source = new GraphTodoSource(
      tokenProvider(),
      'tenant-1',
      { mailbox: 'shared@contoso.example' },
      { httpClient: client },
    );
    await source.listFolders();
    expect(seen[0]!.url).toBe(`${GRAPH}/users/shared%40contoso.example/todo/lists`);
  });
});
