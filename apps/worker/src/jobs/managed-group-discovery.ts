// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Managed shared-address discovery (workplan 0027 T1, the wiring half).
 *
 * The rules live in `@openmig/core` — `runGroupDiscovery` decides what happens
 * around a pass, `classifySharedAddress` decides what §14.1 pattern an address
 * is, and both are tested without a database. THIS FILE IS ONLY THE WIRING:
 * the Pool, the token, the `group_def` store and the schedule. It is the same
 * shape as `managed-drift-detect.ts` on purpose; the two run an hour apart and
 * differ in what they ask the directory, not in how.
 *
 * Groups are read per SOURCE CONNECTION rather than per tenant, because that
 * is what a discovered group's identity is keyed on: the same address found on
 * two sources being consolidated is genuinely two findings, and merging them
 * here would silently drop one organisation's member list.
 *
 * 06:30 UTC — before the 07:00 drift detector and the 08:00 digest, so a
 * shared address found this morning is in the summary the owner reads rather
 * than waiting a day.
 */

import { schedules } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { PgGroupDefStore, PgDecisionStore } from '@openmig/ledger';
import { log, renderEvent, asTenantId, type GroupListing } from '@openmig/shared';
import {
  createTokenProvider,
  listMailEnabledGroups,
  groupsNotEnumerable,
  notifierFromEnv,
  directoryAvailability,
} from '@openmig/connectors';
import { runGroupDiscovery } from '@openmig/core';
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

interface SourceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly config: unknown;
}

export const managedGroupDiscovery = schedules.task({
  id: 'managed-group-discovery',
  cron: '30 6 * * *',
  run: async () => {
    const channel = notifierFromEnv(process.env, (m) => log.warn(m));
    const groups = new PgGroupDefStore(db);
    const decisions = new PgDecisionStore(db);

    // Every Graph source across active tenants. An IMAP-only tenant has none
    // and is simply not visited — there is nothing here it could be asked,
    // and `listImapGroups()` says so wherever a caller does ask.
    const { rows: sources } = await pool.query<SourceRow>(
      `SELECT c.id, c.tenant_id, c.config
         FROM connection c
         JOIN tenant t ON t.id = c.tenant_id
        WHERE t.status = 'active' AND c.role = 'source' AND c.kind = 'o365'`,
    );

    let discovered = 0;
    let known = 0;
    let unclassified = 0;
    let asked = 0;
    let membersUnknown = 0;
    let blindSpots = 0;

    for (const source of sources) {
      const graphTenantId = (source.config as { tenantId?: string } | null)?.tenantId;

      const summary = await runGroupDiscovery({
        tenantId: asTenantId(source.tenant_id),
        sourceConnectionId: source.id,

        listGroups: async (): Promise<GroupListing> => {
          // Three preconditions, each with its own reason and its own fix —
          // told apart in `directory-availability.ts`, where they are tested.
          const available = directoryAvailability(process.env, graphTenantId);
          if (!available.ok) {
            return { kind: 'not_enumerable', reason: groupsNotEnumerable(available.reason) };
          }
          const tokenProvider = createTokenProvider({
            tokenEndpoint: `https://login.microsoftonline.com/${graphTenantId!}/oauth2/v2.0/token`,
            clientId: available.clientId,
            clientSecret: available.clientSecret,
            tenantId: graphTenantId!,
            scope: 'https://graph.microsoft.com/.default',
          });
          return listMailEnabledGroups(
            async () => (await tokenProvider.getToken()).accessToken,
            httpClient,
            { applicationPermissions: true },
          );
        },

        record: async (input) => {
          const { created } = await groups.upsert(asTenantId(source.tenant_id), input);
          return { created };
        },

        // The S-or-D question, for an address the source did not classify
        // (workplan 0028 T3) — the second category the decision queue was
        // scoped to carry, and the one §14.1 was designed to ask.
        raise: async (input) => {
          const { created, decision } = await decisions.raise(input);
          return { created, id: decision.id };
        },
        onRaised: async (input) => {
          await channel.notifier.notify(
            renderEvent({ kind: 'decision_raised', summary: input.summary }, channel.locale),
          );
        },

        warn: (m) => log.warn(m),
        error: (m, err) => log.error(m, err instanceof Error ? err.message : err),
      });

      discovered += summary.discovered;
      known += summary.known;
      unclassified += summary.unclassified;
      asked += summary.asked;
      membersUnknown += summary.membersUnknown;
      if (summary.blindSpot) blindSpots++;
    }

    const result = {
      sources: sources.length,
      discovered,
      known,
      unclassified,
      asked,
      membersUnknown,
      blindSpots,
    };
    log.info('[group-discovery]', result);
    return result;
  },
});
