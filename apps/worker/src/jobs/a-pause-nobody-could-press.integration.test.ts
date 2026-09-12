// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAUSE THAT LANDED AN HOUR LATE (live 2026-09-11).
 *
 * The `paused` lifecycle existed all along: the tick will not enqueue a paused
 * mapping and the confirm screen resumes one. What did not exist was any way
 * for a pass ALREADY RUNNING to find out. A run enqueued a minute earlier — or
 * halfway through the contact domain — knew nothing of the PATCH that paused
 * it, so it carried on through every remaining domain, and the file pass that
 * was failing kept failing until its own deadline.
 *
 * So the mapping's status is re-read between domains. `mappingStillRuns` is
 * that read, and this runs it against real rows because that is the part which
 * can be quietly wrong: the predicate it applies, and the rows it is allowed
 * to see.
 *
 * **Why a database and not a fake.** The read has no `tenant_id` in its WHERE
 * clause — it is scoped by RLS, through `withTenant`. A fake `db` would answer
 * whatever it was told and prove nothing about either half. So the seed runs
 * as the owner and every call under test runs as `app_user`, the role the
 * worker actually connects as, with row-level security switched on.
 *
 * The subject lives in `stopping-a-pass.ts` rather than in the task that uses
 * it, precisely so this file can import it having been HANDED a database:
 * `run-delta-sync.ts` builds a `Pool` from `DATABASE_URL` at import, and
 * setting that from a test is the thing
 * `an-integration-test-is-handed-its-database.unit.test.ts` exists to refuse.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { createPgDb } from '@openmig/ledger';
import { PASS_RUNNING_STATES, runsPasses, asTenantId, asMappingId } from '@openmig/shared';
import { mappingStillRuns } from './stopping-a-pass.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

/** The role the worker connects as, so RLS is enforced rather than bypassed. */
function asAppUser(url: string): string {
  const parsed = new URL(url);
  parsed.username = 'app_user';
  parsed.password = 'app_password';
  return parsed.toString();
}

const P = '7b330000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const OTHER_TENANT = `${P}02`;
const CONN = `${P}c1`;
const BOX_A = `${P}b1`;
const BOX_B = `${P}b2`;
const MAPPING = `${P}d1`;
const GONE = `${P}dd`;

/**
 * Every status the column will accept.
 *
 * Written out rather than read from the CHECK constraint, so that a migration
 * adding a sixth lifecycle state does not silently widen what this file
 * believes it has covered — the partition assertion below then fails on a
 * state nobody classified, which is the question that needs answering.
 */
const EVERY_STATUS = ['active', 'paused', 'cutover', 'done', 'continuous'] as const;

describe('a pass finds out that it was paused', () => {
  let owner: ReturnType<typeof createPgDb>;
  let workerPool: Pool;

  beforeAll(async () => {
    owner = createPgDb(PG_CONNECTION_STRING);
    workerPool = new Pool({ connectionString: asAppUser(PG_CONNECTION_STRING) });

    await owner.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES
        (${TENANT}, 'Pause Mid Pass', 'active'),
        (${OTHER_TENANT}, 'Somebody Else', 'active')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${CONN}, ${TENANT}, 'source', 'o365', 'src', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, kind, external_id)
      VALUES (${BOX_A}, ${TENANT}, ${CONN}, 'user', 'a'),
             (${BOX_B}, ${TENANT}, ${CONN}, 'user', 'b')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${MAPPING}, ${TENANT}, ${BOX_A}, ${BOX_B}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING`);
  });

  afterAll(async () => {
    await owner.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${TENANT}`);
    await owner.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${TENANT}`);
    await owner.execute(sql`DELETE FROM connection WHERE tenant_id = ${TENANT}`);
    await owner.execute(sql`DELETE FROM tenant WHERE id IN (${TENANT}, ${OTHER_TENANT})`);
    await workerPool.end();
  });

  const setStatus = (status: string) =>
    owner.execute(sql`
      UPDATE mailbox_mapping SET status = ${status} WHERE id = ${MAPPING}`);

  const ask = () => mappingStillRuns(workerPool, asTenantId(TENANT), asMappingId(MAPPING));

  it('stops the pass once the mapping is paused', async () => {
    // The live case: Rob pressed nothing, because there was no button — but
    // the row could already be set to `paused` by hand, and a pass that reads
    // it has to stop at the next domain boundary.
    await setStatus('paused');
    expect(await ask()).toBe(false);
  });

  it('carries on while the mapping is still one the tick would have enqueued', async () => {
    await setStatus('active');
    expect(await ask()).toBe(true);
  });

  it('stops exactly when the tick would not have started it, over every status', async () => {
    // The property, not four examples: a pass must abandon work for precisely
    // the states the scheduler refuses to enqueue. Any other partition means a
    // pass running for a migration nothing would have started, or one stopping
    // for a lifecycle that is meant to run.
    const running: string[] = [];
    for (const status of EVERY_STATUS) {
      await setStatus(status);
      const answer = await ask();
      if (answer) running.push(status);
      // Same answer as the lifecycle's own predicate, on a real row.
      expect(answer, status).toBe(runsPasses(status));
    }
    expect(running).toEqual([...PASS_RUNNING_STATES]);
  });

  it('treats a mapping that is gone as one to stop for', async () => {
    // A deleted migration is not a running one. Reading no row as "keep
    // going" would let a pass copy into a mapping the customer removed.
    expect(
      await mappingStillRuns(workerPool, asTenantId(TENANT), asMappingId(GONE)),
    ).toBe(false);
  });

  it('cannot read another tenant’s mapping, so no pass runs on one', async () => {
    // The read is scoped by RLS, not by its WHERE clause — there is no
    // tenant_id in the query at all. Asked under the wrong tenant it must see
    // nothing, which lands as "stop", never as another tenant's `active`.
    await setStatus('active');
    expect(
      await mappingStillRuns(workerPool, asTenantId(OTHER_TENANT), asMappingId(MAPPING)),
    ).toBe(false);
  });
});
