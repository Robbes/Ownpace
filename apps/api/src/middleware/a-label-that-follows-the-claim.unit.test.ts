// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LABEL THAT FOLLOWS THE CLAIM (workplan 0102 T3).
 *
 * `tenant_member.email` was written once, when the row was created, and nothing
 * ever updated it. ADR-0042's amended invariant means that was never a
 * membership problem — `sub` is the identity, so somebody who changes their
 * address at the provider keeps every organisation they belong to.
 *
 * WHAT WENT STALE IS THE LABEL, and the asymmetry is what makes it worth a
 * rule: `GET /api/me` reports the verified claim, so the person who moved sees
 * their new address everywhere, while everyone else in their organisation goes
 * on seeing the old one in the members table (`Tenants.tsx` renders
 * `member.email` straight off that row). The one person who could report it is
 * the one person who cannot see it.
 *
 * The decision is pure so it can be read here; the write it drives is proved
 * against a real database with RLS in force in `routes/me.integration.test.ts`,
 * where a second member of the same organisation exists precisely to show that
 * the statement's `user_id` predicate leaves them alone.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { labelsToUpdate } from './auth.ts';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('which stored labels no longer match the verified claim', () => {
  it('names the organisations whose label is out of date', () => {
    expect(
      labelsToUpdate([{ tenantId: A, email: 'old@example.com' }], 'new@example.com', true),
    ).toEqual([A]);
  });

  it('names nothing when the label already matches', () => {
    // The ordinary case, on every sign-in for the life of the deployment. It
    // has to cost no write at all.
    expect(
      labelsToUpdate([{ tenantId: A, email: 'same@example.com' }], 'same@example.com', true),
    ).toEqual([]);
  });

  it('treats a change of CASE as the same address', () => {
    /**
     * The comparison decides whether to WRITE. A provider that starts asserting
     * `Rob@example.com` where it used to assert `rob@example.com` is asserting
     * the same address; calling that a change would put an UPDATE on every
     * sign-in forever.
     */
    expect(
      labelsToUpdate([{ tenantId: A, email: 'rob@example.com' }], 'Rob@Example.com', true),
    ).toEqual([]);
  });

  it('ignores surrounding whitespace on either side', () => {
    expect(
      labelsToUpdate([{ tenantId: A, email: ' rob@example.com ' }], 'rob@example.com', true),
    ).toEqual([]);
  });

  it('refuses an UNVERIFIED claim, however different it looks', () => {
    // An unverified address is a typo or somebody else's inbox. Migration 0006
    // already refuses to bind an invitation on one; the same address is held to
    // the same standard here.
    expect(
      labelsToUpdate([{ tenantId: A, email: 'old@example.com' }], 'attacker@example.com', false),
    ).toEqual([]);
    expect(
      labelsToUpdate([{ tenantId: A, email: 'old@example.com' }], 'attacker@example.com', undefined),
    ).toEqual([]);
  });

  it('refuses an absent or blank claim rather than blanking the label', () => {
    // `email` is NOT NULL on that table, and a person with no label is worse
    // than one with an old label.
    expect(labelsToUpdate([{ tenantId: A, email: 'old@example.com' }], undefined, true)).toEqual([]);
    expect(labelsToUpdate([{ tenantId: A, email: 'old@example.com' }], '   ', true)).toEqual([]);
  });

  it('names every organisation that is behind, and only those', () => {
    expect(
      labelsToUpdate(
        [
          { tenantId: A, email: 'old@example.com' },
          { tenantId: B, email: 'new@example.com' },
        ],
        'new@example.com',
        true,
      ),
    ).toEqual([A]);
  });

  it('names nothing for somebody who belongs nowhere', () => {
    expect(labelsToUpdate([], 'new@example.com', true)).toEqual([]);
  });
});

describe('and the statement that carries it out is bounded', () => {
  const auth = readFileSync(join(import.meta.dirname, 'auth.ts'), 'utf8');

  /**
   * THE ONE LINE BETWEEN A LABEL AND A TABLE. The write runs under the
   * tenant-scoped UPDATE policy — migration 0003 reasoned that a self-service
   * write policy is the wrong shape, and RLS is row-level so it could not
   * restrict which column changes anyway. Which means the policy alone permits
   * rewriting EVERY member of that organisation, and only the statement's own
   * predicate stops it.
   *
   * `me.integration.test.ts` proves the behaviour against a real database. This
   * catches the deletion in a unit run, seconds after somebody makes it.
   */
  it('updates only rows carrying this subject', () => {
    const at = auth.indexOf('.update(tenantMember)');
    expect(at, 'nothing updates tenant_member any more').toBeGreaterThan(-1);
    const statement = auth.slice(at, at + 700);
    expect(
      statement,
      'the UPDATE does not filter on user_id. The tenant-scoped policy permits\n' +
        "rewriting every member of that organisation; this predicate is what\n" +
        'stops it.',
    ).toMatch(/eq\(tenantMember\.userId, userId\)/);
    expect(
      statement,
      'the UPDATE does not name the tenant it was authorised for',
    ).toMatch(/eq\(tenantMember\.tenantId, tenantId\)/);
  });

  it('never touches an invitation, which is an offer somebody answers', () => {
    // An `invited` row is addressed to an email with no subject on it yet.
    // Rewriting one would be claiming an invitation — the thing workplan 0099
    // deliberately made answerable.
    const at = auth.indexOf('.update(tenantMember)');
    expect(auth.slice(at, at + 700)).toMatch(/eq\(tenantMember\.status, 'active'\)/);
  });

  it('reads before it writes, so the ordinary sign-in costs no write', () => {
    const fn = auth.slice(auth.indexOf('export async function reconcileMemberEmail'));
    expect(fn.slice(0, 2000), 'nothing reads the stored labels first').toMatch(
      /\.select\(\{ tenantId: tenantMember\.tenantId, email: tenantMember\.email \}\)/,
    );
  });
});
