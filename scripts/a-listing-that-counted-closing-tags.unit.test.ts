// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DIAGNOSTIC THAT LIES IS WORSE THAN NO DIAGNOSTIC.
 *
 * `dav-target-probe.mjs` exists to tell four causes of a zero apart — nothing
 * written, a filter that matches nothing, a partial retrieval the server did
 * not satisfy, an unreadable UID — and each one leads somewhere different. A
 * probe that miscounts sends whoever runs it to the wrong fix, having felt
 * certain on the way.
 *
 * The first draft of its counters matched `</d:response>` as well as
 * `<d:response>` and doubled every figure. It was caught by running it against
 * these bodies before the probe was ever pointed at a server, and that is why
 * they are a test rather than a scratch file.
 *
 * The bodies below are SabreDAV-shaped (Nextcloud's DAV implementation): the
 * `d:` prefix for the DAV namespace, per-propstat status codes, and the
 * 404-propstat-with-an-empty-element shape a server uses to say "I will not
 * satisfy that part of your prop request" — which is the case the probe is
 * really for.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure, propfindMembers, envValue, refusal } from './dav-target-probe.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CALENDAR_WITH_DATA = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/remote.php/dav/calendars/u/personal/a.ics</d:href>
    <d:propstat><d:prop><d:getetag>"1"</d:getetag>
      <cal:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-1
END:VEVENT
END:VCALENDAR</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>/remote.php/dav/calendars/u/personal/b.ics</d:href>
    <d:propstat><d:prop>
      <cal:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-2
END:VEVENT
END:VCALENDAR</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;

/** 207, well-formed, and empty: the filter matched nothing. */
const MATCHED_NOTHING = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`;

/** The resource is listed; the requested calendar-data is refused, and empty. */
const PARTIAL_REFUSED = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/remote.php/dav/calendars/u/personal/a.ics</d:href>
    <d:propstat><d:prop><d:getetag>"1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
    <d:propstat><d:prop><cal:calendar-data/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

/** The same refusal, spelled with a space before the slash. */
const PARTIAL_REFUSED_SPACED = PARTIAL_REFUSED.replace('<cal:calendar-data/>', '<cal:calendar-data />');

const PROPFIND = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/calendars/u/personal/</d:href></d:response>
  <d:response><d:href>/remote.php/dav/calendars/u/personal/a.ics</d:href></d:response>
  <d:response><d:href>/remote.php/dav/calendars/u/personal/b.ics</d:href></d:response>
</d:multistatus>`;

describe('the probe counts what it says it counts', () => {
  it('counts each response once, not once per opening and closing tag', () => {
    // The original defect. Two events came back as four, and every verdict
    // downstream would have been computed from a doubled number.
    expect(measure(CALENDAR_WITH_DATA, 'calendar-data')).toEqual({
      responses: 2,
      withData: 2,
      uids: 2,
    });
  });

  it('reads an accepted-but-unmatched filter as zero responses', () => {
    expect(measure(MATCHED_NOTHING, 'calendar-data').responses).toBe(0);
  });

  it('does not count an EMPTY element as a payload — the quiet case', () => {
    // This is the whole point of the probe. The element is present, so
    // "is calendar-data in the body?" answers yes; the reindexer still skips
    // the item, because what it reads out of it is undefined.
    for (const body of [PARTIAL_REFUSED, PARTIAL_REFUSED_SPACED]) {
      const m = measure(body, 'calendar-data');
      expect(m.responses).toBe(1);
      expect(m.withData).toBe(0);
    }
  });

  it('counts contacts through the same shape', () => {
    const vcf = CALENDAR_WITH_DATA
      .replace(/calendar-data/g, 'address-data')
      .replace(/urn:ietf:params:xml:ns:caldav/, 'urn:ietf:params:xml:ns:carddav');
    expect(measure(vcf, 'address-data').withData).toBe(2);
  });

  it('excludes the collection itself from the ground-truth count', () => {
    // A Depth:1 PROPFIND returns the collection alongside its members. Counting
    // it would turn an empty collection into "1 resource" and hide cause (1).
    expect(propfindMembers(PROPFIND, '/remote.php/dav/calendars/u/personal')).toBe(2);
  });

  it('counts members by PATH, not by file extension', () => {
    // The defect that produced a wrong verdict against the real server on
    // 2026-09-09: filtering on `.vcf` reported an addressbook holding a card as
    // empty, and "NOTHING WAS WRITTEN" was printed over a REPORT that had just
    // returned that card. What makes something a member is where it sits.
    const odd = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/addressbooks/users/u/contacts/</d:href></d:response>
  <d:response><d:href>/remote.php/dav/addressbooks/users/u/contacts/card-no-extension</d:href></d:response>
</d:multistatus>`;
    expect(propfindMembers(odd, '/remote.php/dav/addressbooks/users/u/contacts')).toBe(1);
  });

  it('survives percent-encoding and a trailing slash on either side', () => {
    const encoded = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/calendars/u/my%20cal/</d:href></d:response>
  <d:response><d:href>/remote.php/dav/calendars/u/my%20cal/a.ics</d:href></d:response>
</d:multistatus>`;
    expect(propfindMembers(encoded, '/remote.php/dav/calendars/u/my cal/')).toBe(1);
  });
});

describe('where the probe decides to look', () => {
  const made: string[] = [];

  /** A .env with the shapes these files actually carry. */
  function envFile(body: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'probe-env-'));
    made.push(dir);
    const file = join(dir, '.env');
    writeFileSync(file, body);
    return file;
  }

  // `tests-clean-up-after-themselves` guards this, and caught the first draft:
  // a suite that leaves a temp directory per run fills somebody's /tmp slowly
  // enough that nobody connects it to a test.
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  it('takes the LAST assignment, as the shell helpers do', () => {
    // `env-read.sh` reads the last one. A probe that read the first would look
    // somewhere no other tool in this repo looks.
    const f = envFile('NEXTCLOUD_BIND=first\nOTHER=x\nNEXTCLOUD_BIND=second\n');
    expect(envValue('NEXTCLOUD_BIND', f)).toBe('second');
  });

  it('unwraps a quoted value', () => {
    const f = envFile('NEXTCLOUD_BIND="100.97.25.131"\n');
    expect(envValue('NEXTCLOUD_BIND', f)).toBe('100.97.25.131');
  });

  it('answers undefined for a key that is not there, rather than throwing', () => {
    // The probe falls back to localhost on undefined; an exception here would
    // take the whole diagnostic down over a key a default already covers.
    expect(envValue('NEXTCLOUD_BIND', envFile('API_PORT=3001\n'))).toBeUndefined();
    expect(envValue('NEXTCLOUD_BIND', '/no/such/file')).toBeUndefined();
  });

  it('does not match a key that merely starts the same way', () => {
    const f = envFile('NEXTCLOUD_BIND_EXTRA=nope\n');
    expect(envValue('NEXTCLOUD_BIND', f)).toBeUndefined();
  });
});

describe('a refusal names the state it is in, not the one it met last', () => {
  // TWO CONFIDENT WRONG ANSWERS, both met on the real Spark on 2026-09-09.
  // Every non-207 used to print "the filter body is rejected outright", so a
  // `--user` passed without a `--pass` (401) and a task collection nobody had
  // created (404) were each reported as a broken listing query. In both cases
  // the tool named the one thing that was working and sent the reader off to
  // rewrite it — which is precisely the failure this probe exists to prevent
  // in the product, reproduced inside the probe.

  it('401 and 403 say the query never ran, and name the pair', () => {
    for (const status of [401, 403]) {
      const r = refusal(status);
      expect(r).toMatch(/CREDENTIALS REFUSED/);
      // The trap is specific: passing one of --user/--pass leaves the other at
      // its default, which reads as a wrong password rather than a half-given
      // pair. Naming both is what turns the message into a remedy.
      expect(r).toContain('--user');
      expect(r).toContain('--pass');
      // Naming the two flags is not enough. The trap that produced the 401 was
      // giving ONE of them: `--user` alone leaves --pass at its built-in
      // default, so the failure reads like a wrong password rather than a
      // half-given pair. The explanation is the part that saves the reader.
      expect(r).toMatch(/one of the pair alone/i);
      expect(r).not.toMatch(/filter body/i);
    }
  });

  it('404 says nothing was created there, and names both seeder vocabularies', () => {
    const r = refusal(404);
    expect(r).toMatch(/NO SUCH COLLECTION/);
    // The 404 that started this was the managed seeder's collection name read
    // from the self-hosted seeder's default. A reader who knows only one of
    // the two spellings cannot tell which mistake they made.
    expect(r).toContain('openmig-tasks');
    expect(r).toContain('e2e-tasks');
    expect(r).not.toMatch(/filter body/i);
  });

  it('400 and 415 keep the verdict that was always true of them', () => {
    // Not a regression to guard against so much as the point: the original
    // sentence was correct for exactly these, and narrowing it must not lose
    // the one case it was written for.
    for (const status of [400, 415]) {
      expect(refusal(status)).toMatch(/FILTER BODY IS REJECTED/i);
    }
  });

  it('a status it has no reading for says so, rather than guessing', () => {
    // The default is where a confident wrong answer would come back in. It has
    // to be a statement about this tool's knowledge, not about the server.
    const r = refusal(507);
    expect(r).toContain('507');
    expect(r).toMatch(/no reading/i);
    expect(r).not.toMatch(/filter body|CREDENTIALS|NO SUCH COLLECTION/i);
  });

  it('every reading is distinct, so two states never read alike', () => {
    // The defect in one sentence: four different situations, one sentence.
    const readings = [401, 403, 404, 405, 501, 400, 415, 507].map(refusal);
    expect(new Set(readings).size).toBeGreaterThanOrEqual(5);
  });
});

describe('the ground truth is read before it is believed', () => {
  // A guard over the probe's TEXT, because this decision lives inside `main()`
  // behind two network calls and there is nothing pure to import. The same
  // rule the shell guards in this directory work under: assert the structure
  // that carries the property, since a paraphrase would drift.
  const probe = readFileSync(join(REPO_ROOT, 'scripts/dav-target-probe.mjs'), 'utf8');

  it('a PROPFIND that was refused never becomes an empty collection', () => {
    // `propfindMembers` parses a 401 body to 0 members exactly as it parses an
    // empty collection, and `present === 0` is the FIRST test the verdict chain
    // makes — so an unread PROPFIND status turns "I was not allowed to look"
    // into "(1) NOTHING WAS WRITTEN — the collection really is empty. The sync
    // is at fault." A confident wrong answer accusing the wrong component,
    // which is the whole thing this tool exists to stop producing.
    const guard = probe.indexOf('ground.status !== 207');
    const use = probe.indexOf('propfindMembers(ground.text');
    expect(guard, 'the PROPFIND status is never checked').toBeGreaterThan(-1);
    expect(use, 'propfindMembers is no longer called on the ground truth').toBeGreaterThan(-1);
    expect(guard, 'the status is checked AFTER the members are counted').toBeLessThan(use);
    // And it reports through the same reading as the REPORT branch, so a 401
    // on either call says the same thing.
    expect(probe.slice(guard, use)).toContain('refusal(ground.status)');
  });
});
