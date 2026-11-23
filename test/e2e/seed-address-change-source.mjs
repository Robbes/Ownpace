// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// Seed the appliance e2e's ADDRESS CANARY into the DAV source (workplan 0168 T8;
// ADR-0055): one event organised by an address the person is leaving, with an
// outside attendee, and one card whose EMAIL is that address. The appliance's
// config directory carries `address-changes.json` (e2e.yml writes it), which
// changes `moving@example.org` to `moved@example.org`, and
// `selfhost-address-changes.e2e.test.ts` reads the copies off the target.
//
// Fixed keys: the e2e stack's volumes start empty every run, so nothing can
// have tombstoned them. The prose names the old address too, and must arrive
// unchanged (D4).
//
// Config via env:
//   SEED_DAV_URL               Nextcloud base URL (default http://127.0.0.1:8082)
//   SEED_DAV_SOURCE_USER       source account userid (default e2e-source)
//   SEED_DAV_SOURCE_PASSWORD   source account password (required)

const baseUrl = (process.env.SEED_DAV_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const user = process.env.SEED_DAV_SOURCE_USER || 'e2e-source';
const password = process.env.SEED_DAV_SOURCE_PASSWORD;

if (!password) {
  console.error('[seed-address] SEED_DAV_SOURCE_PASSWORD is required');
  process.exit(1);
}

const OLD_ADDRESS = 'moving@example.org';
const EVENT_UID = 'address-change-event@dev.local';
const CARD_UID = 'address-change-contact@dev.local';

const year = new Date().getUTCFullYear() + 1;
const event = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Ownpace//e2e address canary//EN',
  'BEGIN:VEVENT',
  `UID:${EVENT_UID}`,
  'DTSTAMP:20260101T000000Z',
  `DTSTART:${year}0108T100000Z`,
  `DTEND:${year}0108T110000Z`,
  'SUMMARY:Address canary',
  `DESCRIPTION:Organised from ${OLD_ADDRESS}\\, which is changing.`,
  `ORGANIZER;CN=Someone Moving:mailto:${OLD_ADDRESS}`,
  'ATTENDEE;CN=Someone Staying;PARTSTAT=NEEDS-ACTION:mailto:staying@example.org',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');
const card = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  `UID:${CARD_UID}`,
  'FN:Someone Moving',
  'N:Moving;Someone;;;',
  `EMAIL;TYPE=INTERNET:${OLD_ADDRESS}`,
  'END:VCARD',
  '',
].join('\r\n');

const auth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

async function put(url, contentType, body) {
  const res = await fetch(url, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': contentType }, body });
  if (res.status !== 201 && res.status !== 204) {
    throw new Error(`PUT ${url} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  console.log(`[seed-address] ${url.replace(baseUrl, '')}: HTTP ${res.status}`);
}

await put(
  `${baseUrl}/remote.php/dav/calendars/${user}/personal/${EVENT_UID}.ics`,
  'text/calendar; charset=utf-8',
  event,
);
await put(
  `${baseUrl}/remote.php/dav/addressbooks/users/${user}/contacts/${CARD_UID}.vcf`,
  'text/vcard; charset=utf-8',
  card,
);
console.log(`[seed-address] the address canary is in ${user}'s source: ${OLD_ADDRESS} on one event and one card`);
