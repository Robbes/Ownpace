// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The same UTF-8 round trip, sitting in a second connector for three weeks.
 *
 * A file body read as TEXT and re-encoded is destroyed:
 *
 *     const encoder = new TextEncoder();
 *     return encoder.encode(response.body);   // response.body = await res.text()
 *
 * The decode is where the loss happens. Every byte sequence that is not valid
 * UTF-8 becomes U+FFFD, three bytes wide, and re-encoding cannot recover what
 * the decoder already threw away. Measured on the DAV path when it was found
 * there: a 476 KB JPEG in, 863 KB out, not one byte of it original.
 *
 * IT WAS FIXED ON DAV AND LEFT STANDING ON GRAPH. `WebdavFileSource` got
 * `bodyBytes` and a long comment about why; `GraphDriveSource.fetchFileContent`
 * kept the round trip until 2026-09-08, so every JPEG, PDF, MP4 and Office
 * document copied out of OneDrive in between was corrupt on arrival.
 *
 * ## Why nothing noticed, twice
 *
 * The ledger's `content_hash` is computed from whatever bytes the source
 * returned. Corrupt them at the read and the record agrees with the copy: the
 * hashes match, count parity is perfect, the verification gate passes, and the
 * only thing in the world able to see the damage is a person opening the file
 * at the far end.
 *
 * A per-connector test cannot catch this, because the connector that has the
 * defect is by definition the one nobody is looking at — and its own double
 * hands back a string, which has no bytes for a decode to lose. So this is
 * repo-wide and reads the SOURCE: whatever a connector's fixtures say, none of
 * them may turn a decoded body into file content.
 *
 * ## What it holds
 *
 *  1. no file source encodes a decoded response body into content;
 *  2. every HTTP file source reads bytes by a route that has bytes to read —
 *     `arrayBuffer()`, or the DAV client's `bodyBytes`;
 *  3. the list of file sources is DERIVED, so a sixth connector is covered on
 *     the day it is written rather than the day somebody remembers this file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONNECTORS = join(REPO_ROOT, 'packages/connectors/src');

/** Every module that implements `FileSource`, found rather than listed. */
function fileSources(): ReadonlyArray<{ name: string; text: string }> {
  return readdirSync(CONNECTORS)
    .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
    .map((name) => ({ name, text: readFileSync(join(CONNECTORS, name), 'utf8') }))
    .filter((module) => /implements\s+FileSource\b/.test(module.text));
}

/**
 * An encode of something that came off a response.
 *
 * Narrow on purpose: `new TextEncoder().encode(JSON.stringify(...))` is how
 * the archive source writes its own manifest, and that is not a file body. The
 * defect has a shape — encoding a `.body`, a `.text()`, or a variable that
 * plainly holds one.
 */
const DECODED_BODY_ENCODE =
  /(?:new\s+TextEncoder\(\)|encoder)\s*\.encode\(\s*(?:await\s+)?[A-Za-z_$][\w$]*(?:\.body\b|\.text\(\))/;

describe('no connector turns a decoded body back into file content', () => {
  const sources = fileSources();

  it('finds the file sources rather than trusting a hand-kept list', () => {
    // If this drops below the five that exist, the sweep below is passing
    // because it looked at nothing — the failure mode of every derived list.
    expect(sources.map((s) => s.name).sort()).toEqual(
      [
        'archive-file-source.ts',
        'box-file-source.ts',
        'dropbox-file-source.ts',
        'google-drive-source.ts',
        'graph-drive-source.ts',
        'webdav-source.ts',
      ].sort(),
    );
  });

  for (const source of sources) {
    it(`${source.name} does not encode a decoded body`, () => {
      const offending = source.text
        .split('\n')
        .map((line, index) => ({ line: line.trim(), at: index + 1 }))
        // A COMMENT ABOUT THE DEFECT IS NOT THE DEFECT. Both connectors that
        // had it now carry the old expression verbatim in a comment saying why
        // it was wrong — which is exactly the documentation this repository
        // wants, and a guard that punished it would have them deleted.
        .filter(({ line }) => !/^(\/\/|\*|\/\*)/.test(line))
        .filter(({ line }) => DECODED_BODY_ENCODE.test(line));

      expect(
        offending,
        `${source.name} builds bytes by encoding something already decoded:\n` +
          offending.map(({ at, line }) => `  line ${at}: ${line}`).join('\n') +
          '\n\nA UTF-8 decode is lossy for every file that is not valid UTF-8, and the loss\n' +
          'happens at the decode — re-encoding recovers nothing. Read the bytes instead:\n' +
          '`new Uint8Array(await response.arrayBuffer())`, or the DAV client\'s `bodyBytes`.\n' +
          'Nothing downstream can catch this: the ledger hash is taken from whatever the\n' +
          'source returned, so a corrupted copy agrees with its own record.',
      ).toEqual([]);
    });
  }
});

describe('every file source over HTTP reads bytes by a route that has bytes', () => {
  // The archive source reads a local archive, not a response, so it has no
  // HTTP body to get wrong. Named here rather than filtered silently, because
  // "it was skipped" and "it passed" must not look the same.
  const NOT_OVER_HTTP = ['archive-file-source.ts'];

  for (const source of fileSources().filter((s) => !NOT_OVER_HTTP.includes(s.name))) {
    it(`${source.name} reaches for arrayBuffer() or bodyBytes`, () => {
      expect(
        /\.arrayBuffer\(\)|\bbodyBytes\b/.test(source.text),
        `${source.name} downloads files but never reads a byte route. Whatever it is\n` +
          'returning as content came through a string, and every file that was not plain\n' +
          'text is already corrupt by the time it gets there.',
      ).toBe(true);
    });
  }
});
