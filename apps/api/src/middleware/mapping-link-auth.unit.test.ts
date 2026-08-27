// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The middleware that grants nothing, held to that claim (workplan 0108 T2).
 *
 * Against a **real database** — PGlite as `app_user`, the same wiring
 * `mapping-link-store.unit.test.ts` uses — because an auth middleware asserted
 * against a mock of the thing that authenticates is asserted against nothing.
 * What the store's own tests pin is the credential's behaviour; what this file
 * pins is the four decisions the MIDDLEWARE makes on top of it:
 *
 *  1. the secret is read from a NAMED path parameter, never a query string;
 *  2. a refusal is a 401 carrying the one sentence, and nothing else;
 *  3. a database that cannot answer is a 503 — OUR fault, never reported as a
 *     bad link, because that would send somebody chasing a fresh link for an
 *     outage (hard rule 9);
 *  4. what it attaches is a mapping and a tenant — never a user, never a role.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Request, Response } from 'express';
import { pgliteDriver, runMigrations, withTenant, issueMappingLink, MAPPING_LINK_REFUSAL } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { authenticateMappingLink } from './auth.ts';
import type { MappingLinkRequest } from '../types/api.ts';

// UUID family 5f4e0000-…, unused elsewhere in the repo.
const TENANT = '5f4e0000-e29b-41d4-a716-446655441501';
const CONN = '5f4e0000-e29b-41d4-a716-446655441511';
const BOX = '5f4e0000-e29b-41d4-a716-446655441521';
const MAPPING = '5f4e0000-e29b-41d4-a716-446655441531';

let driver: LedgerDriver;
let liveToken: string;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

  const conn = await driver.acquire();
  try {
    await conn.query('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'link-mw']);
    await conn.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','imap','c','{}'::jsonb,'connected')`,
      [CONN, TENANT],
    );
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [BOX, TENANT, CONN],
    );
    await conn.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'paused')`,
      [MAPPING, TENANT, BOX],
    );
  } finally {
    conn.release();
  }

  const issued = await withTenant(driver, TENANT, (db) =>
    issueMappingLink(db, {
      tenantId: TENANT,
      mappingId: MAPPING,
      purpose: 'grant',
      createdBy: 'owner-subject',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
  );
  liveToken = issued.token;
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

/** The smallest Express surface this middleware actually touches. */
function exchange(params: Record<string, string>, query: Record<string, string> = {}) {
  const sent: { status?: number; body?: unknown } = {};
  const req = { params, query } as unknown as Request;
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;
  let nexted = false;
  const next = () => {
    nexted = true;
  };
  return { req, res, next, sent, wasAllowed: () => nexted };
}

describe('what it reads', () => {
  it('takes the secret from the named path parameter', async () => {
    const mw = authenticateMappingLink('grant', driver);
    const x = exchange({ link: liveToken });
    await mw(x.req, x.res, x.next);
    expect(x.wasAllowed()).toBe(true);
  });

  it('does NOT take it from a query string — those land in logs and Referer headers', async () => {
    const mw = authenticateMappingLink('grant', driver);
    // The same valid token, offered the wrong way. A middleware that fell back
    // to `?link=` would make every future route inherit a credential channel
    // by accident.
    const x = exchange({}, { link: liveToken });
    await mw(x.req, x.res, x.next);
    expect(x.wasAllowed()).toBe(false);
    expect(x.sent.status).toBe(401);
  });

  it('refuses an absent parameter without asking the database', async () => {
    const mw = authenticateMappingLink('grant', driver);
    const x = exchange({});
    await mw(x.req, x.res, x.next);
    expect(x.sent.status).toBe(401);
  });
});

describe('what it answers', () => {
  it('refuses a forged token with 401 and the one sentence', async () => {
    const mw = authenticateMappingLink('grant', driver);
    const x = exchange({ link: `${MAPPING}.${'f'.repeat(43)}` });
    await mw(x.req, x.res, x.next);
    expect(x.wasAllowed()).toBe(false);
    expect(x.sent.status).toBe(401);
    expect(x.sent.body).toEqual({ error: 'link_unusable', message: MAPPING_LINK_REFUSAL });
  });

  it('answers 503, NOT 401, when the check itself cannot run', async () => {
    // A database that cannot answer says nothing about the link. Reporting it
    // as unusable would send the one person who cannot fix anything off to ask
    // for a fresh link that would fail the same way.
    const broken = {
      acquire: async () => {
        throw new Error('connection refused');
      },
    } as unknown as LedgerDriver;
    const mw = authenticateMappingLink('grant', broken);
    const x = exchange({ link: liveToken });
    await mw(x.req, x.res, x.next);
    expect(x.wasAllowed()).toBe(false);
    expect(x.sent.status).toBe(503);
    expect((x.sent.body as { error: string }).error).toBe('link_check_unavailable');
  });

  it('refuses a link issued for another purpose', async () => {
    const mw = authenticateMappingLink('view', driver);
    const x = exchange({ link: liveToken });
    await mw(x.req, x.res, x.next);
    expect(x.sent.status).toBe(401);
  });
});

describe('what it attaches — a mapping, never a user', () => {
  it('names exactly the mapping, tenant, link and purpose', async () => {
    const mw = authenticateMappingLink('grant', driver);
    const x = exchange({ link: liveToken });
    await mw(x.req, x.res, x.next);

    const attached = (x.req as MappingLinkRequest).mappingLink;
    expect(attached).toEqual({
      linkId: liveToken.split('.')[0],
      mappingId: MAPPING,
      tenantId: TENANT,
      purpose: 'grant',
    });
  });

  it('attaches no identity at all — a link holder is not a user', async () => {
    const mw = authenticateMappingLink('grant', driver);
    const x = exchange({ link: liveToken });
    await mw(x.req, x.res, x.next);

    // ADR-0035: no `tenant_member` row, no password, no session, no seat. A
    // route behind this middleware must not be able to read a user off the
    // request, because there is not one.
    const req = x.req as unknown as Record<string, unknown>;
    expect(req.userId).toBeUndefined();
    expect(req.userRole).toBeUndefined();
    expect(req.userEmail).toBeUndefined();
    expect(req.tenantId).toBeUndefined();
  });
});
