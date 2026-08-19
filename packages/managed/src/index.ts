// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The managed edition. Everything that exists because we run this as a service
 * for customers (ADR-0036).
 *
 * Nothing an appliance runs may import this package, and nothing here may be
 * re-exported from `@openmig/shared` or `@openmig/ledger`, because those two
 * ARE the appliance. `apps/selfhost/src/no-managed-leakage.unit.test.ts` walks
 * the appliance's real import graph and fails on any specifier that reaches
 * here, so the rule is enforced rather than remembered.
 *
 * THE SPLIT IS BY WHO IS BEING SERVED, not by subject matter. This package
 * started out called `@openmig/billing`, on the theory that money was the
 * whole of the difference. It was not: within a day the same boundary caught
 * accounts (`tenant_member`), closing an account, and the erasure receipts we
 * produce as somebody's processor — none of which is money, and all of which
 * exists only because there is a customer on the other side. An appliance has
 * an owner, not customers. The owner needs no invoice, no seat, no window in
 * which to change their mind, and no receipt from us proving we deleted what
 * was already on their own disk.
 *
 * WHAT STAYED BEHIND, deliberately: `apps/selfhost/src/forget-me.ts`. It looks
 * like the same subject and is not. Deleting an appliance destroys OUR copy of
 * a credential and does nothing whatever to the grant — a refresh token still
 * mints access tokens after the disk is gone, and revoking it needs the
 * credential the wipe destroyed. That is not a service obligation; it is the
 * one part of "ending it" the operator cannot do for themselves.
 */

export * from './pricing';
export * from './tenant-pricing';
export * from './usage-metering';
export * from './offboarding';
export * as managedSchema from './schema-managed';
