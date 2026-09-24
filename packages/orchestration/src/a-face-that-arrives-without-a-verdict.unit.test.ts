// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FACE THAT ARRIVES WITHOUT A VERDICT (workplan 0131 T2 (a)).
 *
 * The screen says which sources have met a real account from one table in
 * shared, `SOURCE_PROOFS`: a verdict for each source kind, and for the account
 * kinds one for each face. The faces themselves are decided here, in
 * orchestration: `ACCOUNT_FACE_BUILDERS` says which builder speaks for which
 * face, and `everyFaceClaimedBy` answers every face a kind can EVER claim,
 * including the two a deployment unlocks by declaring Google's restricted
 * scopes.
 *
 * Two tables in two packages, and the second has to follow the first. A face
 * added to an account kind (To Do was one, Google Tasks another, a Soverin file
 * face is promised) is a new thing a tester can tick. If it arrives with no
 * verdict, the wizard has nothing to say about it, and the one thing it says
 * nothing about is the face nobody has run. So every face `everyFaceClaimedBy`
 * returns must have a verdict, and the verdict table must not carry a face no
 * builder serves, which would be a label on nothing.
 *
 * What the verdict IS, and where a proven one is recorded, are
 * `scripts/a-proof-that-was-written-down.unit.test.ts`'s. This file asks only
 * that there is one.
 */

import { describe, it, expect } from 'vitest';
import { PROVIDER_ACCOUNT_KINDS, SOURCE_PROOFS } from '@openmig/shared';
import { everyFaceClaimedBy } from './source-face-builders.ts';

describe('every face an account kind can claim has a verdict', () => {
  it.each([...PROVIDER_ACCOUNT_KINDS])('%s', (kind) => {
    const claimed = everyFaceClaimedBy(kind);
    expect(claimed.length, `${kind} claims no face: the check below would pass on nothing`).toBeGreaterThan(0);
    const verdicts = SOURCE_PROOFS?.faces?.[kind] ?? {};
    for (const face of claimed) {
      expect(verdicts[face], `${kind} can claim ${face}, and no verdict says whether it has met a real account`).toBeDefined();
    }
    // And the other direction: a verdict for a face no builder serves is a
    // label on something the wizard cannot offer.
    for (const face of Object.keys(verdicts)) {
      expect(claimed as ReadonlyArray<string>, `${kind} has a verdict for ${face}, which it never claims`).toContain(face);
    }
  });

  it('the Google account is asked about the restricted faces too, not only its default three', () => {
    // `everyFaceClaimedBy` reads the ceiling, so the two faces a deployment
    // unlocks are in it. Pinned here because a verdict table that followed
    // the DEFAULT would be complete by this test and silent on those two.
    expect(everyFaceClaimedBy('google')).toEqual(expect.arrayContaining(['email', 'file']));
    expect(SOURCE_PROOFS?.faces?.google?.email).toBeDefined();
    expect(SOURCE_PROOFS?.faces?.google?.file).toBeDefined();
  });
});
