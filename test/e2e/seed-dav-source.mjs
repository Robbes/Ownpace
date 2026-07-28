// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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

// Imported rather than using the global: this file is linted without browser
// globals, and the promise form is what the retry below wants anyway.
import { setTimeout as sleep } from 'node:timers/promises';

const baseUrl = (process.env.SEED_DAV_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const user = process.env.SEED_DAV_SOURCE_USER || 'e2e-source';
const password = process.env.SEED_DAV_SOURCE_PASSWORD;
const count = Number(process.env.SEED_COUNT || '5');

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

/** Attempts per PUT before a seed failure is treated as real. */
const PUT_ATTEMPTS = 5;

/**
 * PUT one fixture, retrying while the server is merely busy.
 *
 * Nextcloud's default SQLite is a SINGLE-WRITER database. Under concurrent
 * writes it really does answer
 *
 *   500 … SQLSTATE[HY000]: General error: 5 database is locked
 *
 * and it is transient by nature — the lock clears as soon as the other write
 * commits. That is exactly why `requestWithRetry` exists in the DAV target
 * writers. This script is a write path too and had none, so the first lock
 * killed the whole seed and with it the run.
 *
 * 423 (WebDAV Locked) and 429 are included for the same reason: the server is
 * telling us to come back, not that the request is wrong. Anything else — 401,
 * 403, 415, a malformed fixture — is a real failure and is raised immediately;
 * retrying those would only delay the error by a few seconds.
 */
async function put(url, body, contentType) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: authHeader, 'Content-Type': contentType },
      body,
    });
    if (response.status === 201 || response.status === 204) return;

    const retryable = response.status >= 500 || response.status === 423 || response.status === 429;
    const text = await response.text().catch(() => '');

    if (!retryable || attempt === PUT_ATTEMPTS) {
      throw new Error(
        `PUT ${url} -> ${response.status} after ${attempt} attempt(s): ${text.slice(0, 300)}`,
      );
    }

    // Backoff doubles, with jitter so the writers that collided do not all
    // retry in the same millisecond and collide again.
    await sleep(200 * 2 ** (attempt - 1) + Math.random() * 200);
  }
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
      const i = next++;
      if (i > count) return;
      await worker(i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SEED_CONCURRENCY, count) }, () => runner()),
  );
  console.log(`[seed-dav] ${label}: ${count}/${count} PUT ok`);
}

async function main() {
  console.log(
    `[seed-dav] seeding ${count} events + ${count} contacts + ${count} files for '${user}' ` +
      `at ${baseUrl} (${SEED_CONCURRENCY} in flight)`,
  );

  const calendarUrl = `${baseUrl}/remote.php/dav/calendars/${user}/personal`;
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
    `[seed-dav] done — ${count} events in '${user}'/personal, ${count} contacts in '${user}'/contacts, ` +
      `${count} text + ${count} binary + ${count} non-ASCII files at '${user}''s file root`,
  );
}

main().catch((err) => {
  console.error('[seed-dav] FAILED:', err?.message || err);
  process.exit(1);
});
