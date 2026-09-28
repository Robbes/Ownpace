// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS UNDER ROW SECURITY (workplan 0138 T1).
 *
 * The API's request path connects as `app_user`, so row security filters every
 * query it makes. The Trigger.dev tasks connect as the database owner, a
 * superuser on the managed stack, whom Postgres never binds, so in the task
 * plane the boundary between organisations rests on each query's own `WHERE`
 * (0138 §1). T1 moves the per-tenant tasks onto `app_user`. Changing the URL
 * alone would not do it: under row security a read with no tenant set is not
 * refused, it answers nothing, and a pass whose handles were not scoped would
 * copy nothing and could still end as if it had succeeded.
 *
 * So this seeds two organisations as the owner, builds a pass's handles for
 * organisation A the way the jobs build them, on a pool that connects as
 * `app_user`, and asserts:
 *
 *   1. what the pass writes and reads for A is there. This is the half that
 *      fails when a scope was missed: fail-closed row security turns a missed
 *      scope into an empty pass, not an error. Its writes (the ledger, the
 *      cursors) read back, and what it asks before it runs (the data types it
 *      carries, those its owner stopped, whose limit it spends) is A's answer
 *      and not an empty one.
 *   2. a deliberately unscoped probe, `SELECT count(*) FROM connection`, run
 *      on the handle each store was given, counts A's rows only. On the code
 *      before T1's first step it counted both organisations': the builders
 *      opened a handle of their own from `TEST_DATABASE_URL || DATABASE_URL`,
 *      the owner's, whatever pool they were handed.
 *
 * The first assertion also covers the reads a verification and a rollback
 * make, through the jobs' own code: the cutover gate (`runCutoverGate`, whose
 * ledger reader `run-verification` shares, `ledgerReaderFor`) counts what A's
 * migration recorded, and the rollback's notice finds the name A gave it
 * (`mappingNameOf`). Nothing else ran either of those on `app_user`: the
 * cutover suites run the gate on the owner's pool, where a missed scope
 * changes nothing.
 *
 * T1's first step (2026-09-28: every handle a pass uses is scoped to its
 * tenant) lands these two, and a case beside the second that shows why that
 * step changes nothing on today's connection: on the owner's pool, a
 * superuser's, the same scoped handle counts every organisation's rows. The
 * jobs themselves still connect as the owner until T1's second step, the
 * switch of connection, which adds the third assertion: that a pass run on
 * the application role reads its rows, and that an audit event it records
 * still prints its line (T1 part 5).
 *
 * Handed its database (`an-integration-test-is-handed-its-database`): it reads
 * `TEST_DATABASE_URL` and derives `app_user`'s URL from it, as
 * `a-pause-nobody-could-press.integration.test.ts` does, and never reads or
 * sets `DATABASE_URL`. The builders are called with the pool, as every job
 * calls them. The addresses are invented and nothing here is contacted.
 *
 * UUID family: 0138a000-e29b-41d4-a716-44665544xxxx.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { createPgDb, tenantScopedDb, type PgDatabase } from '@openmig/ledger';
import { asMappingId, asTenantId } from '@openmig/shared';
import {
  buildDepsFromMapping,
  buildDomainDepsFromMapping,
} from '@openmig/orchestration/build-deps-from-mapping';
import { enabledDomains, stoppedDomains } from '@openmig/orchestration/enabled-domains';
import { targetProviderKey } from '@openmig/orchestration/build-confirmation-readers';
import { runCutoverGate } from './cutover-gate.ts';
import { mappingNameOf } from './run-rollback.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

/** The role the per-tenant tasks move onto, so the policies bind rather than being skipped. */
function asAppUser(url: string): string {
  const parsed = new URL(url);
  parsed.username = 'app_user';
  parsed.password = 'app_password';
  return parsed.toString();
}

const P = '0138a000-e29b-41d4-a716-4466554400';
const A = `${P}a1`;
const B = `${P}b1`;
const A_MAIL_SOURCE = `${P}11`;
const A_ACCOUNT_SOURCE = `${P}12`;
const A_TARGET = `${P}13`;
const A_MAIL_BOX = `${P}21`;
const A_ACCOUNT_BOX = `${P}22`;
const A_TARGET_BOX = `${P}23`;
const A_MAIL = `${P}31`;
const A_ACCOUNT = `${P}32`;
/** A's third migration, of calendars to the JMAP target, which offers no calendar listing to verify against. */
const A_CALENDARS = `${P}33`;
const A_CALENDARS_NAME = 'Calendars to the new place';
/** What A's calendar migration recorded, which the gate must count on `app_user`. */
const A_CALENDAR_ITEMS = 3;
const B_SOURCE = `${P}41`;
const B_TARGET = `${P}42`;
const B_SOURCE_BOX = `${P}51`;
const B_TARGET_BOX = `${P}52`;
const B_MAPPING = `${P}61`;

/** A's connections: two sources and a target. B has two more, which A must never count. */
const A_CONNECTIONS = 3;

/** An account's own OAuth values, in the config the builders accept for tests. */
const GOOGLE = { clientId: 'cid', clientSecret: 'csec', refreshToken: '1//not-a-token' };

let owner: ReturnType<typeof createPgDb>;
let appPool: Pool;

/** The handle a store was built on. The stores keep it private; the probe needs it. */
const handleOf = (store: unknown): PgDatabase => (store as { db: PgDatabase }).db;

const countOf = async (db: PgDatabase, table: 'connection' | 'tenant'): Promise<number> => {
  const result = (await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))) as unknown as {
    rows: Array<{ n: number }>;
  };
  return result.rows[0]!.n;
};

beforeAll(async () => {
  owner = createPgDb(PG_CONNECTION_STRING);
  appPool = new Pool({ connectionString: asAppUser(PG_CONNECTION_STRING) });

  await owner.execute(sql`
    INSERT INTO tenant (id, name, status) VALUES
      (${A}, 'A Pass Under Row Security', 'active'),
      (${B}, 'Somebody Else Entirely', 'active')
    ON CONFLICT (id) DO NOTHING`);
  await owner.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
      (${A_MAIL_SOURCE}, ${A}, 'source', 'gmail', 'mail',
       ${JSON.stringify({ type: 'gmail', user: 'pat@example.invalid', credentials: GOOGLE })}::jsonb, 'connected'),
      (${A_ACCOUNT_SOURCE}, ${A}, 'source', 'google', 'account',
       ${JSON.stringify({ type: 'google', user: 'pat@example.invalid', credentials: GOOGLE })}::jsonb, 'connected'),
      (${A_TARGET}, ${A}, 'target', 'jmap', 'target',
       ${JSON.stringify({
         type: 'jmap',
         baseUrl: 'https://jmap.example.invalid',
         user: 'pat@target.example.invalid',
         // \`user\` for its mail face, \`username\` for its contacts face.
         credentials: { user: 'pat@target.example.invalid', username: 'pat@target.example.invalid', password: 'not-a-password' },
       })}::jsonb, 'connected'),
      (${B_SOURCE}, ${B}, 'source', 'gmail', 'mail',
       ${JSON.stringify({ type: 'gmail', user: 'sam@example.invalid', credentials: GOOGLE })}::jsonb, 'connected'),
      (${B_TARGET}, ${B}, 'target', 'jmap', 'target',
       ${JSON.stringify({
         type: 'jmap',
         baseUrl: 'https://jmap.elsewhere.invalid',
         user: 'sam@target.example.invalid',
         credentials: { user: 'sam@target.example.invalid', password: 'not-a-password' },
       })}::jsonb, 'connected')
    ON CONFLICT (id) DO NOTHING`);
  await owner.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
      (${A_MAIL_BOX}, ${A}, ${A_MAIL_SOURCE}, 'user', 'pat@example.invalid'),
      (${A_ACCOUNT_BOX}, ${A}, ${A_ACCOUNT_SOURCE}, 'user', 'pat@example.invalid'),
      (${A_TARGET_BOX}, ${A}, ${A_TARGET}, 'user', 'pat@target.example.invalid'),
      (${B_SOURCE_BOX}, ${B}, ${B_SOURCE}, 'user', 'sam@example.invalid'),
      (${B_TARGET_BOX}, ${B}, ${B_TARGET}, 'user', 'sam@target.example.invalid')
    ON CONFLICT (id) DO NOTHING`);
  await owner.execute(sql`
    INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status) VALUES
      (${A_MAIL}, ${A}, ${A_MAIL_BOX}, ${A_TARGET_BOX}, 'mirror', 'active'),
      (${A_ACCOUNT}, ${A}, ${A_ACCOUNT_BOX}, ${A_TARGET_BOX}, 'mirror', 'active'),
      (${B_MAPPING}, ${B}, ${B_SOURCE_BOX}, ${B_TARGET_BOX}, 'mirror', 'active')
    ON CONFLICT (id) DO NOTHING`);
  await owner.execute(sql`
    INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, target_folder_prefix, name, mode, status)
    VALUES (${A_CALENDARS}, ${A}, ${A_ACCOUNT_BOX}, ${A_TARGET_BOX}, 'calendars', ${A_CALENDARS_NAME}, 'mirror', 'active')
    ON CONFLICT (id) DO NOTHING`);
  await owner.execute(sql`DELETE FROM scope_selection WHERE tenant_id IN (${A}, ${B})`);
  await owner.execute(sql`
    INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES
      (${A}, ${A_MAIL}, 'email', true),
      (${A}, ${A_ACCOUNT}, 'contact', true),
      (${A}, ${A_ACCOUNT}, 'task', true),
      (${A}, ${A_CALENDARS}, 'calendar', true),
      (${B}, ${B_MAPPING}, 'email', true)`);
  // A's tasks stopped by their owner; B's rows are there to be not seen.
  await owner.execute(sql`DELETE FROM path_lifecycle WHERE tenant_id IN (${A}, ${B})`);
  await owner.execute(sql`
    INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, stopped_at) VALUES
      (${A}, ${A_ACCOUNT}, 'task', 'active', now(), now()),
      (${B}, ${B_MAPPING}, 'email', 'active', now(), now())`);
  await owner.execute(sql`DELETE FROM item WHERE tenant_id IN (${A}, ${B})`);
  for (let i = 1; i <= A_CALENDAR_ITEMS; i++) {
    await owner.execute(sql`
      INSERT INTO item (tenant_id, mapping_id, domain, item_type, collection, natural_key, natural_key_hash, status)
      VALUES (${A}, ${A_CALENDARS}, 'calendar', 'calendar', 'calendars/home', ${`event-${i}`}, ${`h-0138-a-calendar-${i}`}, 'copied')`);
  }
  await owner.execute(sql`
    INSERT INTO cursor (tenant_id, mapping_id, folder_path, cursor_value) VALUES
      (${B}, ${B_MAPPING}, 'INBOX', 'b-cursor')
    ON CONFLICT DO NOTHING`);
});

afterAll(async () => {
  for (const table of ['item', 'cursor', 'path_lifecycle', 'scope_selection', 'mailbox_mapping', 'mailbox', 'connection']) {
    await owner?.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id IN (${A}, ${B})`);
  }
  await owner?.execute(sql`DELETE FROM tenant WHERE id IN (${A}, ${B})`);
  await appPool?.end();
  await owner?.close();
});

describe('first: what a pass writes and reads for its organisation is there', () => {
  it('writes to the ledger and the cursors read back, and are the organisation\'s', async () => {
    const mail = await buildDepsFromMapping(appPool, A, A_MAIL);
    const contacts = await buildDomainDepsFromMapping(appPool, A, A_ACCOUNT, 'contact');
    try {
      await mail.ledger.recordIfAbsent({
        tenantId: asTenantId(A),
        mappingId: asMappingId(A_MAIL),
        itemType: 'email',
        naturalKeyHash: 'h-0138-a-mail',
        contentHash: 'c-0138',
        targetId: 't-0138',
        createdAt: new Date().toISOString(),
      });
      expect(await mail.ledger.find(asTenantId(A), asMappingId(A_MAIL), 'email', 'h-0138-a-mail')).toMatchObject({
        targetId: 't-0138',
      });

      await contacts.cursors!.set(asTenantId(A), asMappingId(A_ACCOUNT), 'addressbooks/default', { value: 'ctag-1' });
      expect(await contacts.cursors!.get(asTenantId(A), asMappingId(A_ACCOUNT), 'addressbooks/default')).toEqual({
        value: 'ctag-1',
      });

      // And they landed as A's rows, asked of the owner, whom no policy filters.
      const item = (await owner.execute(
        sql`SELECT tenant_id FROM item WHERE natural_key_hash = 'h-0138-a-mail'`,
      )) as unknown as { rows: Array<{ tenant_id: string }> };
      expect(item.rows.map((r) => r.tenant_id)).toEqual([A]);
    } finally {
      await mail.close();
      await contacts.close();
    }
  });

  it('asks what it carries, what was stopped and whose limit it spends, and gets the organisation\'s answers', async () => {
    // On `app_user` with no tenant set each of these would answer nothing: a
    // pass with no data types to run, a stop not honoured, a confirmation
    // with no target to name.
    expect([...(await enabledDomains(appPool, A, A_ACCOUNT))].sort()).toEqual(['contact', 'task']);
    expect([...(await enabledDomains(appPool, A, A_MAIL))]).toEqual(['email']);
    expect([...(await stoppedDomains(appPool, A, A_ACCOUNT))]).toEqual(['task']);
    expect(await targetProviderKey(appPool, A, A_MAIL)).toBe('target:jmap.example.invalid');
  });

  it('is verified by the cutover gate against what the migration recorded, not against nothing', async () => {
    // The gate's own reads on `app_user`: the data types it carries, those
    // stopped, and the ledger reader it shares with `run-verification`. The
    // target has no calendar listing, so the gate blocks without contacting
    // it, and says how many items it could not check: the reader's count. An
    // unscoped reader counts none, and the gate reports nothing recorded.
    const verdict = await runCutoverGate(appPool, A, A_CALENDARS);

    expect(verdict.calendar.status).toBe('NOT_VERIFIABLE');
    expect(verdict.calendar.issues[0]?.message).toMatch(
      new RegExp(`^${A_CALENDAR_ITEMS} calendar item\\(s\\) were copied`),
    );
    expect(verdict.canProceedToCutover).toBe(false);
  });

  it('names the migration in a rollback\'s notice as its organisation named it', async () => {
    // Unscoped on `app_user` this finds no row, and the notice names a UUID.
    expect(await mappingNameOf(appPool, A, A_CALENDARS)).toBe(A_CALENDARS_NAME);
  });
});

describe('second: an unscoped probe on the handle a store was given counts its organisation\'s rows only', () => {
  it('on every store the mail builder and the other data types\' builder hand the pass', async () => {
    const mail = await buildDepsFromMapping(appPool, A, A_MAIL);
    const contacts = await buildDomainDepsFromMapping(appPool, A, A_ACCOUNT, 'contact');
    try {
      // The premise: the owner counts both organisations' connections.
      expect(await countOf(owner, 'connection')).toBeGreaterThanOrEqual(A_CONNECTIONS + 2);

      for (const [name, store] of [
        ['the mail ledger', mail.ledger],
        ['the mail cursors', mail.cursors],
        ['the contacts ledger', contacts.ledger],
        ['the contacts cursors', contacts.cursors],
      ] as const) {
        // No WHERE, on purpose: what answers is the handle, not the query.
        expect(await countOf(handleOf(store), 'connection'), name).toBe(A_CONNECTIONS);
        expect(await countOf(handleOf(store), 'tenant'), name).toBe(1);
      }
    } finally {
      await mail.close();
      await contacts.close();
    }
  });

  it('and on the owner\'s connection, a superuser\'s, the same scope changes nothing', async () => {
    // Why scoping every handle, T1's first step, changes no pass on the
    // connection the jobs still use: Postgres applies no policy to a
    // superuser, so a handle scoped to A on the owner's own pool counts every
    // organisation's rows. Only the switch of connection, T1's second step,
    // can make a pass read less, and it lands with the third assertion the
    // header names.
    const everyOrganisations = await countOf(owner, 'connection');
    expect(everyOrganisations).toBeGreaterThanOrEqual(A_CONNECTIONS + 2);
    expect(await countOf(tenantScopedDb(owner.$pool, A), 'connection')).toBe(everyOrganisations);
  });
});
