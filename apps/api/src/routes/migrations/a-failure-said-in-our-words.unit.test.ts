// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILURE SAID IN OUR WORDS (workplan 0136 T3, the second step).
 *
 * T3's first step stopped the managed Test button reading aloud what a host a
 * tester typed answered. A pass records the same messages: a DAV writer puts
 * the response body into its refusal, the refusal is the item's `last_error`,
 * and the failures route returned it to the organisation. So did the
 * migration page's failure line, the completion report, the confirm screen's
 * counts and the runs panel. Slower than a Test button, and the same bytes.
 *
 * WHAT THIS HOLDS, through the real routes over a real in-process ledger:
 *
 * - a stored refusal whose body is an HTML page, JSON of another shape, or
 *   plain text reaches no answer: our prose before the status stays, and the
 *   body is said as *"something that is not a DAV, JMAP or IMAP error"*;
 * - a GData 403, a Google JSON 400 and a Sabre 500 keep their code and
 *   message, as the stored text carries them;
 * - a socket error is said without the name it tried, and the rule's refusal
 *   (0136 T1) without the host;
 * - our own refusals, and an IMAP server's `NO`, read as they were stored;
 * - a source refusal from a provider's fixed host keeps its words, as the
 *   first step left them (0080, 0115 T5);
 * - a group decision matches its substring against what the page shows, so
 *   the count it answers cannot read the hidden text one guess at a time;
 * - the Check page's report (an issue that quotes the target, a
 *   recommendation, a failed scan's error) and an apply receipt's error
 *   answer the same way (found in review of the second step);
 * - and the ledger keeps the full text: every row still holds every byte
 *   after the routes answered. No route serves an item's full text to the
 *   operator; the operator reads it on the database. That is also the
 *   control, the proof that each case had the bytes to leak.
 *
 * It fails if an answer carries the remote's body.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';

// UUID family 0136f300-…, unused elsewhere in the repo.
const TENANT = '0136f300-e29b-41d4-a716-446655440001';
const SOURCE = '0136f300-e29b-41d4-a716-446655440011';
const TARGET = '0136f300-e29b-41d4-a716-446655440012';
const GMAIL = '0136f300-e29b-41d4-a716-446655440013';
const SOURCE_BOX = '0136f300-e29b-41d4-a716-446655440021';
const TARGET_BOX = '0136f300-e29b-41d4-a716-446655440022';
const GMAIL_BOX = '0136f300-e29b-41d4-a716-446655440023';
const MAPPING = '0136f300-e29b-41d4-a716-446655440031';
const FIXED = '0136f300-e29b-41d4-a716-446655440032';
const RUN = '0136f300-e29b-41d4-a716-446655440041';

/** A string no answer may carry, planted in every hostile body. */
const MARKER = 'an-internal-admin-page-7f3a';

/** Our sentence for a body that is no error document we know. */
const NOT_A_DOCUMENT = 'not a DAV, JMAP or IMAP error';

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

/**
 * Each failure as a pass stores it, in the shapes the real throw sites write:
 * `davRefusalBody` has already taken the GData and Sabre envelopes off, and
 * left every other body as it came.
 */
const STORED = {
  html: {
    category: 'target_refused',
    text:
      `PUT failed for /remote.php/dav/files/u/report.pdf with status 500: ` +
      `<html><head><title>${MARKER}</title></head><body><h1>${MARKER}</h1></body></html>`,
  },
  json: {
    category: 'unknown',
    text: `PROPFIND failed with status 200: {"status":"ok","service":"${MARKER}","version":3}`,
  },
  plain: {
    category: 'target_refused',
    text: `MKCOL failed for /remote.php/dav/files/u/a with status 403: forbidden by ${MARKER}`,
  },
  jmap: {
    category: 'unknown',
    text: `File blob upload failed: HTTP 502 - <html><body>${MARKER}</body></html>`,
  },
  gdata: {
    category: 'target_refused',
    text:
      'PROPFIND failed with status 403: accessNotConfigured — CalDAV API has not been used in ' +
      'project 123 before or it is disabled.',
  },
  googleJson: {
    category: 'target_refused',
    text:
      'addressbook-query REPORT failed with status 400: { "error": { "code": 400, "message": ' +
      '"Request contains an invalid argument.", "status": "INVALID_ARGUMENT" } }',
  },
  sabre: {
    category: 'target_refused',
    text:
      'PUT failed for /remote.php/dav/addressbooks/users/u/contacts/x.vcf with status 500: ' +
      'Sabre\\DAV\\Exception\\BadRequest — Invalid vCard: the FN property is missing',
  },
  socket: { category: 'network', text: `getaddrinfo ENOTFOUND ${MARKER}` },
  rule: {
    category: 'unknown',
    text:
      `${MARKER}.example is an address inside this service's own network, so we do not ` +
      'connect to it. Give the address the server has on the internet.',
  },
  ours: {
    category: 'too_large',
    text: 'The file is larger than one pass here may carry. Copy it by hand.',
  },
  imapNo: { category: 'target_refused', text: 'NO [OVERQUOTA] Mailbox is full' },
} as const;

type Case = keyof typeof STORED;

/** The case a row's hash names. */
const hashOf = (c: Case): string => `0136f3-${c}`;

/** A target listing that threw, as `verification.ts` quotes it into an issue. */
const UNREAD_ISSUE =
  '3 contact item(s) were copied, but the target could not be read for this domain: PROPFIND on / ' +
  `failed with status 500: <html><title>${MARKER}</title></html>. Cutover is blocked: their ` +
  'completeness is unknown.';

/** A failed removal, as `dav-remove.ts` throws it and the apply job lands it. */
const REMOVAL_FAILED = `DELETE https://dav.example.invalid/remote.php/dav/files/u/a.pdf failed with status 500: <html>${MARKER}</html>`;

/** A Google source's own refusal: its fixed host, so its words stay (0080). */
const FIXED_SOURCE_TEXT = `Gmail answered 500: <html>Google's own page, ${MARKER}</html>`;

async function failed(mapping: string, hash: string, domain: string, category: string, text: string) {
  await sql(
    `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
                       size_bytes, status, attempt_count, parked_at, last_error, last_error_category)
     VALUES ($1,$2,$3,'c',$4,$4,0,'failed',5,now(),$5,$6)`,
    [TENANT, mapping, domain, hash, text, category],
  );
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'our words']);
  // A source and a target whose hosts the tester typed, and a Gmail source,
  // whose host is Google's.
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
       ($1,$4,'source','imap','typed source','{"host":"mail.example.invalid"}'::jsonb,'connected'),
       ($2,$4,'target','webdav','typed target','{"url":"https://dav.example.invalid/remote.php/dav"}'::jsonb,'connected'),
       ($3,$4,'source','gmail','google source','{}'::jsonb,'connected')`,
    [SOURCE, TARGET, GMAIL, TENANT],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
       ($1,$4,$5,'user','m@example.invalid'),
       ($2,$4,$6,'user','t@example.invalid'),
       ($3,$4,$7,'user','g@example.invalid')`,
    [SOURCE_BOX, TARGET_BOX, GMAIL_BOX, TENANT, SOURCE, TARGET, GMAIL],
  );
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status) VALUES
       ($1,$3,$4,$5,'active'),
       ($2,$3,$6,$5,'active')`,
    [MAPPING, FIXED, TENANT, SOURCE_BOX, TARGET_BOX, GMAIL_BOX],
  );
  await sql(
    `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES
       ($1,$2,'contact',true), ($1,$2,'email',true), ($1,$3,'email',true)`,
    [TENANT, MAPPING, FIXED],
  );
  for (const [c, { category, text }] of Object.entries(STORED) as Array<[Case, (typeof STORED)[Case]]>) {
    await failed(MAPPING, hashOf(c), 'contact', category, text);
  }
  await failed(FIXED, '0136f3-fixed', 'email', 'source_refused', FIXED_SOURCE_TEXT);

  // The data type's own failure line, as the pass records it.
  await sql(
    `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, last_error,
                                   last_error_category, failed_side, last_error_reference)
     VALUES ($1,$2,'contact','failed',$3,'target_refused','target','0136f3aa'),
            ($1,$4,'email','failed',$5,'source_refused','source','0136f3bb')`,
    [TENANT, MAPPING, `contact: 25 items failed in a row. Last error: ${STORED.html.text}`, FIXED, FIXED_SOURCE_TEXT],
  );
  // A count that stopped, on the confirm screen.
  await sql(
    `INSERT INTO migration_discovery (tenant_id, mapping_id, domain, collections, items, bytes, last_error)
     VALUES ($1,$2,'email',0,0,0,$3)`,
    [TENANT, MAPPING, `LIST answered 500: <html>${MARKER}</html>`],
  );
  // The runs panel, where a failed data type is logged in full.
  await sql(
    `INSERT INTO run (id, tenant_id, mapping_id, kind, status) VALUES ($1,$2,$3,'incremental','failed')`,
    [RUN, TENANT, MAPPING],
  );
  await sql(
    `INSERT INTO run_event (tenant_id, run_id, level, message) VALUES
       ($1,$2,'info','pass started'),
       ($1,$2,'error',$3)`,
    [TENANT, RUN, `contact sync failed: ${STORED.html.text}`],
  );
  // The Check page: a done report whose issue quotes the target, and a failed
  // scan on the other migration.
  const report = {
    [MAPPING]: {
      contact: {
        dataType: 'contact',
        status: 'NOT_VERIFIABLE',
        issues: [{ id: 'TARGET_UNREAD_contact', severity: 'ERROR', message: UNREAD_ISSUE }],
      },
      calendar: {
        dataType: 'calendar',
        status: 'NOT_VERIFIABLE',
        issues: [
          {
            id: 'TARGET_UNREAD_calendar',
            severity: 'ERROR',
            message: `1 calendar item(s) were copied, but the target could not be read for this domain: ${STORED.sabre.text}`,
          },
        ],
      },
      recommendations: [
        'Cannot verify contact: the new system did not answer for it (the issue quotes its answer). Put that right and verify again.',
        `contact was not verified: ${UNREAD_ISSUE}`,
      ],
      canProceedToCutover: false,
    },
  };
  await sql(
    `INSERT INTO verification_run (tenant_id, mapping_id, state, finished_at, report)
     VALUES ($1,$2,'done',now(),$3::jsonb)`,
    [TENANT, MAPPING, JSON.stringify(report)],
  );
  await sql(
    `INSERT INTO verification_run (tenant_id, mapping_id, state, finished_at, error)
     VALUES ($1,$2,'failed',now(),$3)`,
    [TENANT, FIXED, STORED.html.text],
  );
  // Apply receipts: a removal and a move that failed on the target, and a
  // refusal of ours.
  await sql(
    `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, action, state, finished_at, code, reason)
     VALUES ($1,$2,'0136f3-gone','deletion','failed',now(),NULL,$3),
            ($1,$2,'0136f3-moved','relocation','failed',now(),NULL,$4),
            ($1,$2,'0136f3-edited','deletion','refused',now(),'edited_on_target',$5)`,
    [TENANT, MAPPING, REMOVAL_FAILED, STORED.html.text, `The copy changed on the new system since we wrote it (${MARKER}).`],
  );
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

type Item = { naturalKeyHash: string; lastError: string };

async function failures(mapping = MAPPING): Promise<Record<string, string>> {
  const res = await request(app).get(`/api/migrations/${mapping}/failures`);
  expect(res.status).toBe(200);
  const queue = res.body[mapping] as { needsDecision: Item[]; retrying: Item[] };
  return Object.fromEntries([...queue.needsDecision, ...queue.retrying].map((f) => [f.naturalKeyHash, f.lastError]));
}

describe('the failures route answers in our words (0136 T3, second step)', () => {
  it('carries none of the bytes of an HTML page, JSON of another shape, or plain text', async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING}/failures`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
  });

  it('keeps our prose and the status, and says the body is no error document', async () => {
    const said = await failures();
    expect(said[hashOf('html')]).toBe(
      'PUT failed for /remote.php/dav/files/u/report.pdf with status 500: the server answered with ' +
        `something that is ${NOT_A_DOCUMENT}.`,
    );
    expect(said[hashOf('json')]).toContain('status 200: ');
    expect(said[hashOf('json')]).toContain(NOT_A_DOCUMENT);
    expect(said[hashOf('plain')]).toContain('status 403: ');
    expect(said[hashOf('plain')]).toContain(NOT_A_DOCUMENT);
    expect(said[hashOf('jmap')]).toBe(`File blob upload failed: HTTP 502 - the server answered with something that is ${NOT_A_DOCUMENT}.`);
  });

  it('keeps the code and message of a GData 403, a Google JSON 400 and a Sabre 500', async () => {
    const said = await failures();
    expect(said[hashOf('gdata')]).toBe(STORED.gdata.text);
    expect(said[hashOf('googleJson')]).toBe(
      'addressbook-query REPORT failed with status 400: INVALID_ARGUMENT — Request contains an invalid argument.',
    );
    expect(said[hashOf('sabre')]).toBe(STORED.sabre.text);
  });

  it('says a socket error without the name it tried, and the rule refusal without the host', async () => {
    const said = await failures();
    expect(said[hashOf('socket')]).toMatch(/^Nothing answered at that address/);
    expect(said[hashOf('rule')]).toMatch(/^That address is inside this service's own network/);
  });

  it('reads our own refusal, and an IMAP server\'s NO, as they were stored', async () => {
    const said = await failures();
    expect(said[hashOf('ours')]).toBe(STORED.ours.text);
    expect(said[hashOf('imapNo')]).toBe(STORED.imapNo.text);
  });

  it("keeps a provider's fixed host's words on its own source refusal", async () => {
    const said = await failures(FIXED);
    expect(said['0136f3-fixed']).toBe(FIXED_SOURCE_TEXT);
  });
});

describe('the other routes that carry a failure answer the same way', () => {
  it("the migration page's failure line", async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    const contact = (res.body.domainStatus as Array<{ domain: string; lastError?: string; lastErrorReference?: string }>).find(
      (d) => d.domain === 'contact',
    );
    expect(contact?.lastError).toContain('items failed in a row. Last error: PUT failed for');
    expect(contact?.lastError).toContain(NOT_A_DOCUMENT);
    // The reference the full text was logged under rides beside it, as before.
    expect(contact?.lastErrorReference).toBe('0136f3aa');
  });

  it("the migration page keeps a fixed host's words on a source failure", async () => {
    const res = await request(app).get(`/api/migrations/${FIXED}`);
    expect(res.status).toBe(200);
    const email = (res.body.domainStatus as Array<{ domain: string; lastError?: string }>).find((d) => d.domain === 'email');
    expect(email?.lastError).toBe(FIXED_SOURCE_TEXT);
  });

  it('the completion report, its JSON and its Markdown', async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING}/completion-report`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    const contact = (res.body.report.domains as Array<{ domain: string; lastError?: string }>).find(
      (d) => d.domain === 'contact',
    );
    expect(contact?.lastError).toContain(NOT_A_DOCUMENT);
  });

  it("the confirm screen's counts", async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING}/discovery`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    const email = (res.body.domains as Array<{ domain: string; lastError?: string }>).find((d) => d.domain === 'email');
    expect(email?.lastError).toBe(`LIST answered 500: the server answered with something that is ${NOT_A_DOCUMENT}.`);
  });

  it('the runs panel', async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING}/runs`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    const messages = (res.body.runs as Array<{ events: Array<{ message: string }> }>).flatMap((r) =>
      r.events.map((e) => e.message),
    );
    expect(messages).toContain('pass started');
    expect(messages.some((m) => m.startsWith('contact sync failed: PUT failed for') && m.includes(NOT_A_DOCUMENT))).toBe(true);
  });
});

describe('a group decision matches what the page shows', () => {
  it('reaches nothing with a substring of the text the page does not show', async () => {
    const res = await request(app)
      .post(`/api/migrations/${MAPPING}/failures`)
      .send({ action: 'retry', errorContains: MARKER });
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(0);
  });

  it('and within the category it names', async () => {
    const res = await request(app)
      .post(`/api/migrations/${MAPPING}/failures`)
      .send({ action: 'retry', category: 'unknown', errorContains: NOT_A_DOCUMENT });
    expect(res.status).toBe(200);
    // The JSON of another shape and the JMAP upload; the HTML and plain text are target refusals.
    expect(res.body.matched).toBe(2);
  });

  it('reaches exactly the rows whose shown text holds the substring', async () => {
    const shown = Object.values(await failures()).filter((t) => t.includes(NOT_A_DOCUMENT)).length;
    expect(shown).toBe(4);
    const res = await request(app)
      .post(`/api/migrations/${MAPPING}/failures`)
      .send({ action: 'retry', errorContains: NOT_A_DOCUMENT });
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(shown);
    // A retry reset them, and nothing else.
    const reset = await sql(
      `SELECT natural_key_hash FROM item WHERE tenant_id = $1 AND mapping_id = $2 AND attempt_count = 0 ORDER BY 1`,
      [TENANT, MAPPING],
    );
    expect(reset.map((r) => r.natural_key_hash)).toEqual(
      [hashOf('html'), hashOf('jmap'), hashOf('json'), hashOf('plain')].sort(),
    );
  });
});

describe('the Check page and the apply receipts answer the same way (review of the second step)', () => {
  it("the Check page's report: an issue that quotes the target, and a recommendation that repeats it", async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING}/verify/report`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('done');
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    const result = res.body.report[MAPPING] as {
      contact: { issues: Array<{ message: string }> };
      calendar: { issues: Array<{ message: string }> };
      recommendations: string[];
    };
    expect(result.contact.issues[0]?.message).toBe(
      '3 contact item(s) were copied, but the target could not be read for this domain: PROPFIND on / ' +
        `failed with status 500: the server answered with something that is ${NOT_A_DOCUMENT}.`,
    );
    // A Sabre refusal keeps its words, as on the queue.
    expect(result.calendar.issues[0]?.message).toContain(STORED.sabre.text);
    expect(result.recommendations[0]).toMatch(/^Cannot verify contact: the new system did not answer/);
    expect(result.recommendations[1]).toContain(NOT_A_DOCUMENT);
  });

  it("a failed scan's error", async () => {
    const res = await request(app).get(`/api/migrations/${FIXED}/verify/report`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('failed');
    expect(res.body.error).toBe(
      `PUT failed for /remote.php/dav/files/u/report.pdf with status 500: the server answered with something that is ${NOT_A_DOCUMENT}.`,
    );
  });

  it("a failed removal's receipt, and a failed move's", async () => {
    const gone = await request(app).get(`/api/migrations/${MAPPING}/deletions/0136f3-gone/receipt`);
    expect(gone.status).toBe(200);
    expect(gone.body.state).toBe('failed');
    expect(gone.body.error).toBe(
      'DELETE https://dav.example.invalid/remote.php/dav/files/u/a.pdf failed with status 500: ' +
        `the server answered with something that is ${NOT_A_DOCUMENT}.`,
    );
    const moved = await request(app).get(`/api/migrations/${MAPPING}/moves/0136f3-moved/receipt`);
    expect(moved.status).toBe(200);
    expect(moved.body.state).toBe('failed');
    expect(JSON.stringify(moved.body)).not.toContain(MARKER);
    expect(moved.body.error).toContain(NOT_A_DOCUMENT);
  });

  it('a refusal of ours on a receipt reads as we wrote it', async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING}/deletions/0136f3-edited/receipt`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('refused');
    expect(res.body.reason).toBe(`The copy changed on the new system since we wrote it (${MARKER}).`);
  });
});

describe("the appliance's owner keeps the full text", () => {
  // Read as text: the appliance needs a config directory and its own ledger to
  // boot, and the property is that its queue passes the ledger's rows through.
  // Its only user is its owner, who is its operator, as T3's first step left
  // it: nothing in `apps/selfhost` calls the probe's answer either.
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
  const appliance = readFileSync(join(ROOT, 'apps/selfhost/src/index.ts'), 'utf8');

  it("serves the ledger's failure rows as they are", () => {
    const at = appliance.indexOf("req.url === '/failures'");
    expect(at, 'no GET /failures on the appliance').toBeGreaterThan(-1);
    const queue = appliance.slice(at, appliance.indexOf('return sendJson(res, 200, out);', at));
    expect(queue).toMatch(/const failures = await ledger\.listFailures\(/);
    expect(queue).toMatch(/needsDecision: failures\.filter\(\(f\) => f\.needsDecision\)/);
    expect(queue).toMatch(/retrying: failures\.filter\(\(f\) => !f\.needsDecision\)/);
  });

  it('never loads the managed answer', () => {
    for (const name of readdirSync(join(ROOT, 'apps/selfhost/src'))) {
      if (!name.endsWith('.ts')) continue;
      const text = readFileSync(join(ROOT, 'apps/selfhost/src', name), 'utf8');
      expect(text, name).not.toMatch(/failure-answer|failureInOurWords|probe-answer/);
    }
  });
});

describe('the ledger keeps the full text', () => {
  // No route serves an item's full text to the operator: the operator reads
  // it on the database, by the item's `naturalKeyHash`, and a data type's
  // under the `lastErrorReference` the pass logged it with.
  it('every row still holds every byte the routes did not answer with', async () => {
    const items = await sql(`SELECT natural_key_hash, last_error FROM item WHERE tenant_id = $1`, [TENANT]);
    const stored = Object.fromEntries(items.map((r) => [r.natural_key_hash, r.last_error]));
    for (const [c, { text }] of Object.entries(STORED) as Array<[Case, (typeof STORED)[Case]]>) {
      expect(stored[hashOf(c)], c).toBe(text);
    }
    const [status] = await sql(
      `SELECT last_error FROM migration_status WHERE tenant_id = $1 AND mapping_id = $2 AND domain = 'contact'`,
      [TENANT, MAPPING],
    );
    expect(status?.last_error).toContain(MARKER);
    const [discovery] = await sql(`SELECT last_error FROM migration_discovery WHERE tenant_id = $1`, [TENANT]);
    expect(discovery?.last_error).toContain(MARKER);
    const events = await sql(`SELECT message FROM run_event WHERE tenant_id = $1 AND level = 'error'`, [TENANT]);
    expect(events[0]?.message).toContain(MARKER);
    const runs = await sql(`SELECT report::text AS report, error FROM verification_run WHERE tenant_id = $1`, [TENANT]);
    expect(runs.some((r) => String(r.report).includes(MARKER))).toBe(true);
    expect(runs.some((r) => String(r.error).includes(MARKER))).toBe(true);
    const receipts = await sql(`SELECT reason FROM apply_receipt WHERE tenant_id = $1 AND state = 'failed'`, [TENANT]);
    expect(receipts).toHaveLength(2);
    for (const r of receipts) expect(r.reason).toContain(MARKER);
  });
});
