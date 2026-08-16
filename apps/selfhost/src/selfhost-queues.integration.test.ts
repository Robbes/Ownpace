// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The appliance's queues, against a real ledger (workplan 0030 T3's recorded
 * gap, closed).
 *
 * Every appliance test so far runs on PGlite, whose SINGLE connection means a
 * test cannot seed rows around the running server — so the queue endpoints
 * have only ever been proven empty, and the claim that the digest "counts
 * what the screens count" rested on both paths calling `summariseQueues` and
 * on reading the endpoint code. Postgres has no such limit: this boots the
 * appliance against the Testcontainers database, seeds real rows beside it,
 * and holds the two to each other.
 *
 * The property under test is not "the SQL works" — the ledger's own suite
 * owns that. It is that **the number in the email and the number on the page
 * are the same number**. A digest that says four things are waiting, pointing
 * at a queue that shows three, sends the owner hunting for an item that does
 * not exist, and the next digest they get goes unread.
 *
 * UUID namespace 5e1f for this file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { createPgDb, PgLedger, PgDecisionStore } from '@openmig/ledger';
import { asTenantId, asMappingId, MAX_ITEM_ATTEMPTS, wantsAttention } from '@openmig/shared';
import { start, type SelfhostHandle } from './index';
import { uuidFromString } from './config-dir';
import { collectAttention } from './digest-collect';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

/**
 * This test gets its OWN database, for the same reason `migrate.integration`
 * does: the shared test database is prepared by the global setup, which
 * executes the migration files directly and never records them in
 * `schema_migrations`. The appliance migrates itself at startup (that IS the
 * appliance's contract — it owns its database and brings it up to date), so
 * pointed at the shared one it would find no recorded versions, re-apply
 * `0001_baseline.sql` onto a schema that already exists, and fail on
 * `relation "audit_log" already exists`.
 *
 * A fresh database is also the truer test: this is what an appliance actually
 * boots against.
 */
const DB_NAME = `selfhost_queues_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const dbUrl = new URL(ADMIN_URL);
dbUrl.pathname = `/${DB_NAME}`;
const PG_CONNECTION_STRING = dbUrl.toString();

const TENANT_ID = '5e1f0000-e29b-41d4-a716-446655440001';
const MAPPING_ID = '5e1f0000-e29b-41d4-a716-446655440002';

// The appliance derives its ledger mapping id from the config deterministically
// — imported rather than reimplemented, so this test cannot drift from the id
// the appliance will actually choose.
const LEDGER_MAPPING_ID = uuidFromString(`${TENANT_ID}:mapping:${MAPPING_ID}`);

let handle: SelfhostHandle;
let pool: Pool;
let base: string;
// One db for the whole file: `createPgDb` opens a pool, and opening a fresh
// one per assertion would leave connections behind for the rest of the
// integration suite to run out of.
let ledger: PgLedger;
let decisions: PgDecisionStore;
/** Kept so it can be CLOSED before the database is dropped — see afterAll. */
let db: ReturnType<typeof createPgDb>;

/** The queue envelopes, as far as this test reads them. */
interface QueueBody {
  readonly [mappingId: string]: {
    readonly confirmed?: { naturalKeyHash: string; acknowledgedAt?: string }[];
    readonly open?: { to: string; toNaturalKeyHash?: string }[];
    readonly acknowledged?: unknown[];
    readonly needsDecision?: { lastError: string }[];
    readonly retrying?: unknown[];
  };
}

const getQueue = async (path: string): Promise<QueueBody> =>
  (await (await fetch(`${base}${path}`)).json()) as QueueBody;

/** Seed one item row in whatever state the queue under test needs. */
async function seedItem(fields: {
  key: string;
  collection?: string;
  status?: string;
  attemptCount?: number;
  lastError?: string;
  deletionReportedAt?: string | null;
  deletionAcknowledgedAt?: string | null;
  movedToCollection?: string | null;
  movedToNaturalKeyHash?: string | null;
  moveAcknowledgedAt?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO item (
       tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
       status, attempt_count, last_error,
       deletion_reported_at, deletion_acknowledged_at,
       moved_to_collection, moved_to_natural_key_hash, move_acknowledged_at
     ) VALUES ($1, $2, 'email', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      TENANT_ID,
      LEDGER_MAPPING_ID,
      fields.collection ?? 'INBOX',
      fields.key,
      createHash('sha256').update(fields.key).digest('hex'),
      fields.status ?? 'copied',
      fields.attemptCount ?? 0,
      fields.lastError ?? null,
      fields.deletionReportedAt ?? null,
      fields.deletionAcknowledgedAt ?? null,
      fields.movedToCollection ?? null,
      fields.movedToNaturalKeyHash ?? null,
      fields.moveAcknowledgedAt ?? null,
    ],
  );
}

beforeAll(async () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  try {
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  } finally {
    await admin.end();
  }

  pool = new Pool({ connectionString: PG_CONNECTION_STRING });
  db = createPgDb(PG_CONNECTION_STRING);
  ledger = new PgLedger(db);
  decisions = new PgDecisionStore(db);

  const configDir = mkdtempSync(join(tmpdir(), 'openmig-queues-cfg-'));
  writeFileSync(
    join(configDir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT_ID,
      mappingId: MAPPING_ID,
      // 31 February: a valid cron that never fires. Nothing may sync during
      // this test — the rows under test are the ones seeded below.
      schedule: { cron: '0 5 31 2 *' },
      source: {
        type: 'imap-oauth2',
        host: '127.0.0.1',
        port: 1,
        user: 'nobody@invalid',
        auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
      },
      target: {
        type: 'jmap',
        baseUrl: 'http://127.0.0.1:1',
        user: 'nobody@invalid',
        auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
      },
      domains: {},
    }),
  );

  handle = await start({
    persistence: 'postgres',
    databaseUrl: PG_CONNECTION_STRING,
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
  base = `http://127.0.0.1:${handle.port}`;

  // No cleanup needed before seeding: the database was created empty a few
  // lines above, and the appliance's own startup is the only thing that has
  // written to it.
  //
  // Three items, one per queue, plus one that must NOT appear in any of them.
  await seedItem({
    key: '<deletion-waiting@test>',
    deletionReportedAt: new Date().toISOString(),
  });
  await seedItem({
    key: '<deletion-answered@test>',
    deletionReportedAt: new Date().toISOString(),
    deletionAcknowledgedAt: new Date().toISOString(),
  });
  await seedItem({ key: '<move-waiting@test>', movedToCollection: 'Archive' });
  // A RELOCATION (ADR-0030): the key changed too, which is what makes it
  // applicable. Seeded beside the ordinary move so the endpoint has to tell
  // them apart rather than answering the same shape for both.
  await seedItem({
    key: '<relocation-waiting@test>',
    movedToCollection: 'INBOX',
    movedToNaturalKeyHash: 'the-new-key-hash',
  });
  await seedItem({
    key: '<move-answered@test>',
    movedToCollection: 'Archive',
    moveAcknowledgedAt: new Date().toISOString(),
  });
  await seedItem({
    key: '<failure-needing-a-person@test>',
    status: 'failed',
    attemptCount: MAX_ITEM_ATTEMPTS,
    lastError: 'the server said: 552 message too large',
  });
  await seedItem({
    key: '<failure-still-retrying@test>',
    status: 'failed',
    attemptCount: 1,
    lastError: 'temporary failure',
  });
  // A perfectly ordinary migrated item: it belongs in no queue at all.
  await seedItem({ key: '<quiet@test>' });
}, 180_000);

afterAll(async () => {
  // CLOSE every pool of ours before the drop, rather than relying on the
  // terminate below to do it. `pg_terminate_backend` against a live pool makes
  // its client emit `terminating connection due to administrator command`
  // with nobody listening, and vitest fails the run on the unhandled error
  // even when every test passed — which is exactly what happened on the first
  // green run of this file.
  await handle?.stop(); // ends the appliance's own pool
  await db?.close();
  await pool?.end();

  // Drop the whole database rather than the rows: nothing else in the suite
  // shares it. The terminate stays as a backstop for anything that outlived
  // its owner — Postgres refuses to drop a database somebody is attached to —
  // and by this point it should find nothing to kill.
  const cleanup = new Pool({ connectionString: ADMIN_URL });
  try {
    await cleanup.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [DB_NAME],
    );
    await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  } finally {
    await cleanup.end();
  }
});

describe('the queue endpoints see the real rows', () => {
  it('lists a confirmed deletion as waiting, and an answered one as not', async () => {
    const queue = (await getQueue('/deletions'))[MAPPING_ID];

    expect(queue?.confirmed).toHaveLength(1);
    expect(queue?.confirmed?.[0]?.naturalKeyHash).toBeDefined();
    // Answered means answered: it is history, not work.
    expect(queue?.confirmed?.[0]?.acknowledgedAt).toBeUndefined();
  });

  it('splits moves into open and acknowledged', async () => {
    const queue = (await getQueue('/moves'))[MAPPING_ID];

    expect(queue?.open).toHaveLength(2);
    expect(queue?.acknowledged).toHaveLength(1);
    // The queue has to say WHERE, or "1 item moved" is not something anyone
    // can act on.
    expect(queue?.open?.map((m) => m.to)).toContain('Archive');
  });

  it('carries the arrival KEY for a relocation, and omits it for a plain move', async () => {
    // Proven against the real column rather than the in-memory fake: this
    // field is what the UI uses to decide whether to offer a destructive
    // button, and a select that forgot it would silently hide the action
    // (ADR-0030). The fake and the SQL disagreeing is not hypothetical here —
    // it is how the moves queue's ORDER BY bug was found.
    const queue = (await getQueue('/moves'))[MAPPING_ID];

    const relocation = queue?.open?.find((m) => m.toNaturalKeyHash !== undefined);
    expect(relocation?.toNaturalKeyHash).toBe('the-new-key-hash');
    // And the ordinary move must NOT acquire one.
    const plain = queue?.open?.find((m) => m.to === 'Archive');
    expect(plain?.toNaturalKeyHash).toBeUndefined();
  });

  it('splits failures into the ones that want a person and the ones still trying', async () => {
    const queue = (await getQueue('/failures'))[MAPPING_ID];

    expect(queue?.needsDecision).toHaveLength(1);
    expect(queue?.retrying).toHaveLength(1);
    // The server's own words, carried through rather than summarised.
    expect(queue?.needsDecision?.[0]?.lastError).toBe('the server said: 552 message too large');
  });
});

describe('the digest counts what the screens count', () => {
  /** The collector, wired the way the appliance wires it. */
  async function collect() {
    return collectAttention({
      mappings: [{ mappingId: MAPPING_ID, tenantId: TENANT_ID }],
      status: async () => 'shadow',
      listDeletions: () =>
        ledger.listDeletions(asTenantId(TENANT_ID), asMappingId(LEDGER_MAPPING_ID)),
      listMoves: () => ledger.listMoves(asTenantId(TENANT_ID), asMappingId(LEDGER_MAPPING_ID)),
      listFailures: () =>
        ledger.listFailures(asTenantId(TENANT_ID), asMappingId(LEDGER_MAPPING_ID)),
      countAutoApplied: async () => 0,
    countSharingOpen: async () => 0,
      countPendingDecisions: async (tenantId) =>
        (await decisions.list(asTenantId(tenantId), { status: 'pending' })).length,
    });
  }

  it('reports exactly the numbers the three endpoints show', async () => {
    const [deletions, moves, failures] = await Promise.all([
      getQueue('/deletions'),
      getQueue('/moves'),
      getQueue('/failures'),
    ]);
    const [attention] = await collect();

    // The whole point of the shared `summariseQueues`, proven here against
    // live rows rather than inferred from both callers using it.
    expect(attention?.deletionsWaiting).toBe(deletions[MAPPING_ID]?.confirmed?.length);
    expect(attention?.movesWaiting).toBe(moves[MAPPING_ID]?.open?.length);
    expect(attention?.failuresWaiting).toBe(failures[MAPPING_ID]?.needsDecision?.length);
  });

  it('does not count the answered, the retrying or the quiet', async () => {
    const [attention] = await collect();
    // Eight rows are seeded; exactly four of them are waiting on a person —
    // two of those in the moves queue, one an ordinary move and one a
    // relocation.
    expect(attention).toMatchObject({
      deletionsWaiting: 1,
      movesWaiting: 2,
      failuresWaiting: 1,
    });
    expect(wantsAttention(attention!)).toBe(true);
  });

  it('reports no blind spots when every queue could be read', async () => {
    const [attention] = await collect();
    expect(attention?.blindSpots).toBeUndefined();
  });
});

describe('the decision queue', () => {
  it('is served, and counted once, against the same database', async () => {
    await decisions.raise({
      tenantId: asTenantId(TENANT_ID),
      category: 'new_mailbox',
      subjectKey: 'nieuw@example.nl',
      summary: 'A mailbox exists on the source that no mapping covers.',
      proposedDefault: 'create a mapping',
    });

    const body = (await (await fetch(`${base}/decisions`)).json()) as {
      decisions: { summary: string }[];
    };
    expect(body.decisions).toHaveLength(1);
    // Verbatim: the detector's own sentence, not a reworded one.
    expect(body.decisions[0]?.summary).toBe(
      'A mailbox exists on the source that no mapping covers.',
    );
  });

  /**
   * The one category whose answer CHANGES something (workplan 0028 T3).
   *
   * Proved here rather than in `decisions-routes.unit.test.ts` for the reason
   * that file records: PGlite's single connection cannot seed a group beside
   * a running appliance. Postgres can, so the round trip belongs here — and
   * it has to be a round trip, because a decision that closes and leaves the
   * ledger untouched is exactly the dead surface 0026 spent a day deleting.
   */
  it('writes the pattern an operator chose back to the discovered group', async () => {
    const conn = await pool.query(
      `INSERT INTO connection (tenant_id, role, kind, display_name, config, status)
       VALUES ($1, 'source', 'o365', 'Source', '{}', 'connected') RETURNING id`,
      [TENANT_ID],
    );
    await pool.query(
      `INSERT INTO group_def (tenant_id, source_connection_id, address, members)
       VALUES ($1, $2, 'sales@example.nl', '[]')`,
      [TENANT_ID, conn.rows[0].id],
    );
    const { decision } = await decisions.raise({
      tenantId: asTenantId(TENANT_ID),
      category: 'shared_address_pattern',
      subjectKey: 'sales@example.nl',
      summary: 'Shared mailbox, or a distribution list?',
    });

    const res = await fetch(`${base}/decisions/${decision.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resolution: { action: 'set_shared_address_pattern', pattern: 'shared_s' },
      }),
    });
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT pattern FROM group_def WHERE tenant_id = $1 AND address = 'sales@example.nl'`,
      [TENANT_ID],
    );
    expect(rows[0].pattern).toBe('shared_s');
  });

  it('serves the discovered addresses under the same shape as managed', async () => {
    // 0027 T4. Written here for the same reason as the answer round trips:
    // the rows have to exist beside a running appliance, which PGlite cannot
    // do. The shape is ADR-0026's — one operating UI reads both editions.
    const res = await fetch(`${base}/shared-addresses`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { addresses: { address: string; pattern?: string }[] };
    expect(body.addresses.map((a) => a.address)).toContain('sales@example.nl');
  });

  it('leaves the group alone when the answer names no pattern', async () => {
    const conn = await pool.query(
      `INSERT INTO connection (tenant_id, role, kind, display_name, config, status)
       VALUES ($1, 'source', 'o365', 'Other source', '{}', 'connected') RETURNING id`,
      [TENANT_ID],
    );
    await pool.query(
      `INSERT INTO group_def (tenant_id, source_connection_id, address, members)
       VALUES ($1, $2, 'vague@example.nl', '[]')`,
      [TENANT_ID, conn.rows[0].id],
    );
    const { decision } = await decisions.raise({
      tenantId: asTenantId(TENANT_ID),
      category: 'shared_address_pattern',
      subjectKey: 'vague@example.nl',
      summary: 'Shared mailbox, or a distribution list?',
    });

    const res = await fetch(`${base}/decisions/${decision.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: { action: 'accept_default' } }),
    });
    expect(res.status).toBe(200);

    // Recording a pattern nobody chose is worse than leaving it open.
    const { rows } = await pool.query(
      `SELECT pattern FROM group_def WHERE tenant_id = $1 AND address = 'vague@example.nl'`,
      [TENANT_ID],
    );
    expect(rows[0].pattern).toBeNull();
  });
});
