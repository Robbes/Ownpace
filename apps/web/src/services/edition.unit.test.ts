// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Edition detection and the per-edition paths (ADR-0026).
 *
 * Two things here are worth pinning down rather than trusting:
 *
 * 1. **The default is `managed`.** This flag gates whether authentication
 *    exists at all — `ProtectedRoute` lets the appliance through without a
 *    login, because it has no accounts and binds to localhost. If a
 *    misconfigured build fell back to `selfhost`, it would serve the decision
 *    queues to whoever asked. The safe default for a flag like that is the one
 *    that KEEPS the login.
 *
 * 2. **The two editions share the queue SHAPES but not the URLs**, and this is
 *    the only place that difference is allowed to live. The appliance answers
 *    for every configured mapping; a managed tenant can have many, so its
 *    queues are scoped to one. Asking managed for a queue without saying which
 *    mapping must fail loudly rather than default to something — guessing would
 *    show somebody another migration's data.
 */

import { describe, it, expect } from 'vitest';
import {
  edition,
  isSelfHost,
  mappingPathFor,
  operatingBaseUrlFor,
  queuePathFor,
  verifyPathFor,
} from './edition';

describe('edition detection', () => {
  it('is managed in this build, and cannot be talked out of it at runtime', () => {
    // The flag is baked in by vite `define`, so it is a literal by the time this
    // runs — which is exactly why it is a boundary and not a setting, and also
    // why the branch-dependent logic below is tested as pure functions rather
    // than by stubbing an environment variable that no longer exists.
    expect(edition()).toBe('managed');
    expect(isSelfHost()).toBe(false);
  });
});

describe('where the operating surface lives', () => {
  it('is the appliance root for self-host, the authenticated API for managed', () => {
    expect(operatingBaseUrlFor('selfhost')).toBe('');
    expect(operatingBaseUrlFor('managed')).toBe('/api');
  });
});

describe('queuePathFor', () => {
  it('asks the appliance for every configured mapping', () => {
    expect(queuePathFor('selfhost', 'deletions')).toBe('/deletions');
    expect(queuePathFor('selfhost', 'moves')).toBe('/moves');
    expect(queuePathFor('selfhost', 'failures')).toBe('/failures');
  });

  it('scopes managed to one mapping', () => {
    expect(queuePathFor('managed', 'deletions', 'm-1')).toBe('/migrations/m-1/deletions');
  });

  it('REFUSES a managed queue with no mapping, rather than defaulting', () => {
    // There is no safe default here. Falling back to "all of them" would be an
    // unbounded query; picking one would show somebody another migration's
    // deletions. Failing loudly is the only honest option.
    expect(() => queuePathFor('managed', 'deletions')).toThrow(/needs a mappingId/);
  });

  it('escapes a mapping id that would otherwise alter the path', () => {
    expect(queuePathFor('managed', 'moves', 'a/b')).toBe('/migrations/a%2Fb/moves');
    // ...and the appliance ignores the id entirely, so it cannot be smuggled in.
    expect(queuePathFor('selfhost', 'moves', '../secrets')).toBe('/moves');
  });
});

describe('verifyPathFor', () => {
  it('is the appliance root pair for self-host — one run covers every mapping', () => {
    expect(verifyPathFor('selfhost', 'start')).toBe('/verify/start');
    expect(verifyPathFor('selfhost', 'report')).toBe('/verify/report');
  });

  it('hangs off the mapping for managed, where a run is a per-mapping row', () => {
    expect(verifyPathFor('managed', 'start', 'm-1')).toBe('/migrations/m-1/verify/start');
    expect(verifyPathFor('managed', 'report', 'm-1')).toBe('/migrations/m-1/verify/report');
  });

  it('REFUSES a managed verify with no mapping — a scan is a real cost against a real target', () => {
    expect(() => verifyPathFor('managed', 'start')).toThrow(/needs a mappingId/);
    expect(() => verifyPathFor('managed', 'report')).toThrow(/needs a mappingId/);
  });

  it('escapes the id, and the appliance ignores it entirely', () => {
    expect(verifyPathFor('managed', 'start', 'a/b')).toBe('/migrations/a%2Fb/verify/start');
    expect(verifyPathFor('selfhost', 'start', '../secrets')).toBe('/verify/start');
  });
});

describe('mappingPathFor', () => {
  it('differs by edition, so the decisions reach the right server', () => {
    expect(mappingPathFor('selfhost', 'm-1')).toBe('/mappings/m-1');
    expect(mappingPathFor('managed', 'm-1')).toBe('/migrations/m-1');
  });

  it('escapes the id in both editions', () => {
    expect(mappingPathFor('selfhost', 'a/b')).toBe('/mappings/a%2Fb');
    expect(mappingPathFor('managed', 'a/b')).toBe('/migrations/a%2Fb');
  });
});
