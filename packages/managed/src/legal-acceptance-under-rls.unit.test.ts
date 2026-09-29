// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEXT ACCEPTED WITH ITS VERSION, AND NEVER REWRITTEN (workplan 0139 T3):
 * `legal-acceptance.ts` and managed migration 0032.
 *
 * The owner, 2026-09-28: *"accepting fits in there and should record what
 * time/version the accepted of what document."* What this holds:
 *
 *  - at first a person is asked for all three texts, each at its current
 *    version; accepting writes one row per text, with the version, the
 *    language it was read in and the time, and then nothing is due;
 *  - accepting again writes nothing and keeps the first time, and a version
 *    that is not the current one is refused and writes nothing;
 *  - a text with a new number is due again, and its acceptance is a new row
 *    beside the old one, which stays;
 *  - acceptance is a person's: a colleague in the same organisation is still
 *    asked;
 *  - under row security an organisation reads only its own rows, writes rows
 *    only for itself and only naming one of its members, and nobody on the
 *    request path may change or delete a row, not even its own: no grant, and
 *    no policy;
 *  - a member who leaves keeps their record, as the organisation's, until the
 *    organisation's data is erased (review of 2026-09-29; erased with the
 *    organisation, 0139 open question 4, answered 2026-09-29; privacy §9).
 *    Removing the membership leaves the rows, and a member invited back is
 *    not asked again for a version they already accepted there. Only the
 *    erasure purge deletes them (`PURGED_TABLES`).
 *
 * PGlite as `app_user`, both chains. The subjects are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import { LEGAL_DOCUMENTS, LEGAL_VERSIONS } from './legal-versions.ts';
import { readAcceptance, recordAcceptance } from './legal-acceptance.ts';

// UUID family 0139a3c0-…, unused elsewhere in the repo.
const P = '0139a3c0-e29b-41d4-a716-4466554430';
const OURS = `${P}01`;
const THEIRS = `${P}02`;
const ANNA = 'acceptance-anna';
const BRAM = 'acceptance-bram';
const CARL = 'acceptance-carl';

let driver: LedgerDriver;

async function owner(statement: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(statement, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** What the statement's refusal says, or null when it went through. */
async function refusal(tenantId: string, statement: string): Promise<string | null> {
  return withTenant(driver, tenantId, (db) => db.execute(sql.raw(statement))).then(
    () => null,
    (e: Error & { cause?: Error }) => `${e.message} ${e.cause?.message ?? ''}`,
  );
}

const rowsOf = (tenantId: string, subject: string) =>
  owner(
    `SELECT document, version, language, accepted_at FROM legal_acceptance
      WHERE tenant_id = $1 AND subject = $2 ORDER BY document, version`,
    [tenantId, subject],
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [id, name] of [
    [OURS, 'Ours thuis'],
    [THEIRS, 'Theirs thuis'],
  ]) {
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [id, name]);
  }
  for (const [tenant, subject] of [
    [OURS, ANNA],
    [OURS, BRAM],
    [THEIRS, CARL],
  ]) {
    await owner(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES ($1, $2, $3, 'owner', 'active')`,
      [tenant, subject, `${subject}@example.invalid`],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('what a person accepted, per text and version', () => {
  it('asks at first for all three texts, each at its current version', async () => {
    const state = await withTenant(driver, OURS, (db) => readAcceptance(db, OURS, ANNA));

    expect(state.due).toBe(true);
    expect(state.documents).toEqual(
      LEGAL_DOCUMENTS.map((document) => ({ document, version: LEGAL_VERSIONS[document], accepted: false })),
    );
  });

  it('writes one row per text, with its version, the language it was read in, and the time', async () => {
    const before = Date.now();
    const got = await withTenant(driver, OURS, (db) => recordAcceptance(db, OURS, ANNA, LEGAL_VERSIONS, 'nl'));

    expect(got.kind).toBe('recorded');
    expect(got.kind === 'recorded' && got.written).toBe(3);
    const rows = await rowsOf(OURS, ANNA);
    expect(rows.map((r) => [r.document, r.version, r.language])).toEqual(
      [...LEGAL_DOCUMENTS].sort().map((d) => [d, LEGAL_VERSIONS[d], 'nl']),
    );
    for (const r of rows) {
      expect(new Date(r.accepted_at as string).getTime()).toBeGreaterThanOrEqual(before - 60_000);
    }
  });

  it('is not due once given', async () => {
    const state = await withTenant(driver, OURS, (db) => readAcceptance(db, OURS, ANNA));

    expect(state.due).toBe(false);
    expect(state.documents.every((d) => d.accepted)).toBe(true);
  });

  it('accepting again writes nothing, and keeps the first time and language', async () => {
    const first = await rowsOf(OURS, ANNA);
    const got = await withTenant(driver, OURS, (db) => recordAcceptance(db, OURS, ANNA, LEGAL_VERSIONS, 'en'));

    expect(got.kind === 'recorded' && got.written).toBe(0);
    expect(await rowsOf(OURS, ANNA)).toEqual(first);
  });

  it('refuses a version that is not the current one, and writes nothing', async () => {
    const stale = { ...LEGAL_VERSIONS, privacy: '1.1' };
    const got = await withTenant(driver, OURS, (db) => recordAcceptance(db, OURS, BRAM, stale, 'en'));

    expect(got).toEqual({ kind: 'not_current', stale: ['privacy'], current: LEGAL_VERSIONS });
    expect(await rowsOf(OURS, BRAM)).toEqual([]);
  });

  it('is a person’s own: a colleague in the same organisation is still asked', async () => {
    const state = await withTenant(driver, OURS, (db) => readAcceptance(db, OURS, BRAM));

    expect(state.due).toBe(true);
  });

  it('asks again when a text gets a new number, and the new acceptance is a new row beside the old', async () => {
    const next = { ...LEGAL_VERSIONS, terms: '9.9' };
    const asked = await withTenant(driver, OURS, (db) => readAcceptance(db, OURS, ANNA, next));

    expect(asked.due).toBe(true);
    expect(asked.documents.filter((d) => !d.accepted)).toEqual([{ document: 'terms', version: '9.9', accepted: false }]);

    const got = await withTenant(driver, OURS, (db) => recordAcceptance(db, OURS, ANNA, next, 'en', next));
    expect(got.kind === 'recorded' && got.written).toBe(1);
    const terms = (await rowsOf(OURS, ANNA)).filter((r) => r.document === 'terms');
    expect(terms.map((r) => [r.version, r.language])).toEqual([
      [LEGAL_VERSIONS.terms, 'nl'],
      ['9.9', 'en'],
    ]);
  });
});

describe('under row security', () => {
  it('an organisation reads only its own rows', async () => {
    const seen = await withTenant(driver, THEIRS, (db) =>
      db.execute(sql`SELECT count(*)::int AS n FROM legal_acceptance`),
    );
    const n = (seen as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;

    expect(n).toBe(0);
    // Anna's rows are there, for the owner, so the nought above is row security.
    expect((await rowsOf(OURS, ANNA)).length).toBeGreaterThan(0);
    const state = await withTenant(driver, THEIRS, (db) => readAcceptance(db, THEIRS, ANNA));
    expect(state.due).toBe(true);
  });

  it('writes no row for another organisation', async () => {
    const said = await refusal(
      THEIRS,
      `INSERT INTO legal_acceptance (tenant_id, subject, document, version, language)
       VALUES ('${OURS}', '${ANNA}', 'terms', '1.0', 'en')`,
    );

    expect(said).toMatch(/row-level security/);
  });

  it('writes no row naming somebody who is not one of its members', async () => {
    const said = await refusal(
      THEIRS,
      `INSERT INTO legal_acceptance (tenant_id, subject, document, version, language)
       VALUES ('${THEIRS}', '${ANNA}', 'terms', '1.0', 'en')`,
    );

    expect(said).toMatch(/row-level security/);
    expect(await rowsOf(THEIRS, ANNA)).toEqual([]);
  });

  it('nobody on the request path may change a row, not even its own organisation', async () => {
    const before = await rowsOf(OURS, ANNA);
    const said = await refusal(OURS, `UPDATE legal_acceptance SET version = '0.1', accepted_at = now()`);

    expect(said).toMatch(/permission denied/);
    expect(await rowsOf(OURS, ANNA)).toEqual(before);
  });

  it('nobody on the request path may delete a row, not even its own organisation', async () => {
    const before = await rowsOf(OURS, ANNA);
    const said = await refusal(OURS, `DELETE FROM legal_acceptance`);

    expect(said).toMatch(/permission denied/);
    expect(await rowsOf(OURS, ANNA)).toEqual(before);
  });

  it('grants the request path reading and writing, and nothing else', async () => {
    const grants = await owner(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_user' AND table_schema = 'public' AND table_name = 'legal_acceptance'`,
    );

    expect(grants.map((g) => g.privilege_type).sort()).toEqual(['INSERT', 'SELECT']);
  });

  it('has policies for reading and writing, and none for changing or deleting', async () => {
    const policies = await owner(
      `SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'legal_acceptance'`,
    );

    // A grant given back by mistake still meets no policy that lets it through.
    expect(policies.map((p) => p.cmd).sort()).toEqual(['INSERT', 'SELECT']);
  });
});

describe('when a member leaves the organisation', () => {
  afterAll(async () => {
    await owner(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES ($1, $2, $3, 'owner', 'active')
       ON CONFLICT DO NOTHING`,
      [OURS, ANNA, `${ANNA}@example.invalid`],
    );
  });

  it('removing the membership on the request path leaves their record, as the organisation keeps it until erasure', async () => {
    const before = await rowsOf(OURS, ANNA);
    expect(before.length, 'the fixture: Anna accepted above').toBeGreaterThan(0);

    const removed = await withTenant(driver, OURS, (db) =>
      db.execute(sql.raw(`DELETE FROM tenant_member WHERE user_id = '${ANNA}' RETURNING user_id`)),
    );

    expect((removed as unknown as { rows: unknown[] }).rows, 'the membership was not removed').toHaveLength(1);
    expect(await rowsOf(OURS, ANNA)).toEqual(before);
  });

  it('invited back, they are not asked again for the versions they already accepted there', async () => {
    await owner(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES ($1, $2, $3, 'owner', 'active')
       ON CONFLICT DO NOTHING`,
      [OURS, ANNA, `${ANNA}@example.invalid`],
    );
    const state = await withTenant(driver, OURS, (db) => readAcceptance(db, OURS, ANNA));

    expect(state.due).toBe(false);
  });
});
