// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `operator.sh links`: how many live grant links an organisation may hold,
 * and the operator's number for a burst (workplan 0108 T8 (d); the owner,
 * 2026-09-24: "the Recommended").
 *
 *   ./deploy/compose/operator.sh links <tenant-id>
 *   ./deploy/compose/operator.sh links <tenant-id> <n> [--until YYYY-MM-DD] [note]
 *   ./deploy/compose/operator.sh links <tenant-id> --tier
 *
 * The first says where the organisation stands: its tier, the number that
 * applies and why, and how many live grant links it holds. The second sets
 * another number, higher for a burst or lower, through the day `--until`
 * names or until it is cleared. The third clears it, and the tier's number
 * stands again.
 *
 * A script and not a route, for the reason `operator.ts` gives: the request
 * path may read `grant_link_allowance` and never write it (managed migration
 * 0028). It runs over the owner connection, inside the organisation's own
 * transaction, so FORCE row security holds even this connection to the
 * organisation it names. Each change writes an audit row in the same
 * transaction: a limit raised for one customer is a decision, and a decision
 * nobody can find afterwards is one nobody made.
 */

import { hostname, userInfo } from 'node:os';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { countLiveGrantLinks, withTenant } from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import {
  ALLOWANCE_MAX,
  ALLOWANCE_MIN,
  lastDayOf,
  liveLinkLimit,
  readGrantLinkAllowance,
  tierNow,
  type GrantLinkAllowance,
  type LiveLinkLimit,
} from '@openmig/managed';

/** The audit actions a change writes: names from code, as the log page reads them. */
export const ALLOWANCE_SET_ACTION = 'grant_links.allowance_set';
export const ALLOWANCE_CLEARED_ACTION = 'grant_links.allowance_cleared';

export const LINKS_USAGE = `Usage:
  operator:links <tenant-id>                                  where it stands
  operator:links <tenant-id> <n> [--until YYYY-MM-DD] [note]  set its number (${ALLOWANCE_MIN}-${ALLOWANCE_MAX})
  operator:links <tenant-id> --tier                           the tier's number again`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type LinksCommand =
  | { readonly kind: 'show'; readonly tenantId: string }
  | {
      readonly kind: 'set';
      readonly tenantId: string;
      readonly liveLinks: number;
      /** The end of the named day, UTC; null keeps it until it is cleared. */
      readonly until: Date | null;
      readonly note: string | null;
    }
  | { readonly kind: 'clear'; readonly tenantId: string };

/**
 * Read the command's arguments, or say what is wrong with them. Nothing is
 * read from the database until they are right.
 */
export function parseLinksCommand(args: readonly string[], now: Date = new Date()): LinksCommand | { error: string } {
  const [tenantId, what, ...rest] = args;
  if (!tenantId || !UUID.test(tenantId)) {
    return { error: `links needs an organisation's id, a uuid.\n\n${LINKS_USAGE}` };
  }
  const id = tenantId.toLowerCase();
  if (what === undefined) return { kind: 'show', tenantId: id };
  if (what === '--tier') {
    if (rest.length > 0) return { error: `--tier takes nothing after it.\n\n${LINKS_USAGE}` };
    return { kind: 'clear', tenantId: id };
  }
  const liveLinks = /^\d+$/.test(what) ? Number(what) : NaN;
  if (!Number.isInteger(liveLinks) || liveLinks < ALLOWANCE_MIN || liveLinks > ALLOWANCE_MAX) {
    return {
      error: `The number of live grant links is a whole number from ${ALLOWANCE_MIN} to ${ALLOWANCE_MAX}, not "${what}".\n\n${LINKS_USAGE}`,
    };
  }
  let until: Date | null = null;
  let noteParts = rest;
  if (rest[0] === '--until') {
    const day = rest[1];
    const start = day && DAY.test(day) ? new Date(`${day}T00:00:00.000Z`) : undefined;
    if (!start || Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== day) {
      return { error: `--until takes a day, YYYY-MM-DD, not "${day ?? ''}".\n\n${LINKS_USAGE}` };
    }
    // Through the whole of the named day: "until Friday" includes Friday.
    until = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    if (until.getTime() <= now.getTime()) {
      return { error: `--until ${day} has already passed: the number would never apply.` };
    }
    noteParts = rest.slice(2);
  }
  const note = noteParts.join(' ').trim() || null;
  if (note && note.length > 200) return { error: 'The note is at most 200 characters.' };
  return { kind: 'set', tenantId: id, liveLinks, until, note };
}

/** Where an organisation stands: what `links <tenant-id>` prints. */
export interface LinksStanding {
  readonly name: string;
  readonly live: number;
  readonly limit: LiveLinkLimit;
  /** The tier's number alone, which applies again when the override ends. */
  readonly tierLimit: LiveLinkLimit;
  readonly allowance: GrantLinkAllowance | undefined;
}

/** Who made a change, as far as this machine can say: the command and its account. */
export function changedBy(): string {
  let account = 'unknown';
  try {
    account = userInfo().username;
  } catch {
    // A container user with no passwd entry has no name; the host still does.
  }
  return `operator.sh ${account}@${hostname()}`;
}

async function standing(db: PgDatabase, tenantId: string, now: Date): Promise<LinksStanding> {
  const found = (await db.execute(sql`SELECT name FROM public.tenant WHERE id = ${tenantId}::uuid`)) as unknown as {
    rows: Array<{ name: string }>;
  };
  const name = found.rows[0]?.name;
  if (name === undefined) {
    throw new Error(`No organisation ${tenantId}. operator.sh check lists the ones there are.`);
  }
  const tier = await tierNow(db, tenantId);
  const allowance = await readGrantLinkAllowance(db, tenantId);
  return {
    name,
    live: await countLiveGrantLinks(db, tenantId, now),
    limit: liveLinkLimit(tier, allowance, now),
    tierLimit: liveLinkLimit(tier, undefined, now),
    allowance,
  };
}

/** Run a command over the owner connection, in the organisation's own transaction. */
export async function runLinksCommand(
  pool: Pool,
  command: LinksCommand,
  by: string = changedBy(),
  now: Date = new Date(),
): Promise<LinksStanding> {
  return withTenant(pool, command.tenantId, async (db) => {
    // First, so an id that names nothing writes nothing.
    await standing(db, command.tenantId, now);
    if (command.kind === 'set') {
      await db.execute(sql`
        INSERT INTO public.grant_link_allowance (tenant_id, live_links, until, set_by, note)
        VALUES (${command.tenantId}::uuid, ${command.liveLinks}, ${command.until?.toISOString() ?? null}::timestamptz,
                ${by}, ${command.note})
        ON CONFLICT (tenant_id) DO UPDATE
          SET live_links = EXCLUDED.live_links, until = EXCLUDED.until,
              set_by = EXCLUDED.set_by, set_at = now(), note = EXCLUDED.note
      `);
      await db.execute(sql`
        INSERT INTO audit_log (tenant_id, actor, action, entity, detail)
        VALUES (${command.tenantId}::uuid, 'operator', ${ALLOWANCE_SET_ACTION}, 'tenant',
                ${JSON.stringify({ liveLinks: command.liveLinks, until: command.until?.toISOString() ?? null })}::jsonb)
      `);
    } else if (command.kind === 'clear') {
      const removed = (await db.execute(sql`
        DELETE FROM public.grant_link_allowance WHERE tenant_id = ${command.tenantId}::uuid RETURNING live_links
      `)) as unknown as { rows: Array<{ live_links: number }> };
      if (removed.rows.length > 0) {
        await db.execute(sql`
          INSERT INTO audit_log (tenant_id, actor, action, entity, detail)
          VALUES (${command.tenantId}::uuid, 'operator', ${ALLOWANCE_CLEARED_ACTION}, 'tenant',
                  ${JSON.stringify({ liveLinks: Number(removed.rows[0]!.live_links) })}::jsonb)
        `);
      }
    }
    return standing(db, command.tenantId, now);
  });
}

/** What `links` prints about an organisation. */
export function describeStanding(s: LinksStanding): string[] {
  const source =
    s.limit.from.kind === 'tier'
      ? `its tier, ${s.limit.from.tier.name}`
      : s.limit.from.kind === 'past_the_table'
        ? 'past the tier table: the largest tier'
        : s.limit.from.until
          ? `set for it through ${lastDayOf(s.limit.from.until)}, UTC`
          : 'set for it, until cleared';
  const lines = [
    `${s.name}: ${s.live} live grant ${s.live === 1 ? 'link' : 'links'}, may hold ${s.limit.limit} at once (${source}).`,
  ];
  if (s.limit.from.kind === 'override') {
    lines.push(`Without it, the tier's number: ${s.tierLimit.limit}.`);
  }
  if (s.allowance) {
    lines.push(
      `Set by ${s.allowance.setBy} on ${s.allowance.setAt.toISOString().slice(0, 10)}` +
        (s.allowance.note ? `: ${s.allowance.note}` : '.'),
    );
    if (s.limit.from.kind !== 'override') lines.push('It has ended; the tier’s number applies.');
  }
  return lines;
}
