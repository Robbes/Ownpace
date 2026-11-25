// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD SENT ONLY TO ITS PROVIDER'S SERVER (workplan 0174 §5.8, D3 (a),
 * §14 question 2).
 *
 * A grant link is shaped exactly like phishing, and the host the owner typed
 * is the new risk: an owner who names a server they run would receive the
 * person's password at the test's login. So:
 *
 *  - a kind whose provider publishes its server (Cirrux and Infomaniak, read
 *    from their help pages on 2026-11-25, beside Apple) is tested only
 *    against that server, whatever the row says; the page names it as the
 *    provider's own; and the row is written to say the same, so the pass
 *    goes where the test went;
 *  - Soverin, whose help pages could not be read from the builder's
 *    checkout, stays generic: its host is the owner's, shown for the person
 *    to judge;
 *  - a generic kind's host that resolves inside a private network is refused
 *    before anything is tried or counted (`server_not_public`), by the
 *    probe's own rule.
 *
 * The servers are recorded, as in `a-password-typed-on-a-link`. PGlite as
 * `app_user`, both chains.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.GRANT_PASSWORD_TESTS_PER_HOUR = '1000';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { refuseInternalAddresses } from '@openmig/shared/reachable-host';
import type { ProbeResult } from '@openmig/orchestration/probe-connection';
import { annasRows, mintFor, query, resetAnna, setUpAnna } from '../__tests__/password-link-fixture.ts';

const R = annasRows('01740021');

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

/** Every login the recorded servers saw, with the config it was made on. */
const logins: Array<{ role: string; kind: string; config: Record<string, unknown> }> = [];
const CONNECTED: ProbeResult = { ok: true, detail: 'Connected.', outcome: { code: 'connected', count: 1, unit: 'calendar' } };

vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return {
    ...actual,
    probeSourceConnection: async (kind: string, config: Record<string, unknown>) => {
      logins.push({ role: 'source', kind, config });
      return CONNECTED;
    },
    probeTargetConnection: async (kind: string, config: Record<string, unknown>) => {
      logins.push({ role: 'target', kind, config });
      return CONNECTED;
    },
  };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: async () => undefined };
});
vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  return { ...actual, verifyMX: async () => ({ resolverResults: {} }) };
});

const { default: grantRoutes } = await import('./grant.ts');
const { accountRef } = await import('./migrations/person-grant-subject.ts');

const app = express();
app.use(express.json());
app.use('/api/grant', grantRoutes);

const q = (sql: string, params: unknown[] = []) => query(driver, sql, params);

/** The destination as the owner saved it for Anna: this kind, and servers the owner runs. */
const OWNERS_SERVERS = {
  host: 'dav.owner.example',
  port: 8443,
  url: 'https://dav.owner.example/remote/',
  mailHost: 'imap.owner.example',
  mailPort: 1993,
  useSsl: false,
  user: 'anna@soverin.net',
};

async function destinationIs(kind: string, config: Record<string, unknown>): Promise<string> {
  await q('UPDATE connection SET kind = $2, config = $3::jsonb WHERE id = $1', [R.soverin, kind, JSON.stringify(config)]);
  return accountRef('target', kind, R.soverin, 'anna@soverin.net');
}

/** The card's person fields, each filled with a placeholder. */
async function filled(token: string, ref: string): Promise<Record<string, string>> {
  const got = await request(app).get(`/api/grant/${token}`);
  const card = (got.body.accounts as Array<Record<string, unknown>>).find((a) => a.ref === ref);
  expect(card, 'the destination is a card').toBeDefined();
  const fields = (card!.fields as Array<{ key: string; who: string }>).filter((f) => f.who === 'person');
  return Object.fromEntries(fields.map((f) => [f.key, `placeholder-${f.key}`]));
}

async function serverOn(token: string, ref: string): Promise<Record<string, unknown>> {
  const got = await request(app).get(`/api/grant/${token}`);
  const card = (got.body.accounts as Array<Record<string, unknown>>).find((a) => a.ref === ref);
  return card!.server as Record<string, unknown>;
}

beforeAll(async () => {
  process.env.WEB_URL = 'https://app.example';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await setUpAnna(driver, R);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  await resetAnna(driver, R);
  logins.length = 0;
});

describe('a kind whose provider publishes its server is tried only there (§5.8, D3 (a))', () => {
  for (const [kind, provider, dav, mail] of [
    ['cirrux', 'Cirrux', 'api.cirrux.co', 'imap.cirrux.co'],
    ['infomaniak', 'Infomaniak', 'sync.infomaniak.com', 'mail.infomaniak.com'],
  ] as const) {
    it(`${provider}: the owner's host is ignored, the test goes to ${dav}, and the row says so after`, async () => {
      const ref = await destinationIs(kind, OWNERS_SERVERS);
      const { token } = await mintFor(driver, R);

      // The page names the provider's own server, and none of the owner's.
      const server = await serverOn(token, ref);
      expect(server.published).toBe(true);
      expect(server.hosts).toEqual([mail, dav]);
      expect(JSON.stringify(server)).not.toContain('owner.example');

      const res = await request(app).put(`/api/grant/${token}/password`).send({ ref, values: await filled(token, ref) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      // The test: the published server, every face, and nothing the owner typed.
      expect(logins).toHaveLength(1);
      const tried = logins[0]!.config;
      expect(tried).toMatchObject({ host: dav, port: 443, mailHost: mail, mailPort: 993 });
      expect(tried).not.toHaveProperty('url');
      expect(tried).not.toHaveProperty('useSsl');
      expect(JSON.stringify(tried)).not.toContain('owner.example');

      // The row, pinned in the same transaction: the pass goes where the test went.
      const [row] = await q('SELECT config FROM connection WHERE id = $1', [R.soverin]);
      const stored = row!.config as Record<string, unknown>;
      expect(stored).toMatchObject({ host: dav, port: 443, mailHost: mail, mailPort: 993, user: 'anna@soverin.net' });
      expect(JSON.stringify(stored)).not.toContain('owner.example');
      expect(stored).not.toHaveProperty('useSsl');
    });
  }

  it('a DAV address on the published host, with its path, is kept', async () => {
    const url = 'https://sync.infomaniak.com/calendars/AB12345/';
    const ref = await destinationIs('infomaniak', { ...OWNERS_SERVERS, url });
    const { token } = await mintFor(driver, R);
    const res = await request(app).put(`/api/grant/${token}/password`).send({ ref, values: await filled(token, ref) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(logins[0]!.config.url).toBe(url);
  });

  it('a migration’s own override is narrowed to the published server too', async () => {
    const ref = await destinationIs('cirrux', { host: 'api.cirrux.co', mailHost: 'imap.cirrux.co', user: 'anna@soverin.net' });
    await q(`UPDATE mailbox_mapping SET target_config_override = $2::jsonb WHERE id = $1`, [
      R.icloudToSoverin,
      JSON.stringify({ host: 'dav.owner.example', mailHost: 'imap.owner.example' }),
    ]);
    try {
      const { token } = await mintFor(driver, R);
      const res = await request(app).put(`/api/grant/${token}/password`).send({ ref, values: await filled(token, ref) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(JSON.stringify(logins[0]!.config)).not.toContain('owner.example');
      const [m] = await q('SELECT target_config_override FROM mailbox_mapping WHERE id = $1', [R.icloudToSoverin]);
      expect(JSON.stringify(m!.target_config_override)).not.toContain('owner.example');
    } finally {
      await q('UPDATE mailbox_mapping SET target_config_override = NULL WHERE id = $1', [R.icloudToSoverin]);
    }
  });
});

describe('Soverin stays generic: its help pages could not be read (§14 question 2)', () => {
  it('is tried against the owner’s host, which the page shows for the person to judge', async () => {
    const config = { host: 'dav.owner.example', port: 443, mailHost: 'imap.owner.example', user: 'anna@soverin.net' };
    const ref = await destinationIs('soverin', config);
    const { token } = await mintFor(driver, R);
    const server = await serverOn(token, ref);
    expect(server.published).toBe(false);
    expect(server.hosts).toEqual(['dav.owner.example', 'imap.owner.example']);
    const res = await request(app).put(`/api/grant/${token}/password`).send({ ref, values: await filled(token, ref) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(logins[0]!.config).toMatchObject({ host: 'dav.owner.example', mailHost: 'imap.owner.example' });
  });
});

describe('a host inside a private network is refused, nothing tried, nothing counted (§5.8)', () => {
  it('answers 409 server_not_public with the sentence in both languages', async () => {
    const ref = await destinationIs('soverin', {
      host: 'dav.inside.example',
      port: 443,
      mailHost: 'imap.soverin.net',
      user: 'anna@soverin.net',
    });
    const { token, id } = await mintFor(driver, R);
    const values = await filled(token, ref);
    // The probe's own rule, switched on as a managed process switches it on,
    // with a resolver that puts the owner's host on the loopback.
    const off = refuseInternalAddresses({
      resolve: async (name) =>
        name === 'dav.inside.example' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '203.0.113.7', family: 4 }],
    });
    try {
      const res = await request(app).put(`/api/grant/${token}/password`).send({ ref, values });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('server_not_public');
      expect(res.body.reason).toContain('private network');
      expect(res.body.reasonNl).toContain('afgeschermd netwerk');
      expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
    } finally {
      off();
    }
    expect(logins).toHaveLength(0);
    const tries = await q('SELECT refused FROM person_link_try WHERE link_id = $1', [id]);
    expect(tries.every((t) => Number(t.refused) === 0)).toBe(true);
    const [c] = await q('SELECT secret_ref FROM connection WHERE id = $1', [R.soverin]);
    expect(c!.secret_ref).toBeNull();
  });

  it('a host that resolves outward is tried as before', async () => {
    const ref = await destinationIs('soverin', { host: 'dav.public.example', port: 443, mailHost: 'imap.soverin.net', user: 'anna@soverin.net' });
    const { token } = await mintFor(driver, R);
    const values = await filled(token, ref);
    const off = refuseInternalAddresses({ resolve: async () => [{ address: '203.0.113.7', family: 4 }] });
    try {
      const res = await request(app).put(`/api/grant/${token}/password`).send({ ref, values });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    } finally {
      off();
    }
    expect(logins).toHaveLength(1);
  });
});
