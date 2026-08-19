// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Money. The managed edition only (ADR-0036).
 *
 * Nothing an appliance runs may import this package, and nothing here may be
 * re-exported from `@openmig/shared` or `@openmig/ledger`, because those two
 * ARE the appliance. `apps/selfhost/src/no-managed-leakage.unit.test.ts` walks
 * the appliance's real import graph and fails on any specifier that reaches
 * here, so the rule is enforced rather than remembered.
 *
 * The split is by WHO IS BEING CHARGED, not by subject matter. A price list, a
 * tenant's agreed rates, the metered rows an invoice is built from and the
 * invoice itself all belong to an operator with customers. An appliance has an
 * owner, not customers, and every one of these modules would compute zero for
 * it — which is the tell that it should not be carrying them.
 */

export * from './pricing';
export * from './tenant-pricing';
export * from './usage-metering';
export * as billingSchema from './schema-billing';
