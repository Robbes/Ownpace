// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The confirmation pass a person started (workplan 0117 T2, slice 7).
 *
 * D7(a) made this *"a job the person starts and we report on rather than a wait
 * before the list appears."* The API's `POST .../confirm` enqueues this; the
 * job builds a reader per domain over the real target, runs the pass, and the
 * `run` row it opens is what the person reads. The same pair as
 * `run-verification`, and for the same reason: **target I/O stays in the
 * worker**, because the API must never hold connector credentials for the
 * minutes a scan takes (ADR-0026).
 *
 * ## The tenant scope, and why a long pass cannot hold one
 *
 * `withTenant` is a TRANSACTION — BEGIN, `SET LOCAL ROLE`, `SET LOCAL` tenant,
 * COMMIT — so it takes a connection for as long as its callback runs. Every
 * other job here wraps individual ledger calls in it, and that is not a style
 * choice: a pass over a family-sized account runs for many minutes, and one
 * transaction held open that long blocks vacuum, bloats the table and is what
 * an `idle_in_transaction_session_timeout` exists to kill.
 *
 * So the adapters below take a fresh scope per unit of work:
 *
 *   - **reads page.** One scope per page of 500 rows, which is the store's own
 *     keyset batch. Between pages the connection is back in the pool.
 *   - **writes batch.** Findings buffer and flush in one scope per batch, which
 *     turns one transaction per item into one per five hundred.
 *
 * Batching has to answer to the pass's rule 3 — *what was confirmed before a
 * failure stays confirmed* — so the flush is in a `finally` around the pass,
 * not only at the end of a happy path. Fifty thousand items read before the
 * network dropped are fifty thousand real answers, and a buffer that only
 * flushed on success would throw the last batch of them away.
 */

import { z } from 'zod';
import { schemaTask, logger } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { PgRateBudget, createPgDb } from '@openmig/ledger';
import {
  DEFAULT_THROTTLE_CONFIG,
  DISCOVERY_DOMAINS,
  asMappingId,
  asTenantId,
} from '@openmig/shared';
import { enabledDomains } from '@openmig/orchestration/enabled-domains';
import { targetProviderKey } from '@openmig/orchestration/build-confirmation-readers';
import { managedOpener } from '@openmig/orchestration/build-reindexers';
import { runConfirmationOver } from '@openmig/orchestration/run-confirmation-pass';

const ConfirmationJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  /**
   * Domains to confirm. Absent means every domain the mapping actually
   * migrates — resolved from `scope_selection` below rather than named by the
   * caller, so a stale copy of the scope cannot ask us to confirm a domain the
   * owner switched off. Same rule `resolveSyncJob` states for a sync.
   *
   * The enum walks `DISCOVERY_DOMAINS` rather than listing the five by hand:
   * 0113 T1's rule, and its guard fails the build for a second copy. A sixth
   * domain that this schema silently rejected would be a domain the pass never
   * confirms, reported as an account with nothing in it.
   */
  domains: z.array(z.enum(DISCOVERY_DOMAINS)).optional(),
});

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({ connectionString: DATABASE_URL });

export const runConfirmationTask = schemaTask({
  id: 'run-confirmation',
  schema: ConfirmationJobSchema,
  run: async (payload) => {
    const tenantId = asTenantId(payload.tenantId);
    const mappingId = asMappingId(payload.mappingId);

    const enabled = await enabledDomains(pool, tenantId, mappingId);
    const wanted = (payload.domains ?? [...enabled]).filter((d) => enabled.has(d));
    if (wanted.length === 0) {
      // Nothing the owner migrates, so nothing to confirm. Not a failure and
      // not a run row: a run that confirmed nothing because there was nothing
      // to confirm would read on the page as a pass that found an empty
      // account.
      logger.info(`[run-confirmation] ${mappingId}: no enabled domains — nothing to confirm`);
      return { started: false as const, reason: 'no_enabled_domains' };
    }

    // D9: the SAME rate budget a migration for this tenant uses. Built
    // unconditionally, because *"no custom limits" never meant "no limits"* —
    // and this is the half of D9 that a person actually feels, the reason a
    // confirmation queues behind their copying instead of racing it.
    //
    // The provider key names the TARGET, never this pass and never this
    // mapping: a per-mapping label would hand the confirmation a private
    // bucket, which is the second allowance D9 refuses, and it would look
    // correct while being false.
    //
    // No byte meter: a ceiling is a number somebody published, and none is for
    // any target this product writes to. The pass then runs to the end rather
    // than pausing, which is right for a server with no ceiling and would be
    // dangerous for one that has it.
    const provider = await targetProviderKey(pool, tenantId, mappingId);
    if (!provider) {
      // No target connection to name. Nothing can be read off a target that is
      // not there, so this is a mapping that cannot be confirmed rather than
      // one to confirm unbudgeted.
      logger.error(`[run-confirmation] ${mappingId}: no target connection — nothing to read`);
      return { started: false as const, reason: 'no_target_connection' };
    }

    // `createPgDb`, not a `withTenant` scope: the budget is a token bucket
    // consulted per request for the pass's whole lifetime, so a scope would
    // hold one transaction open for all of it — and a scope's handle is dead
    // once it commits anyway. Its own table is keyed by the (tenant, provider)
    // columns it writes itself, and its tenant is bound at construction
    // precisely so no caller supplies one (0082 T5).
    const rate = new PgRateBudget(createPgDb(DATABASE_URL), {
      tenantId,
      requestsPerSecond: DEFAULT_THROTTLE_CONFIG.requestsPerSecond,
    });

    // The MANAGED opener: this edition's answer to "how do I open one
    // domain's target", built from connection rows. The builder itself is
    // edition-agnostic (owner decision 2026-09-11, option (b)) — the appliance
    // hands it a config-built opener and gets the same readers.
    // The whole pass — readers, recorder, run row, release — is
    // `runConfirmationOver`, shared with the appliance (owner decision
    // 2026-09-11, option (b)). What this job supplies is the two things an
    // EDITION owns: where the ledger lives (a pg `Pool`) and how a target is
    // opened (from connection rows).
    const result = await runConfirmationOver({
      source: pool,
      tenantId,
      mappingId,
      open: managedOpener(pool, tenantId, mappingId),
      wanted,
      budget: { tenantId, provider, rate },
      trigger: 'manual',
    });
    logger.info(
      `[run-confirmation] ${mappingId}: ${result.tally.verified} of ${result.tally.total} ` +
        `verified, ${result.recorded} recorded` +
        (result.paused ? ` — paused at the day's ceiling` : ''),
    );
    return { started: true as const, runId: result.runId, tally: result.tally };
  },
});
