// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE AUDIT EXPORT'S KEY, FOR THE OPERATOR'S DOWNLOAD (workplan 0129 T4, the
 * managed half): `audit-key.ts`.
 *
 * The key is the owner's alone, so the download reads it on the connection
 * `index.ts` hands over at start-up. What this holds: nothing is read before
 * that connection is set, and the download says so rather than making lines
 * under no key; the key is read once and kept; and a read that failed is not
 * kept, so the next download asks again rather than failing for ever.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LedgerDriver } from '@openmig/ledger';

const { deploymentKeyFor } = vi.hoisted(() => ({ deploymentKeyFor: vi.fn() }));
vi.mock('@openmig/ledger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmig/ledger')>()),
  deploymentKeyFor,
}));

const { setAuditKeyDriver, auditPseudonymKey } = await import('./audit-key.ts');

const OWNER = { acquire: vi.fn(), end: vi.fn() } as unknown as LedgerDriver;
const KEY = new Uint8Array(32).fill(3);

beforeEach(() => {
  deploymentKeyFor.mockReset();
  setAuditKeyDriver(undefined);
});

describe("the download's pseudonym key", () => {
  it('is not read before the owner’s connection is set, and says why', async () => {
    await expect(auditPseudonymKey()).rejects.toThrow(/connection is not set/);
    expect(deploymentKeyFor).not.toHaveBeenCalled();
  });

  it('is read on that connection, under the purpose the stream reads it by, once', async () => {
    deploymentKeyFor.mockResolvedValue(KEY);
    setAuditKeyDriver(OWNER);

    expect(await auditPseudonymKey()).toBe(KEY);
    expect(await auditPseudonymKey()).toBe(KEY);
    expect(deploymentKeyFor.mock.calls).toEqual([[OWNER, 'audit-pseudonym']]);
  });

  it('is asked for again after a read that failed', async () => {
    deploymentKeyFor.mockRejectedValueOnce(new Error('connection refused')).mockResolvedValueOnce(KEY);
    setAuditKeyDriver(OWNER);

    await expect(auditPseudonymKey()).rejects.toThrow('connection refused');
    expect(await auditPseudonymKey()).toBe(KEY);
    expect(deploymentKeyFor).toHaveBeenCalledTimes(2);
  });

  it('is read afresh when the connection is set again', async () => {
    deploymentKeyFor.mockResolvedValue(KEY);
    setAuditKeyDriver(OWNER);
    await auditPseudonymKey();

    setAuditKeyDriver(OWNER);
    await auditPseudonymKey();

    expect(deploymentKeyFor).toHaveBeenCalledTimes(2);
  });
});
