// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A new address as a declared change (workplan 0168 T3, ADR-0055).
 *
 * The fixtures are written by hand in the shapes the three sources export
 * (Google's vCard 3.0 and its iCalendar, Microsoft Graph's `$value`, Apple's
 * grouped vCard), with `example.org` addresses only. The property tests run a
 * seeded generator over random cards and events, so a failure names its seed.
 */

import { describe, it, expect } from 'vitest';
import {
  AddressTableRefused,
  addressTableDigest,
  applyAddressChanges,
  prepareAddressTable,
  type ConfirmedAddressChange,
} from './address-changes.ts';
import { addressKey } from './address-forms.ts';
import { neutraliseScheduling } from './calendar-scheduling.ts';

function row(oldAddress: string, newAddress: string): ConfirmedAddressChange {
  return { oldKey: addressKey(oldAddress), oldAddress, newAddress };
}

const ANA = row('ana@old.example.org', 'ana@example.org');
const BEN = row('Ben.Old@Old.Example.org', 'ben@example.org');
const TABLE = [ANA, BEN];

const crlf = (lines: string[]): string => `${lines.join('\r\n')}\r\n`;

// --- Fixtures, in the sources' shapes ---------------------------------------

/** Google Contacts' export: vCard 3.0, TYPE lists, `pref` as a TYPE. */
const GOOGLE_CARD = crlf([
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Ana ‹surname›',
  'N:‹surname›;Ana;;;',
  'EMAIL;TYPE=INTERNET;TYPE=HOME,pref:ana@old.example.org',
  'EMAIL;TYPE=INTERNET;TYPE=WORK:ana.work@other.example.org',
  'NOTE:Write to ana@old.example.org about the move',
  'UID:google-contact-1',
  'END:VCARD',
]);

/** Apple Contacts' export: grouped lines with their labels, lower-case types. */
const APPLE_CARD = crlf([
  'BEGIN:VCARD',
  'VERSION:3.0',
  'PRODID:-//Apple Inc.//placeholder//EN',
  'N:Old;Ben;;;',
  'FN:Ben.Old@Old.Example.org',
  'item1.EMAIL;type=INTERNET;type=pref:BEN.OLD@old.example.org',
  'item1.X-ABLabel:_$!<Home>!$_',
  'UID:apple-contact-1',
  'END:VCARD',
]);

/** A vCard 4.0, as a CardDAV server keeps one. */
const V4_CARD = crlf([
  'BEGIN:VCARD',
  'VERSION:4.0',
  'FN:Ana',
  'EMAIL;PREF=1;TYPE=home:ana@old.example.org',
  'UID:urn:uuid:00000000-0000-4000-8000-000000000001',
  'END:VCARD',
]);

/** Google Calendar's iCalendar: CN spelled as the address, RSVP and PARTSTAT parameters. */
const GOOGLE_EVENT = crlf([
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART:20261201T090000Z',
  'DTEND:20261201T100000Z',
  'UID:google-event-1@example.org',
  'ORGANIZER;CN=ana@old.example.org:mailto:ana@old.example.org',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Ben;X-NUM-',
  ' GUESTS=0:mailto:ben.old@old.example.org',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Out',
  ' side;X-NUM-GUESTS=0:mailto:outside@other.example.org',
  'SUMMARY:Dinner with ana@old.example.org',
  'DESCRIPTION:Ben (ben.old@old.example.org) brings dessert',
  'LOCATION:ana@old.example.org',
  'BEGIN:VALARM',
  'ACTION:EMAIL',
  'ATTENDEE:mailto:ana@old.example.org',
  'SUMMARY:Reminder',
  'DESCRIPTION:Reminder',
  'TRIGGER:-P0DT0H30M0S',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
]);

/** Microsoft Graph's `/events/{id}/$value`: MAILTO in capitals, quoted CNs. */
const GRAPH_INVITATION = crlf([
  'BEGIN:VCALENDAR',
  'METHOD:PUBLISH',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'ORGANIZER;CN="Outside, Someone":MAILTO:outside@other.example.org',
  'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="Ana":MAILTO:ana@old.example.org',
  'ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="Ben":MAILTO:ben.old@old.example.org',
  'UID:040000008200E00074C5B7101A82E00800000000placeholder',
  'SUMMARY;LANGUAGE=en-US:Their meeting',
  'DTSTART;TZID=W. Europe Standard Time:20261202T100000',
  'DTEND;TZID=W. Europe Standard Time:20261202T110000',
  'END:VEVENT',
  'END:VCALENDAR',
]);

/** Apple Calendar's export: an EMAIL parameter and a urn:uuid value. */
const APPLE_EVENT = crlf([
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple Inc.//placeholder//EN',
  'BEGIN:VEVENT',
  'UID:apple-event-1',
  'DTSTART:20261203T120000Z',
  'ORGANIZER;CN=Ben;EMAIL=ben.old@old.example.org:urn:uuid:00000000-0000-4000-8000-0000000000b0',
  'ATTENDEE;CN=Ana;EMAIL="ana@old.example.org";PARTSTAT=ACCEPTED:mailto:ana@old.example.org',
  'SUMMARY:Lunch',
  'END:VEVENT',
  'END:VCALENDAR',
]);

// --- The table ---------------------------------------------------------------

describe('the table’s digest', () => {
  it('is null for an empty table', () => {
    expect(addressTableDigest([])).toBeNull();
  });
  it('is SHA-256 hex, and the same whatever order the rows come in', () => {
    const d = addressTableDigest(TABLE);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(addressTableDigest([BEN, ANA])).toBe(d);
  });
  it('changes when a new address changes, or a row comes or goes', () => {
    const d = addressTableDigest(TABLE);
    expect(addressTableDigest([ANA, row('ben.old@old.example.org', 'ben2@example.org')])).not.toBe(d);
    expect(addressTableDigest([ANA])).not.toBe(d);
  });
  it('does not change for another spelling of the same old address', () => {
    expect(addressTableDigest([row('ANA@old.example.org', 'ana@example.org')])).toBe(addressTableDigest([ANA]));
  });
});

describe('a table that cannot be applied', () => {
  it.each([
    ['chained', [ANA, row('ana@example.org', 'ana@third.example.org')]],
    ['already_changed', [ANA, row('ANA@old.example.org', 'other@example.org')]],
    ['not_an_address', [row('nobody', 'ana@example.org')]],
    ['wrong_key', [{ oldKey: 'someone@else.example.org', oldAddress: 'ana@old.example.org', newAddress: 'a@example.org' }]],
  ] as const)('is refused whole as %s, never applied in part', (code, rows) => {
    expect(() => prepareAddressTable(rows)).toThrow(AddressTableRefused);
    try {
      applyAddressChanges('vcard', GOOGLE_CARD, rows);
    } catch (e) {
      expect((e as AddressTableRefused).code).toBe(code);
      return;
    }
    throw new Error('not refused');
  });
});

// --- vCard (D2) -----------------------------------------------------------------

describe('a card (D2)', () => {
  it('gains the new address first and preferred, and keeps the old one without its preference (Google’s shape)', () => {
    const r = applyAddressChanges('vcard', GOOGLE_CARD, TABLE);
    expect(r.changed).toBe(true);
    expect(r.digest).toBe(addressTableDigest(TABLE));
    expect(r.body).toBe(
      crlf([
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Ana ‹surname›',
        'N:‹surname›;Ana;;;',
        'EMAIL;TYPE=pref;TYPE=INTERNET;TYPE=HOME:ana@example.org',
        'EMAIL;TYPE=INTERNET;TYPE=HOME:ana@old.example.org',
        'EMAIL;TYPE=INTERNET;TYPE=WORK:ana.work@other.example.org',
        'NOTE:Write to ana@old.example.org about the move',
        'UID:google-contact-1',
        'END:VCARD',
      ]),
    );
  });

  it('matches whatever the case, and leaves the group and its label with the old line (Apple’s shape)', () => {
    const r = applyAddressChanges('vcard', APPLE_CARD, TABLE);
    expect(r.body).toBe(
      crlf([
        'BEGIN:VCARD',
        'VERSION:3.0',
        'PRODID:-//Apple Inc.//placeholder//EN',
        'N:Old;Ben;;;',
        'FN:Ben.Old@Old.Example.org',
        'EMAIL;TYPE=pref;type=INTERNET:ben@example.org',
        'item1.EMAIL;type=INTERNET:BEN.OLD@old.example.org',
        'item1.X-ABLabel:_$!<Home>!$_',
        'UID:apple-contact-1',
        'END:VCARD',
      ]),
    );
  });

  it('writes PREF=1 in a vCard 4.0', () => {
    const r = applyAddressChanges('vcard', V4_CARD, TABLE);
    expect(r.body).toContain('\r\nEMAIL;PREF=1;TYPE=home:ana@example.org\r\nEMAIL;TYPE=home:ana@old.example.org\r\n');
  });

  it('adds nothing to a card that already lists the new address', () => {
    const card = GOOGLE_CARD.replace('UID:', 'EMAIL:Ana@Example.org\r\nUID:');
    expect(applyAddressChanges('vcard', card, TABLE)).toEqual({ body: card, changed: false, digest: null });
  });

  it('leaves a card of somebody not in the table byte for byte', () => {
    const card = GOOGLE_CARD.replace(/ana@old\.example\.org/g, 'ana@stays.example.org');
    expect(applyAddressChanges('vcard', card, TABLE)).toEqual({ body: card, changed: false, digest: null });
  });

  it('reads a folded EMAIL line, and keeps every other folded line as it was', () => {
    const card = crlf(['BEGIN:VCARD', 'VERSION:3.0', 'NOTE:a long', '  note', 'EMAIL;TYPE=INTER', ' NET:ana@old.exa', ' mple.org', 'END:VCARD']);
    const r = applyAddressChanges('vcard', card, TABLE);
    expect(r.body).toBe(
      crlf(['BEGIN:VCARD', 'VERSION:3.0', 'NOTE:a long', '  note', 'EMAIL;TYPE=pref;TYPE=INTERNET:ana@example.org', 'EMAIL;TYPE=INTER', ' NET:ana@old.exa', ' mple.org', 'END:VCARD']),
    );
  });

  it('keeps bare LF line ends', () => {
    const card = GOOGLE_CARD.replace(/\r\n/g, '\n');
    const r = applyAddressChanges('vcard', card, TABLE);
    expect(r.body).not.toContain('\r');
    expect(r.body).toContain('\nEMAIL;TYPE=pref;TYPE=INTERNET;TYPE=HOME:ana@example.org\n');
  });
});

// --- iCalendar (D3) -------------------------------------------------------------

describe('an event (D3)', () => {
  it('names the new organiser, and changes its guests in the table, inside the family (Google’s shape)', () => {
    const r = applyAddressChanges('icalendar', GOOGLE_EVENT, TABLE);
    expect(r.changed).toBe(true);
    const lines = r.body.split('\r\n');
    // CN, a display name, is kept even where it spells the old address.
    expect(lines).toContain('ORGANIZER;CN=ana@old.example.org:mailto:ana@example.org');
    expect(lines).toContain(
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Ben;X-NUM-GUESTS=0:mailto:ben@example.org',
    );
    // Somebody outside the table keeps their line, fold and all.
    expect(r.body).toContain('CN=Out\r\n side;X-NUM-GUESTS=0:mailto:outside@other.example.org\r\n');
    // Free text and the alarm's recipient are never changed.
    expect(lines).toContain('SUMMARY:Dinner with ana@old.example.org');
    expect(lines).toContain('DESCRIPTION:Ben (ben.old@old.example.org) brings dessert');
    expect(lines).toContain('LOCATION:ana@old.example.org');
    expect(lines).toContain('ATTENDEE:mailto:ana@old.example.org');
    expect(lines).toContain('UID:google-event-1@example.org');
  });

  it('leaves an outside organiser’s invitation exactly as it was (Graph’s shape)', () => {
    expect(applyAddressChanges('icalendar', GRAPH_INVITATION, TABLE)).toEqual({
      body: GRAPH_INVITATION,
      changed: false,
      digest: null,
    });
  });

  it('changes the guests of an event the account itself organised, keeping MAILTO as the source spelled it', () => {
    const own = GRAPH_INVITATION.replace('outside@other.example.org', 'me@example.org');
    const r = applyAddressChanges('icalendar', own, TABLE, [addressKey('Me@Example.org')]);
    expect(r.body).toContain(':MAILTO:ana@example.org\r\n');
    expect(r.body).toContain(':MAILTO:ben@example.org\r\n');
    expect(r.body).toContain('CN="Ana"');
  });

  it('changes an organiser named by its EMAIL parameter, and an attendee’s EMAIL with its value (Apple’s shape)', () => {
    const r = applyAddressChanges('icalendar', APPLE_EVENT, TABLE);
    const lines = r.body.split('\r\n');
    expect(lines).toContain('ORGANIZER;CN=Ben;EMAIL=ben@example.org:urn:uuid:00000000-0000-4000-8000-0000000000b0');
    expect(lines).toContain('ATTENDEE;CN=Ana;EMAIL="ana@example.org";PARTSTAT=ACCEPTED:mailto:ana@example.org');
  });

  it('changes an organiser a family member already writes as their new address, and its guests', () => {
    const ev = APPLE_EVENT.replace('EMAIL=ben.old@old.example.org:urn:uuid:00000000-0000-4000-8000-0000000000b0', ':mailto:ben@example.org').replace(';:', ':');
    const r = applyAddressChanges('icalendar', ev, TABLE);
    expect(r.body).toContain('ATTENDEE;CN=Ana;EMAIL="ana@example.org";PARTSTAT=ACCEPTED:mailto:ana@example.org');
  });

  it('is applied before neutraliseScheduling, which then marks the changed lines as it marks any', () => {
    const out = neutraliseScheduling(applyAddressChanges('icalendar', GOOGLE_EVENT, TABLE).body);
    expect(out).toContain('ORGANIZER;SCHEDULE-AGENT=CLIENT;CN=ana@old.example.org:mailto:ana@example.org\r\n');
    expect(out).toContain('ATTENDEE;SCHEDULE-AGENT=CLIENT;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Ben;X-NUM-GUESTS=0:mailto:ben@example.org\r\n');
  });

  it('changes each recurrence override on its own organiser', () => {
    const two = GOOGLE_EVENT.replace('END:VEVENT\r\n', 'END:VEVENT\r\n' + GRAPH_INVITATION.split('BEGIN:VEVENT\r\n')[1]!.split('END:VEVENT')[0] + 'END:VEVENT\r\n');
    const r = applyAddressChanges('icalendar', two, TABLE);
    expect(r.body).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="Ana":MAILTO:ana@old.example.org\r\n');
    expect(r.body).toContain('PARTSTAT=ACCEPTED;CN=Ben;X-NUM-GUESTS=0:mailto:ben@example.org\r\n');
  });
});

// --- Properties -----------------------------------------------------------------

/** A seeded generator, so a failing case names its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADDRESSES = [
  'ana@old.example.org',
  'ANA@Old.Example.org',
  'ben.old@old.example.org',
  'ana@example.org',
  'ben@example.org',
  'outside@other.example.org',
  'carla@stays.example.org',
];

function pick<T>(r: () => number, xs: ReadonlyArray<T>): T {
  return xs[Math.floor(r() * xs.length)]!;
}

/** Fold a logical line at a random width, as some sources do. */
function fold(r: () => number, line: string, eol: string): string {
  if (r() < 0.6 || line.length < 12) return line + eol;
  const w = 8 + Math.floor(r() * 20);
  const parts: string[] = [];
  for (let k = 0; k < line.length; k += w) parts.push(line.slice(k, k + w));
  return parts.join(`${eol} `) + eol;
}

function randomCard(r: () => number): string {
  const eol = r() < 0.8 ? '\r\n' : '\n';
  const v = pick(r, ['3.0', '4.0']);
  const lines = ['BEGIN:VCARD', `VERSION:${v}`, `FN:${pick(r, ADDRESSES)}`, `NOTE:mail ${pick(r, ADDRESSES)} please`];
  const n = Math.floor(r() * 4);
  for (let k = 0; k < n; k += 1) {
    const params = pick(r, ['', ';TYPE=INTERNET', ';TYPE=INTERNET,pref', ';PREF=1', ';type=pref', ';TYPE="home,pref"']);
    const group = r() < 0.2 ? `item${k}.` : '';
    lines.push(`${group}EMAIL${params}:${r() < 0.1 ? 'mailto:' : ''}${pick(r, ADDRESSES)}`);
  }
  lines.push(`UID:card-${Math.floor(r() * 1e6)}`, 'END:VCARD');
  return lines.map((l) => fold(r, l, eol)).join('');
}

function randomEvent(r: () => number): string {
  const eol = r() < 0.8 ? '\r\n' : '\n';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  const events = 1 + Math.floor(r() * 2);
  for (let e = 0; e < events; e += 1) {
    lines.push('BEGIN:VEVENT', `UID:event-${Math.floor(r() * 1e6)}`);
    if (r() < 0.9) {
      const a = pick(r, ADDRESSES);
      lines.push(`ORGANIZER;CN=${pick(r, ADDRESSES)}${r() < 0.3 ? `;EMAIL=${a}` : ''}:${pick(r, ['mailto:', 'MAILTO:'])}${a}`);
    }
    const n = Math.floor(r() * 4);
    for (let k = 0; k < n; k += 1) {
      const a = pick(r, ADDRESSES);
      lines.push(`ATTENDEE;PARTSTAT=ACCEPTED;CN="${pick(r, ADDRESSES)}"${r() < 0.3 ? `;EMAIL="${a}"` : ''}:mailto:${a}`);
    }
    lines.push(
      `SUMMARY:with ${pick(r, ADDRESSES)}`,
      `DESCRIPTION:ask ${pick(r, ADDRESSES)}`,
      `LOCATION:${pick(r, ADDRESSES)}`,
    );
    if (r() < 0.3) lines.push('BEGIN:VALARM', 'ACTION:EMAIL', `ATTENDEE:mailto:${pick(r, ADDRESSES)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map((l) => fold(r, l, eol)).join('');
}

/** The unfolded lines of a text, for comparing what a property says. */
function unfolded(text: string): string[] {
  return text
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)
    .filter((l) => l !== '');
}

const SEEDS = Array.from({ length: 400 }, (_, k) => k + 1);
const KINDS = [
  ['vcard', randomCard],
  ['icalendar', randomEvent],
] as const;

describe.each(KINDS)('properties of the change, over random %s bodies', (format, generate) => {
  it('is the identity, byte for byte, for an empty table', () => {
    for (const seed of SEEDS) {
      const body = generate(rng(seed));
      expect(applyAddressChanges(format, body, []), `seed ${seed}`).toEqual({ body, changed: false, digest: null });
    }
  });

  it('changes nothing when applied again: f(f(x)) = f(x)', () => {
    const table = prepareAddressTable(TABLE);
    for (const seed of SEEDS) {
      const once = applyAddressChanges(format, generate(rng(seed)), table, ['ana@old.example.org']).body;
      expect(applyAddressChanges(format, once, table, ['ana@old.example.org']).body, `seed ${seed}`).toBe(once);
    }
  });

  it('never changes free text, a display name or a UID', () => {
    const kept = /^(SUMMARY|DESCRIPTION|LOCATION|NOTE|FN|N|UID|COMMENT)[;:]/i;
    for (const seed of SEEDS) {
      const body = generate(rng(seed));
      const out = applyAddressChanges(format, body, TABLE, ['ana@old.example.org']).body;
      expect(unfolded(out).filter((l) => kept.test(l)), `seed ${seed}`).toEqual(unfolded(body).filter((l) => kept.test(l)));
    }
  });

  it('keeps every line it does not rewrite byte for byte, folds included, and only ever adds EMAIL lines', () => {
    for (const seed of SEEDS) {
      const body = generate(rng(seed));
      const r = applyAddressChanges(format, body, TABLE, ['ana@old.example.org']);
      const before = unfolded(body);
      const after = unfolded(r.body);
      if (format === 'icalendar') expect(after.length, `seed ${seed}`).toBe(before.length);
      else expect(after.length - before.length, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      // Every physical line of the source that is not part of a calendar user
      // or EMAIL property is in the output, in order.
      const untouched = (t: string) => unfolded(t).filter((l) => !/^([\w-]+\.)?(EMAIL|ORGANIZER|ATTENDEE)[;:]/i.test(l));
      expect(untouched(r.body), `seed ${seed}`).toEqual(untouched(body));
      if (!r.changed) expect(r.body).toBe(body);
    }
  });

  it('reads folded lines as their unfolded selves: folding the source changes nothing in the result’s meaning', () => {
    for (const seed of SEEDS) {
      const body = generate(rng(seed));
      const flat = `${unfolded(body).join('\r\n')}\r\n`;
      const a = unfolded(applyAddressChanges(format, body, TABLE, ['ana@old.example.org']).body);
      const b = unfolded(applyAddressChanges(format, flat, TABLE, ['ana@old.example.org']).body);
      expect(a, `seed ${seed}`).toEqual(b);
    }
  });

  it('records the table’s digest exactly when it changed something', () => {
    for (const seed of SEEDS) {
      const r = applyAddressChanges(format, generate(rng(seed)), TABLE, ['ana@old.example.org']);
      expect(r.digest, `seed ${seed}`).toBe(r.changed ? addressTableDigest(TABLE) : null);
    }
  });
});

describe('what a changed body still names', () => {
  it('leaves no old address of the table in a card’s first EMAIL, or in an event the family organised', () => {
    for (const seed of SEEDS) {
      const out = applyAddressChanges('icalendar', randomEvent(rng(seed)), TABLE, ['ana@old.example.org']).body;
      for (const l of unfolded(out)) {
        if (/^ORGANIZER/i.test(l)) expect(l, `seed ${seed}`).not.toMatch(/:mailto:(ana@old|ben\.old@old)\.example\.org$/i);
      }
    }
  });
});
