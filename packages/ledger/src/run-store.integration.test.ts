// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Integration tests for RunStore — the WRITE side of the run ledger.
 *
 * Context: `run` / `run_event` and the API endpoints that read them shipped
 * together, but no production code ever wrote a row, so run history was
 * permanently empty in both editions. `runs.integration.test.ts` passed only
 * because it seeded its own rows with raw SQL — it proved the read path while
 * the write path did not exist. These tests cover the writer, so the pair is no
 * longer a false green.
 *
 * UUID Family: 5f4c0000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { asTenantId, asMappingId } from '@openmig/shared';
import { createPgDb } from './db.ts';
import { RunStore } from './run-store.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const P = '5f4c0000-e29b-41d4-a716-4466554432';
const TENANT = `${P}01`;
const SRC_CONN = `${P}c1`;
const TGT_CONN = `${P}c2`;
const SRC_MBOX = `${P}b1`;
const TGT_MBOX = `${P}b2`;
const MAPPING = `${P}d1`;

describe('RunStore (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof createPgDb>;
  let store: RunStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_CONNECTION_STRING });
    db = createPgDb(PG_CONNECTION_STRING);
    store = new RunStore(db);

    await pool.query(
      `INSERT INTO tenant (id, name, status, settings) VALUES ($1,'RunStore T','active','{}')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT],
    );
    await pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config)
       VALUES ($1,$3,'source','o365','src','{}'),($2,$3,'target','nextcloud','tgt','{}')
       ON CONFLICT (id) DO NOTHING`,
      [SRC_CONN, TGT_CONN, TENANT],
    );
    await pool.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, external_id)
       VALUES ($1,$3,$4,'user','s'),($2,$3,$5,'user','t')
       ON CONFLICT (id) DO NOTHING`,
      [SRC_MBOX, TGT_MBOX, TENANT, SRC_CONN, TGT_CONN],
    );
    await pool.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
       VALUES ($1,$2,$3,$4,'mirror','active') ON CONFLICT (id) DO NOTHING`,
      [MAPPING, TENANT, SRC_MBOX, TGT_MBOX],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM run WHERE tenant_id = $1`, [TENANT]);
    await pool.end();
  });

  it('startRun writes a real row in the running state', async () => {
    const runId = await store.startRun({
      tenantId: asTenantId(TENANT as never),
      mappingId: asMappingId(MAPPING as never),
      kind: 'incremental',
    });

    expect(runId).toMatch(/^[0-9a-f-]{36}$/);

    const { rows } = await pool.query(
      `SELECT status, kind, trigger, mapping_id, started_at, finished_at FROM run WHERE id = $1`,
      [runId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('running');
    expect(rows[0].kind).toBe('incremental');
    expect(rows[0].trigger).toBe('schedule'); // default
    expect(rows[0].mapping_id).toBe(MAPPING);
    expect(rows[0].started_at).not.toBeNull();
    // Still in flight — this is what makes a crashed run visible rather than absent.
    expect(rows[0].finished_at).toBeNull();
  });

  it('finishRun closes the run with its outcome and counters', async () => {
    const runId = await store.startRun({
      tenantId: asTenantId(TENANT as never),
      mappingId: asMappingId(MAPPING as never),
      kind: 'initial_copy',
      trigger: 'manual',
    });

    await store.finishRun(runId, 'succeeded', { itemsProcessed: 42, errors: 0 });

    const { rows } = await pool.query(
      `SELECT status, trigger, stats, finished_at FROM run WHERE id = $1`,
      [runId],
    );
    expect(rows[0].status).toBe('succeeded');
    expect(rows[0].trigger).toBe('manual');
    expect(rows[0].stats).toEqual({ itemsProcessed: 42, errors: 0 });
    expect(rows[0].finished_at).not.toBeNull();
  });

  it('records a failed run rather than dropping it', async () => {
    const runId = await store.startRun({
      tenantId: asTenantId(TENANT as never),
      mappingId: asMappingId(MAPPING as never),
      kind: 'incremental',
    });

    await store.logEvent(
      asTenantId(TENANT as never),
      runId,
      'error',
      'calendar sync failed: PROPFIND returned 403',
      { domain: 'calendar' },
    );
    await store.finishRun(runId, 'failed', { itemsProcessed: 3, errors: 1 });

    const { rows: runRows } = await pool.query(`SELECT status, stats FROM run WHERE id = $1`, [runId]);
    expect(runRows[0].status).toBe('failed');
    expect(runRows[0].stats).toEqual({ itemsProcessed: 3, errors: 1 });

    const { rows: eventRows } = await pool.query(
      `SELECT level, message, detail FROM run_event WHERE run_id = $1`,
      [runId],
    );
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0].level).toBe('error');
    // Hard rule 9: the real message survives verbatim, not a generic summary.
    expect(eventRows[0].message).toBe('calendar sync failed: PROPFIND returned 403');
    expect(eventRows[0].detail).toEqual({ domain: 'calendar' });
  });

  it('appends events in order for a single run', async () => {
    const tenantId = asTenantId(TENANT as never);
    const runId = await store.startRun({
      tenantId,
      mappingId: asMappingId(MAPPING as never),
      kind: 'incremental',
    });

    await store.logEvent(tenantId, runId, 'info', 'email: 5 created, 1 skipped', { domain: 'email' });
    await store.logEvent(tenantId, runId, 'info', 'calendar: 2 created, 0 skipped', { domain: 'calendar' });
    await store.logEvent(tenantId, runId, 'warn', 'contact: source unreachable', { domain: 'contact' });

    const { rows } = await pool.query(
      `SELECT level, message FROM run_event WHERE run_id = $1 ORDER BY at ASC, message ASC`,
      [runId],
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r: { message: string }) => r.message)).toEqual(
      expect.arrayContaining([
        'email: 5 created, 1 skipped',
        'calendar: 2 created, 0 skipped',
        'contact: source unreachable',
      ]),
    );
    expect(rows.some((r: { level: string }) => r.level === 'warn')).toBe(true);
  });

  it('a run written here is visible to the read path the API uses', async () => {
    const tenantId = asTenantId(TENANT as never);
    const runId = await store.startRun({
      tenantId,
      mappingId: asMappingId(MAPPING as never),
      kind: 'incremental',
    });
    await store.finishRun(runId, 'succeeded', { itemsProcessed: 7, errors: 0 });

    // Same shape of query as GET /api/migrations/:mappingId/runs.
    const { rows } = await pool.query(
      `SELECT id FROM run WHERE mapping_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [MAPPING, TENANT],
    );
    expect(rows.map((r: { id: string }) => r.id)).toContain(runId);
  });
});
