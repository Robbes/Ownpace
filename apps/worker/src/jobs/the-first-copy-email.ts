// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE FIRST-COPY EMAIL, ONCE PER PERSON (workplan 0154 T7; the owner,
 * 2026-09-28: *"One per person"*).
 *
 * Asked by a pass that has just finished a first copy (`run-delta-sync.ts`): a
 * data type whose `completed_at` was empty when the pass began, and which the
 * pass marked completed. No other pass asks, so a person whose migrations
 * arrived before this existed is not told today about weeks ago.
 *
 * 1. **Whose.** The migration's person (`person_migration`). A migration with
 *    no person is nobody's news: its own page says it.
 * 2. **Everything of theirs in.** `firstCopyOf` over each of their migrations,
 *    as `readFirstCopyFacts` reads them.
 * 3. **Once.** The claim on `person.first_copy_announced_at` (managed migration
 *    0038). Only the pass whose update changed the row sends, so two passes of
 *    one person's migrations finishing together on two runners send one mail.
 * 4. **To whom.** The organisation's active owners and admins, in its language,
 *    as the digest reads them (`managed-digest.ts`): the people who run the
 *    migrations, and the mail names the person.
 *
 * 5. **At Free's pace** (workplan 0157 T5): on Free, outside the alpha, the mail
 *    says that keeping in step is one pass a day, and where a higher tier is.
 *    The tier is the one the month bills, read in the claim's transaction as
 *    the Billing page reads it (`billedTierNow`).
 *
 * The claim is made before the send and stands whatever the send does. An
 * announcement is for something that happened, and a channel switched on next
 * week must not tell anyone then about today. The send runs after the claim's
 * transaction has committed, so a slow mail server holds no row; one that
 * fails is the caller's to log, never thrown into the pass it reports on.
 */
import type { Pool } from 'pg';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { readFirstCopyFacts, withTenant, type LedgerDriver } from '@openmig/ledger';
import { person, personMigration } from '@openmig/managed/schema-managed';
import { billedTierNow, holdsAtCeiling, leastMinutesBetweenPasses, FREE_PASS_EVERY_MINUTES } from '@openmig/managed';
import {
  createNotifier,
  firstCopyOf,
  log,
  readTenantNotificationPrefs,
  renderEvent,
  type FirstCopyFacts,
  type NotificationLocale,
  type TenantId,
  type NotificationMessage,
} from '@openmig/shared';
import { notifierFromEnv, smtpTransport } from '@openmig/connectors';

/** What asking came to, for the pass's log. */
export type FirstCopyAnswer =
  /** The migration is no person's. */
  | 'nobody'
  /** Some migration of theirs has not arrived. */
  | 'not_yet'
  /** Already claimed: by an earlier pass, or by one finishing beside this one. */
  | 'already'
  /** Claimed, and sent. */
  | 'sent'
  /** Claimed, and no channel is configured to send it on. */
  | 'no_channel'
  /** Claimed, and the organisation has no active owner or admin to send it to. */
  | 'no_recipients';

export interface FirstCopyDeps {
  /** Sends one message, or is absent where no channel is configured. */
  readonly send?: (to: readonly string[], locale: NotificationLocale, message: NotificationMessage) => Promise<void>;
}

/** The rows a statement answers in a scope: node-postgres carries them under `rows`. */
const rowsOf = <R>(result: unknown): R[] => (result as { rows: R[] }).rows;

/** The SMTP channel the digest uses, or none where it is not configured. */
export function firstCopyChannel(): FirstCopyDeps {
  const channel = notifierFromEnv(process.env, (m) => log.warn(m));
  if (!channel.config.enabled) return {};
  const from = channel.config.settings.from;
  const transport = smtpTransport(channel.config.smtp);
  return { send: (to, locale, message) => createNotifier(transport, { from, to, locale }).notify(message) };
}

export async function announceFirstCopy(
  pool: Pool | LedgerDriver,
  tenantId: string,
  mappingId: string,
  deps: FirstCopyDeps = firstCopyChannel(),
): Promise<FirstCopyAnswer> {
  const claim = await withTenant(pool, tenantId, async (db) => {
    const [mine] = await db
      .select({ personId: personMigration.personId })
      .from(personMigration)
      .where(and(eq(personMigration.mappingId, mappingId), eq(personMigration.tenantId, tenantId)));
    if (!mine) return 'nobody' as const;

    const theirs = await db
      .select({ mappingId: personMigration.mappingId })
      .from(personMigration)
      .where(and(eq(personMigration.personId, mine.personId), eq(personMigration.tenantId, tenantId)));
    const facts: FirstCopyFacts[] = [];
    for (const m of theirs) facts.push(await readFirstCopyFacts(db, tenantId, m.mappingId));
    const first = firstCopyOf(facts);
    if (!first.complete) return 'not_yet' as const;

    const [claimed] = await db
      .update(person)
      .set({ firstCopyAnnouncedAt: new Date() })
      .where(and(eq(person.id, mine.personId), eq(person.tenantId, tenantId), isNull(person.firstCopyAnnouncedAt)))
      .returning({ name: person.displayName });
    if (!claimed) return 'already' as const;

    const recipients = rowsOf<{ email: string }>(
      await db.execute(
        sql`SELECT email FROM tenant_member
             WHERE tenant_id = ${tenantId} AND status = 'active' AND role IN ('owner', 'admin')`,
      ),
    ).map((r) => r.email);
    const [organisation] = rowsOf<{ settings: unknown }>(
      await db.execute(sql`SELECT settings FROM tenant WHERE id = ${tenantId}`),
    );
    // Free's pace, outside the alpha (0157 T5), in this same transaction.
    const stage = process.env.OWNPACE_STAGE;
    const onePassADay =
      holdsAtCeiling(stage) &&
      leastMinutesBetweenPasses(await billedTierNow(db, tenantId as TenantId, new Date()), stage) >=
        FREE_PASS_EVERY_MINUTES;
    return {
      to: recipients,
      locale: readTenantNotificationPrefs(organisation?.settings).locale,
      person: claimed.name,
      domains: first.domains,
      onePassADay,
    };
  });
  if (typeof claim === 'string') return claim;
  if (!deps.send) return 'no_channel';
  if (claim.to.length === 0) return 'no_recipients';
  await deps.send(
    claim.to,
    claim.locale,
    renderEvent(
      {
        kind: 'first_copy_complete',
        person: claim.person,
        domains: claim.domains,
        ...(claim.onePassADay ? { onePassADay: true } : {}),
      },
      claim.locale,
    ),
  );
  return 'sent';
}
