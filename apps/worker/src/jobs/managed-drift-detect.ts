// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The managed drift detector (workplan 0028 T2, the wiring half).
 *
 * The rules live in `@openmig/core` — `runNewMailboxDetection` decides what
 * happens around a detection pass, `detectNewMailboxes` decides what to raise,
 * and both are tested without a database. THIS FILE IS ONLY THE WIRING: the
 * Pool, the token, the decision store, the notifier and the schedule.
 *
 * Managed resolves coverage from the LEDGER rather than from mapping files
 * (which is what the appliance will do): a mapping points at a source
 * `mailbox` row, and that row carries `primary_address`. A row with a NULL
 * address is managed's version of "unstated" — we cannot say which mailbox
 * that mapping covers, so the run raises nothing for that tenant and says why.
 * Announcing a mailbox somebody is already migrating would teach the owner the
 * queue is wrong, and a queue believed to be wrong is worse than no queue.
 *
 * Daily rather than per-minute on purpose. A new mailbox appearing in a
 * directory is not an event anyone needs told about within sixty seconds, and
 * `/users` against a whole tenant is not a query to run 1,440 times a day.
 */

import { schedules } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { PgDecisionStore } from '@openmig/ledger';
import { log, renderEvent, asTenantId, type DirectoryListing } from '@openmig/shared';
import {
  createTokenProvider,
  listTenantMailboxes,
  notifierFromEnv,
  directoryNotEnumerable,
  directoryAvailability,
} from '@openmig/connectors';
import { runNewMailboxDetection, coverageIncompleteReason } from '@openmig/core';
import type { HttpClient } from '@openmig/connectors';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema: schemaPg });

/** The one HTTP client this task needs; Graph speaks plain JSON over fetch. */
const httpClient: HttpClient = {
  async request({ url, method, headers }) {
    const res = await fetch(url, { method, headers });
    return { status: res.status, body: await res.text(), headers: {} };
  },
};

interface TenantRow {
  readonly id: string;
  readonly name: string;
}

interface CoverageRow {
  readonly primary_address: string | null;
  readonly mapping_id: string;
}

export const managedDriftDetect = schedules.task({
  id: 'managed-drift-detect',
  // 07:00 UTC — before the 08:00 digest, so a mailbox found this morning is
  // in the summary the owner reads an hour later rather than waiting a day.
  cron: '0 7 * * *',
  run: async () => {
    const channel = notifierFromEnv(process.env, (m) => log.warn(m));
    const decisions = new PgDecisionStore(db);

    const { rows: tenants } = await pool.query<TenantRow>(
      `SELECT id, name FROM tenant WHERE status = 'active'`,
    );

    let raised = 0;
    let alreadyPending = 0;
    let blindSpots = 0;

    for (const tenant of tenants) {
      // What this tenant's mappings cover, straight from the ledger.
      const { rows: coverage } = await pool.query<CoverageRow>(
        `SELECT mb.primary_address, mm.id AS mapping_id
           FROM mailbox_mapping mm
           JOIN mailbox mb ON mb.id = mm.source_mailbox_id
          WHERE mm.tenant_id = $1`,
        [tenant.id],
      );
      if (coverage.length === 0) continue; // nothing migrating; nothing to compare against

      const covered = coverage
        .map((r) => r.primary_address?.trim().toLowerCase())
        .filter((a): a is string => Boolean(a));
      const unstated = coverage.filter((r) => !r.primary_address?.trim()).map((r) => r.mapping_id);

      // The Graph tenant this source belongs to. Stored on the connection,
      // because the app registration is per O365 tenant, not per mapping.
      const { rows: connections } = await pool.query<{ config: unknown }>(
        `SELECT config FROM connection
          WHERE tenant_id = $1 AND role = 'source' AND kind = 'o365' LIMIT 1`,
        [tenant.id],
      );
      const graphTenantId = (connections[0]?.config as { tenantId?: string } | undefined)?.tenantId;

      const summary = await runNewMailboxDetection({
        tenantId: asTenantId(tenant.id),

        listDirectory: async (): Promise<DirectoryListing> => {
          // Three preconditions, each with its own reason and its own fix —
          // told apart in `directory-availability.ts`, where they are tested.
          const available = directoryAvailability(process.env, graphTenantId);
          if (!available.ok) {
            return { kind: 'not_enumerable', reason: directoryNotEnumerable(available.reason) };
          }
          const tokenProvider = createTokenProvider({
            tokenEndpoint: `https://login.microsoftonline.com/${graphTenantId!}/oauth2/v2.0/token`,
            clientId: available.clientId,
            clientSecret: available.clientSecret,
            tenantId: graphTenantId!,
            scope: 'https://graph.microsoft.com/.default',
          });
          return listTenantMailboxes(
            async () => (await tokenProvider.getToken()).accessToken,
            httpClient,
            { applicationPermissions: true },
          );
        },

        coveredAddresses: async () => covered,

        coverageIncomplete: async () =>
          unstated.length > 0 ? coverageIncompleteReason(unstated) : undefined,

        // Dismissed subjects are not asked about again. Read per run rather
        // than cached: the owner may have dismissed one since the last pass.
        dismissedAddresses: async () =>
          (await decisions.list(asTenantId(tenant.id), { status: 'dismissed' }))
            .filter((d) => d.category === 'new_mailbox')
            // `subjectKey` is optional on the row (some categories have no
            // natural subject); ours always sets it, and a row without one
            // cannot match an address anyway.
            .map((d) => d.subjectKey)
            .filter((k): k is string => Boolean(k)),

        raise: async (input) => {
          const { created } = await decisions.raise(input);
          return { created };
        },

        // 0030 T2's `decision_raised` finally has a live source.
        onRaised: async (input) => {
          await channel.notifier.notify(
            renderEvent({ kind: 'decision_raised', summary: input.summary }, channel.locale),
          );
        },

        warn: (m) => log.warn(m),
        error: (m, err) => log.error(m, err instanceof Error ? err.message : err),
      });

      raised += summary.raised;
      alreadyPending += summary.alreadyPending;
      if (summary.blindSpot) blindSpots++;
    }

    const result = { tenants: tenants.length, raised, alreadyPending, blindSpots };
    log.info('[drift-detect]', result);
    return result;
  },
});
