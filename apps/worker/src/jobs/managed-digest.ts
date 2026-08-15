// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
 * here is the Pool, the ledger, the transport and the schedule.
 *
 * The counting is `summariseQueues` from shared, the same function the
 * appliance uses, so a number in a managed email and a number on the managed
 * screen cannot disagree.
 *
 * The trust boundary is the one `managed-sync-tick` documents: the owner
 * `DATABASE_URL` connection bypasses RLS for this system-level enumeration
 * across tenants. Every query below is still explicitly scoped by
 * `tenant_id` — the digest for one tenant must never count another's work.
 */

import { schedules } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { PgLedger, PgDecisionStore } from '@openmig/ledger';
import { log, createNotifier, asTenantId, asMappingId } from '@openmig/shared';
import { notifierFromEnv, smtpTransport } from '@openmig/connectors';
import { runDigest, type DigestTenant, type DigestMapping } from './managed-digest-run';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema: schemaPg });
const ledger = new PgLedger(db);
const decisions = new PgDecisionStore(db);

/**
 * WHICH tenants are considered, and WHO receives the mail.
 *
 * Extracted from the query bodies and exported so they can be held to a test
 * (0043 T2). Everything else in this file is wiring — a Pool, a cron string, a
 * transport — where a mocked test would assert the mocks. These two are not
 * wiring: they decide who gets emailed about a migration, and a wrong predicate
 * here reaches a customer rather than a log.
 *
 * `status = 'active'` on both, and `role IN ('owner','admin')` on the second:
 * a suspended tenant is not emailed, and a member who is neither owner nor
 * admin does not receive other people's migration counts.
 */
export const ACTIVE_TENANTS_SQL = `SELECT id, name, settings FROM tenant WHERE status = 'active'`;

export const DIGEST_RECIPIENTS_SQL = `SELECT email FROM tenant_member
            WHERE tenant_id = $1 AND status = 'active' AND role IN ('owner', 'admin')`;

export const managedDigest = schedules.task({
  id: 'managed-digest',
  // 08:00 UTC. Morning on purpose: a summary that lands at 03:00 is read
  // twelve hours late, and the whole point is reaching somebody before their
  // day starts.
  cron: '0 8 * * *',
  run: async () => {
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

      listTenants: async () => {
        const { rows } = await pool.query<DigestTenant>(ACTIVE_TENANTS_SQL);
        return rows;
      },

      listRecipients: async (tenantId) => {
        const { rows } = await pool.query<{ email: string }>(DIGEST_RECIPIENTS_SQL, [tenantId]);
        return rows.map((r) => r.email);
      },

      listMappings: async (tenantId) => {
        const { rows } = await pool.query<DigestMapping>(
          `SELECT id, status FROM mailbox_mapping WHERE tenant_id = $1`,
          [tenantId],
        );
        return rows;
      },

      // The SAME ledger calls the appliance makes, so the counting is handed
      // the rows the queue screens list. Counting in SQL instead would have
      // been a second copy of the filters, free to drift from the first.
      listDeletions: (tenantId, mappingId) =>
        ledger.listDeletions(asTenantId(tenantId), asMappingId(mappingId)),
      listMoves: (tenantId, mappingId) =>
        ledger.listMoves(asTenantId(tenantId), asMappingId(mappingId)),
      listFailures: (tenantId, mappingId) =>
        ledger.listFailures(asTenantId(tenantId), asMappingId(mappingId)),
      countPendingDecisions: async (tenantId) =>
        (await decisions.list(asTenantId(tenantId), { status: 'pending' })).length,

      send: (to, locale, message) =>
        createNotifier(transport, { from, to, locale }).notify(message),

      warn: (message) => log.warn(message),
      error: (message, err) => log.error(message, err instanceof Error ? err.message : err),
    });

    log.info('[digest]', summary);
    return summary;
  },
});
