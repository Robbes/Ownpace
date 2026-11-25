// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD TYPED ON A LINK (workplan 0174 §5.3 to §5.7, §7, T3).
 *
 * The owner, 2026-11-25: *"I want all sources/targets that supports granting
 * to be able to use the others-grant-page."* Anna types her own iCloud
 * app-specific password and her own Soverin password on her link; nobody
 * else ever holds them. Each step of `PUT /api/grant/:link/password`:
 *
 *  - the body: JSON only, 4 KiB, exactly the card's fields, nothing echoed;
 *  - five refused logins lock the card on this link, and the sixth is never
 *    tested; two tabs racing at four get one login between them;
 *  - `unreachable` and `face_missing` count nothing (D4);
 *  - a source's password lands on each of its migrations, merged, and a
 *    destination's on the connection with `person_granted_connection`;
 *  - a replay tests nothing; a revoke during the test stores nothing;
 *  - a server named by a number is never tried; a destination another
 *    person granted is refused;
 *  - the link is spent once every card is connected.
 *
 * The servers are recorded: the probe and the qualification are replaced
 * with functions that answer as a server would and count the logins. PGlite
 * as `app_user`, both chains.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.GRANT_PASSWORD_TESTS_PER_HOUR = '1000';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import type { ProbeResult } from '@openmig/orchestration/probe-connection';
import type { AccountQualification } from '@openmig/orchestration/account-qualification';
import { annasRows, mintFor, query, resetAnna, setUpAnna } from '../__tests__/password-link-fixture.ts';

const R = annasRows('01740003');
const ANNAS_ICLOUD = 'placeholder-app-specific-password';
const ANNAS_SOVERIN = 'placeholder-soverin-password';

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

/** What the recorded servers answer, and every login they saw. */
const server = {
  logins: [] as Array<{ role: string; kind: string; config: Record<string, unknown>; creds: Record<string, string> }>,
  answer: (_creds: Record<string, string>): ProbeResult | Promise<ProbeResult> => ({
    ok: true,
    detail: 'Connected.',
    outcome: { code: 'connected', count: 1, unit: 'calendar' },
  }),
  qualification: undefined as AccountQualification | undefined,
};

vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return {
    ...actual,
    probeSourceConnection: async (kind: string, config: Record<string, unknown>, creds: Record<string, string>) => {
      server.logins.push({ role: 'source', kind, config, creds });
      return server.answer(creds);
    },
    probeTargetConnection: async (kind: string, config: Record<string, unknown>, creds: Record<string, string>) => {
      server.logins.push({ role: 'target', kind, config, creds });
      return server.answer(creds);
    },
  };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: async () => server.qualification };
});
// D3's MX lookup is not this file's: no resolver is asked from a unit test.
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
const ICLOUD_REF = accountRef('source', 'apple', R.icloud, 'anna@icloud.com');
const SOVERIN_REF = accountRef('target', 'soverin', R.soverin, 'anna@soverin.net');

const REFUSED: ProbeResult = {
  ok: false,
  reason: 'The IMAP server refused: NO [AUTHENTICATIONFAILED] Invalid credentials',
  outcome: { code: 'providerRefused' },
  refusedLogin: true,
};
const UNREACHABLE: ProbeResult = { ok: false, reason: 'connect ECONNREFUSED', outcome: { code: 'unreachable' } };
const CONNECTED: ProbeResult = { ok: true, detail: 'Connected.', outcome: { code: 'connected', count: 1, unit: 'calendar' } };

const put = (token: string, body: unknown) => request(app).put(`/api/grant/${token}/password`).send(body as object);

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
  server.logins = [];
  server.answer = () => CONNECTED;
  server.qualification = undefined;
});

describe('the body (§5.3 step 2)', () => {
  it('takes JSON only, at most 4 KiB, exactly the card’s fields, and echoes nothing', async () => {
    const { token } = await mintFor(driver, R);
    const form = await request(app)
      .put(`/api/grant/${token}/password`)
      .type('form')
      .send(`ref=${ICLOUD_REF}&password=${ANNAS_ICLOUD}`);
    expect(form.status).toBe(415);

    const big = await put(token, { ref: ICLOUD_REF, values: { password: 'x'.repeat(5000) } });
    expect(big.status).toBe(413);

    for (const body of [
      { ref: ICLOUD_REF, values: { password: ANNAS_ICLOUD }, extra: 1 },
      { ref: ICLOUD_REF, values: { password: ANNAS_ICLOUD, username: 'someone@else.example' } },
      { ref: ICLOUD_REF, values: {} },
      { ref: ICLOUD_REF, values: { password: '' } },
      { ref: ICLOUD_REF, values: { password: 7 } },
      { values: { password: ANNAS_ICLOUD } },
    ]) {
      const res = await put(token, body);
      expect(res.status, JSON.stringify(Object.keys(body))).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(ANNAS_ICLOUD);
    }
    const unknown = await put(token, { ref: 'not-a-card-ref', values: { password: ANNAS_ICLOUD } });
    expect(unknown.status).toBe(409);
    expect(unknown.body.error).toBe('not_this_account');
    // Nothing was tried for any of them.
    expect(server.logins).toHaveLength(0);
  });

  it('answers 404 for a link that is not a person’s grant link', async () => {
    const res = await put('p.not-a-link.at-all', { ref: ICLOUD_REF, values: { password: ANNAS_ICLOUD } });
    expect([401, 404]).toContain(res.status);
    expect(server.logins).toHaveLength(0);
  });
});

describe('five tries, then locked (§5.5; D4, D5)', () => {
  it('counts five refused logins, locks the card, and never tests the sixth', async () => {
    const { token, id } = await mintFor(driver, R);
    server.answer = () => REFUSED;
    for (const left of [4, 3, 2, 1, 0]) {
      const res = await put(token, { ref: ICLOUD_REF, values: { password: 'placeholder-wrong' } });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: 'refused_login', category: 'refused_login', tries: { left, locked: left === 0 } });
    }
    expect(server.logins).toHaveLength(5);

    const sixth = await put(token, { ref: ICLOUD_REF, values: { password: ANNAS_ICLOUD } });
    expect(sixth.status).toBe(423);
    expect(sixth.body).toEqual({ error: 'locked', tries: { left: 0, locked: true } });
    expect(server.logins).toHaveLength(5);

    const [row] = await q('SELECT refused, locked_at FROM person_link_try WHERE link_id = $1', [id]);
    expect(row!.refused).toBe(5);
    expect(row!.locked_at).not.toBeNull();
    // Each refusal, and the lock, in the audit log by category, ref and link.
    const audit = await q(
      `SELECT detail->>'refused' AS refused, detail->>'ref' AS ref FROM audit_log
        WHERE action = 'mapping.grant_refused' AND detail->>'personLinkId' = $1`,
      [id],
    );
    expect(audit.map((a) => a.refused).sort()).toEqual(['locked', ...Array(5).fill('refused_login')].sort());
    expect(audit.every((a) => a.ref === ICLOUD_REF)).toBe(true);

    // Its other card goes on; a new link starts at zero.
    server.answer = () => CONNECTED;
    expect((await put(token, { ref: SOVERIN_REF, values: { password: ANNAS_SOVERIN } })).status).toBe(200);
    const fresh = await mintFor(driver, R);
    expect((await put(fresh.token, { ref: ICLOUD_REF, values: { password: ANNAS_ICLOUD } })).status).toBe(200);
  });

  it('gives two tabs racing at four refusals one login between them', async () => {
    const { token, id } = await mintFor(driver, R);
    await q('INSERT INTO person_link_try (link_id, tenant_id, account_ref, refused) VALUES ($1,$2,$3,4)', [id, R.tenant, ICLOUD_REF]);
    server.answer = () => REFUSED;
    const [a, b] = await Promise.all([
      put(token, { ref: ICLOUD_REF, values: { password: 'placeholder-wrong-a' } }),
      put(token, { ref: ICLOUD_REF, values: { password: 'placeholder-wrong-b' } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([422, 423]);
    expect(server.logins).toHaveLength(1);
  });

  it('counts nothing for an unreachable server or a refused face', async () => {
    const { token, id } = await mintFor(driver, R);
    server.answer = () => UNREACHABLE;
    const down = await put(token, { ref: SOVERIN_REF, values: { password: ANNAS_SOVERIN } });
    expect(down.status).toBe(422);
    expect(down.body).toEqual({ error: 'unreachable', category: 'unreachable', tries: { left: 5, locked: false } });

    // The login works, and the mail face says no: face_missing, no try.
    server.answer = () => CONNECTED;
    const no = { answer: 'no' as const, detail: 'The mail server refused this login.', reason: 'refused' as const };
    const unknown = { answer: 'unknown' as const, detail: 'Not asked.', reason: 'notAskable' as const };
    server.qualification = {
      domains: { mail: no, calendar: { answer: 'yes', detail: '1 calendar.' }, contact: unknown, file: unknown, task: unknown },
    } as AccountQualification;
    const face = await put(token, { ref: SOVERIN_REF, values: { password: ANNAS_SOVERIN } });
    expect(face.status).toBe(422);
    expect(face.body).toEqual({ error: 'face_missing', category: 'face_missing', faces: ['email'], tries: { left: 5, locked: false } });

    const [row] = await q('SELECT refused, locked_at FROM person_link_try WHERE link_id = $1', [id]);
    expect([row!.refused, row!.locked_at]).toEqual([0, null]);
    // And nothing was stored for either.
    const [conn] = await q('SELECT secret_ref FROM connection WHERE id = $1', [R.soverin]);
    expect(conn!.secret_ref).toBeNull();
  });
});

describe('stored only when it works (§5.3 step 7, §4.3)', () => {
  it('puts a source’s password on each of its migrations, merged, and tests the merged account', async () => {
    const { token, id } = await mintFor(driver, R);
    // What a sign-in had left on the migration stays beside it.
    await q('UPDATE mailbox_mapping SET source_secret_ref = $2, grant_withdrawn_at = now() WHERE id = $1', [
      R.icloudToSoverin,
      JSON.stringify(SecretStore.encryptCredentials({ note: 'kept' }).encrypted),
    ]);
    const res = await put(token, { ref: ICLOUD_REF, values: { password: ANNAS_ICLOUD }, locale: 'nl' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, faces: ['email', 'calendar'], linkSpent: false });
    expect(JSON.stringify(res.body)).not.toContain(ANNAS_ICLOUD);

    // The test saw the owner's account and Anna's password, and nothing else of hers.
    expect(server.logins).toHaveLength(1);
    expect(server.logins[0]).toMatchObject({ role: 'source', kind: 'apple', creds: { username: 'anna@icloud.com', password: ANNAS_ICLOUD } });

    const [m] = await q('SELECT source_secret_ref, grant_withdrawn_at FROM mailbox_mapping WHERE id = $1', [R.icloudToSoverin]);
    expect(SecretStore.decryptCredentials(m!.source_secret_ref as string)).toEqual({ note: 'kept', username: 'anna@icloud.com', password: ANNAS_ICLOUD });
    expect(m!.grant_withdrawn_at).toBeNull();
    // The owner's connection holds nothing of Anna's.
    const [c] = await q('SELECT secret_ref FROM connection WHERE id = $1', [R.icloud]);
    expect(c!.secret_ref).toBeNull();

    const granted = await q(
      `SELECT detail->>'mappingId' AS m, detail->>'via' AS via, detail->>'role' AS role FROM audit_log
        WHERE action = 'mapping.granted' AND detail->>'personLinkId' = $1`,
      [id],
    );
    expect(granted).toEqual([{ m: R.icloudToSoverin, via: 'password', role: 'source' }]);
    // A login that worked spends no try.
    const [t] = await q('SELECT refused FROM person_link_try WHERE link_id = $1', [id]);
    expect(t!.refused).toBe(0);
  });

  it('puts a destination’s password on the connection, names Anna, and spends the link once both are connected', async () => {
    const { token, id } = await mintFor(driver, R);
    expect((await put(token, { ref: ICLOUD_REF, values: { password: ANNAS_ICLOUD } })).status).toBe(200);
    const res = await put(token, { ref: SOVERIN_REF, values: { password: ANNAS_SOVERIN } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, linkSpent: true });
    expect(typeof res.body.progressUrl).toBe('string');
    expect(server.logins[1]).toMatchObject({ role: 'target', kind: 'soverin', creds: { username: 'anna@soverin.net', password: ANNAS_SOVERIN } });

    const [c] = await q('SELECT secret_ref FROM connection WHERE id = $1', [R.soverin]);
    expect(SecretStore.decryptCredentials(c!.secret_ref as string)).toEqual({ username: 'anna@soverin.net', password: ANNAS_SOVERIN });
    const [g] = await q('SELECT person_id, link_id FROM person_granted_connection WHERE connection_id = $1', [R.soverin]);
    expect(g).toEqual({ person_id: R.anna, link_id: id });
    const [l] = await q('SELECT used_at FROM person_link WHERE id = $1', [id]);
    expect(l!.used_at).not.toBeNull();

    // Spent: the one sentence, and no login.
    const after = await put(token, { ref: SOVERIN_REF, values: { password: ANNAS_SOVERIN } });
    expect(after.status).toBe(401);
    expect(server.logins).toHaveLength(2);
  });

  it('remembers what the test measured on the connection', async () => {
    const { token } = await mintFor(driver, R);
    const yes = { answer: 'yes' as const, detail: '3 folders.' };
    server.qualification = {
      domains: { mail: yes, calendar: yes, contact: yes, file: yes, task: yes },
    } as AccountQualification;
    expect((await put(token, { ref: SOVERIN_REF, values: { password: ANNAS_SOVERIN } })).status).toBe(200);
    const [c] = await q(`SELECT qualification->'domains'->'mail'->>'answer' AS mail FROM connection WHERE id = $1`, [R.soverin]);
    expect(c!.mail).toBe('yes');
  });
});

describe('replay, revocation and whose account (§7.2, §7.5, D1, D3)', () => {
  it('answers a replay already_connected and tries no login', async () => {
    await q('UPDATE connection SET secret_ref = NULL WHERE id = $1', [R.soverin]);
    const { token } = await mintFor(driver, R);
    expect((await put(token, { ref: ICLOUD_REF, values: { password: ANNAS_ICLOUD } })).status).toBe(200);
    const replay = await put(token, { ref: ICLOUD_REF, values: { password: ANNAS_ICLOUD } });
    expect(replay.status).toBe(409);
    expect(replay.body).toEqual({ error: 'already_connected' });
    expect(server.logins).toHaveLength(1);
  });

  it('stores nothing when the link is revoked while the test runs', async () => {
    const { token, id } = await mintFor(driver, R);
    server.answer = async () => {
      await q('UPDATE person_link SET revoked_at = now() WHERE id = $1', [id]);
      return CONNECTED;
    };
    const res = await put(token, { ref: SOVERIN_REF, values: { password: ANNAS_SOVERIN } });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('link_spent');
    const [c] = await q('SELECT secret_ref FROM connection WHERE id = $1', [R.soverin]);
    expect(c!.secret_ref).toBeNull();
    expect(await q('SELECT 1 FROM person_granted_connection WHERE connection_id = $1', [R.soverin])).toHaveLength(0);
    expect(await q(`SELECT 1 FROM audit_log WHERE action = 'mapping.granted' AND detail->>'personLinkId' = $1`, [id])).toHaveLength(0);
  });

  it('refuses a destination another person connected, and stores nothing', async () => {
    const { token } = await mintFor(driver, R);
    // Bert connected it once; the owner then emptied its password.
    await q('INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ($1,$2,$3)', [R.soverin, R.tenant, R.bert]);
    const res = await put(token, { ref: SOVERIN_REF, values: { password: ANNAS_SOVERIN } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('another_person');
    const [c] = await q('SELECT secret_ref FROM connection WHERE id = $1', [R.soverin]);
    expect(c!.secret_ref).toBeNull();
  });

  it('never sends a password to a server named by a number', async () => {
    await q(`UPDATE connection SET config = jsonb_set(config, '{host}', '"192.0.2.10"') WHERE id = $1`, [R.soverin]);
    try {
      const { token } = await mintFor(driver, R);
      const res = await put(token, { ref: SOVERIN_REF, values: { password: ANNAS_SOVERIN } });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('server_not_a_name');
      expect(res.body.reasonNl).toEqual(expect.any(String));
      expect(server.logins).toHaveLength(0);
    } finally {
      await q(`UPDATE connection SET config = jsonb_set(config, '{host}', '"caldav.soverin.net"') WHERE id = $1`, [R.soverin]);
    }
  });
});
