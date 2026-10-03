// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * NO CREDENTIAL STORED BEFORE THE CONDITIONS ARE ACCEPTED (workplan 0139 T3).
 *
 * The owner, 2026-09-28: *"People that are accepted in the Alpha do need to
 * create a login for the app, accepting fits in there and should record what
 * time/version the accepted of what document."* The screen at first sign-in is
 * the notice. What makes sure nobody's access is stored before it is the
 * server: while the deployment asks for acceptance (`OWNPACE_STAGE=alpha`,
 * the alpha's own switch, 0131 T1), every door that stores a credential
 * answers 409 `conditions_not_accepted` until the person pressing it has
 * accepted the current version of each text in this organisation. With the
 * switch off nothing changes.
 *
 * The doors that store a credential, found by where the API seals one
 * (`SecretStore.encryptCredentials`):
 *
 *  - adding a connection (`POST /api/connections`);
 *  - giving a connection a new key (`PUT /api/connections/{id}/credentials`);
 *  - creating a migration (`POST /api/migrations`), which stores the source's
 *    and the destination's access in the same transaction;
 *  - issuing a grant link (`POST /api/migrations/{mappingId}/links`), the
 *    member's door to the access a family member then gives through it (review
 *    of 2026-09-29: the migration may predate the check, or a text may have a
 *    new version since it was created, so its creation proves nothing now).
 *
 * Two places seal a credential and do not ask, each for its reason below: a
 * grant link's consent, whose holder is no party to the terms (terms §1) and
 * whose link was issued behind this check, and the operator's seed.
 * The OAuth callbacks of a member's own consent store nothing: they hand the
 * token back to the wizard, which stores it through one of the three doors.
 *
 * This file holds that in four ways, the way `an-organisation-closed-at-every-
 * door` holds the close:
 *
 *  1. **The sweep.** The checks are counted per file, so one taken out fails,
 *     and every file that seals a credential either asks or says here why it
 *     need not, so a door added later fails until somebody looks at it.
 *  2. **Off.** With the switch off, each door answers as it always has.
 *  3. **On, and not accepted** (nothing yet, or an older version): each door
 *     answers 409 `conditions_not_accepted`, naming the texts and versions,
 *     writes nothing and probes nothing. The spec documents the answer.
 *  4. **On, and accepted**: each door answers as it did with the switch off.
 *  5. **On, while a text is still a draft** (review of 2026-09-29): nobody is
 *     asked, because a draft's number is the one the final text will carry
 *     and an acceptance of it would be recorded as the final's. Each door
 *     answers as with the switch off, and recording an acceptance is refused,
 *     as it is with the switch off (409 `acceptance_not_asked`).
 *
 * The drafts are `LEGAL_DRAFTS` from `@openmig/managed`, replaced here by an
 * object the cases set: every text final, unless a case says otherwise. Which
 * texts really are drafts is `scripts/a-version-the-tester-accepted`'s.
 *
 * PGlite with both chains, as `app_user`.
 */

process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { join, relative } from 'node:path';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, withTenant, type LedgerDriver } from '@openmig/ledger';
import { LEGAL_DOCUMENTS, LEGAL_VERSIONS, recordAcceptance, runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import { code, sourceFiles, specChecker, type Door } from './__tests__/doors-that-start-work.ts';

const SRC = import.meta.dirname;
const CHECKER = specChecker(join(SRC, '..', 'docs', 'openapi.yaml'));

// UUID family 0139d00a-…, unused elsewhere in the repo.
const P = '0139d00a-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
/** A Nextcloud destination with stored access, for a new key. */
const NEXTCLOUD = `${P}11`;
const TESTER = 'acceptance-tester';

let driver: LedgerDriver;

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: caller.userId, userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

// Every text final unless a case makes one a draft: the rule under test is the
// API's, and the real drafts are held to the texts by their own guard. And who
// `authenticate` says is pressing: the tester, unless a case says otherwise.
const { texts, caller } = vi.hoisted(() => ({
  texts: { drafts: { alpha: false, privacy: false, terms: false } as Record<string, boolean> },
  caller: { userId: 'acceptance-tester' },
}));
vi.mock('@openmig/managed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/managed')>();
  return { ...actual, LEGAL_DRAFTS: texts.drafts };
});

vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({ tasks: { trigger: () => Promise.resolve({ id: 'run-1' }) }, runs: { cancel: () => Promise.resolve() } }),
  };
});

// Nothing here connects anywhere: a probe answers at once, and is counted,
// because a refused door must not reach it.
const { probed } = vi.hoisted(() => ({ probed: [] as string[] }));
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  const passes = (side: string) => async () => {
    probed.push(side);
    return { ok: true };
  };
  return { ...actual, probeSourceConnection: vi.fn(passes('source')), probeTargetConnection: vi.fn(passes('target')) };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: vi.fn(async () => undefined) };
});

const { default: migrationRoutes } = await import('./routes/migrations/index.ts');
const { default: connectionRoutes } = await import('./routes/connections.ts');
const { default: meRoutes } = await import('./routes/me.ts');
const { acceptanceAtStart } = await import('./conditions-not-accepted.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/me', meRoutes);

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
const DAV = { url: 'https://cloud.example.test/remote.php/dav/', username: 'u', password: 'p' };
let nextcloudSecret = '';

let created = 0;
/** The wizard's create, for a new account each time so no two are the same migration. */
const createBody = () => {
  created += 1;
  const account = `accepting-${created}@example.invalid`;
  return {
    name: `migration ${created}`,
    sourceType: 'imap',
    targetType: 'jmap',
    sourceConfig: { host: 'src.example.invalid', port: 993, username: account, password: 'p' },
    targetConfig: { host: 'dst.example.invalid', port: 443, username: account, password: 'p' },
    syncConfig: { domains: ['email'] },
  };
};

/** The three doors that store a credential. */
const DOORS: readonly Door[] = [
  {
    name: 'adding a connection',
    path: '/api/connections',
    spec: '/api/connections',
    body: { role: 'target', type: 'nextcloud', displayName: 'another', values: DAV },
    accepted: 201,
    wrote: () => count('SELECT count(*) AS n FROM connection WHERE tenant_id = $1', [TENANT]),
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
    name: 'creating a migration',
    path: '/api/migrations',
    spec: '/api/migrations',
    get body() {
      return createBody();
    },
    accepted: 201,
    wrote: () => count('SELECT count(*) AS n FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]),
  },
];

const press = (door: Door) => request(app)[door.method ?? 'post'](door.path).send(door.body ?? {});

async function pressAs(userId: string, door: Door) {
  caller.userId = userId;
  try {
    return await press(door);
  } finally {
    caller.userId = TESTER;
  }
}

/** Recording an acceptance, as the screen does. */
const ACCEPTING: Door = {
  name: 'accepting the texts',
  path: '/api/me/acceptance',
  spec: '/api/me/acceptance',
  body: { versions: LEGAL_VERSIONS, language: 'nl' },
  accepted: 200,
};

const saved: Record<string, string | undefined> = {};
const ENV = ['OWNPACE_STAGE', 'MAX_MIGRATIONS_PER_ORGANISATION', 'API_URL', 'WEB_URL'] as const;

beforeAll(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.MAX_MIGRATIONS_PER_ORGANISATION = '50';
  process.env.API_URL = 'https://api.example';
  process.env.WEB_URL = 'https://app.example';

  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  nextcloudSecret = sealed(DAV);
  await sql('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Accepting thuis']);
  await sql(`INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, $2, 'tester@example.invalid')`, [
    TENANT,
    TESTER,
  ]);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1, $2, 'target', 'nextcloud', 'n', $3::jsonb, 'connected', $4)`,
    [NEXTCLOUD, TENANT, JSON.stringify({ url: DAV.url }), nextcloudSecret],
  );
}, 120_000);

afterAll(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await driver?.end();
});

beforeEach(() => {
  probed.length = 0;
});

// ─── 1. The sweep ────────────────────────────────────────────────────────────

/** The helper every door asks, and its own file. */
const THE_CHECK = 'conditions-not-accepted.ts';
const ASKS = /\brefusedUntilAccepted\s*\(/g;

/** The checks the doors make, by file. Pinned, so a check taken out fails. */
const CHECKS_BY_FILE: Readonly<Record<string, number>> = {
  'routes/connections.ts': 2,
  'routes/migrations/index.ts': 1,
  // Issuing a grant link: the member's door to what a family member's consent
  // stores (`grant-ending.ts`, below).
  'routes/migrations/link-routes.ts': 1,
  // Issuing a PERSON'S grant link (0153 T5 (b)): the member's door to what
  // that person's consent stores (`person-grant-ending.ts`, below).
  'routes/person-link-routes.ts': 1,
};

/** Where the API seals a credential to store it: a call, not a definition. */
const SEALS = /\bSecretStore\.encryptCredentials\s*\(/g;

/** Every place that seals one today, counted per file. A new one changes a count here. */
const SEALS_BY_FILE: Readonly<Record<string, number>> = {
  'routes/connections.ts': 2,
  'routes/migrations/index.ts': 2,
  'routes/migrations/grant-ending.ts': 1,
  'routes/migrations/person-grant-ending.ts': 1,
  'scripts/seed-managed.ts': 2,
};

/** The files that seal a credential and never ask, and why that is right. */
const SEALED_WITHOUT_ASKING: Readonly<Record<string, string>> = {
  'routes/migrations/grant-ending.ts':
    'a grant link’s consent. The person granting is not a party to the terms (terms §1) and has no ' +
    'account to accept them with. The member’s door to it is issuing the link, ' +
    '`POST /api/migrations/{mappingId}/links` (`link-routes.ts`), which asks, so no grant link reaches ' +
    'anybody from a member who has not accepted the current versions.',
  'routes/migrations/person-grant-ending.ts':
    'a person’s grant link’s consent (0153 T5 (b)), for grant-ending.ts’s reason: the person granting is not ' +
    'a party to the terms. The member’s door to it is issuing the link, `POST /api/people/{personId}/links` ' +
    '(`person-link-routes.ts`), which asks.',
  'scripts/seed-managed.ts':
    'the operator’s seed of the demo tenants, run by hand on a stack as the database owner. It is no ' +
    'door anybody signs in to, and a stack that asks for acceptance is not seeded.',
};

describe('the sweep: every door that stores a credential asks whether the conditions are accepted', () => {
  it('the checks the doors make are pinned per file, so one taken out fails', () => {
    const calls: Record<string, number> = {};
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (rel === THE_CHECK) continue;
      const n = code(file).match(ASKS)?.length ?? 0;
      if (n > 0) calls[rel] = n;
    }
    expect(calls).toEqual(CHECKS_BY_FILE);
  });

  it('every credential sealed is counted, and each file that seals one asks or says why not', () => {
    const seals: Record<string, number> = {};
    const unasked: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      const text = code(file);
      const n = text.match(SEALS)?.length ?? 0;
      if (n === 0) continue;
      seals[rel] = n;
      if (!ASKS.test(text) && !SEALED_WITHOUT_ASKING[rel]) unasked.push(rel);
      ASKS.lastIndex = 0;
    }
    expect(
      seals,
      'a credential is sealed somewhere new, or no longer where it was. The door it sits in must ask ' +
        '(`refusedUntilAccepted`) before it stores anything, or its file must say below why it need not. ' +
        'Then change the count.',
    ).toEqual(SEALS_BY_FILE);
    expect(unasked, 'these files store a credential and never ask whether the conditions are accepted').toEqual([]);
    for (const rel of Object.keys(SEALED_WITHOUT_ASKING)) {
      expect(seals[rel], `${rel} is excused, and seals no credential`).toBeGreaterThan(0);
    }
  });

  it('each door asks after its own refusals of the body and before anything is stored or probed', () => {
    // Where the check sits, per door: after the close's, and before the
    // first probe or write. A check after the store would refuse a door that
    // had already stored.
    const connections = code(join(SRC, 'routes', 'connections.ts'));
    for (const [from, to] of [
      ["router.post('/', authenticate", "router.post('/:id/test'"],
      ["router.put('/:id/credentials'", "router.delete('/:id'"],
    ] as const) {
      const body = connections.slice(connections.indexOf(from), connections.indexOf(to));
      const asks = body.search(ASKS);
      expect(asks, `${from}: no check`).toBeGreaterThan(-1);
      expect(body.indexOf('probeTargetConnection('), `${from}: probes before it asks`).toBeGreaterThan(asks);
      expect(body.indexOf('encryptCredentials('), `${from}: seals before it asks`).toBeGreaterThan(asks);
    }
    const migrations = code(join(SRC, 'routes', 'migrations', 'index.ts'));
    const create = migrations.slice(migrations.indexOf("router.post('/', authenticate"));
    const asks = create.search(ASKS);
    expect(asks, 'creating a migration: no check').toBeGreaterThan(-1);
    expect(create.indexOf('withTenantDb('), 'creating a migration: writes before it asks').toBeGreaterThan(asks);

    const links = code(join(SRC, 'routes', 'migrations', 'link-routes.ts'));
    const issue = links.slice(links.indexOf("'/:mappingId/links'"), links.indexOf('router.get('));
    const linkAsks = issue.search(ASKS);
    expect(linkAsks, 'issuing a grant link: no check').toBeGreaterThan(-1);
    expect(issue.indexOf('issueWithinTheLimit('), 'issuing a grant link: writes before it asks').toBeGreaterThan(
      linkAsks,
    );
  });
});

// ─── 2. Off ──────────────────────────────────────────────────────────────────

/** Before each press: the rows as they were. */
async function resetFor(door: Door): Promise<void> {
  await door.reset?.();
}

describe('with the switch off, each door answers as it always has', () => {
  beforeAll(() => {
    delete process.env.OWNPACE_STAGE;
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s', async (_name, door) => {
    await resetFor(door);
    const res = await press(door);
    expect(res.status, JSON.stringify(res.body)).toBe(door.accepted);
    expect(res.body?.error).not.toBe('conditions_not_accepted');
  });
});

// ─── 3. On, and not accepted ─────────────────────────────────────────────────

/** Each door, refused: 409, the texts named, nothing written or probed. */
async function expectRefused(door: Door): Promise<void> {
  await resetFor(door);
  const before = door.wrote ? await door.wrote() : 0;

  const res = await press(door);

  expect(res.status, JSON.stringify(res.body)).toBe(409);
  expect(res.body.error).toBe('conditions_not_accepted');
  expect(res.body.documents).toEqual(
    LEGAL_DOCUMENTS.map((document) => ({ document, version: LEGAL_VERSIONS[document] })),
  );
  expect(res.body.message).toMatch(/accept/i);
  expect(res.body.reason).toBe(res.body.message);
  expect(res.body.messageNl).toMatch(/aanvaard/i);
  expect(res.body.reasonNl).toBe(res.body.messageNl);
  expect(probed, 'a refused door used the access it was given').toEqual([]);
  if (door.wrote) expect(await door.wrote(), 'a refused door wrote').toBe(before);
}

describe('with the switch on, before anything is accepted', () => {
  beforeAll(() => {
    process.env.OWNPACE_STAGE = 'alpha';
  });

  it.each(DOORS.map((d) => [d.name, d] as const))(
    '%s answers 409 conditions_not_accepted, names the texts, and stores nothing',
    async (_name, door) => {
      await expectRefused(door);
    },
  );

  it.each(DOORS.map((d) => [d.name, d] as const))('%s: the spec documents that answer', async (_name, door) => {
    await resetFor(door);
    const { raw, schema } = CHECKER.responseSchema(door, '409');
    expect(JSON.stringify(raw)).toContain('ConditionsNotAccepted');
    const res = await press(door);
    expect(res.status).toBe(409);
    expect(
      CHECKER.satisfies(schema, res.body),
      `${door.spec}: the body ${JSON.stringify(res.body)} is not valid against its documented 409`,
    ).toBe(true);
  });

  it('an acceptance of an older version is not an acceptance of this one', async () => {
    await sql(
      `INSERT INTO legal_acceptance (tenant_id, subject, document, version, language)
       SELECT $1, $2, d, '0.9', 'nl' FROM unnest($3::text[]) AS d`,
      [TENANT, TESTER, [...LEGAL_DOCUMENTS]],
    );
    for (const door of DOORS) await expectRefused(door);
  });

  it('another member’s acceptance is not this person’s', async () => {
    await sql(`INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, 'colleague', 'c@example.invalid')`, [
      TENANT,
    ]);
    await withTenant(driver, TENANT, (db) => recordAcceptance(db, TENANT, 'colleague', LEGAL_VERSIONS, 'en'));
    for (const door of DOORS) await expectRefused(door);
  });
});

// ─── 4. On, and accepted ─────────────────────────────────────────────────────

describe('once the person has accepted the current version of each text', () => {
  beforeAll(async () => {
    process.env.OWNPACE_STAGE = 'alpha';
    const got = await withTenant(driver, TENANT, (db) => recordAcceptance(db, TENANT, TESTER, LEGAL_VERSIONS, 'nl'));
    expect(got.kind).toBe('recorded');
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s answers as it did with the switch off', async (_name, door) => {
    await resetFor(door);
    const res = await press(door);
    expect(res.status, JSON.stringify(res.body)).toBe(door.accepted);
    expect(res.body?.error).not.toBe('conditions_not_accepted');
  });
});

// ─── 5. On, while a text is still a draft ────────────────────────────────────

describe('with the switch on while a text is still a draft, nobody is asked', () => {
  beforeAll(async () => {
    process.env.OWNPACE_STAGE = 'alpha';
    // Somebody new, who has accepted nothing: were anybody asked, they would be.
    await sql(`INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, 'newcomer', 'n@example.invalid')`, [
      TENANT,
    ]);
    texts.drafts.privacy = true;
  });

  afterAll(() => {
    texts.drafts.privacy = false;
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s answers as it does with the switch off', async (_name, door) => {
    await resetFor(door);
    const res = await pressAs('newcomer', door);
    expect(res.status, JSON.stringify(res.body)).toBe(door.accepted);
    expect(res.body?.error).not.toBe('conditions_not_accepted');
  });

  it('recording an acceptance is refused with 409 acceptance_not_asked, and writes nothing', async () => {
    const before = await count('SELECT count(*) AS n FROM legal_acceptance WHERE tenant_id = $1 AND subject = $2', [
      TENANT,
      'newcomer',
    ]);
    const res = await pressAs('newcomer', ACCEPTING);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('acceptance_not_asked');
    expect(res.body.messageNl).toBeTruthy();
    expect(
      await count('SELECT count(*) AS n FROM legal_acceptance WHERE tenant_id = $1 AND subject = $2', [
        TENANT,
        'newcomer',
      ]),
    ).toBe(before);
    const { schema } = CHECKER.responseSchema(ACCEPTING, '409');
    expect(CHECKER.satisfies(schema, res.body), `the spec does not document ${JSON.stringify(res.body)}`).toBe(true);
  });

  it('with the switch off, recording an acceptance is refused the same way', async () => {
    delete process.env.OWNPACE_STAGE;
    try {
      const res = await pressAs('newcomer', ACCEPTING);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('acceptance_not_asked');
    } finally {
      process.env.OWNPACE_STAGE = 'alpha';
    }
  });

  it('the API says so when it starts, naming the drafts, so live does not seem to ask when it does not', () => {
    expect(acceptanceAtStart({ OWNPACE_STAGE: 'alpha' }, { alpha: false, privacy: true, terms: true })).toMatch(
      /privacy.*terms.*draft.*nobody/is,
    );
    expect(acceptanceAtStart({ OWNPACE_STAGE: 'alpha' }, { alpha: false, privacy: false, terms: false })).toMatch(
      /alpha 1\.0.*privacy.*terms/i,
    );
    expect(acceptanceAtStart({}, { alpha: false, privacy: true, terms: true })).toBeNull();
  });
});
