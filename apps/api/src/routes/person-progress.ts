// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PERSON'S PROGRESS PAGE, AND TAKING A GRANT BACK PER ACCOUNT (ADR-0035,
 * amended 2026-09-29; workplan 0153 T5 (b), slice 3).
 *
 * `view.ts` answers one migration's progress link. A person's progress link
 * answers every migration of theirs, each one exactly as a migration's own
 * page shows it (`migrationProgress`, which both use), and nothing more: no
 * mapping id, no name, no address, no folder, no file, no provider's prose.
 *
 * Two things more since workplan 0176 step B (T6), each a fact the link page
 * already shows the same person: **who sent the link**, by the name the
 * member gave, how the person knows them and the member's own number
 * (`readPersonLinkSender`), with the organisation's number beside it, and
 * never the member's address; and, per migration, **whether the organisation
 * can open the copy** at its destination, by the link page's own rule
 * (`isTheOrganisationsDestination`). The name and the number are what the
 * member chose to show the people they send a link to; how long this page
 * lives makes them part of what the privacy text says (§14).
 *
 * ## Grouped by account, named by nothing a stranger could read
 *
 * *Take my grant back* is per Google account (the amendment's words). So the
 * migrations that read one account are grouped, compared as Google compares
 * addresses (`googleAccountKey`, the key the grant ending binds a sign-in
 * with). The group is named on the page by an opaque `ref` and never by the
 * address: a progress link lives up to 180 days and may be forwarded, and a
 * migration's own progress page carries no address either.
 *
 * While a grant is held, the ref is a hash of the grants its migrations hold.
 * A withdrawal names what the page read, as `withdraw-grant.ts` does for one
 * migration: when a grant is given again or taken back in another tab, the
 * ref changes, and a press on the old page deletes nothing.
 *
 * ## One press, every token, every migration
 *
 * One consent through a person's link lands the same token on every migration
 * it served (`person-grant-ending.ts`). An account may hold more than one
 * token, for instance one from a migration's own link sent earlier. Each
 * distinct token is revoked at Google, and every migration of the account
 * holding one of them is cleared in one transaction, with a
 * `mapping.grant_withdrawn` row each. `withdraw-grant.ts`'s rules hold
 * otherwise: Google first, then here whatever Google said, and nothing reads
 * the account while the withdrawal stands.
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import {
  PgLedger,
  PgMigrationStatusStore,
  RunStore,
  readPathPhases,
  type LedgerDriver,
  type PgDatabase,
} from '@openmig/ledger';
import { personGrantedConnection, personMigration } from '@openmig/managed/schema-managed';
import { readPersonVoice } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import {
  CIRRUX_DRIVE_GRANT_KEY,
  MAPPING_LIFECYCLES,
  RATE_PASSES,
  buildDomainStatusReports,
  checkFactsOf,
  discoveryForSelection,
  foundByDomain,
  hasCirruxDriveGrant,
  isPasswordKind,
  languageOf,
  readTenantContactPhone,
  registerOf,
  reasonPair,
  viewGrantFor,
  viewRowFor,
  viewStageOf,
  viewTimeOf,
  withoutThePersonsKeys,
  type ViewProgressExtras,
  type Bilingual,
  type DestinationWithdrawal,
  type GrantWithdrawal,
  type MappingId,
  type MappingLifecycle,
  type PersonView,
  type PersonViewAccount,
  type PersonViewDestination,
  type PersonViewMigration,
  type Register,
  type TenantId,
  type TokenRevoker,
  type ViewDomainRow,
  type ViewGrant,
  type WhatStopped,
} from '@openmig/shared';
import { withTenantDb } from '../middleware/auth.ts';
import { grantReadiness, namedAccount, readGrantRows, storedCredentials } from './migrations/grant-subject.ts';
import { isTheOrganisationsDestination, readPersonLinkSender } from './migrations/person-grant-subject.ts';
import { isGrantableSourceKind } from './migrations/grant-link-readiness.ts';
import { googleAccountKey } from './migrations/signed-in-account.ts';
import { GRANT_WITHDRAWN_ACTION, WITHDRAWAL_ACTOR, grantedToken } from './withdraw-grant.ts';
import { runReportOf } from './migrations/operating-routes.ts';

/** One migration's counts and states, as every progress page shows them. */
export interface MigrationProgress extends ViewProgressExtras {
  readonly state: MappingLifecycle;
  readonly started: boolean;
  readonly domains: readonly ViewDomainRow[];
  /** The source's kind, to name who slowed it; absent when its connection could not be read. */
  readonly from?: string;
}

/**
 * One migration's progress, inside the caller's tenant transaction, from the
 * same three reads `view.ts` has always made: the status rows, the failures
 * and what was left as it was, through `buildDomainStatusReports`, the ONE
 * place the owner's board and these pages derive their counts (0033 T5).
 *
 * A lifecycle the contract has never heard of throws rather than being
 * guessed a word for (hard rule 9), as `view.ts` did before this was shared.
 */
export async function migrationProgress(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
  status: string,
): Promise<MigrationProgress> {
  if (!MAPPING_LIFECYCLES.includes(status as MappingLifecycle)) {
    throw new Error(
      `mailbox_mapping.status is '${status}', which is not one of ` +
        `${MAPPING_LIFECYCLES.join(', ')}. The database CHECK constraint should make this ` +
        `impossible; refusing to guess what the migration's state is.`,
    );
  }
  const tenant = tenantId as TenantId;
  const mapping = mappingId as MappingId;
  const [domainStatus, failures, adopted, discovery, scopeRows, phases, checks, history, sources] = await Promise.all([
    new PgMigrationStatusStore(db).getStatus(tenant, mapping),
    new PgLedger(db).listFailures(tenant, mapping),
    new PgLedger(db).countAdoptedByDomain(tenant, mapping),
    // What the line sets each count against, and the time before Start
    // (0154 T2, T3, T8): discovery, read by the owner's own rule.
    new schema.PgDiscoveryStore(db).getDiscovery(tenant, mapping),
    db
      .select({ domain: schema.scopeSelection.domain })
      .from(schema.scopeSelection)
      .where(
        and(
          eq(schema.scopeSelection.tenantId, tenantId),
          eq(schema.scopeSelection.mappingId, mappingId),
          eq(schema.scopeSelection.included, true),
        ),
      ),
    // Each data type's phase and stop, and the check: what its stage is read from.
    readPathPhases(db, tenantId, mappingId),
    db
      .select()
      .from(schema.verificationRun)
      .where(and(eq(schema.verificationRun.tenantId, tenantId), eq(schema.verificationRun.mappingId, mappingId)))
      .orderBy(desc(schema.verificationRun.startedAt))
      .limit(1),
    // The last passes, for the time left; their events stay here.
    new RunStore(db).listRunsWithEvents(tenant, mapping, { limit: RATE_PASSES * 2, eventsPerRun: 0 }),
    // The source's kind and IMAP host, for the time before Start. Read for
    // the estimate alone: neither reaches the page but the kind, as the
    // person's page already names it.
    db
      .select({
        kind: schema.connection.kind,
        config: schema.connection.config,
        override: schema.mailboxMapping.sourceConfigOverride,
      })
      .from(schema.mailboxMapping)
      .innerJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMapping.sourceMailboxId))
      .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
      .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId))),
  ]);
  const selected = scopeRows.map((r) => r.domain);
  const reports = buildDomainStatusReports(
    domainStatus,
    failures,
    adopted,
    foundByDomain(discoveryForSelection(discovery, selected)),
  );
  const check = checkFactsOf(runReportOf(checks[0]), mappingId);
  const waiting = failures.filter((f) => f.needsDecision).length;
  const source = sources[0];
  // Merged as a pass merges it (`build-deps-from-mapping`): the mapping's
  // override over the connection's, key by key.
  const config = {
    ...((source?.config as Record<string, unknown> | null) ?? {}),
    ...((source?.override as Record<string, unknown> | null) ?? {}),
  };
  const host = typeof config.host === 'string' && config.host !== '' ? config.host : undefined;
  const time = viewTimeOf({
    lifecycle: status as MappingLifecycle,
    reports,
    passes: history.runs,
    source: source?.kind,
    ...(host ? { sourceHost: host } : {}),
    selected,
    discovery,
  });
  return {
    state: status as MappingLifecycle,
    // Absence, not zero: see `MigrationView.started`.
    started: domainStatus.length > 0,
    domains: reports.map((r) =>
      viewRowFor(r, viewStageOf(r, phases ? phases.phaseOf(r.domain) : { phase: status }, check, waiting)),
    ),
    ...(source ? { from: source.kind } : {}),
    ...(check.state === 'passed' ? { checkPassedAt: check.at } : {}),
    ...(time ? { time } : {}),
  };
}

/** A hash that names a group and says nothing of what it was made from. */
function refOf(kind: 'grant' | 'account' | 'destination', parts: readonly string[]): string {
  return createHash('sha256')
    .update(`${kind}\n${[...parts].sort().join('\n')}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * WHAT EACH HELD MIGRATION'S WITHDRAWAL TOOK BACK (the owner's decisions of
 * 2026-11-26, change 1), inside the caller's tenant transaction.
 *
 * Read from the `mapping.grant_withdrawn` row every withdrawal writes in the
 * same transaction as the hold: a destination's (`withdrawPersonDestination`)
 * carries `role: 'target'`, a source's (`withdraw-grant.ts`,
 * `withdrawPersonGrant`) carries none. The latest row per migration answers.
 *
 * Why the audit row and not the columns: a source's withdrawal also empties
 * `source_secret_ref`, so "held with the source's grant still there" would
 * name a destination's removal in most cases, but not when the person removed
 * the destination's password before they ever gave the source's access. Then
 * both columns read exactly as after a source's withdrawal. The audit row
 * says which, always, and needs no new column. A held migration with no such
 * row (a hold written before the audit row existed) reads as the source's, as
 * every page read it until now.
 *
 * Answers `destination` with the destination's kind (`targetKind`), so the
 * page can name it; never an address.
 */
export async function readWhatStopped(
  db: PgDatabase,
  tenantId: string,
  held: ReadonlyArray<{ readonly mappingId: string; readonly targetKind: string | null }>,
): Promise<Map<string, WhatStopped>> {
  const answer = new Map<string, WhatStopped>();
  if (held.length === 0) return answer;
  const mappingId = sql<string>`${schema.auditLog.detail} ->> 'mappingId'`;
  const rows = await db
    .select({ mappingId, role: sql<string | null>`${schema.auditLog.detail} ->> 'role'` })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.tenantId, tenantId),
        eq(schema.auditLog.action, GRANT_WITHDRAWN_ACTION),
        inArray(mappingId, held.map((h) => h.mappingId)),
      ),
    )
    .orderBy(desc(schema.auditLog.at));
  for (const h of held) {
    // Newest first: the first row met for a migration is its latest withdrawal.
    const latest = rows.find((r) => r.mappingId === h.mappingId);
    answer.set(
      h.mappingId,
      latest?.role === 'target' && h.targetKind ? { what: 'destination', destination: h.targetKind } : { what: 'source' },
    );
  }
  return answer;
}

/** One migration of the person's, with what the page and a withdrawal need of it. */
interface Theirs {
  readonly mappingId: string;
  readonly status: string;
  readonly sourceKind: string;
  readonly targetKind: string | null;
  readonly secretRef: string | null;
  readonly withdrawnAt: Date | null;
  /** `googleAccountKey` of the account it reads, or null when it reads none through a link. */
  readonly accountKey: string | null;
  /** The destination is the organisation's, by the link page's rule (workplan 0176 T6). */
  readonly theOrganisationOpensIt: boolean;
}

/** One account's migrations, with the grants they hold. Server-side only: it carries the secrets. */
interface AccountGroup {
  readonly ref: string;
  readonly grant: ViewGrant;
  readonly migrations: readonly Theirs[];
  /** The distinct grants its migrations hold, each with the source kind that revokes it. */
  readonly held: ReadonlyArray<{ readonly secretRef: string; readonly sourceKind: string }>;
}

/** Every migration of the person's, in the order they were added. */
async function readTheirs(db: PgDatabase, tenantId: string, personId: string): Promise<Theirs[]> {
  // The destinations this person connected themselves (0174 D1 (a)): theirs,
  // so the organisation is not said to open the copy there.
  const grantedByThem = new Set(
    (
      await db
        .select({ connectionId: personGrantedConnection.connectionId })
        .from(personGrantedConnection)
        .where(and(eq(personGrantedConnection.personId, personId), eq(personGrantedConnection.tenantId, tenantId)))
    ).map((r) => r.connectionId),
  );
  const rows = await db
    .select({
      mappingId: personMigration.mappingId,
      status: schema.mailboxMapping.status,
      secretRef: schema.mailboxMapping.sourceSecretRef,
      withdrawnAt: schema.mailboxMapping.grantWithdrawnAt,
    })
    .from(personMigration)
    .innerJoin(schema.mailboxMapping, eq(schema.mailboxMapping.id, personMigration.mappingId))
    .where(and(eq(personMigration.personId, personId), eq(personMigration.tenantId, tenantId)))
    .orderBy(personMigration.addedAt, personMigration.mappingId);

  const theirs: Theirs[] = [];
  for (const row of rows) {
    const grantRows = await readGrantRows(db, tenantId, row.mappingId);
    // Only a Google source reads an account a link can grant: an IMAP
    // mailbox's address is not a Google account, whatever it looks like.
    const named = grantRows && isGrantableSourceKind(grantRows.source.kind) ? namedAccount(grantRows) : null;
    theirs.push({
      mappingId: row.mappingId,
      status: row.status,
      sourceKind: grantRows?.source.kind ?? '',
      targetKind: grantRows?.target?.kind ?? null,
      secretRef: row.secretRef,
      withdrawnAt: row.withdrawnAt,
      accountKey: named ? googleAccountKey(named) : null,
      // Who else can open the copy (0176 T6, §10): the link page's own rule,
      // read from the same rows, so the two pages cannot say it differently.
      theOrganisationOpensIt:
        grantRows !== null &&
        isTheOrganisationsDestination(grantRows, grantReadiness(grantRows).includedDomains, grantedByThem),
    });
  }
  return theirs;
}

/**
 * The person's migrations grouped by the Google account each reads. A
 * migration belongs to a group when its source is one a link can grant and
 * names an address; one that reads no Google account is shown on its own.
 */
function groupByAccount(theirs: readonly Theirs[], stopped: ReadonlyMap<string, WhatStopped> = new Map()): AccountGroup[] {
  const byKey = new Map<string, Theirs[]>();
  for (const m of theirs) {
    if (m.accountKey === null) continue;
    const group = byKey.get(m.accountKey);
    if (group) group.push(m);
    else byKey.set(m.accountKey, [m]);
  }
  return [...byKey.values()].map((migrations): AccountGroup => {
    const held: Array<{ secretRef: string; sourceKind: string }> = [];
    for (const m of migrations) {
      // A source's withdrawal empties `source_secret_ref`, so a held migration
      // that still has one was held by a destination's password being removed
      // (0174 §4.3): its Google access is still given, and stays the person's
      // to withdraw from this page (the owner's answer of 2026-11-26).
      if (!m.secretRef) continue;
      if (!held.some((h) => h.secretRef === m.secretRef)) held.push({ secretRef: m.secretRef, sourceKind: m.sourceKind });
    }
    // The latest withdrawal, and what it took back: the account's section says it.
    const latest = migrations
      .filter((m): m is Theirs & { withdrawnAt: Date } => m.withdrawnAt !== null)
      .sort((a, b) => b.withdrawnAt.getTime() - a.withdrawnAt.getTime())[0];
    const grant: ViewGrant =
      held.length > 0
        ? viewGrantFor({ sourceSecretRef: held[0]!.secretRef, grantWithdrawnAt: null })
        : viewGrantFor(
            { sourceSecretRef: null, grantWithdrawnAt: latest?.withdrawnAt ?? null },
            latest ? stopped.get(latest.mappingId) : undefined,
          );
    const ref =
      held.length > 0
        ? refOf('grant', held.map((h) => h.secretRef))
        : refOf('account', migrations.map((m) => m.mappingId));
    return { ref, grant, migrations, held };
  });
}

/**
 * A person's progress page, inside the caller's tenant transaction. Null when
 * the person is not this organisation's any more.
 */
export async function readPersonView(
  db: PgDatabase,
  input: { readonly tenantId: string; readonly personId: string; readonly expiresAt: Date; readonly linkId: string },
): Promise<PersonView | null> {
  const org = await db
    .select({ name: schema.tenant.name, settings: schema.tenant.settings })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, input.tenantId));
  const organisation = org[0]?.name;
  if (organisation === undefined) return null;
  // Who sent the link (0176 T6, §7): the member's name, relation and own
  // number, never their address; the organisation's number beside it (D11).
  const { sender } = await readPersonLinkSender(db, input.tenantId, input.linkId);
  const organisationPhone = readTenantContactPhone(org[0]?.settings);
  // How the person's pages speak to them (0176 T7), as the link page says it.
  const voice = await readPersonVoice(db, input.tenantId, input.personId);

  const theirs = await readTheirs(db, input.tenantId, input.personId);
  const stopped = await readWhatStopped(
    db,
    input.tenantId,
    theirs.filter((m) => m.withdrawnAt !== null),
  );
  const groups = groupByAccount(theirs, stopped);
  const refFor = (mappingId: string): string | null =>
    groups.find((g) => g.migrations.some((m) => m.mappingId === mappingId))?.ref ?? null;

  const migrations: PersonViewMigration[] = [];
  for (const m of theirs) {
    const progress = await migrationProgress(db, input.tenantId, m.mappingId, m.status);
    migrations.push({
      from: m.sourceKind,
      to: m.targetKind,
      state: progress.state,
      started: progress.started,
      domains: progress.domains,
      ...(progress.checkPassedAt ? { checkPassedAt: progress.checkPassedAt } : {}),
      ...(progress.time ? { time: progress.time } : {}),
      account: refFor(m.mappingId),
      ...(m.withdrawnAt ? { stopped: { at: m.withdrawnAt.toISOString(), ...stopped.get(m.mappingId) } } : {}),
      theOrganisationOpensIt: m.theOrganisationOpensIt,
    });
  }
  const accounts: PersonViewAccount[] = groups.map((g) => ({ ref: g.ref, grant: g.grant }));
  const destinations: PersonViewDestination[] = (await readDestinations(db, input.tenantId, input.personId)).map(
    (d) => ({ ref: d.ref, provider: d.kind, drive: d.drive }),
  );
  return {
    kind: 'person',
    organisation,
    expiresAt: input.expiresAt.toISOString(),
    migrations,
    accounts,
    destinations,
    sender,
    organisationPhone,
    language: languageOf(voice),
    register: registerOf(voice),
  };
}

// ========================= A destination the person connected (workplan 0174 §4.3) =========================

/** One destination the person connected through their link, as the page and a withdrawal read it. Server-side only. */
interface HeldDestination {
  readonly ref: string;
  readonly connectionId: string;
  readonly kind: string;
  readonly grantedAt: Date;
  readonly drive: boolean;
}

/**
 * The destinations `person_granted_connection` names this person for, in the
 * order they were connected. The ref is a hash of the account and when it
 * was connected: a new grant changes it, so a press on a stale page takes
 * nothing.
 */
async function readDestinations(db: PgDatabase, tenantId: string, personId: string): Promise<HeldDestination[]> {
  const rows = await db
    .select({
      connectionId: personGrantedConnection.connectionId,
      grantedAt: personGrantedConnection.grantedAt,
      kind: schema.connection.kind,
      secretRef: schema.connection.secretRef,
    })
    .from(personGrantedConnection)
    .innerJoin(
      schema.connection,
      and(eq(schema.connection.id, personGrantedConnection.connectionId), eq(schema.connection.tenantId, personGrantedConnection.tenantId)),
    )
    .where(
      and(
        eq(personGrantedConnection.personId, personId),
        eq(personGrantedConnection.tenantId, tenantId),
        eq(schema.connection.role, 'target'),
      ),
    )
    .orderBy(personGrantedConnection.grantedAt, personGrantedConnection.connectionId);
  return rows.map((r) => ({
    ref: refOf('destination', [r.connectionId, r.grantedAt.toISOString()]),
    connectionId: r.connectionId,
    kind: r.kind,
    grantedAt: r.grantedAt,
    drive: r.kind === 'cirrux' && hasCirruxDriveGrant(stringValues(storedCredentials(r.secretRef))),
  }));
}

export type DestinationWithdrawalResult =
  | { readonly ok: true; readonly withdrawal: DestinationWithdrawal }
  | { readonly ok: false; readonly code: 'changed'; readonly refusal: Bilingual };

/** Thrown inside the transaction when the row moved since it was read: everything rolls back. */
class DestinationChanged extends Error {}

/**
 * REMOVE THE PASSWORD A PERSON GAVE A DESTINATION (workplan 0174 §4.3, §5.9).
 *
 * The person's progress page, per account: *"the secret keys the person
 * typed are removed from the connection, the managed row is deleted, and
 * nothing writes to that account until they grant again."* One transaction:
 *
 * 1. the destination is read again by its `ref` (a new grant or another tab
 *    changed it: `changed`, nothing removed), and its row locked;
 * 2. the connection's `secret_ref` keeps only what is the owner's
 *    (`withoutThePersonsKeys`): every secret, the fields the person filled,
 *    and on Cirrux the Drive sign-in they gave go; a record left empty is
 *    NULL. The row says `error`, as a row saved for a person is stored before
 *    anybody gives it a password;
 * 3. `person_granted_connection` is deleted, by what was read;
 * 4. every migration into the account is held (`grant_withdrawn_at`, ledger
 *    migration 0063): the tick starts no pass, a running pass stops before
 *    its next data type. Readiness answers *waiting for a grant*, as before
 *    the person first connected it (`awaitingGrantRefusal`), and the hold
 *    lifts only once both sides have a way in again (`withdrawal-hold.ts`);
 * 5. one `mapping.grant_withdrawn` row per migration, with the role, the
 *    provider and whether a Drive sign-in went: never a value.
 *
 * Nothing is asked of the provider: a password cannot be revoked by an app,
 * and Cirrux documents no revocation for a Drive sign-in
 * (`token-revocation.ts`). The page says to change the password at the
 * provider (§5.9).
 */
export async function withdrawPersonDestination(
  source: Pool | LedgerDriver,
  link: PersonWithdrawalLink,
  ref: string,
): Promise<DestinationWithdrawalResult> {
  try {
    return await withTenantDb(link.tenantId, source, async (db) => {
      const found = (await readDestinations(db, link.tenantId, link.personId)).find((d) => d.ref === ref);
      if (!found) throw new DestinationChanged();
      const [row] = await db
        .select({ kind: schema.connection.kind, config: schema.connection.config, secretRef: schema.connection.secretRef })
        .from(schema.connection)
        .where(and(eq(schema.connection.id, found.connectionId), eq(schema.connection.tenantId, link.tenantId)))
        .for('update');
      if (!row || !isPasswordKind('target', row.kind)) throw new DestinationChanged();

      const now = new Date();
      const config = row.config && typeof row.config === 'object' ? (row.config as Record<string, unknown>) : {};
      const kept = withoutThePersonsKeys(row.kind, config, stringValues(storedCredentials(row.secretRef)), CIRRUX_DRIVE_GRANT_KEY);
      await db
        .update(schema.connection)
        .set({
          secretRef: Object.keys(kept).length === 0 ? null : JSON.stringify(SecretStore.encryptCredentials(kept).encrypted),
          status: 'error',
          updatedAt: now,
        })
        .where(and(eq(schema.connection.id, found.connectionId), eq(schema.connection.tenantId, link.tenantId)));

      const deleted = await db
        .delete(personGrantedConnection)
        .where(
          and(
            eq(personGrantedConnection.connectionId, found.connectionId),
            eq(personGrantedConnection.tenantId, link.tenantId),
            eq(personGrantedConnection.personId, link.personId),
            eq(personGrantedConnection.grantedAt, found.grantedAt),
          ),
        )
        .returning({ connectionId: personGrantedConnection.connectionId });
      if (deleted.length === 0) throw new DestinationChanged();

      const into = await db
        .select({ id: schema.mailboxMapping.id })
        .from(schema.mailboxMapping)
        .innerJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMapping.targetMailboxId))
        .where(and(eq(schema.mailbox.connectionId, found.connectionId), eq(schema.mailboxMapping.tenantId, link.tenantId)));
      const mappingIds = into.map((m) => m.id);
      if (mappingIds.length > 0) {
        await db
          .update(schema.mailboxMapping)
          .set({ grantWithdrawnAt: now, updatedAt: now })
          .where(
            and(
              eq(schema.mailboxMapping.tenantId, link.tenantId),
              inArray(schema.mailboxMapping.id, mappingIds),
              isNull(schema.mailboxMapping.grantWithdrawnAt),
            ),
          );
      }
      for (const mappingId of mappingIds) {
        await new PgLedger(db).recordAuditEvent(link.tenantId as TenantId, {
          actor: WITHDRAWAL_ACTOR,
          action: GRANT_WITHDRAWN_ACTION,
          entity: 'mapping',
          detail: { mappingId, personLinkId: link.linkId, role: 'target', provider: row.kind, drive: found.drive },
        });
      }
      return {
        ok: true as const,
        withdrawal: { withdrawnAt: now.toISOString(), provider: row.kind, drive: found.drive },
      };
    });
  } catch (error) {
    if (error instanceof DestinationChanged) return { ok: false, code: 'changed', refusal: CHANGED_SINCE_OPENED };
    throw error;
  }
}

/** The string values of a record. */
function stringValues(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

/** The person's progress link the withdrawal came through, as its middleware resolved it. */
export interface PersonWithdrawalLink {
  readonly tenantId: string;
  readonly personId: string;
  readonly linkId: string;
}

export type PersonWithdrawalResult =
  | { readonly ok: true; readonly withdrawal: GrantWithdrawal }
  | { readonly ok: false; readonly code: 'nothing_granted' | 'changed'; readonly refusal: Bilingual };

/** When the account the page named holds no grant to take back. */
export const NOTHING_TO_WITHDRAW: Bilingual = {
  en: 'This account holds no permission of yours that was given through a link, so there is nothing here to withdraw.',
  nl: 'Dit account heeft geen toestemming van u die via een link is gegeven, dus er is hier niets in te trekken.',
  // With je, for a person whose pages say je (workplan 0176 T7, §11).
  nlJe: 'Dit account heeft geen toestemming van jou die via een link is gegeven, dus er is hier niets in te trekken.',
};

/** When what the page showed is not what is held now. */
export const CHANGED_SINCE_OPENED: Bilingual = {
  en:
    'Your permission changed since this page was opened (it was given again, or taken back elsewhere), ' +
    'so nothing was deleted. Open this page again to see where it stands.',
  nl:
    'Uw toestemming is gewijzigd sinds deze pagina werd geopend (opnieuw gegeven, of elders ingetrokken), ' +
    'dus er is niets verwijderd. Open deze pagina opnieuw om te zien hoe het ervoor staat.',
  nlJe:
    'Je toestemming is gewijzigd sinds deze pagina werd geopend (opnieuw gegeven, of elders ingetrokken), ' +
    'dus er is niets verwijderd. Open deze pagina opnieuw om te zien hoe het ervoor staat.',
};

/**
 * Take back the grant one account of the person's holds: revoke each of its
 * tokens at Google where Google will, then clear it from every migration of
 * that account holding it, whatever Google answered.
 */
export async function withdrawPersonGrant(
  source: Pool | LedgerDriver,
  link: PersonWithdrawalLink,
  ref: string,
  revoker: TokenRevoker,
): Promise<PersonWithdrawalResult> {
  const group = await withTenantDb(link.tenantId, source, async (db) =>
    groupByAccount(await readTheirs(db, link.tenantId, link.personId)).find((g) => g.ref === ref),
  );
  if (!group) return { ok: false, code: 'changed', refusal: CHANGED_SINCE_OPENED };
  if (group.held.length === 0) return { ok: false, code: 'nothing_granted', refusal: NOTHING_TO_WITHDRAW };

  let everyRevoked = true;
  for (const held of group.held) {
    const token = grantedToken(held.secretRef);
    const outcome = token
      ? await revoker.revoke({ kind: held.sourceKind, credentials: { refreshToken: token } })
      : null;
    if (outcome?.status !== 'revoked') everyRevoked = false;
  }
  const atGoogle = everyRevoked ? 'revoked' : 'not_confirmed';

  const withdrawnAt = await withTenantDb(link.tenantId, source, async (db) => {
    const now = new Date();
    const updated = await db
      .update(schema.mailboxMapping)
      .set({ sourceSecretRef: null, grantWithdrawnAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.mailboxMapping.tenantId, link.tenantId),
          inArray(
            schema.mailboxMapping.id,
            group.migrations.map((m) => m.mappingId),
          ),
          // Only what was read and revoked: a grant that landed since is not deleted.
          inArray(
            schema.mailboxMapping.sourceSecretRef,
            group.held.map((h) => h.secretRef),
          ),
        ),
      )
      .returning({ id: schema.mailboxMapping.id });
    for (const { id } of updated) {
      await new PgLedger(db).recordAuditEvent(link.tenantId as TenantId, {
        actor: WITHDRAWAL_ACTOR,
        action: GRANT_WITHDRAWN_ACTION,
        entity: 'mapping',
        detail: { mappingId: id, personLinkId: link.linkId, atGoogle },
      });
    }
    return updated.length > 0 ? now : null;
  });

  if (!withdrawnAt) return { ok: false, code: 'changed', refusal: CHANGED_SINCE_OPENED };
  return { ok: true, withdrawal: { withdrawnAt: withdrawnAt.toISOString(), atGoogle } };
}

/**
 * The refusal as the page reads it: the code, and both halves of the
 * sentence, its Dutch in the person's register (workplan 0176 T7).
 */
export function withdrawalRefusalBody(
  result: Extract<PersonWithdrawalResult, { ok: false }> | Extract<DestinationWithdrawalResult, { ok: false }>,
  register?: Register,
) {
  return { error: result.code, ...reasonPair(result.refusal, register) };
}
