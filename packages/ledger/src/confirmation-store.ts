// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// Where a confirmation pass's findings land (workplan 0117 T2, slice 3).
//
// Slice 2 built the pass — it re-reads an item on the target and turns what the
// target did into a `TargetAnswer`. This is the place that answer goes, and the
// read that turns a stored answer back into a row somebody can look at.
//
// ## Evidence in, claim out
//
// What is WRITTEN is the target's answer (`item.confirmed_answer`, five
// values). What is READ is a `ConfirmedRow`, derived every time by `rowFor`
// from that answer plus the ledger's own status. The word is never stored.
//
// That asymmetry is the whole design and migration 0045 argues it at length:
// evidence does not go stale, an interpretation does, and this plan has already
// corrected its own interpretation once — slice 1 shipped seven row states and
// slice 2 found an eighth. Rows carrying slice 1's frozen word would still be
// telling somebody an item is `missing` where the truth was `unchecked`.
//
// ## Nothing here starts a run
//
// The run row is `RunStore`'s (kind `confirm`, trigger `manual` for one a
// person pressed). This module only records what was found and reads it back.

import {
  answerFromStored,
  needsTargetRead,
  rowFor,
  storedAnswerFor,
  type ConfirmedRow,
  type DiscoveryDomain,
  type LedgerRecord,
  type MappingId,
  type TargetAnswer,
  type TenantId,
} from '@openmig/shared';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { PgDatabase } from './db.ts';
import * as schemaPg from './schema-pg.ts';

/**
 * The placeholder for a status that needs no target read.
 *
 * The same value `confirmation-pass.ts` passes for those statuses, and named
 * here for the same reason: `rowFor` does not look at the answer for any of
 * them, so this is not a claim about the target. It must never be STORED —
 * `record` is only called for items the pass actually consulted.
 */
const NOT_CONSULTED: TargetAnswer = { onTarget: false };

/**
 * One item a pass has to decide about — what the pass needs, plus the id the
 * recorder writes back to.
 *
 * Structurally a `ConfirmableItem` (`@openmig/core`) with `itemId` added. Not
 * imported from there: the ledger is underneath core, and a package that owns
 * the rows should not have to depend on the one that reasons about them.
 */
export interface ConfirmableRow {
  readonly itemId: string;
  readonly naturalKeyHash: string;
  readonly status: LedgerRecord['status'];
  readonly contentHash: string | null;
}

/** One item's finding, as the pass produces it. */
export interface ConfirmationFinding {
  readonly itemId: string;
  readonly answer: TargetAnswer;
}

/** A row of the list, with enough to identify the item it speaks for. */
export interface ConfirmedListRow extends ConfirmedRow {
  readonly itemId: string;
  readonly domain: DiscoveryDomain;
  readonly collection: string;
  readonly naturalKey: string;
  /** When the target was asked. `null` = never — the row is `unchecked`. */
  readonly confirmedAt: Date | null;
}

/**
 * Records what a confirmation pass found.
 *
 * Assumes the caller has established the tenant context (`withTenant`), like
 * every other store in this package.
 */
export class ConfirmationStore {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  /**
   * Write down what the target said about one item.
   *
   * `confirmedAt` and `confirmedByRun` are set in the same statement as the
   * answer, so the three cannot drift apart: an answer whose age nobody knows
   * is not evidence a person can weigh.
   */
  async record(args: {
    tenantId: TenantId;
    runId: string;
    finding: ConfirmationFinding;
    at?: Date;
  }): Promise<void> {
    await this.db
      .update(schemaPg.item)
      .set({
        confirmedAnswer: storedAnswerFor(args.finding.answer),
        confirmedAt: args.at ?? new Date(),
        confirmedByRun: args.runId,
      })
      .where(
        and(
          eq(schemaPg.item.tenantId, args.tenantId),
          eq(schemaPg.item.id, args.finding.itemId),
        ),
      );
  }

  /**
   * Every item of one domain, streamed in id order, for a pass to work through.
   *
   * KEYSET-PAGED, not `LIMIT/OFFSET` and not one big `SELECT`. D7(a) authorised
   * confirming EVERY item of a family file account, and the two obvious shapes
   * both fail on exactly that account: loading it whole exhausts memory, and
   * `OFFSET` re-walks the rows it already skipped, so the pass gets slower the
   * further it gets. Ordering by `id` and asking for the ones after the last
   * one seen is flat.
   *
   * It also means a pass that dies halfway has still written what it confirmed:
   * each page is its own query, and `record` commits per item.
   *
   * Ordered by `id` rather than by anything a person would recognise, because
   * the order only has to be STABLE — `natural_key` is not unique across
   * collections, and a page boundary on a non-unique column silently drops or
   * repeats rows.
   */
  async *itemsToConfirm(args: {
    tenantId: TenantId;
    mappingId: MappingId;
    domain: DiscoveryDomain;
    /** Rows per query. Only a memory/round-trip trade — the result is identical. */
    batch?: number;
  }): AsyncIterable<ConfirmableRow> {
    const size = args.batch ?? 500;
    let after: string | undefined;
    for (;;) {
      const page = await this.db
        .select({
          id: schemaPg.item.id,
          naturalKeyHash: schemaPg.item.naturalKeyHash,
          status: schemaPg.item.status,
          contentHash: schemaPg.item.contentHash,
        })
        .from(schemaPg.item)
        .where(
          and(
            eq(schemaPg.item.tenantId, args.tenantId),
            eq(schemaPg.item.mappingId, args.mappingId),
            eq(schemaPg.item.domain, args.domain),
            ...(after ? [gt(schemaPg.item.id, after)] : []),
          ),
        )
        .orderBy(asc(schemaPg.item.id))
        .limit(size);
      if (page.length === 0) return;
      for (const r of page) {
        yield {
          itemId: r.id,
          naturalKeyHash: r.naturalKeyHash,
          status: r.status as LedgerRecord['status'],
          contentHash: r.contentHash ?? null,
        };
      }
      after = page[page.length - 1]!.id;
      if (page.length < size) return;
    }
  }

  /**
   * The list, as rows a person may read.
   *
   * Every row goes through `rowFor` — slice 1's rule, and the reason the
   * derived word is not in the database. An item nobody has confirmed has a
   * NULL answer and is read as `unreachable`, which `rowFor` turns into
   * `unchecked`: *we did not look*, which is exactly true and is not the same
   * sentence as *it is gone*.
   */
  async rowsFor(args: { tenantId: TenantId; mappingId: MappingId }): Promise<ConfirmedListRow[]> {
    const rows = await this.db
      .select({
        id: schemaPg.item.id,
        domain: schemaPg.item.domain,
        collection: schemaPg.item.collection,
        naturalKey: schemaPg.item.naturalKey,
        status: schemaPg.item.status,
        confirmedAnswer: schemaPg.item.confirmedAnswer,
        confirmedAt: schemaPg.item.confirmedAt,
      })
      .from(schemaPg.item)
      .where(
        and(
          eq(schemaPg.item.tenantId, args.tenantId),
          eq(schemaPg.item.mappingId, args.mappingId),
        ),
      );

    return rows.map((r) => {
      // NO STORED ANSWER MEANS ONE OF TWO DIFFERENT THINGS, and the first
      // version of this read collapsed them.
      //
      // For a status `needsTargetRead` WAIVES — `skipped`, `left_behind`,
      // `pending`, `failed`, and the rest — a pass never asks the target and so
      // never records anything. Those rows keep a NULL forever, and reading it
      // as `unreachable` made them all say **`unchecked`**: *we did not check*.
      // That is false. Nothing needed checking: the ledger already knows they
      // were never placed, which is what `rowFor` says when the answer is the
      // placeholder those statuses ignore.
      //
      // For a status that DOES need the read, a NULL means the pass has not
      // reached this item yet, and `unreachable` — *we could not tell* — is
      // exactly right. Never `{ onTarget: false }`, which would put `missing`
      // on the list for every item still waiting its turn.
      //
      // Getting this wrong is not cosmetic on the one document somebody deletes
      // their originals from: it turns a fact we hold into an admission we do
      // not, and inflates the "could not tell" pile with rows that were never
      // in question.
      const status = r.status as LedgerRecord['status'];
      const answer: TargetAnswer = r.confirmedAnswer
        ? answerFromStored(r.confirmedAnswer)
        : needsTargetRead(status)
          ? { unreachable: true }
          : NOT_CONSULTED;
      const row = rowFor({ domain: r.domain as DiscoveryDomain, status, answer });
      return {
        ...row,
        itemId: r.id,
        domain: r.domain as DiscoveryDomain,
        collection: r.collection,
        naturalKey: r.naturalKey,
        confirmedAt: r.confirmedAt ?? null,
      };
    });
  }
}
