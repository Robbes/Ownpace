// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A guard that `contentHash` is never derived from a CRC-32.
 *
 * ADR-0046 rule (b) says it in one line: sha256 of inflated bytes, never the
 * zip's stored CRC-32. `drive-export-members.ts` fingerprints members by that
 * CRC because it is free and it is answering "what moved". `container-hash.ts`
 * answers "are these the same file" and decides whether a customer's document
 * is rewritten. Thirty-two bits that are not collision-resistant is the wrong
 * primitive for that question, and the wrong one looks exactly like a cheap
 * optimisation to anyone who reads the diagnostic first.
 *
 * WHY THIS IS A SOURCE GUARD AND NOT A BEHAVIOUR TEST, which is the part worth
 * understanding. Swapping sha256 for CRC-32 in `containerContentHash` passes
 * EVERY behavioural test in `container-hash.unit.test.ts` — all fifteen. That
 * was measured, not assumed: the swap was made and the suite stayed green. It
 * has to. CRC-32 detects change perfectly well on any fixture a test can
 * write; its weakness is an ADVERSARY choosing two inputs that collide, and no
 * unit test demonstrates that in a way that would survive review.
 *
 * So the property is not observable from outside the function, and a test that
 * pretended otherwise would be decoration. What IS checkable is the source: the
 * module that computes a content hash must not reach for the cheap checksum.
 * That is what this reads.
 *
 * It is deliberately blunt — a substring check over one file. A blunt guard
 * over the right file beats a clever one over the wrong question.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CONTAINER_HASH = join(ROOT, 'packages/shared/src/container-hash.ts');
const MEMBERS_DIAGNOSTIC = join(ROOT, 'scripts/drive-export-members.ts');
const SCHEME = join(ROOT, 'packages/shared/src/fingerprint-scheme.ts');

describe('the container content hash', () => {
  const source = readFileSync(CONTAINER_HASH, 'utf8');

  it('does not import crc32, from zlib or anywhere else', () => {
    // The import is the tell. Nothing in a content hash needs it, and its
    // presence would mean somebody had reached for the checksum the zip index
    // already carries.
    expect(source).not.toMatch(/\bcrc32\b/);
  });

  it('hashes with sha256', () => {
    expect(source).toMatch(/createHash\('sha256'\)/);
  });

  it('inflates the members rather than hashing what the zip stored', () => {
    // Hashing the COMPRESSED bytes would make the hash depend on the
    // compressor's settings, so a re-packer that changed level would read as a
    // changed document. The behavioural suite catches that one; this asserts
    // the mechanism is present at all, so a future edit cannot quietly drop it.
    expect(source).toMatch(/inflateRawSync/);
  });

  it('carries a version tag, so a scheme change is never read as a change', () => {
    // ADR-0046 rule (d). Without it, adopting this hash re-labels every
    // already-migrated native file and rewrites the lot exactly once.
    //
    // The tag is DEFINED in `fingerprint-scheme.ts` and used here. It moved
    // there on 2026-09-16, when 0042 T7 (c) needed it in `confirmed-list.ts` —
    // a module guarded as pure, which could not import this one. Both halves
    // are asserted, because a tag defined and never stamped on the output, or
    // stamped from a literal rather than the shared constant, would each pass
    // half of this and neither is the rule.
    expect(readFileSync(SCHEME, 'utf8')).toMatch(
      /CONTAINER_FINGERPRINT_VERSION\s*=\s*'[a-z0-9]+'/,
    );
    expect(source).toMatch(
      /import \{ CONTAINER_FINGERPRINT_VERSION \} from '\.\/fingerprint-scheme\.ts'/,
    );
    expect(source).toMatch(/\$\{CONTAINER_FINGERPRINT_VERSION\}:/);
  });
});

describe('the diagnostic it must not be confused with', () => {
  const source = readFileSync(MEMBERS_DIAGNOSTIC, 'utf8');

  it('DOES use the stored CRC-32, which is correct for what it asks', () => {
    // Stated here rather than only in prose, so the distinction is visible from
    // both sides: the diagnostic reads the index because it is answering "what
    // moved" and a wrong answer there costs a re-run, not a customer's file.
    expect(source).toMatch(/crc32/);
  });

  it('says in its own words that it is not a contentHash', () => {
    // The file carries the warning; this checks the warning is still there,
    // because the next person to read it will read it before the ADR.
    expect(source).toMatch(/contentHash/);
  });
});
