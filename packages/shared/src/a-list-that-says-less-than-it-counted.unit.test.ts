// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LIST THAT SAYS LESS THAN IT COUNTED (workplan 0117 T2 slice 8, D10).
 *
 * > ✅ D10 *"(a): a headline count, every row that is NOT verified, the total
 * > stated, and a full export."*
 *
 * The shape is the decision, not a rendering choice, and §7c says what it is
 * protecting against on both sides at once: *"a list of a hundred thousand
 * verified files is unusable"*, and a list silently trimmed to be readable
 * *"tells somebody their library is smaller than it is"*. So the account is
 * complete in the NUMBERS whatever the screen shows, and the screen shows what
 * a person can act on.
 *
 * That balance has two ways to break and this pins both:
 *
 *  - **Counting only what is shown.** Then `total` is the length of a filtered
 *    list, the headline shrinks with the filter, and the document says an
 *    account is smaller than it is — on the page somebody deletes originals
 *    from.
 *  - **Trimming quietly.** A bounded `rows` with no `truncated` reads as the
 *    whole list. This is not the rare case: before any pass has run NOT ONE row
 *    is verified, so the un-confirmed account is the worst case rather than an
 *    edge one.
 *
 * The second half is the EXPORT, and it is a different document on purpose: the
 * screen shows what is actionable, while somebody reconciling against the
 * account they are about to empty needs to search for one file and see the word
 * `verified` beside it. Its escaping is guarded here rather than left to review
 * because a CSV that splits one row in two changes the count somebody is
 * reconciling, and a field a spreadsheet evaluates as a formula is code we
 * handed them.
 */

import { describe, it, expect } from 'vitest';
import {
  confirmedList,
  confirmedListCsv,
  confirmedListOf,
  countsAsVerified,
  type ConfirmedRowView,
  type RowState,
} from './confirmed-list.ts';

const row = (state: RowState, over: Partial<ConfirmedRowView> = {}): ConfirmedRowView => ({
  state,
  claim: state === 'verified' ? 'byte-hash' : 'none',
  domain: 'email',
  collection: 'INBOX',
  naturalKey: `<${state}@example.net>`,
  confirmedAt: '2026-09-11T08:00:00.000Z',
  ...over,
});

/** One of every state, so nothing here passes on a convenient sample. */
const EVERY_STATE: readonly RowState[] = [
  'verified',
  'differs',
  'present',
  'yours',
  'missing',
  'never-placed',
  'removed',
  'unchecked',
];

describe('the total is the account, not the part on screen', () => {
  it('counts every row and shows only the ones that are not verified', () => {
    const rows = EVERY_STATE.map((s) => row(s));
    const list = confirmedList(rows);
    expect(list.total).toBe(EVERY_STATE.length);
    expect(list.verified).toBe(1);
    expect(list.rows.map((r) => r.state).sort()).toEqual(
      EVERY_STATE.filter((s) => s !== 'verified').sort(),
    );
  });

  it('states a total larger than the rows it carries', () => {
    // The sentence a screen has to be able to write: "40 of 100 000". A list
    // whose total equalled its rows could not say it, and the difference is
    // precisely what tells a person the other 99 960 were verified rather than
    // dropped.
    const rows = [...Array(100).keys()].map((i) =>
      row(i === 0 ? 'missing' : 'verified', { naturalKey: `<${i}@example.net>` }),
    );
    const list = confirmedList(rows);
    expect(list.total).toBe(100);
    expect(list.rows).toHaveLength(1);
  });

  it('keeps counting past the limit — the bound trims the screen, never the account', () => {
    const rows = [...Array(50).keys()].map((i) => row('missing', { naturalKey: `<${i}@x>` }));
    const list = confirmedList(rows, { limit: 10 });
    expect(list.rows).toHaveLength(10);
    expect(list.total).toBe(50);
    expect(list.truncated).toBe(true);
  });

  it('says nothing about truncation when nothing was trimmed', () => {
    // The flag has to mean something. One that is always present is one a
    // screen renders always, and a permanent "there may be more" is noise
    // people learn to ignore before the day it is true.
    const list = confirmedList([row('missing'), row('verified')], { limit: 10 });
    expect(list.truncated).toBeUndefined();
  });

  it('counts a verified row toward the headline and NEVER toward the working list', () => {
    // `yours` and `present` are genuinely on the target and deliberately are
    // not verified — the headline says *verified*, and neither was. They
    // therefore belong on the screen, where somebody can look at them.
    const list = confirmedList([row('yours'), row('present'), row('verified')]);
    expect(list.verified).toBe(1);
    expect(list.rows.map((r) => r.state).sort()).toEqual(['present', 'yours']);
  });

  it('asks `countsAsVerified`, so the headline is decided in one place', () => {
    // Not a tautology check: the point is that the shaper does not carry its
    // own copy of the rule. If a second definition ever appears, these two
    // disagree on whichever state moved.
    for (const state of EVERY_STATE) {
      const list = confirmedList([row(state)]);
      expect(list.verified, state).toBe(countsAsVerified(row(state)) ? 1 : 0);
      expect(list.rows.length, state).toBe(countsAsVerified(row(state)) ? 0 : 1);
    }
  });

  it('shapes the same list row by row as it does from an array', () => {
    // The accumulator is what the paged read actually uses — D7(a) authorised
    // confirming every item of a family file account, so the rows arrive five
    // hundred at a time. Two shapers that disagreed would mean the managed
    // list and the appliance's counted somebody's data differently.
    const rows = EVERY_STATE.map((s) => row(s));
    const acc = confirmedListOf<ConfirmedRowView>({ limit: 3 });
    for (const r of rows) acc.add(r);
    expect(acc.result()).toEqual(confirmedList(rows, { limit: 3 }));
  });
});

describe('the export is the whole account', () => {
  // `\uFEFF` as an escape, for the reason the renderer uses one: an invisible
  // U+FEFF in source is removed by a formatter or a careless paste without
  // anybody seeing it go — and here that would silently stop checking the BOM.
  const lines = (csv: string) => csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');

  it('carries every row, verified ones included', () => {
    // THE difference from the screen, and the reason D10 asked for both. A
    // person reconciling against the account they are about to empty has to be
    // able to find one file and see `verified` next to it.
    const csv = confirmedListCsv(EVERY_STATE.map((s) => row(s)));
    expect(lines(csv)).toHaveLength(EVERY_STATE.length + 1);
    expect(csv).toContain('verified');
  });

  it('names its columns once, from the same renderer that fills them', () => {
    expect(lines(confirmedListCsv([]))).toEqual([
      'domain,collection,item,state,claim,checked_at',
    ]);
  });

  it('writes an empty checked_at rather than the word null', () => {
    // `null` in a spreadsheet cell is a value somebody reads as data. The
    // honest rendering of "never asked" is an empty cell.
    const csv = confirmedListCsv([row('unchecked', { confirmedAt: null })]);
    expect(lines(csv)[1]!.endsWith(',')).toBe(true);
    expect(csv).not.toContain('null');
  });

  it('keeps a subject with a comma, a quote or a newline on ONE row', () => {
    // Ordinary mail. A file that split one of these across two lines would
    // change the count somebody is reconciling against their old account.
    const csv = confirmedListCsv([
      row('missing', { naturalKey: 'Re: budget, final' }),
      row('missing', { naturalKey: 'He said "no"' }),
      row('missing', { naturalKey: 'line one\nline two' }),
    ]);
    expect(lines(csv)).toHaveLength(4);
    expect(csv).toContain('"Re: budget, final"');
    expect(csv).toContain('"He said ""no"""');
    expect(csv).toContain('"line one\nline two"');
  });

  it('de-fangs a field a spreadsheet would run as code', () => {
    // Subjects and file names are written by whoever sent them. `=cmd|…` and
    // `=HYPERLINK(…)` in a cell are executed on open, so a leading `=`, `+`,
    // `-` or `@` gets an apostrophe. It is VISIBLE in the cell, and that is
    // the trade taken on purpose: an apostrophe in front of a handful of
    // `-----Original Message-----` subjects is cheaper than handing somebody a
    // document that runs code.
    for (const dangerous of ['=1+1', '+1', '-----Original Message-----', '@SUM(A1)']) {
      const csv = confirmedListCsv([row('missing', { naturalKey: dangerous })]);
      expect(lines(csv)[1], dangerous).toContain(`'${dangerous}`);
    }
    // And an ordinary subject is left exactly as it was.
    expect(confirmedListCsv([row('missing', { naturalKey: 'Invoice 42' })])).toContain(
      'Invoice 42',
    );
  });

  it('starts with a BOM and separates rows with CRLF', () => {
    // Without the BOM, Excel reads the file in the local codepage and every
    // `ë`, `ï` and `é` arrives as mojibake — which in a Dutch product is most
    // names rather than an edge case.
    const csv = confirmedListCsv([row('missing', { collection: 'Verzonden' })]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
