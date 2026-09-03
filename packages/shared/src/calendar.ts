// Copyright 2026 The Ownpace authors (Apache-2.0)
/** CalDAV calendar event model for migration. */

/** The three iCalendar components, as this product's own item labels. */
export type CalendarEventType = 'event' | 'todo' | 'journal';

/** Event status. */
export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';

/** Participation status. */
export type ParticipationStatus = 'needs-action' | 'accepted' | 'declined' | 'tentative' | 'delegated';

/** Calendar attendee. */
export interface CalendarAttendee {
  readonly email: string;
  readonly name?: string;
  readonly role?: 'req-participant' | 'opt-participant' | 'chair';
  readonly participationStatus: ParticipationStatus;
}

/** Recurrence rule (simplified iCalendar RRULE). */
export interface RecurrenceRule {
  readonly frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  readonly interval?: number;
  readonly count?: number;
  readonly until?: string; // ISO 8601 date-time
  readonly byDay?: ReadonlyArray<string>; // e.g., ['MO', 'WE']
}

/**
 * Normalized calendar event.
 * The `uid` is the natural key (idempotency anchor); content is hashed from normalized event data.
 */
export interface CalendarEvent {
  /**
   * RFC 5545 UID. The natural key for idempotency — but NOT on its own for a
   * recurring series: see `recurrenceId`.
   */
  readonly uid: string;
  /**
   * RFC 5545 RECURRENCE-ID, when this event is a modified occurrence of a
   * recurring series (one meeting in the weekly slot moved an hour, or given
   * a different room).
   *
   * A series and each of its exceptions SHARE a UID — that is what RFC 5545
   * says they do — so the UID alone is not a key. Keying on it alone makes the
   * exception look like an item the target already has, so it is adopted and
   * never copied: a moved occurrence silently missing from the migration,
   * inside a run that reports success. `naturalKeyForCalendar` is the one
   * place that composes the two (hard rule 1).
   */
  readonly recurrenceId?: string;
  /** Event type. */
  readonly type: CalendarEventType;
  /** Summary/title. */
  readonly summary: string;
  /** Description. */
  readonly description?: string;
  /** Start time (ISO 8601). */
  readonly start: string;
  /** End time (ISO 8601). */
  readonly end?: string;
  /** Duration in seconds (alternative to end). */
  readonly duration?: number;
  /** All-day event flag. */
  readonly isAllDay?: boolean;
  /** Timezone identifier. */
  readonly timezone?: string;
  /** Location. */
  readonly location?: string;
  /** Status. */
  readonly status?: EventStatus;
  /** Organizer. */
  readonly organizer?: {
    readonly email: string;
    readonly name?: string;
  };
  /** Attendees. */
  readonly attendees?: ReadonlyArray<CalendarAttendee>;
  /** Recurrence rule. */
  readonly recurrenceRule?: RecurrenceRule;
  /** Reminders/alarms (simplified). */
  readonly reminders?: ReadonlyArray<{
    readonly action: 'display' | 'audio';
    readonly triggerSeconds: number;
    readonly description?: string;
  }>;
  /** Categories/tags. */
  readonly categories?: ReadonlyArray<string>;
  /** URL/link. */
  readonly url?: string;
  /** Last modified (ISO 8601). */
  readonly lastModified?: string;
  /** Created (ISO 8601). */
  readonly created?: string;
  /**
   * The collection's DAV ETag for this object, when the server sent one.
   *
   * The change signal for shadow sync: the ledger stores it and a later pass
   * compares it, so an event edited on the source after the initial copy is
   * re-copied instead of skipped forever. Preferred over `lastModified` —
   * that comes from the iCalendar LAST-MODIFIED property, which is written by
   * the client and is not guaranteed to move when the object does, whereas the
   * ETag is the server's own validator for the resource (RFC 4918 §8.6).
   *
   * Opaque: compared for equality only, never parsed or ordered.
   */
  readonly etag?: string;
  /** Source folder/calendar collection. */
  readonly sourcePath: string;
  /** Raw iCalendar data (RFC 5545). */
  readonly icalendar: string;
}

/**
 * The iCalendar components a CalDAV collection can declare it holds
 * (RFC 4791 §5.2.3 `supported-calendar-component-set`).
 *
 * This is the ONLY thing that distinguishes a "task list" from a "calendar" on
 * the wire: both are calendar collections; one says VTODO and the other says
 * VEVENT. There is no separate resource type to look for, which is exactly why
 * a task list read as a calendar looked like a calendar for so long
 * (workplan 0113).
 */
export const CALENDAR_COMPONENTS = ['VEVENT', 'VTODO', 'VJOURNAL'] as const;
export type CalendarComponent = (typeof CALENDAR_COMPONENTS)[number];

/** Calendar folder/collection. */
export interface CalendarFolder {
  /** Calendar collection path. */
  readonly path: string;
  /** Human-readable name. */
  readonly name?: string;
  /** Calendar description. */
  readonly description?: string;
  /** Timezone. */
  readonly timezone?: string;
  /** Color. */
  readonly color?: string;
  /**
   * What the server SAID this collection holds, when it said anything.
   *
   * Absent means the server declared no `supported-calendar-component-set`,
   * which is not the same as "holds nothing" — see `collectionCarries`.
   * Present and empty never happens: a declared set with no `comp` children is
   * read as undeclared rather than as a collection that holds nothing, because
   * the second reading would silently drop a real calendar.
   */
  readonly components?: ReadonlyArray<CalendarComponent>;
}

/**
 * Does a collection hold this component?
 *
 * RFC 4791 §5.2.3: a calendar collection that declares no
 * `supported-calendar-component-set` "MAY contain any calendar component
 * type". So an undeclared set is a YES for every component — absence of a
 * declaration is not evidence of absence, and treating it as one would hide a
 * calendar from a person who has one (0105's never-guess rule, pointed the
 * other way).
 *
 * A DECLARED set is taken at its word. That is what makes the count true: a
 * Nextcloud task list declares VTODO and nothing else, and stops being counted
 * among "5 calendars visible".
 */
/**
 * Which component an iCalendar object holds, or `undefined` when its BEGIN
 * lines name none this product knows.
 *
 * The FIRST recognised `BEGIN:` inside the VCALENDAR wrapper. An object may
 * legitimately carry more than one component — a recurring series and its
 * modified occurrences share a file — but they are the same UID and the same
 * kind, so the first one names the object.
 *
 * Anchored to the start of a line on purpose: a calendar named
 * `X-WR-CALNAME:My VTODO list` would otherwise relabel every event inside it.
 *
 * Lives here rather than in either connector because BOTH sides need the same
 * answer from the same bytes: the source labels the record it stores, and the
 * target's read-back has to ask the server for the component it is about to
 * write. Two readings of one file would disagree exactly once.
 */
export function componentOfIcalendar(icalendar: string): CalendarComponent | undefined {
  const match = icalendar.match(/^BEGIN:(VEVENT|VTODO|VJOURNAL)\s*$/im);
  const name = match?.[1]?.toUpperCase();
  return (CALENDAR_COMPONENTS as ReadonlyArray<string>).includes(name ?? '')
    ? (name as CalendarComponent)
    : undefined;
}

/**
 * The label for an iCalendar component name.
 *
 * The two vocabularies exist because they answer different questions: the DAV
 * wire says `VTODO`, and this product's records say `todo`. One map between
 * them, so a third spelling never appears.
 */
export const COMPONENT_ITEM_TYPES: Readonly<Record<CalendarComponent, CalendarEventType>> = {
  VEVENT: 'event',
  VTODO: 'todo',
  VJOURNAL: 'journal',
};

export function collectionCarries(
  components: ReadonlyArray<CalendarComponent> | undefined,
  component: CalendarComponent,
): boolean {
  if (!components || components.length === 0) return true;
  return components.includes(component);
}

/** Calendar item with raw data. */
export interface RawCalendarEvent {
  readonly item: CalendarEvent;
  readonly icalendar: string;
}
