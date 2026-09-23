// Copyright 2026 The Ownpace authors (Apache-2.0)

import type {
  CalendarFolder,
  CalendarSource,
  RawCalendarEvent,
  SyncCursor,
  ThrottleLimiter,
  TokenProvider,
} from '@openmig/shared';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import { driveRefusalBody, googleRefusalReason } from './drive-refusal.ts';
// RFC 5545's text rules, which are not Microsoft's: shared with the To Do
// source rather than copied.
import { escapeText, fold } from './graph-todo-source.ts';
import type {
  GooglePage,
  GoogleTask,
  GoogleTaskAssignmentInfo,
  GoogleTaskLink,
  GoogleTaskList,
} from './google-tasks-source.types.ts';

/**
 * GOOGLE TASKS AS A TASK SOURCE (workplan 0126 T1).
 *
 * Google's CalDAV carries no VTODO at any scope tier (0113 T5/T6), so tasks
 * come from the Tasks API, as JSON, and the VTODO a target receives is built
 * here. The shape is `graph-todo-source.ts`'s: each list is a calendar folder
 * declaring VTODO, each task a `RawCalendarEvent`, and the task domain's pass
 * (`runTaskSync`) reads it like any other task source.
 *
 * ## The listing leaves out nothing of the person's
 *
 * Four flags, because each default hides something that is theirs:
 * `showHidden`, without which every task ticked off in Google's own apps is
 * missing (*"showHidden must also be True to show tasks completed in first
 * party clients"*); `showAssigned`, for tasks assigned from Docs or Chat;
 * `showCompleted`, true by default and asked for anyway; and `showDeleted`,
 * so a deletion arrives as the source's own statement (D1, D2 and D5, taken
 * 2026-09-23).
 *
 * ## Full listing, and deletions reported
 *
 * Every pass lists every task, as the To Do source does: a task list is small,
 * and a complete listing keeps the loop's cursorless semantics. A task Google
 * marks `deleted` is not an item. Its source path goes into `removed`, where the
 * loop matches it to the row that recorded the same path at copy time and puts
 * it on the owner's Deletions queue. Nothing is removed from the target. Google
 * keeps returning a deleted task for a while, and the ledger keeps the first
 * report (`recordReportedDeletion`), so repeating it is a no-op.
 *
 * ## What cannot be carried
 *
 * The API has no recurrence and no time of day: a repeating task arrives as one
 * task, and a due date as a DATE. Saying so per migration is T7, not this file.
 */

const DEFAULT_BASE_URL = 'https://tasks.googleapis.com';

/** Lists per page: the API's maximum. */
const LISTS_PER_PAGE = 1000;

/** Tasks per page: the API's maximum. The default is 20. */
const TASKS_PER_PAGE = 100;

/** More pages than any task list produces. A guard against a paging loop, not a limit. */
const MAX_PAGES = 10_000;

/** See the header: each flag's default hides something that is the person's. */
const EVERY_TASK = 'showCompleted=true&showHidden=true&showAssigned=true&showDeleted=true';

/**
 * Reasons Google gives for a rate limit on a 403 rather than a 429. Calendar
 * and Drive document both; whether Tasks uses them is unverified, so both are
 * read. Reading one as a missing grant would tell the owner to reconnect over
 * a limit that clears by itself.
 */
const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

const EPOCH_ISO = new Date(0).toISOString();

export class GoogleTasksSource implements CalendarSource {
  private readonly tokenProvider: TokenProvider;
  private readonly httpClient: HttpClient;
  private readonly baseUrl: string;
  private readonly tenantId: string;
  private readonly throttleLimiter?: ThrottleLimiter;
  private readonly provider: string;

  constructor(
    tokenProvider: TokenProvider,
    tenantId: string,
    options?: { baseUrl?: string; throttleLimiter?: ThrottleLimiter },
    deps?: { httpClient?: HttpClient },
  ) {
    this.tokenProvider = tokenProvider;
    this.tenantId = tenantId;
    this.baseUrl = options?.baseUrl?.replace(/\/$/, '') ?? DEFAULT_BASE_URL;
    this.httpClient = deps?.httpClient ?? createDefaultHttpClient();
    this.throttleLimiter = options?.throttleLimiter;
    this.provider = hostnameOf(this.baseUrl);
  }

  /** Every task list, as a calendar folder at `/tasks/lists/{id}` that holds VTODO. */
  async listFolders(): Promise<ReadonlyArray<CalendarFolder>> {
    const lists = await this.collect<GoogleTaskList>(
      `${this.baseUrl}/tasks/v1/users/@me/lists?maxResults=${LISTS_PER_PAGE}`,
      'Google Tasks lists',
    );
    return lists.map((list) => ({
      path: `/tasks/lists/${list.id}`,
      name: list.title,
      // A task list, said out loud: the target creates it as one rather than
      // as a calendar that happens to hold tasks.
      components: ['VTODO'],
    }));
  }

  /** Every task in the list; the deleted ones as removals. The cursor is ignored (see the header). */
  async listSince(
    folder: CalendarFolder,
    _cursor?: SyncCursor,
  ): Promise<{
    items: ReadonlyArray<RawCalendarEvent>;
    nextCursor: SyncCursor;
    removed?: ReadonlyArray<string>;
  }> {
    const listId = listIdOf(folder);
    const tasks = await this.collect<GoogleTask>(
      `${this.baseUrl}/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?maxResults=${TASKS_PER_PAGE}&${EVERY_TASK}`,
      `tasks in Google Tasks list ${listId}`,
    );
    const items: RawCalendarEvent[] = [];
    const removed: string[] = [];
    for (const task of tasks) {
      if (task.deleted) removed.push(googleTaskSourcePath(listId, task.id));
      else items.push(googleTaskAsCalendarItem(task, listId));
    }
    return {
      items,
      nextCursor: { value: `full-listing:${folder.path}` },
      ...(removed.length > 0 ? { removed } : {}),
    };
  }

  /** Follow `nextPageToken` to the end, refusing to loop. */
  private async collect<T>(firstUrl: string, what: string): Promise<T[]> {
    const out: T[] = [];
    const tokens = new Set<string>();
    let url = firstUrl;
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) {
        throw new Error(`Listing ${what} passed ${MAX_PAGES} pages — refusing to keep requesting.`);
      }
      const response = await this.makeRequest({
        url,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (response.status !== 200) {
        throw new Error(googleTasksFailure(`Failed to list ${what}`, response));
      }
      const body = JSON.parse(response.body) as GooglePage<T>;
      out.push(...(body.items ?? []));
      const token = body.nextPageToken;
      if (!token) return out;
      // A token handed back twice would page the same results forever.
      if (tokens.has(token)) {
        throw new Error(`Google answered the same page token twice while listing ${what} — refusing to loop.`);
      }
      tokens.add(token);
      url = `${firstUrl}&pageToken=${encodeURIComponent(token)}`;
    }
  }

  /**
   * The Graph sources' request idiom: a Bearer token, and a rate limit waited
   * out rather than failed. Google's 403 rate limit is read as the 429 it means,
   * so the tenant limiter backs off on it too.
   */
  private async makeRequest(options: HttpRequestOptions): Promise<HttpResponse> {
    const token = await this.tokenProvider.getToken();
    const send = async (): Promise<HttpResponse> => {
      const response = await this.httpClient.request({
        ...options,
        headers: { Authorization: `Bearer ${token.accessToken}`, ...options.headers },
      });
      return isGoogleRateLimit(response) ? { ...response, status: 429 } : response;
    };

    if (this.throttleLimiter) {
      return this.throttleLimiter.executeWithThrottling(this.tenantId, this.provider, send);
    }
    const response = await send();
    if (response.status === 429 || response.status === 503) {
      const seconds = Number(response.headers['retry-after']);
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(seconds) ? seconds * 1000 : 1000));
      return send();
    }
    return response;
  }
}

function isGoogleRateLimit(response: HttpResponse): boolean {
  return response.status === 403 && RATE_LIMIT_REASONS.has(googleRefusalReason(response.body));
}

/**
 * Google's own words without the envelope, and the way forward where the
 * refusal says what it is: the grant lacks Tasks, or Google no longer takes the
 * sign-in. Anything else (a Tasks API not enabled for the project, say) carries
 * Google's sentence alone, which already says what to do.
 */
export function googleTasksFailure(what: string, response: { readonly status: number; readonly body: string }): string {
  const line = `${what} (${response.status}): ${driveRefusalBody(response.body)}`;
  if (response.status === 403 && googleRefusalReason(response.body) === 'insufficientPermissions') {
    return (
      `${line} — the Google grant this connection holds does not include Google Tasks. ` +
      'Reconnect the account with Tasks ticked.'
    );
  }
  if (response.status === 401) {
    return `${line} — Google no longer accepts this connection's sign-in. Reconnect the account.`;
  }
  return line;
}

function listIdOf(folder: CalendarFolder): string {
  const m = /^\/tasks\/lists\/(.+)$/.exec(folder.path);
  if (!m?.[1]) throw new Error(`Not a Google Tasks list path: ${folder.path}`);
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
// Google's JSON → VTODO
// ---------------------------------------------------------------------------

/** The source's own handle for a task: what `removed` names and the ledger records. */
export function googleTaskSourcePath(listId: string, taskId: string): string {
  return `/tasks/lists/${listId}/tasks/${taskId}`;
}

/**
 * The task's UID: Google's id, hex-encoded.
 *
 * Google's ids are case-sensitive, and the task key lowercases the UID
 * (`taskNaturalKeyHash`), so two ids differing only in case would be one key:
 * the second task would be taken for the first and never copied. The target
 * also writes the UID into the object's name unencoded (`{uid}.ics`). Hex is
 * lowercase and URL-safe by construction, so neither can happen, whatever
 * Google's alphabet turns out to be. The id itself rides along in
 * `X-GOOGLE-TASKS-ID`.
 */
export function googleTaskUid(id: string): string {
  return `google-task-${Buffer.from(id, 'utf8').toString('hex')}`;
}

/** The task as the sync loop sees it, versioned by Google's etag. */
export function googleTaskAsCalendarItem(task: GoogleTask, listId: string): RawCalendarEvent {
  const icalendar = googleTaskToIcalendar(task);
  const due = dueDateOf(task.due);
  const description = googleTaskDescription(task);
  // What the loop's `sourceVersion` reads. Without one it skips a known task
  // forever, and an edit in Google never arrives (0126 trap 5). The last
  // change time stands in if Google ever omits the etag.
  const version = task.etag ?? task.updated;
  return {
    item: {
      uid: googleTaskUid(task.id),
      type: 'todo',
      summary: task.title?.trim() || 'Untitled task',
      start: due ? `${due.iso}T00:00:00.000Z` : (task.updated ?? EPOCH_ISO),
      ...(description ? { description } : {}),
      ...(version ? { etag: version } : {}),
      sourcePath: googleTaskSourcePath(listId, task.id),
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
export function googleTaskToIcalendar(task: GoogleTask): string {
  const modified = utcStamp(task.updated);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ownpace//Google Tasks//EN',
    'BEGIN:VTODO',
    `UID:${googleTaskUid(task.id)}`,
    `DTSTAMP:${modified ?? utcStamp(EPOCH_ISO)!}`,
  ];
  if (modified) lines.push(`LAST-MODIFIED:${modified}`);
  lines.push(`SUMMARY:${escapeText(task.title?.trim() || 'Untitled task')}`);

  const description = googleTaskDescription(task);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);

  // Two statuses, onto two of RFC 5545's (§3.8.1.11). A hidden task is one
  // completed and then cleared from the list: still completed, and carried
  // (D1). Nextcloud Tasks hides completed tasks by default, as Google does.
  if (task.status === 'completed') {
    lines.push('STATUS:COMPLETED', 'PERCENT-COMPLETE:100');
    // COMPLETED MUST be UTC (§3.8.2.1), and Google reports it in RFC 3339.
    const completed = utcStamp(task.completed);
    if (completed) lines.push(`COMPLETED:${completed}`);
  } else {
    lines.push('STATUS:NEEDS-ACTION');
  }

  // A DATE, because that is all Google keeps: the day as Google wrote it,
  // never shifted through a timezone (0126 trap 3).
  const due = dueDateOf(task.due);
  if (due) lines.push(`DUE;VALUE=DATE:${due.basic}`);

  // A subtask names its parent's UID, which is how Nextcloud Tasks nests it.
  if (task.parent) lines.push(`RELATED-TO;RELTYPE=PARENT:${googleTaskUid(task.parent)}`);

  lines.push(`X-GOOGLE-TASKS-ID:${escapeText(task.id)}`);
  // The order among siblings, kept verbatim. Whether a target's sort order
  // can use it is still to be checked (0126 § The comparison).
  if (task.position) lines.push(`X-GOOGLE-TASKS-POSITION:${escapeText(task.position)}`);
  lines.push('END:VTODO', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Maps rather than object literals: the keys are Google's strings, and a
// literal would answer `constructor` with a function.
const LINK_LABELS: ReadonlyMap<string, string> = new Map([
  ['email', 'Email'],
  ['chat_message', 'Chat message'],
  ['keep_note', 'Keep note'],
  ['generic', 'Link'],
]);

const ASSIGNED_FROM: ReadonlyMap<string, string> = new Map([
  ['DOCUMENT', 'a Google Doc'],
  ['SPACE', 'a Google Chat space'],
  ['GMAIL', 'Gmail'],
]);

/**
 * The notes, then one readable line per link and one for where an assigned
 * task came from (D2, D3). DESCRIPTION is the one field every task app shows.
 */
export function googleTaskDescription(task: GoogleTask): string | undefined {
  const parts: string[] = [];
  const notes = task.notes?.replace(/\r\n/g, '\n').trim();
  if (notes) parts.push(notes);
  const lines = [assignmentLine(task.assignmentInfo), ...(task.links ?? []).map(linkLine)].filter(
    (l): l is string => l !== undefined,
  );
  if (lines.length > 0) parts.push(lines.join('\n'));
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function linkLine(link: GoogleTaskLink): string | undefined {
  const url = link.link?.trim();
  if (!url) return undefined;
  const label = LINK_LABELS.get(link.type ?? '') ?? (link.type ? `Link (${link.type})` : 'Link');
  const text = link.description?.trim();
  return text ? `${label}: ${text} <${url}>` : `${label}: ${url}`;
}

function assignmentLine(info: GoogleTaskAssignmentInfo | undefined): string | undefined {
  if (!info) return undefined;
  const where = ASSIGNED_FROM.get(info.surfaceType ?? '');
  const url = info.linkToTask?.trim();
  if (!where && !url) return undefined;
  const head = where ? `Assigned to you in ${where}` : 'Assigned to you';
  return url ? `${head}: ${url}` : head;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** The date part of Google's `due`, read off the string rather than through a clock. */
function dueDateOf(due: string | undefined): { readonly iso: string; readonly basic: string } | undefined {
  const m = due ? /^(\d{4})-(\d{2})-(\d{2})/.exec(due) : null;
  if (!m) return undefined;
  return { iso: `${m[1]}-${m[2]}-${m[3]}`, basic: `${m[1]}${m[2]}${m[3]}` };
}

/** RFC 3339 → `20260905T060000Z`; undefined for anything unparseable. */
function utcStamp(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
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
