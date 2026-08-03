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
 * The counting is `summariseQueues` from shared, the same function the
 * appliance uses, so a number in a managed email and a number on the managed
 * screen cannot disagree. Every read is individually guarded and a failed
 * read becomes a BLIND SPOT carrying the database's own words, never a zero:
 * "I found nothing" and "I could not look" must not arrive as the same email
 * (hard rule 9), and `renderDigest` sends on a blind spot even when every
 * count is zero.
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
import {
  log,
  renderDigest,
  summariseQueues,
  reportsToDigest,
  readTenantNotificationPrefs,
  digestDueToday,
  createNotifier,
  asTenantId,
  asMappingId,
  type MappingAttention,
} from '@openmig/shared';
import { notifierFromEnv, smtpTransport } from '@openmig/connectors';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema: schemaPg });
const ledger = new PgLedger(db);

interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly settings: unknown;
}

interface MappingRow {
  readonly id: string;
  readonly status: string;
}

/** One count, or the reason it could not be taken. Never a silent zero. */
async function guarded<T>(
  what: string,
  read: () => Promise<T>,
  fallback: T,
  blindSpots: string[],
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    blindSpots.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

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
      return { tenants: 0, sent: 0, quiet: 0, notDue: 0, noRecipients: 0, reason: channel.config.reason };
    }
    const from = channel.config.settings.from;
    // ONE transport for the whole run: each tenant gets its own envelope (its
    // own recipients and its own language), but re-connecting per tenant would
    // re-do TLS for every customer on the box.
    const transport = smtpTransport(channel.config.smtp);
    const weekday = new Date().getDay();

    const { rows: tenants } = await pool.query<TenantRow>(
      `SELECT id, name, settings FROM tenant WHERE status = 'active'`,
    );

    let sent = 0;
    let quiet = 0;
    let notDue = 0;
    let noRecipients = 0;

    for (const tenant of tenants) {
      const prefs = readTenantNotificationPrefs(tenant.settings);
      const cadence = digestDueToday(prefs, weekday);
      if (!cadence) {
        notDue++;
        continue;
      }

      const { rows: recipientRows } = await pool.query<{ email: string }>(
        `SELECT email FROM tenant_member
          WHERE tenant_id = $1 AND status = 'active' AND role IN ('owner', 'admin')`,
        [tenant.id],
      );
      const to = recipientRows.map((r) => r.email).filter(Boolean);
      if (to.length === 0) {
        // Loud, not silent: a tenant whose last owner was removed has nobody
        // to tell, and that is an operator problem, not a quiet no-op.
        log.warn(
          `[digest] tenant ${tenant.id} (${tenant.name}) is due a ${cadence} digest but has ` +
            'no active owner or admin to send it to',
        );
        noRecipients++;
        continue;
      }

      const { rows: mappings } = await pool.query<MappingRow>(
        `SELECT id, status FROM mailbox_mapping WHERE tenant_id = $1`,
        [tenant.id],
      );

      const attention: MappingAttention[] = [];
      const decisions = new PgDecisionStore(db);
      let decisionsCounted = false;

      for (const mapping of mappings) {
        // A finished migration keeps its history but stops nagging — the
        // same rule the queue endpoints apply, checked before the reads.
        if (!reportsToDigest(mapping.status)) continue;
        const blindSpots: string[] = [];

        const tenantId = asTenantId(tenant.id);
        const mappingId = asMappingId(mapping.id);

        // The SAME ledger calls the appliance makes, so the counting below
        // is handed the same rows the queue screens list. Counting in SQL
        // instead would have been a second copy of the filters, free to
        // drift from the first.
        const deletions = await guarded(
          'the deletions queue',
          () => ledger.listDeletions(tenantId, mappingId),
          [],
          blindSpots,
        );
        const moves = await guarded(
          'the moves queue',
          () => ledger.listMoves(tenantId, mappingId),
          [],
          blindSpots,
        );
        const failures = await guarded(
          'the failures queue',
          () => ledger.listFailures(tenantId, mappingId),
          [],
          blindSpots,
        );
        // Tenant-level, not per mapping: a new mailbox belongs to no mapping
        // yet. Counted once so several mappings cannot each report the same
        // pending decision as if it were theirs.
        const pendingDecisions = decisionsCounted
          ? 0
          : (
              await guarded(
                'the decision queue',
                async () => [...(await decisions.list(tenantId, { status: 'pending' }))],
                [],
                blindSpots,
              )
            ).length;
        decisionsCounted = true;

        attention.push(
          summariseQueues(mapping.id, {
            deletions,
            moves,
            failures,
            pendingDecisions,
            status: mapping.status,
            blindSpots,
          }),
        );
      }

      const message = renderDigest(attention, prefs.locale, cadence);
      if (!message) {
        // The rule that makes this channel worth reading: nothing waiting,
        // no email at all.
        quiet++;
        continue;
      }

      try {
        await createNotifier(transport, { from, to, locale: prefs.locale }).notify(message);
        sent++;
      } catch (err) {
        // One tenant's mail server refusing must not stop the other tenants'
        // digests, and the failure is stated rather than counted as sent.
        log.error(
          `[digest] tenant ${tenant.id}: the ${cadence} digest failed to send:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const summary = { tenants: tenants.length, sent, quiet, notDue, noRecipients };
    log.info('[digest]', summary);
    return summary;
  },
});
