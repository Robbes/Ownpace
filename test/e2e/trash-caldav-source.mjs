// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// Delete ONE already-migrated calendar event on the SOURCE Nextcloud, so the
// self-host e2e can prove the calendar deletion signal — `evidence: "reported"`
// — against a real server.
//
// Everything else in the e2e ADDS items. This throws one away, which §11.1 calls a
// lifecycle decision: the source is authoritative for content, the owner for whether
// something should exist. The migration must notice via the CalDAV `sync-collection`
// REPORT (RFC 6578), report it at `GET /deletions` with `evidence: "reported"`, and
// remove nothing from the target.
//
// Unlike the file/mail trash scripts, there is no "own bin" for CalDAV to read — an
// ordinary DELETE is the whole signal. `reported` evidence is matched back to a
// ledger row through the source's own href (`sourceRef`, recorded at copy time), so
// this deletes the event at EXACTLY the href seed-dav-source.mjs put it at, rather
// than re-deriving one.
//
// Config via env (same names as seed-dav-source.mjs / move-dav-source.mjs):
//   SEED_DAV_URL             Nextcloud base URL (default http://127.0.0.1:8082)
//   SEED_DAV_SOURCE_USER     source account userid (default e2e-source)
//   SEED_DAV_SOURCE_PASSWORD source account password (required)
//   TRASH_EVENT_UID          event to delete (default dav-seed-event-2@dev.local)
//
// Idempotent: an event already gone is reported and not treated as an error, so a
// re-dispatched workflow does not fail on a deletion it already made.

import { davFetch } from './dav-retry.mjs';

const baseUrl = (process.env.SEED_DAV_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const user = process.env.SEED_DAV_SOURCE_USER || 'e2e-source';
const password = process.env.SEED_DAV_SOURCE_PASSWORD;
const uid = process.env.TRASH_EVENT_UID || 'dav-seed-event-2@dev.local';

if (!password) {
  console.error('[trash-caldav] SEED_DAV_SOURCE_PASSWORD is required');
  process.exit(1);
}

const authHeader = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
// Matches how seed-dav-source.mjs named the object it PUT, and the href
// move-dav-source.mjs already relies on for the same calendar.
const href = `${baseUrl}/remote.php/dav/calendars/${user}/personal/${uid}.ics`;

// Retries while the source Nextcloud is merely busy — its SQLite backend answers
// 500 "database is locked" under concurrent access, which is transient. See
// dav-retry.mjs; this script is why that module exists.
async function request(method, url) {
  return davFetch(url, { method, headers: { Authorization: authHeader } }, { label: '[trash-caldav]' });
}

async function main() {
  const before = await request('GET', href);
  if (before.status === 404) {
    console.log(`[trash-caldav] ${uid} is already gone from 'personal' — nothing to do`);
    return;
  }
  if (!before.ok) {
    throw new Error(
      `${uid} is not readable at ${href} (GET -> ${before.status}). Run seed-dav-source.mjs first.`,
    );
  }

  const deleted = await request('DELETE', href);
  if (deleted.status !== 200 && deleted.status !== 204) {
    throw new Error(`DELETE ${href} -> ${deleted.status}: ${(await deleted.text()).slice(0, 300)}`);
  }
  console.log(`[trash-caldav] deleted ${uid} from 'personal'`);
}

main().catch((err) => {
  console.error(`[trash-caldav] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
