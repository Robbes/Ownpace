// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A RED VERDICT THE TABLE CALLS STABLE (found 2026-09-17, on the owner's run).
 *
 * The owner measured the last two blanks and both came back `✖ NOT STABLE`:
 * `export-odf` on a Sheet (12856 bytes, five hashes) and on a Slide (12633
 * bytes, five hashes). Both printed, one line above that verdict:
 *
 *   No member's content changed. Only zip modification stamps moved, on 15
 *   member(s). The document is byte-identical inside a rebuilt container.
 *   Ignoring the zip's OWN bookkeeping ... the draws agree.
 *
 * and then, one line below it, `"export-odf" MUST NOT be enabled for a real
 * migration ... keep the default 'refuse'`.
 *
 * Both sentences cannot be true. `EXPORT_STABILITY` defines `stable` as
 * "byte-identical OR settleable by the container hash", and `export-office` on
 * a Doc and a Sheet are recorded `stable` on exactly this evidence and have
 * been exported ever since. The script was simply written before ADR-0046,
 * when rewriting the container was a candidate rather than a thing that
 * shipped — so it kept saying "a rewrite would fix this" about a rewrite that
 * had already happened.
 *
 * This file holds the claim that decides which sentence was right: a rendering
 * whose members are identical and whose stamps moved is ONE content hash to
 * the code that actually does the copying. If that stops being true, the
 * recording in the table is wrong and these three greens have to come out.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { containerContentHash } from '@openmig/shared';
import { exportOutcome } from './drive-export-verdict.ts';
import {
  EXPORT_STABILITY,
  exportStabilityOf,
} from '@openmig/connectors';

const G = 'application/vnd.google-apps.';

/**
 * A store-only zip, written from the specification rather than a library.
 *
 * Independent on purpose, for the reason `container-hash.unit.test.ts` gives
 * for its own copy: a fixture built by the same code that reads it proves
 * nothing. `time` is the DOS stamp — the single field Drive moves between two
 * exports of an unchanged document, and the one this hash must ignore.
 */
function zip(entries: ReadonlyArray<{ name: string; body: string; time: number }>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const body = Buffer.from(entry.body, 'utf8');
    const sum = crc32(body);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.time, 10); // modification time — the volatile field
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.time, 12);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/** The owner's Sheet, as the script described it: 15 members, only stamps moving. */
const MEMBERS = Array.from({ length: 15 }, (_, i) => ({
  name: `content-${i}.xml`,
  body: `<part index="${i}">unchanged between every draw</part>`,
  // A stamp every member carries; the draws below override it, and the
  // content-change test keeps it FIXED so the only difference is the body.
  time: 1000,
}));

describe('the evidence the owner actually got', () => {
  it('five draws that differ as WHOLE FILES', () => {
    // The premise. Without this the rest proves nothing — a red verdict has to
    // be a real red before it is worth settling.
    const draws = [1, 2, 3, 4, 5].map((t) => zip(MEMBERS.map((m) => ({ ...m, time: t * 1000 }))));
    const whole = new Set(draws.map((d) => Buffer.from(d).toString('base64')));
    expect(whole.size, 'the draws are identical, so this fixture is not the owner\'s case').toBe(5);
  });

  it('is ONE content hash to the code that does the copying', () => {
    // THE CLAIM THE RECORDING RESTS ON. `containerContentHash` is what a
    // rendering is hashed by (`dav-sync`), and the Drive source marks EVERY
    // export a rendering whatever the policy — so this is the number a second
    // pass compares, not the whole-file hash the script prints.
    const draws = [1, 2, 3, 4, 5].map((t) => zip(MEMBERS.map((m) => ({ ...m, time: t * 1000 }))));
    const hashes = new Set(draws.map((d) => containerContentHash(d)));
    expect(hashes.size, 'a second pass would see a change and re-copy the document').toBe(1);
    expect([...hashes][0]).not.toBeNull();
  });

  it('still moves when a member\'s CONTENT changes, which is the Doc\'s case', () => {
    // The contrast that keeps this honest. `export-odf` on a DOC is `unstable`
    // because `settings.xml` really changes, and no container normalisation
    // rescues that — if it did, the table would have no reds at all and the
    // whole exercise would be decoration.
    const a = zip([...MEMBERS, { name: 'settings.xml', body: 'view=1', time: 1000 }]);
    const b = zip([...MEMBERS, { name: 'settings.xml', body: 'view=2', time: 1000 }]);
    expect(containerContentHash(a)).not.toBe(containerContentHash(b));
  });
});

describe('what the table now records', () => {
  it('has no blanks left — every cell measured', () => {
    // The first time this has been true. `unmeasured` stays in the TYPE and in
    // `exportStabilityOf`'s fallback, because it is the answer for a type
    // Drive adds next; it just has no cell standing on it today.
    const blanks: string[] = [];
    for (const [policy, types] of Object.entries(EXPORT_STABILITY)) {
      for (const [mime, stability] of Object.entries(types)) {
        if (stability === 'unmeasured') blanks.push(`${policy} x ${mime}`);
      }
    }
    expect(blanks, `still unmeasured: ${blanks.join(', ')}`).toEqual([]);
    expect(exportStabilityOf('export-pdf', `${G}somethingDriveInventsNextYear`)).toBe('unmeasured');
  });

  it('records the owner 2026-09-17 runs', () => {
    expect(exportStabilityOf('export-pdf', `${G}drawing`)).toBe('stable');
    expect(exportStabilityOf('export-odf', `${G}spreadsheet`)).toBe('stable');
    expect(exportStabilityOf('export-odf', `${G}presentation`)).toBe('stable');
  });

  it('keeps the two reds, one per policy, and they are different failures', () => {
    // A Doc under `export-odf` (settings.xml moves) and a deck under
    // `export-office` (five members move). Neither is settleable.
    expect(exportStabilityOf('export-odf', `${G}document`)).toBe('unstable');
    expect(exportStabilityOf('export-office', `${G}presentation`)).toBe('unstable');
  });

  it('a deck measures settleable under two policies and unstable under one', () => {
    // The sharpest evidence that a policy cannot be judged whole: the SAME
    // deck is settleable under `export-odf` and genuinely unstable under
    // `export-office`. Two renderers, two answers. A record since 2026-09-23:
    // no measurement refuses an export any more (ADR-0046, amended).
    expect(exportStabilityOf('export-odf', `${G}presentation`)).toBe('stable');
    expect(exportStabilityOf('export-pdf', `${G}presentation`)).toBe('stable');
    expect(exportStabilityOf('export-office', `${G}presentation`)).toBe('unstable');
  });

  it('export-pdf is stable on all four types, which is the escape hatch complete', () => {
    for (const kind of ['document', 'spreadsheet', 'presentation', 'drawing']) {
      expect(exportStabilityOf('export-pdf', `${G}${kind}`), kind).toBe('stable');
    }
  });
});

describe('the script no longer contradicts the table', () => {
  const SOURCE = readFileSync(join(process.cwd(), 'scripts/drive-export-stability.ts'), 'utf8');

  /**
   * THIS BLOCK WAS ONCE A SOURCE-TEXT GUARD AND IT PROVED NOTHING.
   *
   * It read the script and asserted that the settled branch appeared before
   * the refusal sentence. Mutating `if (container === 'settled')` to
   * `if (container === 'settled' && false)` — which restores the exact defect,
   * every container-only result told to keep `refuse` — left the text intact
   * and the test green. Found by mutation, which is the only reason it is not
   * still sitting there looking like coverage.
   *
   * The decision now lives in `exportOutcome`, so these assert behaviour.
   */
  it('calls a container-only result settled, not unstable', () => {
    expect(exportOutcome(false, 'settled')).toBe('settled-by-container');
  });

  it('still calls a real red unstable, and a PDF too', () => {
    // `not-settled`: a member's content genuinely moved. `no-container`: not a
    // zip, so there was nothing to normalise and the bytes are all there is.
    expect(exportOutcome(false, 'not-settled')).toBe('unstable');
    expect(exportOutcome(false, 'no-container')).toBe('unstable');
  });

  it('byte-identical outranks whatever the container says', () => {
    // Including the nonsense case: if the draws are identical, the container
    // reading cannot demote them.
    for (const reading of ['settled', 'not-settled', 'no-container'] as const) {
      expect(exportOutcome(true, reading)).toBe('byte-identical');
    }
  });

  it('is the decision the script actually branches on', () => {
    // The one thing source-reading is still right for: that the script calls
    // the function rather than keeping a second copy of the rule inline.
    expect(SOURCE).toContain("exportOutcome(verdict.stable, container) === 'settled-by-container'");
  });

  it('names ADR-0046 as shipped rather than as a candidate', () => {
    expect(SOURCE).toContain('this product already rewrites');
    expect(SOURCE).not.toContain('a rewrite of the container would fix');
  });
});
