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

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

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

/** The queue envelopes, as far as this test reads them. */
interface QueueBody {
  readonly [mappingId: string]: {
    readonly confirmed?: { naturalKeyHash: string; acknowledgedAt?: string }[];
    readonly open?: { to: string }[];
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
  moveAcknowledgedAt?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO item (
       tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
       status, attempt_count, last_error,
       deletion_reported_at, deletion_acknowledged_at,
       moved_to_collection, move_acknowledged_at
     ) VALUES ($1, $2, 'email', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
      fields.moveAcknowledgedAt ?? null,
    ],
  );
}

beforeAll(async () => {
  pool = new Pool({ connectionString: PG_CONNECTION_STRING });
  const db = createPgDb(PG_CONNECTION_STRING);
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

  // Start from a known state. The seeded counts below are exact, so a second
  // run against a surviving database would double them and fail for a reason
  // that has nothing to do with the code under test.
  await pool.query('DELETE FROM item WHERE tenant_id = $1', [TENANT_ID]);
  await pool.query('DELETE FROM decision WHERE tenant_id = $1', [TENANT_ID]);

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
  await handle?.stop();
  // Tenant-scoped, like every other integration test here: the database is
  // shared with the rest of the suite and only this namespace is ours.
  await pool?.query('DELETE FROM item WHERE tenant_id = $1', [TENANT_ID]);
  await pool?.query('DELETE FROM decision WHERE tenant_id = $1', [TENANT_ID]);
  await pool?.end();
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

    expect(queue?.open).toHaveLength(1);
    expect(queue?.acknowledged).toHaveLength(1);
    // The queue has to say WHERE, or "1 item moved" is not something anyone
    // can act on.
    expect(queue?.open?.[0]?.to).toBe('Archive');
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
    // Seven rows are seeded; exactly three of them are waiting on a person.
    expect(attention).toMatchObject({
      deletionsWaiting: 1,
      movesWaiting: 1,
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
});
