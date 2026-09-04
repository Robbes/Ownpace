// Copyright 2026 The Ownpace authors (Apache-2.0)
export const packageName = '@openmig/shared';

export * from './ids.ts';
export * from './mail.ts';
export * from './calendar.ts';
export * from './contact.ts';
export * from './file.ts';
export * from './hash.ts';
// The JMAP parent-chain -> WebDAV path reconstruction (0031 T3). Beside hash.ts
// deliberately: it exists only to produce something fileNaturalKeyHash can key.
export * from './jmap-file-path.ts';
export * from './dav-canonical.ts';
export * from './generated-message-id.ts';
export * from './ports.ts';
export * from './operating-contract.ts';
export * from './completion-report.ts';
export * from './lifecycle.ts';
export * from './verification-report.ts';
export * from './discovery.ts';
export * from './decisions.ts';
export * from './permissions.ts';
export * from './notifications.ts';
export * from './share-announcement.ts';
export * from './scope-manifest.ts';
export * from './keywords.ts';
export * from './specialUse.ts';
export * from './cursor.ts';
export * from './concurrency.ts';
export * from './config.ts';
export * from './target-domains.ts';
export * from './provider-setup.ts';
export * from './credential-fields.ts';
export * from './front-door.ts';
export * from './qualification-gate.ts';
export * from './cron-schedule.ts';
export * from './throttling.ts';
export * from './rate-budget.ts';
export * from './credential-refusals.ts';
export * from './failure-category.ts';
export * from './provider-accounts.ts';
export * from './archive-providers.ts';
export * from './provider-directory.ts';
export * from './provider-endpoints.ts';
export * from './google-deployment-client.ts';
export * from './dropbox-deployment-client.ts';
export * from './microsoft-deployment-client.ts';
export * from './provider-clients.ts';
export * from './redirect-uris.ts';
export * from './standing-grants.ts';
export * from './erasure-timeline.ts';
export * from './erasure-scope.ts';
export * from './quiesce.ts';
export * from './token-revocation.ts';
export * from './logger.ts';
export * from './metrics.ts';
// Pricing moved to @openmig/managed (ADR-0036): an appliance has an owner,
// not customers, and @openmig/shared is loaded by both editions.
export * from './probe-outcome.ts';
export * from './calendar-scheduling.ts';
