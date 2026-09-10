// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What a confirmation pass writes down is the target's ANSWER, never the word
 * a person reads (workplan 0117 T2, slice 3; migration 0045).
 *
 * ## Why this file exists rather than a simpler one
 *
 * The obvious design is to store the row state — `verified`, `missing`,
 * `yours` — because that is what the list renders and computing it once is
 * cheaper than computing it per read. This plan has already proved on itself
 * why that is wrong: slice 1 shipped SEVEN row states, and building the pass in
 * slice 2 found an eighth the vocabulary could not say (`unchecked`, for a
 * target that could not be asked). Every row written under slice 1's words
 * would today be saying `missing` — *we placed it and it is gone* — about
 * items that were merely unreachable, on the one document somebody deletes
 * their originals from.
 *
 * So the column holds evidence, `rowFor` derives the claim on every read, and
 * this file is what stops that from being quietly reversed by somebody
 * optimising a query.
 *
 * Real Postgres via PGlite, because two of the properties are the column's own:
 * a CHECK that admits exactly five answers, and a NULL that must not read as an
 * absence.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { ConfirmationStore } from './confirmation-store.ts';
import { RunStore, toRunReport, type RunKind } from './run-store.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';
import type { PgDatabase } from './db-types.ts';
import {
  answerFromStored,
  needsTargetRead,
  storedAnswerFor,
  STORED_ANSWERS,
  type MappingId,
  type StoredAnswer,
  type TargetAnswer,
  type TenantId,
} from '@openmig/shared';

// UUID family 0045…, unused elsewhere in the repo.
const TENANT = '00450000-e29b-41d4-a716-446655440001' as TenantId;
const MAPPING = '00450000-e29b-41d4-a716-446655440002' as MappingId;
const CONN = '00450000-e29b-41d4-a716-446655440003';
const SRC = '00450000-e29b-41d4-a716-446655440004';
const DST = '00450000-e29b-41d4-a716-446655440005';
const ITEM = '00450000-e29b-41d4-a716-446655440006';

/**
 * Every answer the target can give, as the pass produces them.
 *
 * Written out rather than derived from `STORED_ANSWERS`, so that a sixth arm
 * added to `TargetAnswer` does not silently go untested here just because it
 * happens to encode to an existing string.
 */
const EVERY_ANSWER: readonly TargetAnswer[] = [
  { onTarget: true, comparison: 'match' },
  { onTarget: true, comparison: 'differ' },
  { onTarget: true, comparison: 'unavailable' },
  { onTarget: false },
  { unreachable: true },
];

let driver: LedgerDriver;
let conn: LedgerConnection;
let db: PgDatabase;
let store: ConfirmationStore;
let runs: RunStore;
let runId: string;

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  db = made.db;
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Confirmation tests', 'active')`, [
    TENANT,
  ]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [id, addr] of [
    [SRC, 'src@confirm.local'],
    [DST, 'dst@confirm.local'],
  ]) {
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
      [id, TENANT, CONN, addr],
    );
  }
  await conn.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
     VALUES ($1,$2,$3,$4,'mirror','active')`,
    [MAPPING, TENANT, SRC, DST],
  );
  store = new ConfirmationStore(db);
  runs = new RunStore(db);
}, 120_000);

afterAll(async () => {
  conn?.release();
  await driver?.end();
});

beforeEach(async () => {
  await conn.query('DELETE FROM item');
  await conn.query(`INSERT INTO item
      (id, tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, content_hash, status)
     VALUES ($1,$2,$3,'email','INBOX','msg-1','h1','h1','copied')`, [ITEM, TENANT, MAPPING]);
  runId = await runs.startRun({ tenantId: TENANT, mappingId: MAPPING, kind: 'confirm', trigger: 'manual' });
});

const storedAnswerOf = async (): Promise<string | null> => {
  const r = await conn.query<{ confirmed_answer: string | null }>(
    `SELECT confirmed_answer FROM item WHERE id = $1`,
    [ITEM],
  );
  return r.rows[0]!.confirmed_answer;
};

describe('the database holds evidence, not the word a person reads', () => {
  it('stores one of the five answers and never a row state', async () => {
    // Every state name from the vocabulary. None of them may reach the column,
    // whatever the target said — that is the property, and it is the one a
    // caching optimisation would break first.
    const ROW_STATES = [
      'verified',
      'differs',
      'present',
      'yours',
      'never-placed',
      'missing',
      'removed',
      'unchecked',
    ];
    for (const answer of EVERY_ANSWER) {
      await store.record({ tenantId: TENANT, runId, finding: { itemId: ITEM, answer } });
      const stored = await storedAnswerOf();
      expect(STORED_ANSWERS).toContain(stored as StoredAnswer);
      // `differs` is deliberately in both lists — it is a legal ANSWER and also
      // a row state — so this asserts the answer, not merely the absence of a
      // word. Every other row state must be absent outright.
      for (const state of ROW_STATES.filter((s) => !STORED_ANSWERS.includes(s as StoredAnswer))) {
        expect(stored).not.toBe(state);
      }
    }
  });

  it('refuses an answer the vocabulary does not know', async () => {
    // The CHECK constraint, not the code: a writer bypassing the store must not
    // be able to leave a string in this column that `answerFromStored` will
    // later throw on, halfway through building somebody's list.
    await expect(
      conn.query(`UPDATE item SET confirmed_answer = 'probably' WHERE id = $1`, [ITEM]),
    ).rejects.toThrow();
  });

  it('records the answer, the time and the run together', async () => {
    const at = new Date('2026-09-10T09:00:00.000Z');
    await store.record({
      tenantId: TENANT,
      runId,
      finding: { itemId: ITEM, answer: { onTarget: true, comparison: 'match' } },
      at,
    });
    const r = await conn.query<{
      confirmed_answer: string;
      confirmed_at: Date;
      confirmed_by_run: string;
    }>(`SELECT confirmed_answer, confirmed_at, confirmed_by_run FROM item WHERE id = $1`, [ITEM]);
    const row = r.rows[0]!;
    expect(row.confirmed_answer).toBe('match');
    expect(new Date(row.confirmed_at).toISOString()).toBe(at.toISOString());
    expect(row.confirmed_by_run).toBe(runId);
  });
});

describe('the list derives its word every time', () => {
  it('reads a matching answer as verified, by hash for mail', async () => {
    await store.record({
      tenantId: TENANT,
      runId,
      finding: { itemId: ITEM, answer: { onTarget: true, comparison: 'match' } },
    });
    const rows = await store.rowsFor({ tenantId: TENANT, mappingId: MAPPING });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('verified');
    expect(rows[0]!.claim).toBe('byte-hash');
  });

  it('reads an item nobody asked about as unchecked, NOT missing', async () => {
    // The whole reason `unchecked` exists. A pass that has not reached this row
    // yet, or was never run at all, leaves NULL — and a NULL read as "not on
    // the target" would put the loudest row on the list in front of somebody
    // deciding what to delete.
    const rows = await store.rowsFor({ tenantId: TENANT, mappingId: MAPPING });
    expect(rows[0]!.state).toBe('unchecked');
    expect(rows[0]!.state).not.toBe('missing');
    expect(rows[0]!.confirmedAt).toBeNull();
  });

  it('reads an absent answer as missing, so the two really are different rows', async () => {
    await store.record({
      tenantId: TENANT,
      runId,
      finding: { itemId: ITEM, answer: { onTarget: false } },
    });
    const rows = await store.rowsFor({ tenantId: TENANT, mappingId: MAPPING });
    expect(rows[0]!.state).toBe('missing');
  });

  it('carries enough to name the item it speaks for', async () => {
    // A list of states with no items on it is not something anybody can act on.
    const rows = await store.rowsFor({ tenantId: TENANT, mappingId: MAPPING });
    expect(rows[0]).toMatchObject({
      itemId: ITEM,
      domain: 'email',
      collection: 'INBOX',
      naturalKey: 'msg-1',
    });
  });
});

/**
 * A row nobody needed to ask about is not a row nobody checked.
 *
 * `needsTargetRead` waives seven of the ten statuses: nothing was placed, or
 * the bytes are the customer's, or we removed our own copy. A confirmation pass
 * never asks the target about those, so it never records an answer and their
 * `confirmed_answer` stays NULL for good.
 *
 * The first version of `rowsFor` read every NULL as `unreachable`, which made
 * all of them say **`unchecked`** — *we did not check* — after a pass that had
 * completed perfectly. That is false twice over: nothing needed checking, and
 * the ledger already knows what happened to them. On the one document somebody
 * deletes their originals from it turns a fact we hold into an admission we do
 * not, and pads the "could not tell" pile with rows that were never in doubt.
 */
describe('an unconfirmed row says what the ledger already knows', () => {
  const asStatus = async (status: string): Promise<string> => {
    await conn.query(`UPDATE item SET status = $2, confirmed_answer = NULL WHERE id = $1`, [
      ITEM,
      status,
    ]);
    const rows = await store.rowsFor({ tenantId: TENANT, mappingId: MAPPING });
    return rows[0]!.state;
  };

  it('reads a never-placed status as never-placed, not unchecked', async () => {
    for (const status of ['skipped', 'left_behind', 'pending', 'failed']) {
      expect(await asStatus(status), `${status} read as the wrong thing`).toBe('never-placed');
    }
  });

  it('still reads a placed-but-unreached row as unchecked', async () => {
    // The other half, and the reason the fix is a condition rather than a
    // different constant: `copied` genuinely has not been looked at yet.
    expect(await asStatus('copied')).toBe('unchecked');
  });

  it('agrees with needsTargetRead across every status', async () => {
    // The rule, not a sample: wherever the read is waived the row must not be
    // `unchecked`, and wherever it is needed an unconfirmed row must be.
    for (const status of [
      'pending',
      'copied',
      'updated',
      'adopted',
      'skipped',
      'failed',
      'left_behind',
      'deleted_source',
      'tombstoned',
    ] as const) {
      const state = await asStatus(status);
      expect(state === 'unchecked', `${status} disagreed with needsTargetRead`).toBe(
        needsTargetRead(status),
      );
    }
  });
});

describe('the codec is total in both directions', () => {
  it('round-trips every answer the target can give', () => {
    for (const answer of EVERY_ANSWER) {
      expect(answerFromStored(storedAnswerFor(answer))).toEqual(answer);
    }
  });

  it('throws on a stored value it does not know', () => {
    // Rather than coercing to an absence, which would be a deletion prompt
    // produced by a schema that moved without the code (hard rule 9).
    expect(() => answerFromStored('probably')).toThrow(/unknown stored confirmation answer/);
  });

  it('encodes each answer to a distinct string', () => {
    const encoded = EVERY_ANSWER.map(storedAnswerFor);
    expect(new Set(encoded).size).toBe(EVERY_ANSWER.length);
  });
});

describe('a confirmation is a run, and it is not billable', () => {
  it('the run table admits the confirm kind', async () => {
    const r = await conn.query<{ kind: string; trigger: string }>(
      `SELECT kind, trigger FROM run WHERE id = $1`,
      [runId],
    );
    expect(r.rows[0]).toMatchObject({ kind: 'confirm', trigger: 'manual' });
  });

  it('reports on the wire as a full-scan run, which is what D7(a) makes it', async () => {
    // `toRunReport` maps every kind but `incremental` to `type: 'full'`, so a
    // seventh kind inherits that without anybody choosing it. Here it happens
    // to be right — D7(a) is *confirm every item*, which is a full scan — and
    // this asserts it rather than leaving it to luck. 0117's own lesson is that
    // when one list moves, the places that must move with it are only partly
    // findable by machine; this is one of the places.
    const rows = await conn.query<{
      id: string;
      mapping_id: string | null;
      kind: string;
      status: string;
      started_at: Date | null;
      finished_at: Date | null;
      stats: unknown;
      created_at: Date;
    }>(`SELECT id, mapping_id, kind, status, started_at, finished_at, stats, created_at
          FROM run WHERE id = $1`, [runId]);
    const r = rows.rows[0]!;
    const report = toRunReport(
      {
        id: r.id,
        mappingId: r.mapping_id,
        kind: r.kind,
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        stats: r.stats,
        createdAt: new Date(r.created_at),
      },
      [],
    );
    expect(report.type).toBe('full');
  });

  it('confirm is not a billable run kind', async () => {
    // D7(a) made this a job the person starts, at the moment they are deciding
    // whether their data is safe to delete. `verify` is unmetered for the same
    // reason. Adding `confirm` to BILLABLE_RUN_KINDS by reflex — it is real
    // compute, after all — would put a meter on that moment.
    const { BILLABLE_RUN_KINDS } = await import('@openmig/managed');
    const kinds: readonly string[] = BILLABLE_RUN_KINDS;
    expect(kinds).not.toContain('confirm' satisfies RunKind);
  });
});
