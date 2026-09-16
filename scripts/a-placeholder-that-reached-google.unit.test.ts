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
 */

import { describe, expect, it } from 'vitest';
import {
  KIND_MIME_TYPES,
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
