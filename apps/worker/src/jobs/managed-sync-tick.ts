// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The managed sync tick (workplan 0022 T2) — the scheduled Trigger.dev task
 * that replaces the (now-retired) polling managed-scheduler as the thing that STARTS
 * syncs (owner decision 2026-08-01, 0020 T8: one execution plane; this
 * restores ADR-0004's original architecture, which the poller was always an
 * interim for).
 *
 * Every minute: enumerate `status = 'active'` mappings across ALL tenants,
 * of open organisations only (`tenant.status = 'active'`; a closed one gets
 * no pass, workplan 0085 T2)
 * (the system role's `SYSTEM_DATABASE_URL` connection bypasses RLS for this
 * trusted, system-level enumeration — the exact trust boundary the poller
 * documented; `ownpace_system` has BYPASSRLS and the grants this job's
 * statements need, and is not a superuser, workplan 0138 T3 step 2: until
 * then this was the owner's `DATABASE_URL`, a superuser, in every run),
 * evaluate each mapping's own `schedule` cron via `isSyncDue` (or, while its
 * first copy is unfinished, the 15-minute floor whatever the cron says:
 * `FIRST_COPY_UNFINISHED`, workplan 0156 T5), and trigger
 * `run-delta-sync` for the due ones with the mapping's ENABLED domains passed
 * explicitly (the scheduler's scope_selection query — a job must never touch
 * a domain the owner did not select, the #207 lesson).
 *
 * No more at once than the box was sized for (workplan 0143 T1): the due
 * mappings start longest-waiting first, while fewer copying passes than
 * `MAX_PASSES_IN_FLIGHT` run on this stack and fewer than
 * `MAX_PASSES_PER_ORGANISATION` of the mapping's organisation
 * (`withinCapacity`). The rest wait for a later tick.
 *
 * Overlap safety, two layers:
 *  - a mapping with a `run` row currently `running` is skipped this tick;
 *  - `run-delta-sync` runs on a concurrency-1 queue partitioned by
 *    `concurrencyKey: mappingId`, so even a tick/start race serializes
 *    instead of overlapping. (If a duplicate does get queued behind a slow
 *    pass, the second run is a cheap idempotent delta — create-if-absent is
 *    the product's core property — so the failure mode is wasted work, never
 *    duplicated data.)
 *
 * A mapping with an INVALID cron schedule is synced on the DEFAULT cadence
 * and logged loudly every tick — silently skipping would dead-stop the
 * mapping and mask the bad value (hard rule 9). A mapping with no enabled
 * domains is skipped: no row in scope_selection means "not selected", never
 * "default to everything".
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { schedules, configure } from '@trigger.dev/sdk';
import { leavesAReference } from './what-a-run-leaves.ts';
import { Pool } from 'pg';
import {
  log,
  mapWithConcurrency,
  PASS_HARD_LIMIT_MS,
  PASS_RUNNING_STATES,
  UNREAD_NOTE_PREFIX,
  setAppEventSink, setAuditExportSink,
  type DiscoveryDomain,
} from '@openmig/shared';
import {
  AN_OPEN_ORGANISATION_WHERE,
  A_PATH_KEPT_AFTER_A_CUTOVER_WHERE,
  CUTOVER_STILL_COPIES_WHERE,
  appEventSinkOn,
  auditExportOn,
  pgDriver,
} from '@openmig/ledger';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readOpenPause, recordTickBeat, BILLABLE_RUN_KINDS } from '@openmig/managed';
import { isSyncDue, DEFAULT_SYNC_SCHEDULE, defaultScheduleFor } from '@openmig/orchestration/sync-due';
import { enabledDomainsForMappings } from '@openmig/orchestration/enabled-domains';
import {
  FAILURE_WINDOW_MINUTES,
  heldBackByFailures,
  minGapMinutes,
  SELF_HEALING_CATEGORIES,
} from '@openmig/orchestration/failing-backoff';
import { runDeltaSync } from './run-delta-sync.ts';

// The system role, `ownpace_system`, which spans organisations and is not a
// superuser (workplan 0138 T3 step 2; managed migration 0033 grants it what
// this job sends and nothing else). Never DATABASE_URL, the database owner,
// which no run holds any more: there is no fallback to it.
const SYSTEM_DATABASE_URL = process.env.SYSTEM_DATABASE_URL?.trim();
if (!SYSTEM_DATABASE_URL) {
  throw new Error(
    'SYSTEM_DATABASE_URL is required: managed-sync-tick spans organisations as the system role, ownpace_system, ' +
      'and never as the database owner (DATABASE_URL), which no run holds. ' +
      'deploy/compose/set-task-env.sh uploads it (workplan 0138 T3 step 2).',
  );
}
const pool = new Pool({ connectionString: SYSTEM_DATABASE_URL });
// Each audit event this task records, also as one JSON line on its output (0129 T4).
setAuditExportSink(auditExportOn(pgDriver(pool), { 'service.name': 'ownpace-worker' }));
// Its errors go to the operator's log page too (0129 T1), under the reference
// its failure carries in the plane (0134, open question 3 (a)).
setAppEventSink(appEventSinkOn(pgDriver(pool)));

/**
 * How many mappings the tick may enqueue at once.
 *
 * Not a sync concurrency — enqueueing is a short API call, and the runs
 * themselves are serialized per mapping by the queue. This exists because the
 * enqueues used to be `await`ed one after another inside the loop, so the
 * tick's wall time was the number of due mappings times a round trip. On a
 * one-minute cron that is a countdown: cross sixty seconds and ticks overlap.
 *
 * Bounded rather than unbounded because the failure mode of `Promise.all` over
 * every due mapping is a burst against the trigger API that looks, to it, the
 * same as an attack.
 */
const ENQUEUE_CONCURRENCY = 8;

interface TickRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly schedule: string | null;
  readonly consecutive_failures: string | number;
  readonly any_self_healing: boolean;
  readonly last_started: Date | null;
  readonly running: boolean;
  /** When the oldest STALE `running` row for this mapping started, if any. */
  readonly stale_since: Date | null;
  /** Some data type it copies has not completed a pass (`FIRST_COPY_UNFINISHED`, 0156 T5). */
  readonly first_copy_unfinished: boolean;
}

/**
 * HOW LONG A `running` ROW IS BELIEVED — twice the runner's hard kill.
 *
 * A run row is opened when a pass starts and closed when it ends, and this
 * tick skips a mapping that has one open. That is right while a pass is
 * genuinely running and catastrophic afterwards: a pass killed outright — a
 * `maxDuration` kill, an OOM, a supervisor restart mid-pass — never reaches
 * the code that closes its row, so the row stays `running` for ever and this
 * tick skips that mapping on every future firing. The migration stops.
 * Silently. Nothing reaps it: `retention` deliberately never touches a
 * `running` run's rows, and until now nothing else looked.
 *
 * TWICE the ceiling rather than a little over it, because a row is the only
 * evidence a pass exists and cutting one loose while its process still runs
 * would let two passes touch one mapping at once. The queue's
 * `concurrencyKey: mappingId` still stands behind that (one running pass per
 * mapping, enforced by the runner), so the cost of being slow here is bounded
 * — one wasted cadence — while the cost of being fast is two writers.
 *
 * With the soft deadline in place a pass should end itself long before the
 * kill, so reaching this at all is news, and it is logged as such.
 */
const STALE_RUN_AFTER_MS = 2 * PASS_HARD_LIMIT_MS;

/**
 * WHETHER A MIGRATION'S FIRST COPY IS UNFINISHED (workplan 0156 T5; the owner,
 * 2026-10-03, 0125 T8's (a)), as a SQL condition on `mailbox_mapping m`. True,
 * and `isSyncDue` runs the migration at the floor whatever its schedule; false,
 * and its schedule applies.
 *
 * The owner: *"the default frequency now seems to be 1 sync every 1 day; that
 * might be reasonable for the free tier and after all sync was done, like as a
 * default sync of only the new additions/changes, but not for the initial
 * bulk."* A pass stops itself at 50 minutes, and a migration made with no
 * schedule picked is stored as daily at 02:00, so a large first copy copied
 * for 50 minutes a day.
 *
 * THE RULE: some data type this migration copies has not completed a pass.
 * "Completed a pass" is `migration_status.completed_at`, and the reason it is
 * the signal and not the row's `state`:
 *
 *  - `markCompleted` is its only writer, and it is called only by a pass that
 *    reached the end: not one stopped at its deadline, at a ceiling, by a Pause,
 *    or with a collection it could not list (`run-delta-sync.ts`, "A PAUSED
 *    DOMAIN IS NOT A COMPLETED ONE"). Nothing ever clears it. So a first copy
 *    cut short by the deadline reads empty (its `state` back at `in_progress`),
 *    and a finished one stays set through every later pass: a later pass that
 *    stops at its deadline, or fails, puts the state back, never this.
 *  - Items that could not be copied do not keep it empty. A pass that parks an
 *    item on the failure queue still reaches the end and is marked completed,
 *    with the item counted in `itemsFailed`. So a migration whose only open
 *    work is failed items is on its schedule, and does not run every quarter
 *    hour for ever (the owner's condition).
 *  - It is what the screens already call a first copy: `completedOnce` in
 *    `stage.ts`, *copying* until a data type's `lastSyncedAt`, which is this
 *    column renamed (`operating-contract.ts`).
 *
 * WHICH DATA TYPES COUNT: the ones its pass copies. Included in its scope
 * (`scope_selection.included`, the tick's `enabledDomainsForMappings`), not
 * stopped by its owner (0128 T4), and in a phase that runs passes (`$5`,
 * `PASS_RUNNING_STATES`): its own path row's, or the migration's where it has
 * none, as `readPathPhases` falls back. So a data type added later to a
 * finished migration counts until it has been copied once (it has no status
 * row yet, or an empty one), and one waiting to be started (`ready`, photos
 * waiting for a Takeout export), switched off or stopped does not hold the
 * migration at the floor for a copy no pass will make. Nor does one in or past
 * its cutover: its grace period copies on the schedule, as it did before.
 *
 * TWO WAITS STAY WAITS. Each is a data type that has not completed a pass but
 * that another pass a quarter hour later would not move:
 *
 *  - **A provider's daily download ceiling** (`paused_reason`, migration 0041):
 *    counted again once its window has reset (`windowResetsAt`), so a Gmail
 *    first copy carries on the minute its day's bytes are back, and not before.
 *    One with no reset time (the meter could not read its window) waits for
 *    the schedule's next pass, which clears it (`markInProgress`), rather than
 *    have a time invented for it. Read through `pg_input_is_valid`, so a value
 *    some other build wrote is a wait, never a cast that fails the tick for
 *    every organisation.
 *  - **A collection its source would not list** (`noteUnreadCollections`, 0055
 *    T3 (e); the note begins with `$6`, `UNREAD_NOTE_PREFIX`). The pass skips it
 *    and the data type cannot complete until the source lets go of it, which a
 *    folder the account may not open never does. A pass does not FAIL over it,
 *    so the failure ladder never spaces it out: the schedule is the only
 *    spacing it has. A data type whose pass THREW still counts: that pass fails
 *    the run, and `heldBackByFailures` widens the gap after this says due.
 *
 * Cheap: each read is by a unique key per data type of one migration
 * (`scope_selection`, `path_lifecycle` on `(mapping_id, domain)`,
 * `migration_status` on `(tenant_id, mapping_id, domain)`), at most five rows.
 * Each one filters by the migration's organisation itself, as every read in
 * this statement does: the system role bypasses row security.
 */
export const FIRST_COPY_UNFINISHED = `EXISTS (SELECT 1 FROM scope_selection s
                LEFT JOIN path_lifecycle p
                  ON p.tenant_id = s.tenant_id AND p.mapping_id = s.mapping_id AND p.domain = s.domain
                LEFT JOIN migration_status ms
                  ON ms.tenant_id = s.tenant_id AND ms.mapping_id = s.mapping_id AND ms.domain = s.domain
                WHERE s.tenant_id = m.tenant_id AND s.mapping_id = m.id AND s.included
                  AND p.stopped_at IS NULL
                  AND COALESCE(p.state, m.status) = ANY($5::text[])
                  AND ms.completed_at IS NULL
                  AND CASE WHEN ms.paused_reason IS NULL THEN true
                           WHEN ms.paused_reason->>'windowResetsAt' IS NULL THEN false
                           WHEN pg_input_is_valid(ms.paused_reason->>'windowResetsAt', 'timestamptz')
                             THEN (ms.paused_reason->>'windowResetsAt')::timestamptz <= now()
                           ELSE false END
                  AND NOT COALESCE(starts_with(ms.last_error, $6::text), false))`;

/**
 * The mappings this tick considers, and what it believes about each.
 *
 * Exported so `a-run-row-that-outlived-its-pass.unit.test.ts` can read the two
 * clauses that decide whether a mapping is enqueued at all — the same reason
 * `managed-digest.ts` exports its predicates. A wrong clause here does not
 * throw; it silently stops somebody's migration, which is a defect only a
 * customer finds.
 *
 * `$1` is the staleness threshold in milliseconds, used TWICE and on purpose:
 * `running` and `stale_since` must partition the open rows between them. If
 * one used `<` and the other `<`, a row on the boundary would be both — or,
 * worse, neither, which is a mapping that is neither skipped nor reported.
 *
 * `$2` is `SELF_HEALING_CATEGORIES`, `$3` is `FAILURE_WINDOW_MINUTES`, `$4`
 * is `BILLABLE_RUN_KINDS` and `$5` is `PASS_RUNNING_STATES` — all passed in
 * rather than written into the SQL so each has ONE definition. A category
 * moved from one side of the self-healing split to the other, a ladder rung
 * that needs a longer window, a new run kind, or a new lifecycle that copies,
 * cannot then leave a stale literal behind here.
 *
 * `$6` is `UNREAD_NOTE_PREFIX`, read by `FIRST_COPY_UNFINISHED` (0156 T5),
 * which reads `$5` too, for the same reason: a data type copies in the phases
 * its migration does.
 *
 * `$5` is the one that had been a literal `'active'` since the
 * beginning. It is the managed twin of the appliance's `runsPasses`, and the
 * two must not drift: a state missing from one edition's gate is a migration
 * that copies for self-host customers and stands still for managed ones,
 * which is exactly the edition split hard rule 5 forbids.
 *
 * Beside it, the one state that runs for a while (0128 T2; the owner,
 * 2026-09-24, D1 (a)): a mapping in `cutover`, from execute until its
 * cutover's grace period ends, by `CUTOVER_STILL_COPIES_WHERE`, the SQL twin
 * of `runsPassesNow`. Any of its cutover ledger rows will do: the whole
 * migration's, or a data type's own (0128 T5, slice 4), since the pass moves
 * past each data type whose own window is closed. When the last window closes
 * the mapping drops out of this query by itself, and nothing has to remember
 * to unschedule it.
 */
export const ACTIVE_MAPPINGS_SQL = `SELECT m.id, m.tenant_id, m.schedule,
              (SELECT max(r.started_at) FROM run r
                WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id) AS last_started,
              EXISTS (SELECT 1 FROM run r
                WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id
                  AND r.status = 'running'
                  AND r.started_at > now() - ($1::int * interval '1 millisecond')) AS running,
              (SELECT min(r.started_at) FROM run r
                WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id
                  AND r.status = 'running'
                  AND r.started_at <= now() - ($1::int * interval '1 millisecond')) AS stale_since,
              -- HOW LONG THIS HAS BEEN FAILING, and whether the cause is one
              -- that clears by itself (failing-backoff.ts). Both computed
              -- here rather than in a second pass: the tick already reads
              -- every active mapping, and a query per mapping is what 0082
              -- spent an afternoon removing.
              --
              -- BOTH scans are bounded by $3, and that bound is the point.
              -- "Failures since the last success" without one is a scan back
              -- to the beginning of history for a mapping that has never
              -- succeeded — which is the mapping this column exists to find.
              -- It would grow, once a minute, for ever: the exact shape 0023
              -- removed. Bounded, a mapping whose last success predates the
              -- window reads as never having succeeded, which is the answer
              -- the ladder wants anyway.
              --
              -- Only the kinds this tick's own cadence produces ($4). A failed
              -- discovery or verify is a real failure and belongs on the
              -- customer's screen, but it is not evidence that COPYING is
              -- broken, and counting it would hold back the first sync of a
              -- mapping whose discovery failed a dozen times before somebody
              -- fixed it. They are the billable kinds for the same reason they
              -- are the throttled ones: they are the passes that move data.
              (SELECT count(*) FROM run r
                WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id
                  AND r.started_at > now() - ($3::int * interval '1 minute')
                  AND r.status = 'failed'
                  AND r.kind = ANY($4::text[])
                  AND r.started_at > COALESCE(
                        (SELECT max(ok.started_at) FROM run ok
                          WHERE ok.tenant_id = m.tenant_id AND ok.mapping_id = m.id
                            AND ok.started_at > now() - ($3::int * interval '1 minute')
                            AND ok.kind = ANY($4::text[])
                            AND ok.status = 'succeeded'),
                        '-infinity'::timestamptz)) AS consecutive_failures,
              -- ANY domain, not every one: a mapping with one self-healing
              -- cause will move again shortly, and keeping its cadence costs
              -- one request per pass.
              EXISTS (SELECT 1 FROM migration_status ms
                WHERE ms.tenant_id = m.tenant_id AND ms.mapping_id = m.id
                  AND ms.last_error_category = ANY($2::text[])) AS any_self_healing,
              -- THE FIRST COPY IS NOT FINISHED (workplan 0156 T5; the owner,
              -- 2026-10-03): isSyncDue then runs this migration at the floor,
              -- whatever its schedule. See FIRST_COPY_UNFINISHED above.
              ${FIRST_COPY_UNFINISHED} AS first_copy_unfinished
         FROM mailbox_mapping m
        WHERE (m.status = ANY($5::text[])
               -- A cutover copies from execute until its grace period ends
               -- (0128 T2, D1 (a)): runsPassesNow, in SQL, while any of its
               -- ledger rows still copies (one per data type, slice 4).
               OR (m.status = 'cutover'
                   AND EXISTS (SELECT 1 FROM cutover_state c
                                WHERE c.tenant_id = m.tenant_id AND c.mapping_id = m.id
                                  AND ${CUTOVER_STILL_COPIES_WHERE}))
               -- A data type kept in the lane while another is past its
               -- cutover's grace period (0128 T5, slice 2b): the reader's
               -- anyRuns, for the one case the status cannot see.
               OR (${A_PATH_KEPT_AFTER_A_CUTOVER_WHERE}))
          -- A grant the person took back (0108 T8 (c), ledger migration 0063):
          -- nothing reads their account until they grant it again, so no pass
          -- is started for it. The pass's own re-read and the source builder
          -- refuse it as well; this is where it costs nothing.
          AND m.grant_withdrawn_at IS NULL
          -- A closed organisation (0085 T2; the owner, 2026-09-28): nothing
          -- uses the access it gave, so no pass is started for any of its
          -- migrations, in any of the three branches above. The close leaves
          -- each migration's status alone, so a reopen, which sets the
          -- organisation active again, is picked up here at the next tick.
          -- The pass's own re-read and the builders refuse it as well.
          AND ${AN_OPEN_ORGANISATION_WHERE}`;

export { STALE_RUN_AFTER_MS };

/**
 * AS MANY PASSES AS THE BOX WAS SIZED FOR (workplan 0143 T1 step 3, the alpha
 * minimum).
 *
 * The tick used to enqueue every due migration, so the passes running at once
 * were the migrations that fell due in the same minute, and nothing stood
 * between that number and the machine but the plane's own limit, 300 per
 * environment (0143, Status). Each pass is a container held to 512 MB
 * (`small-1x`, enforced by the supervisor), and the two stacks on the machine
 * have 20 GB between them (0143, open question 8).
 *
 * So the tick counts the copying passes already in flight, on this stack and
 * per organisation, and starts no more than the two caps leave room for:
 *
 *   MAX_PASSES_IN_FLIGHT         passes at once on this stack. Blank is 3, the
 *                                OTA stack's number; live's .env says 6 (0143,
 *                                open question 7).
 *   MAX_PASSES_PER_ORGANISATION  passes at once of one organisation. Blank is 2
 *                                (0143, open question 1).
 *
 * Each stack's tick counts only its own runs, since each stack has a database
 * and a plane of its own, so the two stacks' numbers together must fit the
 * machine. `managed.env.example` gives the formula.
 *
 * LONGEST-WAITING FIRST. With a cap, the order decides who waits, so it can no
 * longer be whatever Postgres returns: a migration that never ran goes first,
 * then the one whose newest run started longest ago.
 *
 * WHAT THE COUNT CANNOT SEE. A pass has no run row until a runner starts it
 * (`run-delta-sync.ts` opens it), so a pass this tick enqueued a minute ago
 * and the plane has not started yet is not counted. The next tick usually
 * picks the same migration again, since it is still due and has still waited
 * longest; that second pass waits behind the first on the migration's own
 * queue, so it is a spare delta and not one more pass in flight. A migration
 * that has waited longer and falls due in between can start beside it, so the
 * cap can be passed by the passes of the last minute that have not started.
 * The plane's own limit, set a little above the cap, is the backstop for that
 * (0143 T1). Passes somebody starts by hand (Sync now, `/start`, a cutover's
 * final sync) are counted once they run, and are not stopped here; the cap
 * on migrations per organisation bounds them (0143 T2a).
 */
export const DEFAULT_MAX_PASSES_IN_FLIGHT = 3;
export const DEFAULT_MAX_PASSES_PER_ORGANISATION = 2;

/**
 * One cap from its variable: unset or empty is the default. Anything but a
 * whole number of at least 1 stops the tick, naming it, as
 * `MAX_MIGRATIONS_PER_ORGANISATION` stops the api: an operator who wrote `six`
 * believes the machine is held to six, and a cap quietly read as another
 * number is found out by the machine.
 */
export function passCapFromEnv(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `${name} must be a whole number, at least 1 — got ${JSON.stringify(raw)}. ` +
        `Leave it unset for the default of ${fallback}.`,
    );
  }
  return n;
}

export interface PassCaps {
  /** Passes at once on this stack. */
  readonly inFlight: number;
  /** Passes at once of one organisation. */
  readonly perOrganisation: number;
}

/** The copying passes running on this stack when the tick counts. */
export interface PassesInFlight {
  readonly total: number;
  /** By organisation; one that is absent has none running. */
  readonly byOrganisation: ReadonlyMap<string, number>;
}

/** What the choice reads of a due migration. */
export interface Waiting {
  readonly id: string;
  readonly tenant_id: string;
  /** When its newest run started; null when it never ran. */
  readonly last_started: Date | null;
}

/**
 * The copying passes in flight, per organisation: open run rows of the kinds a
 * pass writes (`$2`, `BILLABLE_RUN_KINDS`), younger than the staleness window
 * (`$1`, `STALE_RUN_AFTER_MS`). A row older than that is a pass that was
 * killed and holds no memory, and counting it would take a slot for ever: the
 * defect `STALE_RUN_AFTER_MS` exists for, in a new place. The drain's count
 * under a hold uses the same window, over every kind. The partial index on
 * running rows (`ix_run_active`, ledger migration 0023) serves it.
 */
export const PASSES_IN_FLIGHT_SQL = `SELECT tenant_id::text AS tenant_id, count(*)::int AS running
         FROM run
        WHERE status = 'running'
          AND started_at > now() - ($1::int * interval '1 millisecond')
          AND kind = ANY($2::text[])
        GROUP BY tenant_id`;

/**
 * Which due migrations the tick starts now, and how many wait for a free pass.
 *
 * Longest-waiting first, taking each while this stack and its organisation
 * both have room, and passing over one whose organisation has none. The id
 * breaks a tie, so the same migrations get the same answer every tick. Pure,
 * so `a-tick-that-knows-the-box-size` can drive it without a database, a
 * runner or a queue.
 */
export function withinCapacity<T extends Waiting>(
  due: readonly T[],
  running: PassesInFlight,
  caps: PassCaps,
): { readonly chosen: T[]; readonly heldForCapacity: number } {
  let total = running.total;
  const byOrganisation = new Map(running.byOrganisation);
  const chosen: T[] = [];
  for (const m of [...due].sort(longestWaitingFirst)) {
    if (total >= caps.inFlight) break;
    const own = byOrganisation.get(m.tenant_id) ?? 0;
    if (own >= caps.perOrganisation) continue;
    chosen.push(m);
    total += 1;
    byOrganisation.set(m.tenant_id, own + 1);
  }
  return { chosen, heldForCapacity: due.length - chosen.length };
}

function longestWaitingFirst(a: Waiting, b: Waiting): number {
  const aStarted = a.last_started?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bStarted = b.last_started?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (aStarted !== bStarted) return aStarted < bStarted ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export const managedSyncTick = schedules.task({
  id: 'managed-sync-tick',
  cron: '* * * * *',
  run: leavesAReference('managed-sync-tick', async () => {
    // In-network API URL (found live, 2026-08-01, the tick's first due firing):
    // the platform injects TRIGGER_API_URL as the HOST-perspective API origin
    // (http://localhost:3090 — correct for the deploy CLI, which is why
    // API_ORIGIN is set that way), but inside a runner container `localhost`
    // is the runner itself. This is the FIRST task that calls the API from
    // within a runner — idle ticks succeeded, and the first DUE tick died on
    // the .trigger() call with connection refused. Point the SDK at the
    // compose-network address instead; secretKey keeps resolving from the
    // injected TRIGGER_SECRET_KEY env. Scoped to this run's own process (each
    // task run executes in its own TaskRunProcess).
    configure({
      baseURL: process.env.TRIGGER_API_URL_IN_NETWORK ?? 'http://trigger-api:3000',
    });

    const now = new Date();
    // The tick runs on a one-minute cron, so its own duration is the number
    // that decides whether it still fits (workplan 0083). 0082 fixed three
    // things that made it slow and could argue only from reading the code —
    // this is what makes the next such claim measurable instead. Logged every
    // tick rather than sampled: it is one line, and the interesting value is
    // the tail, which sampling is exactly what loses.
    const startedAt = Date.now();

    /**
     * AN OPERATOR HOLD STOPS THIS TICK STARTING ANYTHING (managed migration
     * 0023).
     *
     * A drain is: start nothing new, let what is running finish, deploy, lift
     * the hold. So the check is here, before the enumeration, and it stops
     * only the ENQUEUE — passes already in flight are untouched, which is
     * what makes this a drain rather than a kill.
     *
     * `run` rows are counted and reported rather than assumed away: "how much
     * is still in flight" is the one number that tells an operator whether the
     * drain has finished, and having to go and count it in SQL is how somebody
     * ends up deploying over a live pass.
     *
     * Read through the system role's pool, which bypasses RLS — the same
     * trust boundary the mapping enumeration below documents, and the reason
     * no `app.current_user` is set here.
     */
    const hold = await readOpenPause(drizzle(pool));
    if (hold) {
      // The SAME staleness window the enumeration uses. A `running` row from
      // a pass that was killed outright never closes (see STALE_RUN_AFTER_MS),
      // and counting those here would show a drain that never finishes — an
      // operator waiting for a zero that cannot arrive, or deploying over a
      // live pass because they stopped believing the number.
      const { rows: inFlight } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM run
          WHERE status = 'running'
            AND started_at > now() - ($1::int * interval '1 millisecond')`,
        [STALE_RUN_AFTER_MS],
      );
      const stillRunning = Number(inFlight[0]?.count ?? '0');
      const summary = {
        heldSince: hold.startedAt,
        stillRunning,
        triggered: 0,
        ms: Date.now() - startedAt,
      };
      log.info(
        `[sync-tick] holding: no new passes are being started (since ${hold.startedAt})` +
          (hold.message ? ` — "${hold.message}"` : '') +
          `. ${stillRunning} pass(es) still in flight; the drain is done when that reaches 0.`,
        summary,
      );
      // It ran, and held: a beat all the same (workplan 0142 T2). The hold is
      // shown to testers on its own, with the operator's sentence.
      await recordTickBeat(drizzle(pool), new Date());
      return summary;
    }

    // The caps, read every tick, so a changed value holds from the next
    // minute: a run reads its environment when it starts. Read before the
    // enumeration, so a value that is not a number stops the tick before it
    // starts anything.
    const caps: PassCaps = {
      inFlight: passCapFromEnv(
        'MAX_PASSES_IN_FLIGHT',
        process.env.MAX_PASSES_IN_FLIGHT,
        DEFAULT_MAX_PASSES_IN_FLIGHT,
      ),
      perOrganisation: passCapFromEnv(
        'MAX_PASSES_PER_ORGANISATION',
        process.env.MAX_PASSES_PER_ORGANISATION,
        DEFAULT_MAX_PASSES_PER_ORGANISATION,
      ),
    };

    const { rows } = await pool.query<TickRow>(ACTIVE_MAPPINGS_SQL, [
      STALE_RUN_AFTER_MS,
      [...SELF_HEALING_CATEGORIES],
      FAILURE_WINDOW_MINUTES,
      [...BILLABLE_RUN_KINDS],
      [...PASS_RUNNING_STATES],
      UNREAD_NOTE_PREFIX,
    ]);

    let notDue = 0;
    let heldBack = 0;
    let skippedRunning = 0;
    let staleRuns = 0;
    let skippedNoDomains = 0;

    // Phase 1 — decide, in memory. No I/O in here, so the set of due mappings
    // is evaluated against ONE `now` rather than drifting as the loop runs.
    const due: TickRow[] = [];
    for (const m of rows) {
      if (m.running) {
        skippedRunning++;
        continue;
      }
      // Not skipped, and not silent either. A stale row means a pass died
      // without closing its books, and the mapping has been standing still
      // since — so say how long, once per tick, rather than quietly resuming
      // and leaving nobody any the wiser about the pass that vanished.
      if (m.stale_since) {
        staleRuns++;
        log.warn(
          `[sync-tick] mapping ${m.id}: a run has been 'running' since ` +
            `${m.stale_since.toISOString()}, longer than ${STALE_RUN_AFTER_MS}ms — treating it as ` +
            'dead and enqueueing this mapping again. A run row is closed by the pass that opened ' +
            'it, so one this old means the pass was killed rather than finished.',
        );
      }

      // An explicit schedule is the owner's decision and is used as written.
      // Only the absent one gets a per-mapping offset, so the mappings that
      // never chose a cadence stop all firing in the same minute.
      const schedule = m.schedule ?? defaultScheduleFor(m.id);
      // Until its first copy is finished, at the floor whatever the schedule
      // (0156 T5): after the `running` skip above, so never beside a pass
      // that still runs, and before the back-off and the caps below, so both
      // still hold.
      const facts = { firstCopyUnfinished: m.first_copy_unfinished };
      let isDue: boolean;
      try {
        isDue = isSyncDue(schedule, m.last_started, now, facts);
      } catch (err) {
        // Loud, every tick, and the mapping keeps syncing on the default
        // cadence while somebody fixes the value.
        log.error(
          `[sync-tick] mapping ${m.id}: invalid schedule ${JSON.stringify(m.schedule)} — ` +
            `using the default (${DEFAULT_SYNC_SCHEDULE}) until it is fixed:`,
          err
        );
        isDue = isSyncDue(defaultScheduleFor(m.id), m.last_started, now, facts);
      }
      if (!isDue) {
        notDue++;
        continue;
      }

      // Due by the schedule, and still not attempted: this mapping has been
      // failing for a cause that will not clear by itself, so it is asked less
      // often (`failing-backoff.ts`). Said out loud every time, because a
      // mapping that is quietly attempted less is exactly the kind of thing
      // nobody finds later.
      const failing = {
        consecutiveFailures: Number(m.consecutive_failures),
        anySelfHealing: m.any_self_healing,
        lastStartedAt: m.last_started,
      };
      if (heldBackByFailures(failing, now)) {
        heldBack++;
        log.info(
          `[sync-tick] mapping ${m.id}: due, but held back — ` +
            `${failing.consecutiveFailures} consecutive failed pass(es) with no self-healing ` +
            `cause, so attempts are spaced at least ${minGapMinutes(failing)} minutes apart. ` +
            'It stays active and resumes on its own as soon as a pass succeeds.',
        );
        continue;
      }

      due.push(m);
    }

    // Phase 2 — one query for every due mapping's scope, instead of one per
    // mapping inside the loop.
    const domainsByMapping = await enabledDomainsForMappings(
      pool,
      due.map((m) => ({ id: m.id, tenantId: m.tenant_id }))
    );

    const eligible: (TickRow & { readonly domains: DiscoveryDomain[] })[] = [];
    for (const m of due) {
      // Absent from the map means no included rows: no scope_selection row is
      // "not selected", never "default to everything".
      const domains = [...(domainsByMapping.get(m.id) ?? [])];
      if (domains.length === 0) {
        skippedNoDomains++;
        continue;
      }
      eligible.push({ ...m, domains });
    }

    // Phase 3 — no more than the box was sized for (workplan 0143 T1 step 3):
    // count the copying passes in flight, and take the longest-waiting of the
    // eligible while the caps leave room. After phase 2, so a migration with
    // nothing selected never takes a slot.
    const { rows: counted } = await pool.query<{ tenant_id: string; running: number }>(
      PASSES_IN_FLIGHT_SQL,
      [STALE_RUN_AFTER_MS, [...BILLABLE_RUN_KINDS]],
    );
    const byOrganisation = new Map(counted.map((c) => [c.tenant_id, Number(c.running)] as const));
    const inFlight: PassesInFlight = {
      total: [...byOrganisation.values()].reduce((sum, n) => sum + n, 0),
      byOrganisation,
    };
    const capacity = withinCapacity(eligible, inFlight, caps);
    const toEnqueue = capacity.chosen;
    if (capacity.heldForCapacity > 0) {
      // The count, never the migrations: which ones wait changes every
      // minute, and the order that decides it is the code above.
      log.info(
        `[sync-tick] ${capacity.heldForCapacity} due migration(s) wait for a free pass: ` +
          `${inFlight.total} of at most ${caps.inFlight} already run on this stack, ` +
          `at most ${caps.perOrganisation} per organisation ` +
          '(MAX_PASSES_IN_FLIGHT, MAX_PASSES_PER_ORGANISATION). ' +
          'The longest-waiting start first, on a later tick.',
      );
    }

    // Phase 4 — enqueue concurrently, bounded. A failure to enqueue ONE
    // mapping must not cost the others their turn: before this the loop threw
    // out of the whole tick, so a single bad mapping stopped every mapping
    // after it in the list, once a minute, invisibly.
    let triggered = 0;
    const failures: string[] = [];
    await mapWithConcurrency(toEnqueue, ENQUEUE_CONCURRENCY, async (m) => {
      try {
        await runDeltaSync.trigger(
          { tenantId: m.tenant_id, mappingId: m.id, domains: m.domains },
          {
            concurrencyKey: m.id,
            tags: [`tenant:${m.tenant_id}`, `mapping:${m.id}`],
          }
        );
        triggered++;
      } catch (err) {
        failures.push(m.id);
        log.error(`[sync-tick] mapping ${m.id}: could not enqueue this pass:`, err);
      }
    });

    const summary = {
      active: rows.length,
      // Of those, the ones whose first copy is unfinished, so on the floor
      // whatever their schedule (0156 T5): the number that says why a daily
      // migration ran a pass every hour today.
      firstCopies: rows.filter((m) => m.first_copy_unfinished).length,
      triggered,
      notDue,
      heldBack,
      heldForCapacity: capacity.heldForCapacity,
      inFlight: inFlight.total,
      skippedRunning,
      staleRuns,
      skippedNoDomains,
      failedToEnqueue: failures.length,
      ms: Date.now() - startedAt,
    };
    // Said loudly when the tick is approaching the interval it runs on. A tick
    // that takes longer than its own period does not fail — it overlaps, and
    // the fan-out gets least predictable exactly when there is most of it. By
    // the time that is visible in behaviour it is hard to attribute, so it is
    // announced while there is still headroom.
    if (summary.ms >= 30_000) {
      log.warn(
        `[sync-tick] took ${summary.ms}ms of its 60000ms period — at 60000ms ticks begin to ` +
          'overlap. Enumerated ' + `${summary.active} active mappings, enqueued ${summary.triggered}.`
      );
    }
    log.info('[sync-tick]', summary);
    // The beat, at the END of a run that completed (workplan 0142 T2): one
    // written first would say "ran" for a tick that then threw on its
    // enumeration. A mapping that failed to enqueue is counted above, and does
    // not stop it.
    await recordTickBeat(drizzle(pool), new Date());
    return summary;
  }),
});
