// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ADDRESS A DELEGATE OR A GROUP NAMES (the owner, 2026-11-23; ADR-0055;
 * workplan 0168).
 *
 * Until 2026-11-23 the address change reached an event's `ORGANIZER` and
 * `ATTENDEE` addresses and left the addresses their parameters name as the
 * source had them: `SENT-BY` (who acts for the organiser or a guest),
 * `DELEGATED-FROM` and `DELEGATED-TO` (who handed an invitation on, and to
 * whom), and `MEMBER` (the group a guest came through). The owner, asked:
 * *"yes, since the new address will control the new events."* So, in a
 * component whose organiser is in the table or is the account's own, each of
 * those addresses that is an old one gets the new one, every quoted value of
 * a list, each in its own quotes and scheme spelling, and every other byte
 * stays. An invitation from outside keeps them, as it keeps its guests (D3).
 *
 * Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import {
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
const BEN = row('ben@old.example.org', 'ben@example.org');
const CARLA = row('carla@old.example.org', 'carla@example.org');
const TABLE = [ANA, BEN, CARLA];

const crlf = (lines: string[]): string => `${lines.join('\r\n')}\r\n`;

/** One event, its lines between `BEGIN:VEVENT` and `END:VEVENT` as given. */
function event(lines: string[]): string {
  return crlf(['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:delegated-1', 'DTSTART:20261201T090000Z', ...lines, 'END:VEVENT', 'END:VCALENDAR']);
}

describe('SENT-BY, DELEGATED-FROM, DELEGATED-TO and MEMBER in the family’s events', () => {
  it('gives an organiser’s SENT-BY the new address, in its quotes, beside the organiser’s own', () => {
    const body = event(['ORGANIZER;CN=Ana;SENT-BY="mailto:ben@old.example.org":mailto:ana@old.example.org']);
    const r = applyAddressChanges('icalendar', body, TABLE);
    expect(r.body).toBe(event(['ORGANIZER;CN=Ana;SENT-BY="mailto:ben@example.org":mailto:ana@example.org']));
    // Both rows decided the bytes: Ana's as the organiser, Ben's as who sent it.
    expect(r.digest).toBe(addressTableDigest([ANA, BEN]));
  });

  it('changes the organiser’s SENT-BY where the organiser is the account itself, and only that address', () => {
    const body = event(['ORGANIZER;SENT-BY="mailto:ben@old.example.org":mailto:me@example.org', 'SUMMARY:sent for me by ben@old.example.org']);
    const r = applyAddressChanges('icalendar', body, TABLE, [addressKey('me@example.org')]);
    expect(r.body).toBe(
      event(['ORGANIZER;SENT-BY="mailto:ben@example.org":mailto:me@example.org', 'SUMMARY:sent for me by ben@old.example.org']),
    );
    expect(r.digest).toBe(addressTableDigest([BEN]));
  });

  it('changes each matching value of a DELEGATED-FROM, DELEGATED-TO and MEMBER list, in order, and leaves the others byte for byte', () => {
    const body = event([
      'ORGANIZER;CN=Ana:mailto:ana@old.example.org',
      'ATTENDEE;ROLE=REQ-PARTICIPANT;DELEGATED-FROM="mailto:outside@other.example.org","MAILTO:Ben@Old.Example.org":mailto:carla@old.example.org',
      'ATTENDEE;DELEGATED-TO="mailto:carla@old.example.org","mailto:outside@other.example.org","Mailto:ana@old.example.org";PARTSTAT=DELEGATED:mailto:ben@old.example.org',
      'ATTENDEE;MEMBER="mailto:family@other.example.org","mailto:ben@old.example.org";CN=Carla:mailto:carla@old.example.org',
    ]);
    const r = applyAddressChanges('icalendar', body, TABLE);
    expect(r.body).toBe(
      event([
        'ORGANIZER;CN=Ana:mailto:ana@example.org',
        // The scheme as the source spelled it, value by value; the new address as the table has it.
        'ATTENDEE;ROLE=REQ-PARTICIPANT;DELEGATED-FROM="mailto:outside@other.example.org","MAILTO:ben@example.org":mailto:carla@example.org',
        'ATTENDEE;DELEGATED-TO="mailto:carla@example.org","mailto:outside@other.example.org","Mailto:ana@example.org";PARTSTAT=DELEGATED:mailto:ben@example.org',
        'ATTENDEE;MEMBER="mailto:family@other.example.org","mailto:ben@example.org";CN=Carla:mailto:carla@example.org',
      ]),
    );
  });

  it('keeps an unquoted value unquoted, and without a scheme, as a source that wrote one had it', () => {
    // RFC 5545 quotes these values, and an unquoted one cannot hold a scheme's
    // colon; a bare address is what such a source writes.
    const body = event(['ORGANIZER;SENT-BY=ben@old.example.org:mailto:ana@old.example.org']);
    expect(applyAddressChanges('icalendar', body, TABLE).body).toBe(
      event(['ORGANIZER;SENT-BY=ben@example.org:mailto:ana@example.org']),
    );
  });

  it('changes a parameter whose address is the only old one on its line, and reads a folded one whole', () => {
    // A guest at an address that stays, delegated by Ben, folded across two lines.
    const body = event([
      'ORGANIZER:mailto:ana@old.example.org',
      'ATTENDEE;DELEGATED-FROM="mailto:ben@old.exa',
      ' mple.org":mailto:dora@stays.example.org',
    ]);
    const r = applyAddressChanges('icalendar', body, TABLE);
    expect(r.body).toBe(
      event(['ORGANIZER:mailto:ana@example.org', 'ATTENDEE;DELEGATED-FROM="mailto:ben@example.org":mailto:dora@stays.example.org']),
    );
    expect(r.digest).toBe(addressTableDigest([ANA, BEN]));
  });

  it('leaves a value that is not an address, and one that names nobody in the table, as it stands', () => {
    const body = event([
      'ORGANIZER:mailto:ana@old.example.org',
      'ATTENDEE;MEMBER="urn:uuid:00000000-0000-4000-8000-0000000000aa","mailto:group@other.example.org":mailto:dora@stays.example.org',
    ]);
    const r = applyAddressChanges('icalendar', body, TABLE);
    expect(r.body).toBe(
      event([
        'ORGANIZER:mailto:ana@example.org',
        'ATTENDEE;MEMBER="urn:uuid:00000000-0000-4000-8000-0000000000aa","mailto:group@other.example.org":mailto:dora@stays.example.org',
      ]),
    );
  });

  it('is applied before neutraliseScheduling, which marks the line as it marks any', () => {
    const body = event(['ORGANIZER;SENT-BY="mailto:ben@old.example.org":mailto:ana@old.example.org']);
    expect(neutraliseScheduling(applyAddressChanges('icalendar', body, TABLE).body)).toContain(
      '\r\nORGANIZER;SCHEDULE-AGENT=CLIENT;SENT-BY="mailto:ben@example.org":mailto:ana@example.org\r\n',
    );
  });
});

describe('an invitation from outside keeps them (D3)', () => {
  it('keeps an outside organiser’s SENT-BY, and its guests’ DELEGATED-* and MEMBER, byte for byte', () => {
    const body = event([
      'ORGANIZER;SENT-BY="mailto:ana@old.example.org":mailto:outside@other.example.org',
      'ATTENDEE;DELEGATED-FROM="mailto:ben@old.example.org":mailto:carla@old.example.org',
      'ATTENDEE;MEMBER="mailto:ana@old.example.org";DELEGATED-TO="mailto:carla@old.example.org":mailto:ben@old.example.org',
    ]);
    expect(applyAddressChanges('icalendar', body, TABLE)).toEqual({ body, changed: false, digest: null });
  });

  it('keeps an email alarm’s recipient, inside a VALARM, as it stands', () => {
    const body = crlf([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:alarm-1',
      'ORGANIZER:mailto:ana@old.example.org',
      'BEGIN:VALARM',
      'ACTION:EMAIL',
      'ATTENDEE;SENT-BY="mailto:ben@old.example.org":mailto:ana@old.example.org',
      'TRIGGER:-PT30M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ]);
    const r = applyAddressChanges('icalendar', body, TABLE);
    expect(r.body).toContain('\r\nORGANIZER:mailto:ana@example.org\r\n');
    expect(r.body).toContain('\r\nATTENDEE;SENT-BY="mailto:ben@old.example.org":mailto:ana@old.example.org\r\n');
  });
});

// --- Properties, over random events that carry the four parameters ------------

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
  'ben@old.example.org',
  'carla@old.example.org',
  'ana@example.org',
  'ben@example.org',
  'outside@other.example.org',
  'dora@stays.example.org',
];

function pick<T>(r: () => number, xs: ReadonlyArray<T>): T {
  return xs[Math.floor(r() * xs.length)]!;
}

/**
 * One address-list value: quoted, in one of the scheme's spellings, or a value
 * that is not an address; or, as a source that does not quote writes it, a bare
 * address (an unquoted value cannot hold a scheme's colon).
 */
function listValue(r: () => number): string {
  if (r() < 0.15) return pick(r, ADDRESSES);
  const value = r() < 0.1 ? 'urn:uuid:00000000-0000-4000-8000-0000000000bb' : `${pick(r, ['mailto:', 'MAILTO:', 'Mailto:'])}${pick(r, ADDRESSES)}`;
  return `"${value}"`;
}

function addressParameters(r: () => number): string {
  const out: string[] = [];
  for (const key of ['SENT-BY', 'DELEGATED-FROM', 'DELEGATED-TO', 'MEMBER']) {
    if (r() < 0.4) {
      const n = key === 'SENT-BY' ? 1 : 1 + Math.floor(r() * 3);
      out.push(`;${key}=${Array.from({ length: n }, () => listValue(r)).join(',')}`);
    }
  }
  return out.join('');
}

function fold(r: () => number, line: string, eol: string): string {
  if (r() < 0.6 || line.length < 12) return line + eol;
  const w = 8 + Math.floor(r() * 20);
  const parts: string[] = [];
  for (let k = 0; k < line.length; k += w) parts.push(line.slice(k, k + w));
  return parts.join(`${eol} `) + eol;
}

/** The organisers whose events are the family's: an address of the table, old or new (D3). */
const FAMILY = new Set(['ana@old.example.org', 'ben@old.example.org', 'carla@old.example.org', 'ana@example.org', 'ben@example.org']);

/** A random event, and whether its organiser is the family's or the account's own (D3). */
function randomEventOf(r: () => number): { readonly body: string; readonly inside: boolean } {
  const eol = r() < 0.8 ? '\r\n' : '\n';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:event-${Math.floor(r() * 1e6)}`];
  let inside = false;
  if (r() < 0.9) {
    const organiser = pick(r, ADDRESSES);
    inside = FAMILY.has(organiser.toLowerCase());
    lines.push(`ORGANIZER;CN=Someone${addressParameters(r)}:mailto:${organiser}`);
  }
  const n = Math.floor(r() * 4);
  for (let k = 0; k < n; k += 1) lines.push(`ATTENDEE;PARTSTAT=ACCEPTED${addressParameters(r)}:mailto:${pick(r, ADDRESSES)}`);
  lines.push(`DESCRIPTION:ask ${pick(r, ADDRESSES)}`, 'END:VEVENT', 'END:VCALENDAR');
  return { body: lines.map((l) => fold(r, l, eol)).join(''), inside };
}

function randomEvent(r: () => number): string {
  return randomEventOf(r).body;
}

/** A line's parameters, key upper case and value as written, up to the colon outside quotes that starts its value. */
function parametersOf(line: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let quoted = false;
  let from = -1;
  for (let k = 0; k <= line.length; k += 1) {
    const ch = line[k];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === ';' || ch === ':' || k === line.length) {
      if (from !== -1) {
        const param = line.slice(from, k);
        const eq = param.indexOf('=');
        out.push([param.slice(0, eq).toUpperCase(), param.slice(eq + 1)]);
      }
      if (ch !== ';') break;
      from = k + 1;
    }
  }
  return out;
}

function unfolded(text: string): string[] {
  return text
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)
    .filter((l) => l !== '');
}

const SEEDS = Array.from({ length: 400 }, (_, k) => k + 1);
const OWN = [addressKey('ana@old.example.org')];

describe('properties of the change over random events whose lines carry the four parameters', () => {
  it('changes nothing when applied again: f(f(x)) = f(x)', () => {
    const table = prepareAddressTable(TABLE);
    for (const seed of SEEDS) {
      const once = applyAddressChanges('icalendar', randomEvent(rng(seed)), table, OWN).body;
      expect(applyAddressChanges('icalendar', once, table, OWN).body, `seed ${seed}`).toBe(once);
    }
  });

  it('leaves no old address in the four parameters of the family’s events, and changes nothing in anyone else’s', () => {
    const old = /(^|[",:])(ana@old|ben@old|carla@old)\.example\.org/i;
    let inside = 0;
    for (const seed of SEEDS) {
      const generated = randomEventOf(rng(seed));
      const out = applyAddressChanges('icalendar', generated.body, TABLE, OWN);
      if (!generated.inside) {
        expect(out, `seed ${seed}`).toEqual({ body: generated.body, changed: false, digest: null });
        continue;
      }
      inside += 1;
      for (const l of unfolded(out.body).filter((x) => /^(ORGANIZER|ATTENDEE)[;:]/i.test(x))) {
        for (const [key, value] of parametersOf(l)) {
          if (['SENT-BY', 'DELEGATED-FROM', 'DELEGATED-TO', 'MEMBER'].includes(key)) expect(value, `seed ${seed}`).not.toMatch(old);
        }
      }
    }
    // Both kinds were drawn, so neither half of this is empty.
    expect(inside).toBeGreaterThan(100);
    expect(SEEDS.length - inside).toBeGreaterThan(50);
  });

  it('keeps every line it does not rewrite byte for byte, and gives a line it rewrites the same parameters in the same order', () => {
    for (const seed of SEEDS) {
      const body = randomEvent(rng(seed));
      const r = applyAddressChanges('icalendar', body, TABLE, OWN);
      const before = unfolded(body);
      const after = unfolded(r.body);
      expect(after.length, `seed ${seed}`).toBe(before.length);
      after.forEach((line, k) => {
        if (line === before[k]) return;
        expect(line, `seed ${seed}`).toMatch(/^(ORGANIZER|ATTENDEE)[;:]/);
        // The same parameter names, in the same order, and the same number of values in each.
        const shape = (l: string) => l.replace(/(mailto:)?[^",;:=]*@[^",;:]*/gi, 'X');
        expect(shape(line), `seed ${seed}`).toBe(shape(before[k]!));
      });
      if (!r.changed) expect(r.body).toBe(body);
    }
  });

  it('gives a body the same bytes under any two tables that give it the same digest (0168 S4)', () => {
    const OUT = row('outside@other.example.org', 'outside@example.org');
    const DORA = row('dora@stays.example.org', 'dora@example.org');
    const universe = [ANA, BEN, CARLA, OUT, DORA];
    for (const seed of SEEDS) {
      const r = rng(seed * 7919);
      const body = randomEvent(rng(seed));
      for (let k = 0; k < 6; k += 1) {
        const a = applyAddressChanges('icalendar', body, universe.filter(() => r() < 0.5), OWN);
        const b = applyAddressChanges('icalendar', body, universe.filter(() => r() < 0.5), OWN);
        if (a.digest === b.digest) expect(a.body, `seed ${seed} pair ${k}`).toBe(b.body);
      }
    }
  });
});
