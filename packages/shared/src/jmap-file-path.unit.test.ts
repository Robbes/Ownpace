// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The JMAP path reconstruction (workplan 0031 T3).
 *
 * The assertion that matters is not "it builds a path". It is that the path it
 * builds **hashes identically to the one the WebDAV source produces for the
 * same file** — because the natural key is what makes a mapping switchable
 * between transports without re-copying, and a difference here is silent: every
 * write succeeds, no count is wrong, and the customer's storage doubles.
 *
 * So `fileNaturalKeyHash` appears in these tests rather than string equality
 * alone. Comparing the strings would pass a reconstruction that agreed by
 * accident under a hash that did something else.
 */

import { describe, it, expect } from 'vitest';
import { reconstructFileNodePath, fileNodeIndex, type FileNodeRef } from './jmap-file-path';
import { fileNaturalKeyHash } from './hash';

/** The tree the spike would have found: root folder, subfolder, file. */
const TREE: FileNodeRef[] = [
  { id: 'root', name: 'Documents', parentId: null },
  { id: 'sub', name: 'Q3 reports', parentId: 'root' },
  { id: 'file', name: 'Meeting notes.txt', parentId: 'sub' },
];

const index = () => fileNodeIndex(TREE);

function pathOf(id: string, nodes = index()): string {
  const result = reconstructFileNodePath(id, nodes);
  if (!result.ok) throw new Error(`expected a path, got: ${result.reason}`);
  return result.path;
}

describe('agreeing with the path WebDAV produces', () => {
  it('hashes identically to the WebDAV path for the same file', () => {
    // What `webdav-source.ts`'s `toRelativePath` returns for this file: the
    // configured base stripped, percent-DECODED, no leading or trailing slash.
    const webdavPath = 'Documents/Q3 reports/Meeting notes.txt';

    // THE assertion. Not `toEqual` on the strings — through the same hash the
    // ledger keys on, because that is the thing that has to agree.
    expect(fileNaturalKeyHash(pathOf('file'))).toBe(fileNaturalKeyHash(webdavPath));
  });

  it('keeps the space DECODED, matching decodeURIComponent on the WebDAV side', () => {
    // The single easiest way to get this wrong is to encode on the way out —
    // `Meeting%20notes.txt` is a perfectly reasonable-looking path and hashes
    // to something WebDAV will never produce.
    expect(pathOf('file')).toContain('Meeting notes.txt');
    expect(pathOf('file')).not.toContain('%20');
  });

  it('emits no leading and no trailing slash', () => {
    expect(pathOf('root')).toBe('Documents');
    expect(pathOf('file').startsWith('/')).toBe(false);
    expect(pathOf('file').endsWith('/')).toBe(false);
  });

  it('does not case-fold, because the WebDAV path does not either', () => {
    // `fileNaturalKeyHash`'s doc comment used to claim it normalises for
    // case-insensitive filesystems. It does not — it hashes the string it is
    // given. Folding here would key `Documents` and `documents` together on
    // one transport and not the other, which is a difference invented by this
    // file rather than found.
    const mixed = fileNodeIndex([
      { id: 'root', name: 'DOCUMENTS', parentId: null },
      { id: 'file', name: 'a.txt', parentId: 'root' },
    ]);
    expect(pathOf('file', mixed)).toBe('DOCUMENTS/a.txt');
    expect(fileNaturalKeyHash(pathOf('file', mixed))).not.toBe(
      fileNaturalKeyHash('documents/a.txt'),
    );
  });

  it('does not Unicode-normalise, and the test says why rather than asserting a rule', () => {
    // NFC 'é' (U+00E9) and NFD 'é' (U+0065 U+0301) look identical and are
    // different strings. Neither `toRelativePath` nor `fileNaturalKeyHash`
    // normalises, so normalising HERE would not make the two transports agree
    // — it would only move which one is wrong. Pinned so a future "helpful"
    // normalisation is a failing test rather than a silent re-copy of every
    // accented filename.
    // Written as explicit escapes, NOT literal accented characters. Typing
    // both as 'café.txt' leaves the normal form to whatever the editor emitted;
    // if it produced the same codepoints for each, this would compare a string
    // with itself and pass however the code behaved. The vacuous shape, in the
    // very test written to guard against silent key drift.
    const nfc = fileNodeIndex([{ id: 'f', name: 'caf\u00e9.txt', parentId: null }]);
    const nfd = fileNodeIndex([{ id: 'f', name: 'cafe\u0301.txt', parentId: null }]);
    // The two really are different strings — asserted, not assumed.
    expect(pathOf('f', nfc)).not.toBe(pathOf('f', nfd));
    expect(fileNaturalKeyHash(pathOf('f', nfc))).not.toBe(fileNaturalKeyHash(pathOf('f', nfd)));
  });
});

describe('refusing rather than guessing', () => {
  it('refuses a broken chain instead of returning a suffix', () => {
    // A missing ancestor yields `Q3 reports/Meeting notes.txt` if you let it —
    // well-formed, plausible, and hashing to something WebDAV never produces.
    // That file would re-copy on every pass, forever, with every write
    // succeeding.
    const orphaned = fileNodeIndex(TREE.filter((n) => n.id !== 'root'));
    const result = reconstructFileNodePath('file', orphaned);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('broken');
    expect(result.reason).toContain('suffix');
  });

  it('refuses a cycle instead of looping forever', () => {
    // Impossible in a well-formed tree and therefore exactly the thing that
    // happens — a rename race, a node reparented under its own descendant.
    // Without the guard the pass hangs, which is worse than failing.
    const cyclic = fileNodeIndex([
      { id: 'a', name: 'a', parentId: 'b' },
      { id: 'b', name: 'b', parentId: 'a' },
    ]);
    const result = reconstructFileNodePath('a', cyclic);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('cycle');
  });

  it('refuses a name containing a slash, because no agreeing key exists', () => {
    // `a/b` as one segment and `a`,`b` as two produce the same string and are
    // different files. WebDAV cannot express the first at all — the separator
    // is structural in a URL — so there is nothing to agree with.
    const slashed = fileNodeIndex([{ id: 'f', name: 'not/a/folder', parentId: null }]);
    const result = reconstructFileNodePath('f', slashed);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('ambiguous');
  });

  it('refuses an empty name', () => {
    const empty = fileNodeIndex([{ id: 'f', name: '', parentId: null }]);
    const result = reconstructFileNodePath('f', empty);
    expect(result.ok).toBe(false);
  });

  it('refuses an absurdly deep chain rather than building an unusable path', () => {
    const deep: FileNodeRef[] = [{ id: 'n0', name: 'n0', parentId: null }];
    for (let i = 1; i <= 300; i++) deep.push({ id: `n${i}`, name: `n${i}`, parentId: `n${i - 1}` });
    const result = reconstructFileNodePath('n300', fileNodeIndex(deep));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('deeper than');
  });
});
