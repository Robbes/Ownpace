// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EACH DATA TYPE'S ANNOUNCEMENT, REMEMBERED (workplan 0128 T5, slice 6).
 *
 * `latestAuditEventAt` with a `subject` reads when a data type's shares
 * carried by hand were last announced, from the presses the audit log holds:
 * a press lists the share subjects it announced, a press that lists none was
 * made for the whole migration before the waves and answers for every
 * subject, a press that announced nothing answers for none, and another
 * migration's presses are not this one's.
 *
 * PGlite as `app_user`, under row security, on the real migration chain.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { TenantId } from '@openmig/shared';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from './index.ts';
import type { LedgerDriver } from './driver.ts';

// UUID family 0128fc00-…, unused elsewhere in the repo.
const TENANT = '0128fc00-e29b-41d4-a716-446655440001' as TenantId;
const MAPPING = '0128fc00-e29b-41d4-a716-446655440002';
const OTHER = '0128fc00-e29b-41d4-a716-446655440003';

let driver: LedgerDriver;

const pressed = (detail: Record<string, unknown>) =>
  withTenant(driver, TENANT, (db) =>
    new PgLedger(db).recordAuditEvent(TENANT, {
      actor: 'owner',
      action: 'share.announce',
      entity: 'share_grant',
      detail,
    }),
  );

const lastAnnounced = (subject?: string, mappingId = MAPPING) =>
  withTenant(driver, TENANT, (db) =>
    new PgLedger(db).latestAuditEventAt(TENANT, {
      action: 'share.announce',
      mappingId,
      ...(subject !== undefined ? { subject } : {}),
    }),
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'announcements', 'active')`, [TENANT]);
  } finally {
    conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('when a data type’s shares carried by hand were last announced', () => {
  it('reads each data type from the presses that listed it, and a press made for the whole migration answers for all', async () => {
    expect(await lastAnnounced('calendar')).toBeUndefined();

    await pressed({ mappingId: MAPPING, subjects: ['calendar'] });
    const calendars = await lastAnnounced('calendar');
    expect(calendars).toBeDefined();
    expect(await lastAnnounced('drive_item')).toBeUndefined();

    // A press that announced nothing, and another migration's files.
    await pressed({ mappingId: MAPPING, subjects: [] });
    await pressed({ mappingId: OTHER, subjects: ['drive_item'] });
    expect(await lastAnnounced('calendar')).toBe(calendars);
    expect(await lastAnnounced('drive_item')).toBeUndefined();
    expect(await lastAnnounced('drive_item', OTHER)).toBeDefined();

    // The files' own wave, and then a press from before the waves.
    await pressed({ mappingId: MAPPING, subjects: ['drive_item', 'calendar'] });
    const both = await lastAnnounced('drive_item');
    expect(both).toBeDefined();
    expect(await lastAnnounced('calendar')).toBe(both);

    await pressed({ mappingId: MAPPING });
    const whole = await lastAnnounced();
    expect(whole! > both!).toBe(true);
    expect([await lastAnnounced('calendar'), await lastAnnounced('drive_item'), await lastAnnounced('mailbox')]).toEqual([
      whole,
      whole,
      whole,
    ]);
  });
});
