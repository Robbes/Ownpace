// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * D10's list, read from a REAL ledger (workplan 0117 T2).
 *
 * `a-list-that-says-less-than-it-counted.unit.test.ts` guards the SHAPER —
 * given rows, what does the list say. This guards the READ: given items in a
 * database, do the right rows reach that shaper at all.
 *
 * **The gap was found by a mutation, not by review.** Making `readConfirmedList`
 * feed the shaper only its non-verified rows — so `total` became the length of
 * the filtered list and the headline shrank with the filter — passed every test
 * in the repository. The shaper's own guard could not see it, because the shaper
 * was doing exactly what it was told; the shaper was simply not being told
 * everything. That is the same class of defect this plan has now found five
 * times: a piece correct on its own, wrong at the seam.
 *
 * Real Postgres via PGlite, because the properties are the read's: that every
 * row of the mapping reaches the count, that the pass state comes off the run
 * row, and that the export carries what the screen does not.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createPgliteDb, runMigrations } from '@openmig/ledger';
import type { LedgerDriver, LedgerConnection } from '@openmig/ledger';
import type { MappingId, TenantId } from '@openmig/shared';
import { readConfirmedList, runningConfirmation, streamConfirmedListCsv } from './confirmed-list-read.ts';

// UUID family 0047…, unused elsewhere in the repo.
const TENANT = '00470000-e29b-41d4-a716-446655440001' as TenantId;
const MAPPING = '00470000-e29b-41d4-a716-446655440002' as MappingId;
const CONN = '00470000-e29b-41d4-a716-446655440003';
const SRC = '00470000-e29b-41d4-a716-446655440004';
const DST = '00470000-e29b-41d4-a716-446655440005';

let driver: LedgerDriver;
const scope = () => ({ source: driver, tenantId: TENANT, mappingId: MAPPING });

/**
 * One query, on a connection released immediately.
 *
 * **PGlite has exactly ONE connection** — `driver.ts` says so in as many words:
 * *"`pg.Pool` hands out N independent connections. PGlite has exactly one."*
 * The first version of this file held one open for the whole suite, the way the
 * ledger's own PGlite tests do. Those reach the store through a drizzle handle;
 * everything under test HERE goes through `withTenant`, which acquires. So the
 * read waited for the connection the fixture was sitting on, and the suite HUNG
 * rather than failed — the second time this workplan has produced a test that
 * cannot finish. Nothing was wrong with the product.
 */
async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: T[] }> {
  const conn: LedgerConnection = await driver.acquire();
  try {
    return await conn.query<T>(sql, params);
  } finally {
    conn.release();
  }
}

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  await runMigrations({ driver, logger: () => {} });
  await q(
    `INSERT INTO tenant (id, name, status) VALUES ($1, 'Confirmed list read', 'active')`,
    [TENANT],
  );
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [id, addr] of [
    [SRC, 'src@list.local'],
    [DST, 'dst@list.local'],
  ]) {
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
      [id, TENANT, CONN, addr],
    );
  }
  await q(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
     VALUES ($1,$2,$3,$4,'mirror','active')`,
    [MAPPING, TENANT, SRC, DST],
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await q('DELETE FROM item');
  await q('DELETE FROM run');
});

/** `n` items, `verified` of which the target said matched. */
const seed = async (n: number, verified: number): Promise<void> => {
  for (let i = 0; i < n; i += 1) {
    await q(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
                         content_hash, status, confirmed_answer, confirmed_at)
       VALUES ($1,$2,'email','INBOX',$3,$3,'h','copied',$4,$5)`,
      [
        TENANT,
        MAPPING,
        `k-${String(i).padStart(4, '0')}`,
        i < verified ? 'match' : 'absent',
        i < verified ? new Date() : new Date(),
      ],
    );
  }
};

describe('the count is of the ACCOUNT, not of what is shown', () => {
  it('counts every row, and shows only the ones that are not verified', async () => {
    // THE MUTATION THAT SLIPPED THROUGH. Feeding the shaper only the rows it
    // will show makes `total` the length of the filtered list: 40 items, 38 of
    // them fine, and the page says "2 of 2" — an account 95% smaller than it
    // is, on the document somebody deletes their originals from.
    await seed(40, 38);
    const list = await readConfirmedList(scope(), 'active');
    expect(list.total).toBe(40);
    expect(list.verified).toBe(38);
    expect(list.rows).toHaveLength(2);
    expect(list.rows.every((r) => r.state !== 'verified')).toBe(true);
  });

  it('states a total larger than the rows it carries', async () => {
    // The sentence a screen has to be able to write: "2 of 40". A list whose
    // total equalled its rows could not say it, and the difference is what
    // tells a person the other 38 were verified rather than dropped.
    await seed(40, 38);
    const list = await readConfirmedList(scope(), 'active');
    expect(list.total).toBeGreaterThan(list.rows.length);
  });

  it('carries the mapping lifecycle it was given', async () => {
    await seed(1, 0);
    expect((await readConfirmedList(scope(), 'done')).migrationStatus).toBe('done');
  });

  it('reads an empty mapping as an empty account, not as a failure', async () => {
    const list = await readConfirmedList(scope(), 'active');
    expect(list).toMatchObject({ total: 0, verified: 0, rows: [] });
    expect(list.lastPass).toEqual({ state: 'never-run' });
  });
});

describe('where the pass got to', () => {
  it('says never-run when no pass has opened a row', async () => {
    // NOT the same as a pass that found nothing, and the rows cannot tell them
    // apart: before any pass every row reads `unchecked`, and after a pass that
    // could not reach the target every row reads `unchecked` too.
    await seed(3, 0);
    expect((await readConfirmedList(scope(), 'active')).lastPass).toEqual({ state: 'never-run' });
  });

  it('says running while a pass holds its row open, and joins rather than stacks', async () => {
    const inserted = await q<{ id: string }>(
      `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at)
       VALUES ($1,$2,'confirm','manual','running', now()) RETURNING id`,
      [TENANT, MAPPING],
    );
    const runId = inserted.rows[0]!.id;
    const list = await readConfirmedList(scope(), 'active');
    expect(list.lastPass.state).toBe('running');
    // The button's half of the same fact: a second press joins this run rather
    // than paying for every byte twice to answer a question already being
    // answered.
    expect(await runningConfirmation(scope())).toEqual({ runId });
  });

  it('says done with both times once the pass closes', async () => {
    await q(
      `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at, finished_at)
       VALUES ($1,$2,'confirm','manual','succeeded', now(), now())`,
      [TENANT, MAPPING],
    );
    const { lastPass } = await readConfirmedList(scope(), 'active');
    expect(lastPass.state).toBe('done');
    expect(lastPass).toHaveProperty('startedAt');
    expect(lastPass).toHaveProperty('finishedAt');
    expect(await runningConfirmation(scope())).toBeUndefined();
  });

  it('reads a run that stopped at the day’s ceiling as DONE, with the reason', async () => {
    // 0090 T4: a scheduled stop is a stop, not a failure. Without the reason,
    // the honest numbers read as a bad result — "12 of 50 000" with no
    // explanation is alarming where "the provider's day is spent, it lifts at
    // 06:00" is not.
    await q(
      `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at, finished_at, stats)
       VALUES ($1,$2,'confirm','manual','succeeded', now(), now(), $3::jsonb)`,
      [
        TENANT,
        MAPPING,
        JSON.stringify({
          budgetPause: {
            provider: 'imap.gmail.com',
            ceilingBytes: 2_500_000_000,
            spentBytes: 2_500_000_001,
            windowResetsAt: '2026-09-12T06:00:00.000Z',
          },
        }),
      ],
    );
    const list = await readConfirmedList(scope(), 'active');
    expect(list.lastPass.state).toBe('done');
    expect(list.pausedAt).toMatchObject({
      kind: 'daily-download-ceiling',
      provider: 'imap.gmail.com',
      windowResetsAt: '2026-09-12T06:00:00.000Z',
    });
  });

  it('ignores a stats blob that is not a budget pause, rather than casting it', async () => {
    // A column an older or newer build wrote. A cast would put `undefined`
    // into a sentence a customer reads as the reason their account is only
    // part checked.
    await q(
      `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at, finished_at, stats)
       VALUES ($1,$2,'confirm','manual','succeeded', now(), now(), $3::jsonb)`,
      [TENANT, MAPPING, JSON.stringify({ budgetPause: { provider: 'x' } })],
    );
    expect((await readConfirmedList(scope(), 'active')).pausedAt).toBeUndefined();
  });

  it('reads another mapping’s confirm run as none of this mapping’s business', async () => {
    await q(
      `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at)
       VALUES ($1, NULL, 'confirm','manual','running', now())`,
      [TENANT],
    );
    expect((await readConfirmedList(scope(), 'active')).lastPass).toEqual({ state: 'never-run' });
  });

  it('reads a sync run as none of the confirmation’s business either', async () => {
    await q(
      `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at)
       VALUES ($1,$2,'incremental','schedule','running', now())`,
      [TENANT, MAPPING],
    );
    expect((await readConfirmedList(scope(), 'active')).lastPass).toEqual({ state: 'never-run' });
  });
});

describe('the export carries what the screen does not', () => {
  it('writes every row, verified ones included', async () => {
    await seed(5, 4);
    let csv = '';
    await streamConfirmedListCsv(scope(), (chunk) => {
      csv += chunk;
    });
    const lines = csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    // One header, five rows — where the screen would show one.
    expect(lines).toHaveLength(6);
    expect(csv).toContain('verified');
    const list = await readConfirmedList(scope(), 'active');
    expect(list.rows).toHaveLength(1);
  });
});
