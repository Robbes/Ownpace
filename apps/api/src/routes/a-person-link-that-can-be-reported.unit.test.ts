// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * REPORT THIS LINK, FOR A PERSON'S LINK (workplan 0108 T8 (d); ADR-0035,
 * amended 2026-09-29; 0153 T5 (b)).
 *
 * A person's grant page and progress page are reached through one link for all
 * of their migrations, so the report a person sends from either names the
 * person and every migration of theirs. On PGlite as `app_user`, both chains,
 * with only Zammad stubbed, as `a-link-that-can-be-reported.unit.test.ts`
 * does for a migration's link:
 *
 * - a person's grant link reports at the grant door and their progress link at
 *   the progress door, and neither at the other's;
 * - a revoked one reports nothing;
 * - the ticket names the link as a person's, the person, and each migration on
 *   a line of its own, from the rows, and never the link's secret.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { expiryFromDays, pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { issuePersonLink, revokePersonLink, runManagedMigrations } from '@openmig/managed';
import { LINK_REPORT_OVERALL, LINK_REPORT_PER_LINK, linkReportRoutes } from './link-reports.ts';
import { createKnockLimiter } from '../knock-limit.ts';
import { linkReportMailFor, type LinkReportFacts } from '../link-report.ts';

// UUID family 0153c5d3-…, unused elsewhere in the repo.
const U = (n: string) => `0153c5d3-e29b-41d4-a716-4466554430${n}`;
const TENANT = U('01');
const SOURCE_CONN = U('11');
const TARGET_CONN = U('12');
const SOURCE_BOX = U('21');
const TARGET_BOX = U('22');
const FILES_BOX = U('23');
const CAL = U('31');
const FILES = U('32');
const ANNA = U('41');

const CONFIGURED = { ZAMMAD_URL: 'https://help.example.invalid', ZAMMAD_TOKEN: 'test-token-not-real', ZAMMAD_GROUP: 'Links' };
const REPORT = { description: 'Nobody told me about a move.', replyTo: 'reporter@example.invalid' };

let driver: LedgerDriver;

/** Zammad, as a function: the tickets it was sent. */
function zammad() {
  const calls: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return { ok: true, status: 201, json: async () => ({ id: 9, number: '41002' }) };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** Both doors, on fresh counts. */
function app(fetchImpl: typeof fetch) {
  const deps = {
    env: CONFIGURED,
    fetchImpl,
    perLink: createKnockLimiter(LINK_REPORT_PER_LINK),
    overall: createKnockLimiter(LINK_REPORT_OVERALL),
    source: () => driver,
  };
  const a = express();
  a.use(express.json());
  a.use('/api/grant', linkReportRoutes('grant', deps));
  a.use('/api/view', linkReportRoutes('view', deps));
  return a;
}

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    await conn.release();
  }
}

/** A live link of Anna's, of either kind, issued by the member `pat`. */
const mintPersonLink = (purpose: 'grant' | 'view') =>
  withTenant(driver, TENANT, (db) =>
    issuePersonLink(db, { tenantId: TENANT, personId: ANNA, purpose, createdBy: 'pat', expiresAt: expiryFromDays(7) }),
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Acme Legal']);
  await sql(`INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, 'pat', 'owner@example.org')`, [TENANT]);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
       ($1, $3, 'source', 'google', 'g', '{"user":"anna@gmail.com"}'::jsonb, 'connected'),
       ($2, $3, 'target', 'nextcloud', 'nc', '{"host":"cloud.example.org","port":443}'::jsonb, 'connected')`,
    [SOURCE_CONN, TARGET_CONN, TENANT],
  );
  for (const [box, conn] of [
    [SOURCE_BOX, SOURCE_CONN],
    [TARGET_BOX, TARGET_CONN],
    [FILES_BOX, TARGET_CONN],
  ]) {
    await sql(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1, $2, $3, 'user', 'm@example.invalid')`,
      [box, TENANT, conn],
    );
  }
  for (const [m, target, status] of [
    [CAL, TARGET_BOX, 'active'],
    [FILES, FILES_BOX, 'paused'],
  ]) {
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, target_config_override, status)
       VALUES ($1, $2, $3, $4, '{"user":"anna@cloud.example.org"}'::jsonb, $5)`,
      [m, TENANT, SOURCE_BOX, target, status],
    );
  }
  await sql(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1, $2, 'Anna')`, [ANNA, TENANT]);
  for (const m of [CAL, FILES]) {
    await sql('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1, $2, $3)', [m, ANNA, TENANT]);
  }
}, 60_000);

afterAll(async () => {
  await driver.end?.();
});

describe('who may report, with a person’s link', () => {
  it('reports at its own kind’s door, and not at the other’s', async () => {
    const grant = await mintPersonLink('grant');
    const view = await mintPersonLink('view');
    const { calls, fetchImpl } = zammad();
    const a = app(fetchImpl);

    expect((await request(a).get(`/api/grant/${grant.token}/report`)).body).toEqual({ available: true });
    expect((await request(a).post(`/api/grant/${grant.token}/report`).send(REPORT)).status).toBe(201);
    expect((await request(a).post(`/api/view/${view.token}/report`).send(REPORT)).status).toBe(201);
    expect((await request(a).post(`/api/view/${grant.token}/report`).send(REPORT)).status).toBe(401);
    expect((await request(a).post(`/api/grant/${view.token}/report`).send(REPORT)).status).toBe(401);
    expect(calls).toHaveLength(2);
  });

  it('reports nothing once the owner revoked it', async () => {
    const view = await mintPersonLink('view');
    await withTenant(driver, TENANT, (db) => revokePersonLink(db, { tenantId: TENANT, personId: ANNA, linkId: view.id }));
    const { calls, fetchImpl } = zammad();
    expect((await request(app(fetchImpl)).post(`/api/view/${view.token}/report`).send(REPORT)).status).toBe(401);
    expect(calls).toEqual([]);
  });
});

describe('what the ticket says about a person’s link', () => {
  it('names the link as a person’s, the person, and each migration on a line of its own, and never the secret', async () => {
    const view = await mintPersonLink('view');
    const { calls, fetchImpl } = zammad();
    await request(app(fetchImpl)).post(`/api/view/${view.token}/report`).send(REPORT);

    const ticket = calls[0] as { title: string; article: { body: string } };
    expect(ticket.title).toBe("Ownpace: a person's progress link was reported");
    const lines = ticket.article.body.split('\n');
    expect(lines[0]).toBe(`Link: ${view.id} (person's progress link)`);
    expect(lines).toContain(`Organisation: Acme Legal (${TENANT})`);
    expect(lines).toContain(`Person: ${ANNA}, with 2 migrations`);
    expect(lines).toContain('Issued by: owner@example.org');
    expect(lines).toContain(
      `Migration: ${CAL} (active); from anna@gmail.com; to nextcloud at cloud.example.org, as anna@cloud.example.org; access not given`,
    );
    expect(lines.filter((l) => l.startsWith('Migration: '))).toHaveLength(2);
    expect(ticket.article.body).not.toContain(view.token.split('.')[2]!);
  });

  it('keeps each migration’s line one line, whatever an organisation typed into its fields', () => {
    const facts: LinkReportFacts = {
      link: 'grant',
      linkId: 'a-link-id',
      tenantId: TENANT,
      organisation: 'Acme\nAccess: not given',
      issuedBy: null,
      personId: ANNA,
      migrations: [
        {
          mappingId: CAL,
          state: 'active',
          from: 'anna@gmail.com\nAccess: given',
          to: { provider: 'nextcloud', host: 'cloud.example.org', account: null },
          access: 'granted',
        },
      ],
    };
    const { subject, body } = linkReportMailFor({ description: 'x' }, facts, 'R-1');
    expect(subject).toBe("Ownpace: a person's grant link was reported");
    expect(body.split('\n').filter((l) => l.startsWith('Access:'))).toEqual([]);
    expect(body).toContain(`Person: ${ANNA}, with 1 migration\n`);
  });
});
