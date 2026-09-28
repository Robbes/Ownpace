// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A JOB THAT READS EACH ORGANISATION AS ITSELF (workplan 0138 T2).
 *
 * Three scheduled jobs ask one question across organisations and then read
 * and write each organisation's own rows: the digest (08:00), the drift
 * detector (07:00) and group discovery (06:30). Until T2 each did all of it on
 * the owner's pool, `DATABASE_URL`, a superuser on the managed stack, whom
 * row security never binds, so what kept one organisation's rows from
 * another's there was each query's own `WHERE`. The owner answered open
 * question 3 on 2026-09-28, *"split them"*: the list of active organisations
 * comes from a connection that sees every organisation (`activeOrganisations`,
 * `task-pools.ts`; the owner's until 0138 T3 step 2, the system role's since),
 * and everything read or written for one organisation goes through its scope
 * on the tenant pool `openTaskPools` builds, `app_user`, as a per-tenant pass
 * does since T1.
 *
 * This seeds three organisations as the owner (A and B active, C closed),
 * opens the pools the jobs open, and asserts:
 *
 *   1. the list: A and B, never C, read on a connection that sees every
 *      organisation; on `app_user` it refuses, because there, with no
 *      organisation set, `tenant` answers no row and every split job would
 *      visit nobody and report a quiet morning.
 *   2. each job's per-organisation half, run on those pools, produces what it
 *      produced on the owner's: A's digest names A's migration and goes to
 *      A's owner, B's names B's, and each says every one of its
 *      organisation's queues, each with a number the other organisation does
 *      not have (pending decisions, deletions, moves, failures, relocations
 *      applied since its own last digest, open sharing rows, the data types
 *      whose grace period ended); the drift detector raises
 *      A's new mailbox in A, honours A's dismissal and A's standing preset, and
 *      raises B's in B; group discovery records A's groups in A, asks A's
 *      question, states A's IMAP blind spot, and records B's in B. Each runs as
 *      `app_user`, asks no pool but the tenant pool and the audit key's for a
 *      connection, and holds one connection at a time (PgBouncer's
 *      `default_pool_size`, 0138 Status).
 *   3. fail closed: the jobs' own statements, run on the same pool outside a
 *      scope, find nothing. So a per-organisation read left outside
 *      `withTenant` does not read another organisation's rows: it reads none,
 *      and the second assertion is what turns red (the mutations in 0138's
 *      Status, T2's entry, move one read at a time and show it).
 *
 * WHY EVERY QUEUE IS SEEDED, AND DIFFERENTLY PER ORGANISATION (0138 T2's
 * review). A read made in a scope that is not its organisation's own finds
 * nothing, so it reports a zero; a queue seeded empty expects a zero, and the
 * wrong scope passes. This seeded failures and decisions alone, and review
 * moved four of the digest's reads (deletions, moves, the relocations applied,
 * the sharing checklist) into the scope of the mapping's id, which is no
 * organisation: every guard green, and in production every organisation's
 * digest would have said none of those, with nothing to say so. So each queue
 * the digest counts is seeded here, A's numbers differing from B's, with rows
 * that must NOT count beside the ones that must (an acknowledged deletion and
 * move, a decided sharing row, a relocation from before the last digest), and
 * each organisation's mail is compared line for line. The last digest each
 * organisation was sent lies between two of its relocations, so a window read
 * in the wrong scope (the cadence-sized fallback) counts one too many.
 *
 * Handed its database (`an-integration-test-is-handed-its-database`): it reads
 * `TEST_DATABASE_URL`, derives `app_user`'s URL from it as
 * `a-pass-under-row-security` does, and the system role's (the owner's
 * connection with its role set to `ownpace_system` at the start, 0138 T3
 * step 2), hands `openTaskPools` and `activeOrganisations` an environment of
 * its own built from the two, and never reads or sets `DATABASE_URL`. The directory and the groups a source
 * lists are answered here, not asked of Microsoft; the addresses are invented
 * and nothing is contacted.
 *
 * UUID family: 0138e000-e29b-41d4-a716-44665544xxxx.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { createPgDb, withTenant } from '@openmig/ledger';
import {
  exportAuditEvent,
  log,
  setAppEventSink,
  setAuditExportSink,
  type DirectoryListing,
  type GroupListing,
  type NotificationMessage,
} from '@openmig/shared';
import { listImapGroups } from '@openmig/connectors';
import { activeOrganisations, openTaskPools, type TaskPools } from './task-pools.ts';
import { runDigest } from './managed-digest-run.ts';
import { digestLedgerOn, digestMappingsSql, digestOrganisationSql, digestRecipientsSql } from './managed-digest.ts';
import { coverageSql, driftOfOrganisation, microsoftSourcesSql } from './managed-drift-detect.ts';
import { groupsOfOrganisation, sourcesSql } from './managed-group-discovery.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

/** The role the split jobs read each organisation as. */
function asAppUser(url: string): string {
  const parsed = new URL(url);
  parsed.username = 'app_user';
  parsed.password = 'app_password';
  return parsed.toString();
}

/**
 * The system role, which the list and the audit key are read as since 0138 T3
 * step 2: the owner's connection with its role set at the start to
 * `ownpace_system`, so every statement runs as that role and nothing needs its
 * password, which only `a-system-role-that-is-not-the-owner` sets.
 */
function asSystemRole(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('options', '-c role=ownpace_system');
  return parsed.toString();
}

/** The two URLs a run receives (set-task-env.sh), for this database. */
const taskEnv = () => ({ APP_DATABASE_URL: asAppUser(PG_CONNECTION_STRING), SYSTEM_DATABASE_URL: asSystemRole(PG_CONNECTION_STRING) });

const P = '0138e000-e29b-41d4-a716-4466554400';
const A = `${P}a1`;
const B = `${P}b1`;
const C = `${P}c1`;
const A_GRAPH = `${P}11`;
const A_IMAP = `${P}12`;
const A_TARGET = `${P}13`;
const B_GRAPH = `${P}21`;
const B_TARGET = `${P}23`;
const A_BOX = `${P}31`;
const A_TARGET_BOX = `${P}32`;
const B_BOX = `${P}41`;
const B_TARGET_BOX = `${P}42`;
const A_MAPPING = `${P}51`;
const B_MAPPING = `${P}61`;
const A_NAME = 'Pat to the new place';
const B_NAME = 'Sam to the new place';

let owner: ReturnType<typeof createPgDb>;

const rowsOf = <R>(result: unknown): R[] => (result as { rows: R[] }).rows;

/** The digest's words for two of its lines, as the mail writes them in English. */
const AUTO_APPLIED = 'old copies of moved or renamed files removed automatically (auto-apply — each is recorded)';
const GRACE_ENDED =
  'grace period over and nobody chose, so no longer copying (end each, or keep it copying, on the Finish page):';

/** What a digest says of one migration: the lines under its heading, each without its dash. */
function linesUnder(body: string, name: string): string[] {
  const lines = body.split('\n');
  const heading = lines.indexOf(`Migration: ${name}`);
  expect(heading, `the mail has a heading for ${name}:\n${body}`).toBeGreaterThanOrEqual(0);
  const end = lines.indexOf('', heading);
  return lines.slice(heading + 1, end === -1 ? undefined : end).map((line) => line.replace(/^ {2}- /, ''));
}

/** A statement the job builds, as text and parameters, for a pool that is handed it bare. */
const asText = (query: SQL) => new PgDialect().sqlToQuery(query);

beforeAll(async () => {
  owner = createPgDb(PG_CONNECTION_STRING);
  const daily = JSON.stringify({ notifications: { digest: 'daily', locale: 'en' } });
  await owner.execute(sql`
    INSERT INTO tenant (id, name, status, settings) VALUES
      (${A}, 'A Reads As Itself', 'active', ${daily}::jsonb),
      (${B}, 'B Reads As Itself', 'active', ${daily}::jsonb),
      (${C}, 'C Was Closed', 'closed', ${daily}::jsonb)
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, settings = EXCLUDED.settings`);
  await owner.execute(sql`
    INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES
      (${A}, 'user-0138e-a-owner', 'owner@a.example.invalid', 'owner', 'active'),
      (${A}, 'user-0138e-a-viewer', 'viewer@a.example.invalid', 'viewer', 'active'),
      (${B}, 'user-0138e-b-owner', 'owner@b.example.invalid', 'owner', 'active'),
      (${C}, 'user-0138e-c-owner', 'owner@c.example.invalid', 'owner', 'active')
    ON CONFLICT DO NOTHING`);
  await owner.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
      (${A_GRAPH}, ${A}, 'source', 'o365', 'mail', ${JSON.stringify({ type: 'o365', tenantId: 'a-graph-tenant' })}::jsonb, 'connected'),
      (${A_IMAP}, ${A}, 'source', 'imap', 'old mail', ${JSON.stringify({ type: 'imap' })}::jsonb, 'connected'),
      (${A_TARGET}, ${A}, 'target', 'jmap', 'target', ${JSON.stringify({ type: 'jmap' })}::jsonb, 'connected'),
      (${B_GRAPH}, ${B}, 'source', 'o365', 'mail', ${JSON.stringify({ type: 'o365', tenantId: 'b-graph-tenant' })}::jsonb, 'connected'),
      (${B_TARGET}, ${B}, 'target', 'jmap', 'target', ${JSON.stringify({ type: 'jmap' })}::jsonb, 'connected')
    ON CONFLICT (id) DO NOTHING`);
  await owner.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
      (${A_BOX}, ${A}, ${A_GRAPH}, 'user', 'pat@a.example.invalid'),
      (${A_TARGET_BOX}, ${A}, ${A_TARGET}, 'user', 'pat@target.example.invalid'),
      (${B_BOX}, ${B}, ${B_GRAPH}, 'user', 'sam@b.example.invalid'),
      (${B_TARGET_BOX}, ${B}, ${B_TARGET}, 'user', 'sam@target.example.invalid')
    ON CONFLICT (id) DO NOTHING`);
  // Both in their cutover, so each migration's grace period can have ended.
  await owner.execute(sql`
    INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, name, mode, status) VALUES
      (${A_MAPPING}, ${A}, ${A_BOX}, ${A_TARGET_BOX}, ${A_NAME}, 'mirror', 'cutover'),
      (${B_MAPPING}, ${B}, ${B_BOX}, ${B_TARGET_BOX}, ${B_NAME}, 'mirror', 'cutover')
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`);
  // What the digest counts, every queue of it, A's numbers never B's (see
  // the header): failures past their retries (MAX_ITEM_ATTEMPTS), A 2 and B 1;
  // deletions the source reported and nobody acknowledged, A 3 and B 1, beside
  // one of A's acknowledged; moves nobody acknowledged, A 1 and B 2, beside one
  // of A's acknowledged.
  await owner.execute(sql`DELETE FROM item WHERE tenant_id IN (${A}, ${B})`);
  await owner.execute(sql`
    INSERT INTO item (tenant_id, mapping_id, domain, item_type, collection, natural_key, natural_key_hash, status, attempt_count, last_error) VALUES
      (${A}, ${A_MAPPING}, 'email', 'mail', 'INBOX', 'a-1', 'h-0138e-a-1', 'failed', 5, 'refused'),
      (${A}, ${A_MAPPING}, 'email', 'mail', 'INBOX', 'a-2', 'h-0138e-a-2', 'failed', 5, 'refused'),
      (${B}, ${B_MAPPING}, 'email', 'mail', 'INBOX', 'b-1', 'h-0138e-b-1', 'failed', 5, 'refused')`);
  await owner.execute(sql`
    INSERT INTO item (tenant_id, mapping_id, domain, item_type, collection, natural_key, natural_key_hash, status,
                      deletion_reported_at, deletion_acknowledged_at) VALUES
      (${A}, ${A_MAPPING}, 'email', 'mail', 'INBOX', 'a-del-1', 'h-0138e-a-del-1', 'copied', now(), NULL),
      (${A}, ${A_MAPPING}, 'email', 'mail', 'INBOX', 'a-del-2', 'h-0138e-a-del-2', 'copied', now(), NULL),
      (${A}, ${A_MAPPING}, 'email', 'mail', 'INBOX', 'a-del-3', 'h-0138e-a-del-3', 'copied', now(), NULL),
      (${A}, ${A_MAPPING}, 'email', 'mail', 'INBOX', 'a-del-4', 'h-0138e-a-del-4', 'copied', now(), now()),
      (${B}, ${B_MAPPING}, 'email', 'mail', 'INBOX', 'b-del-1', 'h-0138e-b-del-1', 'copied', now(), NULL)`);
  await owner.execute(sql`
    INSERT INTO item (tenant_id, mapping_id, domain, item_type, collection, natural_key, natural_key_hash, status,
                      moved_to_collection, move_acknowledged_at) VALUES
      (${A}, ${A_MAPPING}, 'email', 'mail', 'INBOX', 'a-mv-1', 'h-0138e-a-mv-1', 'copied', 'Archive', NULL),
      (${A}, ${A_MAPPING}, 'email', 'mail', 'INBOX', 'a-mv-2', 'h-0138e-a-mv-2', 'copied', 'Archive', now()),
      (${B}, ${B_MAPPING}, 'email', 'mail', 'INBOX', 'b-mv-1', 'h-0138e-b-mv-1', 'copied', 'Archive', NULL),
      (${B}, ${B_MAPPING}, 'email', 'mail', 'INBOX', 'b-mv-2', 'h-0138e-b-mv-2', 'copied', 'Archive', NULL)`);
  // Relocations applied by themselves, and each organisation's last digest
  // between two of them: A's two hours ago, with one relocation before it and
  // two after; B's five hours ago, with one before and one after. Read in the
  // wrong scope, the last digest is none, the window falls back to a day, and
  // each counts one more.
  await owner.execute(sql`DELETE FROM audit_log WHERE tenant_id IN (${A}, ${B})`);
  const relocation = (mapping: string) => JSON.stringify({ mappingId: mapping });
  await owner.execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, detail, at) VALUES
      (${A}, 'system:digest', 'digest_sent_daily', NULL, now() - interval '2 hours'),
      (${A}, 'system:auto-apply', 'auto_apply_relocation', ${relocation(A_MAPPING)}::jsonb, now() - interval '3 hours'),
      (${A}, 'system:auto-apply', 'auto_apply_relocation', ${relocation(A_MAPPING)}::jsonb, now() - interval '1 hour'),
      (${A}, 'system:auto-apply', 'auto_apply_relocation', ${relocation(A_MAPPING)}::jsonb, now() - interval '30 minutes'),
      (${B}, 'system:digest', 'digest_sent_daily', NULL, now() - interval '5 hours'),
      (${B}, 'system:auto-apply', 'auto_apply_relocation', ${relocation(B_MAPPING)}::jsonb, now() - interval '6 hours'),
      (${B}, 'system:auto-apply', 'auto_apply_relocation', ${relocation(B_MAPPING)}::jsonb, now() - interval '4 hours')`);
  // The sharing checklist: A one row open beside one decided, B three open.
  await owner.execute(sql`DELETE FROM share_grant WHERE tenant_id IN (${A}, ${B})`);
  await owner.execute(sql`
    INSERT INTO share_grant (tenant_id, mapping_id, grant_hash, subject, on_label, role, raw, verdict, verdict_target, state, decided_at) VALUES
      (${A}, ${A_MAPPING}, 'g-0138e-a-1', 'pat', 'Budget.xlsx', 'reader', 'raw', 'clean', 'target', 'open', NULL),
      (${A}, ${A_MAPPING}, 'g-0138e-a-2', 'pat', 'Plan.docx', 'reader', 'raw', 'clean', 'target', 'applied', now()),
      (${B}, ${B_MAPPING}, 'g-0138e-b-1', 'sam', 'Notes.txt', 'reader', 'raw', 'clean', 'target', 'open', NULL),
      (${B}, ${B_MAPPING}, 'g-0138e-b-2', 'sam', 'Roster.ods', 'writer', 'raw', 'manual', 'target', 'open', NULL),
      (${B}, ${B_MAPPING}, 'g-0138e-b-3', 'sam', 'Photos', 'reader', 'raw', 'clean', 'target', 'open', NULL)`);
  // Grace periods over with nobody choosing: A carries email and calendar, B
  // email alone, and each migration's cutover finished yesterday.
  await owner.execute(sql`DELETE FROM scope_selection WHERE tenant_id IN (${A}, ${B})`);
  await owner.execute(sql`
    INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES
      (${A}, ${A_MAPPING}, 'email', true),
      (${A}, ${A_MAPPING}, 'calendar', true),
      (${B}, ${B_MAPPING}, 'email', true)`);
  await owner.execute(sql`DELETE FROM cutover_state WHERE tenant_id IN (${A}, ${B})`);
  await owner.execute(sql`
    INSERT INTO cutover_state (tenant_id, mapping_id, state, phase, grace_period_started_at, grace_period_completed_at) VALUES
      (${A}, ${A_MAPPING}, 'COMPLETED', 'completion', now() - interval '4 days', now() - interval '1 day'),
      (${B}, ${B_MAPPING}, 'COMPLETED', 'completion', now() - interval '4 days', now() - interval '1 day')`);
  // Decisions waiting, A 1 and B 2, and one A dismissed, for the drift detector.
  await owner.execute(sql`DELETE FROM decision WHERE tenant_id IN (${A}, ${B})`);
  await owner.execute(sql`
    INSERT INTO decision (tenant_id, category, subject_key, summary, status) VALUES
      (${A}, 'other', 'a-waiting', 'A has a question', 'pending'),
      (${B}, 'other', 'b-waiting-1', 'B has a question', 'pending'),
      (${B}, 'other', 'b-waiting-2', 'B has another', 'pending'),
      (${A}, 'new_mailbox', 'gone@a.example.invalid', 'A said no to this one', 'dismissed')`);
  // A answers a new mailbox by itself; B asks.
  await owner.execute(sql`DELETE FROM policy_preset WHERE tenant_id IN (${A}, ${B})`);
  await owner.execute(sql`INSERT INTO policy_preset (tenant_id, category, action) VALUES (${A}, 'new_mailbox', 'auto')`);
  await owner.execute(sql`DELETE FROM group_def WHERE tenant_id IN (${A}, ${B})`);
});

afterAll(async () => {
  for (const table of [
    'app_event',
    'audit_log',
    'group_def',
    'decision',
    'policy_preset',
    'share_grant',
    'scope_selection',
    'cutover_state',
    'item',
    'mailbox_mapping',
    'mailbox',
    'connection',
    'tenant_member',
  ]) {
    await owner?.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id IN (${A}, ${B}, ${C})`);
  }
  await owner?.execute(sql`DELETE FROM tenant WHERE id IN (${A}, ${B}, ${C})`);
  await owner?.close();
});

afterEach(() => {
  vi.restoreAllMocks();
  setAuditExportSink(undefined);
  setAppEventSink(undefined);
});

/** The pools a job's run opens, and the audit key's, which the sink holds and the job is never handed. */
interface JobsPools extends TaskPools {
  readonly key: Pool;
}

/**
 * A job's pools, fresh, as its run opens them, and every pool asked for a
 * connection while `work` runs. The key's pool is found first, the way the
 * sink finds it: an audit line is written before the work, and the pool the
 * sink asks for its key is the key's (`openTaskPools` hands a job the tenant
 * pool alone). Its key is then kept, so the work's own lines ask nothing more.
 */
async function onTheJobsPools<T>(
  work: (pools: TaskPools) => Promise<T>,
): Promise<{ result: T; pools: JobsPools; asked: Pool[]; lines: string[] }> {
  const lines: string[] = [];
  const opened = openTaskPools(taskEnv(), { write: (line) => lines.push(line) });
  const connect = vi.spyOn(Pool.prototype, 'connect');
  try {
    exportAuditEvent({
      id: '0138e000-e29b-41d4-a716-446655440fff',
      at: '2026-09-28T06:00:00.000000Z',
      tenantId: A,
      actor: 'system:probe',
      action: 'probe.the_key_pool',
    });
    await vi.waitFor(() => expect(lines).toHaveLength(1), { timeout: 15_000, interval: 50 });
    const keyPools = [...new Set(connect.mock.contexts as Pool[])];
    expect(keyPools, "the audit line asked one pool, the key's").toHaveLength(1);
    const pools: JobsPools = { ...opened, key: keyPools[0]! };
    connect.mockClear();
    lines.splice(0);

    const result = await work(opened);
    const asked = [...new Set(connect.mock.contexts as Pool[])];
    return { result, pools, asked, lines };
  } finally {
    connect.mockRestore();
  }
}

/** It ran as app_user, on the tenant pool, one connection at a time; no other pool but the key's was asked. */
async function ranAsTheApplicationRole(pools: JobsPools, asked: readonly Pool[]): Promise<void> {
  const who = await pools.tenant.query<{ role: string; superuser: string }>(
    "SELECT current_user AS role, current_setting('is_superuser') AS superuser",
  );
  expect(who.rows[0]).toEqual({ role: 'app_user', superuser: 'off' });
  // And the key's, which reads deployment_key alone, the system role's: no
  // superuser since 0138 T3 step 2.
  const key = await pools.key.query<{ role: string; superuser: string }>(
    "SELECT current_user AS role, current_setting('is_superuser') AS superuser",
  );
  expect(key.rows[0]).toEqual({ role: 'ownpace_system', superuser: 'off' });
  expect(asked).toContain(pools.tenant);
  expect(
    asked.filter((p) => p !== pools.tenant && p !== pools.key),
    "a pool other than the tenant pool and the audit key's was asked for a connection",
  ).toEqual([]);
  // Sequential: a split job holds one of app_user's server connections at a time.
  expect(pools.tenant.totalCount).toBeLessThanOrEqual(1);
  await pools.end();
}

describe('the list: which organisations are active, on a connection that sees them all', () => {
  it('names A and B and not the closed C, on the system role\'s connection', async () => {
    const listed = await activeOrganisations(taskEnv());
    expect(listed).toContain(A);
    expect(listed).toContain(B);
    expect(listed).not.toContain(C);
  });

  it('refuses on app_user, where with no organisation set it would find none', async () => {
    // Why it must: the same statement on app_user, no scope, answers no row,
    // and a split job handed that list would visit nobody and say so as
    // "nothing to do".
    const app = new Pool({ connectionString: asAppUser(PG_CONNECTION_STRING), max: 1 });
    try {
      const bare = await app.query("SELECT id FROM tenant WHERE status = 'active'");
      expect(bare.rows).toEqual([]);
    } finally {
      await app.end();
    }
    const appUser = asAppUser(PG_CONNECTION_STRING);
    await expect(activeOrganisations({ APP_DATABASE_URL: appUser, SYSTEM_DATABASE_URL: appUser })).rejects.toThrow(
      /row security/,
    );
  });
});

describe("the digest writes each organisation its own, read in that organisation's scope", () => {
  it('sends A its migration and every one of its queues, and B its own, as app_user', async () => {
    const listed = (await activeOrganisations(taskEnv())).filter((id) => id === A || id === B);
    const sent: Array<{ to: readonly string[]; message: NotificationMessage }> = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    const { result, pools, asked, lines } = await onTheJobsPools((pools) =>
      runDigest({
        weekday: 3,
        ...digestLedgerOn(pools.tenant, async () => listed),
        send: async (to, _locale, message) => void sent.push({ to, message }),
        warn: (m) => warnings.push(m),
        error: (m) => errors.push(m),
      }),
    );

    expect({ warnings, errors }).toEqual({ warnings: [], errors: [] });
    expect(result).toMatchObject({ tenants: 2, sent: 2, failed: 0, noRecipients: 0 });
    const toA = sent.find((s) => s.to.includes('owner@a.example.invalid'))!;
    const toB = sent.find((s) => s.to.includes('owner@b.example.invalid'))!;
    // Owners and admins only; the viewer is not told.
    expect(toA.to).toEqual(['owner@a.example.invalid']);
    expect(toB.to).toEqual(['owner@b.example.invalid']);
    // A's migration by the name A gave it, and every queue of A's, line for
    // line, each number A's and not B's (the seed); B's the same. A read in a
    // scope not its organisation's own finds nothing: its line would be gone,
    // or, for the window, one more relocation counted.
    expect(toA.message.body).not.toContain(B_NAME);
    expect(toB.message.body).not.toContain(A_NAME);
    expect(linesUnder(toA.message.body, A_NAME)).toEqual([
      '1 changes needing a decision',
      '3 deletions to confirm',
      '1 moves to acknowledge',
      '2 items that could not be copied',
      'checked and ready to finish',
      `2 ${AUTO_APPLIED}`,
      '1 rows open on the sharing checklist',
      `${GRACE_ENDED} Email, Calendar`,
    ]);
    expect(linesUnder(toB.message.body, B_NAME)).toEqual([
      '2 changes needing a decision',
      '1 deletions to confirm',
      '2 moves to acknowledge',
      '1 items that could not be copied',
      'checked and ready to finish',
      `1 ${AUTO_APPLIED}`,
      '3 rows open on the sharing checklist',
      `${GRACE_ENDED} Email`,
    ]);
    // A queue it could not read would be named in the mail: none was.
    for (const { message } of sent) expect(message.body).not.toContain('COULD NOT BE READ');

    // Each send recorded in its own organisation, and its audit line printed,
    // the key read on the key's own pool.
    const recorded = rowsOf<{ tenant_id: string }>(
      await owner.execute(
        // This morning's, not the two seeded hours before.
        sql`SELECT tenant_id FROM audit_log
             WHERE tenant_id IN (${A}, ${B}) AND action = 'digest_sent_daily' AND at > now() - interval '1 hour'
             ORDER BY tenant_id`,
      ),
    );
    expect(recorded.map((r) => r.tenant_id)).toEqual([A, B]);
    await vi.waitFor(() => expect(lines).toHaveLength(2), { timeout: 15_000, interval: 50 });
    expect(lines.map((l) => (JSON.parse(l) as { Attributes: Record<string, unknown> }).Attributes['ownpace.tenant.id']).sort()).toEqual(
      [A, B],
    );

    await ranAsTheApplicationRole(pools, asked);
  });
});

describe("the drift detector compares each organisation's directory with what it migrates, in its scope", () => {
  /** Each Graph tenant's directory, as the source would list it. */
  const DIRECTORY: Record<string, readonly string[]> = {
    'a-graph-tenant': ['pat@a.example.invalid', 'new@a.example.invalid', 'gone@a.example.invalid'],
    'b-graph-tenant': ['sam@b.example.invalid', 'new@b.example.invalid'],
  };
  const seen: unknown[] = [];
  const listDirectory = async (source: { kind: string; config: unknown } | undefined): Promise<DirectoryListing> => {
    seen.push(source);
    const graph = (source?.config as { tenantId?: string } | undefined)?.tenantId;
    return graph && DIRECTORY[graph]
      ? { kind: 'listed', addresses: DIRECTORY[graph] }
      : { kind: 'not_enumerable', reason: 'no Microsoft 365 source connection' };
  };

  it("raises A's new mailbox in A, honouring A's dismissal and A's standing answer, and B's in B, as app_user", async () => {
    const raised: string[] = [];
    const edges = {
      listDirectory,
      onRaised: async (input: { tenantId: string; subjectKey: string }) => void raised.push(`${input.tenantId} ${input.subjectKey}`),
      warn: (m: string) => raised.push(`warn ${m}`),
      error: (m: string) => raised.push(`error ${m}`),
    };

    const { result, pools, asked } = await onTheJobsPools(async (pools) => ({
      a: await driftOfOrganisation(pools.tenant, A, edges),
      b: await driftOfOrganisation(pools.tenant, B, edges),
    }));

    // A: new@ noticed and closed by A's standing answer, so nobody is told;
    // gone@ not asked again (A dismissed it); pat@ covered by A's migration.
    // B: new@ raised, waiting, and announced. Nothing warned or failed.
    expect(result.a).toMatchObject({ raised: 0, autoResolved: 1, alreadyPending: 0, failed: 0 });
    expect(result.b).toMatchObject({ raised: 1, autoResolved: 0, alreadyPending: 0, failed: 0 });
    expect(raised).toEqual([`${B} new@b.example.invalid`]);
    // Each source handed to the directory is the organisation's own.
    expect(seen.map((s) => (s as { config: { tenantId: string } }).config.tenantId)).toEqual([
      'a-graph-tenant',
      'b-graph-tenant',
    ]);
    const decisions = rowsOf<{ tenant_id: string; subject_key: string; status: string }>(
      await owner.execute(sql`
        SELECT tenant_id, subject_key, status FROM decision
         WHERE tenant_id IN (${A}, ${B}) AND category = 'new_mailbox' ORDER BY tenant_id, subject_key`),
    );
    expect(decisions).toEqual([
      { tenant_id: A, subject_key: 'gone@a.example.invalid', status: 'dismissed' },
      { tenant_id: A, subject_key: 'new@a.example.invalid', status: 'auto_resolved' },
      { tenant_id: B, subject_key: 'new@b.example.invalid', status: 'pending' },
    ]);

    await ranAsTheApplicationRole(pools, asked);
  });
});

describe("group discovery records each organisation's groups in its scope", () => {
  /** Each Graph tenant's groups; IMAP has none to list. */
  const listGroups = async (source: { kind: string; config: unknown }): Promise<GroupListing> => {
    if (source.kind === 'imap') return listImapGroups();
    const graph = (source.config as { tenantId?: string }).tenantId;
    const members = (address: string) => ({ kind: 'listed' as const, addresses: [address] });
    return graph === 'a-graph-tenant'
      ? {
          kind: 'listed',
          groups: [
            { id: 'g-a-1', address: 'info@a.example.invalid', store: 'unknown', members: members('pat@a.example.invalid') },
            { id: 'g-a-2', address: 'all@a.example.invalid', store: 'no_store', members: members('pat@a.example.invalid') },
          ],
        }
      : {
          kind: 'listed',
          groups: [{ id: 'g-b-1', address: 'info@b.example.invalid', store: 'has_store', members: members('sam@b.example.invalid') }],
        };
  };

  it("records A's two groups and asks A's question in A, states A's IMAP blind spot, and records B's in B, as app_user", async () => {
    const said: string[] = [];
    const edges = {
      listGroups,
      onRaised: async (input: { tenantId: string; subjectKey: string }) => void said.push(`asked ${input.tenantId} ${input.subjectKey}`),
      warn: (m: string) => said.push(`warn ${m}`),
      error: (m: string) => said.push(`error ${m}`),
    };
    const { result, pools, asked } = await onTheJobsPools(async (pools) => ({
      a: await groupsOfOrganisation(pools.tenant, A, edges),
      b: await groupsOfOrganisation(pools.tenant, B, edges),
    }));

    expect(result.a).toMatchObject({ sources: 2, discovered: 2, known: 0, unclassified: 1, asked: 1, blindSpots: 1 });
    expect(result.b).toMatchObject({ sources: 1, discovered: 1, known: 0, unclassified: 0, asked: 0, blindSpots: 0 });
    expect(said.filter((s) => s.startsWith('error'))).toEqual([]);
    expect(said).toContain(`asked ${A} info@a.example.invalid`);
    expect(said.some((s) => s.startsWith('warn') && s.includes(A) && s.includes('IMAP'))).toBe(true);
    const groups = rowsOf<{ tenant_id: string; address: string; source_connection_id: string; pattern: string | null }>(
      await owner.execute(sql`
        SELECT tenant_id, address, source_connection_id, pattern FROM group_def
         WHERE tenant_id IN (${A}, ${B}) ORDER BY tenant_id, address`),
    );
    expect(groups).toEqual([
      { tenant_id: A, address: 'all@a.example.invalid', source_connection_id: A_GRAPH, pattern: 'distribution_d' },
      { tenant_id: A, address: 'info@a.example.invalid', source_connection_id: A_GRAPH, pattern: null },
      { tenant_id: B, address: 'info@b.example.invalid', source_connection_id: B_GRAPH, pattern: 'shared_s' },
    ]);

    await ranAsTheApplicationRole(pools, asked);
  });

  it('converges: a second run finds the same groups known, and asks nothing again', async () => {
    const edges = { listGroups, onRaised: async () => {}, warn: () => {}, error: (m: string) => log.error(m) };
    const { result, pools, asked } = await onTheJobsPools((pools) => groupsOfOrganisation(pools.tenant, A, edges));
    expect(result).toMatchObject({ sources: 2, discovered: 0, known: 2, asked: 0 });
    await ranAsTheApplicationRole(pools, asked);
  });
});

describe('fail closed: the same statements outside a scope find nothing', () => {
  it('each per-organisation read the three jobs make answers A\'s rows in A\'s scope, and none outside one', async () => {
    const app = new Pool({ connectionString: asAppUser(PG_CONNECTION_STRING), max: 1 });
    try {
      for (const [what, query] of [
        ['the digest\'s organisation row', digestOrganisationSql(A)],
        ['the digest\'s recipients', digestRecipientsSql(A)],
        ['the digest\'s migrations', digestMappingsSql(A)],
        ['the drift detector\'s coverage', coverageSql(A)],
        ['the drift detector\'s Microsoft sources', microsoftSourcesSql(A)],
        ['group discovery\'s sources', sourcesSql(A)],
      ] as const) {
        // In A's scope, on app_user, the rows are there.
        const inScope = await withTenant(app, A, async (db) => rowsOf<unknown>(await db.execute(query)));
        expect(inScope.length, `${what}, in A's scope`).toBeGreaterThan(0);
        // In B's scope, the same statement for A finds nothing of A's.
        const inB = await withTenant(app, B, async (db) => rowsOf<unknown>(await db.execute(query)));
        expect(inB, `${what}, asked for A in B's scope`).toEqual([]);
        // Outside any scope it finds nothing: no rows, or, on a table whose
        // policy casts the setting plainly, a refusal once the connection has
        // held a scope (docs/rls-guide.md, "Policies"). Never A's rows.
        const { sql: text, params } = asText(query);
        const bare = await app.query(text, params).then(
          (r) => r.rows,
          (e: unknown) => {
            expect(String(e)).toMatch(/invalid input syntax for type uuid: ""/);
            return [];
          },
        );
        expect(bare, `${what}, outside a scope`).toEqual([]);
      }
    } finally {
      await app.end();
    }
  });
});
