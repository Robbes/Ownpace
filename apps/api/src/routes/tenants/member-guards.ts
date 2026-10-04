// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Pure access-control guards for tenant membership changes. Kept free of DB /
 * Express imports so they are cheaply unit-testable; the route supplies the
 * looked-up state (the target member's role and status, the owner rows, and
 * whether the requester is an owner).
 *
 * THE OWNER ROLE ON EVERY DOOR (workplan 0137 T3; the owner chose (b) and (c)
 * together on 2026-10-04). Only an ACTIVE owner is an owner here: an
 * invitation as owner and a declined one hold no power. So they never keep an
 * organisation owned, and the last active owner can still withdraw them. And
 * only an owner may demote or remove an owner, as only an owner may make one.
 */

/** What these guards need to know about one `tenant_member` row. */
export interface MemberState {
  readonly role: string;
  readonly status: string;
}

function isActiveOwner(member: MemberState): boolean {
  return member.role === 'owner' && member.status === 'active';
}

/** How many of these rows are active owners: the only owners that count. */
export function countActiveOwners(members: readonly MemberState[]): number {
  return members.filter(isActiveOwner).length;
}

/**
 * True when changing `target`'s role to `newRole` would leave the tenant with
 * no active owner. `activeOwners` is the number of active owners, the target
 * included. Only an active owner is protected: an invitation as owner may be
 * changed whatever the count.
 */
export function demotesLastOwner(target: MemberState, newRole: string, activeOwners: number): boolean {
  return isActiveOwner(target) && newRole !== 'owner' && activeOwners <= 1;
}

/**
 * True when removing `target` would leave the tenant with no active owner.
 * Withdrawing an invitation as owner, or removing a declined one, never does.
 */
export function removesLastOwner(target: MemberState, activeOwners: number): boolean {
  return isActiveOwner(target) && activeOwners <= 1;
}

/**
 * True when `userId` holds an active owner row among `rows`. PATCH and DELETE
 * ask the rows they have locked, not the role `authenticate` read when the
 * request came in: an owner demoted or removed while their request waited for
 * the lock is not an owner when its turn comes (review of 2026-10-04).
 */
export function isActiveOwnerAmong(
  rows: readonly (MemberState & { readonly userId: string })[],
  userId: string | undefined,
): boolean {
  return !!userId && rows.some((row) => row.userId === userId && isActiveOwner(row));
}

/**
 * True when the request would demote or remove an owner row and the requester
 * is not an owner. An admin may change anyone below owner, never an owner, and
 * never an invitation as owner either: that is a grant an owner made.
 */
export function changesOwnerWithoutPermission(targetRole: string, requesterIsOwner: boolean): boolean {
  return targetRole === 'owner' && !requesterIsOwner;
}

/**
 * True when the request is trying to grant the `owner` role but the requester is
 * not an owner. Granting owner is owner-only (admins must not self-escalate).
 */
export function grantsOwnerWithoutPermission(newRole: string, requesterIsOwner: boolean): boolean {
  return newRole === 'owner' && !requesterIsOwner;
}

/** True when the requester is trying to remove their own membership. */
export function isSelfRemoval(requesterUserId: string | undefined, targetUserId: string | undefined): boolean {
  return !!requesterUserId && requesterUserId === targetUserId;
}
