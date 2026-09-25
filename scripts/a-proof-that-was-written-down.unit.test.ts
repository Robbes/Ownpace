// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROOF THAT WAS WRITTEN DOWN (workplan 0141 T1, with 0131 T2 (a)).
 *
 * Before the alpha, most sources a tester can pick had never completed a pass
 * against a real account, and the places that could have said so did not:
 *
 * - `docs/feature-matrix.md` marked Microsoft To Do and Google Tasks ✅ in its
 *   open-gaps table, one cell away from *"unmeasured against a live tenant"*
 *   and *"unmeasured against a live account"*. Its own legend says ⏳ is
 *   *"built, awaiting first contact with reality"*;
 * - the matrix marks Microsoft 365 *Via IMAP* and *Via the Graph API* ✅, and
 *   0008 T7's acceptance, *"documented green run linked in this Status
 *   block"*, was never met: no run is linked anywhere (0141 §1);
 * - the O365 lane has never completed a run, and its harness imports none of
 *   the product's connectors, so it would not have proven the product if it
 *   had.
 *
 * The owner chose to label what is unproven rather than hide it (0131 D6,
 * 0141 D1), so the label is only as honest as the record that takes it off.
 * This guard is that record's shape. A verdict in `SOURCE_PROOFS`
 * (`packages/shared/src/front-door.ts`) says *proven* only by naming a row in
 * the matrix's **Live proofs** section, and a row there is a full account of
 * one run: counts, a second pass that created nothing, and a verification.
 *
 * ## What is checked
 *
 * 1. Every row of *Recorded proofs* has every field; its counts are numbers,
 *    its second pass created 0, it names a verification and the workplan
 *    holding the detail, and it carries no address and no tenant id.
 * 2. No row of the open-gaps table carries ✅ beside "unmeasured" or
 *    "unproven".
 * 3. Every proven verdict names a Live proofs row with the same kind (and,
 *    for an account's face, the same face), and no experimental verdict has
 *    one.
 * 4. *Proven before this record* (below) only shrinks.
 *
 * ## Proven before this record: a deviation, named
 *
 * 0141 T1 wants every proven verdict to name a row with counts, and 0131 §1
 * and 0141 T6 both call the Google product cards, the Google account's
 * calendar and contacts, and IMAP proven today. Those runs happened (the
 * owner's own Google account, routinely, for weeks; IMAP against the Stalwart
 * the nightly runs) and the repository does not hold their counts. Labelling
 * them experimental would be false, and writing counts nobody took would be
 * worse. So the section has a second table for them: each row says what ran
 * and where the repository says so, its counts say "not recorded" where they
 * were not, and the table is frozen at the rows it held on 2026-09-24
 * (`BEFORE_THE_RECORD` below). A face leaves it when a recorded proof replaces
 * its row; a new proof goes in the first table, to 0141 T1's standard.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY, and the verdict table is
 * imported by relative path, as other guards here import package source:
 * `front-door.ts` has no runtime import at all, only types.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOURCE_PROOFS,
  PROVEN_BEFORE_THE_RECORD,
  WHOLE_DOMAIN_PROOF_KIND,
  type SourceProof,
} from '../packages/shared/src/front-door.ts';
import { DISCOVERY_DOMAINS } from '../packages/shared/src/discovery.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX = readFileSync(join(REPO_ROOT, 'docs', 'feature-matrix.md'), 'utf8');

/** A row's face is one of the sync domains, by their own names. */
const FACES: ReadonlyArray<string> = DISCOVERY_DOMAINS;

/** 0141 T1's account classes, and the one it allows with a qualification. */
const ACCOUNT_CLASSES = ["the owner's own", 'a second account', "a tester's, supervised", 'a server we run'];

const RECORDED_HEADER = [
  'Date',
  'Kind',
  'Face',
  'Edition and stack',
  'Tag or commit',
  'Account',
  'Target',
  'Found',
  'Copied',
  'Skipped',
  'Second pass created',
  'Verification',
  'Detail in',
];
const EARLIER_HEADER = ['Kind', 'Face', 'Account', 'What ran', 'Counts', 'Where it is written'];

/**
 * The rows *Proven before this record* held when it was written, 2026-09-24.
 * The table may lose rows and never gain one: a proof after that day is
 * recorded to 0141 T1's standard, in the first table.
 */
const BEFORE_THE_RECORD = new Set([
  'imap email',
  'gmail email',
  'google-calendar calendar',
  'google-contacts contact',
  'google-drive file',
  'google calendar',
  'google contact',
  'google file',
]);

/** The body of a `## ` section, up to the next `## `, or '' when there is none. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The body of a `### ` subsection within a section. */
function subsection(text: string, heading: string): string {
  const start = text.indexOf(`\n### ${heading}\n`);
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  const next = rest.search(/\n##+ /);
  return next < 0 ? rest : rest.slice(0, next);
}

function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

/** The first table in a block: its header cells, and its body rows' cells. */
function table(block: string): { header: string[]; rows: string[][] } {
  const lines = block.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return { header: [], rows: [] };
  return { header: cellsOf(lines[0]!), rows: lines.slice(2).map(cellsOf) };
}

/** `imap` → imap; a cell with no backticked word → ''. */
const ticked = (cell: string): string => /^`([^`]+)`$/.exec(cell.trim())?.[1] ?? '';

/**
 * What is wrong with one row of *Recorded proofs*: an empty list when nothing.
 * Its own function so the cases below can show it failing on rows the real
 * table does not hold yet.
 */
function problemsWithRecordedRow(cells: ReadonlyArray<string>): string[] {
  const problems: string[] = [];
  if (cells.length !== RECORDED_HEADER.length) {
    return [`has ${cells.length} cells, not ${RECORDED_HEADER.length}`];
  }
  const field = (name: string): string => cells[RECORDED_HEADER.indexOf(name)]!;
  RECORDED_HEADER.forEach((name, i) => {
    if (!cells[i] || /^[-—–]$/.test(cells[i]!)) problems.push(`${name} is empty`);
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(field('Date'))) problems.push('Date is not YYYY-MM-DD');
  if (!ticked(field('Kind'))) problems.push('Kind is not a backticked kind');
  if (!FACES.includes(field('Face'))) problems.push('Face is not a sync domain');
  if (!ACCOUNT_CLASSES.includes(field('Account'))) problems.push('Account is not one of the classes');
  if (!ticked(field('Target'))) problems.push('Target is not a backticked kind');
  for (const count of ['Found', 'Copied', 'Skipped']) {
    if (!/^\d+$/.test(field(count))) problems.push(`${count} is not a number`);
  }
  if (field('Second pass created') !== '0') problems.push('the second pass created something');
  if (/^(none|n\/a|not run)$/i.test(field('Verification'))) problems.push('no verification');
  if (!/\b0\d{3}\b/.test(field('Detail in'))) problems.push('Detail in names no workplan');
  const all = cells.join(' ');
  if (all.includes('@')) problems.push('carries an address');
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(all)) {
    problems.push('carries a tenant id');
  }
  return problems;
}

const LIVE = section(MATRIX, 'Live proofs');
const RECORDED = table(subsection(LIVE, 'Recorded proofs'));
const EARLIER = table(subsection(LIVE, 'Proven before this record'));

/** A row of either table, as the verdicts look it up. */
interface ProofRow {
  readonly table: 'recorded' | 'earlier';
  readonly kind: string;
  readonly face: string;
  readonly date?: string;
}
const ROWS: ProofRow[] = [
  ...RECORDED.rows.map((c) => ({ table: 'recorded' as const, date: c[0], kind: ticked(c[1] ?? ''), face: c[2] ?? '' })),
  ...EARLIER.rows.map((c) => ({ table: 'earlier' as const, kind: ticked(c[0] ?? ''), face: c[1] ?? '' })),
];

/** Every verdict, with the kind and (for an account) the face a row must carry. */
function everyVerdict(): Array<{ kind: string; face?: string; proof: SourceProof }> {
  const out: Array<{ kind: string; face?: string; proof: SourceProof }> = [];
  for (const [kind, proof] of Object.entries(SOURCE_PROOFS.kinds)) out.push({ kind, proof });
  for (const [kind, faces] of Object.entries(SOURCE_PROOFS.faces)) {
    for (const [face, proof] of Object.entries(faces)) if (proof) out.push({ kind, face, proof });
  }
  out.push({ kind: WHOLE_DOMAIN_PROOF_KIND, proof: SOURCE_PROOFS.wholeDomain });
  return out;
}

describe('the matrix has a Live proofs section, in two tables', () => {
  it('Recorded proofs, with 0141 T1’s fields', () => {
    expect(LIVE, 'docs/feature-matrix.md has no "## Live proofs" section').not.toBe('');
    expect(RECORDED.header).toEqual(RECORDED_HEADER);
  });

  it('Proven before this record', () => {
    expect(EARLIER.header).toEqual(EARLIER_HEADER);
  });
});

describe('a recorded proof is a full account of one run', () => {
  it('every row of Recorded proofs has every field, numbers, a second pass of 0 and a verification', () => {
    for (const cells of RECORDED.rows) {
      expect(problemsWithRecordedRow(cells), cells.join(' | ')).toEqual([]);
    }
  });

  // The table is empty on the day it is written, so the check above cannot yet
  // fail on a real row. These show it failing on the rows it exists to refuse.
  const good = [
    '2026-10-01', '`dropbox`', 'file', 'managed, ownpace-live', 'v0.2.0-alpha.1', "the owner's own",
    '`nextcloud`', '412', '410', '2', '0', 'Verify PASS', '0141 T3',
  ];
  it('a complete row passes', () => {
    expect(problemsWithRecordedRow(good)).toEqual([]);
  });
  it.each([
    ['a count that is not a number', 7, 'many', 'Found is not a number'],
    ['a second pass that created something', 10, '3', 'the second pass created something'],
    ['no verification', 11, 'none', 'no verification'],
    ['an empty field', 3, '', 'Edition and stack is empty'],
    ['an account class that is not one', 5, 'a friend', 'Account is not one of the classes'],
    ['an address', 12, '0141 T3, anna@example.invalid', 'carries an address'],
    ['a tenant id', 4, '11111111-2222-3333-4444-555555555555', 'carries a tenant id'],
    ['no workplan', 12, 'the Status block', 'Detail in names no workplan'],
  ])('%s is refused', (_what, index, value, problem) => {
    const row = [...good];
    row[index] = value;
    expect(problemsWithRecordedRow(row)).toContain(problem);
  });
});

describe('a row proven before this record says what ran and where', () => {
  it('every field is filled, and "Where it is written" names a file that exists', () => {
    expect(EARLIER.rows.length, 'the table is empty: the checks below would pass on nothing').toBeGreaterThan(0);
    for (const cells of EARLIER.rows) {
      expect(cells.length, cells.join(' | ')).toBe(EARLIER_HEADER.length);
      cells.forEach((cell, i) => expect(cell, `${EARLIER_HEADER[i]} is empty in ${cells[0]}`).toBeTruthy());
      expect(ticked(cells[0]!), `${cells[0]} is not a backticked kind`).toBeTruthy();
      expect(FACES, `${cells[0]}: ${cells[1]} is not a face`).toContain(cells[1]);
      expect(ACCOUNT_CLASSES, `${cells[0]} ${cells[1]}: ${cells[2]}`).toContain(cells[2]);
      const paths = [...cells[5]!.matchAll(/`([^`]+\/[^`]+)`/g)].map((m) => m[1]!);
      expect(paths.length, `${cells[0]} ${cells[1]} names no file`).toBeGreaterThan(0);
      for (const path of paths) expect(existsSync(join(REPO_ROOT, path)), `${path} does not exist`).toBe(true);
    }
  });

  it('only shrinks: a proof after 2026-09-24 is recorded to 0141 T1’s standard, above', () => {
    for (const cells of EARLIER.rows) {
      const key = `${ticked(cells[0]!)} ${cells[1]}`;
      expect(BEFORE_THE_RECORD.has(key), `${key} was added to Proven before this record`).toBe(true);
    }
  });
});

describe('the open gaps do not call an unmeasured thing done', () => {
  it('no row carries ✅ beside "unmeasured" or "unproven"', () => {
    const gaps = table(section(MATRIX, 'The open gaps, in one place'));
    expect(gaps.rows.length, 'the open-gaps table was not found').toBeGreaterThan(0);
    const offenders = gaps.rows
      .filter(([, status]) => status?.includes('✅'))
      .filter((cells) => /unmeasured|unproven/i.test(cells.join(' ')))
      .map((cells) => cells[0]);
    expect(offenders).toEqual([]);
  });
});

describe('a verdict says proven only where the record says so', () => {
  it('every proven verdict names a Live proofs row with its kind and face', () => {
    const proven = everyVerdict().filter((v) => v.proof.verdict === 'proven');
    expect(proven.length, 'nothing is proven: the check would pass on nothing').toBeGreaterThan(0);
    for (const { kind, face, proof } of proven) {
      if (proof.verdict !== 'proven') continue;
      const where = face ? `${kind} ${face}` : kind;
      const earlier = proof.recorded === PROVEN_BEFORE_THE_RECORD;
      if (!earlier) {
        expect(proof.recorded, `${where}: "recorded" is neither a date nor the earlier table`).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        );
      }
      const row = ROWS.find(
        (r) =>
          r.table === (earlier ? 'earlier' : 'recorded') &&
          r.kind === kind &&
          (face === undefined || r.face === face) &&
          (earlier || r.date === proof.recorded),
      );
      expect(row, `${where} is proven and no Live proofs row records it (${proof.recorded})`).toBeDefined();
    }
  });

  it('no experimental verdict has a row', () => {
    const experimental = everyVerdict().filter((v) => v.proof.verdict === 'experimental');
    expect(experimental.length).toBeGreaterThan(0);
    for (const { kind, face } of experimental) {
      const row = ROWS.find((r) => r.kind === kind && (face === undefined || r.face === face));
      expect(row, `${face ? `${kind} ${face}` : kind} has a Live proofs row and is still experimental`).toBeUndefined();
    }
  });
});
