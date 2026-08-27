// Copyright 2026 The Ownpace authors (Apache-2.0)
// T1 contracts live in @openmig/shared (see ports.ts); implement impls here per docs/workplans/0001-first-slice-jmap-mail.md.
export const packageName = '@openmig/ledger';

export * from './ledger.ts';
export * from './cursor-store.ts';
export * from './db.ts';
// The connection seam (workplan 0015 T1) — what a PGlite driver would implement.
export * from './driver.ts';
// The PGlite implementation (workplan 0016). Imported explicitly by the
// appliance; the managed edition never touches it.
export * from './pglite-driver.ts';
export * from './db-types.ts';
export * from './schema-pg.ts';
export * from './cutover-store.ts';
export * from './verification-queries.ts';
export * from './migration-status-store.ts';
export * from './path-lifecycle-store.ts';
export * from './discovery-store.ts';
export * from './decision-store.ts';
export * from './policy-preset-store.ts';
export * from './group-def-store.ts';
// Usage metering and tenant pricing moved to @openmig/managed (ADR-0036).
// The appliance imports this index, so anything re-exported here is on the
// appliance whether it calls it or not.
export * from './run-store.ts';
export * from './migrate.ts';
export * from './retention.ts';
export * from './direct-url.ts';
export * from './pg-rate-budget.ts';
export * from './mapping-link-store.ts';
// Offboarding moved to @openmig/managed (ADR-0036). Closing an account, the
// purge window and the erasure receipt are things a SERVICE does for a
// customer; `purgeTenant` is executed only by apps/worker. The appliance's
// own ending is `apps/selfhost/src/forget-me.ts`, which revokes and nothing
// else, because that is the only part its operator cannot do themselves.
