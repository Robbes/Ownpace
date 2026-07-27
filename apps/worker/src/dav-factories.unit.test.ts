// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// The wiring contract `buildTargetReindexers` depends on.
//
// It decides which domains the verification gate can read by asking each built
// target whether it has `listEntries`. If a factory ever returns a target
// without one, that domain silently drops back to NOT_VERIFIABLE and blocks
// cutovers — with no test failure anywhere to say why. This pins it.

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { buildCalendarTarget, buildContactTarget, buildFileTarget } from './dav-factories';

const deps = {
  ledger: {} as Ledger,
  tenantId: asTenantId('5f9c0000-e29b-41d4-a716-4466554438a1' as never),
  mappingId: asMappingId('5f9c0000-e29b-41d4-a716-4466554438a2' as never),
};
const endpoint = { url: 'https://cloud.example.com/remote.php/dav', username: 'alice', password: 'pw' };

describe('DAV target factories produce reindexable targets', () => {
  it.each([
    ['calendar', buildCalendarTarget],
    ['contacts', buildContactTarget],
    ['files', buildFileTarget],
  ] as const)('%s target implements listEntries', (_domain, build) => {
    const target = build(endpoint, deps) as { listEntries?: unknown };
    expect(typeof target.listEntries).toBe('function');
  });
});
