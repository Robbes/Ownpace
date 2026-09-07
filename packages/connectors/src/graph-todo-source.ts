// Copyright 2026 The Ownpace authors (Apache-2.0)

import { graphFailure } from './graph-refusal.ts';
import type { CalendarSource, CalendarFolder, RawCalendarEvent, SyncCursor } from '@openmig/shared';
import type { ThrottleLimiter, TokenProvider } from '@openmig/shared';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import { graphScopePrefix } from './graph-scope.ts';
import type {
  GraphChecklistItem,
  GraphDateTimeTimeZone,
  GraphRecurrencePattern,
  GraphRecurrenceRange,
  GraphTodoList,
  GraphTodoTask,
} from './graph-todo-source.types.ts';

/** The tick and the delegated scope this face needs — named in a refusal's way forward (0114 T6). */
const TASKS_FACE = { face: 'Tasks', scope: 'Tasks.Read' } as const;

/**
 * MICROSOFT TO DO AS A TASK SOURCE (workplan 0114 T9).
 *
 * Microsoft has a tasks face and Google does not: Graph serves To Do at
 * `/me/todo/lists` under `Tasks.Read`, while Google's CalDAV carries no VTODO
 * at any scope tier (0113 T5/T6). A To Do list is not a CalDAV collection,
 * though, so the four `graph-*-source` connectors that cover mail, calendar,
 * contacts and OneDrive could not be pointed at it — this is the fifth.
 *
 * ## The shape it answers in
 *
 * `CalendarSource`, because that is what the task domain reads: a task is a
 * calendar object on the wire (0113), `runTaskSync` is the calendar pass with
 * one key rule changed, and every task target this product has is CalDAV
 * expecting `VTODO`. So each To Do list is a "calendar folder" and each task
 * is a `RawCalendarEvent` whose `icalendar` is a VTODO this file builds from
 * Graph's JSON — Graph offers no iCalendar for tasks, unlike events.
 *
 * ## What is carried, and how
 *
 * Title, body, status, importance, due date, start date, completion time,
 * categories, the checklist and the recurrence — each mapped to the RFC 5545
 * property that means the same thing, with Graph's own value kept beside it
 * in an `X-MICROSOFT-TODO-*` property where the mapping is lossy (five
 * statuses onto three). What has no VTODO equivalent — a checklist — goes
 * into DESCRIPTION as plain lines, so nothing is silently dropped and a person
 * finds it where they would look.
 *
 * ## Full listing, no delta
 *
 * Every pass lists every task in a list. Graph does publish a delta for tasks,
 * but a To Do list is small — hundreds of items, not hundreds of thousands —
 * and a listing that is complete every time is what lets the loop's cursorless
 * semantics hold without a second code path nobody can exercise from CI. The
 * cursor returned is a marker, not a position.
 */

/** More pages than any To Do list produces. A guard against a paging loop, not a limit. */
const MAX_PAGES = 10_000;

/** Tasks per page; Graph's maximum for this resource. */
const PAGE_SIZE = 100;

/** RFC 5545 §3.1: content lines are folded at 75 octets. */
const FOLD_AT = 75;

export class GraphTodoSource implements CalendarSource {
  private readonly tokenProvider: TokenProvider;
  private readonly httpClient: HttpClient;
  private readonly baseUrl: string;
  private readonly tenantId: string;
  private readonly throttleLimiter?: ThrottleLimiter;
  /** `{baseUrl}/me` or `{baseUrl}/users/{address}` — see graph-scope.ts. */
  private readonly scope: string;
  private readonly provider: string;

  constructor(
    tokenProvider: TokenProvider,
    tenantId: string,
    options?: { baseUrl?: string; throttleLimiter?: ThrottleLimiter; mailbox?: string },
    deps?: { httpClient?: HttpClient },
  ) {
    this.tokenProvider = tokenProvider;
    this.tenantId = tenantId;
    this.baseUrl = options?.baseUrl?.replace(/\/$/, '') ?? 'https://graph.microsoft.com/v1.0';
    this.httpClient = deps?.httpClient ?? createDefaultHttpClient();
    this.throttleLimiter = options?.throttleLimiter;
    this.provider = hostnameOf(this.baseUrl);
    this.scope = graphScopePrefix(this.baseUrl, options?.mailbox);
  }

  /** Every To Do list, as a calendar folder at `/todo/lists/{id}`. */
  async listFolders(): Promise<ReadonlyArray<CalendarFolder>> {
    const lists = await this.collect<GraphTodoList>(`${this.scope}/todo/lists`, 'To Do lists');
    return lists.map((list) => ({
      path: `/todo/lists/${list.id}`,
      name: list.displayName,
      description: undefined,
      timezone: undefined,
    }));
  }

  /** Every task in the list, as a VTODO. The cursor is ignored — see the header. */
  async listSince(
    folder: CalendarFolder,
    _cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<RawCalendarEvent>; nextCursor: SyncCursor }> {
    const listId = listIdOf(folder);
    const tasks = await this.collect<GraphTodoTask>(
      `${this.scope}/todo/lists/${listId}/tasks?$top=${PAGE_SIZE}&$expand=checklistItems`,
      `tasks in To Do list ${listId}`,
    );
    const items = tasks.map((task) => todoAsCalendarItem(task, listId, folder.name));
    return { items, nextCursor: { value: `full-listing:${folder.path}` } };
  }

  /** Follow `@odata.nextLink` to the end, refusing to loop forever. */
  private async collect<T>(firstUrl: string, what: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = firstUrl;
    let hops = 0;
    while (next) {
      if (++hops > MAX_PAGES) {
        throw new Error(`Listing ${what} passed ${MAX_PAGES} pages — refusing to keep requesting.`);
      }
      const response = await this.makeRequest({
        url: next,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (response.status !== 200) {
        // A 403 is the common failure and it has one usual cause worth naming:
        // the consent this connection carries was granted without the tasks
        // face ticked, so the token has no Tasks.Read. `graphFailure` says so,
        // in the same words every Graph face uses (0114 T6).
        throw new Error(graphFailure(`Failed to list ${what}`, response, TASKS_FACE));
      }
      const page = JSON.parse(response.body) as { value: T[]; '@odata.nextLink'?: string };
      out.push(...page.value);
      next = page['@odata.nextLink'];
    }
    return out;
  }

  /** The sibling sources' request idiom: a Bearer token, and 429/503 honoured. */
  private async makeRequest(options: HttpRequestOptions): Promise<HttpResponse> {
    const token = await this.tokenProvider.getToken();
    const send = () =>
      this.httpClient.request({
        ...options,
        headers: { Authorization: `Bearer ${token.accessToken}`, ...options.headers },
      });

    if (this.throttleLimiter) {
      const limiter = this.throttleLimiter;
      return limiter.executeWithThrottling(this.tenantId, this.provider, async () => {
        const response = await send();
        if (response.status === 429 || response.status === 503) {
          const retryAfter = response.headers['retry-after'] as string | undefined;
          const waitTime = limiter.handleRateLimited(response.status, retryAfter);
          return { ...response, _retryAfterMs: waitTime };
        }
        return response;
      });
    }
    const response = await send();
    if (response.status === 429 || response.status === 503) {
      const retryAfter = response.headers['retry-after'] as string | undefined;
      const seconds = Number(retryAfter);
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(seconds) ? seconds * 1000 : 1000));
      return send();
    }
    return response;
  }
}

function listIdOf(folder: CalendarFolder): string {
  const m = /^\/todo\/lists\/(.+)$/.exec(folder.path);
  if (!m?.[1]) throw new Error(`Not a To Do list path: ${folder.path}`);
  return m[1];
}

function hostnameOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Graph JSON → VTODO
// ---------------------------------------------------------------------------

/** The task as the sync loop sees it: keyed by Graph's id, versioned by its last change. */
export function todoAsCalendarItem(task: GraphTodoTask, listId: string, listName?: string): RawCalendarEvent {
  const icalendar = todoToIcalendar(task, listName);
  const start =
    (task.startDateTime && isoOfDate(task.startDateTime)) ??
    (task.dueDateTime && isoOfDate(task.dueDateTime)) ??
    task.createdDateTime ??
    task.lastModifiedDateTime ??
    // Stable, so a re-listing of an undated task is byte-identical to the last.
    new Date(0).toISOString();
  return {
    item: {
      // Graph's id, verbatim: opaque, stable per task, case-sensitive. Not
      // lowercased the way the CalDAV source normalises UIDs, because it is
      // not a UID somebody typed — it is the provider's own key.
      uid: task.id,
      type: 'todo',
      summary: task.title?.trim() || 'Untitled task',
      start,
      ...(task.body?.content ? { description: bodyText(task.body.content, task.body.contentType) } : {}),
      // What the loop's `sourceVersion` reads: a task that changed lists as a
      // new version, one that did not is skipped without a write.
      ...(task.lastModifiedDateTime ? { etag: task.lastModifiedDateTime } : {}),
      sourcePath: `/todo/lists/${listId}/tasks/${task.id}`,
      icalendar,
    },
    icalendar,
  };
}

/**
 * One task as an RFC 5545 VTODO, wrapped in its VCALENDAR.
 *
 * Exported because the mapping IS the connector: a target receives exactly
 * these lines, and the test that pins them is the specification.
 */
export function todoToIcalendar(task: GraphTodoTask, listName?: string): string {
  const stamp = utcStamp(task.lastModifiedDateTime ?? task.createdDateTime) ?? utcStamp(new Date(0).toISOString())!;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ownpace//Microsoft To Do//EN',
    'BEGIN:VTODO',
    `UID:${escapeText(task.id)}`,
    `DTSTAMP:${stamp}`,
  ];
  const created = utcStamp(task.createdDateTime);
  if (created) lines.push(`CREATED:${created}`);
  const modified = utcStamp(task.lastModifiedDateTime);
  if (modified) lines.push(`LAST-MODIFIED:${modified}`);
  lines.push(`SUMMARY:${escapeText(task.title?.trim() || 'Untitled task')}`);

  const description = descriptionOf(task);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);

  // Five statuses onto three (RFC 5545 §3.8.1.11). `waitingOnOthers` and
  // `deferred` are not done and not in progress, so they read as NEEDS-ACTION
  // — and the original word rides along, because the mapping is lossy.
  const status = task.status ?? 'notStarted';
  lines.push(`STATUS:${STATUS_BY_GRAPH[status] ?? 'NEEDS-ACTION'}`);
  lines.push(`X-MICROSOFT-TODO-STATUS:${status}`);

  // RFC 5545 §3.8.1.9: 1 is highest, 9 lowest, 5 "medium"; 0 undefined.
  const importance = task.importance ?? 'normal';
  lines.push(`PRIORITY:${PRIORITY_BY_IMPORTANCE[importance] ?? 5}`);
  lines.push(`X-MICROSOFT-TODO-IMPORTANCE:${importance}`);

  // A To Do due date is a calendar DATE — midnight in the account's zone —
  // so it is written as one rather than as a midnight that would shift by a
  // day the moment a target read it in another zone.
  const due = task.dueDateTime && dateOf(task.dueDateTime);
  if (due) lines.push(`DUE;VALUE=DATE:${due}`);
  const rrule = task.recurrence ? recurrenceToRrule(task.recurrence.pattern, task.recurrence.range) : undefined;
  // DTSTART from the start date the person set; failing that, a recurring
  // task anchors on its recurrence range or its due date, because an RRULE
  // with nothing to count from is one a target may refuse.
  const start =
    (task.startDateTime && dateOf(task.startDateTime)) ??
    (rrule ? (dateOfYmd(task.recurrence?.range?.startDate) ?? due) : undefined);
  if (start) lines.push(`DTSTART;VALUE=DATE:${start}`);
  if (rrule) lines.push(`RRULE:${rrule}`);

  if (status === 'completed') {
    lines.push('PERCENT-COMPLETE:100');
    // COMPLETED MUST be UTC (§3.8.2.1). Graph reports completion in UTC; a
    // zone it does not is carried verbatim rather than mislabelled.
    const completed = task.completedDateTime && utcStampOfZoned(task.completedDateTime);
    if (completed) lines.push(`COMPLETED:${completed}`);
    else if (task.completedDateTime) {
      lines.push(
        `X-MICROSOFT-TODO-COMPLETED:${escapeText(task.completedDateTime.dateTime)} ${escapeText(task.completedDateTime.timeZone ?? '')}`.trimEnd(),
      );
    }
  }

  if (task.categories && task.categories.length > 0) {
    lines.push(`CATEGORIES:${task.categories.map((c) => escapeText(c)).join(',')}`);
  }
  if (task.isReminderOn && task.reminderDateTime) {
    const at = utcStampOfZoned(task.reminderDateTime);
    if (at) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER;VALUE=DATE-TIME:${at}`, 'DESCRIPTION:Reminder', 'END:VALARM');
    }
  }
  if (listName) lines.push(`X-MICROSOFT-TODO-LIST:${escapeText(listName)}`);
  lines.push('END:VTODO', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const STATUS_BY_GRAPH: Readonly<Record<string, string>> = {
  notStarted: 'NEEDS-ACTION',
  inProgress: 'IN-PROCESS',
  completed: 'COMPLETED',
  waitingOnOthers: 'NEEDS-ACTION',
  deferred: 'NEEDS-ACTION',
};

const PRIORITY_BY_IMPORTANCE: Readonly<Record<string, number>> = { high: 1, normal: 5, low: 9 };

/** The body, then the checklist as lines — nothing a target has no field for is dropped. */
function descriptionOf(task: GraphTodoTask): string | undefined {
  const parts: string[] = [];
  const body = task.body?.content ? bodyText(task.body.content, task.body.contentType) : '';
  if (body) parts.push(body);
  const items = (task.checklistItems ?? []).filter((i): i is GraphChecklistItem & { displayName: string } =>
    Boolean(i.displayName),
  );
  if (items.length > 0) {
    parts.push(items.map((i) => `${i.isChecked ? '[x]' : '[ ]'} ${i.displayName}`).join('\n'));
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/** Graph bodies are text or HTML; a VTODO description is text. */
export function bodyText(content: string, contentType?: 'text' | 'html'): string {
  if (contentType !== 'html') return content.replace(/\r\n/g, '\n').trim();
  return content
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Recurrence: Graph's pattern + range → RRULE (RFC 5545 §3.3.10)
// ---------------------------------------------------------------------------

const BYDAY: Readonly<Record<string, string>> = {
  monday: 'MO',
  tuesday: 'TU',
  wednesday: 'WE',
  thursday: 'TH',
  friday: 'FR',
  saturday: 'SA',
  sunday: 'SU',
};

const SETPOS: Readonly<Record<string, number>> = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };

/** Undefined when the pattern is one this mapping does not know — carried as a plain task rather than guessed. */
export function recurrenceToRrule(
  pattern: GraphRecurrencePattern | undefined,
  range: GraphRecurrenceRange | undefined,
): string | undefined {
  if (!pattern) return undefined;
  const parts: string[] = [];
  const interval = pattern.interval && pattern.interval > 1 ? `;INTERVAL=${pattern.interval}` : '';
  const days = (pattern.daysOfWeek ?? []).map((d) => BYDAY[d.toLowerCase()]).filter(Boolean);
  const byday = days.length > 0 ? `;BYDAY=${days.join(',')}` : '';
  const setpos = pattern.index ? `;BYSETPOS=${SETPOS[pattern.index]}` : '';
  switch (pattern.type) {
    case 'daily':
      parts.push(`FREQ=DAILY${interval}`);
      break;
    case 'weekly': {
      const wkst = pattern.firstDayOfWeek ? BYDAY[pattern.firstDayOfWeek.toLowerCase()] : undefined;
      parts.push(`FREQ=WEEKLY${interval}${byday}${wkst ? `;WKST=${wkst}` : ''}`);
      break;
    }
    case 'absoluteMonthly':
      parts.push(`FREQ=MONTHLY${interval}${pattern.dayOfMonth ? `;BYMONTHDAY=${pattern.dayOfMonth}` : ''}`);
      break;
    case 'relativeMonthly':
      parts.push(`FREQ=MONTHLY${interval}${byday}${setpos}`);
      break;
    case 'absoluteYearly':
      parts.push(
        `FREQ=YEARLY${interval}${pattern.month ? `;BYMONTH=${pattern.month}` : ''}${pattern.dayOfMonth ? `;BYMONTHDAY=${pattern.dayOfMonth}` : ''}`,
      );
      break;
    case 'relativeYearly':
      parts.push(`FREQ=YEARLY${interval}${pattern.month ? `;BYMONTH=${pattern.month}` : ''}${byday}${setpos}`);
      break;
    default:
      return undefined;
  }
  if (range?.type === 'numbered' && range.numberOfOccurrences) parts.push(`COUNT=${range.numberOfOccurrences}`);
  if (range?.type === 'endDate') {
    const until = dateOfYmd(range.endDate);
    if (until) parts.push(`UNTIL=${until}`);
  }
  return parts.join(';');
}

// ---------------------------------------------------------------------------
// Dates and text
// ---------------------------------------------------------------------------

/** `2026-09-05T06:00:00.1234567Z` → `20260905T060000Z`; undefined for anything else. */
function utcStamp(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** A Graph zoned time that IS UTC, as a UTC stamp; undefined when it is in some other zone. */
function utcStampOfZoned(at: GraphDateTimeTimeZone): string | undefined {
  const zone = (at.timeZone ?? 'UTC').toUpperCase();
  if (zone !== 'UTC' && zone !== 'Z' && zone !== 'ETC/UTC') return undefined;
  return utcStamp(at.dateTime.replace(/(\.\d+)?$/, (m) => m.slice(0, 4)) + (at.dateTime.endsWith('Z') ? '' : 'Z'));
}

/** The calendar date of a Graph zoned time, as `YYYYMMDD` — the day the person picked. */
function dateOf(at: GraphDateTimeTimeZone): string | undefined {
  return dateOfYmd(at.dateTime.slice(0, 10));
}

function dateOfYmd(ymd: string | undefined): string | undefined {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  return ymd.replace(/-/g, '');
}

function isoOfDate(at: GraphDateTimeTimeZone): string | undefined {
  const ymd = at.dateTime.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd}T00:00:00.000Z` : undefined;
}

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 §3.1 folding, on octet boundaries that never split a UTF-8 sequence. */
export function fold(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= FOLD_AT) return line;
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > FOLD_AT) {
      out.push(current);
      // The continuation's leading space is one of its 75 octets.
      current = ' ';
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n');
}

function createDefaultHttpClient(): HttpClient {
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: typeof options.body === 'string' ? options.body : undefined,
      });
      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { status: response.status, body, headers };
    },
  };
}
