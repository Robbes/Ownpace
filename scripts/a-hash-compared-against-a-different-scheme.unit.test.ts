// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TWO HASHES MADE DIFFERENT WAYS, COMPARED AS IF THEY WERE THE SAME KIND OF
 * THING (ADR-0046 rule (d), workplan 0042 T7 (d)).
 *
 * A content hash in this ledger carries the scheme that made it, on its front:
 * `cal1:` and `card1:` for the canonical DAV fingerprints, `zip1:` for a
 * rendering compared by its container's parts, and nothing at all for a plain
 * sha256 over whole bytes. The tag is the whole record of the scheme — there is
 * no column beside it — which is what makes the rule cheap and what makes
 * forgetting it silent.
 *
 * ## What forgetting it costs
 *
 * A row written by an older build against a value computed now says NOTHING
 * about the data. Read as a disagreement, it becomes:
 *
 *   - **`differs` on the confirmed list** — the page somebody deletes their
 *     originals from, reporting every already-migrated document as changed the
 *     first time a new scheme lands. Corruption manufactured out of an upgrade.
 *   - **a mismatch in §20's report** — the cutover gate, failed on an upgrade.
 *   - **"probably edited after it was moved"** on the relocation gate — a
 *     specific claim about what the customer did, made from no evidence.
 *
 * The ADR calls this "the disease arriving through the cure": adopting a better
 * hash would re-label every already-migrated native file, and the re-labelling
 * would be read as change.
 *
 * ## Why this is a guard and not just a fix
 *
 * `verification.ts` has held the rule since the DAV fingerprints were
 * versioned. `confirmation-pass.ts` did not, and `apply-deletion.ts` said the
 * wrong sentence — not because anyone disagreed, but because the rule lived
 * inside one file as a local helper and the next comparison site was written
 * without meeting it. Three sites, one rule, and nothing joining them.
 *
 * So this file is the join. It names every place that compares two stored
 * content hashes and asserts each one reaches the single shared answer. A new
 * comparison site is a line somebody has to add here, and adding it is where
 * they find out the rule exists.
 *
 * It is deliberately a SOURCE read for the joining half and a behavioural read
 * for the rule itself. The behaviour of `sameFingerprintVersion` is directly
 * testable and is tested here; whether a given file asks it at all is not
 * observable from outside that file, because the answer only shows up on inputs
 * that do not exist in the tree yet — no `zip1:` row is written by anything
 * today. That is the point: the rule has to be in place BEFORE the first one
 * is, or the pass that writes it is the pass that reports every document
 * changed.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CALENDAR_FINGERPRINT_VERSION,
  CONTACT_FINGERPRINT_VERSION,
  CONTAINER_FINGERPRINT_VERSION,
  sameFingerprintVersion,
  versionOf,
} from '@openmig/shared';

const ROOT = join(import.meta.dirname, '..');

/**
 * Every file that compares two stored content hashes, and what it decides.
 *
 * The consequence column is not decoration: it is the reason each line is here,
 * and it is what a reader needs in order to judge whether a new site belongs on
 * this list. If a file compares two hash STRINGS from the ledger and acts on
 * the answer, it belongs.
 */
const COMPARES_TWO_STORED_HASHES: ReadonlyArray<{
  readonly path: string;
  readonly decides: string;
}> = [
  {
    path: 'packages/core/src/confirmation-pass.ts',
    decides: 'whether a row on the confirmed list reads `verified` or `differs`',
  },
  {
    path: 'packages/core/src/verification.ts',
    decides: "whether a §20 content sample counts as a match, a mismatch or unavailable",
  },
  {
    path: 'packages/core/src/apply-deletion.ts',
    decides: 'what the relocation gate SAYS when it refuses to remove the old copy',
  },
];

/**
 * The one implementation. Everything above must reach this and not re-derive it.
 *
 * It moved out of `dav-canonical.ts` on 2026-09-16, when 0042 T7 (c) gave the
 * rule a fourth caller that could not import a module carrying `node:crypto`.
 * The tags live in a file that imports nothing, which is what the scheme
 * question always was.
 */
const THE_RULE = 'packages/shared/src/fingerprint-scheme.ts';

describe('the rule that two schemes are never compared', () => {
  it('is reached by every file that compares two stored hashes', () => {
    for (const { path, decides } of COMPARES_TWO_STORED_HASHES) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      expect(
        source,
        `${path} decides ${decides} from two content hashes, and never asks whether the same ` +
          'scheme made them. A row written by an older build compared against a value computed ' +
          'now says nothing about the data, and this file would read it as a disagreement. ' +
          'Call sameFingerprintVersion before comparing — ADR-0046 rule (d).',
      ).toMatch(/\bsameFingerprintVersion\b/);
    }
  });

  it('is implemented once, and nowhere else parses the tag itself', () => {
    // The tag is `/^([a-z0-9]+):/`. A second copy of that regex is how the rule
    // drifts: one site learns about a new scheme and the other does not, and
    // the divergence shows up as a wrong verdict rather than as a type error.
    for (const { path } of COMPARES_TWO_STORED_HASHES) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      expect(
        source,
        `${path} parses a fingerprint's version tag itself. There is one of these, in ` +
          `${THE_RULE}; a second copy is how two comparison sites come to disagree about what ` +
          'a scheme is.',
      ).not.toMatch(/\^\(\[a-z0-9\]\+\):/i);
    }
  });
});

describe('what the rule answers, for every tag in the tree', () => {
  const BARE = 'a'.repeat(64);

  it('holds two untagged sha256 hashes comparable', () => {
    // The commonest case by far — mail and files, both sides, today. If this
    // were false the confirmed list would report nothing at all.
    expect(sameFingerprintVersion(BARE, 'b'.repeat(64))).toBe(true);
  });

  it('holds a tag against no tag INCOMPARABLE, which is the upgrade case', () => {
    for (const tag of [
      CALENDAR_FINGERPRINT_VERSION,
      CONTACT_FINGERPRINT_VERSION,
      CONTAINER_FINGERPRINT_VERSION,
    ]) {
      expect(sameFingerprintVersion(`${tag}:${BARE}`, BARE), `${tag} against a bare hash`).toBe(
        false,
      );
    }
  });

  it('holds two DIFFERENT tags incomparable, not just tagged against bare', () => {
    const tags = [
      CALENDAR_FINGERPRINT_VERSION,
      CONTACT_FINGERPRINT_VERSION,
      CONTAINER_FINGERPRINT_VERSION,
    ];
    for (const a of tags) {
      for (const b of tags) {
        expect(
          sameFingerprintVersion(`${a}:${BARE}`, `${b}:${BARE}`),
          `${a} against ${b}`,
        ).toBe(a === b);
      }
    }
  });

  it('reads the container scheme as a scheme at all', () => {
    // `zip1` is the newest tag and the one this workplan added. A regex that
    // stopped at letters would return undefined for it and quietly make every
    // container hash look untagged — comparable with every whole-file hash,
    // which is the exact failure the tag exists to prevent.
    expect(versionOf(`${CONTAINER_FINGERPRINT_VERSION}:${BARE}`)).toBe('zip1');
    expect(versionOf(BARE)).toBeUndefined();
  });

  it('does not treat a hex digest with no colon as a tagged value', () => {
    // A bare sha256 is 64 characters of `[a-f0-9]`, which the tag pattern would
    // match happily if it did not require the colon. It does require it, and
    // this is what says so.
    expect(versionOf('deadbeef')).toBeUndefined();
  });
});
