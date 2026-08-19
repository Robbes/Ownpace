// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
export const packageName = '@openmig/shared';

export * from './ids';
export * from './mail';
export * from './calendar';
export * from './contact';
export * from './file';
export * from './hash';
// The JMAP parent-chain -> WebDAV path reconstruction (0031 T3). Beside hash.ts
// deliberately: it exists only to produce something fileNaturalKeyHash can key.
export * from './jmap-file-path';
export * from './dav-canonical';
export * from './generated-message-id';
export * from './ports';
export * from './operating-contract';
export * from './completion-report';
export * from './lifecycle';
export * from './verification-report';
export * from './discovery';
export * from './decisions';
export * from './permissions';
export * from './notifications';
export * from './scope-manifest';
export * from './keywords';
export * from './specialUse';
export * from './cursor';
export * from './concurrency';
export * from './config';
export * from './target-domains';
export * from './provider-setup';
export * from './credential-fields';
export * from './cron-schedule';
export * from './throttling';
export * from './rate-budget';
export * from './credential-refusals';
export * from './standing-grants';
export * from './erasure-timeline';
export * from './erasure-scope';
export * from './quiesce';
export * from './token-revocation';
export * from './logger';
export * from './metrics';
// Pricing moved to @openmig/billing (ADR-0036): an appliance has an owner,
// not customers, and @openmig/shared is loaded by both editions.
export * from './probe-outcome';
