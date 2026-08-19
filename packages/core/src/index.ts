// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
// T1 contracts live in @openmig/shared (see ports.ts); implement impls here per docs/workplans/0001-first-slice-jmap-mail.md.
export const packageName = '@openmig/core';

export * from './reconcile.ts';
export * from './reindex.ts';
export * from './cutover-state.ts';
export * from './verification.ts';
export * from './verification-implementations.ts';
// DNS is VERIFY-ONLY, and that is the whole of it. `dns-manager.ts` and
// `dns-provider-desec.ts` — a ~950-line write path with a deSEC provider —
// were deleted on 2026-08-05 (owner decision, workplan 0026 T3 row 20). They
// were exported from here and imported by nothing but their own test since the
// July decision to defer DNS writes, which is the same shape that got the
// engine wrappers deleted under ADR-0019 and `OperatorDashboard` deleted under
// 0026 T2. Git preserves them; the CHANGELOG has always told users the MX
// switch is a manual operator step, and now the code says the same thing.
export * from './dns-verify-only.ts';
export * from './domain-sync.ts';
export * from './dav-sync.ts';
export * from './discovery.ts';
export * from './apply-deletion.ts';
export * from './detect-new-mailboxes.ts';
export * from './run-new-mailbox-detection.ts';
export * from './mapping-coverage.ts';
// Shared addresses — §14.1's S-or-D judgement and the discovery pass (0027 T1).
export * from './classify-shared-address.ts';
export * from './run-group-discovery.ts';
export * from './group-runbook.ts';
export * from './mapping-pattern.ts';
// Build identity for the /version endpoints (release-readiness, 2026-08-10).
export * from './build-identity.ts';
// The permission inventory's judgement (0029 T2, SAD §14.2).
export * from './permission-map.ts';
export * from './permission-report.ts';
export * from './run-permission-inventory.ts';
export * from './share-queue.ts';
