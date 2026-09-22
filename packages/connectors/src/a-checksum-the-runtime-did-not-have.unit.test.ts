// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CHECKSUM THE RUNTIME DID NOT HAVE.
 *
 * `deploy-tasks.sh`, on a stack that was working, refused THIRTEEN job files:
 *
 *     x The requested module 'node:zlib' does not provide an export named
 *       'crc32' in src/jobs/run-delta-sync.ts
 *     …and twelve more
 *
 * `zip-archive.ts` imported `crc32` from `node:zlib`. That export is recent;
 * this repository's `package.json` asks for Node 24 and gets it on the
 * developer's machine, but the task images are built by a CLI this repository
 * does not pin, on a runtime it does not choose. The import resolved locally
 * and failed there.
 *
 * WHY IT WAITED TO BITE. Every task imports `@openmig/connectors`, and the
 * archive reader comes with it — so the break was present from the moment that
 * import landed, and invisible until somebody ran the deploy. That is the
 * third line of the update procedure, the one `managed-bring-up.md` says
 * "gets skipped, and skipping it is invisible". It was skipped, so this was.
 *
 * THE FIX IS TO STOP ASKING THE PLATFORM. CRC-32 is a fixed reflected
 * polynomial and a fixed convention, unchanged in zip since 1989, and it is a
 * table and a loop. A checksum is the last place to want a version floor.
 *
 * SO THE RULE IS EQUIVALENCE, NOT PLAUSIBILITY. A hand-written CRC that is
 * subtly wrong is worse than none: it would pass its own fixtures and then
 * reject every member of a real archive as corrupt, which reads as a damaged
 * export rather than as our arithmetic. These cases check it against
 * `node:zlib`'s OWN answer wherever the running Node has one — random inputs,
 * chunked continuation, the edges — so the claim is measured against the
 * implementation it replaces rather than against a spec somebody read.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';
import { crc32 } from './crc32.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Tests may take `crc32` from the platform; production code may not.
 *
 * That is the real boundary rather than a list of today's three files. A test
 * BUILDS fixtures and runs on whatever Node CI has, which has the export. A
 * job runs in a task image built by a CLI this repository does not pin, on a
 * runtime it does not choose — and that is where the deploy died.
 *
 * Derived, so the next test that needs a zip fixture is not a maintenance
 * task, and the next SOURCE file that reaches for the platform still is.
 */
const isTest = (file: string): boolean => /\.(unit|integration|e2e)\.test\.tsx?$/.test(file);

/** `zlib.crc32` where this Node has it — the thing being matched. */
const native = (zlib as unknown as { crc32?: (d: Uint8Array, v?: number) => number }).crc32;

describe('a checksum the runtime did not have', () => {
  it('matches the published vectors', () => {
    // True whatever Node is running, so the suite still means something on a
    // runtime with no `zlib.crc32` to compare against — which is the whole
    // situation this exists for.
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32('123456789')).toBe(0xcbf43926);
    expect(crc32('a')).toBe(0xe8b7be43);
  });

  it('continues from a running value, as a streamed member does', () => {
    // The archive reader hashes a member chunk by chunk and carries the value
    // between them. If continuation were wrong, only files larger than one
    // chunk would fail — which is the worst possible failure distribution.
    const whole = 'the quick brown fox jumps over the lazy dog';
    const split = crc32(whole.slice(0, 17), crc32(whole.slice(0, 0)));
    expect(crc32(whole)).toBe(crc32(whole.slice(17), split));
  });

  it.skipIf(!native)('agrees with node:zlib on random bytes', () => {
    // The equivalence, measured. Sizes spanning the single-byte case, the
    // table-wrap cases and a few kilobytes.
    for (const size of [1, 2, 3, 255, 256, 257, 1024, 4096]) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) bytes[i] = (i * 2654435761) & 0xff;
      expect(crc32(bytes), `size ${size}`).toBe(native!(bytes));
    }
  });

  it.skipIf(!native)('agrees with node:zlib when continued in chunks', () => {
    const bytes = new Uint8Array(3000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 40503) & 0xff;
    let mine = 0;
    let theirs = 0;
    for (let at = 0; at < bytes.length; at += 512) {
      const chunk = bytes.subarray(at, at + 512);
      mine = crc32(chunk, mine);
      theirs = native!(chunk, theirs);
      expect(mine, `after ${at + chunk.length} bytes`).toBe(theirs);
    }
    expect(mine).toBe(native!(bytes));
  });

  it('answers an unsigned 32-bit number, never a negative one', () => {
    // The reader compares this against the central directory's recorded value,
    // which is unsigned. A sign-extended result would fail every high-bit
    // checksum and report a sound archive as corrupt.
    const high = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    expect(crc32(high)).toBeGreaterThanOrEqual(0);
    expect(crc32(high)).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(crc32(high))).toBe(true);
  });

  it('is the only way this repository gets a CRC-32', () => {
    // THE RULE, not the incident. The deploy did not break because one file
    // was wrong; it broke because nothing stopped a file reaching for a
    // platform export the task runtime might not carry. A guard naming
    // `zip-archive.ts` would pass the moment the next file did the same.
    let found = '';
    try {
      found = execFileSync('git', ['grep', '-n', '-E', "crc32[^:]*from 'node:zlib'"], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
    } catch (e) {
      // `git grep` exits 1 for "no matches", which is the passing case.
      if ((e as { status?: number }).status !== 1) throw e;
    }
    const offenders = found
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(':')[0]!)
      .filter((file) => !isTest(file));
    expect(
      [...new Set(offenders)],
      'These take crc32 from node:zlib. A task bundle may run on a Node that ' +
        "has no such export — that is thirteen refused job files and a deploy " +
        'that aborts. Import it from `connectors/crc32.ts` instead.',
    ).toEqual([]);
  });
});