// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * OUTLOOK'S TIME ZONES, AS A CALENDAR SERVER READS THEM.
 *
 * Graph names an event's zone the way Windows does (`W. Europe Standard
 * Time`) in `originalStartTimeZone` and `originalEndTimeZone`, and sometimes
 * the IANA way (`Europe/Amsterdam`) when the event was made by another client.
 * A CalDAV or JMAP server reads IANA names. So the VEVENT this repository
 * builds from Graph's JSON (`graph-calendar-source.ts`) writes each time in
 * its IANA zone, and carries a VTIMEZONE for it, built from the platform's own
 * zone data (`Intl`), as RFC 5545 §3.6.5 asks of every TZID an object uses.
 *
 * The table is CLDR's `windowsZones.xml`, the `001` (territory-neutral) row of
 * each Windows zone. A name in neither form is not guessed: the caller writes
 * the time in UTC instead, which is the same instant, and says why.
 */

/** CLDR windowsZones, territory 001. */
const WINDOWS_TO_IANA: Readonly<Record<string, string>> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Aleutian Standard Time': 'America/Adak',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Marquesas Standard Time': 'Pacific/Marquesas',
  'Alaskan Standard Time': 'America/Anchorage',
  'UTC-09': 'Etc/GMT+9',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'UTC-08': 'Etc/GMT+8',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Mountain Standard Time': 'America/Denver',
  'Yukon Standard Time': 'America/Whitehorse',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Easter Island Standard Time': 'Pacific/Easter',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'Eastern Standard Time': 'America/New_York',
  'Haiti Standard Time': 'America/Port-au-Prince',
  'Cuba Standard Time': 'America/Havana',
  'US Eastern Standard Time': 'America/Indianapolis',
  'Turks And Caicos Standard Time': 'America/Grand_Turk',
  'Paraguay Standard Time': 'America/Asuncion',
  'Atlantic Standard Time': 'America/Halifax',
  'Venezuela Standard Time': 'America/Caracas',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'Tocantins Standard Time': 'America/Araguaina',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Argentina Standard Time': 'America/Buenos_Aires',
  'Greenland Standard Time': 'America/Godthab',
  'Montevideo Standard Time': 'America/Montevideo',
  'Magallanes Standard Time': 'America/Punta_Arenas',
  'Saint Pierre Standard Time': 'America/Miquelon',
  'Bahia Standard Time': 'America/Bahia',
  'UTC-02': 'Etc/GMT+2',
  'Mid-Atlantic Standard Time': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  UTC: 'Etc/UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Sao Tome Standard Time': 'Africa/Sao_Tome',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'Jordan Standard Time': 'Asia/Amman',
  'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Syria Standard Time': 'Asia/Damascus',
  'West Bank Standard Time': 'Asia/Hebron',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kiev',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Sudan Standard Time': 'Africa/Juba',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad',
  'Sudan Standard Time': 'Africa/Khartoum',
  'Libya Standard Time': 'Africa/Tripoli',
  'Namibia Standard Time': 'Africa/Windhoek',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Arab Standard Time': 'Asia/Riyadh',
  'Belarus Standard Time': 'Europe/Minsk',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Volgograd Standard Time': 'Europe/Volgograd',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Astrakhan Standard Time': 'Europe/Astrakhan',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Russia Time Zone 3': 'Europe/Samara',
  'Mauritius Standard Time': 'Indian/Mauritius',
  'Saratov Standard Time': 'Europe/Saratov',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
  'Pakistan Standard Time': 'Asia/Karachi',
  'Qyzylorda Standard Time': 'Asia/Qyzylorda',
  'India Standard Time': 'Asia/Calcutta',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Katmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Omsk Standard Time': 'Asia/Omsk',
  'Myanmar Standard Time': 'Asia/Rangoon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Altai Standard Time': 'Asia/Barnaul',
  'W. Mongolia Standard Time': 'Asia/Hovd',
  'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'Tomsk Standard Time': 'Asia/Tomsk',
  'China Standard Time': 'Asia/Shanghai',
  'North Asia East Standard Time': 'Asia/Irkutsk',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
  'Aus Central W. Standard Time': 'Australia/Eucla',
  'Transbaikal Standard Time': 'Asia/Chita',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'North Korea Standard Time': 'Asia/Pyongyang',
  'Korea Standard Time': 'Asia/Seoul',
  'Yakutsk Standard Time': 'Asia/Yakutsk',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Lord Howe Standard Time': 'Australia/Lord_Howe',
  'Bougainville Standard Time': 'Pacific/Bougainville',
  'Russia Time Zone 10': 'Asia/Srednekolymsk',
  'Magadan Standard Time': 'Asia/Magadan',
  'Norfolk Standard Time': 'Pacific/Norfolk',
  'Sakhalin Standard Time': 'Asia/Sakhalin',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'Russia Time Zone 11': 'Asia/Kamchatka',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'UTC+12': 'Etc/GMT-12',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Chatham Islands Standard Time': 'Pacific/Chatham',
  'UTC+13': 'Etc/GMT-13',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'Samoa Standard Time': 'Pacific/Apia',
  'Line Islands Standard Time': 'Pacific/Kiritimati',
};

/** Whether the platform's zone data knows `zone`. */
function platformKnows(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The IANA zone for a name Graph gave, or `undefined` when it is neither a
 * Windows name CLDR maps nor a zone the platform knows. UTC in any spelling
 * is `undefined` too: a UTC time is written with `Z` and needs no zone.
 */
export function ianaZoneOf(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  if (/^(utc|etc\/utc|gmt|z|tzone:\/\/microsoft\/utc)$/i.test(trimmed)) return undefined;
  const mapped = WINDOWS_TO_IANA[trimmed];
  if (mapped !== undefined) return mapped === 'Etc/UTC' ? undefined : platformKnows(mapped) ? mapped : undefined;
  return platformKnows(trimmed) ? trimmed : undefined;
}

/** A zone's offset from UTC at `instant`, in minutes (`+60` for Amsterdam in winter). */
export function offsetMinutes(zone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** The wall clock in `zone` at `instant`, as UTC-based ms (read with `getUTC*`). */
export function wallIn(zone: string, instant: number): number {
  return instant + offsetMinutes(zone, instant) * 60_000;
}

/** `YYYYMMDDTHHMMSS` of a wall clock held as UTC-based ms. */
export function wallStamp(wall: number): string {
  return new Date(wall).toISOString().slice(0, 19).replace(/[-:]/g, '');
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

function utcOffsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

/** The instant in `[from, to)` where the offset changes, to the minute; `from < to`, offsets differ. */
function transitionBetween(zone: string, from: number, to: number): number {
  let lo = from;
  let hi = to;
  const before = offsetMinutes(zone, lo);
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
    if (offsetMinutes(zone, mid) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

interface Transition {
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/** The offset changes in `year`, found by a daily walk and narrowed to the minute. */
function transitionsIn(zone: string, year: number): Transition[] {
  const out: Transition[] = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  let prev = offsetMinutes(zone, start);
  for (let t = start + DAY_MS; t <= end; t += DAY_MS) {
    const now = offsetMinutes(zone, t);
    if (now !== prev) {
      out.push({ at: transitionBetween(zone, t - DAY_MS, t), from: prev, to: now });
      prev = now;
    }
  }
  return out;
}

/** `FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU` for the wall-clock day of a transition. */
function yearlyRuleFor(wall: number): string {
  const d = new Date(wall);
  const day = d.getUTCDate();
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const nth = day + 7 > daysInMonth ? -1 : Math.ceil(day / 7);
  return `FREQ=YEARLY;BYMONTH=${d.getUTCMonth() + 1};BYDAY=${nth}${WEEKDAYS[d.getUTCDay()]}`;
}

/**
 * A VTIMEZONE for `zone`, as its rules stood in `year`, from the platform's
 * zone data: one STANDARD for a zone with no daylight saving time that year,
 * and a STANDARD and a DAYLIGHT, each with its yearly rule, for one with it.
 *
 * Built from one year, the year the event starts, which is what a target
 * needs to place the event and every occurrence while the zone keeps its
 * rules. A target that knows the IANA name (every CalDAV and JMAP server this
 * product writes to) reads the name and not these lines.
 */
export function vtimezoneLines(zone: string, year: number): string[] {
  const lines = ['BEGIN:VTIMEZONE', `TZID:${zone}`];
  const transitions = transitionsIn(zone, year);
  if (transitions.length !== 2) {
    // No daylight saving time that year (or a one-off change): the offset the
    // year starts with, held from then on.
    const offset = offsetMinutes(zone, Date.UTC(year, 0, 1));
    lines.push(
      'BEGIN:STANDARD',
      `DTSTART:${year}0101T000000`,
      `TZOFFSETFROM:${utcOffsetText(offset)}`,
      `TZOFFSETTO:${utcOffsetText(offset)}`,
      'END:STANDARD',
    );
  } else {
    for (const t of transitions) {
      const daylight = t.to > t.from;
      // DTSTART is the local time just before the change, in the old offset.
      const wall = t.at + t.from * 60_000;
      lines.push(
        daylight ? 'BEGIN:DAYLIGHT' : 'BEGIN:STANDARD',
        `DTSTART:${wallStamp(wall)}`,
        `RRULE:${yearlyRuleFor(wall)}`,
        `TZOFFSETFROM:${utcOffsetText(t.from)}`,
        `TZOFFSETTO:${utcOffsetText(t.to)}`,
        daylight ? 'END:DAYLIGHT' : 'END:STANDARD',
      );
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
}
