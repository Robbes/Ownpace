// Copyright 2026 The Ownpace authors (Apache-2.0)
/** The /version endpoints' data source: env wins, package.json answers otherwise. */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildIdentity } from './build-identity.ts';

// Counted, not replaced: every read still reaches the real file.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

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

  // PERF-1 (workplan 0006 L): `GET /version` answers from here on every
  // request, so the file is read once per process, not once per answer.
  it('reads package.json once, however often it is asked, and the env still wins on each call', async () => {
    delete process.env.OPENMIG_VERSION;
    delete process.env.OPENMIG_COMMIT;
    vi.resetModules();
    const fs = await import('node:fs');
    const { buildIdentity: fresh } = await import('./build-identity.ts');
    const reads = vi.mocked(fs.readFileSync);
    reads.mockClear();

    const first = fresh();
    const answers = [fresh(), fresh(), fresh()];
    expect(answers).toEqual([first, first, first]);
    expect(first.version).not.toBe('0.0.0');
    expect(reads).toHaveBeenCalledTimes(1);

    process.env.OPENMIG_VERSION = '9.9.9-test';
    expect(fresh().version).toBe('9.9.9-test');
    delete process.env.OPENMIG_VERSION;
    expect(fresh().version).toBe(first.version);
    expect(reads).toHaveBeenCalledTimes(1);
  });
});
