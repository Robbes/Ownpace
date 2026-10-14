// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AS MANY MIGRATIONS AS THE MACHINE WAS SIZED FOR (workplan 0143 T2a, the
 * alpha minimum).
 *
 * Every tester's migrations run on one machine, and nothing limited how many
 * one organisation could create: the tick enqueues every migration that is
 * due, and each pass holds memory and connections while it runs (0143 §1, "No
 * organisation has a limit it cannot raise"). The organisation's own
 * `settings.maxMappings` looked like such a limit and limited nothing: nothing
 * read it, and an owner could write any number into it.
 *
 * So creating a migration is refused once the organisation already has
 * `MAX_MIGRATIONS_PER_ORGANISATION` that are not finished, which is every
 * status but `done`. A draft counts, because it is one press from running.
 * The number is the deployment's, not the organisation's: six, the owner's
 * decision of 2026-10-14, so the cap says what Free promises, *"six at the
 * same time"* (terms §6, and `paths: 6` in `site/prices.mjs`). It supersedes
 * T0's provisional five, which the owner accepted on 2026-09-27. A
 * per-organisation number that only an operator can write comes later, if
 * the alpha shows it is needed.
 *
 * The cap is held in the transaction that writes, one create at a time per
 * organisation, as `live-link-limit.ts` holds the grant links: the lock is
 * taken before the count, so a second create waits for the first to commit
 * and then counts what it wrote. Without it, two presses at once would each
 * count the same number and both be the last one allowed.
 */

import { and, count, eq, ne, sql } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import type { Bilingual } from '@openmig/shared';

/**
 * Six, the owner's decision of 2026-10-14: Free's *"six at the same time"*.
 * Was T0's provisional five (accepted 2026-09-27, 0143 open question 1).
 */
export const DEFAULT_MAX_MIGRATIONS_PER_ORGANISATION = 6;

/**
 * The deployment's cap, from `MAX_MIGRATIONS_PER_ORGANISATION`: unset or empty
 * is the default. Anything but a whole number of at least 1 is refused loudly,
 * as `LEDGER_RETENTION_DAYS` is: an operator who wrote `ten` believes the cap
 * is ten, and quietly holding six instead is found out by a tester.
 */
export function maxMigrationsPerOrganisationFromEnv(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_MIGRATIONS_PER_ORGANISATION;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `MAX_MIGRATIONS_PER_ORGANISATION must be a whole number, at least 1 — got ${JSON.stringify(raw)}. ` +
        `Leave it unset for the default of ${DEFAULT_MAX_MIGRATIONS_PER_ORGANISATION}.`,
    );
  }
  return n;
}

/** The organisation already has as many unfinished migrations as it may. Nothing was written. */
export class PastTheCap extends Error {
  readonly unfinished: number;
  readonly cap: number;
  /** The same sentence in both languages; `message` is its English. */
  readonly said: Bilingual;

  constructor(unfinished: number, cap: number) {
    const said = pastTheCapSaid(unfinished, cap);
    super(said.en);
    this.name = 'PastTheCap';
    this.unfinished = unfinished;
    this.cap = cap;
    this.said = said;
  }
}

/**
 * Hold the cap in the create's own transaction, before anything is written:
 * take the organisation's lock, count its unfinished migrations, and throw
 * `PastTheCap` when there is no room. `pg_advisory_xact_lock` is released at
 * COMMIT or ROLLBACK, which a transaction pooler keeps to one connection.
 */
export async function holdTheCap(db: PgDatabase, tenantId: string, cap: number): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`migrations:${tenantId}`}, 0))`);
  const [row] = await db
    .select({ unfinished: count() })
    .from(schema.mailboxMapping)
    .where(
      and(eq(schema.mailboxMapping.tenantId, tenantId), ne(schema.mailboxMapping.status, 'done')),
    );
  const unfinished = Number(row?.unfinished ?? 0);
  if (unfinished >= cap) throw new PastTheCap(unfinished, cap);
}

/**
 * What a tester reads: how many there are, how many may be, and what makes
 * room, in both languages (the owner, 2026-10-14: written for a tester, and
 * "contact us" where it said "ask whoever runs this service"). The answer
 * carries the Dutch beside the English as `messageNl`, the shape the link
 * holder's refusals already use (`link-holder-refusals.ts`).
 */
export function pastTheCapSaid(unfinished: number, cap: number): Bilingual {
  const these = unfinished === 1 ? 'migration that is' : 'migrations that are';
  const deze = unfinished === 1 ? 'migratie die' : 'migraties die';
  return {
    en:
      `This organisation has ${unfinished} ${these} not finished, and may have ${cap} at once. ` +
      'Finish or delete one before you add another, or contact us if you need more at once.',
    nl:
      `Deze organisatie heeft ${unfinished} ${deze} nog niet ${unfinished === 1 ? 'is' : 'zijn'} afgerond, ` +
      `en mag er ${cap} tegelijk hebben. Rond er een af of verwijder er een voordat u een nieuwe ` +
      'toevoegt, of neem contact met ons op als u er meer tegelijk nodig hebt.',
  };
}

/** The English of `pastTheCapSaid`, which `message` carries. */
export function pastTheCap(unfinished: number, cap: number): string {
  return pastTheCapSaid(unfinished, cap).en;
}
