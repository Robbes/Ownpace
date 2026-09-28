// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Managed shared-address discovery (workplan 0027 T1, the wiring half).
 *
 * The rules live in `@openmig/core` — `runGroupDiscovery` decides what happens
 * around a pass, `classifySharedAddress` decides what §14.1 pattern an address
 * is, and both are tested without a database. THIS FILE IS ONLY THE WIRING:
 * where each read goes (below), the token, the `group_def` store and the
 * schedule. It is the same shape as `managed-drift-detect.ts` on purpose; the
 * two run an hour apart and differ in what they ask the directory, not in how.
 *
 * Groups are read per SOURCE CONNECTION rather than per tenant, because that
 * is what a discovered group's identity is keyed on: the same address found on
 * two sources being consolidated is genuinely two findings, and merging them
 * here would silently drop one organisation's member list.
 *
 * 06:30 UTC — before the 07:00 drift detector and the 08:00 digest, so a
 * shared address found this morning is in the summary the owner reads rather
 * than waiting a day.
 *
 * WHY IT CROSSES ORGANISATIONS, AND WHAT IT READS OF EACH (workplan 0138 T2,
 * open question 3 answered 2026-09-28, "split them"). One question spans
 * organisations: which ones are active, so that each one's sources are asked
 * for their shared addresses. `activeOrganisations` (task-pools.ts) answers it
 * with ids, on the owner's connection, and nothing more. Until T2 the question
 * asked across organisations was a wider one: every source connection of every
 * active organisation, with its `config`, on the owner's pool. A connection's
 * config is that organisation's own (its Graph tenant, for some kinds its
 * stored account), so it is now read in that organisation's scope, with the
 * rest: its source connections, the groups this records and the decisions it
 * raises, on the tenant pool, `app_user`, under row security
 * (`openTaskPools`). The iteration is still per source connection, within each
 * organisation. The queries still filter by tenant themselves; the scope is
 * the second net. `groupsOfOrganisation` is that half, exported so
 * `a-job-that-reads-each-organisation-as-itself` runs it on the pools the job
 * opens, with the groups answered there instead of by Microsoft.
 *
 * Its pools are opened in its run and ended in `afterwards`, after a failure
 * is on the operator's log page, whose sink is on the tenant pool: a daily job
 * holds no pool between runs.
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { schedules } from '@trigger.dev/sdk';
import type { Pool } from 'pg';
import { sql, type SQL } from 'drizzle-orm';
import { leavesAReference } from './what-a-run-leaves.ts';
import { activeOrganisations, openTaskPools } from './task-pools.ts';
import { PgGroupDefStore, PgDecisionStore, tenantScopedDb, withTenant } from '@openmig/ledger';
import { log, renderEvent, asTenantId, type GroupListing, type RaiseDecisionInput } from '@openmig/shared';
import {
  createTokenProvider,
  listMailEnabledGroups,
  listImapGroups,
  groupsNotEnumerable,
  notifierFromEnv,
  directoryAvailability,
  type DirectoryEnv,
} from '@openmig/connectors';
import { runGroupDiscovery } from '@openmig/core';
import { microsoftSourceKinds } from '@openmig/orchestration/source-face-builders';
import type { HttpClient } from '@openmig/connectors';

/** The rows a statement answers in a scope: node-postgres carries them under `rows`. */
const rowsOf = <R>(result: unknown): R[] => (result as { rows: R[] }).rows;

/** The one HTTP client this task needs; Graph speaks plain JSON over fetch. */
const httpClient: HttpClient = {
  async request({ url, method, headers }) {
    const res = await fetch(url, { method, headers });
    return { status: res.status, body: await res.text(), headers: {} };
  },
};

interface SourceRow {
  readonly id: string;
  readonly kind: string;
  readonly config: unknown;
}

/**
 * EVERY source of one organisation, not only the Graph ones.
 *
 * This used to select `kind = 'o365'` alone, which meant an IMAP-only tenant
 * was never visited: no rows, no warning, no reason — and silence reads
 * exactly like "this organisation has no shared addresses". IMAP sources are
 * included and handed `listImapGroups()`, which always refuses with the
 * reason, so the blind spot is stated every run (hard rule 9) through the same
 * path the drift detector uses. Run in the organisation's scope (0138 T2), and
 * filtered by it.
 */
export const sourcesSql = (tenantId: string): SQL =>
  sql`SELECT id, kind, config FROM connection
       WHERE tenant_id = ${tenantId} AND role = 'source'
       ORDER BY id`;

/**
 * The groups of one source, or why they cannot be listed. Exported for the
 * guard (workplan 0141 T11).
 */
export async function listGroupsOf(
  source: Pick<SourceRow, 'kind' | 'config'>,
  env: DirectoryEnv = process.env,
): Promise<GroupListing> {
  // A source with no directory at all answers first, in its own words: no
  // amount of configuration makes IMAP enumerable. A Microsoft source is found
  // by every Microsoft kind (0141 T11); this branch named `o365` alone, so a
  // Microsoft account was answered in IMAP's words.
  if (!microsoftSourceKinds().includes(source.kind)) return listImapGroups();
  const graphTenantId = (source.config as { tenantId?: string } | null)?.tenantId;
  // Four preconditions, each with its own reason and its own fix, told apart
  // in `directory-availability.ts`, where they are tested. The first is the
  // source's kind: an account's grant is delegated.
  const available = directoryAvailability(env, graphTenantId, source.kind);
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
}

/** What one organisation's discovery asks outside the database: each source's groups, and who hears of a question. */
export interface GroupEdges {
  /** The groups of one of the organisation's sources: {@link listGroupsOf}, in the task. */
  listGroups(source: Pick<SourceRow, 'kind' | 'config'>): Promise<GroupListing>;
  onRaised(input: RaiseDecisionInput): Promise<void>;
  warn(message: string): void;
  error(message: string, err: unknown): void;
}

/** One organisation's discovery, summed over its sources. */
export interface OrganisationGroups {
  readonly sources: number;
  readonly discovered: number;
  readonly known: number;
  readonly unclassified: number;
  readonly asked: number;
  readonly membersUnknown: number;
  readonly blindSpots: number;
}

/**
 * One organisation's discovery, every read and write in its own scope on the
 * tenant pool (0138 T2): its source connections in one `withTenant`, and the
 * `group_def` and decision stores on `tenantScopedDb`, one scope per
 * statement, so no transaction stays open while a source is asked.
 */
export async function groupsOfOrganisation(
  pool: Pool,
  organisation: string,
  edges: GroupEdges,
): Promise<OrganisationGroups> {
  const tenantId = asTenantId(organisation);
  const sources = await withTenant(pool, organisation, async (db) =>
    rowsOf<SourceRow>(await db.execute(sourcesSql(organisation))),
  );
  const scoped = tenantScopedDb(pool, organisation);
  const groups = new PgGroupDefStore(scoped);
  const decisions = new PgDecisionStore(scoped);

  let discovered = 0;
  let known = 0;
  let unclassified = 0;
  let asked = 0;
  let membersUnknown = 0;
  let blindSpots = 0;

  for (const source of sources) {
    const summary = await runGroupDiscovery({
      tenantId,
      sourceConnectionId: source.id,

      listGroups: () => edges.listGroups(source),

      record: async (input) => {
        const { created } = await groups.upsert(tenantId, input);
        return { created };
      },

      // The S-or-D question, for an address the source did not classify
      // (workplan 0028 T3) — the second category the decision queue was
      // scoped to carry, and the one §14.1 was designed to ask.
      raise: async (input) => {
        const { created, decision } = await decisions.raise(input);
        return { created, id: decision.id };
      },
      onRaised: (input) => edges.onRaised(input),

      warn: (m) => edges.warn(m),
      error: (m, err) => edges.error(m, err),
    });

    discovered += summary.discovered;
    known += summary.known;
    unclassified += summary.unclassified;
    asked += summary.asked;
    membersUnknown += summary.membersUnknown;
    if (summary.blindSpot) blindSpots++;
  }

  return { sources: sources.length, discovered, known, unclassified, asked, membersUnknown, blindSpots };
}

export const managedGroupDiscovery = schedules.task({
  id: 'managed-group-discovery',
  cron: '30 6 * * *',
  run: leavesAReference('managed-group-discovery', async (_payload: unknown, _context: unknown, afterwards) => {
    // This run's pools (0138 T1, T2): the tenant pool on APP_DATABASE_URL,
    // app_user, under row security, and the audit key's pool of one. It points
    // the sinks too: the operator's log page at the tenant pool, the audit
    // lines at the key's. Opened first, so even the list's refusal reaches the
    // log page, and ended once the run is over, after its failure is recorded.
    const pools = openTaskPools();
    afterwards(() => pools.end());
    const channel = notifierFromEnv(process.env, (m) => log.warn(m));

    // The one question across organisations, on the owner's connection.
    const organisations = await activeOrganisations();

    const result = {
      sources: 0,
      discovered: 0,
      known: 0,
      unclassified: 0,
      asked: 0,
      membersUnknown: 0,
      blindSpots: 0,
    };
    for (const organisation of organisations) {
      // Each organisation as itself, on the tenant pool.
      const summary = await groupsOfOrganisation(pools.tenant, organisation, {
        listGroups: (source) => listGroupsOf(source),
        onRaised: async (input) => {
          await channel.notifier.notify(
            renderEvent({ kind: 'decision_raised', summary: input.summary }, channel.locale),
          );
        },
        warn: (m) => log.warn(m),
        error: (m, err) => log.error(m, err instanceof Error ? err.message : err),
      });
      for (const key of Object.keys(result) as Array<keyof typeof result>) result[key] += summary[key];
    }

    log.info('[group-discovery]', result);
    return result;
  }),
});
