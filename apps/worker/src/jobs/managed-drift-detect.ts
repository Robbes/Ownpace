// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The managed drift detector (workplan 0028 T2, the wiring half).
 *
 * The rules live in `@openmig/core` — `runNewMailboxDetection` decides what
 * happens around a detection pass, `detectNewMailboxes` decides what to raise,
 * and both are tested without a database. THIS FILE IS ONLY THE WIRING: where
 * each read goes (below), the token, the decision store, the notifier and the
 * schedule.
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
 *
 * WHY IT CROSSES ORGANISATIONS, AND WHAT IT READS OF EACH (workplan 0138 T2,
 * open question 3 answered 2026-09-28, "split them"). One question spans
 * organisations: which ones are active, so that each one's directory is
 * compared with what it migrates. `activeOrganisations` (task-pools.ts)
 * answers it with ids, on the owner's connection, and nothing more.
 * Everything else is one organisation's, and is read and written in that
 * organisation's scope on the tenant pool, `app_user`, under row security
 * (`openTaskPools`): the addresses its migrations cover, its Microsoft sources
 * (whose Graph tenant the directory is asked of), the decisions it dismissed
 * and its standing preset, and the decisions this raises and closes. Until T2
 * all of it ran on the owner's pool, a superuser whom row security never
 * binds, and what kept one organisation's rows from another's was each
 * query's own `tenant_id`; the queries still carry it, and the scope is the
 * second net. `driftOfOrganisation` is that half, exported so
 * `a-job-that-reads-each-organisation-as-itself` runs it on the pools the job
 * opens, with the directory answered there instead of by Microsoft.
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
import { PgDecisionStore, PgPolicyPresetStore, tenantScopedDb, withTenant } from '@openmig/ledger';
import { log, renderEvent, asTenantId, type DirectoryListing, type RaiseDecisionInput } from '@openmig/shared';
import {
  createTokenProvider,
  listTenantMailboxes,
  notifierFromEnv,
  directoryNotEnumerable,
  directoryAvailability,
  type DirectoryEnv,
} from '@openmig/connectors';
import { runNewMailboxDetection, coverageIncompleteReason, type DetectionSummary } from '@openmig/core';
import {
  directorySourceOf,
  microsoftSourceKinds,
} from '@openmig/orchestration/source-face-builders';
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

interface CoverageRow {
  readonly primary_address: string | null;
  readonly mapping_id: string;
}

/** A tenant's Microsoft source, as the lookup below reads it. */
export interface MicrosoftSourceRow {
  readonly kind: string;
  readonly config: unknown;
}

/**
 * What one organisation's migrations cover: each mapping's source mailbox and
 * its address. Run in that organisation's scope (0138 T2), and filtered by it.
 */
export const coverageSql = (tenantId: string): SQL =>
  sql`SELECT mb.primary_address, mm.id AS mapping_id
        FROM mailbox_mapping mm
        JOIN mailbox mb ON mb.id = mm.source_mailbox_id
       WHERE mm.tenant_id = ${tenantId}`;

/**
 * THE TENANT'S MICROSOFT SOURCES, by every Microsoft kind (workplan 0141 T11):
 * `microsoftSourceKinds()`. This asked `kind = 'o365'` alone, so a tenant
 * whose source was a Microsoft account was told it had no Microsoft 365 source
 * connection. Exported for the guards, which run it on the ledger. Run in the
 * organisation's scope (0138 T2), and filtered by it.
 */
export const microsoftSourcesSql = (tenantId: string): SQL =>
  sql`SELECT kind, config FROM connection
       WHERE tenant_id = ${tenantId} AND role = 'source' AND kind IN ${[...microsoftSourceKinds()]}`;

/**
 * The directory of one tenant's Microsoft source, or why it cannot be read.
 * Exported for the guard (workplan 0141 T11).
 */
export async function listDirectoryOf(
  source: MicrosoftSourceRow | undefined,
  env: DirectoryEnv = process.env,
): Promise<DirectoryListing> {
  // The Graph tenant this source belongs to. Stored on the connection,
  // because the app registration is per O365 tenant, not per mapping.
  const graphTenantId = (source?.config as { tenantId?: string } | undefined)?.tenantId;
  // Four preconditions, each with its own reason and its own fix, told apart
  // in `directory-availability.ts`, where they are tested. The first is the
  // source's kind: an account's grant is delegated.
  const available = directoryAvailability(env, graphTenantId, source?.kind);
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
}

/** What one organisation's detection asks outside the database: its directory, and who hears of a decision. */
export interface DriftEdges {
  /** The directory of the organisation's Microsoft source: {@link listDirectoryOf}, in the task. */
  listDirectory(source: MicrosoftSourceRow | undefined): Promise<DirectoryListing>;
  onRaised(input: RaiseDecisionInput): Promise<void>;
  warn(message: string): void;
  error(message: string, err: unknown): void;
}

/**
 * One organisation's detection, every read and write in its own scope on the
 * tenant pool (0138 T2): what its migrations cover and its Microsoft sources
 * in one `withTenant`, and the decision and preset stores on
 * `tenantScopedDb`, one scope per statement, so no transaction stays open
 * while the directory is asked. `undefined` when it migrates nothing: there is
 * nothing to compare against.
 */
export async function driftOfOrganisation(
  pool: Pool,
  organisation: string,
  edges: DriftEdges,
): Promise<DetectionSummary | undefined> {
  const tenantId = asTenantId(organisation);
  // What this organisation's mappings cover, straight from the ledger, and
  // the source whose directory is compared with it.
  const { coverage, microsoftSources } = await withTenant(pool, organisation, async (db) => ({
    coverage: rowsOf<CoverageRow>(await db.execute(coverageSql(organisation))),
    microsoftSources: rowsOf<MicrosoftSourceRow>(await db.execute(microsoftSourcesSql(organisation))),
  }));
  if (coverage.length === 0) return undefined; // nothing migrating; nothing to compare against

  const covered = coverage
    .map((r) => r.primary_address?.trim().toLowerCase())
    .filter((a): a is string => Boolean(a));
  const unstated = coverage.filter((r) => !r.primary_address?.trim()).map((r) => r.mapping_id);
  const source = directorySourceOf(microsoftSources);

  const scoped = tenantScopedDb(pool, organisation);
  const decisions = new PgDecisionStore(scoped);
  const presets = new PgPolicyPresetStore(scoped);

  return runNewMailboxDetection({
    tenantId,

    listDirectory: () => edges.listDirectory(source),

    coveredAddresses: async () => covered,

    coverageIncomplete: async () =>
      unstated.length > 0 ? coverageIncompleteReason(unstated) : undefined,

    // Dismissed subjects are not asked about again. Read per run rather
    // than cached: the owner may have dismissed one since the last pass.
    dismissedAddresses: async () =>
      (await decisions.list(tenantId, { status: 'dismissed' }))
        .filter((d) => d.category === 'new_mailbox')
        // `subjectKey` is optional on the row (some categories have no
        // natural subject); ours always sets it, and a row without one
        // cannot match an address anyway.
        .map((d) => d.subjectKey)
        .filter((k): k is string => Boolean(k)),

    raise: async (input) => {
      const { created, decision } = await decisions.raise(input);
      return { created, id: decision.id };
    },

    // The tenant's standing answer, if it expressed one (0028 T5).
    presetAction: () => presets.get(tenantId, 'new_mailbox'),
    autoResolve: async (decisionId, input) => {
      await decisions.autoResolve(tenantId, decisionId, {
        // What closed it and why — the audit trail has to be able to
        // answer "who agreed to this?" six months from now.
        closedBy: 'policy_preset',
        preset: { category: 'new_mailbox', action: 'auto' },
        subject: input.subjectKey,
      });
    },

    onRaised: (input) => edges.onRaised(input),
    warn: (m) => edges.warn(m),
    error: (m, err) => edges.error(m, err),
  });
}

export const managedDriftDetect = schedules.task({
  id: 'managed-drift-detect',
  // 07:00 UTC — before the 08:00 digest, so a mailbox found this morning is
  // in the summary the owner reads an hour later rather than waiting a day.
  cron: '0 7 * * *',
  run: leavesAReference('managed-drift-detect', async (_payload: unknown, _context: unknown, afterwards) => {
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

    let raised = 0;
    let autoResolved = 0;
    let alreadyPending = 0;
    let blindSpots = 0;

    for (const organisation of organisations) {
      // Each organisation as itself, on the tenant pool.
      const summary = await driftOfOrganisation(pools.tenant, organisation, {
        listDirectory: (source) => listDirectoryOf(source),
        // 0030 T2's `decision_raised` finally has a live source.
        onRaised: async (input) => {
          await channel.notifier.notify(
            renderEvent({ kind: 'decision_raised', summary: input.summary }, channel.locale),
          );
        },
        warn: (m) => log.warn(m),
        error: (m, err) => log.error(m, err instanceof Error ? err.message : err),
      });
      if (!summary) continue;

      raised += summary.raised;
      autoResolved += summary.autoResolved;
      alreadyPending += summary.alreadyPending;
      if (summary.blindSpot) blindSpots++;
    }

    const result = { tenants: organisations.length, raised, autoResolved, alreadyPending, blindSpots };
    log.info('[drift-detect]', result);
    return result;
  }),
});
