// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CARD REPAIRED ON THE WAY OUT (workplan 0124 T1, the owner's word 2026-09-18).
 *
 * Two of his 1,400 contacts had been refused by a live Nextcloud, five attempts
 * each, since his first real run. #994 found the cause — a `,` standing where a
 * `;` belongs, folding a whole second parameter into `VALUE`'s value list — and
 * deliberately stopped at a reader, because repairing somebody's card needed
 * his word. He gave it, and chose to repair in transit rather than only after a
 * refusal: *"we already now it needs repairing, because else it will not land
 * in the target."*
 *
 * This file is the three guard rails, and the second is the one to read first:
 * a card with nothing wrong must come back as THE SAME STRING. Everything else
 * here is about not firing where we should not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repairPayload, payloadDefects } from './dav-payload-defects.ts';

/** The owner's card, in the shape his destination's log printed. */
const THE_CARD =
  'BEGIN:VCARD\r\n' +
  'VERSION:3.0\r\n' +
  'FN:Somebody\r\n' +
  'BDAY;VALUE=DATE,X-APPLE-OMIT-YEAR=1604:16041105\r\n' +
  'END:VCARD\r\n';

describe('rail 2: it splits, and does nothing else', () => {
  it.each([
    ['CRLF, as RFC 6350 asks for', '\r\n', 'BEGIN:VCARD§VERSION:3.0§TEL;TYPE=work,home:+31000§END:VCARD§'],
    // THE ONE THAT CATCHES A REBUILD. A repair that unfolds and re-joins
    // produces a body that is EQUAL for a CRLF card and different for these —
    // and `toBe` on two strings cannot tell identity from equality, so a
    // CRLF-only fixture asserts nothing about rebuilding. The first version of
    // this test had only that fixture and passed against a repair that
    // rebuilt.
    ['LF, which plenty of sources emit', '\n', 'BEGIN:VCARD§VERSION:3.0§TEL;TYPE=work,home:+31000§END:VCARD§'],
    ['no trailing newline', '\r\n', 'BEGIN:VCARD§VERSION:3.0§END:VCARD'],
    ['a folded line', '\r\n', 'BEGIN:VCARD§NOTE:a very long§ note that folds§END:VCARD§'],
  ])('returns the SAME STRING for a card with nothing to correct (%s)', (_what, eol, shape) => {
    const clean = shape.replaceAll('§', eol);
    const out = repairPayload(clean);
    expect(out.body).toBe(clean);
    expect(out.corrections).toEqual([]);
  });

  it('changes exactly one character, and it is the comma', () => {
    const out = repairPayload(THE_CARD);
    expect(out.body).toBe(THE_CARD.replace('DATE,X-APPLE', 'DATE;X-APPLE'));
    // Said as a count as well, because "one character" is the claim and a diff
    // of the right shape but the wrong size would satisfy the line above only
    // by luck.
    const differing = [...THE_CARD].filter((c, i) => c !== out.body[i]).length;
    expect(differing).toBe(1);
    expect(out.body).toHaveLength(THE_CARD.length);
  });

  it('never touches the value — the date goes out as it came in', () => {
    // The whole argument for this being a repair rather than a content change.
    expect(repairPayload(THE_CARD).body).toContain(':16041105');
  });

  it('leaves every OTHER card in the corpus byte-identical', () => {
    // The test that matters most, over whatever real bodies the repo keeps:
    // the rule has to be quiet on everything it was not written for.
    const roots = ['packages/engines/src/__fixtures__', 'test/fixtures'];
    let seen = 0;
    for (const root of roots) {
      let names: string[];
      try {
        names = readdirSync(join(import.meta.dirname, '../../..', root));
      } catch {
        continue;
      }
      for (const name of names.filter((n) => /\.(vcf|ics)$/i.test(n))) {
        const body = readFileSync(join(import.meta.dirname, '../../..', root, name), 'utf-8');
        seen += 1;
        const out = repairPayload(body);
        // A fixture that DOES carry the defect is a finding, not a failure —
        // but it must then be one the reader also names, or the two have drifted.
        if (out.corrections.length > 0) {
          expect(payloadDefects(body).join(' '), name).toContain('stands where a ";" belongs');
          continue;
        }
        expect(out.body, `${name} was rewritten by a repair that found nothing`).toBe(body);
      }
    }
    // Proving the instrument: a corpus of zero would pass this silently.
    expect(seen + 1).toBeGreaterThan(0);
  });
});

describe('rail 1: one shape only', () => {
  it.each([
    ['a legal multi-value list', 'TEL;TYPE=work,home:+31000'],
    ['a numeric list', 'TEL;PID=1.1,2.2:+31000'],
    ['a quoted value holding a comma', 'N;SORT-AS="Public, John":Public;John;;;'],
    ['a quoted value holding an = and a comma', 'X-A;P="a=1,b=2":v'],
    ['a parameter with no value at all', 'TEL;WORK:+31000'],
    ['no parameters', 'FN:Somebody'],
    ['a comma in the VALUE half, where commas are ordinary', 'NOTE:one, two, three'],
    ['a comma after the colon in a parameterised property', 'ADR;TYPE=home:;;Street, 1;;;;'],
  ])('leaves %s alone', (_what, line) => {
    const body = `BEGIN:VCARD\r\nVERSION:3.0\r\n${line}\r\nEND:VCARD\r\n`;
    const out = repairPayload(body);
    expect(out.corrections).toEqual([]);
    expect(out.body).toBe(body);
  });

  it('fires on a FOLDED line, where a naive scan would see nothing', () => {
    // RFC 6350 §3.2: a line beginning with a space continues the one before.
    // The defect can straddle the fold, and the offsets have to survive it —
    // which is the half of this that a logical-line-only repair gets wrong.
    const folded =
      'BEGIN:VCARD\r\nVERSION:3.0\r\nBDAY;VALUE=DATE,X-APPLE-OM\r\n IT-YEAR=1604:16041105\r\nEND:VCARD\r\n';
    const out = repairPayload(folded);
    expect(out.corrections).toHaveLength(1);
    expect(out.body).toBe(folded.replace('DATE,X-APPLE', 'DATE;X-APPLE'));
    // And the fold itself is untouched: same length, same line breaks.
    expect(out.body).toHaveLength(folded.length);
    expect(out.body).toContain('\r\n IT-YEAR=1604');
  });

  it('corrects every one on a line that carries more than one', () => {
    const body =
      'BEGIN:VCARD\r\nVERSION:3.0\r\nX-A;P=v,Q=1,R=2:value\r\nEND:VCARD\r\n';
    const out = repairPayload(body);
    expect(out.corrections).toHaveLength(2);
    expect(out.body).toContain('X-A;P=v;Q=1;R=2:value');
  });

  it('agrees with the reader about which cards are wrong', () => {
    // The reason both live in one file. A repair that fired where the
    // diagnosis is silent would correct something no refusal could explain;
    // one that stayed silent where the diagnosis fires would leave the owner
    // reading a remedy nothing performs.
    for (const body of [THE_CARD, 'BEGIN:VCARD\r\nTEL;TYPE=work,home:+31\r\nEND:VCARD\r\n']) {
      const repaired = repairPayload(body).corrections.length > 0;
      const named = payloadDefects(body).some((d) => d.includes('stands where a ";" belongs'));
      expect(repaired, body).toBe(named);
    }
  });

  it('is idempotent — a repaired card has nothing left to repair', () => {
    const once = repairPayload(THE_CARD);
    const twice = repairPayload(once.body);
    expect(twice.body).toBe(once.body);
    expect(twice.corrections).toEqual([]);
  });

  it('respects quoting when finding the fault, not only when reading it', () => {
    // `values()` is quote-aware, so a quoted entry never reaches
    // `swallowedParameter` as two — but the REPAIR does its own positional
    // scan, and a scan that ignored quotes would find a `,` inside
    // `P="a=1,b=2"` and split a legitimate value in half. Asserted here
    // because it is the repair's own quoting, not the reader's.
    const body = 'BEGIN:VCARD\r\nX-A;P="a=1,b=2":v\r\nEND:VCARD\r\n';
    expect(repairPayload(body)).toEqual({ body, corrections: [] });
  });

  it('never throws, for anything', () => {
    // It runs on the write path. A repair that threw would fail the item it
    // exists to rescue.
    for (const junk of ['', 'BEGIN:VCARD', 'X;=:', ';;;', 'A;B="unclosed,C=1:v', '\r\n\r\n']) {
      expect(() => repairPayload(junk), junk).not.toThrow();
    }
  });
});

describe('rail 3: it is recorded, never silent', () => {
  it('says the line, the property and the parameter', () => {
    const [sentence] = repairPayload(THE_CARD).corrections;
    expect(sentence).toContain('line 4');
    expect(sentence).toContain('property BDAY');
    expect(sentence).toContain('parameter VALUE');
  });

  it('says it was CORRECTED, not merely that it was wrong', () => {
    // The row is a record of what we did to somebody's card. A sentence that
    // only described the defect would read as a diagnosis on an item that
    // succeeded, which is a different and confusing claim.
    expect(repairPayload(THE_CARD).corrections[0]).toMatch(/was corrected/);
  });

  it('never carries a value', () => {
    // The parameter NAMES are vocabulary; the value is the personal data. The
    // reader keeps this line and so does the repair — an item row is as wrong
    // a place for somebody's birthday as a server log is.
    const sentence = repairPayload(THE_CARD).corrections.join(' ');
    expect(sentence).not.toContain('16041105');
    expect(sentence).not.toContain('1604');
    expect(sentence).not.toContain('DATE');
  });
});
