// Copyright 2026 The Ownpace authors (Apache-2.0)
export const packageName = '@openmig/shared';

export * from './ids.ts';
export * from './mail.ts';
export * from './calendar.ts';
export * from './contact.ts';
export * from './file.ts';
export * from './container-hash.ts';
export * from './google-native-coverage.ts';
export * from './dropbox-native-policy.ts';
export * from './fingerprint-scheme.ts';
export * from './hash.ts';
// The JMAP parent-chain -> WebDAV path reconstruction (0031 T3). Beside hash.ts
// deliberately: it exists only to produce something fileNaturalKeyHash can key.
export * from './jmap-file-path.ts';
export * from './dav-canonical.ts';
export * from './carddav-query.ts';
export * from './caldav-query.ts';
export * from './generated-message-id.ts';
export * from './mail-headers.ts';
export * from './mail-subject.ts';
export * from './ports.ts';
export * from './operating-contract.ts';
// Workplan 0122 T1 — what a progress-link holder may see. Beside the
// operating contract it narrows, so the pair is found together.
export * from './migration-view.ts';
export * from './completion-report.ts';
export * from './lifecycle.ts';
export * from './path-phase.ts';
// Workplan 0154 T1 (a): where a migration is, in a person's words, read from
// the lifecycle and path phase beside it.
export * from './stage.ts';
export * from './progress.ts';
// ADR-0050 (amended 2026-09-28), workplan 0153 T2: the person a migration is
// for, in the shapes both editions answer.
export * from './people.ts';
export * from './share-gate.ts';
export * from './confirmed-list.ts';
export * from './verification-report.ts';
export * from './discovery.ts';
export * from './decisions.ts';
export * from './permissions.ts';
export * from './notifications.ts';
export * from './tenant-contact.ts';
export * from './share-announcement.ts';
// The privacy policy's address for that mail, from LEGAL_SITE_URL (0139 T4).
export * from './privacy-policy-link.ts';
export * from './share-grouping.ts';
export * from './scope-manifest.ts';
export * from './keywords.ts';
export * from './specialUse.ts';
export * from './cursor.ts';
export * from './concurrency.ts';
export * from './config.ts';
export * from './target-domains.ts';
// Workplan 0148 T9 — which destinations an export can be read from, beside
// the table it derives from.
export * from './archive-in-target.ts';
export * from './provider-setup.ts';
export * from './credential-fields.ts';
export * from './front-door.ts';
export * from './qualification-gate.ts';
export * from './cron-schedule.ts';
export * from './throttling.ts';
export * from './pass-deadline.ts';
export * from './rate-budget.ts';
export * from './pause-reason.ts';
export * from './file-body.ts';
export * from './credential-refusals.ts';
export * from './link-holder-refusals.ts';
export * from './grant-withdrawal.ts';
export * from './organisation-closed.ts';
export * from './failure-category.ts';
export * from './needs-decision.ts';
export * from './stated-failure-category.ts';
export * from './unread-collections.ts';
export * from './target-folder-missing.ts';
export * from './config-revision.ts';
export * from './kind-addition.ts';
export * from './provider-accounts.ts';
export * from './archive-providers.ts';
export * from './provider-directory.ts';
export * from './provider-endpoints.ts';
export * from './google-deployment-client.ts';
export * from './google-read-only.ts';
export * from './dropbox-deployment-client.ts';
export * from './microsoft-deployment-client.ts';
export * from './microsoft-scopes.ts';
export * from './provider-clients.ts';
export * from './consent-state.ts';
export * from './redirect-uris.ts';
export * from './standing-grants.ts';
export * from './erasure-timeline.ts';
export * from './erasure-scope.ts';
export * from './quiesce.ts';
export * from './token-revocation.ts';
export * from './logger.ts';
export * from './app-event.ts';
export * from './unreadable-answer.ts';
export * from './operator-log.ts';
export * from './audit-export.ts';
export * from './metrics.ts';
// Pricing moved to @openmig/managed (ADR-0036): an appliance has an owner,
// not customers, and @openmig/shared is loaded by both editions.
export * from './probe-outcome.ts';
export * from './dav-refusal.ts';
// A remote's refusal in parts, so the managed Test button answers without its bytes (0136 T3).
export * from './remote-refusal.ts';
export * from './calendar-scheduling.ts';
// Not here: the rule for a host a tenant gives us (0136 T1) builds a BlockList
// and loads undici as it is imported, and the browser bundle loads this index.
// Node code imports it as `@openmig/shared/reachable-host`.
