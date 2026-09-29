// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARING RESCAN THAT OUTLIVES ITS MIGRATION LEAVES NO LIST BEHIND (workplan
 * 0139 T6; privacy §4.6 and §9, the owner's privacy-sharing-list (b)), through
 * the real Express app on Postgres, as `app_user`.
 *
 * Deleting a migration deletes its sharing list, `share_grant`, in the
 * delete's own transaction. `share_grant.mapping_id` has no foreign key
 * (migration 0016), so that delete takes only the rows that exist when it
 * runs. `POST /api/migrations/:mappingId/sharing/rescan` checks the migration,
 * scans the source for seconds or minutes, and then writes the list. The review
 * of 2026-09-29 found the door: a delete that lands in between leaves the
 * rescan's rows naming a migration that is gone, until the organisation's
 * erasure. Two orders, each needing two connections at once, which PGlite (one
 * connection) cannot give:
 *
 *   - the delete commits while the rescan scans: the rescan writes nothing and
 *     answers 404, as for any migration that is not there;
 *   - the delete arrives while a list is being written: it waits for that list
 *     to commit (the writer holds the migration's row, `FOR KEY SHARE`), then
 *     sees it and takes it.
 *
 * And the control: with nothing in the way, the same stubbed scan does write
 * its rows, so an empty list above is the delete's work and not a scan that
 * found nothing. The ledger's half, a list refused for a migration that is not
 * there, is `a-sharing-list-needs-its-migration.unit.test.ts`.
 *
 * Only the scans are stubbed (no provider is reached); everything else is the
 * app's own code. Handed its database: the app reads `APP_DATABASE_URL`,
 * derived from `TEST_DATABASE_URL`. The names and addresses are invented.
 *
 * UUID family: 0139c800-e29b-41d4-a716-4466554400xx.
 * Runs against Postgres (pnpm test:integration, or scripts/local-pg.sh).
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { PgLedger, withTenant } from '@openmig/ledger';
import { asMappingId, asTenantId, type PermissionGrant } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}
const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = appUserUrl(PG_CONNECTION_STRING);

/** What the stubbed drive scan does before it answers, set per case. */
const scan = vi.hoisted(() => ({ meanwhile: undefined as undefined | (() => Promise<void>) }));

/** Two grants the drive scan finds. */
const FOUND: readonly PermissionGrant[] = [1, 2].map((n) => ({
  subject: 'drive_item' as const,
  on: `Holiday photos ${n}`,
  grantee: `friend-${n}@example.invalid`,
  role: 'writer',
  raw: `{"grant": ${n}}`,
}));

vi.mock('../permissions.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../permissions.ts')>();
  return {
    ...actual,
    tenantInventoryScans: async () => ({
      delegationReason: 'Mailbox delegation is not read here.',
      scanCalendars: async () => ({ kind: 'not_discoverable' as const, reason: 'Calendars are not read here.' }),
      scanDrive: async () => {
        await scan.meanwhile?.();
        return { kind: 'listed' as const, grants: FOUND };
      },
    }),
  };
});

const { default: app } = await import('../../index.ts');
const { seedMembership } = await import('../../__tests__/seed-membership.ts');

const TENANT = '0139c800-e29b-41d4-a716-446655440001';
const SOURCE = '0139c800-e29b-41d4-a716-446655440011';
const MAILBOX = '0139c800-e29b-41d4-a716-446655440012';
/** Rescanned with nothing in the way: the control. */
const KEPT = '0139c800-e29b-41d4-a716-446655440021';
/** Deleted while the rescan scans. */
const DELETED_DURING_THE_SCAN = '0139c800-e29b-41d4-a716-446655440022';
/** Deleted while its list is being written. */
const DELETED_DURING_THE_WRITE = '0139c800-e29b-41d4-a716-446655440023';
const MAPPINGS = [KEPT, DELETED_DURING_THE_SCAN, DELETED_DURING_THE_WRITE];

const USER = `user-${TENANT}`;
const token = () => jwt.sign({ sub: USER, tenantId: TENANT, email: `${USER}@example.test` }, process.env.JWT_SECRET!);

describe('a sharing rescan that outlives its migration leaves no list behind', () => {
  /** The owner, for the fixture and for reading past row security. */
  let owner: Pool;
  /** `app_user`, for the list written in a transaction this file holds open. */
  let appUser: Pool;
  let request: ReturnType<typeof supertest>;

  const rescan = (mappingId: string) =>
    request.post(`/api/migrations/${mappingId}/sharing/rescan`).set({ Authorization: `Bearer ${token()}` }).send({});
  const remove = (mappingId: string) =>
    request.delete(`/api/migrations/${mappingId}`).set({ Authorization: `Bearer ${token()}` });
  const listOf = async (mappingId: string) =>
    (
      await owner.query<{ grant_hash: string }>('SELECT grant_hash FROM share_grant WHERE mapping_id = $1', [mappingId])
    ).rows;
  const exists = async (mappingId: string) =>
    (await owner.query('SELECT 1 FROM mailbox_mapping WHERE id = $1', [mappingId])).rowCount === 1;

  async function cleanUp(): Promise<void> {
    for (const table of ['share_grant', 'mailbox_mapping', 'mailbox', 'connection', 'tenant_member']) {
      await owner.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT]);
    }
    await owner.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
  }

  beforeAll(async () => {
    owner = new Pool({ connectionString: PG_CONNECTION_STRING });
    appUser = new Pool({ connectionString: appUserUrl(PG_CONNECTION_STRING!) });
    await cleanUp();
    await owner.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Rescan', 'active')`, [TENANT]);
    await seedMembership(owner, TENANT, USER);
    await owner.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'google', 'Example Google', '{}'::jsonb, 'connected')`,
      [SOURCE, TENANT],
    );
    await owner.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
       VALUES ($1, $2, $3, 'pat', 'pat@example.invalid')`,
      [MAILBOX, TENANT, SOURCE],
    );
    request = supertest(app);
  }, 60_000);

  beforeEach(async () => {
    scan.meanwhile = undefined;
    await owner.query('DELETE FROM share_grant WHERE tenant_id = $1', [TENANT]);
    await owner.query('DELETE FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]);
    for (const id of MAPPINGS) {
      await owner.query(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'active')`,
        [id, TENANT, MAILBOX],
      );
    }
  });

  afterAll(async () => {
    await cleanUp();
    await appUser.end();
    await owner.end();
  });

  it('writes the list when nothing is in the way (the control: the scan does find two rows)', async () => {
    const res = await rescan(KEPT);
    expect(res.status, res.text).toBe(200);
    expect(await listOf(KEPT)).toHaveLength(2);
  });

  it('writes nothing, and answers 404, when the migration is deleted while the rescan scans', async () => {
    let deleted: number | undefined;
    scan.meanwhile = async () => {
      deleted = (await remove(DELETED_DURING_THE_SCAN)).status;
    };

    const res = await rescan(DELETED_DURING_THE_SCAN);

    expect(deleted, 'the delete did not go through while the rescan scanned').toBe(200);
    expect(await exists(DELETED_DURING_THE_SCAN)).toBe(false);
    expect(
      await listOf(DELETED_DURING_THE_SCAN),
      'the rescan wrote a list for a migration deleted while it scanned; no delete will ever take it',
    ).toEqual([]);
    expect(res.status, res.text).toBe(404);
    expect(res.body).toEqual({ error: 'Not found', message: 'Mapping not found' });
    // The other migrations are untouched.
    expect(await exists(KEPT)).toBe(true);
  });

  it('takes a list that was being written when the delete arrived, once it is committed', async () => {
    let deleting: Promise<supertest.Response> | undefined;
    let settled = false;
    let waited = false;
    await withTenant(appUser, TENANT, async (db) => {
      // The rescan's last step, as the route takes it: the list, written in a
      // transaction that is still open when the delete arrives.
      await new PgLedger(db).upsertShareGrants(
        asTenantId(TENANT as never),
        asMappingId(DELETED_DURING_THE_WRITE as never),
        FOUND.map((g, i) => ({
          grantHash: `written-${i + 1}`,
          subject: g.subject,
          onLabel: g.on,
          ...(g.grantee ? { grantee: g.grantee } : {}),
          role: g.role,
          viaLink: false,
          raw: g.raw,
          verdict: 'clean' as const,
          verdictTarget: 'jmap',
        })),
      );
      deleting = remove(DELETED_DURING_THE_WRITE).then((r) => {
        settled = true;
        return r;
      });
      // Until the delete either finished or waits on a lock (the migration's
      // row, held by the writer). Ten seconds at most.
      for (let i = 0; i < 200 && !settled; i += 1) {
        const waiting = await owner.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%mailbox_mapping%'`,
        );
        if (waiting.rows[0]!.n > 0) {
          waited = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(
        settled,
        'the delete went through while the list was still being written, so it could not see it',
      ).toBe(false);
      expect(waited, "the delete did not wait for the migration's row the list's writer holds").toBe(true);
    }).catch((error: unknown) => {
      // Let the delete finish before the case fails, so no request outlives it.
      return (deleting ?? Promise.resolve()).then(() => {
        throw error;
      });
    });

    const res = await deleting!;
    expect(res.status, res.text).toBe(200);
    expect(await exists(DELETED_DURING_THE_WRITE)).toBe(false);
    expect(
      await listOf(DELETED_DURING_THE_WRITE),
      'the list committed after the delete ran, and stays for a migration that is gone',
    ).toEqual([]);
  });
});
