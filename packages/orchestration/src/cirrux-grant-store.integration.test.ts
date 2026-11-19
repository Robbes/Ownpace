// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE REFRESH AT A TIME PER CIRRUX ACCOUNT, ACROSS PROCESSES (workplan 0160 T5;
 * ADR-0052, decision 1), against a real Postgres.
 *
 * Cirrux retires a refresh token the moment it is used and signs the person
 * out when a retired one is presented again. Two runs on one account — a pass
 * in the worker and a Test in the API, or two passes — each hold their own
 * database connection, so the only thing between them is the row lock the
 * refresh takes before it reads the token (`SELECT … FOR UPDATE`). PGlite has
 * one session and cannot show that; this does, with two pools, as two
 * processes would have:
 *
 * - two rotations of one row, started together, SERIALISE: the second is
 *   handed the token the first stored, never the one the first spent;
 * - two token providers on two pools, against a token endpoint as strict as
 *   Cirrux's, both get an access token and nobody is signed out.
 *
 * Remove the lock and the first test reads one token twice.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { SecretStore, initSecretStore } from '@openmig/core/secret-store';
import { CIRRUX_DRIVE_GRANT_KEY } from '@openmig/shared';
import { CirruxTokenProvider } from '@openmig/connectors';
import { FakeCirrux } from '../../connectors/src/__testing__/cirrux-fake.ts';
import { PgCirruxGrantStore } from './cirrux-grant-store.ts';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

// UUID family 01600db0-…, unused elsewhere in the repo.
const TENANT = '01600db0-e29b-41d4-a716-446655440001';
const CIRRUX = '01600db0-e29b-41d4-a716-446655440011';

describe('two processes, one Cirrux account', () => {
  let worker: Pool;
  let api: Pool;

  const seal = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);
  const grantIs = async (token: string) => {
    await worker.query('UPDATE connection SET secret_ref = $1 WHERE id = $2', [
      seal({ username: 'anna@example.com', password: 'app', [CIRRUX_DRIVE_GRANT_KEY]: token }),
      CIRRUX,
    ]);
  };
  const storedGrant = async () => {
    const r = await worker.query('SELECT secret_ref FROM connection WHERE id = $1', [CIRRUX]);
    return SecretStore.decryptCredentials(String(r.rows[0].secret_ref))[CIRRUX_DRIVE_GRANT_KEY];
  };

  beforeAll(async () => {
    process.env.SECRET_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    initSecretStore();
    worker = new Pool({ connectionString: TEST_DATABASE_URL });
    api = new Pool({ connectionString: TEST_DATABASE_URL });
    await worker.query('INSERT INTO tenant (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [TENANT, 'cirrux-lock']);
    await worker.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'target', 'cirrux', 'Cirrux', '{}'::jsonb, 'connected')
       ON CONFLICT (id) DO NOTHING`,
      [CIRRUX, TENANT],
    );
  });

  afterAll(async () => {
    await worker.query('DELETE FROM connection WHERE id = $1', [CIRRUX]);
    await worker.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
    await worker.end();
    await api.end();
  });

  it('serialises two rotations of one row: the second is handed what the first stored', async () => {
    await grantIs('rt-0');
    const seen: string[] = [];
    const rotateOn = (pool: Pool, successor: string) =>
      new PgCirruxGrantStore({ pool, tenantId: TENANT, connectionId: CIRRUX }).rotate(async (token) => {
        seen.push(token);
        // Long enough that, without the lock, both would have read before
        // either wrote.
        await new Promise((r) => setTimeout(r, 300));
        return { kind: 'rotated', refreshToken: successor, value: token };
      });
    const started = Date.now();
    const [first, second] = await Promise.all([rotateOn(worker, 'rt-A'), rotateOn(api, 'rt-B')]);
    const took = Date.now() - started;

    expect(seen).toHaveLength(2);
    expect(new Set(seen).size, `one token was handed to both: ${seen.join(', ')}`).toBe(2);
    expect(seen[0]).toBe('rt-0');
    // The second rotation read the first's successor, whichever ran first.
    expect(['rt-A', 'rt-B']).toContain(seen[1]);
    expect([first, second].sort()).toEqual([...seen].sort());
    expect(took).toBeGreaterThanOrEqual(550);
    expect(['rt-A', 'rt-B']).toContain(await storedGrant());
  });

  it('two token providers on two pools: both get a token, Cirrux sees each refresh token once', async () => {
    await grantIs('rt-start');
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    cirrux.tokenDelayMs = 200;
    const providerOn = (pool: Pool) =>
      new CirruxTokenProvider({
        clientId: 'test-client',
        store: new PgCirruxGrantStore({ pool, tenantId: TENANT, connectionId: CIRRUX }),
        fetchImpl: cirrux.fetch,
      });
    const [a, b] = await Promise.all([providerOn(worker).getAccessToken(), providerOn(api).getAccessToken()]);
    expect(a).toMatch(/^at-/);
    expect(b).toMatch(/^at-/);
    expect(cirrux.signedOut).toBe(false);
    expect(new Set(cirrux.presented).size).toBe(2);
    expect(await storedGrant()).toBe(cirrux.liveRefresh);
  });
});
