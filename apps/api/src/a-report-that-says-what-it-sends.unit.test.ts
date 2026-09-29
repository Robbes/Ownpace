// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REPORT THAT SAYS WHAT IT SENDS (workplan 0130 T6, the owner's "Both parts",
 * 2026-09-28; this is Part A).
 *
 * A report said the page, the error's reference and category, the
 * organisation's id and the build, and nothing else, so support's first reply
 * was always a question: which role, is the migration paused, was access ever
 * given, is it one data type or all of them. Now the server adds the facts it
 * holds, read inside the reporter's organisation under row security, never
 * taken from the browser, and the form shows every line before it is sent.
 *
 * Driven through the real route on PGlite as `app_user`, with both migration
 * chains, so row security is in force: a migration id of another
 * organisation's reads as nothing, because the database will not hand it over.
 * `routes/a-report-that-says-what-it-sends.integration.test.ts` asks the same
 * of real Postgres, through the API's own pool.
 *
 * What is held here:
 *
 * - **a fixed list of field names.** The facts are built field by field, so a
 *   whole row cannot slip through: with every column of every table filled in,
 *   what is read has exactly the fields the list names, and every line the
 *   report carries starts with a label of its own list;
 * - **what support needs, from the records:** the role, the organisation's
 *   status and its closing dates, the migration on the page (its state, the
 *   grant given or withdrawn, a withdrawal winning over a token still stored,
 *   the newest grant link's state and never a progress link's, and each data
 *   type's state, category, side and reference, a reference the column should
 *   never hold written `unrecognised`), whether the report's reference is a
 *   current failure, the service hold, the scheduler, and the two accounts'
 *   providers and last test; and the browser, from the request's own header,
 *   on one line and capped;
 * - **never a name, an address or a provider's words.** A provider's error
 *   text, an item's name, a folder, an account's name, address and token, the
 *   organisation's name and phone, and a category nobody wrote, all planted in
 *   the rows, reach neither the preview nor the mail;
 * - **another organisation's migration gives no facts**, and its failure's
 *   reference is not a current failure here;
 * - **the fold and the mail carry the same lines**, and the Zammad article
 *   too; on sending, the facts are read again, not taken from the browser;
 * - **facts that cannot be read do not stop a report** (the owner: "Send
 *   anyway"): it goes with `Facts: could not be read [ref …]`, and the error
 *   is recorded under that reference; so does one that takes too long;
 * - **the preview is signed-in, for the reporter's organisation, and limited,**
 *   and names the support mailbox's address only when `REPORT_MAIL_TO` does:
 *   reports sent to `NOTIFY_TO`, the operator's own list, say no address.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, withTenant, issueMappingLink, expiryFromDays } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { setAppEventSink, type AppEvent, type MailTransport, type SmtpSettings } from '@openmig/shared';
import { createKnockLimiter } from './knock-limit.ts';
import { __startTheDayAgainForTests } from './services/report-channel.ts';
import { REPORT_FACT_LABELS, MAX_BROWSER_LINE } from './problem-report.ts';
import { REPORT_FACT_FIELDS, readReportFacts, reportFactsReader } from './report-facts.ts';

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  return {
    ...actual,
    // Signed in to the organisation the header names, with the role it names,
    // or not at all.
    authenticate: (
      req: Record<string, unknown> & { headers: Record<string, string> },
      res: { status: (code: number) => { json: (body: unknown) => void } },
      next: () => void,
    ) => {
      if (req.headers['x-test-user'] === 'none') {
        res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
        return;
      }
      req.userId = req.headers['x-test-user'] ?? 'user-1';
      req.userEmail = 'someone@example.invalid';
      req.tenantId = req.headers['x-test-tenant'] ?? TENANT;
      req.userRole = req.headers['x-test-role'] ?? 'admin';
      next();
    },
  };
});

const { problemReportRoutes, PROBLEM_REPORT_PREVIEW_LIMIT } = await import('./routes/problem-reports.ts');

// UUID family 0130fac7-…, unused elsewhere in the repository.
const TENANT = '0130fac7-e29b-41d4-a716-446655440001';
const OTHER = '0130fac7-e29b-41d4-a716-446655440002';
const CLOSED = '0130fac7-e29b-41d4-a716-446655440003';
const SOURCE_CONN = '0130fac7-e29b-41d4-a716-446655440011';
const TARGET_CONN = '0130fac7-e29b-41d4-a716-446655440012';
const SOURCE_BOX = '0130fac7-e29b-41d4-a716-446655440013';
const TARGET_BOX = '0130fac7-e29b-41d4-a716-446655440014';
const MAPPING = '0130fac7-e29b-41d4-a716-446655440015';
const WITHDRAWN = '0130fac7-e29b-41d4-a716-446655440016';
/** A migration whose grant was withdrawn with a token still stored, and with links of every state. */
const LINKED = '0130fac7-e29b-41d4-a716-446655440017';
const OTHER_CONN = '0130fac7-e29b-41d4-a716-446655440021';
const OTHER_BOX = '0130fac7-e29b-41d4-a716-446655440022';
const OTHER_MAPPING = '0130fac7-e29b-41d4-a716-446655440023';

/** The reference of this organisation's failing mail, and of the other's failing files. */
const OUR_FAILURE = 'a1b2c3d4';
const THEIR_FAILURE = 'b0b0b0b0';

/**
 * What must never leave the database in a report. Each one is planted where a
 * reader that took a whole row, or a column too many, would pick it up.
 */
const CANARY = {
  providerError: '550 5.7.1 rejected: /Documents/canary-tax-return-2024.pdf',
  itemName: 'Canary subject: the divorce papers',
  folder: 'Canary folder/Private',
  accountName: 'Canary account display name',
  address: 'canary.person@example.invalid',
  host: 'canary-host.example.invalid',
  token: 'canary-token-4f2a9c',
  organisationName: 'Canary Organisation BV',
  phone: '+31 6 1234 5678',
  migrationName: 'Canary migration of the director',
  category: 'canary: a category nobody wrote',
  theirs: 'Their canary: another organisation',
} as const;

const MAIL = {
  SMTP_HOST: 'smtp.example.invalid',
  SMTP_PORT: '587',
  SMTP_USER: 'relay-user@example.invalid',
  SMTP_PASSWORD: 'test-password-not-real',
  NOTIFY_FROM: 'ownpace@example.invalid',
  NOTIFY_TO: 'operator@example.invalid',
  REPORT_MAIL_TO: 'support@example.invalid',
};
const ZAMMAD = { ZAMMAD_URL: 'https://help.example.invalid', ZAMMAD_TOKEN: 'test-token-not-real' };
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';

let driver: LedgerDriver;
let events: AppEvent[];

const sql = async (text: string, params: unknown[] = []) => {
  const conn = await driver.acquire();
  try {
    return await conn.query(text, params);
  } finally {
    await conn.release();
  }
};

/** The relay, as `smtpTransport` returns it: what it was handed. */
function relay() {
  const sent: Array<Parameters<MailTransport>[0]> = [];
  const mailTransport = (_smtp: SmtpSettings, _waits: unknown): MailTransport => async (message) => {
    sent.push(message);
  };
  return { sent, mailTransport };
}

/** Zammad, answering ticket 31001, and what it was sent. */
function zammad() {
  const tickets: Array<{ article: { body: string } }> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    tickets.push(JSON.parse(String(init.body)));
    return { ok: true, status: 201, json: async () => ({ id: 7, number: '31001' }) };
  }) as unknown as typeof fetch;
  return { tickets, fetchImpl };
}

function app(deps: Parameters<typeof problemReportRoutes>[0] = {}) {
  const a = express();
  a.use(
    '/api/problem-reports',
    problemReportRoutes({
      env: MAIL,
      readFacts: reportFactsReader(() => driver),
      limiter: createKnockLimiter({ windowMs: 60_000, max: 1000 }),
      previewLimiter: createKnockLimiter({ windowMs: 60_000, max: 1000 }),
      mailCap: createKnockLimiter({ windowMs: 60_000, max: 1000 }),
      ...deps,
    }),
  );
  return a;
}

const preview = (a: express.Express, query: Record<string, string>, headers: Record<string, string> = {}) =>
  request(a)
    .get('/api/problem-reports/preview')
    .query(query)
    .set({ 'User-Agent': BROWSER, ...headers });

/** The facts a mail carries: the lines between its `---` and its `Reply to:`. */
function factsOf(body: string): string[] {
  const lines = body.split('\n');
  return lines.slice(lines.indexOf('---') + 1, lines.findIndex((l) => l.startsWith('Reply to: ')));
}

/** Every field name a value carries, dotted, with `[]` for the rows of a list. */
function fieldsOf(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => fieldsOf(v, `${at}[]`));
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).flatMap(([k, v]) => {
      const path = at ? `${at}.${k}` : k;
      const inner = fieldsOf(v, path);
      return inner.length > 0 ? inner : [path];
    });
  }
  return [];
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  await sql(
    `INSERT INTO tenant (id, name, status, settings) VALUES
       ($1, $4, 'active', $5::jsonb), ($2, $6, 'active', '{}'::jsonb), ($3, 'Closed one', 'closed', '{}'::jsonb)`,
    [TENANT, OTHER, CLOSED, CANARY.organisationName, JSON.stringify({ contact: { phone: CANARY.phone } }), CANARY.theirs],
  );
  await sql(`INSERT INTO tenant_closure (tenant_id, closed_at, purge_after, closed_by) VALUES ($1, $2, $3, $4)`, [
    CLOSED,
    '2026-09-01T10:00:00Z',
    '2026-10-01T10:00:00Z',
    CANARY.address,
  ]);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref) VALUES
       ($1, $3, 'source', 'gmail', $5, $6::jsonb, 'connected', $8),
       ($2, $3, 'target', 'nextcloud', $5, $7::jsonb, 'error', $8),
       ($4, $9, 'source', 'dropbox', $10, '{}'::jsonb, 'revoked', NULL)`,
    [
      SOURCE_CONN,
      TARGET_CONN,
      TENANT,
      OTHER_CONN,
      CANARY.accountName,
      JSON.stringify({ user: CANARY.address }),
      JSON.stringify({ host: CANARY.host, user: CANARY.address }),
      CANARY.token,
      OTHER,
      CANARY.theirs,
    ],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address, display_name) VALUES
       ($1, $3, $4, 'user', $6, $7), ($2, $3, $5, 'user', $6, $7), ($8, $9, $10, 'user', $11, $11)`,
    [
      SOURCE_BOX,
      TARGET_BOX,
      TENANT,
      SOURCE_CONN,
      TARGET_CONN,
      CANARY.address,
      CANARY.accountName,
      OTHER_BOX,
      OTHER,
      OTHER_CONN,
      CANARY.theirs,
    ],
  );
  await sql(
    `INSERT INTO mailbox_mapping
       (id, tenant_id, source_mailbox_id, target_mailbox_id, status, name, source_secret_ref,
        target_folder_prefix, source_config_override, target_config_override)
     VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8::jsonb, $8::jsonb)`,
    [
      MAPPING,
      TENANT,
      SOURCE_BOX,
      TARGET_BOX,
      CANARY.migrationName,
      CANARY.token,
      CANARY.folder,
      JSON.stringify({ user: CANARY.address, rootPath: CANARY.folder }),
    ],
  );
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, grant_withdrawn_at)
     VALUES ($1, $2, $3, 'paused', '2026-09-20T08:00:00Z')`,
    [WITHDRAWN, TENANT, SOURCE_BOX],
  );
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name)
     VALUES ($1, $2, $3, 'cutover', $4)`,
    [OTHER_MAPPING, OTHER, OTHER_BOX, CANARY.theirs],
  );
  // Withdrawn, with a token still stored beside the withdrawal: the withdrawal
  // is what holds (`viewGrantFor`). Its grant links, oldest first: one
  // revoked, one expired, and the newest grant link, used; then a progress
  // link, live, newer than all of them, which grants nothing.
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, source_secret_ref, grant_withdrawn_at)
     VALUES ($1, $2, $3, 'active', $4, '2026-09-25T09:00:00Z')`,
    [LINKED, TENANT, SOURCE_BOX, CANARY.token],
  );
  await sql(
    `INSERT INTO mapping_link
       (tenant_id, mapping_id, purpose, secret_hash, created_by, created_at, expires_at, used_at, revoked_at) VALUES
       ($1, $2, 'grant', 'hash-revoked', $3, now() - interval '4 days', now() + interval '3 days', NULL, now() - interval '4 days'),
       ($1, $2, 'grant', 'hash-expired', $3, now() - interval '3 days', now() - interval '1 day', NULL, NULL),
       ($1, $2, 'grant', 'hash-used', $3, now() - interval '2 days', now() + interval '5 days', now() - interval '1 day', NULL),
       ($1, $2, 'view', 'hash-view', $3, now() - interval '1 hour', now() + interval '30 days', NULL, NULL)`,
    [TENANT, LINKED, CANARY.address],
  );
  // Our migration: mail failing at the source, with its reference and the
  // provider's own words; calendar done; contacts failing under a category
  // somebody wrote into the column by hand, which no vocabulary has.
  await sql(
    `INSERT INTO migration_status
       (tenant_id, mapping_id, domain, state, last_error, last_error_category, failed_side,
        last_error_reference, last_pass_metrics, paused_reason) VALUES
       ($1, $2, 'email', 'failed', $3, 'auth_expired', 'source', $4, $5::jsonb, $6::jsonb),
       ($1, $2, 'calendar', 'completed', NULL, NULL, NULL, NULL, NULL, NULL),
       ($1, $2, 'contact', 'failed', $3, $7, 'target', NULL, NULL, NULL)`,
    [
      TENANT,
      MAPPING,
      CANARY.providerError,
      OUR_FAILURE,
      JSON.stringify({ note: CANARY.itemName }),
      JSON.stringify({ reason: CANARY.host }),
      CANARY.category,
    ],
  );
  await sql(
    `INSERT INTO migration_status
       (tenant_id, mapping_id, domain, state, last_error, last_error_category, failed_side, last_error_reference)
     VALUES ($1, $2, 'file', 'failed', $3, 'quota_exceeded', 'target', $4)`,
    [OTHER, OTHER_MAPPING, CANARY.theirs, THEIR_FAILURE],
  );
  await sql(
    `INSERT INTO item
       (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, display_name, status, last_error)
     VALUES ($1, $2, 'email', $3, $4, 'hash-of-canary', $4, 'failed', $5)`,
    [TENANT, MAPPING, CANARY.folder, CANARY.itemName, CANARY.providerError],
  );
  await withTenant(driver, TENANT, (db) =>
    issueMappingLink(db, {
      tenantId: TENANT,
      mappingId: MAPPING,
      purpose: 'grant',
      createdBy: CANARY.address,
      expiresAt: expiryFromDays(7),
    }),
  );
  // The scheduler ticked just now.
  await sql(
    `INSERT INTO sync_tick_beat (task, beat_at) VALUES ('managed-sync-tick', now())
       ON CONFLICT (task) DO UPDATE SET beat_at = EXCLUDED.beat_at`,
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(() => {
  events = [];
  setAppEventSink({ record: async (e) => void events.push(e) });
  __startTheDayAgainForTests();
});

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

const ON_OUR_MIGRATION = { page: `/mappings/${MAPPING}/failures`, reference: OUR_FAILURE, category: 'auth_expired' };

describe('a fixed list of field names, so a whole row cannot slip through', () => {
  it('reads only the fields the list names, and each of them, with every column of every table filled in', async () => {
    const read = (ask: { mappingId?: string; reference?: string }) =>
      withTenant(driver, TENANT, (db) => readReportFacts(db, { tenantId: TENANT, ...ask }, new Date()));
    const readings = [
      await read({ mappingId: MAPPING, reference: OUR_FAILURE }),
      await read({ mappingId: OTHER_MAPPING, reference: THEIR_FAILURE }),
      await read({}),
    ];
    for (const facts of readings) {
      for (const field of fieldsOf(facts)) {
        expect(REPORT_FACT_FIELDS, `a field the list does not name: ${field}`).toContain(field);
      }
    }
    expect([...new Set(readings.flatMap((facts) => fieldsOf(facts)))].sort()).toEqual([...REPORT_FACT_FIELDS].sort());
  });

  it('writes every line it sends under a label of its own list', async () => {
    const res = await preview(app(), ON_OUR_MIGRATION);
    expect(res.status, res.text).toBe(200);
    const labels = (res.body.lines as string[]).map((line) => line.slice(0, line.indexOf(': ')));
    for (const label of labels) expect(REPORT_FACT_LABELS, `a line with no label of the list: ${label}`).toContain(label);
  });
});

describe('what support needs, from the records', () => {
  it('names the migration on the page: its state, the grant, the grant link, and each data type', async () => {
    const res = await preview(app(), ON_OUR_MIGRATION, { 'x-test-role': 'member' });
    expect(res.status, res.text).toBe(200);
    expect(res.body.lines).toEqual([
      `Page: /mappings/${MAPPING}/failures`,
      `Reference: ${OUR_FAILURE}`,
      'Category: auth_expired',
      `Organisation: ${TENANT}`,
      expect.stringMatching(/^Build: v/),
      'Role: member',
      'Organisation status: active',
      `Migration: ${MAPPING}, active`,
      'Grant: given',
      'Grant link: live',
      'Data type calendar: completed',
      'Data type contact: failed, unrecognised category, target side',
      `Data type email: failed, auth_expired, source side, reference ${OUR_FAILURE}`,
      'Source account: gmail, connected',
      'Destination account: nextcloud, error',
      `Reference match: the current failure of email on migration ${MAPPING}`,
      'Service hold: off',
      'Scheduler: running',
      `Browser: ${BROWSER}`,
    ]);
  });

  it('says when the grant was withdrawn, no grant link was issued, and nothing is recorded yet', async () => {
    const res = await preview(app(), { page: `/mappings/${WITHDRAWN}` });
    expect(res.body.lines).toEqual(
      expect.arrayContaining([
        `Migration: ${WITHDRAWN}, paused`,
        'Grant: withdrawn on 2026-09-20',
        'Grant link: none issued',
        'Data types: none recorded yet',
        'Destination account: none',
      ]),
    );
    // And a migration that was never given access through a link.
    await sql(`UPDATE mailbox_mapping SET grant_withdrawn_at = NULL WHERE id = $1`, [WITHDRAWN]);
    try {
      const never = await preview(app(), { page: `/mappings/${WITHDRAWN}` });
      expect(never.body.lines).toContain('Grant: not given');
    } finally {
      await sql(`UPDATE mailbox_mapping SET grant_withdrawn_at = '2026-09-20T08:00:00Z' WHERE id = $1`, [WITHDRAWN]);
    }
  });

  it('reads the newest grant link and never a progress link, and a withdrawal over a token still stored', async () => {
    const res = await preview(app(), { page: `/mappings/${LINKED}` });
    expect(res.status, res.text).toBe(200);
    expect(res.body.lines).toEqual(
      expect.arrayContaining([
        `Migration: ${LINKED}, active`,
        'Grant: withdrawn on 2026-09-25',
        'Grant link: used',
        'Data types: none recorded yet',
      ]),
    );
    expect(res.text).not.toContain(CANARY.token);
  });

  it('writes a reference that is not one as unrecognised, and never what the column held', async () => {
    // The column has had a CHECK since migration 0061, so the database refuses
    // such a value today; the vetting here is the net under it. The CHECK is
    // dropped for this case only, to plant one.
    const planted = 'see /Documents/canary-contract.pdf';
    await sql(`ALTER TABLE migration_status DROP CONSTRAINT migration_status_last_error_reference_check`);
    try {
      await sql(
        `INSERT INTO migration_status
           (tenant_id, mapping_id, domain, state, last_error_category, failed_side, last_error_reference)
         VALUES ($1, $2, 'file', 'failed', 'quota_exceeded', 'target', $3)`,
        [TENANT, LINKED, planted],
      );
      const res = await preview(app(), { page: `/mappings/${LINKED}` });
      expect(res.body.lines).toContain('Data type file: failed, quota_exceeded, target side, reference unrecognised');
      expect(res.text).not.toContain('canary-contract');
    } finally {
      await sql(`DELETE FROM migration_status WHERE mapping_id = $1`, [LINKED]);
      await sql(
        `ALTER TABLE migration_status ADD CONSTRAINT migration_status_last_error_reference_check
           CHECK (last_error_reference IS NULL OR last_error_reference ~ '^[0-9a-f]{8}$')`,
      );
    }
  });

  it('says when the page names no migration, and when the reference is not a current failure', async () => {
    const res = await preview(app(), { page: '/connections', reference: 'f0f0f0f0' });
    expect(res.body.lines).toEqual(
      expect.arrayContaining(['Migration: none on this page', 'Reference match: none, not a current failure']),
    );
  });

  it("says the organisation is closed, and when it closed and will be removed, and the reporter's role", async () => {
    const res = await preview(app(), { page: '/' }, { 'x-test-tenant': CLOSED, 'x-test-role': 'owner' });
    expect(res.body.lines).toEqual(
      expect.arrayContaining([
        'Role: owner',
        `Organisation: ${CLOSED}`,
        'Organisation status: closed (closed on 2026-09-01, removed after 2026-10-01)',
      ]),
    );
    expect(res.text).not.toContain(CANARY.address);
  });

  it('says whether the service is on hold, since when, and whether the scheduler is running', async () => {
    await sql(`INSERT INTO platform_pause (started_at, started_by, message) VALUES ('2026-09-28T12:34:00Z', $1, $2)`, [
      'operator-sub',
      'Planned maintenance',
    ]);
    await sql(`UPDATE sync_tick_beat SET beat_at = now() - interval '1 hour'`);
    try {
      const res = await preview(app(), { page: '/' });
      expect(res.body.lines).toEqual(
        expect.arrayContaining(['Service hold: on since 2026-09-28 12:34 UTC', 'Scheduler: not running']),
      );
      expect(res.text).not.toContain('Planned maintenance');
    } finally {
      await sql(`UPDATE platform_pause SET ended_at = now(), ended_by = 'operator-sub' WHERE ended_at IS NULL`);
      await sql(`UPDATE sync_tick_beat SET beat_at = now()`);
    }
  });

  it("takes the role from the session and the browser from the request's header, on one line and capped", async () => {
    // A header cannot carry a line break (Node refuses to send one), but it can
    // carry a tab and a C1 control character, which a mail client may show
    // as a break.
    const long = `${BROWSER}\t\u0085X-Injected: yes ${'x'.repeat(2000)}`;
    const res = await preview(app(), { page: '/', role: 'owner' }, { 'x-test-role': 'viewer', 'User-Agent': long });
    const browser = (res.body.lines as string[]).find((l) => l.startsWith('Browser: '))!;
    expect(res.body.lines).toContain('Role: viewer');
    expect(browser).not.toMatch(/[\p{Cc}\u2028\u2029]/u);
    expect(browser.length).toBeLessThanOrEqual('Browser: '.length + MAX_BROWSER_LINE);
    expect(browser.startsWith(`Browser: ${BROWSER} X-Injected: yes`)).toBe(true);
    const none = await request(app()).get('/api/problem-reports/preview').query({ page: '/' }).unset('User-Agent');
    expect(none.body.lines).toContain('Browser: not given');
  });
});

describe('never a name, an address or a provider’s words', () => {
  it('sends none of what was planted, in the preview or in the mail', async () => {
    const { sent, mailTransport } = relay();
    const a = app({ mailTransport });
    const shown = await preview(a, ON_OUR_MIGRATION);
    const res = await request(a)
      .post('/api/problem-reports')
      .set('User-Agent', BROWSER)
      .send({ description: 'It stopped', ...ON_OUR_MIGRATION });
    expect(res.status, res.text).toBe(201);
    // The facts are there, so their absence below is not a report that read nothing.
    expect(sent[0]!.body).toContain(`Migration: ${MAPPING}, active`);
    for (const text of [shown.text, JSON.stringify(sent[0])]) {
      for (const [what, canary] of Object.entries(CANARY)) {
        expect(text, `${what} reached the report`).not.toContain(canary);
      }
    }
  });
});

describe("another organisation's migration gives no facts", () => {
  it('reads nothing of it, and its failure is not a current failure here', async () => {
    const res = await preview(app(), { page: `/mappings/${OTHER_MAPPING}`, reference: THEIR_FAILURE });
    expect(res.status, res.text).toBe(200);
    expect(res.body.lines).toEqual(
      expect.arrayContaining([
        `Migration: ${OTHER_MAPPING} is not one of this organisation's`,
        'Reference match: none, not a current failure',
      ]),
    );
    const text = (res.body.lines as string[]).join('\n');
    for (const theirs of ['cutover', 'dropbox', 'revoked', 'Data type file', 'quota_exceeded', CANARY.theirs]) {
      expect(text, `the other organisation's ${theirs} reached the report`).not.toContain(theirs);
    }
    expect(text).not.toMatch(/^(Grant|Grant link|Data type|Source account|Destination account)/m);
  });
});

describe('the fold and the mail carry the same lines', () => {
  it('in the mail, as the preview showed them', async () => {
    const { sent, mailTransport } = relay();
    const a = app({ mailTransport });
    const shown = await preview(a, ON_OUR_MIGRATION);
    await request(a)
      .post('/api/problem-reports')
      .set('User-Agent', BROWSER)
      .send({ description: 'It stopped', ...ON_OUR_MIGRATION })
      .expect(201);
    expect(factsOf(sent[0]!.body)).toEqual(shown.body.lines);
    expect(shown.body.to).toEqual({ kind: 'mail', addresses: ['support@example.invalid'] });
  });

  it('in the Zammad article, which says the helpdesk', async () => {
    const { tickets, fetchImpl } = zammad();
    const a = app({ env: ZAMMAD, fetchImpl });
    const shown = await preview(a, ON_OUR_MIGRATION);
    expect(shown.body.to).toEqual({ kind: 'helpdesk' });
    await request(a)
      .post('/api/problem-reports')
      .set('User-Agent', BROWSER)
      .send({ description: 'It stopped', ...ON_OUR_MIGRATION })
      .expect(201);
    const body = tickets[0]!.article.body;
    expect(body.split('\n').slice(body.split('\n').indexOf('---') + 1)).toEqual(shown.body.lines);
  });

  it('reads them again on sending, and takes none from the browser', async () => {
    const { sent, mailTransport } = relay();
    const a = app({ mailTransport });
    await sql(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [MAPPING]);
    try {
      await request(a)
        .post('/api/problem-reports')
        .set('User-Agent', BROWSER)
        .send({
          description: 'It stopped',
          ...ON_OUR_MIGRATION,
          role: 'owner',
          lines: ['Grant: given', 'Organisation status: active'],
          facts: { migration: { state: 'done' } },
        })
        .expect(201);
    } finally {
      await sql(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [MAPPING]);
    }
    const facts = factsOf(sent[0]!.body);
    expect(facts).toContain(`Migration: ${MAPPING}, paused`);
    expect(facts).toContain('Role: admin');
    expect(facts.filter((l) => l.startsWith('Organisation status: '))).toEqual(['Organisation status: active']);
    expect(sent[0]!.body).not.toContain('done');
  });
});

describe('facts that cannot be read do not stop a report', () => {
  it('sends it with the line, records the error under that reference, and the preview says the same', async () => {
    const { sent, mailTransport } = relay();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = app({
      mailTransport,
      readFacts: async () => {
        throw new Error('connection terminated unexpectedly');
      },
    });
    const res = await request(a)
      .post('/api/problem-reports')
      .set('User-Agent', BROWSER)
      .send({ description: 'It stopped', page: '/' });
    expect(res.status, res.text).toBe(201);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: 'error', event: 'report.facts-unread', tenantId: TENANT });
    const facts = factsOf(sent[0]!.body);
    expect(facts).toContain(`Facts: could not be read [ref ${events[0]!.reference}]`);
    // What the server knows without the database still goes.
    expect(facts).toEqual(expect.arrayContaining(['Page: /', 'Role: admin', `Browser: ${BROWSER}`]));
    expect(facts.some((l) => l.startsWith('Organisation status: '))).toBe(false);

    const shown = await preview(a, { page: '/' });
    expect(shown.status).toBe(200);
    expect(shown.body.lines).toContain(`Facts: could not be read [ref ${events[1]!.reference}]`);
  });

  it('sends it when the facts take too long to read', async () => {
    const { sent, mailTransport } = relay();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app({ mailTransport, readFacts: () => new Promise(() => {}), factsDeadlineMs: 50 }))
      .post('/api/problem-reports')
      .send({ description: 'It stopped', page: '/' });
    expect(res.status, res.text).toBe(201);
    expect(events.map((e) => e.event)).toEqual(['report.facts-unread']);
    expect(factsOf(sent[0]!.body)).toContain(`Facts: could not be read [ref ${events[0]!.reference}]`);
  });
});

describe('the preview is signed-in, for the reporter’s organisation, and limited', () => {
  it('asks for sign-in', async () => {
    const res = await preview(app(), { page: '/' }, { 'x-test-user': 'none' });
    expect(res.status).toBe(401);
  });

  it('refuses a page or a reference that is not one, as the report does', async () => {
    expect((await preview(app(), { page: 'https://elsewhere.example.invalid/' })).body).toMatchObject({
      error: 'invalid_report',
      field: 'page',
    });
    expect((await preview(app(), { page: '/', reference: 'nope' })).body).toMatchObject({ field: 'reference' });
  });

  it('shows the page without a link secret or a query, as the report does', async () => {
    const res = await preview(app(), { page: '/grant/abc.secret/google?code=x' });
    expect(res.body.lines[0]).toBe('Page: /grant/:link/google?...');
    expect(res.text).not.toContain('abc.secret');
  });

  it("names no address when reports go to the operator's own, to a viewer or anybody, and still sends there", async () => {
    const withoutSupport = Object.fromEntries(Object.entries(MAIL).filter(([key]) => key !== 'REPORT_MAIL_TO'));
    for (const env of [{ ...MAIL, REPORT_MAIL_TO: '' }, { ...MAIL, REPORT_MAIL_TO: '  ' }, withoutSupport]) {
      const { sent, mailTransport } = relay();
      const a = app({ env, mailTransport });
      const res = await preview(a, { page: '/' }, { 'x-test-role': 'viewer' });
      expect(res.status, res.text).toBe(200);
      expect(res.body.to).toEqual({ kind: 'mail' });
      expect(res.text).not.toContain(MAIL.NOTIFY_TO);
      await request(a).post('/api/problem-reports').send({ description: 'It stopped', page: '/' }).expect(201);
      expect(sent[0]!.to).toEqual([MAIL.NOTIFY_TO]);
    }
  });

  it('answers 503 on a service that takes no reports', async () => {
    expect((await preview(app({ env: {} }), { page: '/' })).status).toBe(503);
  });

  it("answers a person's previews up to the hour's limit, and then 429 with Retry-After", async () => {
    const a = app({ previewLimiter: createKnockLimiter({ windowMs: 60_000, max: 2 }) });
    expect((await preview(a, { page: '/' })).status).toBe(200);
    expect((await preview(a, { page: '/' })).status).toBe(200);
    const third = await preview(a, { page: '/' });
    expect(third.status).toBe(429);
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    expect((await preview(a, { page: '/' }, { 'x-test-user': 'user-2' })).status).toBe(200);
    expect(PROBLEM_REPORT_PREVIEW_LIMIT.max).toBeGreaterThanOrEqual(30);
  });
});

