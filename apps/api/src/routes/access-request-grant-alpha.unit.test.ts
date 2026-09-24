// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE GRANT ROUTE SAYS ALPHA WHEN THE DEPLOYMENT DOES (workplan 0131 T1).
 *
 * The alpha paragraph in the access-granted mail has three pieces: the setting
 * (`OWNPACE_STAGE`), the event that carries the mark (`accessGrantedEvent` in
 * `access-notify.ts`), and the words (`renderEvent` in @openmig/shared). Each
 * has its own test. What none of them held was the ONE CALL that joins them:
 * the grant route building its mail through `accessGrantedEvent`. Put the old
 * inline `{ kind: 'access_granted', … }` literal back in the route and every
 * other test stays green, while on the tester stack the pages say alpha and the
 * mail a tester reads first does not. That is the split
 * `scripts/an-alpha-both-halves-know-about.unit.test.ts` exists to prevent,
 * one step further in.
 *
 * So this drives the real route, end to end, and reads what the transport is
 * handed: grant a request with the setting on and the mail carries the
 * paragraph, in the language the request was made in; grant one without it and
 * the mail says nothing about an alpha.
 *
 * AGAINST PGLITE, like `access-request-duplicates.unit.test.ts`, whose
 * connection shim this copies: the integration suites run without SMTP and can
 * only ever see `notified: 'off'`. The transport is replaced (as in
 * `access-notify.unit.test.ts`) and nothing else is: `tell`,
 * `accessGrantedEvent` and `renderEvent` are the real ones.
 *
 * UUID family: none. Tenants are created by the route itself.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const OPERATOR = 'operator-subject-0131';

let driver: LedgerDriver;
let caller: string | undefined;

/** Every message the transport was handed, to whom. */
const SENT: Array<{ to: readonly string[]; subject: string; body: string }> = [];
vi.mock('@openmig/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/connectors')>();
  return {
    ...actual,
    smtpTransport: () => async (message: { to: readonly string[]; subject: string; body: string }) => {
      SENT.push(message);
    },
  };
});

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticateSubject: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (caller === undefined) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, { userId: caller });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: accessRoutes } = await import('./access-requests.ts');
const { __setChannelForTests } = await import('../access-notify.ts');

const app = express();
app.use(express.json());
app.use('/api/access-requests', accessRoutes);

/** 0131 T1's first sentence, in each language: enough to know the paragraph is there. */
const LEAD = {
  en: 'Alpha: a small invited group is trying this service out.',
  nl: 'Alfa: een kleine, uitgenodigde groep probeert deze dienst uit.',
} as const;

async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** Knock as `email` in `locale`, grant it as the operator, and return the grant's answer and the mail. */
async function knockAndGrant(email: string, locale: 'en' | 'nl') {
  caller = undefined;
  expect(
    (await request(app).post('/api/access-requests').send({ email, locale, organisation: 'De Vries' }))
      .status,
  ).toBe(201);
  const [row] = await rows("SELECT id FROM access_request WHERE state = 'open' AND email = $1", [
    email,
  ]);
  SENT.length = 0;
  caller = OPERATOR;
  const res = await request(app)
    .post(`/api/access-requests/${row!.id as string}/grant`)
    .set('Authorization', 'Bearer x')
    .send({});
  const mail = SENT.filter((m) => m.to.includes(email));
  return { res, mail };
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  // The two calling conventions drizzle's node-postgres adapter uses, onto the
  // driver itself; see access-request-duplicates.unit.test.ts for why.
  (driver as unknown as { query: unknown }).query = async (
    textOrConfig: string | { text: string; values?: unknown[] },
    maybeValues?: unknown[],
  ): Promise<unknown> => {
    const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
    const values =
      maybeValues ?? (typeof textOrConfig === 'string' ? [] : (textOrConfig.values ?? []));
    const conn = await driver.acquire();
    try {
      return await conn.query(text, values);
    } finally {
      await conn.release();
    }
  };
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await rows(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'op@test.invalid')`, [
    OPERATOR,
  ]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  caller = undefined;
  SENT.length = 0;
  await rows('DELETE FROM access_request');
  await rows('DELETE FROM tenant_member');
  await rows('DELETE FROM tenant');
  // A channel that is on, so the route really sends; the transport above keeps it.
  __setChannelForTests({
    notifier: { notify: async () => {} },
    locale: 'en',
    announcement: '',
    config: {
      enabled: true,
      smtp: { host: 'localhost', port: 587, secure: false, user: 'u', pass: 'p' },
      settings: { from: 'ownpace@example.test', to: ['ops@example.test'] },
    },
  } as unknown as Parameters<typeof __setChannelForTests>[0]);
  vi.stubEnv('WEB_URL', 'https://app.example.test');
});

afterEach(() => {
  __setChannelForTests(null);
  vi.unstubAllEnvs();
});

describe('granting access while the deployment runs the alpha', () => {
  beforeEach(() => {
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
  });

  it.each(['en', 'nl'] as const)('sends a mail that says so, in %s', async (locale) => {
    const { res, mail } = await knockAndGrant(`tester-${locale}@example.test`, locale);
    expect(res.status).toBe(201);
    expect(res.body.notified).toBe('sent');
    expect(mail, 'the granted person was sent exactly one mail').toHaveLength(1);
    expect(
      mail[0]!.body,
      'the grant route sent its mail without the alpha mark: it must build the event with\n' +
        'accessGrantedEvent (apps/api/src/access-notify.ts), which reads OWNPACE_STAGE.',
    ).toContain(LEAD[locale]);
  });
});

describe('granting access anywhere else', () => {
  it.each(['en', 'nl'] as const)('sends a mail that says nothing about an alpha, in %s', async (locale) => {
    const { res, mail } = await knockAndGrant(`person-${locale}@example.test`, locale);
    expect(res.status).toBe(201);
    expect(res.body.notified).toBe('sent');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.body).not.toMatch(/\balpha\b|\balfa\b/i);
  });

  it('and a value that is not "alpha" is not the alpha', async () => {
    vi.stubEnv('OWNPACE_STAGE', 'beta');
    const { mail } = await knockAndGrant('beta@example.test', 'en');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.body).not.toMatch(/\balpha\b|\balfa\b/i);
  });
});
