// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What a person holding a progress link is allowed to see (workplan 0122 T1).
 *
 * ADR-0035 gives the migrator's link two lifetimes and one sentence decides the
 * second one's whole shape:
 *
 * > *"the progress page is longer-lived but revocable, and **carries counts and
 * > states rather than content**, which is what makes the longer window
 * > acceptable."*
 *
 * The longer window is bought with that restriction. So the restriction is a
 * module rather than a habit: a function that names every field it copies, a
 * fixture that stops compiling when the contract grows one, and a test that
 * fails on a spread.
 *
 * ## Who reads this, and what that costs
 *
 * The reader has **no Ownpace account and no session** — the same population as
 * `routes/grant.ts`, and for the same reason (ADR-0035: owners sign in, migrated
 * people get links). The link is a bearer credential. It may be forwarded, sit
 * in a chat history, or be opened months later on a shared machine, which is
 * exactly why what it opens must stay boring.
 *
 * In `@openmig/shared` under ADR-0026: both editions build these rows from the
 * same `DomainStatusReport`, so a managed page and an appliance page cannot come
 * to differ about what a stranger may see.
 */

import { discoveryForSelection, type DiscoveryDomain, type DiscoveryRecord } from './discovery.ts';
import type { DomainStatusReport, MappingLifecycle } from './operating-contract.ts';
import type { FailureCategory, FailureSide } from './failure-category.ts';
import type { PauseReason } from './pause-reason.ts';
import type { MigrationStatus } from './ports.ts';
import type { CheckFacts, PhaseFacts } from './progress.ts';
import { stageOf, type Stage } from './stage.ts';
import { timeBeforeStart, type TimeBeforeStart } from './time-before-start.ts';
import { remainingItemsOf, timeWhileCopying, type PassFacts, type TimeWhileCopying } from './time-while-copying.ts';

/**
 * One domain's progress, as a stranger may read it.
 *
 * Every field here is a count, a state, a timestamp or a closed enum. There is
 * no free text of any kind, which is not an accident of the current fields —
 * it is the property `viewRowFor`'s guard exists to keep.
 */
export interface ViewDomainRow {
  readonly domain: DiscoveryDomain;
  readonly state: MigrationStatus['state'];
  readonly itemsSynced: number;
  readonly itemsFailed: number;
  readonly bytesTransferred: number;
  readonly itemsRetrying: number;
  readonly itemsNeedingDecision: number;
  /**
   * How many were left as they already were (0124 T2), when anybody counted.
   *
   * 0122 T1 made this a DECISION rather than a default: `viewRowFor` is an
   * explicit construction and the guard below holds the row's own keys, so a
   * new field on `DomainStatusReport` is a typecheck failure until somebody
   * says whether a stranger may see it. The answer here is yes. It is a count
   * and not content — it carries no name, no key and no folder — and a person
   * watching their own migration has more right to "eleven were already there"
   * than to almost anything else on this page: without it the totals they are
   * reading do not add up, and they have nowhere to go and ask why.
   *
   * Absent when the count was not taken, exactly as on the report it comes
   * from. Never a zero standing in for a question nobody asked.
   */
  readonly itemsAdopted?: number;
  /**
   * What discovery found of this data type (0154 T2, T8): the total the line
   * sets its count against, *18,234 of ~19,000*. A count with no name, key or
   * folder in it, so it crosses for the reason `itemsAdopted` does: without
   * it a person reads how many arrived and not of how many. Absent where
   * nobody counted, never a zero standing in for the count.
   */
  readonly itemsFound?: number;
  /** Their size, where the source has cheap sizes: the files' *12.4 of ~38 GB*. */
  readonly bytesFound?: number;
  /**
   * Where it is, in a person's words (0154 T1, T8): the stage the owner's line
   * shows for it, worked out here from the same facts (`viewStageOf`). The
   * stage crosses and its inputs do not: *Paused* says the data type no
   * longer follows, and not whose stop it was, which is why `stoppedByOwner`
   * stays at home. Absent for a phase the stage table does not place (hard
   * rule 9), and the page then says what it said before stages existed.
   */
  readonly stage?: Stage;
  /** The last COMPLETION — the only honest source for "up to date as of". */
  readonly lastSyncedAt?: string;
  /** When a pass last touched this domain, completed or not. */
  readonly lastActiveAt?: string;
  /**
   * Why this domain stopped on purpose. Crosses in full, including an
   * operator hold's own words: those are an operational notice about the
   * platform, addressed to whoever is waiting, and they name nothing in
   * anybody's account. A paused domain with no reason is the silence 0023 and
   * migration 0041 exist to end, and it is worse for this reader than for any
   * other — they cannot look anything up.
   */
  readonly pausedReason?: PauseReason;
  /**
   * What KIND the last failure was. The category and not the prose — see
   * `viewRowFor` for the difference and why it matters here specifically.
   */
  readonly lastErrorCategory?: FailureCategory;
  /** Which side it happened on, when the pass could tell. A closed enum. */
  readonly failedSide?: FailureSide;
}

/**
 * The whole answer `GET /api/view/:link` gives.
 *
 * Typed here rather than in the route so the shape is a contract both editions
 * could serve, and so the fields that are NOT on it are visible in one place:
 * no mapping id, no tenant id, no mapping name, no address, no connection, no
 * folder, no file, no other migration.
 */
export interface MigrationView {
  /**
   * Who is doing this. Watching an anonymous organisation move your mail is
   * not insight — the same argument the grant page makes before its button.
   */
  readonly organisation: string;
  /** Where the migration is in its life, in the operating contract's words. */
  readonly state: MappingLifecycle;
  /**
   * Whether any pass has ever touched this migration.
   *
   * **Absence is not zero**, and this is the field that keeps them apart. A
   * mapping whose grant landed an hour ago has no `migration_status` rows at
   * all; rendering that as five domains reading `0` would tell somebody their
   * migration finished and moved nothing. Same distinction 0117 §7c makes
   * about omitted rows and 0121 §4b about pruned months, and it matters most
   * here, because this reader has nowhere else to check.
   */
  readonly started: boolean;
  readonly domains: readonly ViewDomainRow[];
  /** The source's kind (`gmail`, `imap`, …), to name who slowed it in `time`. Absent when unread. */
  readonly from?: string;
  /** See `ViewProgressExtras.checkPassedAt`. */
  readonly checkPassedAt?: string;
  /** See `ViewProgressExtras.time`. */
  readonly time?: ViewTime;
  /** When the link stops working. Somebody who bookmarked it is owed the date. */
  readonly expiresAt: string;
  /**
   * The grant this page may take back (workplan 0108 T8 (c)).
   *
   * `granted`: the migration reads the account on a grant given through a
   * link, and the page offers to withdraw it. `withdrawn`: it was withdrawn,
   * and when, and nothing reads the account until somebody grants again.
   * `none`: there is no grant here to take back, because nobody has granted
   * yet or the migration reads the account some other way, so the page offers
   * nothing.
   */
  readonly grant: ViewGrant;
}

/** See `MigrationView.grant`. */
export type ViewGrant =
  | { readonly state: 'granted' }
  | { readonly state: 'withdrawn'; readonly withdrawnAt: string }
  | { readonly state: 'none' };

/**
 * What the page says about the grant, from the two columns that decide it.
 *
 * Withdrawn wins over a token that is somehow still there: while a withdrawal
 * stands, nothing reads the account (`grantWithdrawnRefusal`), so offering to
 * withdraw it again would offer something that is already true.
 */
export function viewGrantFor(row: {
  readonly sourceSecretRef: string | null;
  readonly grantWithdrawnAt: Date | null;
}): ViewGrant {
  if (row.grantWithdrawnAt) return { state: 'withdrawn', withdrawnAt: row.grantWithdrawnAt.toISOString() };
  return row.sourceSecretRef ? { state: 'granted' } : { state: 'none' };
}

/**
 * Narrow one status report to what a link holder may see.
 *
 * ## The three fields that do not cross, and what each would cost
 *
 * **`lastError` — the provider's own prose.** Kept verbatim everywhere else
 * (ADR-0024's prose boundary) precisely because it is precise, and precise is
 * the problem: a rejection reads `550 5.7.1 message rejected:
 * /Documents/tax-return-2024.pdf`, a Graph refusal names the item it refused.
 * A file name is content. It stays on the owner's screen, where the person
 * reading it is the person entitled to it. **`lastErrorCategory` crosses in its
 * place** — a closed enum, naming no object, and the half a person can actually
 * act on (0110 T3's finding).
 *
 * **`lastPass` — where the pass spent its time.** Neither content nor secret,
 * and left out anyway: it is an operator's diagnostic, it means nothing to
 * somebody asking whether their mail has arrived, and every line on this page
 * has to earn itself.
 *
 * **`stoppedByOwner` — whose stop it was** (0128 T4, slice 3c). The state
 * `stopped` crosses, so the link holder sees that a data type no longer
 * follows. Who stopped it, and so where the way back is, is the owner's
 * business: the Resume it points at is on a page this reader cannot open.
 *
 * Written as an explicit construction and never as `{ ...report }`. A spread
 * would carry today's two forbidden fields and every future one, silently, on
 * the day somebody adds it — which is the failure this module is the answer to.
 */
export function viewRowFor(report: DomainStatusReport, stage?: Stage): ViewDomainRow {
  return {
    domain: report.domain,
    state: report.state,
    itemsSynced: report.itemsSynced,
    itemsFailed: report.itemsFailed,
    bytesTransferred: report.bytesTransferred,
    itemsRetrying: report.itemsRetrying,
    itemsNeedingDecision: report.itemsNeedingDecision,
    // `!== undefined`, not truthiness: a counted ZERO is a real answer here —
    // "nothing was left behind" — and `0 ? … : {}` would drop it and make it
    // look like nobody counted.
    ...(report.itemsAdopted !== undefined ? { itemsAdopted: report.itemsAdopted } : {}),
    ...(report.lastSyncedAt ? { lastSyncedAt: report.lastSyncedAt } : {}),
    ...(report.lastActiveAt ? { lastActiveAt: report.lastActiveAt } : {}),
    ...(report.pausedReason ? { pausedReason: report.pausedReason } : {}),
    ...(report.lastErrorCategory ? { lastErrorCategory: report.lastErrorCategory } : {}),
    ...(report.failedSide ? { failedSide: report.failedSide } : {}),
    // Counts, by the same `!== undefined` rule: a discovery that counted none
    // is an answer, *none found*, and a missing one is no total at all.
    ...(report.itemsFound !== undefined ? { itemsFound: report.itemsFound } : {}),
    ...(report.bytesFound !== undefined ? { bytesFound: report.bytesFound } : {}),
    ...(stage !== undefined ? { stage } : {}),
  };
}

/**
 * Every field a `ViewDomainRow` may carry, as data.
 *
 * The test asserts the row's OWN keys against this, so a spread that carried
 * eleven extra fields fails on the first one rather than on whichever the
 * assertions happened to name.
 */
export const VIEW_ROW_FIELDS: readonly (keyof ViewDomainRow)[] = [
  'domain',
  'state',
  'itemsSynced',
  'itemsFailed',
  'bytesTransferred',
  'itemsRetrying',
  'itemsNeedingDecision',
  'itemsAdopted',
  'lastSyncedAt',
  'lastActiveAt',
  'pausedReason',
  'lastErrorCategory',
  'failedSide',
  'itemsFound',
  'bytesFound',
  'stage',
];

/**
 * How long, as a progress page says it (0154 T3, T8), by the rule the owner's
 * pages use: before any pass has completed, from what the count found
 * (`timeBeforeStart`); once one has, while the migration copies, from the
 * last passes' own pace (`timeWhileCopying`). Numbers and closed words only,
 * like every other field a link holder reads.
 */
export type ViewTime =
  | { readonly kind: 'beforeStart'; readonly estimate: TimeBeforeStart }
  | { readonly kind: 'whileCopying'; readonly estimate: TimeWhileCopying };

/** What a migration's progress adds to its rows on a progress page (0154 T8). */
export interface ViewProgressExtras {
  /**
   * When the check passed, for *Ready to switch*'s line: *The check passed
   * yesterday*. Absent unless it passed. A check that did not pass, or could
   * not run, is the owner's to read; this page says each data type's stage,
   * which stays *Kept in step* until the check opens the way.
   */
  readonly checkPassedAt?: string;
  /** How long; absent where nothing should be said (`viewTimeOf`). */
  readonly time?: ViewTime;
}

/**
 * A data type's stage for a progress page (0154 T8): `stageOf` on the facts
 * the owner's line reads (`lineStage` in the web app). Its phase and its stop,
 * its pass state, whether a pass over it completed, whether the check passed,
 * and the failures that block Finish, which is the count `finishTransition`
 * refuses on: those needing a decision, the digest's `failuresWaiting`.
 */
export function viewStageOf(
  report: DomainStatusReport,
  path: PhaseFacts,
  check: CheckFacts,
  failuresWaiting: number,
): Stage | undefined {
  return stageOf({
    phase: path.phase,
    ...(path.stopped === true || report.stoppedByOwner === true ? { stopped: true } : {}),
    domainState: report.state,
    completedOnce: Boolean(report.lastSyncedAt),
    checkPassed: check.state === 'passed',
    unresolvedFailures: failuresWaiting,
  });
}

/**
 * How long, for a progress page (0154 T3, T8), from the facts the owner's
 * migration page reads.
 *
 * - **Before any pass has completed**, from the count, where it counted
 *   something: Gmail's mail in days from its daily ceiling, anything else
 *   *we will know after the first hour* (`timeBeforeStart`). Said while the
 *   migration waits to start, or copies its first pass.
 * - **Once a pass has completed, while it copies**, from the last passes
 *   (`timeWhileCopying`), with the provider's slowing said where a copying
 *   data type's last failure was the provider asking us to slow down.
 * - **Nothing otherwise.** Past its copying (switching, done, kept in step
 *   after the switch) there is nothing left to wait for, and on a migration
 *   held after it started a range of days would be a promise nothing is
 *   keeping.
 */
export function viewTimeOf(input: {
  readonly lifecycle: MappingLifecycle;
  /** The migration's status rows, with what discovery found (`buildDomainStatusReports`). */
  readonly reports: readonly DomainStatusReport[];
  /** Its run history, newest first. */
  readonly passes: readonly PassFacts[];
  /** The source's kind, and its IMAP host where it has one. */
  readonly source: string | undefined;
  readonly sourceHost?: string;
  /** The data types the migration carries. */
  readonly selected: readonly DiscoveryDomain[];
  readonly discovery: readonly DiscoveryRecord[];
}): ViewTime | undefined {
  const rows = input.reports.filter((r) => r.state !== 'skipped');
  const firstPassIn = rows.some((r) => Boolean(r.lastSyncedAt));
  if (!firstPassIn) {
    if (input.lifecycle !== 'active' && input.lifecycle !== 'paused') return undefined;
    const counted = discoveryForSelection(input.discovery, input.selected);
    if (counted.length === 0) return undefined;
    return {
      kind: 'beforeStart',
      estimate: timeBeforeStart({
        source: input.source,
        ...(input.sourceHost ? { sourceHost: input.sourceHost } : {}),
        domains: input.selected,
        mailBytes: counted.find((d) => d.domain === 'email' && d.lastError === undefined)?.bytes,
      }),
    };
  }
  if (input.lifecycle !== 'active') return undefined;
  const estimate = timeWhileCopying({
    remainingItems: remainingItemsOf(rows),
    passes: input.passes,
    slowed: rows.some((r) => r.lastErrorCategory === 'rate_limited'),
  });
  return estimate ? { kind: 'whileCopying', estimate } : undefined;
}

/**
 * A PERSON'S PROGRESS PAGE (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b),
 * slice 3): the whole answer `GET /api/view/:link` gives for a person's link.
 *
 * Every migration of theirs, each as a migration's own page shows it, with
 * the same counts and states and nothing more. The one addition is what makes
 * *Take my grant back* per account: the migrations that read one Google
 * account are grouped, and the group is named by an opaque `ref`, never by
 * the address, because this page, like a migration's, carries no address.
 */
export interface PersonView {
  /** What tells this answer from a migration's, as the grant page's `kind` does. */
  readonly kind: 'person';
  readonly organisation: string;
  readonly expiresAt: string;
  /** In the order they were added to the person. */
  readonly migrations: readonly PersonViewMigration[];
  /** The Google accounts their migrations read, in the order first met. */
  readonly accounts: readonly PersonViewAccount[];
}

/** One migration of a person's, as a stranger may read it. */
export interface PersonViewMigration {
  /** The source's kind (`google`, `imap`, …), for the page to name. */
  readonly from: string;
  /** The destination's kind, or null when it has none. */
  readonly to: string | null;
  readonly state: MappingLifecycle;
  /** See `MigrationView.started`: absence is not zero. */
  readonly started: boolean;
  readonly domains: readonly ViewDomainRow[];
  /** See `ViewProgressExtras.checkPassedAt`. */
  readonly checkPassedAt?: string;
  /** See `ViewProgressExtras.time`. */
  readonly time?: ViewTime;
  /** The `ref` of the account it reads, or null when it reads none through a link. */
  readonly account: string | null;
}

/** One Google account a person's migrations read. */
export interface PersonViewAccount {
  /**
   * Opaque. While a grant is held it is derived from the grants its
   * migrations hold, so a withdrawal names exactly what the page read: when a
   * grant changes, the ref changes, and a press on a stale page takes nothing
   * (`changed`). Otherwise it only groups the page's migrations.
   */
  readonly ref: string;
  /** Across its migrations: granted while any holds a grant, else withdrawn, else none. */
  readonly grant: ViewGrant;
}
