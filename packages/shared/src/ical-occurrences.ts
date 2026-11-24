// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHEN AN EVENT LAST ENDS, READ FROM ITS OWN ICALENDAR (workplan 0170 §4.3).
 *
 * A window of the last 90 days copies every event that ends on or after its
 * `since`, and every recurring series with an occurrence on or after it, whole
 * (D1 (a)). This file answers the one question that needs: the LATEST moment
 * any occurrence of a VEVENT can end, as an upper bound in UTC milliseconds.
 * An event is out of the window only when that bound is before `since`; every
 * step below rounds towards *later*, so a bound may hold an event a little
 * early and never leaves one out.
 *
 * What it reads, and from where:
 *
 *  - Each component's OWN properties. A VTIMEZONE's `STANDARD`/`DAYLIGHT`
 *    start (often 1970) and a VALARM's trigger are never the event's.
 *  - A time with `Z` is exact. A `TZID` that names an IANA zone, directly or
 *    as the tail of a path (`/mozilla.org/…/Europe/Amsterdam`), is read
 *    through the platform's time-zone data. Any other `TZID` (a Windows name
 *    from Exchange) is bounded by the offsets its own VTIMEZONE declares. A
 *    floating time, a date, or a zone named nowhere is bounded by the widest
 *    offsets there are (UTC−12 to UTC+14), so only an end within half a day
 *    of `since` is held for it.
 *  - DTEND, or DURATION, or RFC 5545 §3.6.1's default: a date lasts its day, a
 *    date-time no time at all.
 *  - RRULE's `UNTIL` (UTC, local or a date) and `COUNT`. `COUNT` is turned
 *    into a last start only where the rule's period is fixed: any FREQ with no
 *    BY-part, except a month day past the 28th or the 29th of February, which
 *    a short month or year skips; and WEEKLY with plain BYDAY days, which
 *    yields at least one occurrence each of its weeks. Any other COUNT, or a
 *    rule with neither, is held: a series with no end is always in.
 *  - RDATE, as dates, date-times or periods.
 *  - EXDATE and EXRULE only take occurrences away, so a bound that ignores
 *    them is still a bound.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The widest offsets from UTC any zone has: UTC−12:00 and UTC+14:00. */
const MIN_OFFSET_MS = -12 * HOUR_MS;
const MAX_OFFSET_MS = 14 * HOUR_MS;

/** One content line, unfolded, with its parameters. */
export interface IcalProperty {
  readonly name: string;
  readonly params: Readonly<Record<string, string>>;
  readonly value: string;
}

/** One component and the components inside it. */
export interface IcalComponent {
  readonly name: string;
  readonly properties: ReadonlyArray<IcalProperty>;
  readonly children: ReadonlyArray<IcalComponent>;
}

/** An iCalendar object as a tree of components; lines outside any are dropped. */
export function parseIcalComponents(icalendar: string): ReadonlyArray<IcalComponent> {
  const lines = icalendar.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  type Mutable = { name: string; properties: IcalProperty[]; children: Mutable[] };
  const roots: Mutable[] = [];
  const stack: Mutable[] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const property = parseContentLine(line);
    if (property === undefined) continue;
    if (property.name === 'BEGIN') {
      const component: Mutable = { name: property.value.trim().toUpperCase(), properties: [], children: [] };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(component);
      else roots.push(component);
      stack.push(component);
    } else if (property.name === 'END') {
      // Closes the nearest component of that name; a stray END is ignored.
      const name = property.value.trim().toUpperCase();
      const at = stack.map((c) => c.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
    } else {
      stack[stack.length - 1]?.properties.push(property);
    }
  }
  return roots;
}

/** Every component of a name, at any depth. */
export function componentsNamed(roots: ReadonlyArray<IcalComponent>, name: string): IcalComponent[] {
  const out: IcalComponent[] = [];
  const walk = (list: ReadonlyArray<IcalComponent>): void => {
    for (const c of list) {
      if (c.name === name) out.push(c);
      walk(c.children);
    }
  };
  walk(roots);
  return out;
}

/** `NAME;P=V;Q="a:b":value`, or `undefined` for a line that is not one. */
function parseContentLine(line: string): IcalProperty | undefined {
  const nameMatch = /^[A-Za-z0-9-]+/.exec(line);
  if (!nameMatch) return undefined;
  const name = nameMatch[0].toUpperCase();
  const params: Record<string, string> = {};
  let i = nameMatch[0].length;
  while (line[i] === ';') {
    const eq = line.indexOf('=', i);
    if (eq < 0) return undefined;
    const key = line.slice(i + 1, eq).toUpperCase();
    i = eq + 1;
    let value = '';
    // A parameter may hold several values, each quoted or not.
    for (;;) {
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1);
        if (close < 0) return undefined;
        value += line.slice(i + 1, close);
        i = close + 1;
      } else {
        const m = /^[^;:,]*/.exec(line.slice(i));
        value += m?.[0] ?? '';
        i += m?.[0].length ?? 0;
      }
      if (line[i] !== ',') break;
      value += ',';
      i += 1;
    }
    params[key] = value;
  }
  if (line[i] !== ':') return undefined;
  return { name, params, value: line.slice(i + 1) };
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/**
 * A DATE or DATE-TIME value. `wall` is its clock reading as if it were UTC;
 * `zone` says how to turn it into an instant.
 */
interface IcalTime {
  readonly wall: number;
  readonly dateOnly: boolean;
  readonly zone: Zone;
}

/** How a wall-clock time becomes an instant. */
type Zone =
  | { readonly kind: 'utc' }
  | { readonly kind: 'iana'; readonly id: string }
  /** Offsets, in ms, a TZID's own VTIMEZONE declares. */
  | { readonly kind: 'declared'; readonly offsets: ReadonlyArray<number> }
  /** A floating time, a date, or a TZID nothing here can read. */
  | { readonly kind: 'unknown' };

/** The VTIMEZONEs of an object, by TZID, as the offsets each declares. */
export type DeclaredZones = ReadonlyMap<string, ReadonlyArray<number>>;

export function declaredZones(roots: ReadonlyArray<IcalComponent>): DeclaredZones {
  const zones = new Map<string, number[]>();
  for (const tz of componentsNamed(roots, 'VTIMEZONE')) {
    const id = tz.properties.find((p) => p.name === 'TZID')?.value.trim();
    if (!id) continue;
    const offsets: number[] = [];
    for (const rule of tz.children) {
      for (const p of rule.properties) {
        if (p.name !== 'TZOFFSETTO' && p.name !== 'TZOFFSETFROM') continue;
        const ms = parseUtcOffset(p.value);
        if (ms !== undefined) offsets.push(ms);
      }
    }
    if (offsets.length > 0) zones.set(id, offsets);
  }
  return zones;
}

/** `+0100`, `-0530`, `+013000` as ms, or `undefined`. */
function parseUtcOffset(value: string): number | undefined {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value.trim());
  if (!m) return undefined;
  const ms = (+m[2]! * 3600 + +m[3]! * 60 + +(m[4] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(id: string): Intl.DateTimeFormat | null {
  let f = formatters.get(id);
  if (f !== undefined) return f;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: id,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    // Not a zone this platform knows: the caller bounds it another way.
    f = null;
  }
  formatters.set(id, f);
  return f;
}

/** A TZID as an IANA zone: itself, or the tail of a path that ends in one. */
function ianaZone(tzid: string): string | undefined {
  const id = tzid.trim();
  if (id === '') return undefined;
  if (formatterFor(id)) return id;
  const segments = id.split('/').filter((s) => s !== '');
  for (let start = 1; start < segments.length; start++) {
    const candidate = segments.slice(start).join('/');
    if (formatterFor(candidate)) return candidate;
  }
  return undefined;
}

/** An IANA zone's offset from UTC at an instant, in ms. */
function ianaOffset(id: string, instant: number): number {
  const f = formatterFor(id)!;
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(instant))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function zoneOf(params: Readonly<Record<string, string>>, utc: boolean, zones: DeclaredZones): Zone {
  if (utc) return { kind: 'utc' };
  const tzid = params['TZID'];
  if (tzid === undefined) return { kind: 'unknown' };
  const iana = ianaZone(tzid);
  if (iana !== undefined) return { kind: 'iana', id: iana };
  const declared = zones.get(tzid.trim());
  if (declared !== undefined) return { kind: 'declared', offsets: declared };
  return { kind: 'unknown' };
}

/** A DATE or DATE-TIME value, or `undefined` when it does not parse. */
function parseTime(value: string, params: Readonly<Record<string, string>>, zones: DeclaredZones): IcalTime | undefined {
  const v = value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date) {
    const wall = wallOf(+date[1]!, +date[2]!, +date[3]!, 0, 0, 0);
    return wall === undefined ? undefined : { wall, dateOnly: true, zone: { kind: 'unknown' } };
  }
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(v);
  if (!time) return undefined;
  const wall = wallOf(+time[1]!, +time[2]!, +time[3]!, +time[4]!, +time[5]!, +time[6]!);
  if (wall === undefined) return undefined;
  return { wall, dateOnly: false, zone: zoneOf(params, time[7] !== '', zones) };
}

function wallOf(y: number, mo: number, d: number, h: number, mi: number, s: number): number | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59 || s > 60) return undefined;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isFinite(ms) ? ms : undefined;
}

/** The latest instant a wall-clock time in a zone can be. */
function latestInstant(wall: number, zone: Zone): number {
  switch (zone.kind) {
    case 'utc':
      return wall;
    case 'iana': {
      // The smallest offset around it: a time in a DST change's gap or
      // overlap is read as the later of the two instants it could be.
      const offsets = [wall - DAY_MS, wall, wall + DAY_MS].map((at) => ianaOffset(zone.id, at));
      return wall - Math.min(...offsets);
    }
    case 'declared':
      return wall - Math.min(...zone.offsets);
    case 'unknown':
      return wall - MIN_OFFSET_MS;
  }
}

/** The earliest instant a wall-clock time in a zone can be. */
function earliestInstant(wall: number, zone: Zone): number {
  switch (zone.kind) {
    case 'utc':
      return wall;
    case 'iana': {
      const offsets = [wall - DAY_MS, wall, wall + DAY_MS].map((at) => ianaOffset(zone.id, at));
      return wall - Math.max(...offsets);
    }
    case 'declared':
      return wall - Math.max(...zone.offsets);
    case 'unknown':
      return wall - MAX_OFFSET_MS;
  }
}

/**
 * How much longer than its wall-clock length an interval in a zone can last:
 * one hour across a DST change, the spread of a declared zone's offsets.
 */
function zoneSlack(zone: Zone): number {
  switch (zone.kind) {
    case 'utc':
    case 'unknown':
      // A floating time is the same clock at both ends.
      return 0;
    case 'iana':
      return HOUR_MS;
    case 'declared':
      return Math.max(...zone.offsets) - Math.min(...zone.offsets);
  }
}

function sameZone(a: IcalTime, b: IcalTime): boolean {
  if (a.zone.kind !== b.zone.kind) return false;
  if (a.zone.kind === 'iana' && b.zone.kind === 'iana') return a.zone.id === b.zone.id;
  if (a.zone.kind === 'declared' && b.zone.kind === 'declared') return a.zone.offsets === b.zone.offsets;
  return true;
}

/**
 * A time as ISO 8601: UTC with `Z` when the instant is known (a `Z` time, or
 * an IANA zone), `YYYY-MM-DDT00:00:00Z` for a date, and the wall clock with
 * no zone for a floating time or a zone the platform cannot read.
 */
export function icalTimeToIso(property: IcalProperty, zones: DeclaredZones): string | undefined {
  const t = parseTime(property.value, property.params, zones);
  if (t === undefined) return undefined;
  const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');
  if (t.dateOnly || t.zone.kind === 'utc') return iso(t.wall);
  if (t.zone.kind === 'iana') {
    const zone = t.zone.id;
    let instant = t.wall - ianaOffset(zone, t.wall);
    instant = t.wall - ianaOffset(zone, instant);
    return iso(instant);
  }
  return iso(t.wall).replace('Z', '');
}

// ---------------------------------------------------------------------------
// Durations and recurrence
// ---------------------------------------------------------------------------

/** An RFC 5545 §3.3.6 duration in ms; a negative one is read as none. */
function parseDuration(value: string): number | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m || value.trim().replace(/^[+-]?P/i, '') === '' || /T$/i.test(value.trim())) return undefined;
  const ms =
    (+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * DAY_MS + (+(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? 0 : ms;
}

function addMonths(wall: number, months: number): number {
  const d = new Date(wall);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  );
}

const FIXED_PERIOD_MS: Readonly<Record<string, number>> = {
  SECONDLY: 1000,
  MINUTELY: 60_000,
  HOURLY: HOUR_MS,
  DAILY: DAY_MS,
  WEEKLY: 7 * DAY_MS,
};

/**
 * The latest instant an occurrence of one RRULE can start, or `Infinity` when
 * the rule has no end, or `undefined` when this cannot bound it.
 */
function lastStartOfRule(rule: string, start: IcalTime, zones: DeclaredZones): number | undefined {
  const parts = new Map<string, string>();
  for (const part of rule.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) parts.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim());
  }
  const freq = parts.get('FREQ')?.toUpperCase();
  if (freq === undefined) return undefined;
  const until = parts.get('UNTIL');
  const count = parts.get('COUNT');
  if (until === undefined && count === undefined) return Infinity;

  const bounds: number[] = [];
  if (until !== undefined) {
    const u = parseTime(until, {}, zones);
    if (u !== undefined) {
      if (u.zone.kind === 'utc') bounds.push(u.wall);
      // A date: every occurrence on that day, in the series' own clock.
      else if (u.dateOnly) bounds.push(latestInstant(u.wall + DAY_MS, start.zone));
      // A local time (some servers send one for a TZID series): the series' clock.
      else bounds.push(latestInstant(u.wall, start.zone));
    }
  }
  if (count !== undefined && /^\d+$/.test(count)) {
    const n = Number(count);
    const interval = /^\d+$/.test(parts.get('INTERVAL') ?? '1') ? Math.max(1, Number(parts.get('INTERVAL') ?? '1')) : 1;
    const byParts = [...parts.keys()].filter((k) => k.startsWith('BY'));
    const startDate = new Date(start.wall);
    let lastWall: number | undefined;
    if (n === 0) lastWall = start.wall;
    else if (byParts.length === 0 && FIXED_PERIOD_MS[freq] !== undefined) {
      lastWall = start.wall + (n - 1) * interval * FIXED_PERIOD_MS[freq]!;
    } else if (byParts.length === 0 && freq === 'MONTHLY' && startDate.getUTCDate() <= 28) {
      lastWall = addMonths(start.wall, (n - 1) * interval);
    } else if (
      byParts.length === 0 &&
      freq === 'YEARLY' &&
      !(startDate.getUTCMonth() === 1 && startDate.getUTCDate() === 29)
    ) {
      lastWall = addMonths(start.wall, (n - 1) * interval * 12);
    } else if (
      freq === 'WEEKLY' &&
      byParts.length === 1 &&
      byParts[0] === 'BYDAY' &&
      /^(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*$/i.test(parts.get('BYDAY') ?? '')
    ) {
      // Each of its weeks holds at least one occurrence, its first DTSTART.
      lastWall = start.wall + n * interval * 7 * DAY_MS;
    }
    if (lastWall !== undefined) bounds.push(latestInstant(lastWall, start.zone));
  }
  return bounds.length > 0 ? Math.min(...bounds) : undefined;
}

/**
 * The latest instant any occurrence of a VEVENT can end, in UTC ms; `Infinity`
 * for a series with no end; `undefined` when this cannot tell (no DTSTART it
 * can read, an RRULE it cannot bound, an RDATE it cannot read).
 */
export function latestEnd(event: IcalComponent, zones: DeclaredZones): number | undefined {
  const prop = (name: string): IcalProperty | undefined => event.properties.find((p) => p.name === name);
  const dtstart = prop('DTSTART');
  if (dtstart === undefined) return undefined;
  const start = parseTime(dtstart.value, dtstart.params, zones);
  if (start === undefined) return undefined;

  // How long one occurrence lasts, at most, and when the first one ends.
  let length: number;
  let firstEnd: number;
  const dtend = prop('DTEND');
  const duration = prop('DURATION');
  if (dtend !== undefined) {
    const end = parseTime(dtend.value, dtend.params, zones);
    if (end === undefined) return undefined;
    firstEnd = latestInstant(end.wall, end.zone);
    length = sameZone(start, end)
      ? Math.max(0, end.wall - start.wall) + zoneSlack(start.zone)
      : Math.max(0, firstEnd - earliestInstant(start.wall, start.zone));
  } else if (duration !== undefined) {
    const ms = parseDuration(duration.value);
    if (ms === undefined) return undefined;
    length = ms + (ms > 0 ? zoneSlack(start.zone) : 0);
    firstEnd = latestInstant(start.wall + ms, start.zone);
  } else {
    // RFC 5545 §3.6.1: a date lasts its day, a date-time no time at all.
    length = start.dateOnly ? DAY_MS : 0;
    firstEnd = latestInstant(start.wall + length, start.zone);
  }

  let latest = firstEnd;
  for (const rrule of event.properties.filter((p) => p.name === 'RRULE')) {
    const lastStart = lastStartOfRule(rrule.value, start, zones);
    if (lastStart === undefined) return undefined;
    latest = Math.max(latest, lastStart + length);
  }
  for (const rdate of event.properties.filter((p) => p.name === 'RDATE')) {
    const isPeriod = rdate.params['VALUE']?.toUpperCase() === 'PERIOD';
    for (const value of rdate.value.split(',')) {
      if (isPeriod || value.includes('/')) {
        const [from, to] = value.split('/');
        const f = parseTime(from ?? '', rdate.params, zones);
        if (f === undefined || to === undefined) return undefined;
        const asTime = parseTime(to, rdate.params, zones);
        const asDuration = asTime === undefined ? parseDuration(to) : undefined;
        if (asTime !== undefined) latest = Math.max(latest, latestInstant(asTime.wall, asTime.zone));
        else if (asDuration !== undefined) latest = Math.max(latest, latestInstant(f.wall + asDuration, f.zone) + zoneSlack(f.zone));
        else return undefined;
        continue;
      }
      const t = parseTime(value, rdate.params, zones);
      if (t === undefined) return undefined;
      latest = Math.max(latest, latestInstant(t.wall, t.zone) + length);
    }
  }
  return latest;
}
