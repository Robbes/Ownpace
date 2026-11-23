// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// A NEW ADDRESS ON THE APPLIANCE, THROUGH ITS FILE DOOR (workplan 0168 T8;
// ADR-0055; ADR-0034's Organisation door).
//
// e2e.yml writes `address-changes.json` into the appliance's config directory
// with two rows, and `seed-address-change-source.mjs` puts an event and a card
// that name the first row's old address into the DAV source:
//
//   - `moving@example.org` becomes `moved@example.org` (the address canary);
//   - `source@dev.local` becomes `source-moved@example.org`: the sender of the
//     seeded mail, so the mail pass runs with a confirmed row naming it.
//
// What is asserted, against the real servers and never only the appliance's
// own say-so:
//
//   1. the appliance serves the file's rows read-only, naming the file, and
//      refuses a write with `file_door` in English and Dutch;
//   2. the card on the target carries the new address first and preferred,
//      and keeps the old one (D2);
//   3. the event on the target is organised by the new address with
//      SCHEDULE-AGENT=CLIENT, its outside attendee unchanged and neutralised,
//      its description unchanged (D3, D4, ADR-0043);
//   4. the seeded message on the target is the source's bytes, one copy, the
//      same SHA-256 (D1, ADR-0055 decision 4). `<seed-4@dev.local>`, because
//      the gates around this one spend -1 and -2.
//
// NOT HERE, and said rather than skipped: a row deleted from the file
// converging back. The image bakes its config directory, so a test cannot edit
// the file and restart; the managed gate proves the convergence. And no mail
// catcher runs beside this stack, so silence is the managed gate's to prove.
//
// PREREQUISITES: the same running stack as selfhost-restart-resume.e2e.test.ts,
// which has driven the first passes. Runs on both persistence backends, as the
// rest of the lane does (SELFHOST_COMPOSE_OVERRIDE).

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  BASE_URL,
  DAV_TARGET_USER,
  MAIN_MAPPING_ID,
  NEXTCLOUD_URL,
  PASS_WAIT_MS,
  SOURCE_IMAP_PASSWORD,
  STALWART_IMAPS_PORT,
  TARGET_DAV_PASSWORD,
  TARGET_JMAP_PASSWORD,
  davAuthHeader,
  getDomainStatus,
  runPassNow,
} from './apply-deletion-lib.ts';

const OLD = 'moving@example.org';
const NEW = 'moved@example.org';
const EVENT_UID = 'address-change-event@dev.local';
const CARD_UID = 'address-change-contact@dev.local';

async function json(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Lines unfolded (RFC 5545 §3.1, RFC 6350 §3.2), CRLF read as LF. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/**
 * The object on the target account whose bytes carry `UID:<uid>`, wherever the
 * writer put it: every collection under the account's DAV home, one level down.
 */
async function targetObject(home: string, uid: string): Promise<string | undefined> {
  const auth = davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD);
  const hrefs = async (url: string): Promise<string[]> => {
    const res = await fetch(url, { method: 'PROPFIND', headers: { ...auth, Depth: '1' } });
    if (res.status !== 207) throw new Error(`PROPFIND ${url} -> ${res.status}`);
    return [...(await res.text()).matchAll(/<[a-z]*:?href>([^<]+)<\/[a-z]*:?href>/gi)].map((m) => m[1]!);
  };
  const root = `${NEXTCLOUD_URL}${home}`;
  for (const collection of await hrefs(root)) {
    if (!collection.endsWith('/') || `${NEXTCLOUD_URL}${collection}` === root) continue;
    for (const href of await hrefs(`${NEXTCLOUD_URL}${collection}`)) {
      if (href.endsWith('/')) continue;
      const res = await fetch(`${NEXTCLOUD_URL}${href}`, { headers: auth });
      if (!res.ok) continue;
      const text = await res.text();
      if (unfold(text).includes(`UID:${uid}`)) return text;
    }
  }
  return undefined;
}

/** Drive passes until `read` answers, or the wait runs out. */
async function untilCopied(domain: string, read: () => Promise<string | undefined>): Promise<string> {
  const deadline = Date.now() + PASS_WAIT_MS;
  // A pass refused while one runs is worth another try; the last refusal is said if the wait runs out.
  let lastRefusal: unknown;
  while (Date.now() < deadline) {
    const found = await read();
    if (found !== undefined) return found;
    try {
      await runPassNow(MAIN_MAPPING_ID);
    } catch (err) {
      lastRefusal = err;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  const refused = lastRefusal === undefined ? '' : `; last pass refused: ${lastRefusal instanceof Error ? lastRefusal.message : String(lastRefusal)}`;
  throw new Error(`${domain}: the address canary did not reach the target in ${PASS_WAIT_MS}ms (last status: ${JSON.stringify(await getDomainStatus(domain))})${refused}`);
}

/** Every copy of a message on an IMAP account, with the SHA-256 of its raw bytes. */
function copies(user: string, password: string, messageId: string): Array<{ path: string; sha256: string }> {
  const out = execFileSync('node', ['test/e2e/message-sha256.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      IMAP_HOST: '127.0.0.1',
      IMAP_PORT: STALWART_IMAPS_PORT,
      IMAP_TLS: 'true',
      IMAP_USER: user,
      IMAP_PASSWORD: password,
      MESSAGE_ID: messageId,
    },
  });
  return JSON.parse(out) as Array<{ path: string; sha256: string }>;
}

describe('a new address on the appliance, through address-changes.json', () => {
  it("serves the file's rows read-only, naming the file", async () => {
    const { status, body } = await json('GET', '/address-changes');
    expect(status).toBe(200);
    expect(body.door).toBe('file');
    expect(body.file).toBe('address-changes.json');
    const rows = body.rows as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.oldKey, r.newAddress, r.state, r.confirmedBy]).sort()).toEqual([
      ['moving@example.org', NEW, 'confirmed', 'address-changes.json'],
      ['source@dev.local', 'source-moved@example.org', 'confirmed', 'address-changes.json'],
    ]);
  });

  it('refuses a write with file_door, in English and Dutch', async () => {
    const { status, body } = await json('POST', '/address-changes', { oldAddress: 'a@example.org', newAddress: 'b@example.org' });
    expect(status).toBe(409);
    expect(body.error).toBe('file_door');
    expect(String(body.message)).toContain('address-changes.json');
    expect(String(body.messageNl)).toContain('address-changes.json');
    expect(body.messageNl).not.toBe(body.message);
  });

  it('the card on the target has the new address first and preferred, and keeps the old one', async () => {
    const card = await untilCopied('contacts', () => targetObject(`/remote.php/dav/addressbooks/users/${DAV_TARGET_USER}/`, CARD_UID));
    const emails = unfold(card).filter((l) => /^EMAIL[;:]/i.test(l));
    expect(emails[0]?.toLowerCase(), emails.join('\n')).toMatch(new RegExp(`:${NEW.replace('.', '\\.')}$`));
    // How the card's version marks its preferred line (0168 D2): vCard 4.0 has
    // the PREF parameter (RFC 6350 §5.3); 2.1 and 3.0 have none and mark it with
    // TYPE=pref (RFC 2426 §3.3.2), which is what the change writes there.
    const version = /^VERSION:(\S+)$/im.exec(unfold(card).join('\n'))?.[1];
    const params = (emails[0] ?? '').split(':')[0] ?? '';
    expect(params, emails.join('\n')).toMatch(
      version === '4.0' ? /(^|;)PREF=1(;|$)/i : /(^|;)TYPE=([^;]*,)?pref(,[^;]*)?(;|$)/i,
    );
    expect(emails.some((l) => l.toLowerCase().endsWith(`:${OLD}`)), emails.join('\n')).toBe(true);
  }, PASS_WAIT_MS + 30000);

  it('the event on the target is organised by the new address, neutralised; guest and prose unchanged', async () => {
    const event = unfold(
      await untilCopied('calendar', () => targetObject(`/remote.php/dav/calendars/${DAV_TARGET_USER}/`, EVENT_UID)),
    );
    const organiser = event.find((l) => /^ORGANIZER[;:]/i.test(l)) ?? '';
    const attendees = event.filter((l) => /^ATTENDEE[;:]/i.test(l));
    expect(organiser.toLowerCase(), event.join('\n')).toContain(`mailto:${NEW}`);
    expect(organiser, event.join('\n')).toContain('SCHEDULE-AGENT=CLIENT');
    expect(attendees, event.join('\n')).toHaveLength(1);
    expect(attendees[0]!.toLowerCase()).toContain('mailto:staying@example.org');
    expect(attendees[0]).toContain('SCHEDULE-AGENT=CLIENT');
    expect(event.find((l) => l.startsWith('DESCRIPTION'))).toContain(OLD);
  }, PASS_WAIT_MS + 30000);

  it("the seeded message on the target is the source's bytes: one copy, the same SHA-256", () => {
    const source = copies('source@dev.local', SOURCE_IMAP_PASSWORD, '<seed-4@dev.local>');
    const target = copies('target@dev.local', TARGET_JMAP_PASSWORD, '<seed-4@dev.local>');
    expect(source, 'the source no longer holds the seeded message').toHaveLength(1);
    expect(target.map((c) => c.sha256), JSON.stringify(target)).toEqual([source[0]!.sha256]);
  }, 60000);
});
