// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A REPORT SAYS ABOUT ITSELF, FROM OUR RECORDS (workplan 0130 T6, Part A;
 * the owner's "Both parts", 2026-09-28).
 *
 * A report carried the page, the error's reference and category, the
 * organisation's id and the build. Support's first answer was then always a
 * question. These are the facts that answer it, read by the server, never
 * taken from the browser:
 *
 * - **the organisation's status**, and when it closed and will be removed,
 *   when it is closing;
 * - **the migration on the page**, when the page names one (`/mappings/<id>`):
 *   its state, whether access was given or withdrawn, its newest grant link's
 *   state, each data type's state, error category, side and reference, and the
 *   two accounts' providers and last test;
 * - **whether the report's reference is a current failure**, and of which
 *   data type on which migration;
 * - **the service hold**, on or off, and **the scheduler**, running or not.
 *
 * The reporter's role and browser come from the request (`problem-report.ts`
 * writes the lines).
 *
 * ## Inside the reporter's organisation, under row security
 *
 * Read in one `withTenantDb(tenantId)` on the API's own pool, as `app_user`
 * (docs/rls-guide.md). The migration id comes from the browser, in the page's
 * path, and anybody can type another organisation's there: under row security
 * that migration is not there to read, and the report says the id is not one
 * of this organisation's, which it says of an id that exists nowhere too. The
 * hold and the scheduler's beat are the service's, not an organisation's, and
 * `app_user` reads them as the hold banner and `/ready` do.
 *
 * ## Named fields, closed words
 *
 * Every read names its columns, and every fact is built field by field:
 * {@link REPORT_FACT_FIELDS} is the whole of what a report can carry from
 * here, and the guard holds the reader to it with every column of every table
 * filled in, so a row spread into a fact would show at once. What is never
 * read: a provider's error text (`last_error`), anything an organisation or a
 * migrated person typed (names, addresses, folders, hosts, the organisation's
 * settings), items and their names, credentials and tokens (a grant is read as
 * whether there is one, in SQL, and the token never leaves the database), and
 * the operator's hold message.
 *
 * And every value is one of its column's own words, or it is not sent as
 * itself: a category column has no CHECK in the database, so a value no
 * vocabulary has is written `unrecognised`, whatever it says.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import * as schema from '@openmig/ledger';
import { linkState, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import { readOpenPause, readTickBeat } from '@openmig/managed';
import { tenantClosure } from '@openmig/managed/schema-managed';
import {
  APP_EVENT_REFERENCE,
  DISCOVERY_DOMAINS,
  DOMAIN_STATES,
  FAILURE_SIDES,
  isFailureCategory,
} from '@openmig/shared';
import { withTenantDb } from './middleware/auth.ts';

/** What a report asks the records about: its organisation, and what its page and error name. */
export interface ReportFactsAsk {
  readonly tenantId: string;
  /** The migration id the page names, from the browser; checked here, under row security. */
  readonly mappingId?: string;
  /** The error's reference the report carries, if any. */
  readonly reference?: string;
}

/** One data type of the migration on the page. */
export interface DataTypeFacts {
  readonly dataType: string;
  readonly state: string;
  readonly category: string | null;
  readonly side: string | null;
  readonly reference: string | null;
}

/** One of a migration's two accounts: its provider, and its status as its last test left it. */
export interface AccountFacts {
  readonly provider: string;
  readonly status: string;
}

/** The migration the page names, as this organisation's records hold it. */
export interface MigrationFacts {
  readonly id: string;
  readonly state: string;
  readonly grant: 'given' | 'withdrawn' | 'not given';
  /** ISO, when the grant was withdrawn. */
  readonly grantWithdrawnAt: string | null;
  readonly grantLink: 'live' | 'used' | 'revoked' | 'expired' | 'none issued';
  readonly dataTypes: readonly DataTypeFacts[];
  readonly source: AccountFacts | null;
  readonly destination: AccountFacts | null;
}

export interface ReportFacts {
  readonly organisation: {
    readonly status: string;
    /** ISO, when the organisation was closed; null while it is not. */
    readonly closedAt: string | null;
    /** ISO, when its data is removed; null while it is not closed. */
    readonly purgeAfter: string | null;
  };
  /**
   * The migration the page names: absent when the page names none, and only
   * its id, `notFound`, when the id is not one of this organisation's.
   */
  readonly migration?: MigrationFacts | { readonly id: string; readonly notFound: true };
  /**
   * Where the report's reference is a current failure: absent when the report
   * carries no reference, null when it is no current failure of this
   * organisation's.
   */
  readonly referenceMatch?: { readonly migrationId: string; readonly dataType: string } | null;
  readonly hold: { readonly on: boolean; /** ISO. */ readonly since: string | null };
  readonly scheduler: 'running' | 'not running';
}

/**
 * EVERY FIELD A REPORT'S FACTS CAN HAVE, dotted, `[]` for a row of a list.
 * The guard reads facts with every column filled in and holds them to exactly
 * this list: a field more is a column somebody passed through, and a whole
 * row spread into a fact would be dozens more.
 */
export const REPORT_FACT_FIELDS = [
  'organisation.status',
  'organisation.closedAt',
  'organisation.purgeAfter',
  'migration.id',
  'migration.notFound',
  'migration.state',
  'migration.grant',
  'migration.grantWithdrawnAt',
  'migration.grantLink',
  'migration.dataTypes[].dataType',
  'migration.dataTypes[].state',
  'migration.dataTypes[].category',
  'migration.dataTypes[].side',
  'migration.dataTypes[].reference',
  'migration.source.provider',
  'migration.source.status',
  'migration.destination.provider',
  'migration.destination.status',
  // Null when the report's reference is no current failure of this organisation's.
  'referenceMatch',
  'referenceMatch.migrationId',
  'referenceMatch.dataType',
  'hold.on',
  'hold.since',
  'scheduler',
] as const;

/** A migration's id in a page's path: `/mappings/<uuid>`, alone or with a screen after it. */
const MIGRATION_PAGE = /^\/mappings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?]|$)/i;

/** The migration a page is about, when its path names one. */
export function migrationIdOnPage(page: string): string | undefined {
  return MIGRATION_PAGE.exec(page)?.[1]?.toLowerCase();
}

/** The value when it is one of `words`, and otherwise `unrecognised`, whatever it said. */
function oneOf(value: string | null | undefined, words: readonly string[]): string {
  return value !== null && value !== undefined && words.includes(value) ? value : 'unrecognised';
}

const iso = (value: Date | string | null | undefined): string | null =>
  value === null || value === undefined ? null : new Date(value).toISOString();

async function readAccount(db: PgDatabase, tenantId: string, mailboxId: string): Promise<AccountFacts | null> {
  const rows = await db
    .select({ provider: schema.connection.kind, status: schema.connection.status })
    .from(schema.mailbox)
    .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
    .where(and(eq(schema.mailbox.id, mailboxId), eq(schema.mailbox.tenantId, tenantId)));
  const row = rows[0];
  if (!row) return null;
  return {
    provider: oneOf(row.provider, schema.connection.kind.enumValues),
    status: oneOf(row.status, schema.connection.status.enumValues),
  };
}

async function readMigration(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
  now: Date,
): Promise<NonNullable<ReportFacts['migration']>> {
  const rows = await db
    .select({
      state: schema.mailboxMapping.status,
      // Whether there is a grant, asked in SQL: the token stays in the database.
      hasGrant: sql<boolean>`${schema.mailboxMapping.sourceSecretRef} IS NOT NULL`,
      grantWithdrawnAt: schema.mailboxMapping.grantWithdrawnAt,
      sourceMailboxId: schema.mailboxMapping.sourceMailboxId,
      targetMailboxId: schema.mailboxMapping.targetMailboxId,
    })
    .from(schema.mailboxMapping)
    .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
  const mapping = rows[0];
  if (!mapping) return { id: mappingId, notFound: true };

  const links = await db
    .select({
      usedAt: schema.mappingLink.usedAt,
      revokedAt: schema.mappingLink.revokedAt,
      expiresAt: schema.mappingLink.expiresAt,
    })
    .from(schema.mappingLink)
    .where(
      and(
        eq(schema.mappingLink.tenantId, tenantId),
        eq(schema.mappingLink.mappingId, mappingId),
        eq(schema.mappingLink.purpose, 'grant'),
      ),
    )
    .orderBy(desc(schema.mappingLink.createdAt))
    .limit(1);
  const link = links[0];

  const status = schema.migrationStatus;
  const types = await db
    .select({
      dataType: status.domain,
      state: status.state,
      category: status.lastErrorCategory,
      side: status.failedSide,
      reference: status.lastErrorReference,
    })
    .from(status)
    .where(and(eq(status.tenantId, tenantId), eq(status.mappingId, mappingId)))
    .orderBy(status.domain);

  const withdrawnAt = iso(mapping.grantWithdrawnAt);
  return {
    id: mappingId,
    state: oneOf(mapping.state, schema.mailboxMapping.status.enumValues),
    grant: withdrawnAt ? 'withdrawn' : mapping.hasGrant === true ? 'given' : 'not given',
    grantWithdrawnAt: withdrawnAt,
    grantLink: link ? linkState(link, now) : 'none issued',
    dataTypes: types.map((t) => ({
      dataType: oneOf(t.dataType, DISCOVERY_DOMAINS),
      state: oneOf(t.state, DOMAIN_STATES),
      category: t.category === null ? null : isFailureCategory(t.category) ? t.category : 'unrecognised',
      side: t.side === null ? null : oneOf(t.side, FAILURE_SIDES),
      reference: t.reference === null ? null : APP_EVENT_REFERENCE.test(t.reference) ? t.reference : 'unrecognised',
    })),
    source: await readAccount(db, tenantId, mapping.sourceMailboxId),
    destination: mapping.targetMailboxId ? await readAccount(db, tenantId, mapping.targetMailboxId) : null,
  };
}

/**
 * The facts, read with `db`, which must already be scoped to `ask.tenantId`
 * (`withTenantDb`): every read below also names the organisation, and row
 * security holds each one to it whether it does or not.
 */
export async function readReportFacts(db: PgDatabase, ask: ReportFactsAsk, now: Date): Promise<ReportFacts> {
  const { tenantId } = ask;

  const organisations = await db
    .select({ status: schema.tenant.status })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, tenantId));
  const closures = await db
    .select({ closedAt: tenantClosure.closedAt, purgeAfter: tenantClosure.purgeAfter })
    .from(tenantClosure)
    .where(eq(tenantClosure.tenantId, tenantId));
  const closure = closures[0];

  let referenceMatch: ReportFacts['referenceMatch'];
  if (ask.reference !== undefined) {
    const status = schema.migrationStatus;
    const matches = await db
      .select({ migrationId: status.mappingId, dataType: status.domain })
      .from(status)
      .where(and(eq(status.tenantId, tenantId), eq(status.lastErrorReference, ask.reference)))
      .limit(1);
    const match = matches[0];
    referenceMatch = match ? { migrationId: match.migrationId, dataType: oneOf(match.dataType, DISCOVERY_DOMAINS) } : null;
  }

  const hold = await readOpenPause(db);
  const facts: ReportFacts = {
    organisation: {
      status: organisations[0] ? oneOf(organisations[0].status, schema.tenant.status.enumValues) : 'not found',
      closedAt: iso(closure?.closedAt),
      purgeAfter: iso(closure?.purgeAfter),
    },
    ...(ask.mappingId !== undefined ? { migration: await readMigration(db, tenantId, ask.mappingId, now) } : {}),
    ...(referenceMatch !== undefined ? { referenceMatch } : {}),
    hold: { on: hold !== null, since: hold ? iso(hold.startedAt) : null },
    scheduler: (await readTickBeat(db, now)) === 'up' ? 'running' : 'not running',
  };
  return facts;
}

/** How the route reads a report's facts: in the reporter's organisation, as `app_user`. */
export type ReportFactsReader = (ask: ReportFactsAsk) => Promise<ReportFacts>;

/**
 * The reader over `source`: the API's `app_user` pool (`getDbPool`), or a test's
 * PGlite driver in that role. One transaction, scoped to the organisation.
 */
export function reportFactsReader(
  source: () => Pool | LedgerDriver,
  now: () => Date = () => new Date(),
): ReportFactsReader {
  return (ask) => withTenantDb(ask.tenantId, source(), (db) => readReportFacts(db, ask, now()));
}
