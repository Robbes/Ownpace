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
 * AND INSIDE ONE (2026-09-29). Between domains was not enough: a Pause
 * pressed during a file pass waited for that pass's own deadline, up to fifty
 * minutes, while the writes went on. Each data type's pass is now handed
 * `whyThisDataTypeStops` and asks it from inside, by its own clock; the last
 * block below runs it under the same role and the same row security, for each
 * of the doors that stop a pass.
 *
 * **Why a database and not a fake.** The read has no `tenant_id` in its WHERE
 * clause — it is scoped by RLS, through `withTenant`. A fake `db` would answer
 * whatever it was told and prove nothing about either half. So the seed runs
 * as the owner and every call under test runs as `app_user`, the role the
 * worker actually connects as, with row-level security switched on.
 *
 * The subject lives in `stopping-a-pass.ts` rather than in the task that uses
 * it, precisely so this file can import it having been HANDED a database:
 * `run-delta-sync.ts` opens its pools at import from the environment
 * (`openTaskPools`: `APP_DATABASE_URL`, and `SYSTEM_DATABASE_URL` for the
 * audit key), and a test that reaches for a database through the environment
 * is the thing `an-integration-test-is-handed-its-database.unit.test.ts`
 * exists to refuse.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { createPgDb } from '@openmig/ledger';
import { PASS_RUNNING_STATES, runsPasses, asTenantId, asMappingId } from '@openmig/shared';
import { mappingStillRuns, whyThePassStops, whyThisDataTypeStops } from './stopping-a-pass.ts';

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

  it('stops once the person has taken their grant back, and says that was why (0108 T8 (c))', async () => {
    // Still `active`: the withdrawal is not a lifecycle, and the owner did
    // nothing. The pass must stop all the same, and its line must not say
    // "paused", because what brings it back is a new grant, not Resume.
    const why = () => whyThePassStops(workerPool, asTenantId(TENANT), asMappingId(MAPPING));
    await setStatus('active');
    await owner.execute(sql`UPDATE mailbox_mapping SET grant_withdrawn_at = now() WHERE id = ${MAPPING}`);
    try {
      expect(await why()).toBe('grant_withdrawn');
      expect(await ask()).toBe(false);
      // Paused as well, the line names the pause: that is the thing the owner
      // undoes first, and Start then says the grant.
      await setStatus('paused');
      expect(await why()).toBe('no_longer_runs');
    } finally {
      await owner.execute(sql`UPDATE mailbox_mapping SET grant_withdrawn_at = NULL WHERE id = ${MAPPING}`);
      await setStatus('active');
    }
    expect(await why()).toBeNull();
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

  it('answers a running pass, from inside a data type, why it must stop (2026-09-29)', async () => {
    // The question a data type's pass asks every PASS_REREAD_EVERY_MS: the
    // between-types answer, as one reason or null. Asked as app_user, so the
    // rows it reads are the rows row security lets the pass see.
    const ask = (domain: string) =>
      whyThisDataTypeStops(workerPool, asTenantId(TENANT), asMappingId(MAPPING), domain);
    await setStatus('active');
    expect(await ask('file')).toBeNull();

    await setStatus('paused');
    try {
      expect(await ask('file')).toBe('no_longer_runs');
    } finally {
      await setStatus('active');
    }

    await owner.execute(sql`UPDATE mailbox_mapping SET grant_withdrawn_at = now() WHERE id = ${MAPPING}`);
    try {
      expect(await ask('file')).toBe('grant_withdrawn');
    } finally {
      await owner.execute(sql`UPDATE mailbox_mapping SET grant_withdrawn_at = NULL WHERE id = ${MAPPING}`);
    }

    await owner.execute(sql`UPDATE tenant SET status = 'closed' WHERE id = ${TENANT}`);
    try {
      expect(await ask('file')).toBe('organisation_closed');
    } finally {
      await owner.execute(sql`UPDATE tenant SET status = 'active' WHERE id = ${TENANT}`);
    }

    // Its owner stopped this data type alone: the file pass stops, the mail
    // pass beside it goes on.
    await owner.execute(sql`
      INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
      VALUES (${TENANT}, ${MAPPING}, 'file', true), (${TENANT}, ${MAPPING}, 'email', true)
      ON CONFLICT DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, stopped_at)
      VALUES (${TENANT}, ${MAPPING}, 'file', 'active', now(), now()),
             (${TENANT}, ${MAPPING}, 'email', 'active', now(), NULL)
      ON CONFLICT DO NOTHING`);
    try {
      expect(await ask('file')).toBe('stopped_by_its_owner');
      expect(await ask('email')).toBeNull();
    } finally {
      await owner.execute(sql`DELETE FROM path_lifecycle WHERE mapping_id = ${MAPPING}`);
      await owner.execute(sql`DELETE FROM scope_selection WHERE mapping_id = ${MAPPING}`);
    }
    expect(await ask('file')).toBeNull();

    // And another tenant's migration is no migration at all.
    expect(await whyThisDataTypeStops(workerPool, asTenantId(OTHER_TENANT), asMappingId(MAPPING), 'file')).toBe(
      'no_longer_runs',
    );
  });
});

