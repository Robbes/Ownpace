// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Move ONE already-migrated calendar event into a second calendar on the SOURCE
// Nextcloud, so the self-host e2e can prove the move queue against the real stack.
//
// Everything else in the e2e ADDS items. This takes one that has already been copied
// and RELOCATES it, which is the case §11.1 calls a topology change: the source is
// authoritative for an item's content, the owner for where it lives. The migration
// must notice, report it, and act on neither copy.
//
// A CALENDAR event rather than a file, deliberately. Both are worth testing and the
// file half is covered by unit tests, but a moved FILE is keyed by its path, so the
// pass copies it again under the new path and — nothing ever being deleted from a
// target — the target legitimately ends up holding both. The §20 verification gate
// that runs after this one asserts `targetCount === sourceCount`, and would rightly
// fail. An event keeps its UID across the move, so the pass writes nothing at all and
// the corpus the next gate verifies is untouched.
//
// Plain CalDAV: MKCALENDAR for the destination, then GET + PUT + DELETE to relocate
// the object. Not MOVE — SabreDAV's support for MOVE across calendar collections has
// varied by version, and a fixture that works only on some servers is worse than none.
//
// Config via env (same names as seed-dav-source.mjs):
//   SEED_DAV_URL             Nextcloud base URL (default http://127.0.0.1:8082)
//   SEED_DAV_SOURCE_USER     source account userid (default e2e-source)
//   SEED_DAV_SOURCE_PASSWORD source account password (required)
//   MOVE_EVENT_UID           event to relocate (default dav-seed-event-1@dev.local)
//   MOVE_DEST_CALENDAR       calendar to relocate it into (default openmig-e2e-moved)
//
// Idempotent: a second run finds the event already at the destination and exits 0, so
// a re-dispatched workflow does not fail on a move it already made.

const baseUrl = (process.env.SEED_DAV_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const user = process.env.SEED_DAV_SOURCE_USER || 'e2e-source';
const password = process.env.SEED_DAV_SOURCE_PASSWORD;
const uid = process.env.MOVE_EVENT_UID || 'dav-seed-event-1@dev.local';
const destCalendar = process.env.MOVE_DEST_CALENDAR || 'openmig-e2e-moved';

if (!password) {
  console.error('[move-dav] SEED_DAV_SOURCE_PASSWORD is required');
  process.exit(1);
}

const authHeader = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const calendarsUrl = `${baseUrl}/remote.php/dav/calendars/${user}`;
// Matches how seed-dav-source.mjs names the object it PUT.
const objectName = `${uid}.ics`;
const from = `${calendarsUrl}/personal/${objectName}`;
const to = `${calendarsUrl}/${destCalendar}/${objectName}`;

async function request(method, url, { headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: authHeader, ...headers },
    ...(body === undefined ? {} : { body }),
  });
  return response;
}

/**
 * MKCALENDAR *with a display name*.
 *
 * A bare MKCALENDAR leaves the collection with no displayname, and the app's
 * CalDAV discovery then does not surface it — a real bug this project has already
 * paid for once. Without the displayname the destination calendar would be
 * invisible to the migration, the event would look simply deleted, and the gate
 * would fail for a reason that has nothing to do with move detection.
 */
const MKCALENDAR_BODY = `<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>${destCalendar}</D:displayname>
    </D:prop>
  </D:set>
</C:mkcalendar>`;

async function main() {
  // Already moved: a re-dispatched workflow must not fail on work it has done.
  if ((await request('HEAD', to)).status === 200) {
    console.log(`[move-dav] ${uid} is already in '${destCalendar}' — nothing to do`);
    return;
  }

  // The event has to be where we expect, or the move proves nothing and the gate
  // goes on to assert against a queue that was always going to be empty.
  const original = await request('GET', from);
  if (!original.ok) {
    throw new Error(
      `${uid} is not in the source 'personal' calendar (GET -> ${original.status}). ` +
        'Run seed-dav-source.mjs first.',
    );
  }
  const icalendar = await original.text();

  // 201 created, 405 already exists. Both leave a calendar at the destination.
  const made = await request('MKCALENDAR', `${calendarsUrl}/${destCalendar}/`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body: MKCALENDAR_BODY,
  });
  if (made.status !== 201 && made.status !== 405) {
    throw new Error(`MKCALENDAR ${destCalendar} -> ${made.status}: ${await made.text()}`);
  }

  // Write the copy BEFORE removing the original, so a failure here leaves the
  // source corpus intact rather than short one event.
  const written = await request('PUT', to, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' },
    body: icalendar,
  });
  if (written.status !== 201 && written.status !== 204) {
    throw new Error(`PUT ${objectName} into ${destCalendar} -> ${written.status}`);
  }

  const removed = await request('DELETE', from);
  if (removed.status !== 200 && removed.status !== 204) {
    throw new Error(`DELETE ${objectName} from 'personal' -> ${removed.status}`);
  }

  console.log(`[move-dav] moved ${uid} from 'personal' into '${destCalendar}'`);
}

main().catch((err) => {
  console.error(`[move-dav] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
