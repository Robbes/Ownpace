// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A guard that the measurement can be aimed by kind, so no instruction for it
 * has to carry a placeholder.
 *
 * On 2026-09-16 the owner ran the Sheet and Slide measurement three times from
 * written instructions, and the third time the literal string `sheet-file-id`
 * reached Drive. Drive answered 404 for a file of that name — correct, and no
 * help. The defect was in the INSTRUCTION, not the script: a `<placeholder>`
 * inside a line meant to be pasted is a trap, and bash reads `<` as a redirect
 * besides.
 *
 * `drive-export-choose.ts` removes the need for the placeholder. These tests
 * pin the three things that make that safe: a kind the policy cannot export is
 * refused by name, a typo'd kind REFUSES rather than falling back to "whatever
 * was first", and the old default survives for somebody who just wants a
 * number.
 *
 * The middle one is the one that matters. A silent fallback would report a
 * Doc's stability under the heading of a Sheet's — the same class of error as
 * the run that prompted this, and harder to notice.
 *
 * ## The same evening, the same mistake, one reason later
 *
 * `DRIVE_FILE_KIND` removed the need to name a file — as long as ANY file of
 * that kind would do. It stopped being true the moment which document mattered.
 * `export-pdf` measured `stable` on a Slides deck rendering to **2017 bytes**,
 * a deck with almost nothing in it to be unstable about, because "first of that
 * kind" is a document nobody chose. Measuring a richer one meant naming it,
 * naming it meant an id, and the id went into a written instruction as
 * `PASTE_DECK_ID_HERE` — which was pasted, run, and answered 404 by Drive,
 * exactly as `sheet-file-id` had that morning.
 *
 * Twice in one day is a pattern, and the pattern is that any instruction
 * carrying a blank to fill in will eventually be run with the blank still in
 * it. `DRIVE_PICK=largest` is the fix: the script finds a substantial document
 * itself, so the instruction has no blank. `candidatesToWeigh` is the part of
 * that which can be tested without a Drive, and the tests for it are at the
 * bottom of this file rather than in a new one, because it is the same defect.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KIND_MIME_TYPES,
  candidatesToWeigh,
  chooseFile,
  readKind,
  type ChoosableFile,
} from './drive-export-choose.ts';

const DOC = { id: 'd1', name: 'Notes', mimeType: KIND_MIME_TYPES.doc };
const SHEET = { id: 's1', name: 'Budget', mimeType: KIND_MIME_TYPES.sheet };
const SLIDE = { id: 'p1', name: 'Deck', mimeType: KIND_MIME_TYPES.slide };
const PDF = { id: 'f1', name: 'scan.pdf', mimeType: 'application/pdf' };
const DRAWING = { id: 'w1', name: 'Sketch', mimeType: 'application/vnd.google-apps.drawing' };

/** What `export-office` can export — the three editor types, not the drawing. */
const OFFICE: Record<string, string> = {
  [KIND_MIME_TYPES.doc]: 'docx',
  [KIND_MIME_TYPES.sheet]: 'xlsx',
  [KIND_MIME_TYPES.slide]: 'pptx',
};

const ALL: readonly ChoosableFile[] = [PDF, DOC, DRAWING, SHEET, SLIDE];

describe('readKind', () => {
  it('reads each of the three kinds, case and padding forgiven', () => {
    expect(readKind('sheet')).toEqual({ ok: true, file: 'sheet' });
    expect(readKind('  SLIDE  ')).toEqual({ ok: true, file: 'slide' });
    expect(readKind('Doc')).toEqual({ ok: true, file: 'doc' });
  });

  it('treats unset as no preference rather than an error', () => {
    // The older behaviour is still right for somebody who only wants a number.
    expect(readKind(undefined)).toEqual({ ok: true, file: undefined });
    expect(readKind('   ')).toEqual({ ok: true, file: undefined });
  });

  it('REFUSES a typo instead of quietly measuring something else', () => {
    // The whole point. A fallback here would answer a Doc's question under a
    // Sheet's heading, which is the failure that prompted this file.
    const outcome = readKind('sheets');
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain('not one of doc, sheet, slide');
  });
});

describe('chooseFile', () => {
  it('finds the asked-for kind, not merely the first native file', () => {
    // DOC sorts before SHEET in the listing, so a chooser that ignored the kind
    // would pass this by accident. It must not.
    const outcome = chooseFile(ALL, OFFICE, 'sheet', 'My Drive', 'export-office');
    expect(outcome.ok && outcome.file).toBe(SHEET);
  });

  it('finds a slide the same way', () => {
    const outcome = chooseFile(ALL, OFFICE, 'slide', 'My Drive', 'export-office');
    expect(outcome.ok && outcome.file).toBe(SLIDE);
  });

  it('falls back to the first exportable file when no kind is asked for', () => {
    const outcome = chooseFile(ALL, OFFICE, undefined, 'My Drive', 'export-office');
    expect(outcome.ok && outcome.file).toBe(DOC);
  });

  it('never returns an ordinary file, with or without a kind', () => {
    // A PDF has real bytes and nothing to export; a Drawing is native but has
    // no mapping under this policy. Neither can answer the question.
    const outcome = chooseFile([PDF, DRAWING], OFFICE, undefined, 'My Drive', 'export-office');
    expect(outcome.ok).toBe(false);
  });

  it('says the folder is empty of that kind, and where it looked', () => {
    const outcome = chooseFile([DOC, PDF], OFFICE, 'sheet', 'My Drive', 'export-office');
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain('No Google sheet directly under My Drive');
    expect(outcome.ok === false && outcome.reason).toContain('not its subfolders');
  });

  it("refuses a kind the POLICY cannot export, before looking at the Drive", () => {
    // A policy with no mapping for a sheet is a fact about the policy. Saying
    // so here beats discovering it three requests later, and beats blaming the
    // customer's Drive for it.
    const docsOnly: Record<string, string> = { [KIND_MIME_TYPES.doc]: 'docx' };
    const outcome = chooseFile(ALL, docsOnly, 'sheet', 'My Drive', 'export-thing');
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain('no export mapping for a sheet');
    expect(outcome.ok === false && outcome.reason).toContain('not about your Drive');
  });
});

describe('candidatesToWeigh — choosing a document with something in it', () => {
  it('keeps only the asked-for kind, so a Doc cannot be weighed against a deck', () => {
    // Sizes across kinds are not comparable: a long Doc outweighs any deck and
    // would win every time, answering a question about Slides with a Doc.
    const got = candidatesToWeigh(ALL, OFFICE, 'slide', 25);
    expect(got.ok && got.file).toEqual([SLIDE]);
  });

  it('keeps every exportable kind when none was asked for', () => {
    // No kind is a real choice, not an omission, and it must not silently
    // become one kind. The PDF and the Drawing still go: neither is exportable
    // under this policy, so weighing them would weigh nothing.
    const got = candidatesToWeigh(ALL, OFFICE, undefined, 25);
    expect(got.ok && got.file).toEqual([DOC, SHEET, SLIDE]);
  });

  it('CAPS the list, because every candidate costs a real export', () => {
    // The one that protects somebody's Drive and their rate budget. Without it
    // "measure a good deck" becomes "export every deck you own", which is not a
    // decision a measurement script may take by itself.
    const many = Array.from({ length: 40 }, (_, i) => ({ ...SLIDE, id: `p${i}` }));
    const got = candidatesToWeigh(many, OFFICE, 'slide', 5);
    expect(got.ok && got.file).toHaveLength(5);
  });

  it('treats a limit of zero or less as a typo, not as "weigh nothing"', () => {
    // An empty list would strand the caller with "nothing to measure" for a
    // reason that has nothing to do with their Drive — a confusing dead end
    // from a stray character.
    for (const limit of [0, -3, Number.NaN]) {
      const got = candidatesToWeigh(ALL, OFFICE, 'slide', limit);
      expect(got.ok && got.file, `limit ${limit}`).toHaveLength(1);
    }
  });

  it('refuses a kind the policy cannot export, in the same words chooseFile uses', () => {
    // A policy with no rendering for a type is a fact about the policy. Both
    // entry points say so identically, so a reader who has met one recognises
    // the other.
    const pdfOnly: Record<string, string> = { [KIND_MIME_TYPES.doc]: 'pdf' };
    const got = candidatesToWeigh(ALL, pdfOnly, 'slide', 25);
    expect(got.ok).toBe(false);
    expect(!got.ok && got.reason).toMatch(/fact about the policy, not about your Drive/);
  });

  it('refuses an empty result with a way forward, rather than measuring nothing', () => {
    // "No decks here" is not an error in the Drive; it is a reason to stop and
    // a thing the operator can act on. The refusal names both routes out.
    const got = candidatesToWeigh([PDF, DRAWING], OFFICE, 'slide', 25);
    expect(got.ok).toBe(false);
    expect(!got.ok && got.reason).toMatch(/Unset DRIVE_PICK/);
  });
});

describe('the instruction still needs no blank to fill in', () => {
  const script = readFileSync(join(import.meta.dirname, 'drive-export-stability.ts'), 'utf8');

  it('refuses DRIVE_FILE_ID together with DRIVE_PICK, rather than picking one', () => {
    // Both name a document. Letting either win silently would make the output
    // a lie about which document was measured — the same shape as the typo'd
    // kind falling back, which is what the middle test above exists for.
    expect(script).toMatch(/DRIVE_FILE_ID names one document and DRIVE_PICK=largest/);
  });

  it('prints neither a name nor an id when it picks for you', () => {
    // This output gets pasted into workplans and issues. The run already prints
    // the mime type and the timestamp rather than the name and the id, and the
    // picker must not undo that by announcing which file it found.
    const picker = script.slice(script.indexOf('async function pickLargest'));
    const body = picker.slice(0, picker.indexOf('\n}'));
    // Matches through any depth of property access — `${file.name}` and
    // `${best.file.name}` alike. The first draft of this anchored on `\w+\.name`
    // and therefore passed while a mutation printed `${best.file.name}`: a
    // guard that asserts nothing is worse than no guard, because it is counted.
    expect(body, 'pickLargest prints a file name').not.toMatch(/\$\{[^}]*\.name\b/);
    expect(body, 'pickLargest prints a file id').not.toMatch(/\$\{[^}]*\.id\b/);
  });
});

describe('a weigh that fails for a reason nothing to do with the policy', () => {
  const script = readFileSync(join(import.meta.dirname, 'drive-export-stability.ts'), 'utf8');
  const picker = script.slice(script.indexOf('async function pickLargest'));
  const body = picker.slice(0, picker.indexOf('\n}'));

  it('records WHY the first candidate failed, rather than only that it did', () => {
    // A grant that expires between the listing and the first export fails
    // EVERY candidate with a 401. A bare `catch {}` counted those and threw the
    // reason away, leaving the run with nothing true to say about itself.
    expect(body, 'the per-candidate catch discards the error').toMatch(/catch \(\s*\w+\s*\)/);
    expect(body).toMatch(/firstFailure/);
  });

  it('puts that reason in front of the reader when every candidate failed', () => {
    // The sentence somebody acts on. Without the cause it proposed a setting
    // change for an authentication problem — the same wrong-cause failure the
    // refusals in this workplan exist to stop, arriving through the tool built
    // to measure them.
    const allFailed = body.slice(body.indexOf('if (!best)'));
    expect(allFailed).toMatch(/firstFailure/);
  });

  it('says plainly that a 401 or 403 is not the policy', () => {
    // The specific misdirection worth naming: "try another policy" is wrong
    // advice for an expired grant, and a reader who has just been handed a 401
    // should be told so rather than left to infer it.
    expect(body).toMatch(/401/);
    expect(body).toMatch(/403/);
    expect(body).toMatch(/the policy is not the/);
  });
});
