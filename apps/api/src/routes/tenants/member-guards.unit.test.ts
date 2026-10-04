// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Regression tests for the membership access-control guards (review findings on
 * members.ts: broken last-owner protection, broken self-removal, owner-grant
 * escalation), and the owner role on every door (workplan 0137 T3 (b) and (c),
 * the owner's choice of 2026-10-04): only an ACTIVE owner counts, only an
 * active owner is protected as the last one, and only an owner may demote or
 * remove an owner, as the rows the route has locked say who is an owner.
 */

import { describe, it, expect } from 'vitest';
import {
  countActiveOwners,
  demotesLastOwner,
  removesLastOwner,
  changesOwnerWithoutPermission,
  grantsOwnerWithoutPermission,
  isActiveOwnerAmong,
  isSelfRemoval,
} from './member-guards.ts';

const ACTIVE_OWNER = { role: 'owner', status: 'active' } as const;
const INVITED_OWNER = { role: 'owner', status: 'invited' } as const;
const DECLINED_OWNER = { role: 'owner', status: 'declined' } as const;

describe('countActiveOwners', () => {
  it('counts active owners only: an invitation as owner and a declined one hold no power', () => {
    expect(
      countActiveOwners([
        ACTIVE_OWNER,
        INVITED_OWNER,
        DECLINED_OWNER,
        { role: 'owner', status: 'removed' },
        { role: 'admin', status: 'active' },
      ]),
    ).toBe(1);
  });
  it('counts every active owner', () => {
    expect(countActiveOwners([ACTIVE_OWNER, ACTIVE_OWNER])).toBe(2);
    expect(countActiveOwners([])).toBe(0);
  });
});

describe('demotesLastOwner', () => {
  it('blocks demoting the only active owner (the bug: this used to slip through)', () => {
    expect(demotesLastOwner(ACTIVE_OWNER, 'member', 1)).toBe(true);
    expect(demotesLastOwner(ACTIVE_OWNER, 'admin', 1)).toBe(true);
  });
  it('allows demoting an active owner when another active owner remains', () => {
    expect(demotesLastOwner(ACTIVE_OWNER, 'admin', 2)).toBe(false);
  });
  it('does not protect an invitation as owner or a declined one: neither is an owner', () => {
    expect(demotesLastOwner(INVITED_OWNER, 'admin', 1)).toBe(false);
    expect(demotesLastOwner(DECLINED_OWNER, 'admin', 1)).toBe(false);
  });
  it('allows role changes that keep or grant owner, and non-owner changes', () => {
    expect(demotesLastOwner(ACTIVE_OWNER, 'owner', 1)).toBe(false); // no-op / stays owner
    expect(demotesLastOwner({ role: 'member', status: 'active' }, 'admin', 1)).toBe(false); // target isn't an owner
    expect(demotesLastOwner({ role: 'admin', status: 'active' }, 'owner', 0)).toBe(false); // promotion, not demotion
  });
});

describe('removesLastOwner', () => {
  it('blocks removing the only active owner', () => {
    expect(removesLastOwner(ACTIVE_OWNER, 1)).toBe(true);
  });
  it('allows removing an active owner when others remain, and any non-owner', () => {
    expect(removesLastOwner(ACTIVE_OWNER, 3)).toBe(false);
    expect(removesLastOwner({ role: 'member', status: 'active' }, 1)).toBe(false);
  });
  it('lets an owner withdraw an invitation as owner, or a declined one, with one active owner', () => {
    // What stops the active-only count from counting too little: the one
    // active owner withdrawing an invitation is not removing the last owner.
    expect(removesLastOwner(INVITED_OWNER, 1)).toBe(false);
    expect(removesLastOwner(DECLINED_OWNER, 1)).toBe(false);
  });
});

describe('isActiveOwnerAmong', () => {
  // The rows the route has locked: every owner row, and the target. Whether
  // the requester is an owner is read here, not from the role `authenticate`
  // read when the request came in (review of 2026-10-04).
  const rows = [
    { userId: 'first', ...ACTIVE_OWNER },
    { userId: 'pending:x', ...INVITED_OWNER },
    { userId: 'gone', ...DECLINED_OWNER },
    { userId: 'admin', role: 'admin', status: 'active' },
  ];
  it('is true for a requester whose active owner row is among them', () => {
    expect(isActiveOwnerAmong(rows, 'first')).toBe(true);
  });
  it('is false for an owner demoted or removed a moment ago: their row is no longer an active owner', () => {
    expect(isActiveOwnerAmong(rows, 'admin')).toBe(false);
    expect(isActiveOwnerAmong(rows, 'removed-while-waiting')).toBe(false);
    expect(isActiveOwnerAmong(rows, 'gone')).toBe(false);
    expect(isActiveOwnerAmong(rows, 'pending:x')).toBe(false);
  });
  it('is false with no requester', () => {
    expect(isActiveOwnerAmong(rows, undefined)).toBe(false);
  });
});

describe('changesOwnerWithoutPermission', () => {
  it('blocks a requester who is not an owner (e.g. an admin) from demoting or removing an owner', () => {
    expect(changesOwnerWithoutPermission('owner', false)).toBe(true);
  });
  it('allows an owner to change an owner, and anyone to change a role below owner', () => {
    expect(changesOwnerWithoutPermission('owner', true)).toBe(false);
    expect(changesOwnerWithoutPermission('admin', false)).toBe(false);
    expect(changesOwnerWithoutPermission('member', false)).toBe(false);
  });
});

describe('grantsOwnerWithoutPermission', () => {
  it('blocks a requester who is not an owner (e.g. an admin) from granting owner', () => {
    expect(grantsOwnerWithoutPermission('owner', false)).toBe(true);
  });
  it('allows an owner to grant owner, and any requester to set non-owner roles', () => {
    expect(grantsOwnerWithoutPermission('owner', true)).toBe(false);
    expect(grantsOwnerWithoutPermission('admin', false)).toBe(false);
  });
});

describe('isSelfRemoval', () => {
  it('matches on user id (not the membership row id)', () => {
    expect(isSelfRemoval('user-1', 'user-1')).toBe(true);
    expect(isSelfRemoval('user-1', 'user-2')).toBe(false);
  });
  it('is false when either id is missing', () => {
    expect(isSelfRemoval(undefined, 'user-1')).toBe(false);
    expect(isSelfRemoval('user-1', undefined)).toBe(false);
  });
});
