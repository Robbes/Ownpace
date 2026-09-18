// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE REPAIR REACHES THE ROW, AND THE HASH (workplan 0124 T1).
 *
 * `a-card-repaired-on-the-way-out` holds the three guard rails over the repair
 * itself. This holds the two things about WIRING it into a writer that no test
 * of the function could catch, and both are quiet:
 *
 *  1. **It runs before the content hash.** Hashing the unrepaired bytes stores
 *     the hash of something we never sent, so every later pass compares the
 *     source against a description of a card that does not exist on the
 *     target, sees a change nobody made, and rewrites it. Nightly. Nothing
 *     fails, nothing logs, and the owner finds their address book rewritten.
 *  2. **The correction lands on the item.** Rail 3 is the reason repairing
 *     somebody's content is acceptable at all — a pass must never quietly do
 *     something to a customer's data. A repair that happened and was not
 *     recorded is exactly the silent rewrite the rail forbids, and it returns
 *     the same `UpsertResult` either way.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repairPayload } from './dav-payload-defects.ts';

const WRITER = readFileSync(join(import.meta.dirname, 'carddav-target-writer.ts'), 'utf-8');

/** `upsertContact`'s body, to its closing brace at method indentation. */
function upsertBody(): string {
  const at = WRITER.indexOf('async upsertContact(');
  expect(at, 'upsertContact has been renamed').toBeGreaterThan(-1);
  const end = WRITER.indexOf('\n  }\n', at);
  return WRITER.slice(at, end);
}

describe('the repair runs before anything reads the bytes', () => {
  it('repairs before the content hash is taken', () => {
    // THE ONE THAT REWRITES SOMEBODY'S ADDRESS BOOK NIGHTLY if it is wrong.
    const body = upsertBody();
    const repaired = body.indexOf('repairPayload(');
    const hashed = body.indexOf('contactContentHash(');
    expect(repaired, 'upsertContact no longer repairs').toBeGreaterThan(-1);
    expect(hashed, 'upsertContact no longer hashes').toBeGreaterThan(-1);
    expect(hashed, 'the card is hashed before it is repaired').toBeGreaterThan(repaired);
  });

  it('repairs before the UID is read, so one card cannot key two ways', () => {
    const body = upsertBody();
    expect(body.indexOf('extractUidFromVcard(')).toBeGreaterThan(body.indexOf('repairPayload('));
  });

  it('sends the repaired body, not the one that came in', () => {
    // `rawIn` is the argument; `raw` is what the rest of the method uses. A
    // writer that PUT `rawIn.vcard` would repair the hash and send the defect.
    const body = upsertBody();
    expect(body).toMatch(/const raw: RawContact =/);
    expect(body).toMatch(/uploadContact\(\s*folderId,\s*raw,/);
    expect(body, 'the incoming body is still being sent somewhere').not.toMatch(
      /rawIn\.vcard[\s\S]{0,40}uploadContact/,
    );
  });

  it('leaves the object alone when nothing was corrected', () => {
    // `repair.corrections.length === 0 ? rawIn : {...}` — the same object, so a
    // well-formed card is not even re-wrapped. Cheap, and it keeps "byte-
    // identical" true of the whole path rather than only of the function.
    expect(upsertBody()).toMatch(/corrections\.length === 0 \? rawIn :/);
  });
});

describe('the correction lands on the item', () => {
  it('is passed to EVERY recordIfAbsent in the method', () => {
    // Two of them: the adopted path and the written path. A repair recorded on
    // one and not the other is a row that says nothing about a card we changed,
    // which is the silent rewrite rail 3 exists to forbid.
    const body = upsertBody();
    const inserts = body.split('recordIfAbsent(').length - 1;
    expect(inserts, 'recordIfAbsent is no longer called twice here').toBe(2);
    expect(body.split('{ repaired }').length - 1).toBe(inserts);
  });

  it('is undefined for a well-formed card, so the column stays NULL', () => {
    // NULL means "nothing was corrected". Recording an empty string instead
    // would make every row in the account claim a repair happened.
    expect(upsertBody()).toMatch(/corrections\.length > 0 \? [\s\S]{0,40} : undefined/);
  });

  it('carries the sentences the reader would have produced, joined', () => {
    // Not a flag. Rail 3 says the evidence is on the item, and "something was
    // corrected" is not evidence — the line, the property and the parameter are.
    expect(upsertBody()).toMatch(/corrections\.join\(/);
    const [sentence] = repairPayload(
      'BEGIN:VCARD\r\nBDAY;VALUE=DATE,X-APPLE-OMIT-YEAR=1604:16041105\r\nEND:VCARD\r\n',
    ).corrections;
    expect(sentence).toContain('property BDAY');
    expect(sentence).toContain('parameter VALUE');
  });
});
