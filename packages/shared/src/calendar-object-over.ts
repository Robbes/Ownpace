// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CALENDAR OBJECT THAT IS OVER KEEPS ITS ADDRESSES (the owner, 2026-11-23;
 * ADR-0055; workplan 0168).
 *
 * Asked whether the address change should reach `SENT-BY`, `DELEGATED-FROM`,
 * `DELEGATED-TO` and `MEMBER` too, the owner answered: *"yes, since the new
 * address will control the new events. Though perhapse we need not change
 * past-events we migrate."* So an object that is already over keeps every
 * address as the source has it, as a record of what happened, and the rest
 * changes. `applyAddressChanges` asks this of every iCalendar body its table
 * would change, and copies a past one byte for byte.
 *
 * ## Over, at one moment per migration
 *
 * An object is over when its last occurrence ended before the migration's
 * start (`AddressChangesForPass.migrationStart`, `mailbox_mapping.created_at`):
 * one moment, the same for every pass and every press of *Apply the new
 * addresses here too*. An object is therefore over on every pass or on none,
 * whatever day the pass runs, and the change stays a pure function of the
 * bytes, the table and that one moment: `f(f(x)) = f(x)` holds, and a row
 * that comes or goes never reaches a past object.
 *
 * The whole object is one decision. A series and its overridden instances
 * (`RECURRENCE-ID`) share one file, and are over together or not at all: the
 * object is over only when every VEVENT, VTODO and VJOURNAL in it is.
 *
 * - **An event** ends at its `DTEND`; without one, at `DTSTART` plus
 *   `DURATION`; all day, at the end of `DTSTART`'s day; and with a time but
 *   neither, at `DTSTART` itself (RFC 5545 §3.6.1).
 * - **A series** (`RRULE`, `RDATE`) is over when every occurrence ended before
 *   the start. An open-ended `RRULE` never is, nor is one with any occurrence,
 *   an `RDATE` included, that ends at or after it. A rule with `UNTIL` or
 *   `COUNT` is walked day by day where it uses only `FREQ` (daily to yearly),
 *   `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `BYMONTH` and `WKST`. A rule with any
 *   other part is over by its `UNTIL` alone, when even an occurrence starting at
 *   `UNTIL` would have ended before the start; with a `COUNT`, it is not over.
 * - **A task** is over when it is done: `STATUS:COMPLETED` or `CANCELLED`, or
 *   a `COMPLETED` time. An open task changes, whatever its dates.
 * - **A journal entry** is over when its `DTSTART` is before the start.
 *
 * ## Never over by mistake
 *
 * Where the dates cannot be read, the object is not over, so it changes, as
 * every object did before 2026-11-23: no `DTSTART`, a value that is not a
 * date, a `TZID` that names no zone, a rule that is not one, `DTEND` and
 * `DURATION` both, an instance that moves the ones after it
 * (`RANGE=THISANDFUTURE`). Every other doubt falls the same way:
 *
 * - a wall time a daylight saving change makes twice is read at the later
 *   instant, and one it skips at the later side of the gap;
 * - `EXDATE` is not read: it only ever takes occurrences away;
 * - a `DTSTART` its own rule does not produce is not counted towards `COUNT`,
 *   so the count runs one further (RFC 5545 leaves that case undefined).
 *
 * ## Time zones
 *
 * A `DATE-TIME` that ends in `Z` is UTC. One with a `TZID` is read in that
 * zone: an IANA name through the runtime's own time zone data (`Intl`); any
 * other name, such as Microsoft's `W. Europe Standard Time`, through the
 * object's own `VTIMEZONE`, at the latest instant its offsets allow, so within
 * the hour of daylight saving time an end reads late, the side that changes
 * the event. A FLOATING time, with neither `Z` nor `TZID`, belongs to no zone
 * at all (RFC 5545 §3.3.5): it is READ IN UTC here, and so is a `DATE`. Read
 * so, an end moves by at most the offset of the zone it was meant in, about
 * half a day, so only an object that ended within that much of the start can
 * be read on the wrong side of it.
 *
 * ## What it reads
 *
 * The components as `address-changes.ts`'s own content-line reader takes an
 * iCalendar text apart (`calendarObjectIsOver` there): the repository's
 * iCalendar parser, unfolded, with each parameter's value unquoted. No
 * dependency is added, and nothing here performs I/O.
 */

/** One property of a component, as the content-line reader took it apart. */
export interface CalendarProperty {
  /** The name, upper case. */
  readonly name: string;
  /** Each parameter's value by its key in upper case, unquoted; the first, where a key repeats. */
  readonly params: ReadonlyMap<string, string>;
  /** The value as written, unfolded. */
  readonly value: string;
}

/** A component (VCALENDAR, VEVENT, VTIMEZONE, STANDARD, …), with the components nested in it. */
export interface CalendarComponentTree {
  /** The name, upper case. */
  readonly name: string;
  readonly properties: ReadonlyArray<CalendarProperty>;
  readonly components: ReadonlyArray<CalendarComponentTree>;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The widest a zone's offset is taken to be, either way, in deciding which
 * days a walk may skip: wider than any offset in use (UTC−12 to UTC+14), so a
 * day skipped holds no occurrence that could end at or after the start.
 */
const OFFSET_SLACK = 26 * HOUR;

/** The furthest from UTC a VTIMEZONE's offset is read: further, it is no zone's. */
const MOST_A_ZONE_IS_OFF = 18 * HOUR;

/** The longest walk through a rule, in days: four hundred years. A longer one decides nothing. */
const LONGEST_WALK_DAYS = 146_097;

/** The components whose addresses the change reaches (`applyAddressChanges`). */
const SCHEDULED: ReadonlySet<string> = new Set(['VEVENT', 'VTODO', 'VJOURNAL']);

/**
 * Is this calendar object over at `start`: did its last occurrence end before
 * it? False wherever its dates cannot be read.
 *
 * @param roots the object's components, as the content-line reader nests them
 *              (a VCALENDAR, or a component written without one).
 * @param start the migration's start: one moment, never moved by a pass.
 */
export function calendarObjectIsOverAt(roots: ReadonlyArray<CalendarComponentTree>, start: Date): boolean {
  const at = start.getTime();
  if (!Number.isFinite(at)) return false;
  const calendars = roots.filter((c) => c.name === 'VCALENDAR');
  const top = calendars.length > 0 ? calendars.flatMap((c) => c.components) : roots;
  const scheduled = top.filter((c) => SCHEDULED.has(c.name));
  if (scheduled.length === 0) return false;
  const zones = zoneBook(top);
  return scheduled.every((c) => componentIsOver(c, at, zones));
}

function componentIsOver(c: CalendarComponentTree, at: number, zones: ZoneBook): boolean {
  if (c.name === 'VTODO') return taskIsDone(c);
  return occurrencesEndBefore(c, at, zones, c.name === 'VJOURNAL');
}

/** A task that is done: completed or cancelled, by its status or a completion time. */
function taskIsDone(c: CalendarComponentTree): boolean {
  const status = first(c, 'STATUS')?.value.trim().toUpperCase();
  return status === 'COMPLETED' || status === 'CANCELLED' || first(c, 'COMPLETED') !== undefined;
}

// ---------------------------------------------------------------------------
// Occurrences

/**
 * Did every occurrence of this event or journal entry end before `at`?
 * Its own first one, each `RDATE`, and each rule's.
 */
function occurrencesEndBefore(c: CalendarComponentTree, at: number, zones: ZoneBook, journal: boolean): boolean {
  const dtstart = momentOf(first(c, 'DTSTART'), zones);
  if (dtstart === undefined) return false;
  // An instance the series' rule moved to `RANGE=THISANDFUTURE` moves the
  // instances after it too, which this does not follow: not read.
  if (first(c, 'RECURRENCE-ID')?.params.has('RANGE')) return false;
  // A journal entry is dated, not timed: over when its DTSTART is before the start.
  const length = journal ? { span: ZERO_SPAN, firstEnd: endOf(dtstart.wall, dtstart.zone, ZERO_SPAN) } : spanOf(c, dtstart, zones);
  if (length === undefined) return false;
  const { span, firstEnd } = length;
  if (firstEnd >= at) return false;
  for (const p of all(c, 'RDATE')) {
    const ends = rdateEnds(p, span, zones);
    if (ends === undefined || ends.some((e) => e >= at)) return false;
  }
  return all(c, 'RRULE').every((r) => ruleEndsBefore(r.value, dtstart, span, at));
}

/**
 * How an occurrence's end follows its start (RFC 5545 §3.8.5.3): the same
 * exact length for every occurrence when `DTEND` gives it, the same nominal
 * one (days on the wall clock, then the rest exactly) when `DURATION` does.
 */
type Span =
  | { readonly kind: 'exact'; readonly ms: number }
  | { readonly kind: 'nominal'; readonly days: number; readonly ms: number };

const ZERO_SPAN: Span = { kind: 'exact', ms: 0 };

/**
 * How long each occurrence lasts, and the latest instant the first one, at
 * DTSTART, ends: its own DTEND where it has one, read directly rather than as
 * a length added to its start, so a zone read only as a range of offsets
 * widens it once, not twice.
 */
function spanOf(
  c: CalendarComponentTree,
  dtstart: Moment,
  zones: ZoneBook,
): { readonly span: Span; readonly firstEnd: number } | undefined {
  const dtend = first(c, 'DTEND');
  const duration = first(c, 'DURATION');
  // Both is a contradiction (RFC 5545 §3.6.1: one or the other), not a date.
  if (dtend !== undefined && duration !== undefined) return undefined;
  const start = readingsOf(dtstart.wall, dtstart.zone);
  let span: Span;
  if (dtend !== undefined) {
    const end = momentOf(dtend, zones);
    if (end === undefined) return undefined;
    const latestEnd = readingsOf(end.wall, end.zone).latest;
    // For the occurrences after the first: from the earliest reading of the
    // start to the latest of the end, the longest it can be.
    span = { kind: 'exact', ms: Math.max(0, latestEnd - start.earliest) };
    return { span, firstEnd: Math.max(start.latest, latestEnd) };
  }
  if (duration !== undefined) {
    const d = durationOf(duration.value);
    if (d === undefined) return undefined;
    span = { kind: 'nominal', ...d };
  } else {
    // All day: to the end of DTSTART's day. With a time: at DTSTART (RFC 5545 §3.6.1).
    span = dtstart.date ? { kind: 'nominal', days: 1, ms: 0 } : ZERO_SPAN;
  }
  return { span, firstEnd: endOf(dtstart.wall, dtstart.zone, span) };
}

/** The latest instant an occurrence starting at this wall time can end, and never before it starts. */
function endOf(wall: number, zone: Zone, span: Span): number {
  const start = readingsOf(wall, zone).latest;
  const end = span.kind === 'exact' ? start + span.ms : readingsOf(wall + span.days * DAY, zone).latest + span.ms;
  return Math.max(start, end);
}

/** The most an occurrence's end can lie after its start's wall time, for deciding which days a walk may skip. */
function spanUpper(span: Span): number {
  return span.kind === 'exact' ? span.ms : span.days * DAY + span.ms + OFFSET_SLACK;
}

/**
 * The latest end of each occurrence one `RDATE` adds: a date or a date-time,
 * which lasts as the event does, or a `PERIOD`, which says its own end or
 * length. Undefined when any of its values cannot be read.
 */
function rdateEnds(p: CalendarProperty, span: Span, zones: ZoneBook): number[] | undefined {
  const out: number[] = [];
  for (const raw of p.value.split(',')) {
    const value = raw.trim();
    if (value === '') continue;
    const slash = value.indexOf('/');
    if (slash === -1) {
      const s = momentOfValue(value, p.params, zones);
      if (s === undefined) return undefined;
      out.push(endOf(s.wall, s.zone, span));
      continue;
    }
    const s = momentOfValue(value.slice(0, slash), p.params, zones);
    if (s === undefined) return undefined;
    const rest = value.slice(slash + 1);
    const end = momentOfValue(rest, p.params, zones);
    const length = end === undefined ? durationOf(rest) : undefined;
    if (end === undefined && length === undefined) return undefined;
    out.push(
      end !== undefined
        ? Math.max(readingsOf(s.wall, s.zone).latest, readingsOf(end.wall, end.zone).latest)
        : endOf(s.wall, s.zone, { kind: 'nominal', ...length! }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recurrence rules (RFC 5545 §3.3.10)

/** Monday is 0, as WEEKDAYS counts. */
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

const FREQUENCIES: ReadonlySet<string> = new Set(['SECONDLY', 'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

/** The frequencies the walk below steps through, a day at a time. */
const WALKED_FREQUENCIES: ReadonlySet<string> = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

/** The parts the walk reads. Any other makes a rule one it does not walk. */
const WALKED_PARTS: ReadonlySet<string> = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST']);

interface Rule {
  readonly freq: string;
  readonly interval: number;
  readonly count?: number;
  readonly until?: string;
  /** Each weekday, Monday 0, and its ordinal in the month or year (0 for every one). */
  readonly byDay?: ReadonlyArray<{ readonly n: number; readonly day: number }>;
  readonly byMonthDay?: ReadonlyArray<number>;
  readonly byMonth?: ReadonlyArray<number>;
  readonly wkst: number;
  /** Every part is one the day walk reads. */
  readonly walkable: boolean;
}

/** A rule read, or undefined where it is not one RFC 5545 allows. */
function ruleOf(value: string): Rule | undefined {
  const parts = new Map<string, string>();
  for (const part of value.split(';')) {
    if (part.trim() === '') continue;
    const eq = part.indexOf('=');
    if (eq <= 0) return undefined;
    const key = part.slice(0, eq).trim().toUpperCase();
    if (parts.has(key)) return undefined;
    parts.set(key, part.slice(eq + 1).trim());
  }
  const freq = parts.get('FREQ')?.toUpperCase();
  if (freq === undefined || !FREQUENCIES.has(freq)) return undefined;
  const interval = parts.has('INTERVAL') ? positive(parts.get('INTERVAL')!) : 1;
  const count = parts.has('COUNT') ? positive(parts.get('COUNT')!) : undefined;
  if (interval === undefined || (parts.has('COUNT') && count === undefined)) return undefined;
  const until = parts.get('UNTIL');
  // RFC 5545 §3.3.10: "UNTIL or COUNT ... MUST NOT occur in the same 'recur'".
  if (count !== undefined && until !== undefined) return undefined;
  let walkable = WALKED_FREQUENCIES.has(freq) && [...parts.keys()].every((k) => WALKED_PARTS.has(k));

  let byDay: { n: number; day: number }[] | undefined;
  if (parts.has('BYDAY')) {
    byDay = [];
    for (const entry of parts.get('BYDAY')!.split(',')) {
      const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(entry.trim());
      const n = m?.[1] === undefined ? 0 : Number(m[1]);
      if (!m || (m[1] !== undefined && (n === 0 || Math.abs(n) > 53))) return undefined;
      byDay.push({ n, day: WEEKDAYS.indexOf(m[2]!.toUpperCase() as (typeof WEEKDAYS)[number]) });
    }
    // An ordinal is for a month or a year (RFC 5545 §3.3.10), never a day or a week.
    if ((freq === 'DAILY' || freq === 'WEEKLY') && byDay.some((d) => d.n !== 0)) walkable = false;
  }
  const byMonthDay = listOf(parts.get('BYMONTHDAY'), (v) => v !== 0 && Math.abs(v) <= 31);
  const byMonth = listOf(parts.get('BYMONTH'), (v) => v >= 1 && v <= 12);
  if (byMonthDay === null || byMonth === null) return undefined;
  // "The BYMONTHDAY rule part MUST NOT be specified when the FREQ rule part is set to WEEKLY."
  if (byMonthDay !== undefined && freq === 'WEEKLY') walkable = false;
  const wkstName = parts.get('WKST')?.toUpperCase();
  const wkst = wkstName === undefined ? 0 : WEEKDAYS.indexOf(wkstName as (typeof WEEKDAYS)[number]);
  if (wkst === -1) return undefined;
  return {
    freq,
    interval,
    ...(count !== undefined ? { count } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(byDay !== undefined ? { byDay } : {}),
    ...(byMonthDay !== undefined ? { byMonthDay } : {}),
    ...(byMonth !== undefined ? { byMonth } : {}),
    wkst,
    walkable,
  };
}

/** A positive whole number, or undefined. */
function positive(text: string): number | undefined {
  return /^\d{1,9}$/.test(text) && Number(text) > 0 ? Number(text) : undefined;
}

/** A comma list of whole numbers, each allowed; undefined when absent, null when any is not. */
function listOf(text: string | undefined, allowed: (v: number) => boolean): number[] | undefined | null {
  if (text === undefined) return undefined;
  const out: number[] = [];
  for (const entry of text.split(',')) {
    if (!/^[+-]?\d{1,3}$/.test(entry.trim())) return null;
    const v = Number(entry.trim());
    if (!allowed(v)) return null;
    out.push(v);
  }
  return out;
}

/** Did every occurrence this rule makes end before `at`? */
function ruleEndsBefore(value: string, dtstart: Moment, span: Span, at: number): boolean {
  const rule = ruleOf(value);
  if (rule === undefined) return false;
  // Open-ended: it never is.
  if (rule.count === undefined && rule.until === undefined) return false;
  const walk = walkFrom(dtstart, span, at);
  if (rule.until !== undefined) {
    const until = untilOf(rule.until, dtstart);
    if (until === undefined) return false;
    // Over by UNTIL alone, whatever the rule's parts: even an occurrence
    // starting at the last moment UNTIL allows would have ended before the start.
    if (until.lastEnd(span) < at) return true;
    if (!rule.walkable) return false;
    // Walked from the first day an occurrence could still end at or after the start.
    const last = Math.min(until.lastDay, walk.skipBefore + LONGEST_WALK_DAYS);
    for (let dn = Math.max(walk.firstDay, walk.skipBefore); dn <= last; dn += 1) {
      if (!makes(rule, dn, walk)) continue;
      const wall = dn * DAY + walk.timeOfDay;
      // The first occurrence past UNTIL: every one it allows ended before the start.
      if (!until.includes(wall)) return true;
      if (endOf(wall, dtstart.zone, span) >= at) return false;
    }
    // Past UNTIL's last day, every occurrence it allows was walked; short of it, nothing is decided.
    return last === until.lastDay;
  }
  if (!rule.walkable) return false;
  // Walked from DTSTART, counting, to the last day an occurrence could start before the start.
  if (walk.lastDay - walk.firstDay > LONGEST_WALK_DAYS) return false;
  let made = 0;
  for (let dn = walk.firstDay; dn <= walk.lastDay; dn += 1) {
    if (!makes(rule, dn, walk)) continue;
    if (dn >= walk.skipBefore && endOf(dn * DAY + walk.timeOfDay, dtstart.zone, span) >= at) return false;
    made += 1;
    if (made >= rule.count!) return true;
  }
  // The count runs on past the start.
  return false;
}

/** Where a walk starts and what it compares each day with: DTSTART's own day. */
interface Walk {
  readonly firstDay: number;
  readonly timeOfDay: number;
  readonly year: number;
  readonly month: number;
  readonly date: number;
  readonly weekday: number;
  /** Before this day, every occurrence ended before the start, whatever the zone. */
  readonly skipBefore: number;
  /** After this day, every occurrence starts after the start. */
  readonly lastDay: number;
}

function walkFrom(dtstart: Moment, span: Span, at: number): Walk {
  const firstDay = Math.floor(dtstart.wall / DAY);
  const c = civil(firstDay);
  return {
    firstDay,
    timeOfDay: dtstart.wall - firstDay * DAY,
    year: c.year,
    month: c.month,
    date: c.date,
    weekday: weekdayOf(firstDay),
    skipBefore: Math.floor((at - spanUpper(span) - OFFSET_SLACK) / DAY) - 1,
    lastDay: Math.floor((at + OFFSET_SLACK) / DAY) + 1,
  };
}

/**
 * Does the rule make an occurrence on this day? RFC 5545 §3.3.10's expansion,
 * read as a test of one day: the day must fall in an INTERVAL-th period from
 * DTSTART's, and each BY part either limits or expands to it. With neither
 * BYDAY nor BYMONTHDAY, the day is DTSTART's own in its week, month or year,
 * as the RFC's defaults have it.
 */
function makes(rule: Rule, dn: number, walk: Walk): boolean {
  const { year, month, date } = civil(dn);
  const weekday = weekdayOf(dn);
  let period: number;
  switch (rule.freq) {
    case 'DAILY':
      period = dn - walk.firstDay;
      break;
    case 'WEEKLY':
      period = weekOf(dn, rule.wkst) - weekOf(walk.firstDay, rule.wkst);
      break;
    case 'MONTHLY':
      period = year * 12 + month - (walk.year * 12 + walk.month);
      break;
    default:
      period = year - walk.year;
  }
  if (period < 0 || period % rule.interval !== 0) return false;
  if (rule.byMonth !== undefined && !rule.byMonth.includes(month)) return false;
  if (rule.byDay === undefined && rule.byMonthDay === undefined) {
    switch (rule.freq) {
      case 'WEEKLY':
        return weekday === walk.weekday;
      case 'MONTHLY':
        return date === walk.date;
      case 'YEARLY':
        return date === walk.date && (rule.byMonth !== undefined || month === walk.month);
      default:
        return true;
    }
  }
  const length = daysInMonth(year, month);
  if (rule.byMonthDay !== undefined && !rule.byMonthDay.some((v) => (v > 0 ? date === v : date === length + v + 1))) {
    return false;
  }
  if (rule.byDay === undefined) return true;
  return rule.byDay.some(({ n, day }) => {
    if (day !== weekday) return false;
    if (n === 0) return true;
    // The nth such weekday of the month (MONTHLY, or YEARLY with BYMONTH), else of the year.
    if (rule.freq === 'MONTHLY' || rule.byMonth !== undefined) {
      return n === (n > 0 ? Math.floor((date - 1) / 7) + 1 : -(Math.floor((length - date) / 7) + 1));
    }
    const ofYear = dn - dayNumber(year, 1, 1);
    const days = isLeap(year) ? 366 : 365;
    return n === (n > 0 ? Math.floor(ofYear / 7) + 1 : -(Math.floor((days - 1 - ofYear) / 7) + 1));
  });
}

/** What a rule's UNTIL allows: whether an occurrence starting at a wall time is in, and how late the last can end. */
interface Until {
  readonly includes: (wall: number) => boolean;
  /** The last day an occurrence it allows can start on. */
  readonly lastDay: number;
  /** The latest end of an occurrence starting at the last moment it allows. */
  readonly lastEnd: (span: Span) => number;
}

/**
 * UNTIL, read against DTSTART (RFC 5545 §3.3.10). A UTC date-time is an
 * instant; a date-time without `Z`, which some sources write, is a wall time
 * in DTSTART's zone; a date allows the whole of that day. Inclusive in every
 * form, and read at the earliest instant a wall time can mean, so an
 * occurrence is never left out by a daylight saving change.
 */
function untilOf(value: string, dtstart: Moment): Until | undefined {
  const m = parseDateValue(value);
  if (m === undefined) return undefined;
  if (m.date) {
    const day = Math.floor(m.wall / DAY);
    const lastStart = day * DAY + (dtstart.wall - Math.floor(dtstart.wall / DAY) * DAY);
    return {
      includes: (wall) => Math.floor(wall / DAY) <= day,
      lastDay: day,
      lastEnd: (span) => endOf(lastStart, dtstart.zone, span),
    };
  }
  if (m.utc) {
    const instant = m.wall;
    const lastWall = latestWallOf(instant, dtstart.zone);
    return {
      includes: (wall) => readingsOf(wall, dtstart.zone).earliest <= instant,
      lastDay: Math.floor((instant + OFFSET_SLACK) / DAY),
      lastEnd: (span) => Math.max(instant, endOf(lastWall, dtstart.zone, span)),
    };
  }
  return {
    includes: (wall) => wall <= m.wall,
    lastDay: Math.floor(m.wall / DAY),
    lastEnd: (span) => endOf(m.wall, dtstart.zone, span),
  };
}

// ---------------------------------------------------------------------------
// Dates, durations and zones

/** A date or a date-time as written: its wall clock read as if it were UTC, in ms, and the zone it is in. */
interface Moment {
  readonly wall: number;
  /** A DATE: a whole day, with no time. */
  readonly date: boolean;
  readonly zone: Zone;
}

/** How a wall time becomes an instant. */
type Zone =
  | { readonly kind: 'utc' }
  | { readonly kind: 'iana'; readonly offsetAt: (instant: number) => number }
  | { readonly kind: 'offsets'; readonly min: number; readonly max: number };

/** `Z`, and every floating time and date: read in UTC, as the module's header says. */
const UTC: Zone = { kind: 'utc' };

/** A TZID's zone, or undefined when nothing names it. */
type ZoneBook = (tzid: string) => Zone | undefined;

function momentOf(p: CalendarProperty | undefined, zones: ZoneBook): Moment | undefined {
  return p === undefined ? undefined : momentOfValue(p.value, p.params, zones);
}

function momentOfValue(value: string, params: ReadonlyMap<string, string>, zones: ZoneBook): Moment | undefined {
  const m = parseDateValue(value);
  if (m === undefined) return undefined;
  if (m.utc) return { wall: m.wall, date: false, zone: UTC };
  const tzid = params.get('TZID');
  // FLOATING (no `Z`, no `TZID`), and a DATE: read in UTC.
  if (tzid === undefined || tzid.trim() === '') return { wall: m.wall, date: m.date, zone: UTC };
  const zone = zones(tzid.trim());
  return zone === undefined ? undefined : { wall: m.wall, date: m.date, zone };
}

/** `YYYYMMDD`, or `YYYYMMDDTHHMMSS` with an optional `Z`, checked to be a real day and time. */
function parseDateValue(value: string): { readonly wall: number; readonly date: boolean; readonly utc: boolean } | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i.exec(value.trim());
  if (!m) return undefined;
  const [year, month, date] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || date < 1 || date > daysInMonth(year, month)) return undefined;
  const time = m[4] === undefined ? undefined : [Number(m[4]), Number(m[5]), Number(m[6])];
  // A leap second (60) is allowed, and reads as the next minute's start.
  if (time && (time[0]! > 23 || time[1]! > 59 || time[2]! > 60)) return undefined;
  const t = time ?? [0, 0, 0];
  return {
    wall: dayNumber(year, month, date) * DAY + t[0]! * HOUR + t[1]! * MINUTE + t[2]! * SECOND,
    date: time === undefined,
    utc: m[7] !== undefined,
  };
}

/** An RFC 5545 duration (`P1DT2H`, `PT30M`, `P1W`), as whole days and the rest; undefined when not one, or negative. */
function durationOf(value: string): { readonly days: number; readonly ms: number } | undefined {
  const m = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m || m.slice(1).every((g) => g === undefined)) return undefined;
  const [w, d, h, min, s] = m.slice(1).map((g) => (g === undefined ? 0 : Number(g)));
  return { days: w! * 7 + d!, ms: h! * HOUR + min! * MINUTE + s! * SECOND };
}

/**
 * The zones an object can be read in: an IANA name the runtime knows, or a
 * `VTIMEZONE` of the object's own, by its `TZID`. The IANA reading is exact;
 * a `VTIMEZONE` is read only as the range of the offsets it lists, which is
 * all a reading needs to fall on the safe side.
 */
function zoneBook(top: ReadonlyArray<CalendarComponentTree>): ZoneBook {
  const own = new Map<string, Zone>();
  for (const c of top) {
    if (c.name !== 'VTIMEZONE') continue;
    const id = first(c, 'TZID')?.value.trim();
    if (id === undefined || id === '') continue;
    const offsets = c.components.flatMap((o) =>
      o.properties.filter((p) => p.name === 'TZOFFSETTO' || p.name === 'TZOFFSETFROM').map((p) => offsetOf(p.value)),
    );
    // An offset no zone has used (UTC−12 to UTC+14, ±15 with local mean
    // time) is a VTIMEZONE that cannot be read, and so is its TZID.
    if (offsets.length === 0 || offsets.some((o) => o === undefined || Math.abs(o) > MOST_A_ZONE_IS_OFF)) continue;
    const known = offsets as number[];
    own.set(id, { kind: 'offsets', min: Math.min(...known), max: Math.max(...known) });
  }
  return (tzid) => ianaZone(tzid) ?? own.get(tzid);
}

/** `+0100`, `-0530`, `+013000`: an offset from UTC, in ms. */
function offsetOf(value: string): number | undefined {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value.trim());
  if (!m) return undefined;
  const ms = Number(m[2]) * HOUR + Number(m[3]) * MINUTE + Number(m[4] ?? 0) * SECOND;
  return m[1] === '-' ? -ms : ms;
}

/** Each IANA name asked about, and its zone; null for a name the runtime does not know. */
const IANA = new Map<string, Zone | null>();

function ianaZone(name: string): Zone | undefined {
  let zone = IANA.get(name);
  if (zone === undefined) {
    let format: Intl.DateTimeFormat | undefined;
    try {
      format = new Intl.DateTimeFormat('en-US', {
        timeZone: name,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
    } catch {
      // A RangeError: not a zone this runtime knows. The object's own VTIMEZONE may be.
      format = undefined;
    }
    zone = format === undefined ? null : { kind: 'iana', offsetAt: offsetsIn(format) };
    IANA.set(name, zone);
  }
  return zone ?? undefined;
}

/** The zone's offset from UTC at an instant, in ms, as its wall clock reads it. */
function offsetsIn(format: Intl.DateTimeFormat): (instant: number) => number {
  return (instant) => {
    const whole = Math.floor(instant / SECOND) * SECOND;
    const parts = format.formatToParts(whole);
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
    const wall =
      dayNumber(read('year'), read('month'), read('day')) * DAY + read('hour') * HOUR + read('minute') * MINUTE + read('second') * SECOND;
    return wall - whole;
  };
}

/**
 * The earliest and the latest instant a wall time can mean in a zone. One and
 * the same, except where a daylight saving change makes the wall time twice
 * (both readings are valid) or skips it (both sides of the gap are given).
 */
function readingsOf(wall: number, zone: Zone): { readonly earliest: number; readonly latest: number } {
  switch (zone.kind) {
    case 'utc':
      return { earliest: wall, latest: wall };
    case 'offsets':
      return { earliest: wall - zone.max, latest: wall - zone.min };
    case 'iana': {
      const offsets = [...new Set([zone.offsetAt(wall - DAY), zone.offsetAt(wall), zone.offsetAt(wall + DAY)])];
      const valid = offsets.map((o) => wall - o).filter((instant) => wall - zone.offsetAt(instant) === instant);
      const readings = valid.length > 0 ? valid : offsets.map((o) => wall - o);
      return { earliest: Math.min(...readings), latest: Math.max(...readings) };
    }
  }
}

/** The latest wall time an instant can show in a zone. */
function latestWallOf(instant: number, zone: Zone): number {
  switch (zone.kind) {
    case 'utc':
      return instant;
    case 'offsets':
      return instant + zone.max;
    case 'iana':
      return instant + zone.offsetAt(instant);
  }
}

// ---------------------------------------------------------------------------
// The calendar, by day number (days since 1970-01-01)

function dayNumber(year: number, month: number, date: number): number {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, date);
  return Math.floor(t.getTime() / DAY);
}

function civil(dn: number): { readonly year: number; readonly month: number; readonly date: number } {
  const t = new Date(dn * DAY);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, date: t.getUTCDate() };
}

/** Monday 0 to Sunday 6: 1970-01-01 was a Thursday. */
function weekdayOf(dn: number): number {
  return (((dn + 3) % 7) + 7) % 7;
}

/** The week a day falls in, counting weeks that start on `wkst`. */
function weekOf(dn: number, wkst: number): number {
  return Math.floor((dn - ((weekdayOf(dn) - wkst + 7) % 7)) / 7);
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

// ---------------------------------------------------------------------------

function first(c: CalendarComponentTree, name: string): CalendarProperty | undefined {
  return c.properties.find((p) => p.name === name);
}

function all(c: CalendarComponentTree, name: string): CalendarProperty[] {
  return c.properties.filter((p) => p.name === name);
}
