// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The decision queue's plumbing (workplan 0028 T1) — the `decision` table's
 * first reader/writer, against a real database (PGlite, migrations applied).
 *
 * What is pinned: raising is idempotent AT THE DATABASE while the question is
 * open (same subject → the same pending row back, no duplicate); an answered
 * question is never overwritten (the second answer gets undefined, not a
 * quiet win); and a resolved or dismissed subject may legitimately be asked
 * again — only the OPEN question is unique, history accumulates.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asTenantId, asMappingId } from '@openmig/shared';
import { createPgliteDb } from './pglite-driver';
import { runMigrations } from './migrate';
import { PgDecisionStore } from './decision-store';
import type { PgDatabase } from './db';
import type { LedgerDriver } from './driver';

const TENANT = asTenantId('5a4b0000-e29b-41d4-a716-446655442801');
const CONN = '5a4b0000-e29b-41d4-a716-446655442811';
const SRC = '5a4b0000-e29b-41d4-a716-446655442812';
const DST = '5a4b0000-e29b-41d4-a716-446655442813';
const MAPPING = asMappingId('5a4b0000-e29b-41d4-a716-446655442814');

let db: PgDatabase;
let driver: LedgerDriver;
let close: () => Promise<void>;
let store: PgDecisionStore;

beforeAll(async () => {
  ({ db, driver, close } = await createPgliteDb());
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'decision-store')`, [TENANT]);
    await conn.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
      [CONN, TENANT],
    );
    for (const [id, addr] of [
      [SRC, 'src@decisions.local'],
      [DST, 'dst@decisions.local'],
    ]) {
      await conn.query(
        `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
         VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
        [id, TENANT, CONN, addr],
      );
    }
    await conn.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
       VALUES ($1,$2,$3,$4,'mirror','active')`,
      [MAPPING, TENANT, SRC, DST],
    );
  } finally {
    conn.release();
  }
  store = new PgDecisionStore(db);
}, 120_000);

afterAll(async () => {
  await close?.();
});

describe('raising', () => {
  it('creates a pending decision, and re-raising the open question returns THAT row', async () => {
    const first = await store.raise({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'nieuw@acme.nl',
      summary: 'A mailbox appeared on the source that no mapping covers: nieuw@acme.nl',
      detail: { address: 'nieuw@acme.nl' },
      proposedDefault: 'create a mapping',
    });
    expect(first.created).toBe(true);
    expect(first.decision.status).toBe('pending');
    expect(first.decision.subjectKey).toBe('nieuw@acme.nl');

    // The detector re-runs (rule 1). Same subject, same open question.
    const again = await store.raise({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'nieuw@acme.nl',
      summary: 'A mailbox appeared on the source that no mapping covers: nieuw@acme.nl',
    });
    expect(again.created).toBe(false);
    expect(again.decision.id).toBe(first.decision.id);

    const pending = await store.list(TENANT, { status: 'pending' });
    expect(pending.filter((d) => d.subjectKey === 'nieuw@acme.nl')).toHaveLength(1);
  });

  it('a different subject is a different question', async () => {
    const other = await store.raise({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'tweede@acme.nl',
      summary: 'A mailbox appeared on the source that no mapping covers: tweede@acme.nl',
    });
    expect(other.created).toBe(true);
  });

  it('carries the mapping when the drift belongs to one', async () => {
    const scoped = await store.raise({
      tenantId: TENANT,
      mappingId: MAPPING,
      category: 'shared_address_pattern',
      subjectKey: 'group:sales@acme.nl',
      summary: 'sales@acme.nl has a store but looks jointly handled — S or D?',
    });
    expect(scoped.decision.mappingId).toBe(MAPPING);

    const forMapping = await store.list(TENANT, { mappingId: MAPPING });
    expect(forMapping.map((d) => d.subjectKey)).toContain('group:sales@acme.nl');
    expect(forMapping.every((d) => d.mappingId === MAPPING)).toBe(true);
  });
});

describe('answering', () => {
  it('resolve records the answer once; a second answer gets undefined, not a quiet win', async () => {
    const { decision } = await store.raise({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'derde@acme.nl',
      summary: 'A mailbox appeared: derde@acme.nl',
    });

    const resolved = await store.resolve(
      TENANT,
      decision.id,
      { action: 'create_mapping' },
      'user-owner',
    );
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolution).toEqual({ action: 'create_mapping' });
    expect(resolved?.resolvedBy).toBe('user-owner');
    expect(resolved?.resolvedAt).toBeDefined();

    const second = await store.resolve(TENANT, decision.id, { action: 'ignore' }, 'user-admin');
    expect(second).toBeUndefined();
    // The first answer survives untouched.
    const all = await store.list(TENANT);
    const row = all.find((d) => d.id === decision.id);
    expect(row?.resolution).toEqual({ action: 'create_mapping' });
    expect(row?.resolvedBy).toBe('user-owner');
  });

  it('an unknown id resolves to undefined', async () => {
    const nothing = await store.resolve(
      TENANT,
      '5a4b0000-e29b-41d4-a716-446655449999',
      { action: 'x' },
      'user-owner',
    );
    expect(nothing).toBeUndefined();
  });

  it('a dismissed subject may be asked again — only the OPEN question is unique', async () => {
    const { decision } = await store.raise({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'vierde@acme.nl',
      summary: 'A mailbox appeared: vierde@acme.nl',
    });
    const dismissed = await store.dismiss(TENANT, decision.id, 'user-owner');
    expect(dismissed?.status).toBe('dismissed');

    // The mailbox was deleted and re-created — the question is legitimately new.
    const reraised = await store.raise({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'vierde@acme.nl',
      summary: 'A mailbox appeared: vierde@acme.nl',
    });
    expect(reraised.created).toBe(true);
    expect(reraised.decision.id).not.toBe(decision.id);
  });
});

describe('listing', () => {
  it('filters by status and answers newest first', async () => {
    const pending = await store.list(TENANT, { status: 'pending' });
    expect(pending.every((d) => d.status === 'pending')).toBe(true);
    expect(pending.length).toBeGreaterThan(0);

    const everything = await store.list(TENANT);
    expect(everything.length).toBeGreaterThan(pending.length);
    const times = everything.map((d) => new Date(d.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
