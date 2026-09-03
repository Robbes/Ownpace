// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// A FIXTURE THAT CANNOT ANSWER ITS QUESTION FAILS SILENTLY AND NIGHTLY.
//
// `test/e2e/seed-dav-source.mjs` puts a VALARM on one seeded event so the
// nightly can prove — on a real Nextcloud, which no test double can stand in
// for — that a migrated event keeps its reminder. The e2e that reads it guards
// against a vacuous pass by asserting the SOURCE still carries the alarm.
//
// But that guard only fires at 01:30 UTC. This one fires in CI, on the commit
// that breaks it, and it closes the one link the e2e cannot check locally: that
// the alarm the seeder actually writes survives the transform this package
// actually applies.
//
// #755 proved `neutraliseScheduling` preserves alarms in general, over
// hand-written fixtures. This proves it over THE fixture — so an edit to the
// seeder that quietly drops REPEAT, or a transform change that starts touching
// alarm lines, is caught by whichever of the two moved.
//
// The seeder is read as TEXT: it is an `.mjs` under `test/e2e/`, which
// `no-workspace-imports.unit.test.ts` keeps free of workspace imports, so it
// cannot be imported from here and this package cannot be imported from there.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neutraliseScheduling } from './calendar-scheduling.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SEEDER = join(REPO_ROOT, 'test/e2e/seed-dav-source.mjs');

/** The alarm lines the seeder emits, read from the seeder itself. */
function seededAlarmLines(): string[] {
  const src = readFileSync(SEEDER, 'utf8');
  const block = /function alarmLines\(\) \{\s*return \[([\s\S]*?)\];/.exec(src);
  expect(
    block?.[1],
    'seed-dav-source.mjs no longer has an alarmLines() returning a literal array — ' +
      'this test reads it as text, so it must stay one (or this test must change)',
  ).toBeDefined();
  return [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

describe('the e2e alarm fixture', () => {
  it('is a real alarm, not an empty list', () => {
    // Vacuity floor: an empty extraction would make every assertion below pass
    // while proving nothing — the exact failure this file exists to prevent.
    const lines = seededAlarmLines();
    expect(lines).toContain('BEGIN:VALARM');
    expect(lines).toContain('END:VALARM');
  });

  it('carries fields CalendarEvent.reminders cannot represent', () => {
    // Without these the fixture cannot catch a writer rebuilt from the parsed
    // model: UID, SUMMARY and the content hash would all still match.
    const lines = seededAlarmLines();
    expect(lines).toContain('REPEAT:2');
    expect(lines).toContain('DURATION:PT5M');
  });

  it('survives neutraliseScheduling byte-for-byte', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpenMig//E2ESeed//EN',
      'BEGIN:VEVENT',
      'UID:dav-seed-event-3@dev.local',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260113T100000Z',
      'DTEND:20260113T110000Z',
      'SUMMARY:Restart-resume seed event 3',
      'STATUS:CONFIRMED',
      ...seededAlarmLines(),
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    // The transform is the ONLY step between the source bytes and the PUT body,
    // so identity here is fidelity. With no ATTENDEE or ORGANIZER to rewrite it
    // must be a pure pass-through.
    expect(neutraliseScheduling(ics)).toBe(ics);
  });
});
