// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The first bearer credential in this repository, held to a bearer
 * credential's standards (workplan 0108 T1).
 *
 * Run against **PGlite as `app_user`** — the wiring the product actually
 * serves — so the policies in migration 0031 are enforced rather than merely
 * present. `rls-in-force.unit.test.ts` records why that distinction is not
 * pedantry: as an owner or a superuser, every policy here would be decoration
 * and every isolation assertion below would pass while enforcing nothing.
 *
 * Four properties carry the design, and each has a test that fails without it:
 *
 *  1. the secret is **never stored** — the table holds a hash, and a leaked
 *     table cannot mint working links;
 *  2. every failure answers the **same sentence** — expired, revoked, used,
 *     forged and unknown are indistinguishable to whoever is guessing;
 *  3. the link context reads **exactly one row** — blast radius, not
 *     authentication, which the hash comparison does;
 *  4. that context works when `app.current_tenant` has **decayed to `''`** on
 *     a pooled connection — the trap `withSubject` documents, which would turn
 *     every verification into a 500 the first time a link followed a
 *     tenant-scoped request down the same connection.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import { connection, mappingLink } from './schema-pg.ts';
import {
  MAPPING_LINK_REFUSAL,
  expiryFromDays,
  issueMappingLink,
  linkState,
  listMappingLinks,
  revokeMappingLink,
  spendMappingLink,
  verifyMappingLink,
} from './mapping-link-store.ts';
import type { LedgerDriver } from './driver.ts';

// UUID family 5f4d0000-…, unused elsewhere in the repo.
const TENANT_A = '5f4d0000-e29b-41d4-a716-446655441401';
const TENANT_B = '5f4d0000-e29b-41d4-a716-446655441402';
const CONN_A = '5f4d0000-e29b-41d4-a716-446655441411';
const CONN_B = '5f4d0000-e29b-41d4-a716-446655441412';
const BOX_A = '5f4d0000-e29b-41d4-a716-446655441421';
const BOX_B = '5f4d0000-e29b-41d4-a716-446655441422';
const MAPPING_A = '5f4d0000-e29b-41d4-a716-446655441431';
const MAPPING_B = '5f4d0000-e29b-41d4-a716-446655441432';
const OWNER = 'owner-subject-a';

let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

  // Seeded OUTSIDE any tenant context, as the owner — which is how two
  // tenants' rows can exist at all. Everything asserted below goes through the
  // served path.
  const conn = await driver.acquire();
  try {
    for (const [tenant, connId, boxId, mappingId, name] of [
      [TENANT_A, CONN_A, BOX_A, MAPPING_A, 'A'],
      [TENANT_B, CONN_B, BOX_B, MAPPING_B, 'B'],
    ]) {
      await conn.query('INSERT INTO tenant (id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
        tenant,
        name,
      ]);
      await conn.query(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
         VALUES ($1,$2,'source','imap',$3,'{}'::jsonb,'connected') ON CONFLICT DO NOTHING`,
        [connId, tenant, name],
      );
      await conn.query(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user',$4) ON CONFLICT DO NOTHING`,
        [boxId, tenant, connId, `${name}@example.invalid`],
      );
      await conn.query(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'paused') ON CONFLICT DO NOTHING`,
        [mappingId, tenant, boxId],
      );
    }
  } finally {
    conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM mapping_link');
  } finally {
    conn.release();
  }
});

/** Mint a live grant link for tenant A, the way the owner's route will. */
async function issueForA(overrides: { expiresAt?: Date; purpose?: 'grant' | 'view' } = {}) {
  return withTenant(driver, TENANT_A, (db) =>
    issueMappingLink(db, {
      tenantId: TENANT_A,
      mappingId: MAPPING_A,
      purpose: overrides.purpose ?? 'grant',
      createdBy: OWNER,
      expiresAt: overrides.expiresAt ?? expiryFromDays(7),
    }),
  );
}

describe('the secret is never stored', () => {
  it('keeps only a hash, and the token is the one copy that ever existed', async () => {
    const issued = await issueForA();
    const [, secret] = issued.token.split('.') as [string, string];

    const rows = await withTenant(driver, TENANT_A, (db) => db.select().from(mappingLink));
    expect(rows).toHaveLength(1);
    // The row must not carry the secret in ANY column — a leaked table cannot
    // mint working links.
    expect(JSON.stringify(rows[0])).not.toContain(secret);
    expect(rows[0]!.secretHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mints a different secret every time, so two links are never each other', async () => {
    const a = await issueForA();
    const b = await issueForA();
    expect(a.token).not.toBe(b.token);
    expect(a.id).not.toBe(b.id);
  });
});

describe('one sentence answers every failure', () => {
  const cases: Array<[string, () => Promise<string>]> = [
    ['a token that is not a token', async () => 'not-a-token'],
    ['an id with no secret', async () => `${MAPPING_A}.`],
    [
      'a well-formed id that never existed',
      async () => `${'5f4d0000-e29b-41d4-a716-4466554419ff'}.${'x'.repeat(43)}`,
    ],
    [
      'the right id with the wrong secret',
      async () => {
        const issued = await issueForA();
        return `${issued.id}.${'w'.repeat(43)}`;
      },
    ],
    [
      'an expired link',
      async () => (await issueForA({ expiresAt: new Date(Date.now() - 1000) })).token,
    ],
    [
      'a revoked link',
      async () => {
        const issued = await issueForA();
        await withTenant(driver, TENANT_A, (db) =>
          revokeMappingLink(db, { tenantId: TENANT_A, linkId: issued.id }),
        );
        return issued.token;
      },
    ],
    [
      'a link already spent',
      async () => {
        const issued = await issueForA();
        await withTenant(driver, TENANT_A, (db) =>
          spendMappingLink(db, { tenantId: TENANT_A, linkId: issued.id }),
        );
        return issued.token;
      },
    ],
    [
      'a link whose purpose is not the one being asked for',
      async () => (await issueForA({ purpose: 'view' })).token,
    ],
  ];

  for (const [name, make] of cases) {
    it(`refuses ${name} — with the same words, naming only the remedy`, async () => {
      const verdict = await verifyMappingLink(driver, await make(), { purpose: 'grant' });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason).toBe(MAPPING_LINK_REFUSAL);
        // Never the cause: telling a guesser WHICH half was right is the whole
        // thing this sentence exists to avoid.
        expect(verdict.reason.toLowerCase()).not.toMatch(/revok|expired on|already used at/);
        expect(verdict.reason).toContain('Ask them for a fresh link');
      }
    });
  }

  it('accepts a live link, and says only what the route needs', async () => {
    const issued = await issueForA();
    const verdict = await verifyMappingLink(driver, issued.token, { purpose: 'grant' });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.link).toEqual({
        id: issued.id,
        tenantId: TENANT_A,
        mappingId: MAPPING_A,
        purpose: 'grant',
        expiresAt: expect.any(Date),
      });
      // No hash reaches the caller. Nothing downstream may re-derive a secret.
      expect(JSON.stringify(verdict.link)).not.toContain('Hash');
    }
  });

  it("lets a 'view' link be opened again — single-use belongs to the grant only", async () => {
    const issued = await issueForA({ purpose: 'view' });
    await withTenant(driver, TENANT_A, (db) =>
      spendMappingLink(db, { tenantId: TENANT_A, linkId: issued.id }),
    );
    const verdict = await verifyMappingLink(driver, issued.token, { purpose: 'view' });
    expect(verdict.ok).toBe(true);
  });
});

describe('the link context reads exactly one row', () => {
  it("cannot see another tenant's link, even holding a valid one of its own", async () => {
    const mine = await issueForA();
    const theirs = await withTenant(driver, TENANT_B, (db) =>
      issueMappingLink(db, {
        tenantId: TENANT_B,
        mappingId: MAPPING_B,
        purpose: 'grant',
        createdBy: 'owner-subject-b',
        expiresAt: expiryFromDays(7),
      }),
    );

    // Tenant A's owner sees one link: their own.
    const listed = await withTenant(driver, TENANT_A, (db) =>
      listMappingLinks(db, { tenantId: TENANT_A, mappingId: MAPPING_A }),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(mine.id);

    // And the bearer of A's link learns nothing about B's — verification is
    // per-row, and the row it may read is the one whose id it presented.
    const crossed = await verifyMappingLink(driver, `${theirs.id}.${mine.token.split('.')[1]}`, {
      purpose: 'grant',
    });
    expect(crossed.ok).toBe(false);
  });

  it('verifies after a tenant-scoped transaction on the same connection (the GUC decay)', async () => {
    // THE regression this file exists for. `SET LOCAL` reverts to the SESSION
    // value, which for a setting never assigned at session level is the EMPTY
    // STRING — so from the second transaction on a pooled connection
    // `current_setting('app.current_tenant', true)` is `''`. Permissive
    // policies are OR'd and ALL are evaluated, so a link-scoped read runs the
    // tenant policies too: with a bare `''::uuid` cast they RAISE and every
    // verification becomes a 500. Migration 0031's policies are NULL-safe from
    // birth; PGlite's single connection reproduces the decay exactly.
    const issued = await issueForA();
    await withTenant(driver, TENANT_A, (db) => db.select().from(connection));
    const verdict = await verifyMappingLink(driver, issued.token, { purpose: 'grant' });
    expect(verdict.ok).toBe(true);
  });
});

describe('spending, revoking, and what the owner sees', () => {
  it('spends once and only once — a repeated callback marks nothing twice', async () => {
    const issued = await issueForA();
    const first = await withTenant(driver, TENANT_A, (db) =>
      spendMappingLink(db, { tenantId: TENANT_A, linkId: issued.id }),
    );
    const second = await withTenant(driver, TENANT_A, (db) =>
      spendMappingLink(db, { tenantId: TENANT_A, linkId: issued.id }),
    );
    expect([first, second]).toEqual([true, false]);
  });

  it('refuses to spend a link revoked mid-flight — the kill switch wins the race', async () => {
    const issued = await issueForA();
    await withTenant(driver, TENANT_A, (db) =>
      revokeMappingLink(db, { tenantId: TENANT_A, linkId: issued.id }),
    );
    const spent = await withTenant(driver, TENANT_A, (db) =>
      spendMappingLink(db, { tenantId: TENANT_A, linkId: issued.id }),
    );
    expect(spent).toBe(false);
  });

  it('refuses to spend a link that expired mid-flight', async () => {
    const issued = await issueForA({ expiresAt: new Date(Date.now() - 1000) });
    const spent = await withTenant(driver, TENANT_A, (db) =>
      spendMappingLink(db, { tenantId: TENANT_A, linkId: issued.id }),
    );
    expect(spent).toBe(false);
  });

  it('revokes idempotently — pressing twice means the same thing both times', async () => {
    const issued = await issueForA();
    const first = await withTenant(driver, TENANT_A, (db) =>
      revokeMappingLink(db, { tenantId: TENANT_A, linkId: issued.id }),
    );
    const second = await withTenant(driver, TENANT_A, (db) =>
      revokeMappingLink(db, { tenantId: TENANT_A, linkId: issued.id }),
    );
    expect([first, second]).toEqual([true, false]);
  });

  it('lists newest first, with state and without any secret', async () => {
    const older = await issueForA();
    await new Promise((r) => setTimeout(r, 5));
    const newer = await issueForA();
    await withTenant(driver, TENANT_A, (db) =>
      revokeMappingLink(db, { tenantId: TENANT_A, linkId: older.id }),
    );

    const listed = await withTenant(driver, TENANT_A, (db) =>
      listMappingLinks(db, { tenantId: TENANT_A, mappingId: MAPPING_A }),
    );
    expect(listed.map((l) => l.id)).toEqual([newer.id, older.id]);
    expect(listed.map((l) => l.state)).toEqual(['live', 'revoked']);
    expect(JSON.stringify(listed)).not.toContain('secretHash');
  });
});

describe('the four states, defined once', () => {
  const past = new Date('2026-08-01T00:00:00.000Z');
  const now = new Date('2026-08-27T00:00:00.000Z');
  const future = new Date('2026-09-30T00:00:00.000Z');

  it('reports a used link as used even after its date passed — it did its job', () => {
    expect(linkState({ usedAt: past, revokedAt: null, expiresAt: past }, now)).toBe('used');
  });

  it('reports a revoked link as revoked — the owner outranks a date', () => {
    expect(linkState({ usedAt: null, revokedAt: past, expiresAt: past }, now)).toBe('revoked');
  });

  it('reports EXPIRED only for an unused link — that is the one to re-issue', () => {
    // The distinction the owner acts on: somebody was asked and never managed
    // to answer.
    expect(linkState({ usedAt: null, revokedAt: null, expiresAt: past }, now)).toBe('expired');
    expect(linkState({ usedAt: null, revokedAt: null, expiresAt: future }, now)).toBe('live');
  });
});
