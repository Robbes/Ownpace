// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `FileItem.contentHash` WAS DECLARED SHA-256 AND HOLDS FOUR OTHER ALGORITHMS
 * (found 2026-09-09).
 *
 * The field's own line in `packages/shared/src/file.ts` read:
 *
 *     /** Content hash (SHA-256) - empty for directories. *\/
 *
 * Five sources populate it, and four of them publish something that is not a
 * SHA-256: Google's MD5, Box's SHA-1, Dropbox's block hash, and — on Graph —
 * quickXorHash or, when there is no hash at all, the item's `cTag`, which is a
 * change token. Meanwhile `item.content_hash` in the LEDGER is always our own
 * SHA-256 of the bytes we fetched, because every sync path injects its own
 * hashing function into `runDomainSync`.
 *
 * Nothing was broken. Nothing read the field except `archive-file-source`,
 * whose value is its own. **The defect was the declaration**, and the damage it
 * can do is one line somebody writes in perfectly good faith:
 *
 *     if (item.contentHash === ledgerRow.contentHash) skip
 *
 * That reads as obviously correct, compiles, passes review, and is a silent,
 * permanent false negative for every Drive, Box, Dropbox and OneDrive file —
 * because it compares MD5 to SHA-256. It nearly reached a workplan on the day
 * this was written, twice, on the strength of the old comment.
 *
 * Two connector comments went the same way and are corrected with it:
 * `graph-drive-source.ts` said the value was "for change detection", and
 * `google-drive-source.ts` justified excluding Google-native files with *"with
 * no checksum there is nothing to compare and every pass would look like a
 * change"*. Change detection is `sourceVersion`. The exclusion is right for the
 * reason 0116 gives — a native file has no stored bytes at all, only an export
 * — and a wrong reason in a comment is what the next person acts on.
 *
 * WHAT THIS PINS, and why each part earns its place:
 *
 *  - **Change detection stays on `sourceVersion`.** This is the rule the old
 *    comment invited someone to break, and breaking it is invisible: the
 *    migration keeps working, it just stops noticing changes on four sources.
 *  - **Every writer of the field is declared with its algorithm.** A sixth
 *    source has to say which one it publishes, here, rather than inheriting a
 *    sentence that was wrong for four of the first five.
 *  - **The declaration may not claim one algorithm again**, in the exact words
 *    that caused this or any equivalent.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Whole-line comments removed, so prose about the code is not read as code. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const FILE_ITEM = 'packages/shared/src/file.ts';
const DOMAIN_SYNC = 'packages/core/src/domain-sync.ts';

/**
 * Every connector that puts a value in `FileItem.contentHash`, and what that
 * value actually is. The point of the map is the SECOND column: adding a
 * source is fine, adding one without saying what it publishes is not.
 */
const WRITERS: ReadonlyMap<string, string> = new Map([
  ['packages/connectors/src/google-drive-source.ts', "Google's MD5 (file.md5Checksum)"],
  ['packages/connectors/src/box-file-source.ts', "Box's SHA-1 (file.sha1)"],
  ['packages/connectors/src/dropbox-file-source.ts', "Dropbox's content_hash — blockwise, not a plain SHA-256"],
  ['packages/connectors/src/graph-drive-source.ts', 'quickXorHash, or a cTag when Graph publishes no hash'],
  ['packages/connectors/src/archive-file-source.ts', 'our own SHA-256, used as an item identity'],
]);

/** Files that set `contentHash:` on something, found rather than listed. */
function connectorsWritingAContentHash(): string[] {
  const dir = 'packages/connectors/src';
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.ts') && !/\.(unit|integration|e2e|ui)\.test\.ts$/.test(f))
    .map((f) => `${dir}/${f}`)
    .filter((rel) => /contentHash:\s*[^,\n]/.test(code(rel)));
}

describe('the field says what it holds', () => {
  it('no longer claims to be SHA-256', () => {
    const declaration = /readonly contentHash\?: string;/.exec(read(FILE_ITEM));
    expect(declaration, 'FileItem.contentHash moved or was renamed').not.toBeNull();
    const doc = read(FILE_ITEM).slice(0, declaration!.index);
    const lastComment = doc.lastIndexOf('/**');
    expect(lastComment, 'the field lost its documentation').toBeGreaterThan(0);
    // The SUMMARY line — everything up to the first blank line of the block —
    // is what a reader takes the field to be, and is where the old claim sat.
    const summary = doc.slice(lastComment).split('\n *\n')[0]!;
    expect(summary).toMatch(/source's own algorithm/);
    expect(summary).toMatch(/NOT SHA-256/);

    // NOT a test that the old wording is absent. The block quotes it, to say
    // what it used to claim, and a guard that forbade the string would go red
    // against the very sentence that fixed the defect. That mistake has now
    // been made four times in this repository in one day — see the note at the
    // top of `a-month-that-moved-with-the-servers-timezone.unit.test.ts`. The
    // teeth here are the sweep and the change-detection rule below, neither of
    // which can collide with prose.
  });

  it('names every source that fills it, and what each one publishes', () => {
    const found = connectorsWritingAContentHash();
    // Not vacuous: the sweep must find the sources this was written about.
    expect(found.length).toBeGreaterThanOrEqual(5);
    const undeclared = found.filter((f) => !WRITERS.has(f));
    expect(
      undeclared,
      'A source that fills FileItem.contentHash must say which algorithm it publishes — ' +
        'add it to WRITERS here and to the field\'s own documentation.',
    ).toEqual([]);
    // And no entry outlives the file it describes.
    expect([...WRITERS.keys()].filter((f) => !found.includes(f))).toEqual([]);
  });

  it('the declaration names them too, so the type is readable on its own', () => {
    const doc = read(FILE_ITEM);
    for (const rel of WRITERS.keys()) {
      const base = rel.split('/').pop()!;
      // The table ROW, not the substring. `toContain('box-file-source.ts')` is
      // satisfied by the `dropbox-file-source.ts` line one row below, so
      // deleting Box's row left this green — found by mutating it, which is
      // the second time a substring assertion has passed on a name that
      // appears inside another name in this repository.
      const row = new RegExp(`^\\s*\\*\\s+${base.replace('.', '\\.')}\\s+\\S`, 'm');
      expect(row.test(doc), `${base} has no row where the field is declared`).toBe(true);
    }
  });
});

describe('and nothing decides a change by comparing one', () => {
  it('classifyKnownItem decides on the collection and sourceVersion, never a hash', () => {
    const body = /function classifyKnownItem\([^]*?\n\}/.exec(code(DOMAIN_SYNC));
    expect(body, 'classifyKnownItem moved or was renamed').not.toBeNull();
    // The rule, positively: the version is what it returns 'skip' on.
    expect(body![0]).toMatch(/sourceVersion/);
    // The rule, negatively: this is the line the old declaration invited, and
    // it would be a silent false negative on four of the five sources.
    expect(
      body![0],
      'A content hash reached change detection. The values are per-provider ' +
        'algorithms (see FileItem.contentHash) and are not comparable.',
    ).not.toMatch(/[Cc]ontentHash/);
  });

  it('the two comments that named the wrong mechanism stay corrected', () => {
    const graph = read('packages/connectors/src/graph-drive-source.ts');
    expect(graph).not.toMatch(/quickXorHash as content hash for change detection/);
    const drive = read('packages/connectors/src/google-drive-source.ts');
    expect(drive).not.toMatch(/every pass would look like a change/);
    // And the real reason survives where the wrong one was.
    expect(drive).toMatch(/only an export in some other format/);
  });
});
