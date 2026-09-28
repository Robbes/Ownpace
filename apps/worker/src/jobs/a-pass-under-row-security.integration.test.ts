// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS UNDER ROW SECURITY (workplan 0138 T1).
 *
 * The API's request path connects as `app_user`, so row security filters every
 * query it makes. Until T1's second step the Trigger.dev tasks connected as the
 * database owner, a superuser on the managed stack, whom Postgres never binds,
 * so in the task plane the boundary between organisations rested on each
 * query's own `WHERE` (0138 §1); the six scheduled jobs still do, until T2 and
 * T3 step 2. T1 moved the per-tenant tasks onto `app_user`. Changing the URL
 * alone would not have done it: under row security a read with no tenant set
 * is not refused, it answers nothing, and a pass whose handles were not scoped
 * would copy nothing and could still end as if it had succeeded.
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
 * tenant) landed these two, and a case beside the second that shows why that
 * step changed nothing on the connection the jobs then used: on the owner's
 * pool, a superuser's, the same scoped handle counts every organisation's
 * rows. T1's second step, the switch of connection, moves the jobs onto the
 * pools `openTaskPools` (`task-pools.ts`) builds, and adds the third:
 *
 *   3. a pass on the pools its task opens runs as `app_user` and sees its
 *      organisation alone, and the rest of what it touches works there too:
 *      an audit event it records still prints its line (T1 part 5: the key is
 *      read on a pool of its own, since `app_user` may not read
 *      `deployment_key`), the operator's log page takes its events, the rate
 *      and byte budgets spend, and its run row, status, first-copy bytes and
 *      confirmation reads land. On the jobs as they were before the switch,
 *      one pool on `DATABASE_URL`, the first of these fails: the pool is the
 *      owner's and counts every organisation. Moved to `APP_DATABASE_URL` with
 *      the audit sink left on the same pool, the second fails: the key read is
 *      refused and the line never prints. The key's pool is found the way the
 *      sink finds it, as the pool asked for a connection: `openTaskPools`
 *      hands a job the tenant pool alone. And a run that opens its pools and
 *      fails still leaves its event on the log page, which is on the tenant
 *      pool: `leavesAReference` records the failure before it runs the end
 *      the run left it in `afterwards`. Ended in the run's own `finally`, as
 *      run-cutover and run-rollback ended it until the step's review, the
 *      event is lost, and the last case shows that too.
 *
 * Handed its database (`an-integration-test-is-handed-its-database`): it reads
 * `TEST_DATABASE_URL` and derives `app_user`'s URL from it, as
 * `a-pause-nobody-could-press.integration.test.ts` does, and never reads or
 * sets `DATABASE_URL`: the third assertion hands `openTaskPools` an
 * environment of its own, built from the same two URLs. The builders are
 * called with the pool, as every job calls them. The addresses are invented
 * and nothing here is contacted.
 *
 * UUID family: 0138a000-e29b-41d4-a716-44665544xxxx.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import {
  PgByteBudget,
  PgMigrationStatusStore,
  PgRateBudget,
  RunStore,
  createPgDb,
  mappingLifecyclePort,
  plainDb,
  tenantScopedDb,
  withTenant,
  type PgDatabase,
} from '@openmig/ledger';
import { PgBytesMovedStore } from '@openmig/managed';
import {
  asMappingId,
  asTenantId,
  log,
  recordAppEvent,
  setAppEventSink,
  setAuditExportSink,
} from '@openmig/shared';
import { confirmationRecorder } from '@openmig/orchestration/run-confirmation-pass';
import {
  buildDepsFromMapping,
  buildDomainDepsFromMapping,
} from '@openmig/orchestration/build-deps-from-mapping';
import { enabledDomains, stoppedDomains } from '@openmig/orchestration/enabled-domains';
import { targetProviderKey } from '@openmig/orchestration/build-confirmation-readers';
import { runCutoverGate } from './cutover-gate.ts';
import { mappingNameOf } from './run-rollback.ts';
import { passStepBefore } from './stopping-a-pass.ts';
import { openTaskPools, type TaskPools } from './task-pools.ts';
import { leavesAReference } from './what-a-run-leaves.ts';
import { raiseThePeakWhereThereIsOne } from '../the-peak-where-there-is-one.ts';

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
/** A's fourth migration, cut over, which a rollback puts back to active: it records an audit event. */
const A_RETURNING = `${P}34`;
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
  await owner.execute(sql`
    INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, target_folder_prefix, mode, status)
    VALUES (${A_RETURNING}, ${A}, ${A_MAIL_BOX}, ${A_TARGET_BOX}, 'returning', 'mirror', 'cutover')
    ON CONFLICT (id) DO UPDATE SET status = 'cutover'`);
  await owner.execute(sql`DELETE FROM scope_selection WHERE tenant_id IN (${A}, ${B})`);
  await owner.execute(sql`
    INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES
      (${A}, ${A_MAIL}, 'email', true),
      (${A}, ${A_ACCOUNT}, 'contact', true),
      (${A}, ${A_ACCOUNT}, 'task', true),
      (${A}, ${A_CALENDARS}, 'calendar', true),
      (${A}, ${A_RETURNING}, 'email', true),
      (${B}, ${B_MAPPING}, 'email', true)`);
  // A's tasks stopped by their owner; B's rows are there to be not seen.
  await owner.execute(sql`DELETE FROM path_lifecycle WHERE tenant_id IN (${A}, ${B})`);
  await owner.execute(sql`
    INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, stopped_at) VALUES
      (${A}, ${A_ACCOUNT}, 'task', 'active', now(), now()),
      (${B}, ${B_MAPPING}, 'email', 'active', now(), now())`);
  await owner.execute(sql`
    INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at) VALUES
      (${A}, ${A_RETURNING}, 'email', 'cutover', now())`);
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
  for (const table of [
    'app_event',
    'rate_budget',
    'byte_budget',
    'bytes_moved',
    'occupancy_peak',
    'audit_log',
    'run_event',
    'run',
    'migration_status',
    'item',
    'cursor',
    'path_lifecycle',
    'scope_selection',
    'mailbox_mapping',
    'mailbox',
    'connection',
  ]) {
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
    // Why scoping every handle, T1's first step, changed no pass on the
    // connection the jobs then used: Postgres applies no policy to a
    // superuser, so a handle scoped to A on the owner's own pool counts every
    // organisation's rows. And why the scopes alone were not the fix: only the
    // switch of connection, T1's second step, puts them under the policies,
    // and the third assertion below is what shows it did.
    const everyOrganisations = await countOf(owner, 'connection');
    expect(everyOrganisations).toBeGreaterThanOrEqual(A_CONNECTIONS + 2);
    expect(await countOf(tenantScopedDb(owner.$pool, A), 'connection')).toBe(everyOrganisations);
  });
});

describe('third: a pass on the pools its task opens runs as the application role, and all of it works there', () => {
  /** The two URLs a run receives (set-task-env.sh), for this database: app_user's and the owner's. */
  const taskEnv = () => ({ APP_DATABASE_URL: asAppUser(PG_CONNECTION_STRING), DATABASE_URL: PG_CONNECTION_STRING });

  /** The audit lines the task's sink printed, and what it warned. */
  let lines: string[];
  let warnings: string[];
  let pools: TaskPools;
  /** The key's pool, once the sink has asked it for a connection: nothing hands it out. */
  const keyPools: Pool[] = [];

  beforeAll(() => {
    lines = [];
    pools = openTaskPools(taskEnv(), { write: (line) => lines.push(line) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    setAuditExportSink(undefined);
    setAppEventSink(undefined);
    await pools?.end();
    for (const keyPool of keyPools) if (!keyPool.ended && !keyPool.ending) await keyPool.end();
  });

  const watchWarnings = () => {
    warnings = [];
    vi.spyOn(log, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
  };

  /** Wait for the n-th line, or for the warning that says it will not come. */
  const theLine = async (n: number): Promise<Record<string, unknown>> => {
    await vi.waitFor(
      () => {
        if (lines.length < n && !warnings.some((w) => w.includes('[audit-export]'))) throw new Error('not yet');
      },
      { timeout: 15_000, interval: 50 },
    );
    expect(warnings.filter((w) => w.includes('[audit-export]')), 'the audit line was not written').toEqual([]);
    expect(lines).toHaveLength(n);
    return JSON.parse(lines[n - 1]!) as Record<string, unknown>;
  };

  it('connects as app_user, and a pass scoped to its organisation sees that organisation alone', async () => {
    // The pass's builders on this pool, as every job calls them: on the owner's
    // pool, which the jobs used before the switch, this counts every organisation.
    const mail = await buildDepsFromMapping(pools.tenant, A, A_MAIL);
    try {
      expect(await countOf(handleOf(mail.ledger), 'connection')).toBe(A_CONNECTIONS);
      expect(await countOf(tenantScopedDb(pools.tenant, A), 'tenant')).toBe(1);
    } finally {
      await mail.close();
    }
    // Because the pool is app_user's, not a superuser's.
    const who = await pools.tenant.query<{ role: string; superuser: string }>(
      "SELECT current_user AS role, current_setting('is_superuser') AS superuser",
    );
    expect(who.rows[0]).toEqual({ role: 'app_user', superuser: 'off' });
    // And the step a pass asks before each data type finds the migration.
    expect(await passStepBefore(pools.tenant, asTenantId(A), asMappingId(A_MAIL), 'email')).toEqual({ run: true });
  });

  it('prints the line of an audit event it records, on the key\'s own pool', async () => {
    watchWarnings();
    // Every pool asked for a connection, so the key's can be found: the first
    // line reads the key, and until then only the tenant pool and the key's are asked.
    const connect = vi.spyOn(Pool.prototype, 'connect');
    // The rollback's own door, as run-rollback builds it: the status, the
    // paths, the month's peak and the audit row in one scope, on the tenant pool.
    await mappingLifecyclePort(pools.tenant, A, A_RETURNING, 'trigger-job', {
      onSlotsTaken: raiseThePeakWhereThereIsOne(asTenantId(A)),
    }).setStatus({ from: 'cutover', to: 'active', via: 'rollback' });

    const line = await theLine(1);
    const asked = [...new Set(connect.mock.contexts as Pool[])];
    const attributes = line.Attributes as Record<string, unknown>;
    expect(line.Body).toBe('mapping.status');
    expect(attributes['ownpace.tenant.id']).toBe(A);
    expect(line.Resource).toEqual({ 'service.name': 'ownpace-worker' });

    // The rows landed as A's, asked of the owner.
    const after = (await owner.execute(sql`
      SELECT (SELECT status FROM mailbox_mapping WHERE id = ${A_RETURNING}) AS status,
             (SELECT state FROM path_lifecycle WHERE mapping_id = ${A_RETURNING} AND domain = 'email') AS path,
             (SELECT count(*)::int FROM occupancy_peak WHERE tenant_id = ${A}) AS peaks,
             (SELECT count(*)::int FROM audit_log WHERE tenant_id = ${A} AND action = 'mapping.status') AS audits`)) as unknown as {
      rows: Array<{ status: string; path: string; peaks: number; audits: number }>;
    };
    expect(after.rows[0]).toEqual({ status: 'active', path: 'active', peaks: 1, audits: 1 });

    // And through the pass's own ledger, whose every statement is a scope.
    const mail = await buildDepsFromMapping(pools.tenant, A, A_MAIL);
    try {
      await mail.ledger.recordAuditEvent(asTenantId(A), {
        actor: 'system:auto-apply',
        action: 'relocation.applied',
        entity: 'item',
      });
    } finally {
      await mail.close();
    }
    const second = await theLine(2);
    expect(second.Body).toBe('relocation.applied');
    expect((second.Attributes as Record<string, unknown>)['ownpace.tenant.id']).toBe(A);

    // Read on the key's own pool, which is not app_user: app_user may not read
    // deployment_key (ledger 0062), and there the line is lost. One connection.
    expect(asked).toContain(pools.tenant);
    keyPools.push(...asked.filter((p) => p !== pools.tenant));
    expect(keyPools).toHaveLength(1);
    expect(keyPools[0]!.options.max).toBe(1);
    const key = await keyPools[0]!.query<{ role: string }>('SELECT current_user AS role');
    expect(key.rows[0]!.role).not.toBe('app_user');
  });

  it('writes the operator\'s log page on the application role, which may insert an event and read none', async () => {
    watchWarnings();
    await recordAppEvent({ level: 'error', event: 'task.row_security_check', reference: '0138a0e1', tenantId: A });

    expect(warnings.filter((w) => w.includes('[app-event]'))).toEqual([]);
    const events = (await owner.execute(
      sql`SELECT count(*)::int AS n FROM app_event WHERE reference = '0138a0e1' AND tenant_id = ${A}`,
    )) as unknown as { rows: Array<{ n: number }> };
    expect(events.rows[0]!.n).toBe(1);
  });

  it('spends the rate and byte budgets on a plain handle, their tables having no row security', async () => {
    await new PgRateBudget(plainDb(pools.tenant), { tenantId: A, requestsPerSecond: 50 }).acquire('dav', 'p-0138');
    const bytes = new PgByteBudget(plainDb(pools.tenant), { bytesPerDay: 1_000 });
    await bytes.spend(A, 'p-0138', 10);
    expect((await bytes.state(A, 'p-0138')).spentBytes).toBe(10);

    const rows = (await owner.execute(sql`
      SELECT (SELECT count(*)::int FROM rate_budget WHERE tenant_id = ${A} AND provider = 'p-0138') AS rate,
             (SELECT spent_bytes::int FROM byte_budget WHERE tenant_id = ${A} AND provider = 'p-0138') AS bytes`)) as unknown as {
      rows: Array<{ rate: number; bytes: number }>;
    };
    expect(rows.rows[0]).toEqual({ rate: 1, bytes: 10 });
  });

  it('opens and closes its run, marks its status and counts its first copy, inside its scope', async () => {
    const tenant = asTenantId(A);
    const mapping = asMappingId(A_MAIL);
    const runId = await withTenant(pools.tenant, A, (db) =>
      new RunStore(db).startRun({ tenantId: tenant, mappingId: mapping, kind: 'incremental', trigger: 'schedule' }),
    );
    await withTenant(pools.tenant, A, async (db) => {
      await new RunStore(db).logEvent(tenant, runId, 'info', 'a pass under row security', { domain: 'email' });
      const status = new PgMigrationStatusStore(db);
      await status.initDomainStatus(tenant, mapping, 'email');
      await status.markInProgress(tenant, mapping, 'email');
      await status.markCompleted(tenant, mapping, 'email');
      await new PgBytesMovedStore(db).add(tenant, 2_048);
      await new RunStore(db).finishRun(runId, 'succeeded', { itemsProcessed: 1 });
    });

    const rows = (await owner.execute(sql`
      SELECT (SELECT status FROM run WHERE id = ${runId} AND tenant_id = ${A}) AS run,
             (SELECT count(*)::int FROM run_event WHERE run_id = ${runId} AND tenant_id = ${A}) AS events,
             (SELECT state FROM migration_status WHERE tenant_id = ${A} AND mapping_id = ${A_MAIL} AND domain = 'email') AS status,
             (SELECT count(*)::int FROM bytes_moved WHERE tenant_id = ${A}) AS moved`)) as unknown as {
      rows: Array<{ run: string; events: number; status: string; moved: number }>;
    };
    expect(rows.rows[0]).toEqual({ run: 'succeeded', events: 1, status: 'completed', moved: 1 });
  });

  it('pages what a confirmation reads in its organisation\'s scope', async () => {
    const recorder = confirmationRecorder(pools.tenant, asTenantId(A));
    const seen: string[] = [];
    for await (const row of recorder.itemsToConfirm({
      tenantId: asTenantId(A),
      mappingId: asMappingId(A_CALENDARS),
      domain: 'calendar',
    })) {
      seen.push(row.naturalKeyHash);
    }
    expect(seen).toHaveLength(A_CALENDAR_ITEMS);
  });

  // Last, since it opens pools of its own, and they point this process's sinks.
  it('leaves a failed run\'s event on the log page before the pools the run opened are ended', async () => {
    watchWarnings();
    const referenceOf = (error: unknown) => /Reference ([0-9a-f]{8})\.$/.exec((error as Error).message)![1]!;
    const eventsWith = async (reference: string) =>
      (
        (await owner.execute(
          sql`SELECT count(*)::int AS n FROM app_event WHERE reference = ${reference} AND tenant_id = ${A}`,
        )) as unknown as { rows: Array<{ n: number }> }
      ).rows[0]!.n;
    const payload = { tenantId: A, mappingId: A_RETURNING };

    // The shape run-cutover and run-rollback had, first, so the case is not
    // vacuous: the pools ended in the run's own `finally`, before the wrapper
    // records the failure on the tenant pool, and the event is lost.
    const endedFirst = leavesAReference('run-rollback', async (_payload: unknown) => {
      const opened = openTaskPools(taskEnv(), { write: () => {} });
      try {
        throw new Error('the rollback failed');
      } finally {
        await opened.end();
      }
    });
    const lost = referenceOf(await endedFirst(payload, {}).catch((e: unknown) => e));
    expect(await eventsWith(lost)).toBe(0);
    expect(warnings.filter((w) => w.includes(`(ref ${lost}) could not be recorded`))).toHaveLength(1);

    // As they end them now: in `afterwards`, which the wrapper runs once the
    // event is written.
    let opened: TaskPools | undefined;
    const endedAfter = leavesAReference('run-rollback', async (_payload: unknown, _context: unknown, afterwards) => {
      opened = openTaskPools(taskEnv(), { write: () => {} });
      afterwards(() => opened!.end());
      throw new Error('the rollback failed');
    });
    const kept = referenceOf(await endedAfter(payload, {}).catch((e: unknown) => e));
    expect(await eventsWith(kept)).toBe(1);
    expect(opened!.tenant.ended).toBe(true);
  });
});
