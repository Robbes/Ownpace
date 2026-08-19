// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
// T1 contracts live in @openmig/shared (see ports.ts); implement impls here per docs/workplans/0001-first-slice-jmap-mail.md.
export const packageName = '@openmig/ledger';

export * from './ledger';
export * from './cursor-store';
export * from './db';
// The connection seam (workplan 0015 T1) — what a PGlite driver would implement.
export * from './driver';
// The PGlite implementation (workplan 0016). Imported explicitly by the
// appliance; the managed edition never touches it.
export * from './pglite-driver';
export * from './db-types';
export * from './schema-pg';
export * from './cutover-store';
export * from './verification-queries';
export * from './migration-status-store';
export * from './discovery-store';
export * from './decision-store';
export * from './policy-preset-store';
export * from './group-def-store';
// Usage metering and tenant pricing moved to @openmig/managed (ADR-0036).
// The appliance imports this index, so anything re-exported here is on the
// appliance whether it calls it or not.
export * from './run-store';
export * from './migrate';
export * from './retention';
export * from './direct-url';
export * from './pg-rate-budget';
// Offboarding moved to @openmig/managed (ADR-0036). Closing an account, the
// purge window and the erasure receipt are things a SERVICE does for a
// customer; `purgeTenant` is executed only by apps/worker. The appliance's
// own ending is `apps/selfhost/src/forget-me.ts`, which revokes and nothing
// else, because that is the only part its operator cannot do themselves.
