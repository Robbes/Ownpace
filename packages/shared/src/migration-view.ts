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

import type { DiscoveryDomain } from './discovery.ts';
import type { DomainStatusReport, MappingLifecycle } from './operating-contract.ts';
import type { FailureCategory, FailureSide } from './failure-category.ts';
import type { PauseReason } from './pause-reason.ts';
import type { MigrationStatus } from './ports.ts';

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
  /** When the link stops working. Somebody who bookmarked it is owed the date. */
  readonly expiresAt: string;
}

/**
 * Narrow one status report to what a link holder may see.
 *
 * ## The two fields that do not cross, and what each would cost
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
 * Written as an explicit construction and never as `{ ...report }`. A spread
 * would carry today's two forbidden fields and every future one, silently, on
 * the day somebody adds it — which is the failure this module is the answer to.
 */
export function viewRowFor(report: DomainStatusReport): ViewDomainRow {
  return {
    domain: report.domain,
    state: report.state,
    itemsSynced: report.itemsSynced,
    itemsFailed: report.itemsFailed,
    bytesTransferred: report.bytesTransferred,
    itemsRetrying: report.itemsRetrying,
    itemsNeedingDecision: report.itemsNeedingDecision,
    ...(report.lastSyncedAt ? { lastSyncedAt: report.lastSyncedAt } : {}),
    ...(report.lastActiveAt ? { lastActiveAt: report.lastActiveAt } : {}),
    ...(report.pausedReason ? { pausedReason: report.pausedReason } : {}),
    ...(report.lastErrorCategory ? { lastErrorCategory: report.lastErrorCategory } : {}),
    ...(report.failedSide ? { failedSide: report.failedSide } : {}),
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
  'lastSyncedAt',
  'lastActiveAt',
  'pausedReason',
  'lastErrorCategory',
  'failedSide',
];
