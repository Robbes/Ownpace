// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAKE GRAPH THAT ANSWERS BY METHOD AND ADDRESS, NEVER BY CALL ORDER.
 *
 * The Graph calendar source's old tests answered each request with the next
 * canned response, whatever it asked for. So `events/delta` and `$value`, two
 * calls v1.0 does not document, passed for months, and failed on the first
 * real account (2026-11-24). This fake answers only the calls Graph v1.0
 * documents for calendars, in the shape its pages show, and refuses anything
 * else the way Graph refuses an unknown segment: a 400 the source must report.
 *
 *  - `GET {scope}/calendars` — calendar-list-calendars
 *  - `GET {scope}/calendars/{id}/events` — calendar-list-events: series
 *    masters and single events, never expanded; `$select` is honoured, so a
 *    field the source did not ask for is not in the answer; `$top` pages.
 *  - `GET {scope}/calendars/{id}/events/{masterId}?$select=cancelledOccurrences,exceptionOccurrences&$expand=exceptionOccurrences`
 *    — event-get, Example 3: only for a series master, and only with both.
 *
 * Every request is recorded, so a test can say what was asked and what was not.
 */

import type { HttpClient, HttpRequestOptions, HttpResponse } from '../dav-http.types.ts';
import type { GraphEvent } from '../graph-calendar-source.types.ts';

export interface FakeSeries {
  readonly cancelled?: ReadonlyArray<string>;
  readonly exceptions?: ReadonlyArray<GraphEvent>;
}

export interface FakeCalendar {
  readonly id: string;
  readonly name: string;
  readonly canEdit?: boolean;
  events: GraphEvent[];
  /** By series master id. */
  series?: Record<string, FakeSeries>;
  /** Answer every request about this calendar's events with this refusal. */
  refuse?: { readonly status: number; readonly code: string; readonly message: string };
  /** Answer the detail read of these masters with a 500. */
  brokenSeries?: ReadonlyArray<string>;
}

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

const BASE = 'https://graph.microsoft.com/v1.0/me';

function json(status: number, body: unknown): HttpResponse {
  return { status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
}

function graphError(status: number, code: string, message: string): HttpResponse {
  return json(status, { error: { code, message, innerError: { 'request-id': 'fake' } } });
}

/** Only the fields `$select` names, as Graph answers (plus `@odata.etag`, which it always sends). */
function project(event: GraphEvent, select: string | null): GraphEvent {
  if (!select) return event;
  const keep = new Set(select.split(',').map((s) => s.trim()));
  keep.add('id');
  return Object.fromEntries(Object.entries(event).filter(([k]) => keep.has(k) || k === '@odata.etag')) as unknown as GraphEvent;
}

export function fakeGraphCalendars(
  calendars: FakeCalendar[],
  options: { readonly pageSize?: number } = {},
): { client: HttpClient; requests: RecordedRequest[]; calendars: FakeCalendar[] } {
  const requests: RecordedRequest[] = [];
  const pageSize = options.pageSize ?? 100;

  const answer = (o: HttpRequestOptions): HttpResponse => {
    if (o.method !== 'GET') return graphError(405, 'ErrorInvalidRequest', `The OData request is not supported: ${o.method}`);
    const prefer = Object.entries(o.headers ?? {}).find(([k]) => k.toLowerCase() === 'prefer')?.[1] ?? '';
    if (/icalendar/i.test(prefer)) {
      return graphError(400, 'ErrorInvalidRequest', 'outlook.body-content-type takes "text" or "html".');
    }
    const url = new URL(o.url);
    const path = url.pathname.replace(/^\/v1\.0\/me/, '');
    const q = url.searchParams;

    if (path === '/calendars') {
      return json(200, {
        value: calendars.map((c) => ({
          id: c.id,
          name: c.name,
          canEdit: c.canEdit ?? true,
          isDefaultCalendar: c === calendars[0],
          changeKey: `cal-${c.id}`,
          hexColor: '#3b82f6',
        })),
      });
    }

    const listing = /^\/calendars\/([^/]+)\/events$/.exec(path);
    if (listing) {
      const cal = calendars.find((c) => c.id === decodeURIComponent(listing[1]!));
      if (!cal) return graphError(404, 'ErrorItemNotFound', 'The specified object was not found in the store.');
      if (cal.refuse) return graphError(cal.refuse.status, cal.refuse.code, cal.refuse.message);
      // Series masters and single events: an occurrence is never listed here.
      const listed = cal.events.filter((e) => e.type !== 'occurrence' && e.type !== 'exception');
      const skip = Number(q.get('$skip') ?? '0');
      const top = Math.min(Number(q.get('$top') ?? '10'), pageSize);
      const page = listed.slice(skip, skip + top).map((e) => project(e, q.get('$select')));
      const next = new URL(url.toString());
      next.searchParams.set('$skip', String(skip + top));
      return json(200, {
        value: page,
        ...(skip + top < listed.length ? { '@odata.nextLink': next.toString() } : {}),
      });
    }

    const one = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(path);
    if (one) {
      const cal = calendars.find((c) => c.id === decodeURIComponent(one[1]!));
      const event = cal?.events.find((e) => e.id === decodeURIComponent(one[2]!));
      if (!cal || !event) return graphError(404, 'ErrorItemNotFound', 'The specified object was not found in the store.');
      if (cal.refuse) return graphError(cal.refuse.status, cal.refuse.code, cal.refuse.message);
      if (cal.brokenSeries?.includes(event.id)) return graphError(500, 'ErrorInternalServerError', 'Something went wrong.');
      const select = (q.get('$select') ?? '').split(',');
      const expand = q.get('$expand') ?? '';
      // "Requires $select to retrieve" / "Requires $select and $expand", and
      // only for a series master.
      const series = event.type === 'seriesMaster' ? (cal.series?.[event.id] ?? {}) : undefined;
      return json(200, {
        id: event.id,
        ...(series && select.includes('cancelledOccurrences') ? { cancelledOccurrences: series.cancelled ?? [] } : {}),
        ...(series && select.includes('exceptionOccurrences') && expand.includes('exceptionOccurrences')
          ? { exceptionOccurrences: series.exceptions ?? [] }
          : {}),
      });
    }

    // Anything else, `events/delta` and `$value` included: v1.0 does not
    // document it for a calendar's events, and this fake does not invent it.
    return graphError(400, 'BadRequest', `Resource not found for the segment '${path.split('/').pop()}'.`);
  };

  const client: HttpClient = {
    request: async (o: HttpRequestOptions): Promise<HttpResponse> => {
      requests.push({ method: o.method, url: o.url, headers: { ...(o.headers ?? {}) } });
      return answer(o);
    },
  };
  return { client, requests, calendars };
}

export { BASE as FAKE_GRAPH_ME };
