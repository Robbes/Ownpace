// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// Seed the SOURCE Nextcloud account's default calendar + address book + file root
// for the multi-domain self-host restart-resume e2e (workplan issue #114 follow-up:
// the original 0010 T5 gate only proved the mail/JMAP domain — see
// test/e2e/seed-imap-source.mjs for that half). PUTs N known calendar events into
// the source user's auto-provisioned 'personal' calendar, N known contacts into
// their auto-provisioned 'contacts' address book, and N known files at the account's
// file storage root, all over plain DAV PUT — the same protocol the app's own
// CalDAVSource/CarddavSource/WebdavFileSource connectors use.
//
// Config via env (defaults match deploy/selfhost/setup-nextcloud-users.sh):
//   SEED_DAV_URL           Nextcloud base URL (default http://127.0.0.1:8082)
//   SEED_DAV_SOURCE_USER   source account userid (default e2e-source)
//   SEED_DAV_SOURCE_PASSWORD source account password (required)
//   SEED_COUNT             number of events AND contacts AND files to seed (default 5)
//
// Idempotent-ish: fixed UIDs, so a re-run against a fresh account produces the same
// corpus. Exits non-zero on any failure so the workflow stops before the gate runs
// against a source that was never actually seeded.

import { davFetch } from './dav-retry.mjs';

const baseUrl = (process.env.SEED_DAV_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const user = process.env.SEED_DAV_SOURCE_USER || 'e2e-source';
const password = process.env.SEED_DAV_SOURCE_PASSWORD;
const count = Number(process.env.SEED_COUNT || '5');
/**
 * Number the fixtures from `SEED_OFFSET + 1` instead of 1.
 *
 * The UIDs and filenames here are deliberately stable (`dav-seed-event-N`), so
 * re-running against an already-seeded account adds nothing — every natural key
 * is already known. Correct, and useless for testing whether NEW items get
 * picked up during shadow sync. The offset is how the e2e drips new ones in.
 */
const offset = Number(process.env.SEED_OFFSET || '0');

/**
 * The VTODO-only collection's name, under `calendars/<user>/`.
 *
 * Named, not `personal`: the whole point is a collection that declares VTODO
 * and nothing else (0113 T8). The appliance config in `e2e.yml` points the
 * task domain at the same DAV root and finds this collection through
 * `supported-calendar-component-set`, so nothing has to agree on the name.
 */
const TASK_LIST = process.env.SEED_DAV_TASK_LIST || 'e2e-tasks';

if (!password) {
  console.error('[seed-dav] SEED_DAV_SOURCE_PASSWORD is required');
  process.exit(1);
}

const authHeader = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

function buildIcalendar(i) {
  const uid = `dav-seed-event-${i}@dev.local`;
  // Date.UTC correctly rolls the day over into later months (e.g. day 32 in January becomes
  // February 1st) -- a plain `10 + i` string never did, producing an invalid DATE-TIME like
  // 20260132 once SEED_COUNT pushed i past 21, which SabreDAV rightly rejects with a 415.
  const date = new Date(Date.UTC(2026, 0, 10 + i));
  const ymd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMig//E2ESeed//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    `DTSTART:${ymd}T100000Z`,
    `DTEND:${ymd}T110000Z`,
    `SUMMARY:Restart-resume seed event ${i}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * A VTODO, for the task domain (workplan 0113 T8).
 *
 * Deliberately NOT a VEVENT with a different name: the component IS the
 * domain. `componentOfIcalendar` reads the first `BEGIN:` line, the source
 * yields only objects matching the component it was built with, and the
 * natural key is hashed under a `todo:` prefix rather than `cal:` — so an
 * event seeded here would be skipped by the task lane and the gate would go
 * green having tested nothing.
 *
 * `DUE` rather than `DTSTART`/`DTEND`, because that is what a task has.
 */
function buildVtodo(i) {
  const uid = `dav-seed-task-${i}@dev.local`;
  // Same rollover care as the event builder: `10 + i` past 21 produced an
  // invalid DATE-TIME that SabreDAV rejects with a 415.
  const date = new Date(Date.UTC(2026, 0, 10 + i));
  const ymd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMig//E2ESeed//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    `DUE:${ymd}T170000Z`,
    `SUMMARY:Restart-resume seed task ${i}`,
    'STATUS:NEEDS-ACTION',
    'PERCENT-COMPLETE:0',
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');
}

function buildVcard(i) {
  const uid = `dav-seed-contact-${i}@dev.local`;
  return [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `UID:${uid}`,
    `FN:Restart Resume Seed Contact ${i}`,
    'END:VCARD',
  ].join('\r\n');
}

function buildFile(i) {
  return `Restart-resume seed file ${i} content.\n`;
}

/**
 * A deterministic binary blob that is NOT valid UTF-8.
 *
 * Everything the file domain seeded before this was plain ASCII text, so the
 * only files the e2e ever genuinely uploaded round-tripped through a UTF-8
 * decode unharmed. That is exactly how `WebdavFileSource.fetchFileContent`
 * came to do `new TextEncoder().encode(await response.text())` — destroying
 * every non-UTF-8 byte on read — and survive a green multi-domain e2e. The 89
 * "files" it reported were overwhelmingly Nextcloud skeleton files that already
 * existed on the target and were adopted, never uploaded.
 *
 * Deterministic by construction (a fixed LCG, no randomness), so a re-run
 * against a fresh account produces byte-identical fixtures and the content
 * hashes are stable across runs.
 *
 * The layout is deliberately adversarial to text handling:
 *   - an ASCII header, so a human opening it in the target knows what it is;
 *   - a NUL byte, which truncates C-style string handling;
 *   - every byte value 0x00-0xFF, so no single-byte encoding can survive it;
 *   - sequences that are invalid UTF-8 in specifically different ways — lone
 *     continuation bytes, a truncated multi-byte start, an overlong encoding,
 *     a surrogate-range encoding, and 0xF5-0xFF which can never appear;
 *   - high-entropy filler, which is what real image and video payloads are.
 */
function buildBinaryFile(i) {
  const header = Buffer.from(`OPENMIG-BINARY-FIXTURE-${i}\n\0`, 'ascii');

  const allBytes = Buffer.alloc(256);
  for (let b = 0; b < 256; b++) allBytes[b] = b;

  const utf8Traps = Buffer.from([
    0x80, 0x81, 0xbf, // lone continuation bytes: never valid on their own
    0xc3, // multi-byte start with nothing following it
    0xe0, 0x80, 0xaf, // overlong encoding of '/'
    0xed, 0xa0, 0x80, // UTF-16 surrogate half, forbidden in UTF-8
    0xf5, 0xfe, 0xff, // never legal in UTF-8 at all
  ]);

  // Linear congruential generator (glibc constants), seeded from the index.
  // Fixed seed => fixed bytes => the fixture is reproducible.
  let state = (1103515245 * (i + 1) + 12345) >>> 0;
  const filler = Buffer.alloc(4096);
  for (let n = 0; n < filler.length; n++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    filler[n] = (state >>> 16) & 0xff;
  }

  return Buffer.concat([header, allBytes, utf8Traps, filler]);
}

/**
 * Valid UTF-8 that is not ASCII.
 *
 * Guards the other direction: a "fix" that read bytes as latin1, or that
 * re-encoded text, would corrupt this while leaving the ASCII fixtures intact.
 */
function buildUtf8File(i) {
  return `Seed ${i}: naïve café — 日本語 — emoji 🐙 — ĝis la revido\n`;
}

/**
 * PUT one fixture, retrying while the server is merely busy.
 *
 * The retry policy — which statuses mean "come back", how long to wait, and why
 * Nextcloud's single-writer SQLite provokes it at all — now lives in
 * `dav-retry.mjs`, shared with the three other DAV scripts. It was written here
 * first, after a lock killed a whole seed; it was moved out on 2026-08-14 when
 * the same lock failed a DELETE in `trash-caldav-source.mjs`, which had no retry
 * because the policy was not somewhere it could be reused from.
 *
 * What stays here is what is specific to seeding: 201/204 is success, and
 * anything else after the retries are spent fails the seed loudly. A partial
 * seed makes every later assertion meaningless.
 */
/**
 * Make the task list: a calendar collection declaring **VTODO and nothing
 * else** (workplan 0113 T8).
 *
 * WHY NOT `personal`. Nextcloud's default calendar declares `VEVENT,VTODO`, so
 * a VTODO dropped in there is carried by BOTH faces — and this gate would pass
 * whether or not the source can tell a task list from a calendar, which is the
 * one thing 0113 is about. `supported-calendar-component-set` (RFC 4791
 * §5.2.3) is the entire difference on the wire, and a collection created
 * WITHOUT it declares nothing, which the RFC reads as "may contain any
 * component type" — back to the mixed case.
 *
 * Idempotent, because the e2e re-seeds with a `SEED_OFFSET` to drip new items
 * in mid-run: 405 is what a server answers for MKCALENDAR against a collection
 * that exists, and it is the converging answer rather than a failure.
 */
async function makeTaskList(url) {
  const body = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">',
    '  <D:set>',
    '    <D:prop>',
    '      <D:displayname>Restart-resume seed tasks</D:displayname>',
    '      <C:supported-calendar-component-set>',
    '        <C:comp name="VTODO"/>',
    '      </C:supported-calendar-component-set>',
    '    </D:prop>',
    '  </D:set>',
    '</C:mkcalendar>',
  ].join('\n');
  const response = await davFetch(
    url,
    {
      method: 'MKCALENDAR',
      headers: { Authorization: authHeader, 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    },
    { label: '[seed-dav]' },
  );
  if (response.status === 201 || response.status === 204) {
    console.log(`[seed-dav] task list created at ${url} (declares VTODO only)`);
    return;
  }
  if (response.status === 405) {
    console.log(`[seed-dav] task list already at ${url}`);
    return;
  }
  const text = await response.text().catch(() => '');
  throw new Error(`MKCALENDAR ${url} -> ${response.status}: ${text.slice(0, 300)}`);
}

async function put(url, body, contentType) {
  const response = await davFetch(
    url,
    {
      method: 'PUT',
      headers: { Authorization: authHeader, 'Content-Type': contentType },
      body,
    },
    { label: '[seed-dav]' },
  );
  if (response.status === 201 || response.status === 204) return;

  const text = await response.text().catch(() => '');
  throw new Error(`PUT ${url} -> ${response.status}: ${text.slice(0, 300)}`);
}

/**
 * How many seed PUTs are in flight at once.
 *
 * The seeding is TEST SCAFFOLDING, not the product, and it was costing more
 * than the appliance build: run #38 spent 551 of its 1872 seconds here, one
 * sequential PUT at a time at ~218 ms each. Nothing about the fixtures needs
 * ordering — each PUT is to its own href — so the only reason it was serial
 * was that it was written with `await` in a loop.
 *
 * Matches the product's own `DEFAULT_CONCURRENCY`. The first version of this
 * used 12 on the reasoning that it was "well under what the product pushes",
 * which was simply wrong — the product pushes 4 — and it put THREE TIMES the
 * write pressure on the same single-writer SQLite that `planDomainLanes` exists
 * to protect. It failed the seed at event 2 of 506 with "database is locked".
 *
 * The retry in `put` is what actually makes this safe; the cap just keeps the
 * collision rate low enough that the retries are rare. Override with
 * SEED_CONCURRENCY on a backend that can take more (Postgres-backed Nextcloud).
 */
const SEED_CONCURRENCY = Number(process.env.SEED_CONCURRENCY ?? 4);

/**
 * Run `worker` over `1..count` with at most SEED_CONCURRENCY in flight.
 *
 * Fails on the FIRST error rather than logging and continuing: a partial seed
 * makes every later assertion meaningless, and a green run over a corpus that
 * was never fully written is the worst outcome available.
 */
async function seedRange(label, worker) {
  let next = 1;
  const runner = async () => {
    for (;;) {
      const n = next++;
      if (n > count) return;
      await worker(offset + n);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SEED_CONCURRENCY, count) }, () => runner()),
  );
  console.log(
    `[seed-dav] ${label}: ${count}/${count} PUT ok` +
      (offset ? ` (numbered ${offset + 1}..${offset + count})` : ''),
  );
}

async function main() {
  console.log(
    `[seed-dav] seeding ${count} events + ${count} tasks + ${count} contacts + ${count} files for '${user}' ` +
      `at ${baseUrl} (${SEED_CONCURRENCY} in flight)`,
  );

  const calendarUrl = `${baseUrl}/remote.php/dav/calendars/${user}/personal`;
  // A collection of its OWN, beside `personal` rather than inside it: a task
  // list is a calendar collection that declares VTODO, and putting the VTODOs
  // in the mixed default calendar would test the easy case (0113 T8).
  const taskListUrl = `${baseUrl}/remote.php/dav/calendars/${user}/${TASK_LIST}`;
  const addressBookUrl = `${baseUrl}/remote.php/dav/addressbooks/users/${user}/contacts`;
  // Files domain has no discovery of its own (unlike CalDAV/CardDAV) -- seeded directly at the
  // account's own file storage root, the same convention WebdavFileSource/WebDAVTargetWriter use.
  const filesUrl = `${baseUrl}/remote.php/dav/files/${user}`;

  await seedRange('events', (i) =>
    put(
      `${calendarUrl}/dav-seed-event-${i}@dev.local.ics`,
      buildIcalendar(i),
      'text/calendar; charset=utf-8',
    ),
  );

  // The task lane (0113 T8). Its own collection, made before anything is PUT
  // into it, and declaring VTODO alone — see `makeTaskList`.
  await makeTaskList(taskListUrl);
  await seedRange('tasks', (i) =>
    put(
      `${taskListUrl}/dav-seed-task-${i}@dev.local.ics`,
      buildVtodo(i),
      'text/calendar; charset=utf-8',
    ),
  );

  await seedRange('contacts', (i) =>
    put(
      `${addressBookUrl}/dav-seed-contact-${i}@dev.local.vcf`,
      buildVcard(i),
      'text/vcard; charset=utf-8',
    ),
  );

  await seedRange('text files', (i) =>
    put(`${filesUrl}/dav-seed-file-${i}.txt`, buildFile(i), 'text/plain; charset=utf-8'),
  );

  // Binary and non-ASCII fixtures. These are the only files in the whole corpus
  // that do not survive a UTF-8 round trip, and the only ones that exist solely
  // on the source — every Nextcloud skeleton file is already present on the
  // target account and gets adopted rather than uploaded, so before these the
  // upload path had no non-ASCII coverage at all.
  await seedRange('binary files', (i) =>
    put(`${filesUrl}/dav-seed-binary-${i}.bin`, buildBinaryFile(i), 'application/octet-stream'),
  );

  await seedRange('non-ASCII files', (i) =>
    put(`${filesUrl}/dav-seed-utf8-${i}.txt`, buildUtf8File(i), 'text/plain; charset=utf-8'),
  );

  console.log(
    `[seed-dav] done — ${count} events in '${user}'/personal, ${count} tasks in '${user}'/${TASK_LIST}, ` +
      `${count} contacts in '${user}'/contacts, ` +
      `${count} text + ${count} binary + ${count} non-ASCII files at '${user}''s file root`,
  );
}

main().catch((err) => {
  console.error('[seed-dav] FAILED:', err?.message || err);
  process.exit(1);
});
