// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Microsoft Graph's calendar resources, as v1.0 documents them.
 *
 * Only the fields `graph-calendar-source.ts` reads, each optional unless
 * Graph always sends it: a `$select` names what is asked for, and Graph's own
 * pages mark most of them nullable.
 *
 * - calendar: https://learn.microsoft.com/en-us/graph/api/resources/calendar?view=graph-rest-1.0
 * - event: https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0
 */

import type { GraphDateTimeTimeZone, GraphRecurrencePattern, GraphRecurrenceRange } from './graph-todo-source.types.ts';

/** A calendar — `GET {scope}/calendars`. */
export interface GraphCalendar {
  readonly id: string;
  readonly name: string;
  readonly isDefaultCalendar?: boolean;
  readonly changeKey?: string;
  readonly color?: string;
  readonly hexColor?: string;
  /** `false` for a calendar the user may only read: a subscribed one, a holiday calendar, one shared read-only. */
  readonly canEdit?: boolean;
  readonly canShare?: boolean;
  readonly isRemovable?: boolean;
  readonly isSharedWithMe?: boolean;
}

export interface GraphEventAddress {
  readonly name?: string;
  readonly address?: string;
}

export interface GraphAttendee {
  readonly type?: 'required' | 'optional' | 'resource';
  readonly status?: {
    readonly response?: 'none' | 'organizer' | 'tentativelyAccepted' | 'accepted' | 'declined' | 'notResponded';
    readonly time?: string;
  };
  readonly emailAddress?: GraphEventAddress;
}

export interface GraphLocation {
  readonly displayName?: string;
  readonly address?: {
    readonly street?: string;
    readonly city?: string;
    readonly state?: string;
    readonly countryOrRegion?: string;
    readonly postalCode?: string;
  };
}

/** An event — a series master, a single event, or one of a series' exceptions. */
export interface GraphEvent {
  readonly id: string;
  /**
   * "A unique identifier for an event across calendars. This ID is different
   * for each occurrence in a recurring series." So the series master's is the
   * UID of the whole series, and an exception's is not used.
   */
  readonly iCalUId?: string;
  /** The item's version: it changes every time the event does (`graphItemVersion`). */
  readonly changeKey?: string;
  readonly '@odata.etag'?: string;
  readonly createdDateTime?: string;
  readonly lastModifiedDateTime?: string;
  readonly subject?: string;
  readonly body?: { readonly contentType?: 'text' | 'html'; readonly content?: string };
  readonly start?: GraphDateTimeTimeZone;
  readonly end?: GraphDateTimeTimeZone;
  /** The zone the organizer set the start in: a Windows name, or an IANA one. */
  readonly originalStartTimeZone?: string;
  readonly originalEndTimeZone?: string;
  /** An exception's original start, always UTC. Not returned for a single event. */
  readonly originalStart?: string;
  readonly location?: GraphLocation;
  readonly isAllDay?: boolean;
  readonly isCancelled?: boolean;
  readonly isReminderOn?: boolean;
  readonly reminderMinutesBeforeStart?: number;
  readonly type?: 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster';
  readonly seriesMasterId?: string;
  /** `OID.{seriesMasterId}.{YYYY-MM-DD}` for an exception; null for a master. */
  readonly occurrenceId?: string | null;
  readonly recurrence?: {
    readonly pattern?: GraphRecurrencePattern;
    readonly range?: GraphRecurrenceRange;
  } | null;
  readonly showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown';
  readonly sensitivity?: 'normal' | 'personal' | 'private' | 'confidential';
  readonly categories?: ReadonlyArray<string>;
  readonly organizer?: { readonly emailAddress?: GraphEventAddress };
  readonly attendees?: ReadonlyArray<GraphAttendee>;
  /** A delta's word that the event is gone; a plain listing never carries it. */
  readonly '@removed'?: { readonly reason?: string };
}

/**
 * A series master read on its own, for what only that read returns:
 * `cancelledOccurrences` ("occurrenceId property values of canceled instances
 * … Requires $select") and `exceptionOccurrences` ("Requires $select and
 * $expand"). https://learn.microsoft.com/en-us/graph/api/event-get?view=graph-rest-1.0
 */
export interface GraphSeriesDetail {
  readonly id: string;
  readonly cancelledOccurrences?: ReadonlyArray<string>;
  readonly exceptionOccurrences?: ReadonlyArray<GraphEvent>;
}

/** A page of a Graph listing. */
export interface GraphCalendarPage<T> {
  readonly value: T[];
  readonly '@odata.nextLink'?: string;
}
