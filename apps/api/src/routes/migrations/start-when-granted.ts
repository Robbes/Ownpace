// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * START WHEN GRANTED, PER PERSON (ADR-0035's amendment; the owner, 2026-10-03).
 *
 * The owner: *"Yes, but after the move was started in the first place. After
 * preflight the start needs to be given at least once, the grant may arrive
 * later."* Asked whether that holds per person or per migration: *"Per
 * person"*.
 *
 * So when a grant lands, each migration it was written to that has never run
 * starts by itself, as long as its person's move is under way: another
 * migration of theirs is running, which the owner started once its count was
 * in. Before that first Start, a grant only makes the counts appear, and the
 * owner presses Start. Three things stay as they are:
 *
 *  - a move nothing of which runs, because nothing was started yet or because
 *    the owner paused it;
 *  - a migration that ran before and was paused: the owner's pause stands;
 *  - a migration that is running already: its next pass reads the new grant.
 *
 * ## After the grant, never inside it
 *
 * Called once the grant's own transaction has committed, as the progress link
 * is minted: a start that could not happen must never undo a consent that
 * landed. It never throws; what fails is logged, and the owner can still press
 * Start.
 *
 * ## As *Start* does
 *
 * The close and the operator hold are asked first (`enqueueIfFree`), so a held
 * or closed organisation starts nothing and the migration stays a draft. Then,
 * per migration and in its own transaction, the row is locked, the question is
 * asked again, and the migration moves as *Start* moves it: `active`, its paths
 * with the month's peak (`movePathsWithMapping`), and the change recorded
 * `via: 'grant'` by the link (`GRANT_ACTOR`), in the same transaction. Its
 * first pass is enqueued after, as *Start* enqueues it; one that cannot be is
 * logged, and the tick picks the active migration up on its own cadence.
 *
 * Its tick for files a format would refuse is not asked: the owner chose to
 * have the rest of a move start after one count (*"at least once"*). What it
 * could not copy shows in its queues, as for any pass.
 *
 * ## Said before it happens
 *
 * The person's page says it beside each migration that waits for their grant
 * (`awaitingTheirGrant`), by the same two questions: whether it ever ran, and
 * whether their move runs. *Start* on such a migration says it too
 * (`startsWhenGrantedFor`).
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Pool } from 'pg';
import * as schema from '@openmig/ledger';
import { recordMappingStatusChange, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import { person, personMigration } from '@openmig/managed/schema-managed';
import { log } from '@openmig/shared';
import { withTenantDb } from '../../middleware/auth.ts';
import { enqueueIfFree } from '../../enqueue-unless-held.ts';
import { GRANT_ACTOR } from './grant-ending.ts';
import { resolveSyncJob } from './job-resolution.ts';
import { movePathsWithMapping } from './path-lifecycle-wiring.ts';
import { readPersonGrantSubject } from './person-grant-subject.ts';

/** The statuses in which a migration is running: started, and not paused or finished. */
const RUNNING = ['active', 'continuous'] as const;

/**
 * Whose move this migration is part of, when that move is running: another
 * migration of the same person is `active` or `continuous`. Undefined when the
 * migration belongs to nobody, or nothing else of theirs runs. Read inside the
 * caller's tenant transaction.
 */
export async function personWhoseMoveRuns(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<{ readonly personId: string } | undefined> {
  const [mine] = await db
    .select({ personId: personMigration.personId })
    .from(personMigration)
    .where(and(eq(personMigration.mappingId, mappingId), eq(personMigration.tenantId, tenantId)));
  if (!mine) return undefined;
  const running = await db
    .select({ id: schema.mailboxMapping.id })
    .from(personMigration)
    .innerJoin(
      schema.mailboxMapping,
      and(
        eq(schema.mailboxMapping.id, personMigration.mappingId),
        eq(schema.mailboxMapping.tenantId, personMigration.tenantId),
      ),
    )
    .where(
      and(
        eq(personMigration.personId, mine.personId),
        eq(personMigration.tenantId, tenantId),
        inArray(schema.mailboxMapping.status, [...RUNNING]),
      ),
    );
  return running.some((r) => r.id !== mappingId) ? { personId: mine.personId } : undefined;
}

/**
 * Whether a migration has never run: `paused`, with no path row. A draft's
 * paths are `ready`, free and absent (`a-path-for-every-migration.ts`); the
 * first *Start* writes them, and they stay through every pause after.
 */
async function isADraft(db: PgDatabase, tenantId: string, mappingId: string, status: string): Promise<boolean> {
  if (status !== 'paused') return false;
  const paths = await db
    .select({ domain: schema.pathLifecycle.domain })
    .from(schema.pathLifecycle)
    .where(and(eq(schema.pathLifecycle.mappingId, mappingId), eq(schema.pathLifecycle.tenantId, tenantId)))
    .limit(1);
  return paths.length === 0;
}

/**
 * Whether this migration would start by itself once its grant lands: it has
 * never run, and its person's move is running. Answers that person's name, for
 * *Start* to say so instead of only that it waits; undefined otherwise.
 */
export async function startsWhenGrantedFor(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
  status: string,
): Promise<string | undefined> {
  if (!(await isADraft(db, tenantId, mappingId, status))) return undefined;
  const runs = await personWhoseMoveRuns(db, tenantId, mappingId);
  if (!runs) return undefined;
  const [named] = await db
    .select({ displayName: person.displayName })
    .from(person)
    .where(and(eq(person.id, runs.personId), eq(person.tenantId, tenantId)));
  return named?.displayName;
}

/**
 * What their grant does to a migration of a person's that waits for it, once
 * it lands:
 *
 *  - `starts_by_itself`: it never ran, and their move runs, so it starts
 *    (`startWhenGranted`);
 *  - `review_and_start`: it never ran, and nothing of theirs runs, so the
 *    owner reviews and starts it once its count is in;
 *  - `ran_before`: it ran, and has lost its way in since (the person took
 *    their grant back), so the grant gives it back.
 */
export type OnceGranted = 'starts_by_itself' | 'review_and_start' | 'ran_before';

/** A migration of a person's that waits for their grant, and what the grant does to it. */
export interface AwaitingTheirGrant {
  readonly mappingId: string;
  readonly then: OnceGranted;
}

/**
 * Which of a person's migrations wait for their grant, each with what the
 * grant does when it lands, for their page. These are the migrations their
 * link asks for that have no way in, read as the grant page reads them
 * (`readPersonGrantSubject`), and judged by the rule `startWhenGranted`
 * applies. Left out: an account their link cannot ask (two Google
 * applications), as the grant page leaves it out, and a finished migration,
 * which waits for nothing. Read inside the caller's tenant transaction.
 */
export async function awaitingTheirGrant(
  db: PgDatabase,
  tenantId: string,
  personId: string,
): Promise<readonly AwaitingTheirGrant[]> {
  const subject = await readPersonGrantSubject(db, tenantId, personId);
  if (!subject) return [];
  const out: AwaitingTheirGrant[] = [];
  for (const account of subject.accounts) {
    if (!account.ask.ok) continue;
    for (const { mappingId, granted } of account.migrations) {
      if (granted) continue;
      const [row] = await db
        .select({ status: schema.mailboxMapping.status })
        .from(schema.mailboxMapping)
        .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
      if (!row || row.status === 'done') continue;
      const then: OnceGranted = !(await isADraft(db, tenantId, mappingId, row.status))
        ? 'ran_before'
        : (await personWhoseMoveRuns(db, tenantId, mappingId))
          ? 'starts_by_itself'
          : 'review_and_start';
      out.push({ mappingId, then });
    }
  }
  return out;
}

/**
 * Start each of these migrations that has never run, when its person's move
 * is running; the grant has just landed on them. Answers the ones it started.
 * Never throws: see the header.
 */
export async function startWhenGranted(
  source: Pool | LedgerDriver,
  input: { readonly tenantId: string; readonly mappingIds: readonly string[] },
): Promise<readonly string[]> {
  const { tenantId } = input;
  if (input.mappingIds.length === 0) return [];
  try {
    const free = await enqueueIfFree(tenantId, source);
    if ('stopped' in free) {
      log.info(`[api] a grant landed while the organisation was ${free.stopped}: nothing starts by itself`);
      return [];
    }

    const started: string[] = [];
    for (const mappingId of input.mappingIds) {
      const moved = await withTenantDb(tenantId, source, async (db) => {
        const [row] = await db
          .select({ status: schema.mailboxMapping.status })
          .from(schema.mailboxMapping)
          .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)))
          .for('update');
        if (!row || !(await isADraft(db, tenantId, mappingId, row.status))) return false;
        if (!(await personWhoseMoveRuns(db, tenantId, mappingId))) return false;

        await db
          .update(schema.mailboxMapping)
          .set({ status: 'active', updatedAt: new Date() })
          .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
        await recordMappingStatusChange(db, tenantId, {
          mappingId,
          from: row.status,
          to: 'active',
          actor: GRANT_ACTOR,
          via: 'grant',
        });
        await movePathsWithMapping(db, tenantId, mappingId, { from: row.status, to: 'active' });
        return true;
      });
      if (moved) started.push(mappingId);
    }

    for (const mappingId of started) {
      // As *Start*: no `domains`, so the pass reads the migration's own scope.
      const { taskId, payload } = resolveSyncJob(tenantId, mappingId, {});
      try {
        await free.enqueue(taskId, payload, {
          tags: [`tenant:${tenantId}`, `mapping:${mappingId}`],
          concurrencyKey: mappingId,
        });
      } catch (error) {
        log.error(`[api] mapping ${mappingId} started when granted, and its first pass could not be enqueued:`, error);
      }
    }
    return started;
  } catch (error) {
    log.error('[api] starting the migrations a grant landed on failed:', error);
    return [];
  }
}
