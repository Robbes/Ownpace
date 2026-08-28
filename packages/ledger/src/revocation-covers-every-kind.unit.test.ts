// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every connection kind has a REVOCATION decision, not a default.
 *
 * ## What went wrong, and why nothing said so
 *
 * `token-revocation.ts` is careful about the unknown case, and says so: *"An
 * unknown kind is `unsupported`, never `revoked`. A kind added later without a
 * decision here shows up in the receipt as one we do not know how to revoke,
 * which is true and prompts the decision."*
 *
 * The fail-safe is right. The prompt never arrived. `google` (workplan 0106
 * T3b) was added as a connection kind and fell straight through to that
 * default — so an erasure would have told the customer we could not revoke
 * their Google grant and they must remove it themselves, while we held a
 * refresh token Google publishes an endpoint to kill. Nothing was red; the
 * receipt was simply wrong about our own capability, in the direction that
 * leaves a live credential at a provider.
 *
 * "Prompts the decision" only works if something does the prompting. This is
 * that something.
 *
 * ## Why it lives here rather than beside the module it checks
 *
 * The kinds come from `connection.kind.enumValues`, and
 * `connection-kind-check.unit.test.ts` beside this file proves that enum equals
 * the database's own CHECK constraint. `packages/shared` cannot import the
 * ledger schema — the dependency runs the other way — so the check sits at the
 * end that can see both.
 *
 * ## An explicit decision, not merely an answer
 *
 * `revocationCapability` answers for every string, so asserting that it returns
 * something would pass for a kind nobody had considered. What is asserted is
 * that the answer came from a TABLE — the capability map or the password list —
 * rather than from the fallback, which is detectable because the fallback names
 * the kind in its own reason.
 */

import { describe, it, expect } from 'vitest';
import { revocationCapability } from '@openmig/shared';
import { connection } from './schema-pg.ts';

/** The fallback's reason quotes the kind back; a real decision never does. */
const cameFromTheFallback = (kind: string): boolean =>
  revocationCapability(kind).reason.includes(`'${kind}'`);

describe('revocation covers every connection kind', () => {
  it('read a real list of kinds', () => {
    // Vacuity guard: an empty enum would make the check below assert nothing.
    expect(connection.kind.enumValues.length).toBeGreaterThan(10);
  });

  it('decides every kind explicitly, rather than defaulting', () => {
    const undecided = connection.kind.enumValues.filter(cameFromTheFallback);
    expect(
      undecided,
      'these connection kinds have no revocation decision, so an erasure tells ' +
        'the customer we do not know how to revoke them — which may be false, and ' +
        'is the direction that leaves a live credential at a provider. Add each to ' +
        'REVOCATION_CAPABILITIES or to PASSWORD_KINDS in token-revocation.ts',
    ).toEqual([]);
  });

  it('still treats a kind that is not a connection kind at all as unknown', () => {
    // The fail-safe itself, unchanged: this test tightens what counts as
    // "decided", it does not remove the safety net under everything else.
    expect(cameFromTheFallback('some_future_provider')).toBe(true);
  });

  it('gives every Google kind the same answer, because they hold the same thing', () => {
    // The account kind and the four single-purpose ones all store one customer
    // refresh token. A grant that could be revoked for `google_calendar` and
    // not for `google` would be an accident of which table somebody edited.
    const google = connection.kind.enumValues.filter((k) => k.startsWith('google') || k === 'gmail');
    expect(google.length).toBeGreaterThan(4);
    for (const kind of google) {
      expect(revocationCapability(kind).revocable, `${kind} should be revocable`).toBe(true);
    }
  });
});
