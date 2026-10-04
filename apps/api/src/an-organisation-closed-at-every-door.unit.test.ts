// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ORGANISATION CLOSED AT EVERY DOOR (workplan 0085 T2; the owner's report of
 * 2026-09-28, and their answer "Every write door (Recommended)").
 *
 * Closing an organisation promised that nothing uses the access it gave from
 * then on (`site/legal/alpha.md` §10), and the account went read-only in name
 * only. Every door that starts work, re-arms it, or uses the stored access
 * went on working for a closed organisation, until the purge: *Sync now*, a
 * cutover, a discovery, *Start*, a verification, both applies, a
 * confirmation; creating a migration, moving one into the lane, adding,
 * resuming or keeping a data type; adding, testing or re-keying a connection;
 * listing a saved account's folders, since 0153 open question 5, item 4;
 * the permission report; the sharing rescan and the share applies; and a grant
 * link's consent, which stored a new token and lifted a withdrawal.
 *
 * Each of them now answers 409 `account_closed`, with a sentence that names
 * the close and the day the data is removed, and does nothing else. Reading
 * stays open, and so does the reopen, which goes through `authenticate`: the
 * check is never there. This file holds that in five ways:
 *
 *  1. **The sweep.** `enqueueUnlessHeld`, the one enqueue, reads the closure
 *     before it hands anything back, so the eight doors of
 *     `a-hold-that-holds-every-door` inherit the refusal. Every other door
 *     calls the check itself. The number of checks in each file is pinned, so
 *     a check taken out fails here. A check never written is caught only where
 *     the stored access is used: every call that decrypts a stored credential
 *     or reaches a provider with one is counted per file, and a file that makes
 *     one either asks the close or says here why it need not. So a new use
 *     fails until somebody looks at its door. A new door that uses no stored
 *     access and only re-arms the tick is caught by nothing but its own row
 *     below. `middleware/auth.ts` never reads the close.
 *  2. **Open.** Each door is pressed over PGlite with both chains, and its
 *     answer recorded, so a door this harness could not reach would show. Two
 *     are not: applying one share and applying every open share wait for
 *     themselves on PGlite's one connection (`WriteDoor` below).
 *     `a-share-waits-for-its-own-cutover.integration.test.ts` presses both
 *     open, over Postgres. Applying one folder's shares is pressed open
 *     without a folder, so it reaches only its own 400.
 *  3. **Closed**, through the owner's own Close: every door answers
 *     `account_closed` with both days, enqueues nothing, writes nothing, and
 *     probes nothing. That includes Start on a migration the close left
 *     running, and a press that would otherwise have been answered by the
 *     migration's own state (a draft, a grant still awaited). The spec
 *     documents that answer, and the body is valid against it. Reading a
 *     migration still works.
 *  4. **A grant arriving after the close**: a consent begun before it is
 *     refused at the callback, before the code is exchanged, and the ending
 *     itself stores no token and leaves a withdrawal in place.
 *  5. **Reopened**, through the owner's own Reopen and the real
 *     `authenticate`: every door pressed open answers what it answered before
 *     the close. The two share applies are not pressed here, for the reason
 *     in 2.
 *
 * It failed before the fix: every closed press went through.
 */

process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { join, relative } from 'node:path';
import express from 'express';
import request from 'supertest';
import {
  expiryFromDays,
  issueMappingLink,
  pgliteDriver,
  runMigrations,
  withTenant,
  type LedgerDriver,
} from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import {
  M,
  code,
  enqueueDoors,
  sourceFiles,
  specChecker,
  type Door,
} from './__tests__/doors-that-start-work.ts';

const SRC = import.meta.dirname;
const CHECKER = specChecker(join(SRC, '..', 'docs', 'openapi.yaml'));

// UUID family 0085c1d0-…, unused elsewhere in the repo.
const P = '0085c1d0-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
/** A plain IMAP source, the eight doors' migrations read it. */
const CONN = `${P}11`;
const BOX = `${P}21`;
/** A Gmail source with the organisation's own Google client: the grant link's. */
const GMAIL = `${P}12`;
const GMAIL_BOX = `${P}22`;
/** A JMAP destination. */
const JMAP = `${P}13`;
const JMAP_BOX = `${P}23`;
/** A Nextcloud destination with stored access, for Test and a new key. */
const NEXTCLOUD = `${P}14`;
/** A Dropbox source with stored access, for the folders *Only one folder* lists. */
const DROPBOX = `${P}15`;

const ACTIVE = `${P}31`;
const DRAFT = `${P}32`;
/** Finished, so a status update may move it into the continuous lane. */
const DONE = `${P}33`;
/** Running, with its mail stopped by its owner and its calendar copying. */
const RUNNING = `${P}34`;
/** In its cutover, both data types past it: calendar may be kept in the lane. */
const KEPT = `${P}35`;
/** A draft from Gmail to JMAP carrying nothing yet: mail may be added. */
const ADDING = `${P}36`;
/** Gmail to JMAP, waiting for a grant through a link. */
const GRANTED = `${P}37`;
const HASH = 'e'.repeat(64);
const SHARE = `${P}41`;

/** The account the grant link's migration reads. */
const NAMED = 'person@example.invalid';
const CLIENT_ID = 'client.apps.googleusercontent.com';

let driver: LedgerDriver;

// The presses below carry no token and are signed in by this stand-in. The
// owner's Close and Reopen carry one, and go through the real `authenticate`:
// the one place the check must never be.
vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.headers.authorization) return actual.authenticate(req, res, next);
      Object.assign(req, { tenantId: TENANT, userId: 'tester', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { enqueued } = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: {
        trigger: (taskId: string) => {
          enqueued.push(taskId);
          return Promise.resolve({ id: `run-${enqueued.length}` });
        },
      },
      runs: { cancel: () => Promise.resolve() },
    }),
  };
});

// The ledger's apply gates are not this file's subject (see the hold's guard).
vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const permitted = async (deps: { domain: string }) => ({ ok: true, domain: deps.domain });
  return { ...actual, evaluateApplyDeletion: permitted, evaluateApplyRelocation: permitted };
});

// Nothing here connects anywhere: a probe answers at once, and is counted,
// because a closed door must not reach it.
const { probed } = vi.hoisted(() => ({ probed: [] as string[] }));
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  const passes = (side: string) => async () => {
    probed.push(side);
    return { ok: true };
  };
  return {
    ...actual,
    probeSourceConnection: vi.fn(passes('source')),
    probeTargetConnection: vi.fn(passes('target')),
    listDropboxSharedFolders: vi.fn(async () => {
      probed.push('folders');
      return { ok: true, folders: [] };
    }),
  };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: vi.fn(async () => undefined) };
});

const { default: migrationRoutes } = await import('./routes/migrations/index.ts');
const { default: connectionRoutes } = await import('./routes/connections.ts');
const { default: permissionRoutes } = await import('./routes/permissions.ts');
const { default: grantRoutes } = await import('./routes/grant.ts');
const { default: tenantRoutes } = await import('./routes/tenants/index.ts');
const { storeGrantedToken } = await import('./routes/migrations/grant-ending.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/grant', grantRoutes);
app.use('/api/tenants', tenantRoutes);

async function rows<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as R[];
  } finally {
    await conn.release();
  }
}
const sql = async (text: string, params: unknown[] = []): Promise<void> => void (await rows(text, params));
const count = async (text: string, params: unknown[]): Promise<number> =>
  Number((await rows<{ n: string | number }>(text, params))[0]!.n);

const sealed = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);
/** The destination's stored access as it was, so a new key can be told apart and undone. */
let nextcloudSecret = '';

let created = 0;
/** The wizard's create, for a new account each time so no two are the same migration. */
const createBody = () => {
  created += 1;
  const account = `closed-${created}@example.invalid`;
  return {
    name: `migration ${created}`,
    sourceType: 'imap',
    targetType: 'jmap',
    sourceConfig: { host: 'src.example.invalid', port: 993, username: account, password: 'p' },
    targetConfig: { host: 'dst.example.invalid', port: 443, username: account, password: 'p' },
    syncConfig: { domains: ['email'] },
  };
};

const DAV = { url: 'https://cloud.example.test/remote.php/dav/', username: 'u', password: 'p' };

/**
 * A door this file can press only while the organisation is closed.
 *
 * Applying a share reads the destination's connection in a transaction of its
 * own while the ledger's is open (`nextcloudCapabilityFor` inside
 * `withLedger`), and PGlite has one connection: pressed open, it waits for
 * itself. Closed, the refusal comes before either. Their open presses are
 * `a-share-waits-for-its-own-cutover.integration.test.ts`'s, over Postgres.
 */
type WriteDoor = Door & { readonly openPress?: false };

/** The eight doors that enqueue, as the hold's guard presses them. */
const ENQUEUE_DOORS: readonly Door[] = enqueueDoors({ active: ACTIVE, draft: DRAFT, hash: HASH, tenant: TENANT, count });

/**
 * Every other door that starts, re-arms or uses the stored access, the owner's
 * list of 2026-09-28. Each puts its rows back before a press, so the open, the
 * closed and the reopened press all meet the same rows.
 */
const WRITE_DOORS: readonly WriteDoor[] = [
  {
    // The close leaves a migration `active`. Open, a press on one starts
    // nothing and says so; closed, it names the close.
    name: 'Start on a migration already running',
    path: `/api/migrations/${ACTIVE}/start`,
    spec: `${M}/start`,
    accepted: 200,
  },
  {
    // Open, the grant it waits for is the answer. Closed, that answer would
    // send the owner to a grant link that is refused too.
    name: 'Start on a migration waiting for a grant',
    path: `/api/migrations/${GRANTED}/start`,
    spec: `${M}/start`,
    accepted: 409,
  },
  {
    // Open, the draft's own sentence. Closed, the close's.
    name: 'Sync now on a draft',
    path: `/api/migrations/${DRAFT}/sync`,
    spec: `${M}/sync`,
    body: {},
    accepted: 409,
  },
  {
    name: 'creating a migration',
    path: '/api/migrations',
    spec: '/api/migrations',
    get body() {
      return createBody();
    },
    accepted: 201,
    wrote: () => count('SELECT count(*) AS n FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]),
  },
  {
    name: 'moving a finished migration into the continuous lane',
    method: 'put',
    path: `/api/migrations/${DONE}`,
    spec: M,
    body: { status: 'continuous' },
    accepted: 200,
    wrote: () => count(`SELECT count(*) AS n FROM mailbox_mapping WHERE id = $1 AND status = 'continuous'`, [DONE]),
    reset: () => sql(`UPDATE mailbox_mapping SET status = 'done' WHERE id = $1`, [DONE]),
  },
  {
    name: 'adding a data type',
    path: `/api/migrations/${ADDING}/domains`,
    spec: `${M}/domains`,
    body: { domain: 'email' },
    accepted: 200,
    wrote: () => count('SELECT count(*) AS n FROM scope_selection WHERE mapping_id = $1 AND included', [ADDING]),
    reset: () => sql('DELETE FROM scope_selection WHERE mapping_id = $1', [ADDING]),
  },
  {
    name: 'resuming a data type',
    path: `/api/migrations/${RUNNING}/domains/email/resume`,
    spec: `${M}/domains/{domain}/resume`,
    accepted: 200,
    wrote: () =>
      count(
        `SELECT count(*) AS n FROM path_lifecycle WHERE mapping_id = $1 AND domain = 'email' AND stopped_at IS NULL`,
        [RUNNING],
      ),
    reset: () => sql(`UPDATE path_lifecycle SET stopped_at = now() WHERE mapping_id = $1 AND domain = 'email'`, [RUNNING]),
  },
  {
    name: 'keeping a data type copying',
    path: `/api/migrations/${KEPT}/domains/calendar/keep`,
    spec: `${M}/domains/{domain}/keep`,
    accepted: 200,
    wrote: () =>
      count(`SELECT count(*) AS n FROM path_lifecycle WHERE mapping_id = $1 AND state = 'continuous'`, [KEPT]),
    reset: async () => {
      await sql(`UPDATE path_lifecycle SET state = 'cutover' WHERE mapping_id = $1`, [KEPT]);
      await sql(`UPDATE mailbox_mapping SET status = 'cutover' WHERE id = $1`, [KEPT]);
    },
  },
  {
    name: 'adding a connection',
    path: '/api/connections',
    spec: '/api/connections',
    body: { role: 'target', type: 'nextcloud', displayName: 'another', values: DAV },
    accepted: 201,
    wrote: () => count('SELECT count(*) AS n FROM connection WHERE tenant_id = $1', [TENANT]),
  },
  {
    name: 'testing a connection',
    path: `/api/connections/${NEXTCLOUD}/test`,
    spec: '/api/connections/{id}/test',
    accepted: 200,
    wrote: () => count(`SELECT count(*) AS n FROM connection WHERE id = $1 AND status = 'connected'`, [NEXTCLOUD]),
    reset: () => sql(`UPDATE connection SET status = 'error' WHERE id = $1`, [NEXTCLOUD]),
  },
  {
    // *Only one folder*'s Browse (0153 open question 5, item 4) reads the
    // stored access to list a saved account's folders.
    name: 'listing a connection’s folders',
    method: 'get',
    path: `/api/connections/${DROPBOX}/folders`,
    spec: '/api/connections/{id}/folders',
    accepted: 200,
  },
  {
    name: 'giving a connection a new key',
    method: 'put',
    path: `/api/connections/${NEXTCLOUD}/credentials`,
    spec: '/api/connections/{id}/credentials',
    body: { values: DAV },
    accepted: 200,
    wrote: () => count('SELECT count(*) AS n FROM connection WHERE id = $1 AND secret_ref <> $2', [NEXTCLOUD, nextcloudSecret]),
    reset: () => sql('UPDATE connection SET secret_ref = $2 WHERE id = $1', [NEXTCLOUD, nextcloudSecret]),
  },
  {
    name: 'the permission report',
    method: 'get',
    path: `/api/permissions/report?mailbox=${NAMED}`,
    spec: '/api/permissions/report',
    accepted: 200,
  },
  {
    name: 'rescanning sharing',
    path: `/api/migrations/${ACTIVE}/sharing/rescan`,
    spec: `${M}/sharing/rescan`,
    accepted: 200,
  },
  {
    name: 'applying one share',
    path: `/api/migrations/${ACTIVE}/sharing/${SHARE}/decision`,
    spec: `${M}/sharing/{grantId}/decision`,
    body: { action: 'apply' },
    accepted: 404,
    openPress: false,
  },
  {
    name: 'applying every open share',
    path: `/api/migrations/${ACTIVE}/sharing/apply-all`,
    spec: `${M}/sharing/apply-all`,
    accepted: 200,
    openPress: false,
  },
  {
    name: 'applying one folder’s shares',
    path: `/api/migrations/${ACTIVE}/sharing/apply-folder`,
    spec: `${M}/sharing/apply-folder`,
    // No folder named: the door's own refusal, which comes after the close's.
    body: {},
    accepted: 400,
  },
];

/** The grant link's two doors, for a link minted per phase. */
let grantLink = '';
const GRANT_DOORS = (): readonly Door[] => [
  {
    name: 'a grant link’s page',
    method: 'get',
    path: `/api/grant/${grantLink}`,
    spec: '/api/grant/{link}',
    accepted: 200,
  },
  {
    name: 'a grant link’s consent',
    path: `/api/grant/${grantLink}/google/authorize`,
    spec: '/api/grant/{link}/google/authorize',
    body: { locale: 'nl' },
    accepted: 200,
  },
];

const DOORS = (): readonly WriteDoor[] => [...ENQUEUE_DOORS, ...WRITE_DOORS, ...GRANT_DOORS()];
/** The doors pressed open, before the close and after the reopen. */
const OPEN_DOORS = (): readonly WriteDoor[] => DOORS().filter((d) => d.openPress !== false);

const press = (door: Door) => {
  const req = request(app)[door.method ?? 'post'](door.path);
  return door.method === 'get' ? req : req.send(door.body ?? {});
};

/** A token for the owner, as the stand-in issuer of an unconfigured deployment reads one. */
const OWNER_TOKEN = [
  { alg: 'none', typ: 'JWT' },
  { sub: 'owner-sub', email: 'owner@example.invalid', role: 'owner' },
]
  .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
  .concat('')
  .join('.');
const asOwner = (path: string) =>
  request(app).post(path).set('authorization', `Bearer ${OWNER_TOKEN}`).set('x-ownpace-tenant', TENANT);

/** The day a close is named by: its UTC date, as the API writes dates. */
const day = (iso: string | Date) => new Date(iso).toISOString().slice(0, 10);

const mintGrantLink = async () => {
  const { token } = await withTenant(driver, TENANT, (db) =>
    issueMappingLink(db, {
      tenantId: TENANT,
      mappingId: GRANTED,
      purpose: 'grant',
      createdBy: 'tester',
      expiresAt: expiryFromDays(7),
    }),
  );
  return token;
};

/** What each door answered while the organisation was open. */
const OPEN = new Map<string, { status: number; error: unknown }>();

const saved: Record<string, string | undefined> = {};
const ENV = ['JWT_ISSUER', 'JWT_SECRET', 'MAX_MIGRATIONS_PER_ORGANISATION', 'API_URL', 'WEB_URL'] as const;

/** Google's token endpoint, counted: a closed organisation's consent never reaches it. */
const tokenRequests: string[] = [];

beforeAll(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  // No issuer and no secret: `authenticate` reads the owner's token unverified,
  // as a deployment with neither does outside production.
  delete process.env.JWT_ISSUER;
  delete process.env.JWT_SECRET;
  process.env.MAX_MIGRATIONS_PER_ORGANISATION = '50';
  process.env.API_URL = 'https://api.example';
  process.env.WEB_URL = 'https://app.example';

  vi.stubGlobal('fetch', async (url: string) => {
    tokenRequests.push(String(url));
    return new Response(JSON.stringify({ error: 'not_expected' }), { status: 400 });
  });

  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  nextcloudSecret = sealed(DAV);
  await sql('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Closing BV']);
  // Room for every door this file presses: an agreed Extra large (workplan
  // 0109 T6). Keeping a data type copying takes a third slot, past Free's one,
  // and this file is about the close, not the tier's paths, which
  // `a-start-past-the-tier.unit.test.ts` holds.
  await sql(
    `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
     VALUES ($1, 'tier', 'xl', 15000, 0, 'room for the test')`,
    [TENANT],
  );
  await sql(`INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, 'tester', 'owner@example.invalid')`, [
    TENANT,
  ]);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref) VALUES
       ($1, $5, 'source', 'imap', 'i', '{}'::jsonb, 'connected', NULL),
       ($2, $5, 'source', 'gmail', 'g', '{}'::jsonb, 'connected', $6),
       ($3, $5, 'target', 'jmap', 'j', '{"host":"dst.example.invalid","port":443}'::jsonb, 'connected', NULL),
       ($4, $5, 'target', 'nextcloud', 'n', $7::jsonb, 'error', $8),
       ($9, $5, 'source', 'dropbox', 'd', '{}'::jsonb, 'connected', $10)`,
    [
      CONN,
      GMAIL,
      JMAP,
      NEXTCLOUD,
      TENANT,
      sealed({ username: NAMED, clientId: CLIENT_ID, clientSecret: 'the-owners-secret-value' }),
      JSON.stringify({ url: DAV.url }),
      nextcloudSecret,
      DROPBOX,
      sealed({ refreshToken: 'a-dropbox-token', clientId: 'an-app-key', clientSecret: 'an-app-secret' }),
    ],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
       ($1, $4, $2, 'user', 'closing@example.invalid'),
       ($3, $4, $5, 'user', $7),
       ($6, $4, $8, 'user', 'dest@example.invalid')`,
    [BOX, CONN, GMAIL_BOX, TENANT, GMAIL, JMAP_BOX, NAMED, JMAP],
  );
  await sql(
    `INSERT INTO mailbox_mapping
       (id, tenant_id, source_mailbox_id, target_mailbox_id, target_folder_prefix, target_config_override,
        status, allow_apply_deletions)
     VALUES
       ($1, $8, $9, NULL, NULL, NULL, 'active', true),
       ($2, $8, $9, NULL, NULL, NULL, 'paused', false),
       ($3, $8, $9, NULL, NULL, NULL, 'done', false),
       ($4, $8, $9, NULL, NULL, NULL, 'active', false),
       ($5, $8, $9, NULL, NULL, NULL, 'cutover', false),
       ($6, $8, $10, $11, 'added', NULL, 'paused', false),
       ($7, $8, $10, $11, NULL, '{"user":"dest@example.invalid"}'::jsonb, 'paused', false)`,
    [ACTIVE, DRAFT, DONE, RUNNING, KEPT, ADDING, GRANTED, TENANT, BOX, GMAIL_BOX, JMAP_BOX],
  );
  for (const [mapping, domain] of [
    [RUNNING, 'email'],
    [RUNNING, 'calendar'],
    [KEPT, 'email'],
    [KEPT, 'calendar'],
    [GRANTED, 'email'],
  ] as const) {
    await sql('INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)', [
      TENANT,
      mapping,
      domain,
    ]);
  }
  await sql(
    `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, stopped_at) VALUES
       ($1, $2, 'email', 'active', now(), now()),
       ($1, $2, 'calendar', 'active', now(), NULL),
       ($1, $3, 'email', 'cutover', now(), NULL),
       ($1, $3, 'calendar', 'cutover', now(), NULL)`,
    [TENANT, RUNNING, KEPT],
  );
  // PGlite and both migration chains; see awaiting-grant.unit.test.ts for why
  // this is not vitest's default 10s.
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await driver?.end();
});

beforeEach(() => {
  enqueued.length = 0;
  probed.length = 0;
  tokenRequests.length = 0;
});

/** Before each press: the rows as they were, and no verification or receipt to join. */
async function resetFor(door: Door): Promise<void> {
  await sql('DELETE FROM apply_receipt WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM verification_run WHERE tenant_id = $1', [TENANT]);
  await sql(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [DRAFT]);
  await door.reset?.();
}

// ─── 1. The sweep ────────────────────────────────────────────────────────────

/** The function every enqueue in the API goes through. */
const THE_ENQUEUE = 'enqueue-unless-held.ts';

/**
 * The checks the doors make themselves, by file: every write door but the
 * eight that enqueue, which ask through `enqueueUnlessHeld`. Pinned, so a check
 * taken out fails. It proves nothing about a check never written: that is the
 * stored-access sweep below, and each door's row in the tables above.
 */
const CHECKS_BY_FILE: Readonly<Record<string, number>> = {
  'routes/migrations/index.ts': 7,
  'routes/migrations/operating-routes.ts': 4,
  // One more since *Only one folder*'s Browse lists a saved account's folders
  // (0153 open question 5, item 4).
  'routes/connections.ts': 4,
  'routes/permissions.ts': 1,
  // Two more since a person's link (0153 T5 (b)): its page and its consent ask too.
  'routes/grant.ts': 4,
  'routes/migrations/google-oauth-routes.ts': 1,
};

/** How a door asks: answering the refusal itself, or reading it to answer in its own form. */
const ASKS = /\b(refusedAsClosed|closedOrganisation)\s*\(/g;

/** Any way a file asks the close: itself, through the one enqueue, or by reading the closure row. */
const ASKS_AT_ALL = /\b(refusedAsClosed|closedOrganisation|enqueueUnlessHeld|readOrganisationClosure)\s*\(/;

/**
 * A call that uses the access an organisation gave: decrypting a stored
 * credential, or reaching a provider with one. A call, not a definition.
 */
const USES_STORED_ACCESS =
  /(?<!function\s+)\b(?:SecretStore\.decryptCredentials|storedCredentials|probeSourceConnection|probeTargetConnection|qualifyAccount|qualifyAndRemember|tenantInventoryScans|migrationInventoryScans|sourceCredentialsFor|createNextcloudShare|exchangeCode|storeGrantedToken|storePersonGrant)\s*\(/g;

/**
 * Where the API uses the stored access today, counted per file. A new use
 * changes a count here, and the door it sits in has to be looked at: it asks
 * the close, or its file is below with the reason.
 */
const USES_BY_FILE: Readonly<Record<string, number>> = {
  // One more since a rotation keeps a Microsoft account's tenant (0153 open
  // question 5), read after the rotation's close, and one since the folder
  // browse reads a saved account's sign-in, after its own.
  'routes/connections.ts': 13,
  'routes/grant.ts': 2,
  'routes/migrations/account-on-connection.ts': 1,
  'routes/migrations/google-oauth-routes.ts': 3,
  'routes/migrations/grant-subject.ts': 2,
  'routes/migrations/index.ts': 3,
  'routes/migrations/operating-routes.ts': 3,
  'routes/migrations/person-grant-subject.ts': 2,
  'routes/permissions.ts': 9,
  'routes/withdraw-grant.ts': 1,
};

/** The files that use the stored access and never ask the close, and why that is right. */
const USED_WITHOUT_ASKING: Readonly<Record<string, string>> = {
  'routes/migrations/account-on-connection.ts':
    'reads the account name a migration shows. It reaches no provider, and reading stays open.',
  'routes/migrations/grant-subject.ts':
    'reads whether the organisation’s own Google client is stored, to say whether a grant link can work. ' +
    'It reaches no provider. The grant page and the consent that use it ask (grant.ts, google-oauth-routes.ts).',
  'routes/migrations/person-grant-subject.ts':
    'reads whether each of a person’s migrations has a way in, to say which accounts their link still asks for ' +
    '(0153 T5 (b)). It reaches no provider. The grant page and the consent that use it ask (grant.ts, ' +
    'google-oauth-routes.ts), and the person’s ending reads the close in its own transaction.',
  'routes/withdraw-grant.ts':
    'withdrawing a grant revokes it at the provider. That ends access, and ending stays open after a close.',
};

describe('the sweep: every door that starts work asks whether the organisation is closed', () => {
  it('the one enqueue reads the close before it hands anything back', () => {
    const text = code(join(SRC, THE_ENQUEUE));
    const readAt = text.indexOf('readOrganisationClosure(');
    const enqueueAt = text.indexOf('tasks.trigger(');
    expect(readAt, 'enqueueUnlessHeld does not read the close').toBeGreaterThan(-1);
    expect(enqueueAt).toBeGreaterThan(readAt);
  });

  it('the checks the other doors make are pinned per file, so one taken out fails', () => {
    const calls: Record<string, number> = {};
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (rel === 'closed-organisation.ts') continue;
      const n = code(file).match(ASKS)?.length ?? 0;
      if (n > 0) calls[rel] = n;
    }
    expect(calls).toEqual(CHECKS_BY_FILE);
  });

  it('every use of the stored access is counted, and each file that makes one asks or says why not', () => {
    const uses: Record<string, number> = {};
    const unasked: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      const text = code(file);
      const n = text.match(USES_STORED_ACCESS)?.length ?? 0;
      if (n === 0) continue;
      uses[rel] = n;
      if (!ASKS_AT_ALL.test(text) && !USED_WITHOUT_ASKING[rel]) unasked.push(rel);
    }
    expect(
      uses,
      'a use of the stored access was added or taken out. The door it sits in must ask the close ' +
        '(`refusedAsClosed`) before it, or its file must say below why it need not. Then change the count.',
    ).toEqual(USES_BY_FILE);
    expect(unasked, 'these files use the stored access and never ask whether the organisation is closed').toEqual([]);
    // No reason kept for a file that no longer needs one.
    for (const rel of Object.keys(USED_WITHOUT_ASKING)) {
      expect(uses[rel], `${rel} is excused, and uses no stored access`).toBeGreaterThan(0);
      expect(ASKS_AT_ALL.test(code(join(SRC, rel))), `${rel} is excused, and asks the close`).toBe(false);
    }
  });

  it('the grant ending reads the close in its own transaction, before it spends the link', () => {
    const text = code(join(SRC, 'routes', 'migrations', 'grant-ending.ts'));
    const readAt = text.indexOf('readOrganisationClosure(');
    expect(readAt, 'storeGrantedToken does not read the close').toBeGreaterThan(-1);
    expect(text.indexOf('spendMappingLink(db')).toBeGreaterThan(readAt);
  });

  it('authenticate never asks: the owner reopens through it', () => {
    const text = code(join(SRC, 'middleware', 'auth.ts'));
    for (const name of ['readOrganisationClosure', 'refusedAsClosed', 'closedOrganisation', 'organisationIsOpen', 'tenant_closure']) {
      expect(text, `middleware/auth.ts reads the close (${name}); a closed owner could not reopen`).not.toContain(name);
    }
  });
});

// ─── 2. Open ─────────────────────────────────────────────────────────────────

describe('while the organisation is open, each door answers as it always has', () => {
  beforeAll(async () => {
    grantLink = await mintGrantLink();
  });

  it.each(OPEN_DOORS().map((d) => [d.name, d] as const))('%s', async (_name, door) => {
    // The grant doors' path carries the link minted above.
    const live = DOORS().find((d) => d.name === door.name)!;
    await resetFor(live);
    const res = await press(live);
    expect(res.status, JSON.stringify(res.body)).toBe(live.accepted);
    expect(res.body?.error).not.toBe('account_closed');
    if (live.task) expect(enqueued).toEqual([live.task]);
    OPEN.set(live.name, { status: res.status, error: res.body?.error });
  });
});

// ─── 3. Closed ───────────────────────────────────────────────────────────────

describe('once the owner closes the organisation', () => {
  let closedDay = '';
  let purgeDay = '';

  beforeAll(async () => {
    grantLink = await mintGrantLink();
    const res = await asOwner(`/api/tenants/${TENANT}/close`).send({ windowDays: 30 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [closure] = await rows<{ closed_at: Date; purge_after: Date }>(
      'SELECT closed_at, purge_after FROM tenant_closure WHERE tenant_id = $1',
      [TENANT],
    );
    closedDay = day(closure!.closed_at);
    purgeDay = day(res.body.purgeAfter);
    expect(purgeDay).toBe(day(closure!.purge_after));
    expect(purgeDay).not.toBe(closedDay);
  });

  it.each(DOORS().map((d) => [d.name, d] as const))(
    '%s answers 409 account_closed, names both days, and does nothing',
    async (_name, door) => {
      const live = DOORS().find((d) => d.name === door.name)!;
      await resetFor(live);
      const before = live.wrote ? await live.wrote() : 0;

      const res = await press(live);

      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('account_closed');
      expect(res.body.message).toContain(`closed on ${closedDay}`);
      expect(res.body.message).toContain(purgeDay);
      expect(res.body.reason).toBe(res.body.message);
      // Both halves, for a page that shows the reader's language.
      expect(res.body.messageNl).toContain(purgeDay);
      expect(res.body.reasonNl).toBe(res.body.messageNl);
      expect(day(res.body.purgeAfter)).toBe(purgeDay);
      expect(day(res.body.closedAt)).toBe(closedDay);
      expect(enqueued, 'a closed door enqueued a task').toEqual([]);
      expect(probed, 'a closed door used the access it was given').toEqual([]);
      if (live.wrote) expect(await live.wrote(), 'a closed door wrote').toBe(before);
    },
  );

  it.each(DOORS().map((d) => [d.name, d] as const))('%s: the spec documents that answer', async (_name, door) => {
    const live = DOORS().find((d) => d.name === door.name)!;
    await resetFor(live);
    const { raw, schema } = CHECKER.responseSchema(live, '409');
    expect(JSON.stringify(raw)).toContain('AccountClosed');
    const res = await press(live);
    expect(res.status).toBe(409);
    expect(
      CHECKER.satisfies(schema, res.body),
      `${live.spec}: the body ${JSON.stringify(res.body)} is not valid against its documented 409`,
    ).toBe(true);
  });

  it('reading stays open: the migration, its queues, the organisation', async () => {
    expect((await request(app).get(`/api/migrations/${ACTIVE}`)).status).toBe(200);
    expect((await request(app).get(`/api/migrations/${ACTIVE}/deletions`)).status).toBe(200);
    expect((await request(app).get(`/api/migrations/${ACTIVE}/sharing`)).status).toBe(200);
    expect((await request(app).get('/api/migrations')).status).toBe(200);
  });

  it('a door that stops work is not refused for the close: it answers its own rule', async () => {
    // Stopping the last data type still copying is refused by its own rule
    // (D5). That rule, and not the close, answers: stopping is not starting.
    const res = await request(app).post(`/api/migrations/${RUNNING}/domains/calendar/stop`).send({});
    expect(res.body.error).not.toBe('account_closed');
  });

  describe('a grant that arrives after the close', () => {
    it('stores no token and leaves a withdrawal in place', async () => {
      await sql(`UPDATE mailbox_mapping SET grant_withdrawn_at = now(), source_secret_ref = NULL WHERE id = $1`, [
        GRANTED,
      ]);
      const [link] = await rows<{ id: string }>(
        `SELECT id FROM mapping_link WHERE mapping_id = $1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [GRANTED],
      );
      const stored = await storeGrantedToken(
        driver,
        { linkId: link!.id, mappingId: GRANTED, tenantId: TENANT },
        { refreshToken: '1//a-token-after-the-close', signedInAs: NAMED },
      );
      expect(stored.ok).toBe(false);
      expect(stored.ok ? '' : stored.reason).toContain(purgeDay);
      expect(stored.ok ? '' : stored.reasonNl).toContain(purgeDay);
      const [mapping] = await rows<{ source_secret_ref: string | null; grant_withdrawn_at: Date | null }>(
        'SELECT source_secret_ref, grant_withdrawn_at FROM mailbox_mapping WHERE id = $1',
        [GRANTED],
      );
      expect(mapping!.source_secret_ref).toBeNull();
      expect(mapping!.grant_withdrawn_at).not.toBeNull();
      // Not spent: the refusal is the organisation's, and a reopen can use it.
      expect(await count('SELECT count(*) AS n FROM mapping_link WHERE id = $1 AND used_at IS NOT NULL', [link!.id])).toBe(0);
      await sql(`UPDATE mailbox_mapping SET grant_withdrawn_at = NULL WHERE id = $1`, [GRANTED]);
    });

    it('a consent begun before the close is refused at the callback, before its code is exchanged', async () => {
      // Begun while open: reopen for the press, then close again.
      const reopened = await asOwner(`/api/tenants/${TENANT}/reopen`).send({});
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
      const begun = await request(app).post(`/api/grant/${grantLink}/google/authorize`).send({});
      expect(begun.status, JSON.stringify(begun.body)).toBe(200);
      const state = new URL(begun.body.url as string).searchParams.get('state');
      const closedAgain = await asOwner(`/api/tenants/${TENANT}/close`).send({ windowDays: 30 });
      expect(closedAgain.status).toBe(200);

      const res = await request(app).get(`/api/migrations/google/callback?state=${state}&code=a-code`);
      expect(res.status).toBe(409);
      expect(res.text).toContain(purgeDay);
      expect(tokenRequests, 'the code was exchanged for a token after the close').toEqual([]);
      expect(
        (await rows<{ source_secret_ref: string | null }>('SELECT source_secret_ref FROM mailbox_mapping WHERE id = $1', [GRANTED]))[0]!
          .source_secret_ref,
      ).toBeNull();
    });
  });
});

// ─── 5. Reopened ─────────────────────────────────────────────────────────────

describe('once the owner reopens it, each door answers as it did before the close', () => {
  beforeAll(async () => {
    const res = await asOwner(`/api/tenants/${TENANT}/reopen`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    grantLink = await mintGrantLink();
  });

  it.each(OPEN_DOORS().map((d) => [d.name, d] as const))('%s', async (_name, door) => {
    const live = DOORS().find((d) => d.name === door.name)!;
    await resetFor(live);
    const res = await press(live);
    const before = OPEN.get(live.name);
    expect(before, 'the open press did not run').toBeDefined();
    expect({ status: res.status, error: res.body?.error }, JSON.stringify(res.body)).toEqual(before);
    if (live.task) expect(enqueued).toEqual([live.task]);
  });
});
