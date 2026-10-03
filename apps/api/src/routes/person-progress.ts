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
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgLedger, PgMigrationStatusStore, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import { personMigration } from '@openmig/managed/schema-managed';
import {
  MAPPING_LIFECYCLES,
  buildDomainStatusReports,
  reasonPair,
  viewGrantFor,
  viewRowFor,
  type Bilingual,
  type GrantWithdrawal,
  type MappingId,
  type MappingLifecycle,
  type PersonView,
  type PersonViewAccount,
  type PersonViewMigration,
  type TenantId,
  type TokenRevoker,
  type ViewDomainRow,
  type ViewGrant,
} from '@openmig/shared';
import { withTenantDb } from '../middleware/auth.ts';
import { namedAccount, readGrantRows } from './migrations/grant-subject.ts';
import { isGrantableSourceKind } from './migrations/grant-link-readiness.ts';
import { googleAccountKey } from './migrations/signed-in-account.ts';
import { GRANT_WITHDRAWN_ACTION, WITHDRAWAL_ACTOR, grantedToken } from './withdraw-grant.ts';

/** One migration's counts and states, as every progress page shows them. */
export interface MigrationProgress {
  readonly state: MappingLifecycle;
  readonly started: boolean;
  readonly domains: readonly ViewDomainRow[];
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
  const [domainStatus, failures, adopted] = await Promise.all([
    new PgMigrationStatusStore(db).getStatus(tenantId as TenantId, mappingId as MappingId),
    new PgLedger(db).listFailures(tenantId as TenantId, mappingId as MappingId),
    new PgLedger(db).countAdoptedByDomain(tenantId as TenantId, mappingId as MappingId),
  ]);
  return {
    state: status as MappingLifecycle,
    // Absence, not zero: see `MigrationView.started`.
    started: domainStatus.length > 0,
    domains: buildDomainStatusReports(domainStatus, failures, adopted).map(viewRowFor),
  };
}

/** A hash that names a group and says nothing of what it was made from. */
function refOf(kind: 'grant' | 'account', parts: readonly string[]): string {
  return createHash('sha256')
    .update(`${kind}\n${[...parts].sort().join('\n')}`)
    .digest('hex')
    .slice(0, 32);
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
    });
  }
  return theirs;
}

/**
 * The person's migrations grouped by the Google account each reads. A
 * migration belongs to a group when its source is one a link can grant and
 * names an address; one that reads no Google account is shown on its own.
 */
function groupByAccount(theirs: readonly Theirs[]): AccountGroup[] {
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
      if (m.withdrawnAt || !m.secretRef) continue;
      if (!held.some((h) => h.secretRef === m.secretRef)) held.push({ secretRef: m.secretRef, sourceKind: m.sourceKind });
    }
    const withdrawn = migrations
      .map((m) => m.withdrawnAt)
      .filter((at): at is Date => at !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const grant: ViewGrant =
      held.length > 0
        ? viewGrantFor({ sourceSecretRef: held[0]!.secretRef, grantWithdrawnAt: null })
        : viewGrantFor({ sourceSecretRef: null, grantWithdrawnAt: withdrawn ?? null });
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
  input: { readonly tenantId: string; readonly personId: string; readonly expiresAt: Date },
): Promise<PersonView | null> {
  const org = await db
    .select({ name: schema.tenant.name })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, input.tenantId));
  const organisation = org[0]?.name;
  if (organisation === undefined) return null;

  const theirs = await readTheirs(db, input.tenantId, input.personId);
  const groups = groupByAccount(theirs);
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
      account: refFor(m.mappingId),
    });
  }
  const accounts: PersonViewAccount[] = groups.map((g) => ({ ref: g.ref, grant: g.grant }));
  return { kind: 'person', organisation, expiresAt: input.expiresAt.toISOString(), migrations, accounts };
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
};

/** When what the page showed is not what is held now. */
export const CHANGED_SINCE_OPENED: Bilingual = {
  en:
    'Your permission changed since this page was opened (it was given again, or taken back elsewhere), ' +
    'so nothing was deleted. Open this page again to see where it stands.',
  nl:
    'Uw toestemming is gewijzigd sinds deze pagina werd geopend (opnieuw gegeven, of elders ingetrokken), ' +
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

/** The refusal as the page reads it: the code, and both halves of the sentence. */
export function withdrawalRefusalBody(result: Extract<PersonWithdrawalResult, { ok: false }>) {
  return { error: result.code, ...reasonPair(result.refusal) };
}
