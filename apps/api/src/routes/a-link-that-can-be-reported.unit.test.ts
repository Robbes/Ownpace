// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * REPORT THIS LINK (workplan 0108 T8 (d); the owner, 2026-09-24: a report goes
 * to *"the problem report forms"*).
 *
 * On PGlite as `app_user`, with both migration chains, and only Zammad
 * stubbed: the link is authenticated by the product's own middleware, and the
 * facts the ticket carries are read from the rows as a real request reads
 * them. What is asserted:
 *
 * - **who may report:** a live grant link at the grant door, a live progress
 *   link at the progress door. Not the other kind at either, and not a link
 *   that no longer opens its page;
 * - **what the ticket is:** an internal note with a title nobody typed, the
 *   reporter as its customer, the facts from the rows, and never the link;
 * - **what it costs:** three a day per link and thirty an hour for every link,
 *   one count for both doors, and a refused report costs nothing;
 * - **what the person is told** when nobody can receive it, or it did not
 *   arrive.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  pgliteDriver,
  runMigrations,
  withTenant,
  issueMappingLink,
  revokeMappingLink,
  expiryFromDays,
} from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { setAppEventSink, type AppEvent } from '@openmig/shared';
import {
  LINK_REPORT_OVERALL,
  LINK_REPORT_PER_LINK,
  linkReportRoutes,
  type LinkReportDeps,
} from './link-reports.ts';
import { createKnockLimiter } from '../knock-limit.ts';

// UUID family d8a10000-…, unused elsewhere in the repo.
const TENANT = 'd8a10000-e29b-41d4-a716-446655440801';
const SOURCE_CONN = 'd8a10000-e29b-41d4-a716-446655440811';
const TARGET_CONN = 'd8a10000-e29b-41d4-a716-446655440812';
const SOURCE_BOX = 'd8a10000-e29b-41d4-a716-446655440821';
const TARGET_BOX = 'd8a10000-e29b-41d4-a716-446655440822';
const MAPPING = 'd8a10000-e29b-41d4-a716-446655440831';

const CONFIGURED = { ZAMMAD_URL: 'https://help.example.invalid', ZAMMAD_TOKEN: 'test-token-not-real', ZAMMAD_GROUP: 'Links' };
const REPORT = { description: 'I do not know this organisation.\nNobody told me about a move.', replyTo: 'reporter@example.invalid' };

let driver: LedgerDriver;

/** Zammad, as a function: what it was sent, and what it answers. */
function zammad(status = 201) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ id: 9, number: '41001' }),
    };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** Both doors, as `index.ts` mounts them, on fresh counts unless the test hands some over. */
function app(deps: LinkReportDeps = {}) {
  const shared: LinkReportDeps = {
    perLink: createKnockLimiter(LINK_REPORT_PER_LINK),
    overall: createKnockLimiter(LINK_REPORT_OVERALL),
    ...deps,
    source: () => driver,
  };
  const a = express();
  a.use(express.json());
  a.use('/api/grant', linkReportRoutes('grant', shared));
  a.use('/api/view', linkReportRoutes('view', shared));
  return a;
}

async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** A live link of either kind, issued by the member `pat` unless said otherwise. */
const mintLink = (purpose: 'grant' | 'view', createdBy = 'pat') =>
  withTenant(driver, TENANT, (db) =>
    issueMappingLink(db, { tenantId: TENANT, mappingId: MAPPING, purpose, createdBy, expiresAt: expiryFromDays(7) }),
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: who issued a link is a `tenant_member` row.
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Acme Legal']);
  await sql('INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, $2, $3)', [
    TENANT,
    'pat',
    'owner@example.org',
  ]);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1, $2, 'source', 'gmail', 'g', '{"user":"someone@example.invalid"}'::jsonb, 'connected')`,
    [SOURCE_CONN, TENANT],
  );
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1, $2, 'target', 'nextcloud', 'nc', '{"host":"cloud.example.org","port":443}'::jsonb, 'connected')`,
    [TARGET_CONN, TENANT],
  );
  for (const [box, conn] of [
    [SOURCE_BOX, SOURCE_CONN],
    [TARGET_BOX, TARGET_CONN],
  ]) {
    await sql(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1, $2, $3, 'user', 'm@example.invalid')`,
      [box, TENANT, conn],
    );
  }
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, target_config_override, status)
     VALUES ($1, $2, $3, $4, '{"user":"dest@example.org"}'::jsonb, 'paused')`,
    [MAPPING, TENANT, SOURCE_BOX, TARGET_BOX],
  );
}, 30_000);

afterAll(async () => {
  await driver.end?.();
});

let events: AppEvent[];
beforeEach(async () => {
  events = [];
  setAppEventSink({ record: async (e) => void events.push(e) });
  // No grant stored, unless a test gives one.
  await sql('UPDATE mailbox_mapping SET source_secret_ref = NULL, grant_withdrawn_at = NULL WHERE id = $1', [MAPPING]);
});
afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

describe('who may report', () => {
  it('offers the report on either page only when a helpdesk is set up', async () => {
    const grant = (await mintLink('grant')).token;
    const view = (await mintLink('view')).token;
    for (const [door, token] of [
      ['grant', grant],
      ['view', view],
    ] as const) {
      expect((await request(app({ env: CONFIGURED })).get(`/api/${door}/${token}/report`)).body).toEqual({
        available: true,
      });
      expect((await request(app({ env: {} })).get(`/api/${door}/${token}/report`)).body).toEqual({
        available: false,
      });
    }
  });

  it('takes a report from a live link at its own door, and from no other kind', async () => {
    const grant = (await mintLink('grant')).token;
    const view = (await mintLink('view')).token;
    const { calls, fetchImpl } = zammad();
    const a = app({ env: CONFIGURED, fetchImpl });

    expect((await request(a).post(`/api/grant/${grant}/report`).send(REPORT)).status).toBe(201);
    expect((await request(a).post(`/api/view/${view}/report`).send(REPORT)).status).toBe(201);
    // Each door authenticates its own kind: a grant link cannot report as a
    // progress link, nor the reverse.
    expect((await request(a).post(`/api/view/${grant}/report`).send(REPORT)).status).toBe(401);
    expect((await request(a).post(`/api/grant/${view}/report`).send(REPORT)).status).toBe(401);
    expect((await request(a).get(`/api/view/${grant}/report`)).status).toBe(401);
    expect(calls).toHaveLength(2);
  });

  it('refuses a link that no longer opens its page, and sends nothing', async () => {
    const revoked = await mintLink('grant');
    await withTenant(driver, TENANT, (db) => revokeMappingLink(db, { tenantId: TENANT, linkId: revoked.id }));
    const used = await mintLink('grant');
    await sql('UPDATE mapping_link SET used_at = now() WHERE id = $1', [used.id]);
    const { calls, fetchImpl } = zammad();
    const a = app({ env: CONFIGURED, fetchImpl });

    for (const token of [revoked.token, used.token, `${used.id}.not-the-secret-at-all`]) {
      const res = await request(a).post(`/api/grant/${token}/report`).send(REPORT);
      expect(res.status).toBe(401);
    }
    expect(calls).toEqual([]);
  });
});

describe('what the ticket is', () => {
  it('is an internal note for the owner, with a title nobody typed, and the reporter as its customer', async () => {
    const link = await mintLink('grant');
    const { calls, fetchImpl } = zammad();

    const res = await request(app({ env: CONFIGURED, fetchImpl })).post(`/api/grant/${link.token}/report`).send(REPORT);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ticket: '41001' });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://help.example.invalid/api/v1/tickets');
    expect((call!.init.headers as Record<string, string>).Authorization).toBe('Token token=test-token-not-real');
    const ticket = call!.body as { title: string; group: string; customer_id: string; article: Record<string, unknown> };
    expect(ticket.title).toBe('Ownpace: a grant link was reported');
    expect(ticket.group).toBe('Links');
    // The reply reaches them by email, as with every report.
    expect(ticket.customer_id).toBe('guess:reporter@example.invalid');
    expect(ticket.article).toMatchObject({
      subject: 'Ownpace: a grant link was reported',
      type: 'note',
      internal: true,
      content_type: 'text/plain',
    });
  });

  it('carries what they wrote and what the rows say, and never the link', async () => {
    const link = await mintLink('grant');
    const { calls, fetchImpl } = zammad();

    await request(app({ env: CONFIGURED, fetchImpl })).post(`/api/grant/${link.token}/report`).send(REPORT);

    const body = String((calls[0]!.body.article as { body: string }).body);
    // The facts first, from the rows; what the reporter wrote after them,
    // under its own label.
    expect(body.startsWith(`Link: ${link.id} (grant link)\n`)).toBe(true);
    expect(body.endsWith(`\n\nWhat they wrote:\n${REPORT.description}`)).toBe(true);
    expect(body).toContain(`Organisation: Acme Legal (${TENANT})`);
    expect(body).toContain(`Migration: ${MAPPING} (paused)`);
    expect(body).toContain('Issued by: owner@example.org');
    expect(body).toContain('From: someone@example.invalid');
    expect(body).toContain('To: nextcloud at cloud.example.org, as dest@example.org');
    expect(body).toContain('Access: not given');
    expect(body).toContain('Reply to: reporter@example.invalid (typed by the reporter, not verified)');
    // The link is the id and a secret; only the id, which grants nothing, goes.
    const secret = link.token.slice(link.token.indexOf('.') + 1);
    expect(JSON.stringify(calls[0]!.body)).not.toContain(secret);
  });

  it('keeps each fact to one line, whatever the organisation typed into it', async () => {
    // The organisation may be who the report is about, and it typed its name,
    // the accounts and the host. A line break in one must not write a line of
    // its own into the note the owner reads.
    const link = await mintLink('grant');
    await sql("UPDATE tenant SET name = 'Acme Legal' || chr(8232) || 'Access: not given' WHERE id = $1", [TENANT]);
    await sql(
      `UPDATE mailbox_mapping SET target_config_override = $2::jsonb WHERE id = $1`,
      [MAPPING, JSON.stringify({ user: 'dest@example.org\r\nFrom: nobody@example.invalid' })],
    );
    const { calls, fetchImpl } = zammad();

    try {
      await request(app({ env: CONFIGURED, fetchImpl })).post(`/api/grant/${link.token}/report`).send(REPORT);
    } finally {
      await sql("UPDATE tenant SET name = 'Acme Legal' WHERE id = $1", [TENANT]);
      await sql(`UPDATE mailbox_mapping SET target_config_override = '{"user":"dest@example.org"}'::jsonb WHERE id = $1`, [
        MAPPING,
      ]);
    }

    const body = String((calls[0]!.body.article as { body: string }).body);
    const lines = body.split(/\r\n|\r|\n|\u2028|\u2029/);
    expect(lines.filter((l) => l.startsWith('Access:'))).toEqual(['Access: not given']);
    expect(lines.filter((l) => l.startsWith('From:'))).toEqual(['From: someone@example.invalid']);
    expect(body).toContain(`Organisation: Acme Legal Access: not given (${TENANT})`);
    expect(body).toContain('To: nextcloud at cloud.example.org, as dest@example.org From: nobody@example.invalid');
  });

  it('says so when the migration can already read the account, for a progress link nobody issued', async () => {
    // The progress link a grant mints for the person, issued by no member.
    const link = await mintLink('view', 'granted-by-link');
    await sql("UPDATE mailbox_mapping SET source_secret_ref = 'stored', status = 'active' WHERE id = $1", [MAPPING]);
    const { calls, fetchImpl } = zammad();

    try {
      await request(app({ env: CONFIGURED, fetchImpl })).post(`/api/view/${link.token}/report`).send(REPORT);
    } finally {
      await sql("UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1", [MAPPING]);
    }

    const ticket = calls[0]!.body as { title: string; article: { body: string } };
    expect(ticket.title).toBe('Ownpace: a progress link was reported');
    expect(ticket.article.body).toContain(`Link: ${link.id} (progress link)`);
    expect(ticket.article.body).toContain(`Migration: ${MAPPING} (active)`);
    expect(ticket.article.body).toContain('Access: given: the migration can read the account');
    expect(ticket.article.body).not.toContain('Issued by:');
  });

  it('says a withdrawn grant was withdrawn', async () => {
    const link = await mintLink('view', 'granted-by-link');
    await sql('UPDATE mailbox_mapping SET grant_withdrawn_at = now() WHERE id = $1', [MAPPING]);
    const { calls, fetchImpl } = zammad();

    await request(app({ env: CONFIGURED, fetchImpl })).post(`/api/view/${link.token}/report`).send(REPORT);

    expect((calls[0]!.body.article as { body: string }).body).toContain('Access: given, then withdrawn by the person');
  });
});

describe('what it costs', () => {
  it('refuses a report without words or without an address, and sends nothing', async () => {
    const link = await mintLink('grant');
    const { calls, fetchImpl } = zammad();
    const a = app({ env: CONFIGURED, fetchImpl });

    const empty = await request(a).post(`/api/grant/${link.token}/report`).send({ ...REPORT, description: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.field).toBe('description');
    const noAddress = await request(a).post(`/api/grant/${link.token}/report`).send({ description: 'x' });
    expect(noAddress.status).toBe(400);
    expect(noAddress.body.field).toBe('replyTo');
    const notAnAddress = await request(a)
      .post(`/api/grant/${link.token}/report`)
      .send({ ...REPORT, replyTo: 'reporter at example' });
    expect(notAnAddress.body.field).toBe('replyTo');
    expect(calls).toEqual([]);
  });

  it('takes three reports a day of one link, and a refused one does not count', async () => {
    const link = await mintLink('grant');
    const other = await mintLink('grant');
    const { calls, fetchImpl } = zammad();
    const a = app({ env: CONFIGURED, fetchImpl });

    for (let i = 0; i < 3; i += 1) {
      await request(a).post(`/api/grant/${link.token}/report`).send({ description: '' });
    }
    for (let i = 0; i < 3; i += 1) {
      expect((await request(a).post(`/api/grant/${link.token}/report`).send(REPORT)).status).toBe(201);
    }
    const fourth = await request(a).post(`/api/grant/${link.token}/report`).send(REPORT);
    expect(fourth.status).toBe(429);
    expect(Number(fourth.headers['retry-after'])).toBeGreaterThan(23 * 60 * 60);
    expect(fourth.body.reason).toContain('reported several times today');
    // Another link is its own count.
    expect((await request(a).post(`/api/grant/${other.token}/report`).send(REPORT)).status).toBe(201);
    expect(calls).toHaveLength(4);
  });

  it('takes thirty an hour for every link together, grant and progress links alike', async () => {
    // The module's own counts, as `index.ts` mounts them: no limiter handed
    // over, so both doors share what the module keeps.
    const { calls, fetchImpl } = zammad();
    const a = express();
    a.use(express.json());
    a.use('/api/grant', linkReportRoutes('grant', { env: CONFIGURED, fetchImpl, source: () => driver }));
    a.use('/api/view', linkReportRoutes('view', { env: CONFIGURED, fetchImpl, source: () => driver }));

    for (let i = 0; i < 10; i += 1) {
      const door = i % 2 === 0 ? 'grant' : 'view';
      const { token } = await mintLink(door);
      for (let n = 0; n < 3; n += 1) {
        expect((await request(a).post(`/api/${door}/${token}/report`).send(REPORT)).status).toBe(201);
      }
    }
    for (const door of ['grant', 'view'] as const) {
      const { token } = await mintLink(door);
      const refused = await request(a).post(`/api/${door}/${token}/report`).send(REPORT);
      expect(refused.status).toBe(429);
      expect(refused.body.reason).toContain('Many reports reached us in the last hour');
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    }
    expect(calls).toHaveLength(30);
  }, 60_000);
});

describe('what the person is told', () => {
  it('that reporting is not set up, when no helpdesk is', async () => {
    const link = await mintLink('grant');
    const { calls, fetchImpl } = zammad();
    const res = await request(app({ env: {}, fetchImpl })).post(`/api/grant/${link.token}/report`).send(REPORT);
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('Reporting a link is not set up on this service.');
    expect(calls).toEqual([]);
  });

  it('that it did not arrive, with a reference the log page finds, and the link nowhere in the log', async () => {
    const link = await mintLink('grant');
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));

    const res = await request(app({ env: CONFIGURED, fetchImpl: zammad(500).fetchImpl }))
      .post(`/api/grant/${link.token}/report`)
      .send(REPORT);

    expect(res.status).toBe(502);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: 'error', event: 'report.not-delivered', tenantId: TENANT });
    expect(res.body.reason).toContain(`Reference ${events[0]!.reference}`);
    expect(res.body.reason).toContain('What you wrote is still in the form');
    expect(lines.join('\n')).toContain(`[ref ${events[0]!.reference}]`);
    expect(lines.join('\n')).not.toContain(link.token);
  });
});
