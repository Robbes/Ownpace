// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * §14.1's S-or-D judgement (workplan 0027 T1).
 *
 * The interesting test is the third one. Two of the three answers are simple
 * lookups; the value of this module is that it has a way of saying "I don't
 * know" at all, because both wrong guesses cost the owner real work — one
 * drops a mailbox full of mail from the migration, the other leaves an
 * address that reaches nobody after cutover.
 */

import { describe, it, expect } from 'vitest';
import type { DiscoveredGroup } from '@openmig/shared';
import {
  classifySharedAddress,
  classifyStoreSignal,
  membersUsable,
  sharedAddressQuestion,
} from './classify-shared-address';

const group = (overrides: Partial<DiscoveredGroup> = {}): DiscoveredGroup => ({
  id: 'g1',
  address: 'info@acme.nl',
  store: 'no_store',
  members: { kind: 'listed', addresses: ['rob@acme.nl'] },
  ...overrides,
});

describe('an address with a store', () => {
  it('is Pattern S', () => {
    // §14.1, verbatim: "If an M365 group has a store, treat it as Pattern S."
    const result = classifyStoreSignal('has_store');
    expect(result.pattern).toBe('shared_s');
    expect(result.reason).toContain('message store');
  });
});

describe('an address with no store', () => {
  it('is Pattern D', () => {
    const result = classifyStoreSignal('no_store');
    expect(result.pattern).toBe('distribution_d');
    // The reason has to explain why there is nothing to copy, or the owner
    // reads "no store" as "we are not migrating this address".
    expect(result.reason).toContain('member list');
  });
});

describe('an address the source could not describe', () => {
  it('gets NO pattern', () => {
    expect(classifyStoreSignal('unknown').pattern).toBeUndefined();
  });

  it('explains what each wrong guess would cost', () => {
    // This reason ends up in a decision an owner has to answer, and they can
    // only answer it if they know why it is being asked.
    const { reason } = classifyStoreSignal('unknown');
    expect(reason).toContain('mailbox full of mail');
    expect(reason).toContain('reach nobody');
  });

  it('asks it as a question about the organisation, not about our data', () => {
    const q = sharedAddressQuestion(group({ store: 'unknown', displayName: 'Info' }));
    // §14.1's own wording. The person answering knows how info@ is used;
    // they do not know what a `groupTypes` array said.
    expect(q).toContain('jointly handle one shared mailbox');
    expect(q).toContain('distribution list');
    expect(q).toContain('Info (info@acme.nl)');
  });

  it('names the bare address when the group has no display name', () => {
    expect(sharedAddressQuestion(group({ store: 'unknown' }))).toContain('at info@acme.nl,');
  });
});

describe('whether the members can be acted on', () => {
  it('is true for a list that was read', () => {
    expect(membersUsable(group())).toBe(true);
  });

  it('is true for a group that genuinely has NO members', () => {
    // Empty is a real answer; plenty of groups have none.
    expect(membersUsable(group({ members: { kind: 'listed', addresses: [] } }))).toBe(true);
  });

  it('is false when the list could not be read', () => {
    // Same `[]` downstream, opposite meaning. Pattern D recreates a group
    // FROM this list, so recreating an unread one produces an empty group on
    // the target that looks finished.
    expect(membersUsable(group({ members: { kind: 'not_enumerable', reason: '403' } }))).toBe(
      false,
    );
  });

  it('does not change the pattern', () => {
    // The store signal is what §14.1 turns on; an unreadable membership
    // limits what may be DONE with the answer, not what the answer is.
    const unreadable = group({ store: 'no_store', members: { kind: 'not_enumerable', reason: 'x' } });
    expect(classifySharedAddress(unreadable).pattern).toBe('distribution_d');
  });
});
