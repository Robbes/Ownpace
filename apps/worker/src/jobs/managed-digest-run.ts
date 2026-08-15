// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * What the managed digest DOES, separated from what it connects to
 * (workplan 0030 T4, tested the day after it was written).
 *
 * The task file next door owns the Pool, the ledger and the SMTP transport.
 * This file owns the decisions — whose day it is, who gets told, what counts,
 * what a failed read means, and what happens when one tenant's mail server is
 * down — behind a `DigestDeps` seam.
 *
 * The split exists because this loop sends email to other people's customers
 * and every rule in it is a rule about NOT sending, or about not sending the
 * wrong thing to the wrong people. Those deserve tests that run in
 * milliseconds without a database, not a hope that the integration suite
 * happens to cover them.
 *
 * The properties worth stating out loud, all pinned in the test beside this:
 *
 *  - **Tenants are isolated.** Every read is per tenant. One tenant's counts
 *    must never reach another's email, and the pending-decision count is
 *    taken ONCE per tenant so several mappings cannot each claim it.
 *  - **A blind spot is never a zero.** A read that failed is recorded in the
 *    server's own words and forces a send (hard rule 9).
 *  - **Nothing waiting means no email.** Silence is the signal.
 *  - **One tenant's failure is one tenant's failure.** A refused send is
 *    stated and the loop carries on; it is never counted as sent.
 */

import {
  renderDigest,
  summariseQueues,
  reportsToDigest,
  readTenantNotificationPrefs,
  digestDueToday,
  type NotificationLocale,
  type NotificationMessage,
  type MappingAttention,
  type DeletionRow,
  type MoveRow,
  type FailureRow,
} from '@openmig/shared';

export interface DigestTenant {
  readonly id: string;
  readonly name: string;
  /** The raw settings JSON; preferences are read out of it defensively. */
  readonly settings: unknown;
}

export interface DigestMapping {
  readonly id: string;
  readonly status: string;
}

/** Everything the loop needs from the outside world. */
export interface DigestDeps {
  /** `Date.getDay()` — 0 is Sunday. Passed in so "is it Monday" is testable. */
  readonly weekday: number;
  listTenants(): Promise<readonly DigestTenant[]>;
  /** Active owners and admins. Nobody else is asked to decide things. */
  listRecipients(tenantId: string): Promise<readonly string[]>;
  listMappings(tenantId: string): Promise<readonly DigestMapping[]>;
  listDeletions(tenantId: string, mappingId: string): Promise<readonly DeletionRow[]>;
  listMoves(tenantId: string, mappingId: string): Promise<readonly MoveRow[]>;
  listFailures(tenantId: string, mappingId: string): Promise<readonly FailureRow[]>;
  countPendingDecisions(tenantId: string): Promise<number>;
  send(
    to: readonly string[],
    locale: NotificationLocale,
    message: NotificationMessage,
  ): Promise<void>;
  warn(message: string): void;
  error(message: string, err: unknown): void;
}

export interface DigestSummary {
  readonly tenants: number;
  readonly sent: number;
  /** Due, but nothing was waiting — so nothing was sent. */
  readonly quiet: number;
  readonly notDue: number;
  readonly noRecipients: number;
  readonly failed: number;
}

/** One mapping's counts, with whatever could not be read named beside them. */
async function attentionFor(
  deps: DigestDeps,
  tenantId: string,
  mapping: DigestMapping,
  pendingDecisions: number | undefined,
): Promise<MappingAttention> {
  const blindSpots: string[] = [];
  const guarded = async <T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await read();
    } catch (err) {
      // The reason, verbatim. A queue that could not be read is a hole in
      // this email and must be described as one, not rounded down to zero.
      blindSpots.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
      return fallback;
    }
  };

  const deletions = await guarded(
    'the deletions queue',
    () => deps.listDeletions(tenantId, mapping.id),
    [],
  );
  const moves = await guarded('the moves queue', () => deps.listMoves(tenantId, mapping.id), []);
  const failures = await guarded(
    'the failures queue',
    () => deps.listFailures(tenantId, mapping.id),
    [],
  );

  return summariseQueues(mapping.id, {
    deletions,
    moves,
    failures,
    pendingDecisions: pendingDecisions ?? 0,
    status: mapping.status,
    blindSpots,
  });
}

/** Run one morning's digests. Never throws for one tenant's sake. */
export async function runDigest(deps: DigestDeps): Promise<DigestSummary> {
  const tenants = await deps.listTenants();
  let sent = 0;
  let quiet = 0;
  let notDue = 0;
  let noRecipients = 0;
  let failed = 0;

  for (const tenant of tenants) {
    const prefs = readTenantNotificationPrefs(tenant.settings);
    const cadence = digestDueToday(prefs, deps.weekday);
    if (!cadence) {
      notDue++;
      continue;
    }

    const to = (await deps.listRecipients(tenant.id)).filter(Boolean);
    if (to.length === 0) {
      // Loud, not silent: a tenant whose last owner was removed has nobody to
      // tell, and that is an operator problem rather than a quiet no-op.
      deps.warn(
        `[digest] tenant ${tenant.id} (${tenant.name}) is due a ${cadence} digest but has ` +
          'no active owner or admin to send it to',
      );
      noRecipients++;
      continue;
    }

    const mappings = await deps.listMappings(tenant.id);
    const attention: MappingAttention[] = [];
    // Tenant-level, not per mapping: a new mailbox belongs to no mapping yet.
    // Taken once so several mappings cannot each report the same pending
    // decision as if it were theirs — and its own failure is a blind spot on
    // the first mapping rather than a zero everywhere.
    let decisionsPending: number | undefined;
    let decisionsBlindSpot: string | undefined;
    try {
      decisionsPending = await deps.countPendingDecisions(tenant.id);
    } catch (err) {
      decisionsBlindSpot = `the decision queue: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }

    for (const mapping of mappings) {
      // A finished migration keeps its history but stops nagging — the same
      // rule the queue endpoints apply, checked before any read.
      if (!reportsToDigest(mapping.status)) continue;
      const one = await attentionFor(
        deps,
        tenant.id,
        mapping,
        attention.length === 0 ? decisionsPending : 0,
      );
      attention.push(
        attention.length === 0 && decisionsBlindSpot
          ? { ...one, blindSpots: [...(one.blindSpots ?? []), decisionsBlindSpot] }
          : one,
      );
    }

    // A tenant whose every mapping is `done` (or who has none) used to carry
    // its decisions nowhere: the digest was a list of MAPPINGS, and a pending
    // decision belongs to the tenant. 0030 T4 recorded that as a known hole and
    // wrote it to the operator's log — better than silence, but the operator is
    // not the person who has to answer the decision.
    //
    // Closed in 0043 T4 by giving the digest a section that is NOT a mapping,
    // rather than inventing a row with a mapping id nobody can open. The
    // tenant-level counts ride along whether or not there are live mappings;
    // when there are, they appear once at the top instead of being folded into
    // the first mapping's row.
    const tenantAttention =
      attention.length === 0
        ? {
            ...(decisionsPending ? { pendingDecisions: decisionsPending } : {}),
            ...(decisionsBlindSpot ? { blindSpots: [decisionsBlindSpot] } : {}),
          }
        : undefined;

    const message = renderDigest(attention, prefs.locale, cadence, tenantAttention);
    if (!message) {
      // The rule that makes this channel worth reading: nothing waiting, no
      // email at all.
      quiet++;
      continue;
    }

    try {
      await deps.send(to, prefs.locale, message);
      sent++;
    } catch (err) {
      // One tenant's mail server refusing must not stop the other tenants'
      // digests, and the failure is stated rather than counted as sent.
      deps.error(`[digest] tenant ${tenant.id}: the ${cadence} digest failed to send`, err);
      failed++;
    }
  }

  return { tenants: tenants.length, sent, quiet, notDue, noRecipients, failed };
}
