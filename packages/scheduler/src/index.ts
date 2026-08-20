// Copyright 2026 The Ownpace authors (Apache-2.0)
// T1 contracts live in @openmig/shared (see ports.ts); implement impls here per docs/workplans/0001-first-slice-jmap-mail.md.
export const packageName = '@openmig/scheduler';

export * from './single-flight.ts';
export * from './scheduler.ts';
export * from './trigger-client.ts';
