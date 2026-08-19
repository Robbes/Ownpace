// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/** The /version endpoints' data source: env wins, package.json answers otherwise. */
import { describe, it, expect, afterEach } from 'vitest';
import { buildIdentity } from './build-identity.ts';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('buildIdentity', () => {
  it('prefers the stamped env values', () => {
    process.env.OPENMIG_VERSION = '9.9.9-test';
    process.env.OPENMIG_COMMIT = 'abc123def456';
    expect(buildIdentity()).toEqual({ version: '9.9.9-test', commit: 'abc123def456' });
  });

  it('falls back to the monorepo root version and an honest unknown commit', () => {
    delete process.env.OPENMIG_VERSION;
    delete process.env.OPENMIG_COMMIT;
    const id = buildIdentity();
    // The root package.json version, whatever it currently is — never the
    // workspace packages' 0.0.0 placeholder, never empty.
    expect(id.version).not.toBe('');
    expect(id.version).not.toBe('0.0.0');
    expect(id.commit).toBe('unknown');
  });
});
