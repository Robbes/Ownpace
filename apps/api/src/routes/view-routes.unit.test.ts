// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The progress page's route, against a REAL database (workplan 0122 T3).
 *
 * PGlite as `app_user`, like `link-routes.unit.test.ts`, and for a stronger
 * reason than symmetry: the middleware under test authenticates by reading the
 * `mapping_link` row under a link-scoped context, and the counts it answers
 * with come out of a join across `migration_status` and `item`. A mocked store
 * would let this file agree with itself about both.
 *
 * **Nothing is stubbed at all** — not even `authenticate`, because there is no
 * session to pretend to have. The link in the path is the whole credential,
 * which is precisely the property being exercised.
 *
 * What this proves, and none of it is visible without a table:
 *
 *  - a CREDENTIAL token opened at this address is refused, and the reverse;
 *  - the page can be opened twice, unlike the credential link;
 *  - revocation lands at the next open, not at the next issue;
 *  - `started: false` is a different answer from five domains of zero;
 *  - the provider's error prose does not reach the payload, from a row that
 *    really carries one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import {
  pgliteDriver,
  runMigrations,
  withTenant,
  issueMappingLink,
  revokeMappingLink,
  expiryFromDays,
} from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';

// UUID family 6a6a0000-…, unused elsewhere in the repo.
const TENANT = '6a6a0000-e29b-41d4-a716-446655442201';
const CONN = '6a6a0000-e29b-41d4-a716-446655442211';
const BOX = '6a6a0000-e29b-41d4-a716-446655442221';
/** Has run: two domains of status rows, items, and a failure carrying prose. */
const RUNNING = '6a6a0000-e29b-41d4-a716-446655442231';
/** Granted an hour ago and never touched by a pass. The `started: false` case. */
const UNTOUCHED = '6a6a0000-e29b-41d4-a716-446655442232';

/**
 * The prose that must never cross. A real rejection shape: a code, a reason
 * and a path — and it is the path that makes it content.
 */
const PROSE = '550 5.7.1 rejected: /Documents/tax-return-2024.pdf';

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  // Only the pool. `authenticateMappingLink` itself is the product's, running
  // against the real `mapping_link` table.
  return { ...actual, getDbPool: () => driver };
});

const { default: viewRoutes } = await import('./view.ts');
const { default: grantRoutes } = await import('./grant.ts');

const app = express();
app.use(express.json());
app.use('/api/view', viewRoutes);
app.use('/api/grant', grantRoutes);

async function withClient(fn: (q: (sql: string, p?: unknown[]) => Promise<unknown>) => Promise<void>) {
  const conn = await driver.acquire();
  try {
    await fn((sql, p) => conn.query(sql, p ?? []));
  } finally {
    await conn.release();
  }
}

const tokenFor = (mappingId: string, purpose: 'grant' | 'view', days = 90) =>
  withTenant(driver, TENANT, (db) =>
    issueMappingLink(db, {
      tenantId: TENANT,
      mappingId,
      purpose,
      createdBy: 'rob',
      expiresAt: expiryFromDays(days),
    }),
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

  await withClient(async (q) => {
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'Berentsen family']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','imap','mum','{}'::jsonb,'connected')`,
      [CONN, TENANT],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','mum@example.invalid')`,
      [BOX, TENANT, CONN],
    );
    for (const [id, status] of [
      [RUNNING, 'active'],
      [UNTOUCHED, 'paused'],
    ]) {
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name)
         VALUES ($1,$2,$3,$4,$5)`,
        // A name the owner typed, deliberately distinctive: it must not appear
        // in any answer. It is the owner's private label for a person, and the
        // person reading this page already knows whose account it is.
        [id, TENANT, BOX, status, 'Mum — old Gmail'],
      );
    }

    await q(
      `INSERT INTO migration_status
         (tenant_id, mapping_id, domain, state, completed_at, last_error, last_error_category, failed_side)
       VALUES ($1,$2,'email','in_progress', NULL, $3, 'target_refused', 'target')`,
      [TENANT, RUNNING, PROSE],
    );
    await q(
      `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, completed_at)
       VALUES ($1,$2,'calendar','completed', now())`,
      [TENANT, RUNNING],
    );

    // Three items: two copied, one failed past the decision threshold. The
    // failed one carries the prose a second time, on the row `listFailures`
    // actually reads.
    await q(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status, size_bytes)
       VALUES ($1,$2,'email','INBOX','k1','h1','copied', 1000),
              ($1,$2,'email','INBOX','k2','h2','copied', 2000)`,
      [TENANT, RUNNING],
    );
    await q(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status, attempt_count, last_error)
       VALUES ($1,$2,'email','INBOX','k3','h3','failed', 5, $3)`,
      [TENANT, RUNNING, PROSE],
    );
  });
});

afterAll(async () => {
  await driver.end?.();
});

describe('the two lifetimes cannot be opened at each other’s address', () => {
  it('refuses a credential token at the progress page', async () => {
    const link = await tokenFor(RUNNING, 'grant', 7);
    const res = await request(app).get(`/api/view/${link.token}`);
    expect(res.status).toBe(401);
    // The one sentence, for every way a link can fail — the purpose mismatch
    // is deliberately indistinguishable from the rest.
    expect(res.body.message).toContain('This link cannot be used');
  });

  it('refuses a progress token at the credential page', async () => {
    const link = await tokenFor(RUNNING, 'view');
    const res = await request(app).get(`/api/grant/${link.token}`);
    expect(res.status).toBe(401);
  });

  it('refuses a forged secret against a real link id', async () => {
    const link = await tokenFor(RUNNING, 'view');
    const [id] = link.token.split('.');
    const res = await request(app).get(`/api/view/${id}.aaaaaaaaaaaaaaaaaaaaaaaa`);
    expect(res.status).toBe(401);
  });
});

describe('what the page opens', () => {
  it('answers counts and states, twice, because it is not single-use', async () => {
    const link = await tokenFor(RUNNING, 'view');

    const first = await request(app).get(`/api/view/${link.token}`);
    expect(first.status).toBe(200);
    expect(first.body.organisation).toBe('Berentsen family');
    expect(first.body.state).toBe('active');
    expect(first.body.started).toBe(true);

    const email = first.body.domains.find((d: { domain: string }) => d.domain === 'email');
    expect(email.itemsSynced).toBe(2);
    expect(email.itemsFailed).toBe(1);
    expect(email.bytesTransferred).toBe(3000);
    // Five attempts is the threshold, so this one is waiting on a person
    // rather than on another retry.
    expect(email.itemsNeedingDecision).toBe(1);
    expect(email.itemsRetrying).toBe(0);
    expect(email.lastErrorCategory).toBe('target_refused');
    expect(email.failedSide).toBe('target');

    // The whole point of the second lifetime: opening again works. A
    // credential link would be spent by now.
    const second = await request(app).get(`/api/view/${link.token}`);
    expect(second.status).toBe(200);
    expect(second.body.domains).toHaveLength(2);
  });

  it('carries no prose, no name, and no identifiers — anywhere in the payload', async () => {
    const link = await tokenFor(RUNNING, 'view');
    const res = await request(app).get(`/api/view/${link.token}`);
    const body = JSON.stringify(res.body);

    // The two rows that really do hold it — `migration_status.last_error` and
    // the failed `item.last_error` — are both read by this route's queries.
    expect(body).not.toContain('tax-return-2024');
    expect(body).not.toContain('550 5.7.1');
    // The owner's own label for a person.
    expect(body).not.toContain('Mum');
    // Identifiers: nothing a holder could use to address another surface.
    expect(body).not.toContain(RUNNING);
    expect(body).not.toContain(TENANT);
    // And not the collection the failed item sits in, which is a folder name.
    expect(body).not.toContain('INBOX');
  });

  it('says nothing has run rather than saying zero', async () => {
    const link = await tokenFor(UNTOUCHED, 'view');
    const res = await request(app).get(`/api/view/${link.token}`);
    expect(res.status).toBe(200);
    expect(res.body.started).toBe(false);
    // Not five domains of zeroes: there is no row to be zero about, and a
    // page that invented them would tell somebody their migration finished
    // and moved nothing.
    expect(res.body.domains).toEqual([]);
    expect(res.body.state).toBe('paused');
  });

  it('states its own expiry, so somebody who bookmarked it knows', async () => {
    const link = await tokenFor(RUNNING, 'view', 30);
    const res = await request(app).get(`/api/view/${link.token}`);
    const days = (new Date(res.body.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });
});

describe('the owner’s kill switch reaches the page', () => {
  it('stops answering the moment the link is revoked', async () => {
    const link = await tokenFor(RUNNING, 'view');
    expect((await request(app).get(`/api/view/${link.token}`)).status).toBe(200);

    await withTenant(driver, TENANT, (db) =>
      revokeMappingLink(db, { tenantId: TENANT, linkId: link.id }),
    );

    // Re-checked at the OPEN, not trusted from the issue — which is what makes
    // a ninety-day lifetime acceptable at all.
    const after = await request(app).get(`/api/view/${link.token}`);
    expect(after.status).toBe(401);
  });

  it('stops answering once it has expired', async () => {
    const link = await withTenant(driver, TENANT, (db) =>
      issueMappingLink(db, {
        tenantId: TENANT,
        mappingId: RUNNING,
        purpose: 'view',
        createdBy: 'rob',
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    const res = await request(app).get(`/api/view/${link.token}`);
    expect(res.status).toBe(401);
  });
});

/**
 * The sixth-vocabulary tripwire (workplan 0117 T1's actual cost).
 *
 * `mailbox_mapping.status` is read by six things that each have their own list
 * of legal values, and adding `continuous` to the CHECK constraint without
 * adding it to `MAPPING_LIFECYCLES` would have made every page and every pass
 * raise. Both existing readers refuse rather than coerce, and so does this one.
 *
 * Reaching that branch needs a database state the CHECK makes impossible, so
 * the constraint is dropped for the length of one test and put back. That is
 * not a trick to get green: the branch exists FOR the moment somebody widens
 * the constraint and forgets the contract, and a test that cannot reach it
 * would leave the whole check unproven — which is how the fifth vocabulary was
 * missed in the first place.
 */
describe('a state the contract has never heard of', () => {
  const IMPOSSIBLE = '6a6a0000-e29b-41d4-a716-446655442233';

  it('refuses rather than guessing a word for it', async () => {
    await withClient(async (q) => {
      await q('ALTER TABLE mailbox_mapping DROP CONSTRAINT mailbox_mapping_status_check');
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'hibernating')`,
        [IMPOSSIBLE, TENANT, BOX],
      );
    });
    try {
      const link = await tokenFor(IMPOSSIBLE, 'view');
      const res = await request(app).get(`/api/view/${link.token}`);
      // A 500 with a reference, not a page that invented a state. The value
      // itself stays in the log — `serverFault` answers with a sentence and a
      // reference, never with the error.
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('view_read_failed');
      expect(JSON.stringify(res.body)).not.toContain('hibernating');
    } finally {
      await withClient(async (q) => {
        await q('DELETE FROM mailbox_mapping WHERE id = $1', [IMPOSSIBLE]);
        await q(
          `ALTER TABLE mailbox_mapping ADD CONSTRAINT mailbox_mapping_status_check
           CHECK (status IN ('active','paused','cutover','done','continuous'))`,
        );
      });
    }
  });
});
