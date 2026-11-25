// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD THE LINK NEVER SAYS (workplan 0174 §5.6, T3).
 *
 * A password a person types on their grant link goes one way: browser to API
 * in a JSON body, into the test, then encrypted at rest. Never in a URL, a log
 * line, an audit row, a response, a job payload or an error text. This is that
 * sentence as a test, not a promise.
 *
 * The route runs over PGlite with both chains and recorded servers, once per
 * outcome, each with its own sentinel password: connected (a source and a
 * destination), refused, unreachable, a face refused, locked, revoked while the
 * test ran, and a body that is not JSON. For each it captures every line
 * written to stdout and stderr, every response body and header, and every
 * column of every row the database holds afterwards except the two encrypted
 * credential columns, and fails if the sentinel, or its base64, or its URL
 * encoding, appears in any of them. The encrypted columns are decrypted and
 * must hold the sentinel exactly once for each password that was stored, and
 * not at all for one that was not.
 *
 * The recorded refusals carry their parts (`said`), so the probe's answer is
 * said from them and its full text is logged under a reference, as on the
 * managed API: the log line that path writes is read here too.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.GRANT_PASSWORD_TESTS_PER_HOUR = '1000';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import type { ProbeResult } from '@openmig/orchestration/probe-connection';
import type { AccountQualification } from '@openmig/orchestration/account-qualification';
import { annasRows, mintFor, query, resetAnna, setUpAnna } from './password-link.fixture.ts';

const R = annasRows('01740004');

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

const server = {
  answer: (): ProbeResult | Promise<ProbeResult> => CONNECTED,
  qualification: undefined as AccountQualification | undefined,
};
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return { ...actual, probeSourceConnection: async () => server.answer(), probeTargetConnection: async () => server.answer() };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: async () => server.qualification };
});
vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  return { ...actual, verifyMX: async () => ({ resolverResults: {} }) };
});

const { default: grantRoutes } = await import('./grant.ts');
const { accountRef } = await import('./migrations/person-grant-subject.ts');
const { readingTheBody, unreadableBody } = await import('../unreadable-body.ts');

// Mounted as `index.ts` mounts it: the body parser through `readingTheBody`,
// and a body it could not read answered by `unreadableBody`.
const app = express();
app.use(readingTheBody(express.json()));
app.use('/api/grant', grantRoutes);
app.use(unreadableBody);

const q = (sql: string, params: unknown[] = []) => query(driver, sql, params);
const ICLOUD_REF = accountRef('source', 'apple', R.icloud, 'anna@icloud.com');
const SOVERIN_REF = accountRef('target', 'soverin', R.soverin, 'anna@soverin.net');

const CONNECTED: ProbeResult = { ok: true, detail: 'Connected.', outcome: { code: 'connected', count: 1, unit: 'calendar' } };
const REFUSED: ProbeResult = {
  ok: false,
  reason: 'The IMAP server refused: NO [AUTHENTICATIONFAILED] Invalid credentials (in answer to: LOGIN "anna@icloud.com" (* value hidden *))',
  outcome: { code: 'providerRefused' },
  said: { kind: 'answered', protocol: 'imap', providerWords: 'NO [AUTHENTICATIONFAILED] Invalid credentials' },
  refusedLogin: true,
};
const UNREACHABLE: ProbeResult = {
  ok: false,
  reason: 'connect ECONNREFUSED caldav.soverin.net:443',
  outcome: { code: 'providerRefused' },
  said: { kind: 'unreachable' },
};

/** Everything written to stdout and stderr while a case runs. */
let written: string[] = [];
const spies: Array<{ mockRestore(): void }> = [];

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
  await q('DELETE FROM audit_log WHERE tenant_id = $1', [R.tenant]).catch(() => undefined);
  server.answer = () => CONNECTED;
  server.qualification = undefined;
  written = [];
  const capture = (stream: NodeJS.WriteStream) =>
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
      return true;
    }) as never);
  spies.push(capture(process.stdout), capture(process.stderr));
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        written.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, Object.getOwnPropertyNames(a ?? {})))).join(' '));
      }),
    );
  }
});

afterEach(() => {
  while (spies.length > 0) spies.pop()!.mockRestore();
});

/** Every row of every table the app's role can read in Anna's organisation, the two credential columns apart. */
async function everyRow(): Promise<{ readonly rows: string; readonly secrets: string[] }> {
  const conn = await driver.acquire();
  try {
    await conn.query(`SELECT set_config('app.current_tenant', $1, false)`, [R.tenant]);
    const tables = (
      await conn.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)
    ).rows as Array<{ table_name: string }>;
    const out: string[] = [];
    const secrets: string[] = [];
    for (const { table_name: t } of tables) {
      let rows: Array<Record<string, unknown>>;
      try {
        rows = (await conn.query(`SELECT * FROM public."${t}"`)).rows as Array<Record<string, unknown>>;
      } catch {
        // A table the app's role may not read is one the route cannot write.
        await conn.query('ROLLBACK').catch(() => undefined);
        continue;
      }
      for (const row of rows) {
        const copy = { ...row };
        for (const col of ['secret_ref', 'source_secret_ref']) {
          if ((t === 'connection' && col === 'secret_ref') || (t === 'mailbox_mapping' && col === 'source_secret_ref')) {
            if (typeof copy[col] === 'string') secrets.push(JSON.stringify(SecretStore.decryptCredentials(copy[col] as string)));
            delete copy[col];
          }
        }
        out.push(`${t}: ${JSON.stringify(copy)}`);
      }
    }
    await conn.query(`SELECT set_config('app.current_tenant', '', false)`);
    return { rows: out.join('\n'), secrets };
  } finally {
    await conn.release();
  }
}

/** The sentinel in each spelling it could leak in. */
function spellings(sentinel: string): string[] {
  return [sentinel, Buffer.from(sentinel).toString('base64'), Buffer.from(sentinel).toString('base64url'), encodeURIComponent(sentinel)];
}

/** Fails when the sentinel is anywhere it must not be; answers how often each stored record holds it. */
async function sayNothingOf(sentinel: string, responses: request.Response[]): Promise<number> {
  const said = [
    ...written,
    ...responses.map((r) => JSON.stringify({ status: r.status, headers: r.headers, body: r.body, text: r.text })),
    (await everyRow()).rows,
  ].join('\n');
  for (const s of spellings(sentinel)) expect(said, `the password, spelled ${s.slice(0, 12)}…`).not.toContain(s);
  const { secrets } = await everyRow();
  return secrets.filter((s) => s.includes(sentinel)).length;
}

const put = (token: string, ref: string, password: string) =>
  request(app).put(`/api/grant/${token}/password`).send({ ref, values: { password } });

describe('a password the link never says', () => {
  it('connected, a source: stored on its one migration, nowhere else', async () => {
    const pw = 'SENTINEL-0174-connected-source';
    const { token } = await mintFor(driver, R);
    const res = await put(token, ICLOUD_REF, pw);
    expect(res.status).toBe(200);
    expect(await sayNothingOf(pw, [res])).toBe(1);
  });

  it('connected, a destination: stored on its connection, nowhere else', async () => {
    const pw = 'SENTINEL-0174-connected-target';
    const { token } = await mintFor(driver, R);
    const res = await put(token, SOVERIN_REF, pw);
    expect(res.status).toBe(200);
    expect(await sayNothingOf(pw, [res])).toBe(1);
  });

  it('refused, five times, then locked: stored nowhere, said nowhere', async () => {
    const pw = 'SENTINEL-0174-refused';
    server.answer = () => REFUSED;
    const { token } = await mintFor(driver, R);
    const responses: request.Response[] = [];
    for (let i = 0; i < 6; i++) responses.push(await put(token, ICLOUD_REF, pw));
    expect(responses.map((r) => r.status)).toEqual([422, 422, 422, 422, 422, 423]);
    // The refusal's full text did reach the log, under its reference.
    expect(written.join('\n')).toContain('AUTHENTICATIONFAILED');
    expect(await sayNothingOf(pw, responses)).toBe(0);
  });

  it('unreachable: stored nowhere, said nowhere', async () => {
    const pw = 'SENTINEL-0174-unreachable';
    server.answer = () => UNREACHABLE;
    const { token } = await mintFor(driver, R);
    const res = await put(token, SOVERIN_REF, pw);
    expect(res.body.category).toBe('unreachable');
    expect(await sayNothingOf(pw, [res])).toBe(0);
  });

  it('a face refused: stored nowhere, said nowhere', async () => {
    const pw = 'SENTINEL-0174-face-missing';
    const no = { answer: 'no' as const, detail: 'The mail server refused this login.', reason: 'refused' as const };
    const yes = { answer: 'yes' as const, detail: '1 calendar.' };
    server.qualification = { domains: { mail: no, calendar: yes, contact: yes, file: yes, task: yes } } as AccountQualification;
    const { token } = await mintFor(driver, R);
    const res = await put(token, SOVERIN_REF, pw);
    expect(res.body.category).toBe('face_missing');
    expect(await sayNothingOf(pw, [res])).toBe(0);
  });

  it('revoked while the test ran: stored nowhere, said nowhere', async () => {
    const pw = 'SENTINEL-0174-revoked';
    const { token, id } = await mintFor(driver, R);
    server.answer = async () => {
      await q('UPDATE person_link SET revoked_at = now() WHERE id = $1', [id]);
      return CONNECTED;
    };
    const res = await put(token, SOVERIN_REF, pw);
    expect(res.status).toBe(401);
    expect(await sayNothingOf(pw, [res])).toBe(0);
  });

  it('a body that is not JSON: answered without an excerpt, logged without one', async () => {
    const pw = 'SENTINEL-0174-malformed';
    const { token } = await mintFor(driver, R);
    const res = await request(app)
      .put(`/api/grant/${token}/password`)
      .set('Content-Type', 'application/json')
      .send(`{"ref":"${ICLOUD_REF}","values":{"password":"${pw}"`);
    expect(res.status).toBe(400);
    expect(await sayNothingOf(pw, [res])).toBe(0);
  });
});
