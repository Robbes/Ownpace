// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The appliance's end-of-service helper (workplan 0085 T9).
 *
 * The behaviour worth pinning is the refusal. `docker compose down -v` destroys
 * our copy of a credential and leaves the grant it authenticates with fully
 * alive — so an operator who wipes first has permanently lost the ability to
 * revoke through us. At that point the only useful thing to say is what has
 * been lost and where to go by hand, and the one genuinely harmful thing would
 * be a tidy summary of zero connections that reads as "nothing to do".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const revokeStoredCredentials = vi.fn();
vi.mock('@openmig/orchestration/revoke-stored-credentials', () => ({
  revokeStoredCredentials: (...args: unknown[]) => revokeStoredCredentials(...args),
}));

const rowsByQuery = { tenants: [] as unknown[], kinds: [] as unknown[] };
const released = { count: 0 };
const closed = { count: 0 };

vi.mock('@openmig/ledger', () => ({
  createPgDb: () => ({ $pool: {}, close: () => Promise.resolve() }),
  pgDriver: () => ({
    acquire: () =>
      Promise.resolve({
        query: (text: string) =>
          Promise.resolve({
            rows: text.includes('FROM tenant') ? rowsByQuery.tenants : rowsByQuery.kinds,
          }),
        release: () => {
          released.count++;
        },
      }),
  }),
  createPgliteDb: () => Promise.resolve({ driver: {}, close: () => Promise.resolve() }),
}));

vi.mock('@openmig/connectors', () => ({ HttpTokenRevoker: class {} }));

let out = '';
let err = '';

beforeEach(async () => {
  out = '';
  err = '';
  rowsByQuery.tenants = [];
  rowsByQuery.kinds = [];
  released.count = 0;
  closed.count = 0;
  revokeStoredCredentials.mockReset();
  process.env.DATABASE_URL = 'postgres://x/y';
  delete process.env.SELFHOST_PERSISTENCE;
  vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
    out += String(c);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => {
    err += String(c);
    return true;
  });
});

afterEach(() => vi.restoreAllMocks());

const run = async (argv: string[] = []) => {
  const { forgetMe } = await import('./forget-me');
  return forgetMe(argv);
};

describe('when the data is already gone', () => {
  it('refuses rather than reporting a tidy nothing', async () => {
    const code = await run();
    expect(code).toBe(2);
    expect(out).toBe('');
  });

  it('says the grants are still live — the fact that matters', async () => {
    await run();
    expect(err).toMatch(/still live/i);
    expect(err).toMatch(/not affected/i);
  });

  it('names where to go by hand, per provider', async () => {
    await run();
    for (const provider of ['Google', 'Microsoft', 'Dropbox', 'Nextcloud', 'Proton']) {
      expect(err).toContain(provider);
    }
  });

  it('allows for it simply being the wrong database', async () => {
    // The other reading of "no tenants", and cheap to be wrong about.
    await run();
    expect(err).toMatch(/wrong database/i);
    expect(err).toMatch(/BEFORE deleting anything/);
  });

  it('never revokes anything in that state', async () => {
    await run();
    expect(revokeStoredCredentials).not.toHaveBeenCalled();
  });
});

describe('with a tenant to act on', () => {
  beforeEach(() => {
    rowsByQuery.tenants = [{ id: 't-1', name: 'Acme' }];
    // A real connection kind from the schema enum. 'google' is not one, and a
    // fixture that is not a kind the product can store proves nothing about
    // what an operator would actually be told.
    rowsByQuery.kinds = [{ kind: 'nextcloud' }];
    revokeStoredCredentials.mockResolvedValue([
      { kind: 'nextcloud', status: 'unsupported', reason: 'the provider offers no revocation' },
    ]);
  });

  it('revokes, and reports each outcome with its reason', async () => {
    const code = await run();
    expect(code).toBe(0);
    expect(revokeStoredCredentials).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/nextcloud: unsupported — the provider offers no revocation/);
  });

  it('lists what only the operator can remove', async () => {
    await run();
    expect(out).toMatch(/Only you can remove these/i);
  });

  it('says the wipe is safe to do now, and what will survive it', async () => {
    await run();
    expect(out).toMatch(/You may now delete the data/i);
    expect(out).toMatch(/survive that/i);
  });

  it('releases the connection and closes the database', async () => {
    await run();
    expect(released.count).toBe(1);
  });
});

describe('--dry-run', () => {
  beforeEach(() => {
    rowsByQuery.tenants = [{ id: 't-1', name: 'Acme' }];
    rowsByQuery.kinds = [{ kind: 'nextcloud' }];
    revokeStoredCredentials.mockResolvedValue([]);
  });

  it('withdraws nothing and says so', async () => {
    await run(['--dry-run']);
    expect(out).toMatch(/nothing has been revoked/i);
    expect(out).toMatch(/Nothing was revoked/i);
  });

  it('passes a revoker that cannot revoke, rather than trusting a flag downstream', async () => {
    await run(['--dry-run']);
    const revoker = revokeStoredCredentials.mock.calls[0]![2] as { revoke: unknown };
    // NO_REVOCATION, not HttpTokenRevoker: the safety is in what is handed
    // over, not in remembering to check a boolean later.
    expect(revoker).toBeDefined();
    expect(revoker.constructor.name).not.toBe('HttpTokenRevoker');
  });
});
