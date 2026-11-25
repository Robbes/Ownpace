// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT LINK AGAINST REAL SERVERS: THE ROWS, THE REQUESTS AND WHAT IS LOOKED
 * AT (workplan 0174 §11, T8).
 *
 * Two integration files use this, one per fixture, because the leg that runs
 * every Nextcloud suite against a second major (`nextcloud-second-major.yml`)
 * starts no Stalwart: `a-grant-link-against-stalwart` and
 * `a-grant-link-against-nextcloud`. Each mounts the grant routes as the API
 * mounts them, on the integration tier's Postgres read as `app_user`, and
 * writes its own organisation's rows as the create doors write them for a
 * person (0174 §8.2): each account by its server and its login, no password,
 * `status: 'error'`.
 *
 * The `vi.mock`s and the database pools stay in each file (Vitest hoists
 * mocks per file, and only a test file may open the owner's pool:
 * `a-route-that-opened-the-owners-pool`); this holds everything else.
 */

import { expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { expiryFromDays, withTenant } from '@openmig/ledger';
import { issuePersonLink } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';

/** The grant routes as `index.ts` mounts them. */
export async function grantApp(): Promise<express.Express> {
  const { default: grantRoutes } = await import('../routes/grant.ts');
  const { readingTheBody, unreadableBody } = await import('../unreadable-body.ts');
  const app = express();
  app.use(readingTheBody(express.json()));
  app.use('/api/grant', grantRoutes);
  app.use(unreadableBody);
  return app;
}

export const enc = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);
export const dec = (ref: unknown): Record<string, string> =>
  ref === null || ref === undefined ? {} : (SecretStore.decryptCredentials(ref as string) as Record<string, string>);

export interface AccountRow {
  readonly id: string;
  readonly role: 'source' | 'target';
  readonly kind: string;
  readonly config: Record<string, unknown>;
  /** What the door stored: the login, never the person's password. */
  readonly creds: Record<string, string>;
  readonly address: string;
  /** The owner's own account, connected, with its password: not a card. */
  readonly connected?: boolean;
}

export interface Organisation {
  readonly tenant: string;
  readonly accounts: ReadonlyArray<AccountRow>;
  /** [mapping, source account, target account, domains, person]. */
  readonly migrations: ReadonlyArray<readonly [string, string, string, ReadonlyArray<string>, string]>;
  readonly people: ReadonlyArray<readonly [string, string]>;
}

const box = (connection: string) => connection.replace(/00(\d\d)$/, '02$1');

export async function clean(owner: Pool, tenant: string): Promise<void> {
  for (const sql of [
    'DELETE FROM person_granted_connection WHERE tenant_id = $1',
    'DELETE FROM person_link WHERE tenant_id = $1',
    'DELETE FROM person_migration WHERE tenant_id = $1',
    'DELETE FROM person WHERE tenant_id = $1',
    'DELETE FROM scope_selection WHERE tenant_id = $1',
    'DELETE FROM mailbox_mapping WHERE tenant_id = $1',
    'DELETE FROM mailbox WHERE tenant_id = $1',
    'DELETE FROM connection WHERE tenant_id = $1',
    'DELETE FROM tenant_member WHERE tenant_id = $1',
    'DELETE FROM tenant WHERE id = $1',
  ]) {
    await owner.query(sql, [tenant]);
  }
}

export async function setUp(owner: Pool, org: Organisation): Promise<void> {
  await owner.query(`INSERT INTO tenant (id, name) VALUES ($1, 'Grant links against real servers')`, [org.tenant]);
  await owner.query('INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, $2, $3)', [
    org.tenant,
    'owner-t8',
    'owner@example.invalid',
  ]);
  for (const a of org.accounts) {
    await owner.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [a.id, org.tenant, a.role, a.kind, `t8 ${a.kind} ${a.role}`, JSON.stringify(a.config), a.connected ? 'connected' : 'error', enc(a.creds)],
    );
    await owner.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1, $2, $3, 'user', $4)`,
      [box(a.id), org.tenant, a.id, a.address],
    );
  }
  for (const [id, name] of org.people) {
    await owner.query('INSERT INTO person (id, tenant_id, display_name) VALUES ($1, $2, $3)', [id, org.tenant, name]);
  }
  for (const [m, from, to, domains, person] of org.migrations) {
    await owner.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status) VALUES ($1, $2, $3, $4, 'paused')`,
      [m, org.tenant, box(from), box(to)],
    );
    for (const d of domains) {
      await owner.query('INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)', [
        org.tenant,
        m,
        d,
      ]);
    }
    await owner.query('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1, $2, $3)', [m, person, org.tenant]);
  }
}

/** The person's accounts back to how the owner saved them: no password anywhere, no tries, no grants. */
export async function reset(owner: Pool, org: Organisation): Promise<void> {
  await owner.query('DELETE FROM person_granted_connection WHERE tenant_id = $1', [org.tenant]);
  await owner.query('DELETE FROM person_link WHERE tenant_id = $1', [org.tenant]);
  for (const a of org.accounts) {
    if (a.connected) continue;
    await owner.query('UPDATE connection SET secret_ref = $2, qualification = NULL WHERE id = $1', [a.id, enc(a.creds)]);
  }
  await owner.query('UPDATE mailbox_mapping SET source_secret_ref = NULL, grant_withdrawn_at = NULL WHERE tenant_id = $1', [
    org.tenant,
  ]);
}

/** A fresh grant link for a person: its token and its id. */
export function mint(owner: Pool, tenant: string, personId: string): Promise<{ token: string; id: string }> {
  return withTenant(owner, tenant, (db) =>
    issuePersonLink(db, { tenantId: tenant, personId, purpose: 'grant', createdBy: 'owner-t8', expiresAt: expiryFromDays(7) }),
  );
}

export interface Card {
  ref: string;
  role: 'source' | 'target';
  way: string;
  provider: string;
  account: string;
  granted: boolean;
  server?: { hosts: string[]; published: boolean; domains?: string[]; notTheAddressMail?: string[] } | null;
  fields?: Array<{ key: string; who: string }>;
  tries?: { left: number; locked: boolean } | null;
}

/** The requests a person makes, each response kept for the sentinel check. */
export function person(app: express.Express) {
  const said: string[] = [];
  return {
    said,
    async cards(token: string): Promise<Card[]> {
      const res = await request(app).get(`/api/grant/${token}`);
      said.push(JSON.stringify(res.headers), res.text);
      expect(res.status, res.text).toBe(200);
      return (res.body as { accounts: Card[] }).accounts;
    },
    async open(token: string) {
      const res = await request(app).get(`/api/grant/${token}`);
      said.push(JSON.stringify(res.headers), res.text);
      return res;
    },
    async put(token: string, ref: string, password: string) {
      const res = await request(app).put(`/api/grant/${token}/password`).send({ ref, values: { password }, locale: 'nl' });
      said.push(JSON.stringify(res.headers), res.text);
      return res;
    },
  };
}

export function card(cards: Card[], role: Card['role'], provider: string): Card {
  const found = cards.find((c) => c.role === role && c.provider === provider);
  expect(found, `no ${role} card for ${provider}: ${JSON.stringify(cards)}`).toBeDefined();
  return found!;
}

export const triesOf = async (owner: Pool, linkId: string, ref: string) =>
  (await owner.query('SELECT refused, locked_at FROM person_link_try WHERE link_id = $1 AND account_ref = $2', [linkId, ref]))
    .rows[0] as { refused: number; locked_at: Date | null } | undefined;
export const secretOf = async (owner: Pool, connection: string) =>
  dec((await owner.query('SELECT secret_ref FROM connection WHERE id = $1', [connection])).rows[0]?.secret_ref);
export const sourceSecretOf = async (owner: Pool, mapping: string) =>
  dec((await owner.query('SELECT source_secret_ref FROM mailbox_mapping WHERE id = $1', [mapping])).rows[0]?.source_secret_ref);

/** Everything written to stdout, stderr and the console while armed; passed through, not swallowed. */
export function captureOutput(): { readonly written: string[]; arm(): void; disarm(): void } {
  const written: string[] = [];
  const spies: Array<{ mockRestore(): void }> = [];
  return {
    written,
    arm() {
      const capture = (stream: NodeJS.WriteStream) => {
        const original = stream.write.bind(stream);
        return vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
          written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
          return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
        }) as never);
      };
      spies.push(capture(process.stdout), capture(process.stderr));
      for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        const original = console[level].bind(console);
        spies.push(
          vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
            written.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, Object.getOwnPropertyNames(a ?? {})))).join(' '));
            original(...args);
          }),
        );
      }
    },
    disarm() {
      while (spies.length > 0) spies.pop()!.mockRestore();
    },
  };
}

/**
 * Every password typed, right or wrong, as typed, in base64 and URL-encoded,
 * in no response, log line, `audit_log` row, try row, link row, grant row, or
 * any column of a connection or a migration but the two encrypted ones.
 */
export async function noPasswordAnywhere(
  owner: Pool,
  tenant: string,
  passwords: ReadonlyArray<string>,
  said: ReadonlyArray<string>,
  written: ReadonlyArray<string>,
): Promise<void> {
  const forms = (p: string) => [p, Buffer.from(p).toString('base64'), encodeURIComponent(p)];
  const rows = async (sql: string) => (await owner.query(sql, [tenant])).rows.map((r) => JSON.stringify(r));
  const places: Record<string, ReadonlyArray<string>> = {
    responses: said,
    logs: written,
    audit: await rows('SELECT to_jsonb(a)::text AS row FROM audit_log a WHERE tenant_id = $1'),
    tries: await rows('SELECT to_jsonb(t)::text AS row FROM person_link_try t WHERE tenant_id = $1'),
    links: await rows('SELECT to_jsonb(l)::text AS row FROM person_link l WHERE tenant_id = $1'),
    granted: await rows('SELECT to_jsonb(g)::text AS row FROM person_granted_connection g WHERE tenant_id = $1'),
    connections: await rows(`SELECT (to_jsonb(c) - 'secret_ref')::text AS row FROM connection c WHERE tenant_id = $1`),
    migrations: await rows(`SELECT (to_jsonb(m) - 'source_secret_ref')::text AS row FROM mailbox_mapping m WHERE tenant_id = $1`),
  };
  // Vacuity: the places were filled by the cases before.
  expect(said.length).toBeGreaterThan(4);
  expect(places.audit!.length).toBeGreaterThan(2);
  expect(places.tries!.length).toBeGreaterThan(0);
  for (const p of passwords) {
    expect(p.length, 'a password to look for').toBeGreaterThan(0);
    for (const form of forms(p)) {
      for (const [where, lines] of Object.entries(places)) {
        expect(lines.find((l) => l.includes(form)), `a password found in ${where}`).toBeUndefined();
      }
    }
  }
}
