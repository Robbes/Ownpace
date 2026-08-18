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
export * from './usage-metering';
export * from './tenant-pricing';
export * from './run-store';
export * from './migrate';
export * from './retention';
export * from './direct-url';
export * from './pg-rate-budget';
export * from './offboarding';
