// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * CIRRUX DRIVE, CONNECTED BY THE PERSON ON THEIR OWN LINK, AND THE DOORS IT
 * HOLDS (workplan 0174 §4.3, §4.4, T5; D1 (a), D6).
 *
 * Anna moves her mail and files into her own Cirrux account. The owner saved
 * it for her with its servers and her address, and no app password. Over
 * PGlite with both chains, as `app_user`, and Cirrux faked as strictly as
 * Cirrux says it is (a code single-use and bound to its PKCE challenge):
 *
 * - **The Drive card appears only after the app password.** Before it, her
 *   page asks for the password alone; once it is stored, a Cirrux sign-in card
 *   for the same account stands beside it.
 * - **The ending stores the Drive on her account**, with the workspace it
 *   reached, writes `person_granted_connection` and one `mapping.granted` row
 *   per migration (`role: 'target'`, `via: 'sign-in'`), spends the link once
 *   both her cards are connected, and her card reads connected. The URL the button follows is Cirrux's own consent page, the
 *   one host the grant page follows for Cirrux (`CONSENT_HOSTS`).
 * - **The ending is refused when the workspace differs** from the one
 *   recorded on the account: nothing stored, the link still live, a
 *   `mapping.grant_refused` row with the category and never the workspace.
 *   The owner's own *Connect Cirrux Drive* is held to the same.
 * - **Another person's migration into her account is refused**, at the door
 *   that gives a migration to a person, at the create door (unless it names
 *   her), and at the edit door; hers goes in.
 * - **The rotation is refused** (D6): a new app password from the owner, and
 *   the owner's own Drive sign-in on her account, each with the sentence.
 */

process.env.SECRET_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { expiryFromDays, pgliteDriver, runMigrations, withTenant, type LedgerDriver } from '@openmig/ledger';
import { issuePersonLink, runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import { CIRRUX_DRIVE_GRANT_KEY, CIRRUX_DRIVE_WORKSPACE_KEY, CONSENT_HOSTS } from '@openmig/shared';
import { FakeCirrux } from '../../../../../packages/connectors/src/__testing__/cirrux-fake.ts';

// UUID family 0174f500-…, unused elsewhere in the repo.
const U = (n: string) => `0174f500-e29b-41d4-a716-4466554400${n}`;
const TENANT = U('01');
const ANNA = U('41');
const BOB = U('42');
const ICLOUD = U('11');
const ANNAS_CIRRUX = U('12');
const OWNERS_CIRRUX = U('13');
const ANNAS_MIGRATION = U('31');
const NOBODYS_MIGRATION = U('32');
const ANOTHER_WORKSPACE = '0c9b4a8e-9999-4a2b-8c3d-000000000009';
/** A placeholder, never a real password. */
const ANNAS_APP_PASSWORD = 'placeholder-app-password';

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

vi.hoisted(() => {
  process.env.JOBS_DATABASE_URL ??= 'postgres://ownpace_jobs@jobs.stand-in.invalid:6432/none';
});
vi.mock('@openmig/scheduler/pg-boss', async (importOriginal) => {
  const { aQueueStandIn, aRunId } = await import('../../__testing__/a-queue-stand-in.ts');
  return aQueueStandIn(await importOriginal(), () => aRunId(1));
});
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return {
    ...actual,
    probeTargetConnection: vi.fn(async () => ({ ok: true })),
    probeSourceConnection: vi.fn(async () => ({ ok: true })),
  };
});

const { default: grantRoutes } = await import('../grant.ts');
const { storePersonPassword } = await import('./person-grant-ending.ts');
const { default: migrationRoutes } = await import('./index.ts');
const { default: connectionRoutes } = await import('../connections.ts');
const { default: peopleRoutes } = await import('../people.ts');

const app = express();
app.use(express.json());
app.use('/api/grant', grantRoutes);
app.use('/api/migrations', migrationRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/people', peopleRoutes);

async function rows<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as R[];
  } finally {
    await conn.release();
  }
}
const sql = async (text: string, params: unknown[] = []): Promise<void> => void (await rows(text, params));
const sealed = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);
async function storedCreds(id: string): Promise<Record<string, string>> {
  const [row] = await rows<{ secret_ref: string }>('SELECT secret_ref FROM connection WHERE id = $1', [id]);
  return SecretStore.decryptCredentials(row!.secret_ref);
}
const box = (c: string) => c.replace(/00(\d\d)$/, '02$1');

interface Card {
  ref: string;
  role: string;
  way: string;
  provider: string;
  account: string;
  granted: boolean;
}

const mintLink = async () =>
  withTenant(driver, TENANT, (db) =>
    issuePersonLink(db, { tenantId: TENANT, personId: ANNA, purpose: 'grant', createdBy: 'pat', expiresAt: expiryFromDays(7) }),
  );
const mint = async () => (await mintLink()).token;

const cardsOf = async (token: string): Promise<Card[]> => {
  const res = await request(app).get(`/api/grant/${encodeURIComponent(token)}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accounts as Card[];
};
const driveCard = (cards: Card[]) => cards.find((c) => c.role === 'target' && c.way === 'sign-in' && c.provider === 'cirrux');

/** Press the Drive card's button and play Cirrux's consent screen; answers the callback. */
async function connectDrive(cirrux: FakeCirrux, token: string, ref: string) {
  const begun = await request(app).post(`/api/grant/${encodeURIComponent(token)}/cirrux/authorize`).send({ ref, locale: 'nl' });
  expect(begun.status, JSON.stringify(begun.body)).toBe(200);
  const url = new URL(begun.body.url);
  const code = cirrux.issueCode({
    challenge: url.searchParams.get('code_challenge')!,
    redirectUri: url.searchParams.get('redirect_uri')!,
  });
  const ended = await request(app).get(
    `/api/migrations/cirrux/callback?${new URLSearchParams({ state: url.searchParams.get('state')!, code, iss: 'https://api.cirrux.co' })}`,
  );
  return { url, ended };
}

/** Store Anna's app password, as T3's route will: merged into the account's record. */
const storeAppPassword = async () =>
  sql('UPDATE connection SET secret_ref = $2 WHERE id = $1', [
    ANNAS_CIRRUX,
    sealed({ ...(await storedCreds(ANNAS_CIRRUX)), password: ANNAS_APP_PASSWORD }),
  ]);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Acme Legal']);
  await sql('INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1,$2,$3)', [TENANT, 'pat', 'owner@example.org']);
  await sql(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'Anna'), ($3,$2,'Bob')`, [ANNA, TENANT, BOB]);
}, 120_000);

let cirrux: FakeCirrux;

beforeEach(async () => {
  process.env.API_URL = 'https://app.example.test';
  process.env.WEB_URL = 'https://app.example.test';
  process.env.CIRRUX_OAUTH_CLIENT_ID = 'the-deployment-client';
  process.env.MAX_MIGRATIONS_PER_ORGANISATION = '50';
  cirrux = new FakeCirrux({ refreshToken: 'none-yet' });
  cirrux.liveRefresh = undefined;
  vi.stubGlobal('fetch', cirrux.fetch);

  await sql('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM person_link WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM connection WHERE tenant_id = $1', [TENANT]);
  for (const [id, role, kind, config, secret] of [
    // The owner's own source, with the owner's password: no card.
    [ICLOUD, 'source', 'imap', { host: 'imap.old.example', port: 993 }, sealed({ username: 'anna@old.example', password: 'placeholder-owner' })],
    // Anna's Cirrux account, saved for her by its servers and address, no app password.
    [ANNAS_CIRRUX, 'target', 'cirrux', { host: 'dav.cirrux.co', port: 443, mailHost: 'imap.cirrux.co', user: 'anna@cirrux.example' }, sealed({ username: 'anna@cirrux.example' })],
    // The owner's own Cirrux account, its Drive connected before in another workspace.
    [OWNERS_CIRRUX, 'target', 'cirrux', { host: 'dav.cirrux.co', port: 443 }, sealed({ username: 'pat@cirrux.example', password: 'placeholder-owner', [CIRRUX_DRIVE_WORKSPACE_KEY]: ANOTHER_WORKSPACE })],
  ] as const) {
    await sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,$3,$4,'c',$5::jsonb,'connected',$6)`,
      [id, TENANT, role, kind, JSON.stringify(config), secret],
    );
    await sql(`INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`, [
      box(id),
      TENANT,
      id,
    ]);
  }
  for (const m of [ANNAS_MIGRATION, NOBODYS_MIGRATION]) {
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, target_folder_prefix)
       VALUES ($1,$2,$3,$4,'paused',$5)`,
      [m, TENANT, box(ICLOUD), box(ANNAS_CIRRUX), m === ANNAS_MIGRATION ? null : 'Nobody'],
    );
    for (const d of ['email', 'file']) {
      await sql('INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)', [TENANT, m, d]);
    }
  }
  await sql('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [ANNAS_MIGRATION, ANNA, TENANT]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CIRRUX_OAUTH_CLIENT_ID;
  delete process.env.MAX_MIGRATIONS_PER_ORGANISATION;
});

describe('the Drive card', () => {
  it('appears only after the account’s app password is stored', async () => {
    const token = await mint();
    const before = await cardsOf(token);
    expect(before.filter((c) => c.role === 'target').map((c) => [c.way, c.provider])).toEqual([['password', 'cirrux']]);
    expect(driveCard(before)).toBeUndefined();
    // Its button is no door before then either.
    const early = await request(app).post(`/api/grant/${encodeURIComponent(token)}/cirrux/authorize`).send({ ref: 'any' });
    expect(early.status).toBe(409);

    await storeAppPassword();
    const after = await cardsOf(token);
    expect(driveCard(after)).toMatchObject({ account: 'anna@cirrux.example', granted: false });
  });
});

describe('the link’s spend after her app password (0174 §4.4, §5.3 step 7)', () => {
  // T3's store spends the link once every card is connected, read AFTER its
  // write: the Drive card exists only once the app password is stored, so a
  // spend read before the write would close the link with the Drive unasked.
  it('keeps the link live after the password, with the Drive card beside it; the Drive’s ending spends it', async () => {
    const { id, token } = await mintLink();
    const password = (await cardsOf(token)).find((c) => c.role === 'target' && c.way === 'password')!;
    expect(password).toMatchObject({ provider: 'cirrux', granted: false });

    const stored = await storePersonPassword(driver, { linkId: id, tenantId: TENANT, personId: ANNA, ref: password.ref }, { password: ANNAS_APP_PASSWORD });
    expect(stored).toMatchObject({ ok: true, linkSpent: false });
    const [live] = await rows<{ used_at: unknown }>('SELECT used_at FROM person_link WHERE id = $1', [id]);
    expect(live!.used_at).toBeNull();

    const cards = await cardsOf(token);
    expect(cards.find((c) => c.ref === password.ref)).toMatchObject({ granted: true });
    const drive = driveCard(cards)!;
    expect(drive).toMatchObject({ account: 'anna@cirrux.example', granted: false });

    const { ended } = await connectDrive(cirrux, token, drive.ref);
    expect(ended.status, ended.text).toBe(200);
    const [spent] = await rows<{ used_at: unknown }>('SELECT used_at FROM person_link WHERE id = $1', [id]);
    expect(spent!.used_at).not.toBeNull();
  });
});

describe('the ending', () => {
  it('stores the Drive on her account with its workspace, records her as the one who connected it, and reads connected', async () => {
    await storeAppPassword();
    const token = await mint();
    const card = driveCard(await cardsOf(token))!;
    const { url, ended } = await connectDrive(cirrux, token, card.ref);
    // Cirrux's own consent page, the one host the grant page follows for Cirrux.
    expect(url.host).toBe(CONSENT_HOSTS.cirrux);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(ended.status, ended.text).toBe(200);
    expect(ended.text).not.toContain(cirrux.liveRefresh!);

    const creds = await storedCreds(ANNAS_CIRRUX);
    expect(creds[CIRRUX_DRIVE_GRANT_KEY]).toBe(cirrux.liveRefresh);
    expect(creds[CIRRUX_DRIVE_WORKSPACE_KEY]).toBe(cirrux.workspaceUuid);
    expect(creds.password).toBe(ANNAS_APP_PASSWORD);

    const held = await rows<{ person_id: string }>('SELECT person_id FROM person_granted_connection WHERE connection_id = $1', [ANNAS_CIRRUX]);
    expect(held).toEqual([{ person_id: ANNA }]);
    const granted = await rows<{ detail: Record<string, unknown> }>(
      `SELECT detail FROM audit_log WHERE tenant_id = $1 AND action = 'mapping.granted'`,
      [TENANT],
    );
    expect(granted.map((r) => r.detail)).toEqual([
      expect.objectContaining({ mappingId: ANNAS_MIGRATION, role: 'target', via: 'sign-in', ref: card.ref }),
    ]);
    expect(JSON.stringify(granted)).not.toContain(cirrux.liveRefresh!);

    // Both of her cards are connected now, so the link is spent, as a source's is.
    const [link] = await rows<{ used_at: unknown }>('SELECT used_at FROM person_link WHERE tenant_id = $1', [TENANT]);
    expect(link!.used_at).not.toBeNull();
    // And a new link shows the Drive card connected.
    expect(driveCard(await cardsOf(await mint()))).toMatchObject({ granted: true });
  });

  it('is refused when the sign-in reached another workspace than the one recorded: nothing stored, the link still live', async () => {
    await storeAppPassword();
    await sql('UPDATE connection SET secret_ref = $2 WHERE id = $1', [
      ANNAS_CIRRUX,
      sealed({ ...(await storedCreds(ANNAS_CIRRUX)), [CIRRUX_DRIVE_WORKSPACE_KEY]: ANOTHER_WORKSPACE }),
    ]);
    const token = await mint();
    const card = driveCard(await cardsOf(token))!;
    const { ended } = await connectDrive(cirrux, token, card.ref);
    expect(ended.status).toBe(403);
    // In the language the page was in.
    expect(ended.text).toContain('andere Cirrux-werkruimte');

    const creds = await storedCreds(ANNAS_CIRRUX);
    expect(creds[CIRRUX_DRIVE_GRANT_KEY]).toBeUndefined();
    expect(creds[CIRRUX_DRIVE_WORKSPACE_KEY]).toBe(ANOTHER_WORKSPACE);
    expect(await rows('SELECT 1 FROM person_granted_connection WHERE connection_id = $1', [ANNAS_CIRRUX])).toEqual([]);
    const [link] = await rows<{ used_at: unknown }>('SELECT used_at FROM person_link WHERE tenant_id = $1', [TENANT]);
    expect(link!.used_at).toBeNull();
    const refused = await rows<{ detail: Record<string, unknown> }>(
      `SELECT detail FROM audit_log WHERE tenant_id = $1 AND action = 'mapping.grant_refused'`,
      [TENANT],
    );
    expect(refused.map((r) => r.detail)).toEqual([
      expect.objectContaining({ mappingId: ANNAS_MIGRATION, refused: 'another_workspace', role: 'target' }),
    ]);
    expect(JSON.stringify(refused)).not.toContain(cirrux.workspaceUuid);
    expect(JSON.stringify(refused)).not.toContain('Test Workspace');
  });

  it('holds the owner’s own Connect Cirrux Drive to the recorded workspace too', async () => {
    const begun = await request(app).post('/api/migrations/cirrux/authorize').send({ connectionId: OWNERS_CIRRUX });
    expect(begun.status).toBe(200);
    const url = new URL(begun.body.url);
    const code = cirrux.issueCode({
      challenge: url.searchParams.get('code_challenge')!,
      redirectUri: url.searchParams.get('redirect_uri')!,
    });
    const ended = await request(app).get(
      `/api/migrations/cirrux/callback?${new URLSearchParams({ state: url.searchParams.get('state')!, code })}`,
    );
    expect(ended.status).toBe(409);
    expect((await storedCreds(OWNERS_CIRRUX))[CIRRUX_DRIVE_GRANT_KEY]).toBeUndefined();
  });
});

describe('an account a person connected themselves', () => {
  /** Anna connects her Drive through her link, as above. */
  const annaConnects = async () => {
    await storeAppPassword();
    const token = await mint();
    const { ended } = await connectDrive(cirrux, token, driveCard(await cardsOf(token))!.ref);
    expect(ended.status, ended.text).toBe(200);
  };

  it('takes no other person’s migration, at the door that gives one to a person; hers goes in', async () => {
    await annaConnects();
    const bobs = await request(app).post(`/api/people/${BOB}/migrations`).send({ mappingId: NOBODYS_MIGRATION });
    expect(bobs.status).toBe(409);
    expect(bobs.body).toMatchObject({
      error: 'granted_by_another_person',
      message: 'This account was connected by Anna. It can only receive their migrations.',
      messageNl: 'Dit account is verbonden door Anna. Het ontvangt alleen migraties van Anna.',
    });
    expect(await rows('SELECT 1 FROM person_migration WHERE mapping_id = $1', [NOBODYS_MIGRATION])).toEqual([]);
    const hers = await request(app).post(`/api/people/${ANNA}/migrations`).send({ mappingId: NOBODYS_MIGRATION });
    expect(hers.status, JSON.stringify(hers.body)).toBe(201);
  });

  it('takes no migration of nobody’s at the edit door', async () => {
    await annaConnects();
    const res = await request(app).put(`/api/migrations/${NOBODYS_MIGRATION}`).send({ name: 'Renamed' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('granted_by_another_person');
    const ok = await request(app).put(`/api/migrations/${ANNAS_MIGRATION}`).send({ name: 'Anna’s, renamed' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('is refused at the create door unless the body names her, and is hers once made for her', async () => {
    await annaConnects();
    const body = (forPerson?: string) => ({
      name: `Anna’s mail ${forPerson ?? 'nobody'}`,
      sourceType: 'imap',
      sourceConnectionId: ICLOUD,
      sourceConfig: { username: 'anna@old.example' },
      targetType: 'cirrux',
      targetConnectionId: ANNAS_CIRRUX,
      targetConfig: { username: 'anna@cirrux.example', password: '' },
      syncConfig: { domains: ['email'] },
      ...(forPerson === undefined ? {} : { forPerson }),
    });
    const nobodys = await request(app).post('/api/migrations').send(body());
    expect(nobodys.status, JSON.stringify(nobodys.body)).toBe(409);
    expect(nobodys.body.error).toBe('granted_by_another_person');
    const bobs = await request(app).post('/api/migrations').send(body(BOB));
    expect(bobs.body.error).toBe('granted_by_another_person');
    const hers = await request(app).post('/api/migrations').send(body(ANNA));
    expect(hers.status, JSON.stringify(hers.body)).toBe(201);
    // One field, read by the guard and by the save (0174 §8.2): the door
    // gives the migration to the person it was made for, in its transaction.
    expect(await rows('SELECT person_id FROM person_migration WHERE mapping_id = $1', [hers.body.id])).toEqual([{ person_id: ANNA }]);
    // The name T5 first gave it is not read: it names nobody, so the guard refuses.
    const old = await request(app).post('/api/migrations').send({ ...body(), name: 'Anna’s mail, by the old name', personId: ANNA });
    expect(old.body.error).toBe('granted_by_another_person');
  });

  it('refuses a migration made for nobody of this organisation, and stores nothing', async () => {
    const before = await rows('SELECT id FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]);
    const res = await request(app)
      .post('/api/migrations')
      .send({
        name: 'For a stranger',
        sourceType: 'imap',
        sourceConnectionId: ICLOUD,
        sourceConfig: { username: 'anna@old.example' },
        targetType: 'cirrux',
        targetConnectionId: OWNERS_CIRRUX,
        targetConfig: { username: 'pat@cirrux.example', password: '' },
        syncConfig: { domains: ['email'] },
        forPerson: '00000000-0000-4000-8000-00000000dead',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('person_not_found');
    expect(await rows('SELECT id FROM mailbox_mapping WHERE tenant_id = $1', [TENANT])).toEqual(before);
  });

  it('refuses the owner a new app password on it, and the owner’s own Drive sign-in (D6)', async () => {
    await annaConnects();
    // The Accounts page reads who connected it, so it offers no new password
    // the door below refuses (0174 D6); the owner's own account names nobody.
    const listed = await request(app).get('/api/connections');
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const byId = new Map((listed.body.connections as Array<{ id: string; connectedBy?: unknown }>).map((c) => [c.id, c]));
    expect(byId.get(ANNAS_CIRRUX)?.connectedBy).toEqual({ personId: ANNA, name: 'Anna' });
    expect(byId.get(OWNERS_CIRRUX)?.connectedBy).toBeUndefined();
    const before = await storedCreds(ANNAS_CIRRUX);
    const rotated = await request(app)
      .put(`/api/connections/${ANNAS_CIRRUX}/credentials`)
      .send({ values: { host: 'dav.cirrux.co', port: '443', username: 'anna@cirrux.example', password: 'placeholder-owner-knows' } });
    expect(rotated.status).toBe(409);
    expect(rotated.body).toMatchObject({
      error: 'connected_by_the_person',
      reason: 'Anna connected this account themselves. Make them a new grant link to change it.',
      reasonNl: 'Anna heeft dit account zelf verbonden. Maak een nieuwe toegangslink voor Anna om het te wijzigen.',
    });
    expect(await storedCreds(ANNAS_CIRRUX)).toEqual(before);
    const drive = await request(app).post('/api/migrations/cirrux/authorize').send({ connectionId: ANNAS_CIRRUX });
    expect(drive.status).toBe(409);
    expect(drive.body.error).toBe('connected_by_the_person');
  });
});
