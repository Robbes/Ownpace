// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ACCEPTANCE WITH ITS VERSION (workplan 0139 T3), served against Postgres as
 * `app_user`.
 *
 * Terms §1, the Alpha conditions §2 and privacy §4.4 say: when you create your
 * account, the app shows you these texts, each with its version number, asks
 * you to accept them, and records which version of each you accepted, and
 * when. The owner, 2026-09-28: *"accepting fits in there and should record
 * what time/version the accepted of what document."*
 *
 * With the deployment's switch on (`OWNPACE_STAGE=alpha`, 0131 T1's):
 *
 *  - `GET /api/me` says acceptance is due, naming each text and its version;
 *  - creating a connection or a migration answers 409 `conditions_not_accepted`
 *    and stores nothing;
 *  - accepting an old version answers 409 `version_not_current` and writes
 *    nothing, so a stale tab cannot accept a text nobody shows any more;
 *  - accepting the current versions writes one row per text, with the
 *    version, the language and the time, and a second press writes none;
 *  - then nothing is due, and the same two creates go through.
 *
 * With the switch off, nothing changes: no acceptance is reported, and the
 * creates go through without one.
 *
 * Every write here goes through the served path, so the table's grants and
 * policies are the real ones.
 */

process.env.JWT_SECRET = 'test-secret-for-acceptance-tests';
process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { LEGAL_VERSIONS } from '@openmig/managed';

vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({ tasks: { trigger: vi.fn(async () => ({ id: 'run_mock' })) } }),
  };
});
// Nothing here connects anywhere: the creates' probes answer at once.
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return {
    ...actual,
    probeSourceConnection: vi.fn(async () => ({ ok: true })),
    probeTargetConnection: vi.fn(async () => ({ ok: true })),
  };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: vi.fn(async () => undefined) };
});

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

// app_user, not the owner: the grants and policies are what is being proved.
const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = appUserUrl(PG);

const app = (await import('../index.ts')).default;
const { seedMembership } = await import('../__tests__/seed-membership.ts');

// UUID family 0139e7a0-…, unused elsewhere in the repo.
const P = '0139e7a0-e29b-41d4-a716-4466554400';
const ASKED = `${P}01`;
const NOT_ASKED = `${P}02`;
const TESTER = 'acceptance-integration-tester';
const OTHER = 'acceptance-integration-other';

/** The versions the texts carry today (`legal-versions.ts`, held to the texts by its own guard). */
const CURRENT = LEGAL_VERSIONS;

function token(sub: string): string {
  return jwt.sign({ sub, email: `${sub}@integration.test` }, process.env.JWT_SECRET!);
}

let created = 0;
const migrationBody = () => {
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
const connectionBody = () => ({
  role: 'target',
  type: 'nextcloud',
  displayName: `cloud ${++created}`,
  values: { url: 'https://cloud.example.test/remote.php/dav/', username: 'u', password: 'p' },
});

describe('an acceptance with its version', () => {
  let owner: Pool;
  const request = supertest(app);
  const saved: Record<string, string | undefined> = {};
  const ENV = ['OWNPACE_STAGE', 'MAX_MIGRATIONS_PER_ORGANISATION', 'API_URL', 'WEB_URL'] as const;

  const count = async (text: string, params: unknown[]): Promise<number> =>
    Number((await owner.query<{ n: string }>(text, params)).rows[0]!.n);
  const acceptances = (tenant: string, subject: string) =>
    owner.query<{ document: string; version: string; language: string; accepted_at: Date }>(
      `SELECT document, version, language, accepted_at FROM legal_acceptance
        WHERE tenant_id = $1 AND subject = $2 ORDER BY document`,
      [tenant, subject],
    );

  beforeAll(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.MAX_MIGRATIONS_PER_ORGANISATION = '50';
    process.env.API_URL = 'https://api.example';
    process.env.WEB_URL = 'https://app.example';
    owner = new Pool({ connectionString: PG });
    await owner.query(
      `INSERT INTO tenant (id, name, status, settings)
       VALUES ($1, 'Asked thuis', 'active', '{}'), ($2, 'Not asked thuis', 'active', '{}')
       ON CONFLICT (id) DO NOTHING`,
      [ASKED, NOT_ASKED],
    );
    await seedMembership(owner, ASKED, TESTER, 'owner');
    await seedMembership(owner, NOT_ASKED, OTHER, 'owner');
  });

  afterAll(async () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await owner.query(`DELETE FROM tenant WHERE id = ANY($1::uuid[])`, [[ASKED, NOT_ASKED]]);
    await owner.end();
  });

  describe('with the switch on', () => {
    const as = (method: 'get' | 'post', path: string) =>
      request[method](path).set('Authorization', `Bearer ${token(TESTER)}`);

    beforeAll(() => {
      process.env.OWNPACE_STAGE = 'alpha';
    });

    it('GET /api/me says acceptance is due, naming each text and its current version', async () => {
      const res = await as('get', '/api/me');

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.tenantId).toBe(ASKED);
      expect(res.body.acceptance).toEqual({
        due: true,
        documents: [
          { document: 'alpha', version: CURRENT.alpha, accepted: false },
          { document: 'privacy', version: CURRENT.privacy, accepted: false },
          { document: 'terms', version: CURRENT.terms, accepted: false },
        ],
      });
    });

    it('creating a connection answers 409 conditions_not_accepted, and stores nothing', async () => {
      const before = await count('SELECT count(*) AS n FROM connection WHERE tenant_id = $1', [ASKED]);
      const res = await as('post', '/api/connections').send(connectionBody());

      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('conditions_not_accepted');
      expect(await count('SELECT count(*) AS n FROM connection WHERE tenant_id = $1', [ASKED])).toBe(before);
    });

    it('creating a migration answers 409 conditions_not_accepted, and stores nothing', async () => {
      const res = await as('post', '/api/migrations').send(migrationBody());

      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('conditions_not_accepted');
      expect(await count('SELECT count(*) AS n FROM mailbox_mapping WHERE tenant_id = $1', [ASKED])).toBe(0);
      expect(await count('SELECT count(*) AS n FROM connection WHERE tenant_id = $1', [ASKED])).toBe(0);
    });

    it('an old version answers 409 version_not_current, and writes nothing', async () => {
      const res = await as('post', '/api/me/acceptance').send({
        versions: { ...CURRENT, privacy: '1.1' },
        language: 'nl',
      });

      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('version_not_current');
      expect(res.body.stale).toEqual(['privacy']);
      expect(res.body.current).toEqual(CURRENT);
      expect((await acceptances(ASKED, TESTER)).rows).toEqual([]);
    });

    it('a body that does not name every text, or names a language the texts are not in, is refused', async () => {
      const missing = await as('post', '/api/me/acceptance').send({
        versions: { alpha: CURRENT.alpha, terms: CURRENT.terms },
        language: 'nl',
      });
      const german = await as('post', '/api/me/acceptance').send({ versions: CURRENT, language: 'de' });

      expect(missing.status).toBe(400);
      expect(german.status).toBe(400);
      expect((await acceptances(ASKED, TESTER)).rows).toEqual([]);
    });

    it('accepting the current versions writes one row per text, with its version, language and time', async () => {
      const before = Date.now();
      const res = await as('post', '/api/me/acceptance').send({ versions: CURRENT, language: 'nl' });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.written).toBe(3);
      expect(res.body.acceptance.due).toBe(false);
      const { rows } = await acceptances(ASKED, TESTER);
      expect(rows.map((r) => [r.document, r.version, r.language])).toEqual([
        ['alpha', CURRENT.alpha, 'nl'],
        ['privacy', CURRENT.privacy, 'nl'],
        ['terms', CURRENT.terms, 'nl'],
      ]);
      for (const r of rows) expect(r.accepted_at.getTime()).toBeGreaterThanOrEqual(before - 60_000);
    });

    it('accepting again writes nothing, and keeps the first time', async () => {
      const first = (await acceptances(ASKED, TESTER)).rows;
      const res = await as('post', '/api/me/acceptance').send({ versions: CURRENT, language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.written).toBe(0);
      expect((await acceptances(ASKED, TESTER)).rows).toEqual(first);
    });

    it('GET /api/me then says nothing is due', async () => {
      const res = await as('get', '/api/me');

      expect(res.body.acceptance.due).toBe(false);
      expect(res.body.acceptance.documents.every((d: { accepted: boolean }) => d.accepted)).toBe(true);
    });

    it('and the same two creates go through', async () => {
      const connection = await as('post', '/api/connections').send(connectionBody());
      const migration = await as('post', '/api/migrations').send(migrationBody());

      expect(connection.status, JSON.stringify(connection.body)).toBe(201);
      expect(migration.status, JSON.stringify(migration.body)).toBe(201);
    });
  });

  describe('with the switch off', () => {
    const as = (method: 'get' | 'post', path: string) =>
      request[method](path).set('Authorization', `Bearer ${token(OTHER)}`);

    beforeAll(() => {
      delete process.env.OWNPACE_STAGE;
    });

    it('GET /api/me reports no acceptance at all', async () => {
      const res = await as('get', '/api/me');

      expect(res.status).toBe(200);
      expect(res.body.tenantId).toBe(NOT_ASKED);
      expect(res.body).not.toHaveProperty('acceptance');
    });

    it('creating a connection and a migration go through without one', async () => {
      const connection = await as('post', '/api/connections').send(connectionBody());
      const migration = await as('post', '/api/migrations').send(migrationBody());

      expect(connection.status, JSON.stringify(connection.body)).toBe(201);
      expect(migration.status, JSON.stringify(migration.body)).toBe(201);
      expect((await acceptances(NOT_ASKED, OTHER)).rows).toEqual([]);
    });
  });
});
