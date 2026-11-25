// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ANNA'S ACCOUNTS, FOR THE PASSWORD ROUTE'S TESTS (workplan 0174 T3).
 *
 * The owner saved Anna's iCloud account (a source) and her own Soverin account
 * (a destination) for her, by address and server, with no password; a second
 * migration copies the owner's old mail server into the same Soverin account.
 * The route's tests and the guard `a-password-the-link-never-says` set the
 * same rows up, each in its own PGlite database, under its own UUID family.
 */

import { expiryFromDays, withTenant, type LedgerDriver } from '@openmig/ledger';
import { issuePersonLink } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';

export interface AnnasRows {
  readonly tenant: string;
  readonly icloud: string;
  readonly oldMail: string;
  readonly soverin: string;
  readonly icloudToSoverin: string;
  readonly oldMailToSoverin: string;
  readonly anna: string;
  /** A second person, for a destination somebody else granted. */
  readonly bert: string;
}

/** The rows under one UUID family: `prefix` is eight hex digits nobody else uses. */
export function annasRows(prefix: string): AnnasRows {
  const U = (n: string) => `${prefix}-e29b-41d4-a716-4466554400${n}`;
  return {
    tenant: U('01'),
    icloud: U('11'),
    oldMail: U('12'),
    soverin: U('13'),
    icloudToSoverin: U('31'),
    oldMailToSoverin: U('32'),
    anna: U('41'),
    bert: U('42'),
  };
}

export const OWNERS_OLD_MAIL_PASSWORD = 'SENTINEL-owner-old-mail-password';

/** A query as the app's role. */
export async function query(
  driver: LedgerDriver,
  sql: string,
  params: unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** An encrypted credential record, as the doors store one. */
export const encrypted = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

/** Anna's accounts and migrations, written as the app's role. */
export async function setUpAnna(driver: LedgerDriver, r: AnnasRows): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => query(driver, sql, params);
  await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [r.tenant, 'Acme Legal']);
  await q('INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1,$2,$3)', [r.tenant, 'pat', 'owner@example.org']);
  for (const [id, role, kind, config, secret] of [
    [r.icloud, 'source', 'apple', { user: 'anna@icloud.com' }, null],
    [r.oldMail, 'source', 'imap', { host: 'imap.old.example', port: 993 }, encrypted({ username: 'anna@old.example', password: OWNERS_OLD_MAIL_PASSWORD })],
    [r.soverin, 'target', 'soverin', { host: 'caldav.soverin.net', port: 443, mailHost: 'imap.soverin.net', user: 'anna@soverin.net' }, null],
  ] as const) {
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,$3,$4,'c',$5::jsonb,'connected',$6)`,
      [id, r.tenant, role, kind, JSON.stringify(config), secret],
    );
    await q(`INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`, [
      id.replace(/00(\d\d)$/, '02$1'),
      r.tenant,
      id,
    ]);
  }
  const box = (c: string) => c.replace(/00(\d\d)$/, '02$1');
  for (const [m, from, to, domains] of [
    [r.icloudToSoverin, r.icloud, r.soverin, ['email', 'calendar']],
    [r.oldMailToSoverin, r.oldMail, r.soverin, ['email']],
  ] as const) {
    await q(`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status) VALUES ($1,$2,$3,$4,'paused')`, [
      m,
      r.tenant,
      box(from),
      box(to),
    ]);
    for (const d of domains) {
      await q('INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)', [r.tenant, m, d]);
    }
  }
  await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'Anna'), ($3,$2,'Bert')`, [r.anna, r.tenant, r.bert]);
  for (const m of [r.icloudToSoverin, r.oldMailToSoverin]) {
    await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [m, r.anna, r.tenant]);
  }
}

/** A fresh grant link for Anna: its token and its id. */
export function mintFor(driver: LedgerDriver, r: AnnasRows): Promise<{ token: string; id: string }> {
  return withTenant(driver, r.tenant, (db) =>
    issuePersonLink(db, { tenantId: r.tenant, personId: r.anna, purpose: 'grant', createdBy: 'pat', expiresAt: expiryFromDays(7) }),
  );
}

/** Anna's accounts back to how the owner saved them: no password anywhere, no tries, no grants. */
export async function resetAnna(driver: LedgerDriver, r: AnnasRows): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => query(driver, sql, params);
  await q('DELETE FROM person_granted_connection WHERE tenant_id = $1', [r.tenant]);
  await q('UPDATE connection SET secret_ref = NULL, qualification = NULL WHERE id = ANY($1::uuid[])', [[r.icloud, r.soverin]]);
  await q('UPDATE mailbox_mapping SET source_secret_ref = NULL, grant_withdrawn_at = NULL, status = $2 WHERE tenant_id = $1', [r.tenant, 'paused']);
  await q('DELETE FROM person_link WHERE tenant_id = $1', [r.tenant]);
}
