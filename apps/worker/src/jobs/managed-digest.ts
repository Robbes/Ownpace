// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The managed "what needs attention" digest (workplan 0030 T3/T4).
 *
 * The appliance schedules its own digest through croner (0030 T3). This is
 * the same summary for the managed edition, and the reason it looks different
 * is that managed is many tenants behind one operator's SMTP: WHO gets told
 * and HOW OFTEN are per-tenant facts, read from `tenant.settings` and
 * editable on the Tenants screen, not operator environment variables.
 *
 * ONE daily task rather than a task per cadence. Cadence is a preference a
 * customer changes in a dropdown; a scheduler whose jobs had to be
 * re-registered whenever somebody changed one would be a scheduler built out
 * of settings rows. So this runs every morning and asks each tenant whether
 * today is their day (`digestDueToday` — Monday for weekly).
 *
 * THIS FILE IS ONLY THE WIRING. Every decision — whose day it is, who gets
 * told, what counts, what a failed read means — lives in `runDigest`
 * (managed-digest-run.ts), where it is tested without a database. What is
 * here is where each read goes (below), the transport and the schedule.
 *
 * The counting is `summariseQueues` from shared, the same function the
 * appliance uses, so a number in a managed email and a number on the managed
 * screen cannot disagree.
 *
 * WHY IT CROSSES ORGANISATIONS, AND WHAT IT READS OF EACH (workplan 0138 T2,
 * open question 3 answered 2026-09-28, "split them"). One question spans
 * organisations: which ones are active, so that each is asked whether today
 * is its day. `activeOrganisations` (task-pools.ts) answers it with ids, on the
 * owner's connection, and nothing more. Everything else is one organisation's,
 * and is read and written in that organisation's scope on the tenant pool,
 * `app_user`, under row security (`openTaskPools`): its own row (its name, and
 * the notification settings that say whether and in which language), its
 * active owners and admins, its migrations and each one's queues (deletions,
 * moves, failures, auto-applied relocations, the sharing checklist, grace
 * periods nobody answered), its pending decisions, when its last digest went
 * out, and the audit row that records this one. Until T2 all of it ran on the
 * owner's pool, a superuser whom row security never binds, and what kept one
 * organisation's counts out of another's mail was each query's own
 * `tenant_id`. The queries still filter by tenant themselves; the scope is the
 * second net. `a-job-that-reads-each-organisation-as-itself` runs this half
 * on the pools the job opens.
 *
 * Its pools are opened in its run and ended in `afterwards`, after a failure
 * is on the operator's log page, whose sink is on the tenant pool (0138 T1
 * step 2's review): a daily job holds no pool between runs.
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { schedules } from '@trigger.dev/sdk';
import type { Pool } from 'pg';
import { sql, type SQL } from 'drizzle-orm';
import { leavesAReference } from './what-a-run-leaves.ts';
import { activeOrganisations, openTaskPools } from './task-pools.ts';
import { PgLedger, PgDecisionStore, readGraceEndedWithoutAChoice, tenantScopedDb, withTenant } from '@openmig/ledger';
import { log, createNotifier, asTenantId, asMappingId } from '@openmig/shared';
import { notifierFromEnv, smtpTransport } from '@openmig/connectors';
import { runDigest, type DigestDeps, type DigestTenant, type DigestMapping } from './managed-digest-run.ts';

/** The rows a statement answers in a scope: node-postgres carries them under `rows`. */
const rowsOf = <R>(result: unknown): R[] => (result as { rows: R[] }).rows;

/**
 * WHICH organisation, and WHO receives the mail.
 *
 * Extracted from the query bodies and exported so they can be held to a test
 * (0043 T2): they decide who gets emailed about a migration, and a wrong
 * predicate here reaches a customer rather than a log. Each is one
 * organisation's, run in that organisation's scope (0138 T2), and each still
 * filters by that organisation itself.
 *
 * The organisation's own row: its name and its notification settings. Which
 * organisations are active is the list's question, asked once across them all
 * (`activeOrganisations`); this reads the one the list named, as itself.
 */
export const digestOrganisationSql = (tenantId: string): SQL =>
  sql`SELECT id, name, settings FROM tenant WHERE id = ${tenantId}`;

/**
 * `status = 'active'` and `role IN ('owner','admin')`: a member who is neither
 * owner nor admin does not receive other people's migration counts, and a
 * deactivated one stops receiving them.
 */
export const digestRecipientsSql = (tenantId: string): SQL =>
  sql`SELECT email FROM tenant_member
            WHERE tenant_id = ${tenantId} AND status = 'active' AND role IN ('owner', 'admin')`;

/**
 * `name` is not decoration: it is how the email says WHICH migration.
 *
 * Named and exported for the same reason as the two above — the `runDigest`
 * tests fake `listMappings`, so a query that quietly stopped selecting `name`
 * would leave every one of them green while every owner went back to being
 * addressed by a UUID. That is precisely how this shipped (found in a live
 * mailbox, 2026-09-14), so the column is pinned in
 * `managed-digest-sql.unit.test.ts` rather than trusted.
 */
export const digestMappingsSql = (tenantId: string): SQL =>
  sql`SELECT id, name, status FROM mailbox_mapping WHERE tenant_id = ${tenantId}`;

/** What the digest reads and writes of organisations: all of `DigestDeps` but the clock, the mail and the log. */
export type DigestLedger = Omit<DigestDeps, 'weekday' | 'send' | 'warn' | 'error'>;

/**
 * The digest's reads and writes, on the tenant pool: the list of
 * organisations it is handed, and every one of them read as itself, each
 * statement in that organisation's scope (`withTenant`, or `tenantScopedDb`
 * for the ledger and the decision store, one scope per statement, 0138 T1).
 */
export function digestLedgerOn(pool: Pool, organisations: () => Promise<readonly string[]>): DigestLedger {
  // One ledger and one decision store per organisation, each of whose
  // statements runs in that organisation's scope.
  const scoped = new Map<string, { readonly ledger: PgLedger; readonly decisions: PgDecisionStore }>();
  const storesOf = (tenantId: string) => {
    let stores = scoped.get(tenantId);
    if (!stores) {
      const db = tenantScopedDb(pool, tenantId);
      stores = { ledger: new PgLedger(db), decisions: new PgDecisionStore(db) };
      scoped.set(tenantId, stores);
    }
    return stores;
  };
  const rowsIn = <R>(tenantId: string, query: SQL): Promise<R[]> =>
    withTenant(pool, tenantId, async (db) => rowsOf<R>(await db.execute(query)));

  return {
    listTenants: async () => {
      const found: DigestTenant[] = [];
      for (const id of await organisations()) {
        const [row] = await rowsIn<DigestTenant>(id, digestOrganisationSql(id));
        if (!row) {
          // The list named it, and its own scope reads no row for it: never a
          // quiet skip, which would be an organisation that stops hearing
          // about its migration with nothing to say why (hard rule 9).
          throw new Error(
            `[digest] organisation ${id} is on the list of active organisations, and its own row ` +
              'reads nothing in its own scope',
          );
        }
        found.push(row);
      }
      return found;
    },

    listRecipients: async (tenantId) =>
      (await rowsIn<{ email: string }>(tenantId, digestRecipientsSql(tenantId))).map((r) => r.email),

    listMappings: (tenantId) => rowsIn<DigestMapping>(tenantId, digestMappingsSql(tenantId)),

    // The SAME ledger calls the appliance makes, so the counting is handed
    // the rows the queue screens list. Counting in SQL instead would have
    // been a second copy of the filters, free to drift from the first.
    listDeletions: (tenantId, mappingId) =>
      storesOf(tenantId).ledger.listDeletions(asTenantId(tenantId), asMappingId(mappingId)),
    listMoves: (tenantId, mappingId) =>
      storesOf(tenantId).ledger.listMoves(asTenantId(tenantId), asMappingId(mappingId)),
    listFailures: (tenantId, mappingId) =>
      storesOf(tenantId).ledger.listFailures(asTenantId(tenantId), asMappingId(mappingId)),
    countAutoApplied: (tenantId, mappingId, since) =>
      storesOf(tenantId).ledger.countAuditEvents(asTenantId(tenantId), {
        actor: 'system:auto-apply',
        action: 'auto_apply_relocation',
        since,
        mappingId,
      }),
    // Open checklist rows, counted from the same table the Sharing screen
    // reads (ADR-0032) — the digest and the page cannot disagree.
    countSharingOpen: async (tenantId, mappingId) =>
      (await storesOf(tenantId).ledger.listShareGrants(asTenantId(tenantId), asMappingId(mappingId))).filter(
        (g) => g.state === 'open',
      ).length,
    // A grace period that ended while nobody chose (0128 D7), by the rows
    // the Finish page offers, in the organisation's own transaction.
    graceEndedWithoutAChoice: async (tenantId, mappingId) =>
      (await withTenant(pool, tenantId, (tdb) => readGraceEndedWithoutAChoice(tdb, tenantId, mappingId))).map(
        (g) => g.domain,
      ),
    lastDigestSentAt: (tenantId, cadence) =>
      storesOf(tenantId).ledger.latestAuditEventAt(asTenantId(tenantId), {
        actor: 'system:digest',
        action: `digest_sent_${cadence}`,
      }),
    recordDigestSent: (tenantId, cadence) =>
      storesOf(tenantId).ledger.recordAuditEvent(asTenantId(tenantId), {
        actor: 'system:digest',
        action: `digest_sent_${cadence}`,
      }),
    countPendingDecisions: async (tenantId) =>
      (await storesOf(tenantId).decisions.list(asTenantId(tenantId), { status: 'pending' })).length,
  };
}

export const managedDigest = schedules.task({
  id: 'managed-digest',
  // 08:00 UTC. Morning on purpose: a summary that lands at 03:00 is read
  // twelve hours late, and the whole point is reaching somebody before their
  // day starts.
  cron: '0 8 * * *',
  run: leavesAReference('managed-digest', async (_payload: unknown, _context: unknown, afterwards) => {
    // This run's pools (0138 T1, T2): the tenant pool on APP_DATABASE_URL,
    // app_user, under row security, and the audit key's pool of one. It points
    // the sinks too: the operator's log page at the tenant pool, the audit
    // lines at the key's. Opened first, so even a refusal below reaches the
    // log page, and ended once the run is over, after its failure is recorded.
    const pools = openTaskPools();
    afterwards(() => pools.end());
    const channel = notifierFromEnv(process.env, (m) => log.warn(m));
    if (!channel.config.enabled) {
      // Said out loud every morning rather than returning quietly: an
      // operator who believes their customers are being emailed when no SMTP
      // is configured is exactly the person rule 9 protects.
      log.warn(`[digest] not sending — ${channel.config.reason}`);
      return {
        tenants: 0,
        sent: 0,
        quiet: 0,
        notDue: 0,
        noRecipients: 0,
        failed: 0,
        reason: channel.config.reason,
      };
    }
    const from = channel.config.settings.from;
    // ONE transport for the whole run: each tenant gets its own envelope (its
    // own recipients and its own language), but re-connecting per tenant would
    // re-do TLS for every customer on the box.
    const transport = smtpTransport(channel.config.smtp);

    const summary = await runDigest({
      weekday: new Date().getDay(),
      // The one question across organisations, on the owner's connection; the
      // rest of it, each organisation as itself, on the tenant pool.
      ...digestLedgerOn(pools.tenant, () => activeOrganisations()),

      send: (to, locale, message) =>
        createNotifier(transport, { from, to, locale }).notify(message),

      warn: (message) => log.warn(message),
      error: (message, err) => log.error(message, err instanceof Error ? err.message : err),
    });

    log.info('[digest]', summary);
    return summary;
  }),
});
