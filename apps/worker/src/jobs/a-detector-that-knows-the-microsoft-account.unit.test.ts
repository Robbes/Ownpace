// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DETECTOR THAT KNOWS THE MICROSOFT ACCOUNT (workplan 0141 T11).
 *
 * Two scheduled tasks ask a tenant's directory every morning: drift detection
 * (new mailboxes, 07:00) and group discovery (shared addresses, 06:30). Neither
 * can be switched off by a setting. For a tester whose source is a Microsoft
 * account, both said something untrue in the operator's log:
 *
 * - drift detection looked for `kind = 'o365'` alone, found nothing, and said
 *   the tenant had no Microsoft 365 source connection;
 * - group discovery sent every kind but `o365` to IMAP's answer, and said the
 *   account's source spoke IMAP, which has no directory.
 *
 * What is true is the grant: it is delegated, and reads the signed-in person's
 * own data. Both now say that, through `directoryAvailability`.
 *
 * - `listDirectoryOf` and `listGroupsOf`, the part of each task that decides,
 *   are called with a `microsoft` source;
 * - drift detection's lookup runs on the ledger's own schema (PGlite), and
 *   finds a `microsoft` row;
 * - each task's body is read as text, as `a-tick-that-says-it-ran` does,
 *   because the body needs a runner: it asks the one kind list, and hands the
 *   row to the function above.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pgliteDriver, runMigrations, type LedgerDriver, type LedgerConnection } from '@openmig/ledger';
import { MICROSOFT_ACCOUNT_IS_DELEGATED } from '@openmig/connectors';
import { microsoftSourceKinds } from '@openmig/orchestration/source-face-builders';

// UUID family 0141c000-…11xx, unused elsewhere in the repo.
const TENANT = '0141c000-e29b-41d4-a716-446655441101';
const ACCOUNT = '0141c000-e29b-41d4-a716-446655441111';
const MAILBOX_SOURCE = '0141c000-e29b-41d4-a716-446655441112';

/** An application registration in the environment: it changes nothing here. */
const APP_ENV = { OAUTH2_CLIENT_ID: 'app-id', OAUTH2_CLIENT_SECRET: 'not-a-real-secret' };

/** What Connect with Microsoft stores: the kind and the address, no tenant. */
const ACCOUNT_ROW = { kind: 'microsoft', config: { type: 'microsoft', user: 'someone@example.test' } };

let drift: typeof import('./managed-drift-detect.ts');
let groups: typeof import('./managed-group-discovery.ts');

beforeAll(async () => {
  // The tasks build a pool at import; nothing here connects to it.
  process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/none';
  drift = await import('./managed-drift-detect.ts');
  groups = await import('./managed-group-discovery.ts');
});

const reasonOf = (listing: { kind: string; reason?: string }): string =>
  listing.kind === 'not_enumerable' ? (listing.reason ?? '') : '';

describe('drift detection gives a Microsoft account its delegated reason', () => {
  it('says the grant is delegated, not that there is no Microsoft 365 source', async () => {
    const reason = reasonOf(await drift.listDirectoryOf(ACCOUNT_ROW, APP_ENV));
    expect(reason).toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
    expect(reason).not.toContain('no Microsoft 365 source connection');
    // Still a blind spot said as one, never "no new mailboxes".
    expect(reason).toContain('nothing was looked at');
  });

  it('still says there is none for a tenant that has none', async () => {
    const reason = reasonOf(await drift.listDirectoryOf(undefined, APP_ENV));
    expect(reason).toContain('no Microsoft 365 source connection');
  });
});

describe('group discovery gives a Microsoft account its delegated reason', () => {
  it("says the grant is delegated, in neither IMAP's words nor 'no source'", async () => {
    const reason = reasonOf(await groups.listGroupsOf(ACCOUNT_ROW, APP_ENV));
    expect(reason).toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
    expect(reason, "IMAP's answer, for a source that is not IMAP").not.toContain('IMAP has no directory');
    expect(reason).not.toContain('no Microsoft 365 source connection');
  });

  it('keeps IMAP its own answer', async () => {
    const reason = reasonOf(await groups.listGroupsOf({ kind: 'imap', config: {} }, APP_ENV));
    expect(reason).toContain('IMAP has no directory');
  });
});

describe("drift detection's lookup, on the ledger's own schema", () => {
  let driver: LedgerDriver;
  let conn: LedgerConnection;

  beforeAll(async () => {
    driver = pgliteDriver({});
    await runMigrations({ driver, logger: () => {} });
    conn = await driver.acquire();
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'microsoft', 'active')`, [
      TENANT,
    ]);
    await conn.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
       VALUES ($1, $3, 'source', 'microsoft', 'account', 'connected', '{"type":"microsoft"}'::jsonb),
              ($2, $3, 'source', 'imap', 'mail', 'connected', '{}'::jsonb)`,
      [ACCOUNT, MAILBOX_SOURCE, TENANT],
    );
    // The whole migration chain on PGlite, under a full `--project unit` run
    // (a-fixture-with-ten-seconds): the figure its neighbours use.
  }, 120_000);

  afterAll(async () => {
    conn?.release();
    await driver?.end();
  });

  it('finds the Microsoft account, and nothing that is not Microsoft', async () => {
    const { rows } = await conn.query<{ kind: string }>(drift.MICROSOFT_SOURCES_SQL, [
      TENANT,
      [...microsoftSourceKinds()],
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['microsoft']);
  });
});

describe('each task hands its rows to the part that decides', () => {
  /** A task's source with its comments removed. */
  const code = (file: string): string =>
    readFileSync(join(import.meta.dirname, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

  it('drift detection asks every Microsoft kind, and decides with listDirectoryOf', () => {
    const task = code('managed-drift-detect.ts');
    expect(task).toMatch(/MICROSOFT_SOURCES_SQL,\s*\[tenant\.id, \[\.\.\.microsoftSourceKinds\(\)\]\]/);
    expect(task).toMatch(/directorySourceOf\(microsoftSources\)/);
    expect(task).toMatch(/listDirectory: \(\) => listDirectoryOf\(source\)/);
  });

  it('group discovery decides with listGroupsOf', () => {
    expect(code('managed-group-discovery.ts')).toMatch(/listGroups: \(\) => listGroupsOf\(source\)/);
  });
});
