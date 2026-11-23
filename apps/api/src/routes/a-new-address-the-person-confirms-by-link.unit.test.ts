// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NEW ADDRESS THE PERSON CONFIRMS THROUGH THEIR LINK (workplan 0168 §4.4,
 * D6; ADR-0035, ADR-0055).
 *
 * Kid has a grant link and a progress link, and Kid's row of the
 * organisation's address changes is linked to Kid. The table also holds Mum's
 * row, confirmed by the owner for Mum, a row linked to nobody, and another
 * organisation's row for its own person. It holds:
 *
 *  - a link reaches only its own person's rows: each of Kid's pages carries
 *    Kid's row and nothing else, named by an opaque ref, with its new address
 *    and never its old one, shaped as `openapi.yaml` says, and a migration's
 *    own link carries none;
 *  - a ref of another person's row, of a row linked to nobody, of another
 *    organisation's, a made-up one and an old key are the same 404, after the
 *    same work, and nothing changes;
 *  - a body with anything but `state` and the address the page showed is
 *    refused, in both languages, and nothing changes;
 *  - a Yes or a Not right? on a page whose address has changed since it was
 *    opened is refused `changed`, in both languages, and nothing changes;
 *  - a link the other routes of its page refuse is refused the same way, in
 *    the same words: forged, unknown, expired, revoked, a grant link used up,
 *    the other page's link, and on the grant page a closed organisation;
 *  - the attribution: Kid's own confirmation is stored as Kid's, and said as
 *    Kid's name to the owner and as theirs to the member Kid is, never as an
 *    address and never as an id; the owner's confirmation for Kid stays the
 *    owner's, and Kid can still send it back;
 *  - two presses at once leave one confirmed row. PGlite has one connection,
 *    so here the two cannot overlap; the integration tier holds it on
 *    Postgres with two (`a-new-address-confirmed-twice-at-once`).
 *
 * PGlite as `app_user`, both chains. Only `authenticate` is stubbed, for the
 * organisation's own routes, where the owner reads the attribution. UUID
 * family 0168b3d1-…, unused elsewhere in the repo. Names and addresses are
 * invented.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import {
  addAddressChange,
  expiryFromDays,
  issueMappingLink,
  pgliteDriver,
  readAddressChanges,
  runMigrations,
  withTenant,
} from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import {
  addressChangeAnswer,
  answerAddressChangeByLink,
  issuePersonLink,
  linkAddressChangePerson,
  linkRowRef,
  memberLabels,
  readAddressChangePeople,
  revokePersonLink,
  runManagedMigrations,
  spendPersonLink,
} from '@openmig/managed';
import { createHash } from 'node:crypto';
import { specChecker } from '../__tests__/doors-that-start-work.ts';
import { CHANGED_SINCE_SHOWN, NOT_ONE_OF_YOURS, ONLY_THE_ANSWER } from './link-address-changes.ts';
import { setAuditKeyDriver } from '../audit-key.ts';

const U = (n: string) => `0168b3d1-e29b-41d4-a716-4466554430${n}`;
const TENANT = U('01');
const OTHER = U('02');
const SOURCE = U('11');
const TARGET = U('12');
const SOURCE_BOX = U('21');
const TARGET_BOX = U('22');
const CAL = U('31');
const KID = U('41');
const MUM = U('42');
const THEIRS = U('43');

const OWNER = 'owner-subject';
const KID_MEMBER = 'kid-subject';

const KID_KEY = 'kidname@gmail.com';
const KID_OLD = 'Kid.Name@gmail.com';
const KID_NEW = 'kid@example.org';
const KID_REF = linkRowRef(TENANT, KID, KID_KEY);
const KID_ROW = { ref: KID_REF, newAddress: KID_NEW, state: 'proposed' };
const MUM_KEY = 'mum@gmail.com';
const MUM_ROW = { ref: linkRowRef(TENANT, MUM, MUM_KEY), newAddress: 'mum@example.org', state: 'confirmed' };

/** What a press sends: the answer, and the new address the page showed. */
const answer = (state: 'confirmed' | 'proposed', newAddress = KID_NEW) => ({ state, newAddress });
/** Not one of Kid's: the 404 every ref Kid's link does not reach answers. */
const NOT_KIDS = { error: 'address_change_not_found', message: NOT_ONE_OF_YOURS.en, messageNl: NOT_ONE_OF_YOURS.nl };

const CHECKER = specChecker(join(import.meta.dirname, '..', '..', 'docs', 'openapi.yaml'));
const shapedAs = (name: string, body: unknown): boolean =>
  CHECKER.satisfies(CHECKER.resolve(`#/components/schemas/${name}`), body);
function documented(spec: string, status: string, body: unknown): boolean {
  const { schema } = CHECKER.responseSchema({ name: spec, path: spec, spec, method: 'put', accepted: 200 } as never, status);
  return CHECKER.satisfies(schema, body);
}

let driver: LedgerDriver;
let caller: { tenantId: string; userId: string; userRole: string } = { tenantId: TENANT, userId: OWNER, userRole: 'owner' };

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, caller);
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: grantRoutes } = await import('./grant.ts');
const { default: viewRoutes } = await import('./view.ts');
const { default: addressChangeRoutes } = await import('./address-changes.ts');

const app = express();
app.use(express.json());
app.use('/api/grant', grantRoutes);
app.use('/api/view', viewRoutes);
app.use('/api/address-changes', addressChangeRoutes);

async function q(statement: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(statement, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** A row's state and who confirmed it, as stored. */
async function stored(tenantId: string, oldKey: string) {
  const [row] = await q(
    'SELECT new_address, state, confirmed_by FROM address_change WHERE tenant_id = $1 AND old_key = $2',
    [tenantId, oldKey],
  );
  return row;
}

const put = (door: 'grant' | 'view', token: string, ref: string, body: unknown) =>
  request(app).put(`/api/${door}/${token}/address-changes/${encodeURIComponent(ref)}`).send(body as object);

/** A person's link of one purpose, live for a week unless said otherwise. */
async function personLink(personId: string, purpose: 'grant' | 'view', expiresAt = expiryFromDays(7)) {
  return withTenant(driver, TENANT, (db) =>
    issuePersonLink(db, { tenantId: TENANT, personId, purpose, createdBy: OWNER, expiresAt }),
  );
}

/** The table as it is seeded before each case. */
async function seedTable(): Promise<void> {
  await q('DELETE FROM address_change');
  const add = async (
    tenantId: string,
    oldAddress: string,
    newAddress: string,
    confirm: boolean,
    personId: string | null,
  ): Promise<void> => {
    await withTenant(driver, tenantId, async (db) => {
      const w = await addAddressChange(db, tenantId, { oldAddress, newAddress, confirm, by: OWNER });
      if (!w.ok) throw new Error(w.refusal.message);
      if (personId) await linkAddressChangePerson(db, tenantId, w.row.oldKey, personId);
    });
  };
  await add(TENANT, KID_OLD, KID_NEW, false, KID);
  await add(TENANT, MUM_KEY, MUM_ROW.newAddress, true, MUM);
  await add(TENANT, 'grandpa@hotmail.com', 'grandpa@example.org', false, null);
  await add(OTHER, 'theirs@gmail.com', 'theirs@example.org', false, THEIRS);
}

/** The organisation's rows as its routes answer them to the member `asker`. */
async function answersFor(asker: string) {
  return withTenant(driver, TENANT, async (db) => {
    const facts = { labels: await memberLabels(db, TENANT), people: await readAddressChangePeople(db, TENANT), asker };
    return (await readAddressChanges(db, TENANT)).map((r) => addressChangeAnswer(r, facts));
  });
}

let kidGrant: string;
let kidView: string;
let kidGrantId: string;
let kidViewId: string;
let mumView: string;

/** Kid's two links, made afresh (a person deleted takes their links). */
async function kidsLinks(): Promise<void> {
  const grant = await personLink(KID, 'grant');
  const view = await personLink(KID, 'view');
  [kidGrant, kidGrantId, kidView, kidViewId] = [grant.token, grant.id, view.token, view.id];
}

beforeAll(async () => {
  process.env.API_URL = 'https://api.example';
  process.env.WEB_URL = 'https://app.example';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'deployment.apps.googleusercontent.com';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'not-a-real-deployment-secret';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  // A write through the table's own route records itself in the audit log by
  // the row's pseudonym, read on the owner's connection (`audit-key.ts`), as
  // the API's start-up sets it; here the same in-process database.
  setAuditKeyDriver(driver);

  await q('INSERT INTO tenant (id, name) VALUES ($1, $2), ($3, $4)', [TENANT, 'Example family', OTHER, 'Other family']);
  await q(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES
       ($1, $2, 'owner@example.org', 'owner', 'active'), ($1, $3, 'kid.member@example.org', 'member', 'active')`,
    [TENANT, OWNER, KID_MEMBER],
  );
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
       ($1,$3,'source','google','kid','{"user":"kid.name@gmail.com"}'::jsonb,'connected'),
       ($2,$3,'target','nextcloud','nc','{"host":"cloud.example.org","port":443}'::jsonb,'connected')`,
    [SOURCE, TARGET, TENANT],
  );
  for (const [box, conn] of [
    [SOURCE_BOX, SOURCE],
    [TARGET_BOX, TARGET],
  ]) {
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [box, TENANT, conn],
    );
  }
  await q(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, target_config_override, status)
     VALUES ($1,$2,$3,$4,'{"user":"kid@cloud.example.org"}'::jsonb,'paused')`,
    [CAL, TENANT, SOURCE_BOX, TARGET_BOX],
  );
  await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,'calendar',true)`, [
    TENANT,
    CAL,
  ]);
  // Kid is also a member of the organisation: their own confirmation is
  // still the person's, never said as that member's address.
  await q(
    `INSERT INTO person (id, tenant_id, display_name, user_id) VALUES ($1,$3,'Kid',$5), ($2,$3,'Mum',NULL), ($4,$6,'Theirs',NULL)`,
    [KID, MUM, TENANT, THEIRS, KID_MEMBER, OTHER],
  );
  await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [CAL, KID, TENANT]);

  await kidsLinks();
  mumView = (await personLink(MUM, 'view')).token;
}, 120_000);

afterAll(async () => {
  setAuditKeyDriver(undefined);
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  await driver?.end?.();
});

beforeEach(async () => {
  caller = { tenantId: TENANT, userId: OWNER, userRole: 'owner' };
  await q(`UPDATE tenant SET status = 'active' WHERE id = $1`, [TENANT]);
  await seedTable();
});

describe('a link reaches only its own person’s rows', () => {
  it('carries Kid’s row on Kid’s grant page and progress page, and nobody else’s', async () => {
    const grant = await request(app).get(`/api/grant/${kidGrant}`);
    expect(grant.status, JSON.stringify(grant.body)).toBe(200);
    expect(grant.body.addressChanges).toEqual([KID_ROW]);
    expect(shapedAs('PersonGrantPage', grant.body)).toBe(true);

    const view = await request(app).get(`/api/view/${kidView}`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.addressChanges).toEqual([KID_ROW]);
    expect(shapedAs('PersonProgressPage', view.body)).toBe(true);

    // Kid's old address is named nowhere, in any spelling: only the new one.
    const said = JSON.stringify([grant.body.addressChanges, view.body]);
    for (const other of ['kid.name', 'kidname', 'gmail', 'mum@', 'grandpa@', 'theirs@', OWNER, KID, TENANT]) {
      expect(said.toLowerCase()).not.toContain(other);
    }
    expect(said).toContain(KID_NEW);
  });

  it('names a row by a ref only the server can make: not from the address, and another for another person', () => {
    expect(KID_REF).toMatch(/^[0-9a-f]{32}$/);
    for (const fromTheAddress of [KID_KEY, KID_OLD, KID_NEW]) {
      expect(KID_REF).not.toBe(createHash('sha256').update(fromTheAddress).digest('hex').slice(0, 32));
    }
    expect(linkRowRef(TENANT, MUM, KID_KEY)).not.toBe(KID_REF);
    expect(linkRowRef(OTHER, KID, KID_KEY)).not.toBe(KID_REF);
  });

  it('carries Mum’s row on Mum’s page, and none on a page whose person has none', async () => {
    const mum = await request(app).get(`/api/view/${mumView}`);
    expect(mum.status).toBe(200);
    expect(mum.body.addressChanges).toEqual([MUM_ROW]);

    await q(`DELETE FROM address_change_person WHERE person_id = $1`, [MUM]);
    const none = await request(app).get(`/api/view/${mumView}`);
    expect(none.body.addressChanges).toEqual([]);
    expect(shapedAs('PersonProgressPage', none.body)).toBe(true);
  });

  it('carries none on a migration’s own link, which names no person', async () => {
    const own = await withTenant(driver, TENANT, (db) =>
      issueMappingLink(db, { tenantId: TENANT, mappingId: CAL, purpose: 'view', createdBy: OWNER, expiresAt: expiryFromDays(7) }),
    );
    const page = await request(app).get(`/api/view/${own.token}`);
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body).not.toHaveProperty('addressChanges');
    expect(JSON.stringify(page.body)).not.toContain('@');
  });
});

describe('another person’s row is a 404', () => {
  /** Every ref Kid's link does not reach: each is answered alike. */
  const notKids = (): ReadonlyArray<readonly [string, string]> => [
    ['Mum’s row, by Mum’s own ref', MUM_ROW.ref],
    ['Mum’s row, under Kid', linkRowRef(TENANT, KID, MUM_KEY)],
    ['a row linked to nobody', linkRowRef(TENANT, KID, 'grandpa@hotmail.com')],
    ['another organisation’s row, by its own ref', linkRowRef(OTHER, THEIRS, 'theirs@gmail.com')],
    ['Kid’s key in another organisation', linkRowRef(OTHER, KID, KID_KEY)],
    ['a ref never made', 'f'.repeat(32)],
    ['the old key itself', KID_KEY],
    ['an address', MUM_KEY],
  ];

  it('answers a row of Mum’s, of nobody’s, of another organisation’s and a made-up one alike, and changes none', async () => {
    for (const door of ['grant', 'view'] as const) {
      const token = door === 'grant' ? kidGrant : kidView;
      for (const [what, ref] of notKids()) {
        for (const state of ['confirmed', 'proposed'] as const) {
          const res = await put(door, token, ref, answer(state, 'mum@example.org'));
          expect(res.status, `${door} ${what} ${state}`).toBe(404);
          expect(res.body, what).toEqual(NOT_KIDS);
          expect(documented(`/api/${door}/{link}/address-changes/{ref}`, '404', res.body)).toBe(true);
        }
      }
    }
    expect(await stored(TENANT, 'mum@gmail.com')).toEqual({ new_address: 'mum@example.org', state: 'confirmed', confirmed_by: OWNER });
    expect(await stored(TENANT, 'grandpa@hotmail.com')).toMatchObject({ state: 'proposed', confirmed_by: null });
    expect(await stored(OTHER, 'theirs@gmail.com')).toMatchObject({ state: 'proposed', confirmed_by: null });
  });

  it('reaches no row through a migration’s own link, not even its person’s', async () => {
    const own = await withTenant(driver, TENANT, (db) =>
      issueMappingLink(db, { tenantId: TENANT, mappingId: CAL, purpose: 'view', createdBy: OWNER, expiresAt: expiryFromDays(7) }),
    );
    const res = await put('view', own.token, KID_REF, answer('confirmed'));
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_KIDS);
    expect(await stored(TENANT, KID_KEY)).toMatchObject({ state: 'proposed', confirmed_by: null });
  });

  it('costs the same work for every ref it does not reach, so a link cannot learn whose rows exist', async () => {
    const AUDIT = { actor: 'progress-link', pseudonym: () => 'a-row-reference' };
    /** The answer, and how many statements it sent. */
    const work = (ref: string) =>
      withTenant(driver, TENANT, async (db) => {
        let statements = 0;
        const counted = new Proxy(db, {
          get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver) as unknown;
            if (prop !== 'execute' || typeof value !== 'function') return value;
            return (...args: unknown[]) => {
              statements += 1;
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          },
        });
        const out = await answerAddressChangeByLink(counted, TENANT, KID, { ref, ...answer('confirmed') }, AUDIT);
        return { out, statements };
      });
    const costs = new Set<number>();
    for (const [what, ref] of notKids()) {
      const { out, statements } = await work(ref);
      expect(out, what).toEqual({ ok: false, refused: 'not_found' });
      costs.add(statements);
    }
    expect([...costs], 'every ref Kid’s link does not reach costs the same').toHaveLength(1);
    expect(await stored(TENANT, MUM_KEY)).toMatchObject({ state: 'confirmed', confirmed_by: OWNER });
  });
});

describe('a body with anything but state and the address shown is refused', () => {
  it('refuses every other field, a missing state or address and a state it does not know, in both languages, and changes nothing', async () => {
    const bodies: unknown[] = [
      { state: 'confirmed' },
      { newAddress: KID_NEW },
      { state: 'confirmed', newAddress: KID_NEW, personId: MUM },
      { state: 'confirmed', newAddress: KID_NEW, oldAddress: 'other@gmail.com' },
      { state: 'confirmed', newAddress: '' },
      {},
      { state: 'rejected', newAddress: KID_NEW },
      ['confirmed'],
    ];
    for (const door of ['grant', 'view'] as const) {
      const token = door === 'grant' ? kidGrant : kidView;
      for (const body of bodies) {
        const res = await put(door, token, KID_REF, body);
        expect(res.status, `${door} ${JSON.stringify(body)}`).toBe(400);
        expect(res.body).toEqual({ error: 'invalid_request', message: ONLY_THE_ANSWER.en, messageNl: ONLY_THE_ANSWER.nl });
        expect(documented(`/api/${door}/{link}/address-changes/{ref}`, '400', res.body)).toBe(true);
      }
    }
    expect(await stored(TENANT, KID_KEY)).toEqual({ new_address: 'kid@example.org', state: 'proposed', confirmed_by: null });
    expect(await q('SELECT person_id FROM address_change_person WHERE old_key = $1', [KID_KEY])).toEqual([{ person_id: KID }]);
  });
});

describe('a refused link is refused the same way', () => {
  it('answers each link its page refuses with that page’s own refusal, and changes nothing', async () => {
    const forged = `${kidView.slice(0, kidView.lastIndexOf('.'))}.${'x'.repeat(43)}`;
    const unknown = `p.${randomUUID()}.${'y'.repeat(43)}`;
    const expired = (await personLink(KID, 'view', new Date(Date.now() - 60_000))).token;
    const revoked = await personLink(KID, 'view');
    await withTenant(driver, TENANT, (db) => revokePersonLink(db, { tenantId: TENANT, personId: KID, linkId: revoked.id }));
    const used = await personLink(KID, 'grant');
    await withTenant(driver, TENANT, (db) => spendPersonLink(db, { tenantId: TENANT, linkId: used.id }));

    const refused: ReadonlyArray<readonly [string, 'grant' | 'view', string]> = [
      ['forged', 'view', forged],
      ['unknown', 'view', unknown],
      ['expired', 'view', expired],
      ['revoked', 'view', revoked.token],
      ['a grant link used up', 'grant', used.token],
      ['the progress page’s link at the grant page', 'grant', kidView],
      ['the grant page’s link at the progress page', 'view', kidGrant],
      ['not a link at all', 'view', 'not-a-link'],
    ];
    for (const [what, door, token] of refused) {
      const page = await request(app).get(`/api/${door}/${token}`);
      expect(page.status, what).toBe(401);
      const res = await put(door, token, KID_REF, answer('confirmed'));
      expect(res.status, what).toBe(401);
      expect(res.body, what).toEqual(page.body);
      expect(res.body).toMatchObject({ error: 'link_unusable' });
      expect(typeof res.body.messageNl, what).toBe('string');
    }
    expect(await stored(TENANT, KID_KEY)).toMatchObject({ state: 'proposed', confirmed_by: null });
  });

  it('refuses a closed organisation at the grant page, as the grant page does, and not at the progress page', async () => {
    await q(`UPDATE tenant SET status = 'closed' WHERE id = $1`, [TENANT]);
    const page = await request(app).get(`/api/grant/${kidGrant}`);
    expect(page.status).toBe(409);
    expect(page.body.error).toBe('account_closed');
    const res = await put('grant', kidGrant, KID_REF, answer('confirmed'));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(page.body);
    expect(res.body.messageNl).toEqual(expect.any(String));
    expect(documented('/api/grant/{link}/address-changes/{ref}', '409', res.body)).toBe(true);
    expect(await stored(TENANT, KID_KEY)).toMatchObject({ state: 'proposed', confirmed_by: null });

    // The progress page still opens for a closed organisation (reading is
    // never refused), and its answer starts nothing, so it is not refused.
    expect((await request(app).get(`/api/view/${kidView}`)).status).toBe(200);
    const view = await put('view', kidView, KID_REF, answer('confirmed'));
    expect(view.status).toBe(200);
  });
});

describe('an answer on a page whose address has changed since it was opened', () => {
  /** The owner types another new address for Kid's row, on the team screen. */
  const ownerReaddresses = async (newAddress: string) => {
    const res = await request(app).put(`/api/address-changes/${encodeURIComponent(KID_KEY)}`).send({ newAddress });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const CHANGED = { error: 'changed', message: CHANGED_SINCE_SHOWN.en, messageNl: CHANGED_SINCE_SHOWN.nl };

  it('refuses a Yes for the address the page showed, confirms nothing, and records nothing', async () => {
    await q('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
    await ownerReaddresses('somebody.else@example.net');
    for (const door of ['grant', 'view'] as const) {
      const res = await put(door, door === 'grant' ? kidGrant : kidView, KID_REF, answer('confirmed'));
      expect(res.status, door).toBe(409);
      expect(res.body).toEqual(CHANGED);
      expect(documented(`/api/${door}/{link}/address-changes/{ref}`, '409', res.body)).toBe(true);
    }
    expect(await stored(TENANT, KID_KEY)).toEqual({
      new_address: 'somebody.else@example.net',
      state: 'proposed',
      confirmed_by: null,
    });
    expect(await q(`SELECT actor FROM audit_log WHERE tenant_id = $1 AND actor LIKE '%-link'`, [TENANT])).toEqual([]);

    // The page opened again says the address as it is now, and a Yes to that
    // confirms that, as Kid's.
    const page = await request(app).get(`/api/view/${kidView}`);
    expect(page.body.addressChanges).toEqual([{ ref: KID_REF, newAddress: 'somebody.else@example.net', state: 'proposed' }]);
    const yes = await put('view', kidView, KID_REF, answer('confirmed', 'somebody.else@example.net'));
    expect(yes.status).toBe(200);
    expect(yes.body).toEqual({ ref: KID_REF, newAddress: 'somebody.else@example.net', state: 'confirmed' });
    expect(await stored(TENANT, KID_KEY)).toMatchObject({ state: 'confirmed', confirmed_by: `person:${KID}` });
  });

  it('refuses a Not right? for the address the page showed, and sends nothing back', async () => {
    expect((await put('view', kidView, KID_REF, answer('confirmed'))).status).toBe(200);
    await ownerReaddresses('kid@example.net');
    await request(app).put(`/api/address-changes/${encodeURIComponent(KID_KEY)}`).send({ state: 'confirmed' });
    const res = await put('grant', kidGrant, KID_REF, answer('proposed'));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(CHANGED);
    expect(await stored(TENANT, KID_KEY)).toEqual({ new_address: 'kid@example.net', state: 'confirmed', confirmed_by: OWNER });
  });
});

describe('the attribution is said right', () => {
  it('stores Kid’s confirmation as Kid’s, and says it as Kid’s name to the owner and as theirs to Kid', async () => {
    const yes = await put('view', kidView, KID_REF, answer('confirmed'));
    expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    expect(yes.body).toEqual({ ...KID_ROW, state: 'confirmed' });
    expect(documented('/api/view/{link}/address-changes/{ref}', '200', yes.body)).toBe(true);
    // The person, by id, never the subject of the member Kid also is.
    expect(await stored(TENANT, KID_KEY)).toEqual({
      new_address: 'kid@example.org',
      state: 'confirmed',
      confirmed_by: `person:${KID}`,
    });

    // To the owner, on the team screen: *Confirmed by Kid*.
    const table = await request(app).get('/api/address-changes');
    expect(table.status).toBe(200);
    const kid = (table.body.rows as Array<Record<string, unknown>>).find((r) => r.oldKey === KID_KEY);
    expect(kid).toMatchObject({
      state: 'confirmed',
      confirmedBy: 'Kid',
      confirmedByYou: false,
      // Exact where the name is not (0168, found on the way).
      confirmedByThePerson: true,
      person: { id: KID, displayName: 'Kid' },
    });
    expect(kid?.person).toEqual({ id: KID, displayName: 'Kid' });

    // To Kid, the member, on their own page: theirs, so *Confirmed*.
    const asKid = (await answersFor(KID_MEMBER)).find((r) => r.oldKey === KID_KEY);
    expect(asKid).toMatchObject({ confirmedBy: 'Kid', confirmedByYou: true });
    // And to anybody else it is not theirs.
    expect((await answersFor('somebody-else')).find((r) => r.oldKey === KID_KEY)).toMatchObject({ confirmedByYou: false });

    // Never as an address, never as an id.
    for (const said of [kid?.confirmedBy, asKid?.confirmedBy]) {
      expect(said).not.toContain('@');
      expect(said).not.toContain(KID);
      expect(said).not.toContain('person:');
    }
  });

  it('keeps the owner’s confirmation for Kid the owner’s, and Kid can send it back through the link', async () => {
    const confirmed = await request(app).put(`/api/address-changes/${encodeURIComponent(KID_KEY)}`).send({ state: 'confirmed' });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body).toMatchObject({
      confirmedBy: 'owner@example.org',
      confirmedByYou: true,
      confirmedByThePerson: false,
      person: { id: KID, displayName: 'Kid' },
    });
    expect((await answersFor(KID_MEMBER)).find((r) => r.oldKey === KID_KEY)).toMatchObject({
      confirmedBy: 'owner@example.org',
      confirmedByYou: false,
    });
    // Kid's *Yes* on a row already confirmed changes nothing: it stays the owner's.
    expect((await put('grant', kidGrant, KID_REF, answer('confirmed'))).body.state).toBe('confirmed');
    expect(await stored(TENANT, KID_KEY)).toMatchObject({ confirmed_by: OWNER });

    const back = await put('grant', kidGrant, KID_REF, answer('proposed'));
    expect(back.status).toBe(200);
    expect(back.body).toEqual(KID_ROW);
    expect(await stored(TENANT, KID_KEY)).toEqual({ new_address: 'kid@example.org', state: 'proposed', confirmed_by: null });
    const table = await request(app).get('/api/address-changes');
    expect((table.body.rows as Array<Record<string, unknown>>).find((r) => r.oldKey === KID_KEY)).toMatchObject({
      state: 'proposed',
      confirmedBy: null,
      confirmedByYou: false,
    });
  });

  it('says a person who is gone as nobody, never as their id', async () => {
    await put('view', kidView, KID_REF, answer('confirmed'));
    // Only the link goes with the person (0168 §5); the row and who confirmed it stay.
    await q(`DELETE FROM person_migration WHERE person_id = $1`, [KID]);
    await q(`DELETE FROM person WHERE id = $1`, [KID]);
    try {
      expect(await stored(TENANT, KID_KEY)).toMatchObject({ confirmed_by: `person:${KID}` });
      const row = (await answersFor(OWNER)).find((r) => r.oldKey === KID_KEY);
      expect(row).toMatchObject({ state: 'confirmed', confirmedBy: null, confirmedByYou: false, person: null });
    } finally {
      await q(`INSERT INTO person (id, tenant_id, display_name, user_id) VALUES ($1,$2,'Kid',$3)`, [KID, TENANT, KID_MEMBER]);
      await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [CAL, KID, TENANT]);
      await kidsLinks();
    }
  });
});

describe('an answer through a link is in the audit log', () => {
  /** The table's records for this organisation, oldest first. */
  const records = () =>
    q(
      `SELECT actor, action, entity, detail FROM audit_log WHERE tenant_id = $1 AND entity = 'address_change' ORDER BY at, id`,
      [TENANT],
    ) as Promise<Array<{ actor: string; action: string; entity: string; detail: Record<string, unknown> }>>;

  it('records each answer that changed the row under the link’s holder, by reference and never by address, and a press that changed nothing not at all', async () => {
    await q('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
    expect((await put('view', kidView, KID_REF, answer('confirmed'))).status).toBe(200);
    expect((await put('view', kidView, KID_REF, answer('confirmed'))).status).toBe(200);
    expect((await put('grant', kidGrant, KID_REF, answer('proposed'))).status).toBe(200);

    const got = await records();
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({
      actor: 'progress-link',
      action: 'address_change.confirmed',
      entity: 'address_change',
      detail: { from: 'proposed', to: 'confirmed', via: 'link', personId: KID, personLinkId: kidViewId },
    });
    expect(got[1]).toMatchObject({
      actor: 'grant-link',
      action: 'address_change.sent_back',
      detail: { from: 'confirmed', to: 'proposed', via: 'link', personId: KID, personLinkId: kidGrantId },
    });
    // One reference for the row in both records, and no address anywhere in them.
    expect(typeof got[0]!.detail.addressChange).toBe('string');
    expect(got[1]!.detail.addressChange).toBe(got[0]!.detail.addressChange);
    const text = JSON.stringify(got);
    expect(text).not.toContain('@');
    expect(text.toLowerCase()).not.toContain('kid.name');
    expect(text.toLowerCase()).not.toContain('kidname');
  });

  it('records nothing for a row the link does not reach', async () => {
    await q('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
    expect((await put('view', kidView, MUM_ROW.ref, answer('proposed', 'mum@example.org'))).status).toBe(404);
    expect(await records()).toEqual([]);
  });
});

describe('two presses at once', () => {
  it('leave one confirmed row, and both answer it', async () => {
    const [a, b] = await Promise.all([
      put('grant', kidGrant, KID_REF, answer('confirmed')),
      put('view', kidView, KID_REF, answer('confirmed')),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.state, b.body.state]).toEqual(['confirmed', 'confirmed']);
    expect(await q('SELECT state, confirmed_by FROM address_change WHERE tenant_id = $1 AND old_key = $2', [TENANT, KID_KEY])).toEqual([
      { state: 'confirmed', confirmed_by: `person:${KID}` },
    ]);
  });
});
