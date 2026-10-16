// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARE REFUSED, SAID IN OUR WORDS (workplan 0136 T3, a share's refusal on
 * apply).
 *
 * T3 stopped the managed Test button, and then the failures a pass records,
 * reading aloud what a host a tester typed answered. One door was left: when
 * applying a share was refused, the API answered with what the target's OCS
 * endpoint said (`OCS answered 404: User does not exist`), and with the first
 * 300 characters of the body when OCS sent no message. So a tester who named
 * any address as their Nextcloud could read what answered there by pressing
 * Apply on the Sharing page.
 *
 * WHAT THIS HOLDS, through the real routes over a real in-process ledger,
 * against a server on this machine that answers as Nextcloud (or not):
 *
 * - on each of the three doors that apply a share (`…/sharing/:grantId/decision`,
 *   `apply-all`, `apply-folder`), none of the server's bytes reach the answer:
 *   not OCS's message, not an HTML page;
 * - the refusal is our sentence, chosen by what failed (the status and OCS's
 *   code), in English as `reason` and in Dutch as `reasonNl`, each ending
 *   with the reference;
 * - and the operator keeps the full text: the log line carries the server's
 *   words under that reference, and never the password the share was made
 *   with. The log line is also the control, the proof that each case reached
 *   the server and had the bytes to leak.
 *
 * It fails if an answer carries the remote's words.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { log, shareRefusalSaid, type ShareRefused } from '@openmig/shared';

// UUID family 0136f5a0-…, unused elsewhere in the repo.
const TENANT = '0136f5a0-e29b-41d4-a716-446655440001';
const SOURCE = '0136f5a0-e29b-41d4-a716-446655440011';
const TARGET = '0136f5a0-e29b-41d4-a716-446655440012';
const SOURCE_BOX = '0136f5a0-e29b-41d4-a716-446655440021';
const TARGET_BOX = '0136f5a0-e29b-41d4-a716-446655440022';
const MAPPING = '0136f5a0-e29b-41d4-a716-446655440031';
const ONE_ROW = '0136f5a0-e29b-41d4-a716-446655440041';
const FOLDER = '0136f5a0-e29b-41d4-a716-446655440042';
const IN_FOLDER = '0136f5a0-e29b-41d4-a716-446655440043';

/** A string no answer may carry, planted in everything the server says. */
const MARKER = 'an-internal-admin-page-7f3a';
/** The target's password: in no answer and in no log line. */
const PASSWORD = 'pw-0136f5-never-logged';

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

// ---------------------------------------------------------------------------
// The server the tester named as their Nextcloud
// ---------------------------------------------------------------------------

type Reply = { status: number; type: string; body: string };

const ocs = (statuscode: number, message: string): Reply => ({
  status: statuscode,
  type: 'application/json',
  body: JSON.stringify({ ocs: { meta: { status: 'failure', statuscode, message }, data: [] } }),
});

/** What the server answers, by the share type asked for: a user share (0), or by mail (4). */
const CASES = {
  /** A page that is not Nextcloud's sharing at all. */
  notNextcloud: {
    user: { status: 404, type: 'text/html', body: `<html><title>${MARKER}</title><h1>${MARKER}</h1></html>` },
    parts: { kind: 'answered', status: 404, ocs: false },
  },
  /** OCS refuses the share, in its own words. */
  forbidden: {
    user: ocs(403, `Sharing is not allowed here (${MARKER})`),
    parts: { kind: 'answered', status: 403, ocsStatus: 403, ocs: true },
  },
  /** No such account, and by mail nothing found either. */
  notFound: {
    user: ocs(404, `User does not exist (${MARKER})`),
    mail: ocs(404, `Wrong path, file/folder does not exist (${MARKER})`),
    parts: { kind: 'notAnAccount', byMail: { status: 404, ocsStatus: 404, ocs: true } },
  },
  /** No such account, and sharing by mail refused. */
  noAccountNoMail: {
    user: ocs(404, `User does not exist (${MARKER})`),
    mail: ocs(403, `Sharing by mail is switched off (${MARKER})`),
    parts: { kind: 'notAnAccount', byMail: { status: 403, ocsStatus: 403, ocs: true } },
  },
} as const satisfies Record<string, { user: Reply; mail?: Reply; parts: ShareRefused }>;

type Case = keyof typeof CASES;

let current: Case = 'notNextcloud';
let reached = 0;
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      reached++;
      const byMail = new URLSearchParams(body).get('shareType') === '4';
      const c = CASES[current] as { user: Reply; mail?: Reply };
      const reply = byMail && c.mail ? c.mail : c.user;
      res.writeHead(reply.status, { 'Content-Type': reply.type });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'a share refused']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
       ($1,$3,'source','imap','typed source','{"host":"mail.example.invalid"}'::jsonb,'connected'),
       ($2,$3,'target','webdav','typed target',$4::jsonb,'connected')`,
    [
      SOURCE,
      TARGET,
      TENANT,
      JSON.stringify({ baseUrl: base, credentials: { username: 'pat', password: PASSWORD } }),
    ],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
       ($1,$3,$4,'user','m@example.invalid'),
       ($2,$3,$5,'user','t@example.invalid')`,
    [SOURCE_BOX, TARGET_BOX, TENANT, SOURCE, TARGET],
  );
  // Done: every data type is past its cutover, so the gate lets a share through.
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status)
     VALUES ($1,$2,$3,$4,'done')`,
    [MAPPING, TENANT, SOURCE_BOX, TARGET_BOX],
  );
  // One row on its own, and a folder with a file in it, all shared with Anna.
  await sql(
    `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw,
       verdict, verdict_target, item_key, parent_key, is_container) VALUES
       ($1,$4,$5,'0136f5-one','drive_item','Projects/budget.xlsx','anna@example.invalid','read','{}','clean','a Nextcloud share',NULL,NULL,NULL),
       ($2,$4,$5,'0136f5-folder','drive_item','Shared/Photos','anna@example.invalid','read','{}','clean','a Nextcloud share','F','root',true),
       ($3,$4,$5,'0136f5-in','drive_item','Shared/Photos/one.jpg','anna@example.invalid','read','{}','clean','a Nextcloud share','c1','F',false)`,
    [ONE_ROW, FOLDER, IN_FOLDER, TENANT, MAPPING],
  );
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await driver.end?.();
});

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  reached = 0;
  for (const level of ['warn', 'error', 'info'] as const) {
    vi.spyOn(log, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

/** The reference a sentence ends with. */
function referenceOf(reason: string): string {
  const ref = /Reference ([0-9a-f]{8})\.$/.exec(reason)?.[1];
  expect(ref, `"${reason}" should end with its reference`).toBeDefined();
  return ref!;
}

/** What every refused answer must hold, for one case. */
function holds(c: Case, refusal: { reason?: unknown; reasonNl?: unknown }, wholeAnswer: unknown): void {
  // None of the server's bytes, and not the password.
  expect(JSON.stringify(wholeAnswer)).not.toContain(MARKER);
  expect(JSON.stringify(wholeAnswer)).not.toContain(PASSWORD);
  // Our sentence, in both languages, with the reference.
  const said = shareRefusalSaid(CASES[c].parts);
  const ref = referenceOf(String(refusal.reason));
  expect(refusal.reason).toBe(`${said.en} Reference ${ref}.`);
  expect(refusal.reasonNl).toBe(`${said.nl} Referentie ${ref}.`);
  // The operator keeps the server's words, under that reference, without the password.
  expect(logged.some((l) => l.includes(ref) && l.includes(MARKER))).toBe(true);
  expect(logged.join('\n')).not.toContain(PASSWORD);
  expect(reached).toBeGreaterThan(0);
}

describe('a share refused on apply is said in our words (0136 T3)', () => {
  describe('one row, POST …/sharing/:grantId/decision', () => {
    for (const c of Object.keys(CASES) as Case[]) {
      it(`${c}: our sentence in English and Dutch, none of the server's words`, async () => {
        current = c;
        const res = await request(app)
          .post(`/api/migrations/${MAPPING}/sharing/${ONE_ROW}/decision`)
          .send({ action: 'apply' });
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('target_refused');
        holds(c, res.body as { reason?: unknown; reasonNl?: unknown }, res.body);
      });
    }
  });

  describe('every row, POST …/sharing/apply-all', () => {
    for (const c of ['notNextcloud', 'forbidden', 'notFound'] as const) {
      it(`${c}: each refused row in our words, one reference for the press`, async () => {
        current = c;
        const res = await request(app).post(`/api/migrations/${MAPPING}/sharing/apply-all`).send({});
        expect(res.status).toBe(200);
        const refused = res.body.refused as Array<{ id: string; code: string; reason: string; reasonNl: string }>;
        expect(refused.map((r) => r.id).sort()).toEqual([FOLDER, IN_FOLDER, ONE_ROW].sort());
        for (const r of refused) {
          expect(r.code).toBe('target_refused');
          holds(c, r, res.body);
        }
        expect(new Set(refused.map((r) => referenceOf(r.reason))).size).toBe(1);
      });
    }
  });

  describe('one folder, POST …/sharing/apply-folder', () => {
    for (const c of ['notNextcloud', 'forbidden', 'noAccountNoMail'] as const) {
      it(`${c}: each refused row in our words`, async () => {
        current = c;
        const res = await request(app)
          .post(`/api/migrations/${MAPPING}/sharing/apply-folder`)
          .send({ parentKey: 'F', confirmed: { 'anna@example.invalid': 'anna@example.invalid' } });
        expect(res.status).toBe(200);
        const refused = res.body.refused as Array<{ id: string; code: string; reason: string; reasonNl: string }>;
        expect(refused.map((r) => r.id).sort()).toEqual([FOLDER, IN_FOLDER].sort());
        for (const r of refused) {
          expect(r.code).toBe('target_refused');
          holds(c, r, res.body);
        }
      });
    }
  });

  it('the rows stay open: nothing was shared', async () => {
    const rows = await sql('SELECT state FROM share_grant WHERE mapping_id = $1', [MAPPING]);
    expect(rows.map((r) => r.state)).toEqual(['open', 'open', 'open']);
  });
});
