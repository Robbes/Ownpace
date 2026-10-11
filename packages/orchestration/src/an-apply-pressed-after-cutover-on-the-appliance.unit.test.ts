// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN APPLY PRESSED AFTER CUTOVER, ON THE APPLIANCE (2026-10-05).
 *
 * The appliance's two destructive routes go through `applyMappingDeletion`
 * and `applyMappingRelocation`, which find the data type that holds the item
 * and hand it to core. Core refuses after cutover (`after_cutover`), but only
 * with the question it is handed: these two are where the appliance hands it
 * the data type's phase, read fresh from the one reader every gate asks
 * (`readPathPhases`) at the moment of the press.
 *
 * The owner, 2026-10-05, asked *"should pressing Apply on a deletion or move
 * that was queued before cutover be refused?"*: **"Refuse after cutover
 * (Recommended)"**.
 *
 * Against a real ledger (PGlite, every migration), with the migration's own
 * row moved between the presses the way execute and a rollback move it. Each
 * item is one a later gate refuses too (adopted bytes; a move already kept),
 * so the press never reaches a target, and which refusal answers says where
 * the phase is asked: before cutover the later gate's, after it this one's.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createPgliteDb,
  readPathPhases,
  runMigrations,
  withTenant,
  type LedgerDriver,
  type PgDatabase,
} from '@openmig/ledger';
import { parseMappingConfig } from '@openmig/shared';
import { applyMappingDeletion, applyMappingRelocation } from './orchestration.ts';

const TENANT = '00000000-0000-4000-8000-000000001005';
const CONN = '00000000-0000-4000-8000-000000001006';
const SRC = '00000000-0000-4000-8000-000000001007';
const TGT = '00000000-0000-4000-8000-000000001008';
const MAPPING = '11111111-1111-4111-8111-111111111005';
const PASSWORD_ENV = 'A_PASSWORD_FOR_THE_APPLY_AFTER_CUTOVER_TEST';

const EVENT = 'e'.repeat(64);
const OLD_FILE = 'f'.repeat(64);
const NEW_FILE = '0'.repeat(64);

const dav = (type: 'caldav' | 'webdav', url: string) => ({
  type,
  url,
  user: 'someone',
  auth: { kind: 'login', passwordFromEnv: PASSWORD_ENV },
});

const config = () =>
  parseMappingConfig({
    tenantId: TENANT,
    mappingId: MAPPING,
    source: dav('caldav', 'https://cloud.example.invalid/remote.php/dav'),
    target: dav('caldav', 'https://cloud.example.invalid/remote.php/dav'),
    // On: the case in which anything is removed at all.
    allowApplyDeletions: true,
    domains: {
      calendar: {
        enabled: true,
        source: dav('caldav', 'https://cloud.example.invalid/remote.php/dav'),
        target: dav('caldav', 'https://cloud.example.invalid/remote.php/dav'),
      },
      files: {
        enabled: true,
        source: dav('webdav', 'https://cloud.example.invalid/remote.php/dav/files/someone/'),
        target: dav('webdav', 'https://cloud.example.invalid/remote.php/dav/files/someone/'),
      },
    },
  });

let driver: LedgerDriver;
let ledgerDb: PgDatabase;

/** The reader the appliance hands in: this migration's phases, read when asked. */
const phasesNow = () => withTenant(driver, TENANT, (tdb) => readPathPhases(tdb, TENANT, MAPPING));

const setStatus = (status: string) =>
  withTenant(driver, TENANT, (tdb) =>
    tdb.execute(`UPDATE mailbox_mapping SET status = '${status}' WHERE id = '${MAPPING}'`),
  );

beforeAll(async () => {
  process.env[PASSWORD_ENV] = 'not-a-real-password';
  const made = await createPgliteDb({});
  driver = made.driver;
  ledgerDb = made.db;
  await runMigrations({ driver, logger: () => {} });
  await withTenant(driver, TENANT, async (tdb) => {
    await tdb.execute(`INSERT INTO tenant (id, name, status, settings) VALUES ('${TENANT}', 'Apply after cutover', 'active', '{}')`);
    await tdb.execute(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ('${CONN}', '${TENANT}', 'source', 'caldav', 'src', '{}', 'connected')`,
    );
    await tdb.execute(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, status)
       VALUES ('${SRC}', '${TENANT}', '${CONN}', 'user', 'active'), ('${TGT}', '${TENANT}', '${CONN}', 'user', 'active')`,
    );
    await tdb.execute(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
       VALUES ('${MAPPING}', '${TENANT}', '${SRC}', '${TGT}', 'mirror', 'active')`,
    );
    // An event the leaver binned at the old system, whose copy on the target
    // was already there when we arrived (adopted): gate 4 refuses it too.
    await tdb.execute(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status,
                         content_hash, target_ref, deletion_trashed_at)
       VALUES ('${TENANT}', '${MAPPING}', 'calendar', 'Personal', 'ev', '${EVENT}', 'adopted', 'h-ev',
               jsonb_build_object('id', 't-ev'), now())`,
    );
    // A file renamed at the old system, whose move the owner already answered
    // with keep: the relocation gate refuses it too (`already_kept`).
    await tdb.execute(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status,
                         content_hash, target_ref, moved_to_collection, moved_to_natural_key_hash, move_acknowledged_at)
       VALUES ('${TENANT}', '${MAPPING}', 'file', '/docs', '/docs/report.pdf', '${OLD_FILE}', 'copied', 'h-pair',
               jsonb_build_object('id', 't-old'), '/docs', '${NEW_FILE}', now()),
              ('${TENANT}', '${MAPPING}', 'file', '/docs', '/docs/summary.pdf', '${NEW_FILE}', 'copied', 'h-pair',
               jsonb_build_object('id', 't-new'), NULL, NULL, NULL)`,
    );
  });
}, 120_000);

afterAll(async () => {
  delete process.env[PASSWORD_ENV];
  await driver?.end();
});

const refusalOf = (outcome: Awaited<ReturnType<typeof applyMappingDeletion>>) =>
  outcome.ok ? 'removed' : outcome.code;

describe("the appliance's apply, after cutover", () => {
  it('before cutover, the press reaches the gates after the phase', async () => {
    await setStatus('active');
    expect(refusalOf(await applyMappingDeletion(config(), EVENT, { ledgerDb }, phasesNow))).toBe('not_ours');
    expect(refusalOf(await applyMappingRelocation(config(), OLD_FILE, { ledgerDb }, phasesNow))).toBe('already_kept');
  });

  for (const status of ['cutover', 'continuous', 'done']) {
    it(`in '${status}', the same presses are refused as after_cutover, with the phase read at the press`, async () => {
      await setStatus(status);
      expect(refusalOf(await applyMappingDeletion(config(), EVENT, { ledgerDb }, phasesNow))).toBe('after_cutover');
      expect(refusalOf(await applyMappingRelocation(config(), OLD_FILE, { ledgerDb }, phasesNow))).toBe(
        'after_cutover',
      );
    });
  }

  it('after a rollback the old system decides again, and the press reaches the later gates once more', async () => {
    await setStatus('continuous');
    expect(refusalOf(await applyMappingDeletion(config(), EVENT, { ledgerDb }, phasesNow))).toBe('after_cutover');
    // ADR-0047: a rollback puts the migration back to `active`.
    await setStatus('active');
    expect(refusalOf(await applyMappingDeletion(config(), EVENT, { ledgerDb }, phasesNow))).toBe('not_ours');
    expect(refusalOf(await applyMappingRelocation(config(), OLD_FILE, { ledgerDb }, phasesNow))).toBe('already_kept');
  });
});
