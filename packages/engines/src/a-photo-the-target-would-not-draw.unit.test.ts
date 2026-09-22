// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PHOTO THE TARGET WOULD NOT DRAW.
 *
 * 1,229 contacts migrated from Google to Nextcloud. The photos came with them
 * — inline base64, bytes intact on the target, verifiable by reading the card
 * back. Nextcloud drew the initials.
 *
 * The card said:
 *
 *     VERSION:3.0
 *     FN:Harm Cranenbroek
 *     PHOTO;ENCODING=B:/9j/4AAQSkZJRgABAQAAAQABAAD…
 *
 * `ENCODING` says the value is encoded. Nothing says what it IS. A consumer
 * holding bytes it cannot name cannot render them, so it renders a monogram.
 *
 * MEASURED, NOT REASONED. The owner added `TYPE=JPEG` to one card by hand and
 * the picture appeared. That first attempt also lowercased the `B`, so it
 * proved a pair of changes and not one — a second card was done with the
 * capital kept and only the TYPE added, and it worked too. That is what makes
 * `TYPE` the cause rather than the likelier-looking of two suspects, and it is
 * the reason this guard asserts a capital `ENCODING=B` is left exactly as it
 * is.
 *
 * WHY THE REPAIR IS NARROW. `repairPayload` may rewrite a customer's card only
 * where the file header records the owner asking for it, and this is the
 * second such repair. It adds a parameter that is missing, to a property that
 * already declares encoded bytes, naming a format the bytes themselves
 * identify. An unrecognised magic number produces NO repair: a wrong TYPE is
 * worse than a missing one, because it is a claim rather than a silence.
 *
 * AND IT IS AN INSERTION, which nothing in this file did before. Every earlier
 * repair replaced one character in place so a card with nothing wrong went
 * through byte-identical. That property is what these tests spend most of
 * their assertions on: an untouched card, an untouched line, an untouched
 * fold.
 */

import { describe, it, expect } from 'vitest';
import { repairPayload } from './dav-payload-defects.ts';

/** A vCard the way a server actually serves one: CRLF, folded. */
function card(...lines: readonly string[]): string {
  return [...lines, ''].join('\r\n');
}

const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD';
const PNG = 'iVBORw0KGgoAAAANSUhEUg';

describe('a photo the target would not draw', () => {
  it('adds the TYPE the bytes name, and changes nothing else', () => {
    const before = card('BEGIN:VCARD', 'VERSION:3.0', 'FN:Harm', `PHOTO;ENCODING=B:${JPEG}`, 'END:VCARD');
    const { body, corrections } = repairPayload(before);
    expect(body).toContain(`PHOTO;ENCODING=B;TYPE=JPEG:${JPEG}`);
    // THE CAPITAL B SURVIVES. The owner's first card lowercased it too; the
    // second proved the lowercase was never the point. Touching it here would
    // re-introduce the ambiguity that card was run to remove.
    expect(body).not.toContain('ENCODING=b;');
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toContain('TYPE=JPEG');
    // Everything else byte-for-byte.
    expect(body.replace(';TYPE=JPEG', '')).toBe(before);
  });

  it('names the format from the bytes rather than assuming one', () => {
    const png = repairPayload(card('BEGIN:VCARD', `PHOTO;ENCODING=B:${PNG}`, 'END:VCARD'));
    expect(png.body).toContain('TYPE=PNG');
    expect(png.body).not.toContain('JPEG');
  });

  it('says nothing when it cannot identify the bytes', () => {
    // A wrong TYPE is a CLAIM. A missing one is a silence. Silence is safer,
    // so an unknown magic number leaves the card exactly as it came.
    const before = card('BEGIN:VCARD', 'PHOTO;ENCODING=B:AAAAAAAAAAAAAAAA', 'END:VCARD');
    const { body, corrections } = repairPayload(before);
    expect(body).toBe(before);
    expect(corrections).toEqual([]);
  });

  it('leaves a photo that already says what it is', () => {
    for (const already of [
      `PHOTO;ENCODING=B;TYPE=JPEG:${JPEG}`,
      `PHOTO;TYPE=JPEG;ENCODING=B:${JPEG}`,
      `PHOTO;type=jpeg;ENCODING=B:${JPEG}`,
    ]) {
      const before = card('BEGIN:VCARD', already, 'END:VCARD');
      expect(repairPayload(before).body, already).toBe(before);
    }
  });

  it('leaves a photo that is a LINK, which has no bytes to name', () => {
    const before = card(
      'BEGIN:VCARD',
      'PHOTO;VALUE=uri:https://lh3.googleusercontent.invalid/a/abc',
      'END:VCARD',
    );
    expect(repairPayload(before).body).toBe(before);
  });

  it('finds the property through folding, where a naive scan would not', () => {
    // RFC 6350 §3.2: a continuation begins with a space. A real photo is folded
    // across dozens of lines, and the magic number sits on the first of them —
    // but the PARAMETERS can be folded too, which is the case worth catching.
    const before = card(
      'BEGIN:VCARD',
      'PHOTO;ENCOD',
      ' ING=B:/9j/4AAQSkZJRgABAQ',
      ' AAAQABAAD',
      'END:VCARD',
    );
    const { body, corrections } = repairPayload(before);
    expect(corrections).toHaveLength(1);
    // Inserted at the colon's real position in the ORIGINAL bytes, so the fold
    // that was there is still there.
    expect(body).toContain(' ING=B;TYPE=JPEG:/9j/');
    expect(body).toContain('\r\n AAAQABAAD');
  });

  it('leaves a card with nothing wrong byte-identical', () => {
    // The oldest rule in this file, and the one an insertion could most easily
    // have broken.
    const before = card('BEGIN:VCARD', 'VERSION:3.0', 'FN:Nobody', 'TEL;TYPE=CELL:+310', 'END:VCARD');
    const { body, corrections } = repairPayload(before);
    expect(body).toBe(before);
    expect(corrections).toEqual([]);
  });

  it('repairs a separator and a missing TYPE in the same card', () => {
    // The two repairs use different machinery — one replaces a character, the
    // other inserts a run — and they have to compose without disturbing each
    // other's offsets.
    const before = card(
      'BEGIN:VCARD',
      'BDAY;VALUE=DATE,X-APPLE-OMIT-YEAR=1604:16041225',
      `PHOTO;ENCODING=B:${JPEG}`,
      'END:VCARD',
    );
    const { body, corrections } = repairPayload(before);
    expect(body).toContain('BDAY;VALUE=DATE;X-APPLE-OMIT-YEAR=1604:');
    expect(body).toContain(`PHOTO;ENCODING=B;TYPE=JPEG:${JPEG}`);
    expect(corrections).toHaveLength(2);
  });

  it('never returns a byte of the image', () => {
    // The header's rule, still holding: the VALUE is personal data. What leaves
    // this function about a photo is the word JPEG.
    const { corrections } = repairPayload(card('BEGIN:VCARD', `PHOTO;ENCODING=B:${JPEG}`, 'END:VCARD'));
    for (const sentence of corrections) {
      expect(sentence).not.toContain('/9j/');
      expect(sentence).not.toContain(JPEG.slice(0, 8));
    }
  });
});
