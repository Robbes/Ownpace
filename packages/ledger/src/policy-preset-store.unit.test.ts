// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Standing answers, against a real database (workplan 0028 T5).
 *
 * PGlite with the real migrations applied, like the decision store's suite —
 * the properties worth testing here are database properties: that `ask` is
 * what a missing row means, that setting twice updates rather than shadows,
 * and that an auto-resolution cannot overwrite an answer a person gave.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asTenantId } from '@openmig/shared';
import { createPgliteDb } from './pglite-driver';
import { runMigrations } from './migrate';
import { PgPolicyPresetStore } from './policy-preset-store';
import { PgDecisionStore } from './decision-store';
import type { PgDatabase } from './db';
import type { LedgerDriver } from './driver';

const TENANT = asTenantId('5a4c0000-e29b-41d4-a716-446655442901');
const OTHER = asTenantId('5a4c0000-e29b-41d4-a716-446655442902');

let db: PgDatabase;
let driver: LedgerDriver;
let close: () => Promise<void>;
let presets: PgPolicyPresetStore;
let decisions: PgDecisionStore;

beforeAll(async () => {
  ({ db, driver, close } = await createPgliteDb());
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'presets')`, [TENANT]);
    await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'other')`, [OTHER]);
  } finally {
    conn.release();
  }
  presets = new PgPolicyPresetStore(db);
  decisions = new PgDecisionStore(db);
}, 120_000);

afterAll(async () => {
  await close?.();
});

describe('the default', () => {
  it('is ASK when nothing was ever set', async () => {
    // The direction matters: a tenant that never expressed a preference must
    // be asked, not quietly auto-answered by somebody else's default.
    expect(await presets.get(TENANT, 'new_mailbox')).toBe('ask');
  });

  it('lists nothing for a tenant with no preferences', async () => {
    expect(await presets.list(TENANT)).toEqual([]);
  });
});

describe('setting a preset', () => {
  it('stores and reads back', async () => {
    await presets.set(TENANT, 'new_mailbox', 'auto');
    expect(await presets.get(TENANT, 'new_mailbox')).toBe('auto');
  });

  it('UPDATES on a second set rather than shadowing the first', async () => {
    await presets.set(TENANT, 'new_mailbox', 'auto');
    await presets.set(TENANT, 'new_mailbox', 'ask');
    expect(await presets.get(TENANT, 'new_mailbox')).toBe('ask');
    // One row, not two — a second row would silently shadow the first and
    // which one won would depend on read order.
    const all = await presets.list(TENANT);
    expect(all.filter((p) => p.category === 'new_mailbox')).toHaveLength(1);
  });

  it('keeps categories independent', async () => {
    await presets.set(TENANT, 'new_mailbox', 'auto');
    await presets.set(TENANT, 'shared_address_pattern', 'ask');
    expect(await presets.get(TENANT, 'new_mailbox')).toBe('auto');
    expect(await presets.get(TENANT, 'shared_address_pattern')).toBe('ask');
  });

  it('keeps tenants independent', async () => {
    await presets.set(TENANT, 'new_mailbox', 'auto');
    // One tenant's standing answer must never speak for another's.
    expect(await presets.get(OTHER, 'new_mailbox')).toBe('ask');
  });
});

describe('auto-resolution', () => {
  it('closes as auto_resolved, not resolved', async () => {
    const { decision } = await decisions.raise({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'auto@presets.local',
      summary: 'noticed',
    });

    const closed = await decisions.autoResolve(TENANT, decision.id, { closedBy: 'policy_preset' });

    // The history has to show whether a person decided this or a standing
    // rule did; `resolved` would claim a human agreed to it.
    expect(closed?.status).toBe('auto_resolved');
    expect(closed?.resolvedBy).toBe('policy-preset');
    expect(closed?.resolution).toMatchObject({ closedBy: 'policy_preset' });
  });

  it('cannot overwrite an answer a PERSON already gave', async () => {
    const { decision } = await decisions.raise({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'answered@presets.local',
      summary: 'noticed',
    });
    await decisions.resolve(TENANT, decision.id, { choice: 'create a mapping' }, 'rob@acme.nl');

    const second = await decisions.autoResolve(TENANT, decision.id, { closedBy: 'policy_preset' });

    // The conditional UPDATE only touches PENDING rows. A preset introduced
    // later must not rewrite history somebody already made.
    expect(second).toBeUndefined();
    const [row] = await decisions.list(TENANT, { status: 'resolved' });
    expect(row?.resolvedBy).toBe('rob@acme.nl');
  });

  it('re-raising an auto-resolved subject is allowed', async () => {
    // Only the OPEN question is unique. A mailbox auto-answered in January
    // and seen again in June is a fresh occurrence, and the detector's
    // convergence depends on being able to say so.
    const first = await decisions.raise({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'again@presets.local',
      summary: 'noticed',
    });
    await decisions.autoResolve(TENANT, first.decision.id, { closedBy: 'policy_preset' });

    const second = await decisions.raise({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'again@presets.local',
      summary: 'noticed again',
    });
    expect(second.created).toBe(true);
    expect(second.decision.id).not.toBe(first.decision.id);
  });
});
