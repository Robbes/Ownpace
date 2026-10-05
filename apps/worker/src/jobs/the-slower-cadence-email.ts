// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A SLOWER CADENCE, SAID ONCE (workplan 0157 T7; the owner, 2026-10-05: *"sync
 * slow down once a migration is in step: yes"*, each step said in the app and
 * by email: *"Everything is in step. We now look every 6 hours; choose more
 * often any time."*).
 *
 * A migration with no schedule of its own looks every hour for 14 days, then
 * every 6 hours, then once a day from 30 days, counted from the later of when
 * its first copy finished and its last visit (`automaticStep`,
 * `automaticSince`). This is one organisation's half of the morning job
 * (`managed-cadence-email.ts`), in that organisation's own scope:
 *
 * 1. **Not on Free, outside the alpha.** There a migration runs one pass a day
 *    whatever its cadence (0157 T2), which the app and the first-copy email
 *    say (T5): a step would be no news, and *"every 6 hours"* untrue. A step
 *    said there before, on a higher tier, is no longer in force, and its row
 *    goes.
 * 2. **Whose step went down.** Each migration with no schedule that runs
 *    passes, as the tick reads them (running, its grant not taken back), whose
 *    every data type that runs passes has finished its first copy. The step is
 *    the tick's: the same days, counted from the same two moments. And
 *    *everything is in step* is said only when it is: a data type still
 *    waiting for its first copy says nothing, even where the tick already
 *    looks less often.
 * 3. **Once.** The claim on managed 0043's `migration_cadence_said`: the step,
 *    and what its days counted from. An insert, or an update when either
 *    changed, so a step is said once, and a later one, or the same one counted
 *    from a later visit, is news again. A row whose step is no longer in force
 *    is deleted, so the rows are the slower steps in force, as said. A visit
 *    deletes one too, and says on the migration's page what it brought back
 *    (`visits.ts` in the API).
 * 4. **To whom.** The organisation's active owners and admins, in its
 *    language, as the first-copy email and the digest read them.
 *
 * The claim is made before the send and stands whatever the send does, as the
 * first-copy email's does: a step is something that happened, and a channel
 * switched on next week must not tell anyone then about today.
 */
import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger';
import { migrationCadenceSaid } from '@openmig/managed/schema-managed';
import { billedTierNow, FREE_PASS_EVERY_MINUTES, holdsAtCeiling, leastMinutesBetweenPasses } from '@openmig/managed';
import { automaticSince, automaticStep } from '@openmig/orchestration/sync-due';
import {
  PASS_RUNNING_STATES,
  readTenantNotificationPrefs,
  type NotificationEvent,
  type NotificationLocale,
  type TenantId,
} from '@openmig/shared';

/** A step the automatic cadence says: its two slower ones. */
export type SlowerStep = 'six-hourly' | 'daily';

/** One migration whose cadence stepped down, as the mail names it. */
type SteppedDown = Extract<NotificationEvent, { kind: 'looking_less_often' }>['migrations'][number];

/** What one organisation's claim came to. */
export type SlowerCadenceClaim =
  /** On Free, outside the alpha: one pass a day whatever the cadence, so no step to say. */
  | { readonly kind: 'free_pace'; readonly cleared: number }
  /** Nothing stepped down since it was last said. */
  | { readonly kind: 'none'; readonly cleared: number }
  /** Claimed: these are to be said. */
  | { readonly kind: 'claimed'; readonly cleared: number; readonly migrations: readonly SteppedDown[] };

/** The rows a statement answers in a scope: node-postgres carries them under `rows`. */
const rowsOf = <R>(result: unknown): R[] => (result as { rows: R[] }).rows;

/** A time as Postgres hands it to node-postgres or PGlite: a Date, or text. */
const asDate = (v: Date | string | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v));

/**
 * Each migration of this organisation on the automatic cadence that runs
 * passes, with what its step counts from. `in_step`: every included data type
 * that runs passes has finished a pass over everything (`completed_at`), as
 * the tick's `FIRST_COPY_UNFINISHED` reads a data type that runs passes, and
 * without its two exceptions, so a data type that waits is never *in step*.
 * `first_copy_done_at`: the newest of those first passes, the tick's own
 * expression. In the mail's order: by person, then by name. Exported so the
 * tests read the statement they run.
 */
export const automaticMigrationsSql = (tenantId: string) =>
  sql`SELECT m.id, m.name, p.display_name AS person,
             bool_and(ms.completed_at IS NOT NULL
                      OR pl.stopped_at IS NOT NULL
                      OR NOT (COALESCE(pl.state, m.status) = ANY(${sql.param([...PASS_RUNNING_STATES])}::text[]))) AS in_step,
             max(ms.completed_at) AS first_copy_done_at,
             v.visited_at
        FROM mailbox_mapping m
        JOIN scope_selection s
          ON s.tenant_id = m.tenant_id AND s.mapping_id = m.id AND s.included
        LEFT JOIN path_lifecycle pl
          ON pl.tenant_id = s.tenant_id AND pl.mapping_id = s.mapping_id AND pl.domain = s.domain
        LEFT JOIN migration_status ms
          ON ms.tenant_id = s.tenant_id AND ms.mapping_id = s.mapping_id AND ms.domain = s.domain
        LEFT JOIN migration_visit v
          ON v.tenant_id = m.tenant_id AND v.mapping_id = m.id
        LEFT JOIN person_migration pm
          ON pm.tenant_id = m.tenant_id AND pm.mapping_id = m.id
        LEFT JOIN person p
          ON p.tenant_id = pm.tenant_id AND p.id = pm.person_id
       WHERE m.tenant_id = ${tenantId}
         AND m.schedule IS NULL
         AND m.status = ANY(${sql.param([...PASS_RUNNING_STATES])}::text[])
         AND m.grant_withdrawn_at IS NULL
       GROUP BY m.id, m.name, p.display_name, v.visited_at
       -- The mail's order: by person, then by the migration's name.
       ORDER BY p.display_name NULLS LAST, m.name, m.id`;

interface AutomaticRow {
  readonly id: string;
  readonly name: string | null;
  readonly person: string | null;
  readonly in_step: boolean;
  readonly first_copy_done_at: Date | string | null;
  readonly visited_at: Date | string | null;
}

/**
 * One organisation's slower steps, claimed, in its own scope: `db` is the
 * handle `withTenant` gives. Reads, deletes and claims in that one
 * transaction, and sends nothing: the caller does, after it commits, to
 * `whomToTell`.
 */
export async function claimSlowerSteps(
  db: PgDatabase,
  tenantId: string,
  now: Date,
  stage: string | undefined = process.env.OWNPACE_STAGE,
): Promise<SlowerCadenceClaim> {
  const clearAll = async (): Promise<number> =>
    (
      await db
        .delete(migrationCadenceSaid)
        .where(eq(migrationCadenceSaid.tenantId, tenantId))
        .returning({ mappingId: migrationCadenceSaid.mappingId })
    ).length;

  // 1. Free's pace, outside the alpha, by the tier the month bills.
  if (
    holdsAtCeiling(stage) &&
    leastMinutesBetweenPasses(await billedTierNow(db, tenantId as TenantId, now), stage) >= FREE_PASS_EVERY_MINUTES
  ) {
    return { kind: 'free_pace', cleared: await clearAll() };
  }

  // 2. Whose step went down: the tick's step, said only when in step.
  const rows = rowsOf<AutomaticRow>(await db.execute(automaticMigrationsSql(tenantId)));
  const slower: Array<{ row: AutomaticRow; step: SlowerStep; countedFrom: Date }> = [];
  for (const row of rows) {
    const doneAt = asDate(row.first_copy_done_at);
    if (!row.in_step || doneAt === null) continue;
    const countedFrom = automaticSince(false, doneAt, asDate(row.visited_at));
    const step = automaticStep(countedFrom, now);
    if (step === 'hourly' || countedFrom === null) continue;
    slower.push({ row, step, countedFrom });
  }

  // 3a. A step no longer in force is said nowhere.
  const cleared =
    slower.length === 0
      ? await clearAll()
      : (
          await db
            .delete(migrationCadenceSaid)
            .where(
              and(
                eq(migrationCadenceSaid.tenantId, tenantId),
                notInArray(
                  migrationCadenceSaid.mappingId,
                  slower.map((s) => s.row.id),
                ),
              ),
            )
            .returning({ mappingId: migrationCadenceSaid.mappingId })
        ).length;

  // 3b. Once: an insert, or an update when the step or its count moved.
  const claimed: SteppedDown[] = [];
  for (const { row, step, countedFrom } of slower) {
    const [won] = await db
      .insert(migrationCadenceSaid)
      .values({ mappingId: row.id, tenantId, step, countedFrom, saidAt: now })
      .onConflictDoUpdate({
        target: migrationCadenceSaid.mappingId,
        set: { step, countedFrom, saidAt: now },
        setWhere: sql`${migrationCadenceSaid.step} IS DISTINCT FROM excluded.step
                   OR ${migrationCadenceSaid.countedFrom} IS DISTINCT FROM excluded.counted_from`,
      })
      .returning({ mappingId: migrationCadenceSaid.mappingId });
    if (!won) continue;
    claimed.push({
      mapping: { id: row.id, name: row.name },
      ...(row.person ? { person: row.person } : {}),
      step,
    });
  }
  return claimed.length === 0 ? { kind: 'none', cleared } : { kind: 'claimed', cleared, migrations: claimed };
}

/**
 * 4. To whom, and in which language: the organisation's active owners and
 * admins, in the language its notification settings name. In its own scope,
 * after the claim has committed.
 */
export async function whomToTell(
  db: PgDatabase,
  tenantId: string,
): Promise<{ readonly to: readonly string[]; readonly locale: NotificationLocale }> {
  const to = rowsOf<{ email: string }>(
    await db.execute(
      sql`SELECT email FROM tenant_member
           WHERE tenant_id = ${tenantId} AND status = 'active' AND role IN ('owner', 'admin')`,
    ),
  ).map((r) => r.email);
  const [organisation] = rowsOf<{ settings: unknown }>(
    await db.execute(sql`SELECT settings FROM tenant WHERE id = ${tenantId}`),
  );
  return { to, locale: readTenantNotificationPrefs(organisation?.settings).locale };
}
