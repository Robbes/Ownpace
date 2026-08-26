// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The sharing queue (ADR-0032, accepted 2026-08-16; workplan 0052).
 *
 * §14.2's write half, finally — but shaped as a CHECKLIST, which was the
 * owner's own addition to the acceptance: every grant the inventory found is
 * a row the owner settles, whether the tool can act on it or not. `applied`
 * is the tool doing it through the target's share API; `done_manual` is the
 * owner doing it by hand and ticking it off; `skipped` is the owner deciding
 * it does not carry over — and all three keep who and when, so "what still
 * needs doing" is a query, not a memory.
 *
 * THE INVITE IS THE NOTIFICATION (ADR-0032 §4). `applyShareGrant` never
 * emails anybody: it asks the TARGET to create the share, and the target's
 * own machinery tells the grantee — the message comes from the platform the
 * person will actually use, carrying a working link, and it cannot disagree
 * with the access because it IS the access. This module refuses everything
 * that would break that promise: applying before cutover (an invite into a
 * half-filled target), applying a link share (an unknown audience cannot be
 * notified), applying a `manual` verdict (no clean equivalent exists), and
 * applying on a target with no share API (the row stays a manual step, with
 * the protocol gap named).
 *
 * Refusals are answers, verbatim, per item — the same posture as apply on a
 * deletion (ADR-0024) even though nothing here destroys: a share is
 * OUTWARD-FACING, and outward-facing is why it gets the ceremony.
 */

import { createHash } from 'node:crypto';
import type { Ledger, MappingId, PermissionGrant, ShareGrantRow, TenantId } from '@openmig/shared';
import { mapGrant } from './permission-map.ts';

/**
 * A grant's identity across rescans: what it is on, who holds it, at what
 * level, and whether it is a link. NOT the raw blob — Drive re-serialising a
 * permission (field order, an added attribute) must not make yesterday's
 * decided row look like a new grant.
 */
export function shareGrantHash(grant: PermissionGrant): string {
  return createHash('sha256')
    .update(
      [grant.subject, grant.on, grant.grantee ?? '', grant.role, grant.viaLink ? 'link' : 'person'].join(
        '\u0000',
      ),
      'utf8',
    )
    .digest('hex');
}

/** What the ledger's upsert wants, derived from one inventory grant. */
export function shareGrantRowFrom(grant: PermissionGrant): {
  grantHash: string;
  subject: string;
  onLabel: string;
  grantee?: string;
  role: string;
  viaLink: boolean;
  raw: string;
  verdict: 'clean' | 'manual';
  verdictTarget: string;
} {
  const mapping = mapGrant(grant);
  return {
    grantHash: shareGrantHash(grant),
    subject: grant.subject,
    onLabel: grant.on,
    ...(grant.grantee ? { grantee: grant.grantee } : {}),
    role: grant.role,
    viaLink: grant.viaLink === true,
    raw: grant.raw,
    verdict: mapping.verdict,
    verdictTarget: mapping.note ? `${mapping.target} — ${mapping.note}` : mapping.target,
  };
}

export interface RefreshShareGrantsDeps {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly ledger: Pick<Ledger, 'upsertShareGrants'>;
  /**
   * The inventory scans to draw from — the same functions the §14.2 report
   * composes (calendar sharing, drive sharing), so the queue can never know
   * MORE than the report.
   */
  readonly scans: ReadonlyArray<() => Promise<
    | { readonly kind: 'listed'; readonly grants: readonly PermissionGrant[] }
    | { readonly kind: 'not_discoverable'; readonly reason: string }
  >>;
}

export interface RefreshShareGrantsResult {
  /** Rows now waiting on the owner (new + still-open known rows). */
  readonly open: number;
  /**
   * What could NOT be turned into rows, verbatim — a blind spot is a
   * checklist item too, just one the tool cannot enumerate for you.
   */
  readonly blindSpots: ReadonlyArray<string>;
}

/** Run the scans and upsert the queue's rows. Decisions survive (ADR-0032). */
export async function refreshShareGrants(
  deps: RefreshShareGrantsDeps,
): Promise<RefreshShareGrantsResult> {
  const rows: Array<ReturnType<typeof shareGrantRowFrom>> = [];
  const blindSpots: string[] = [];
  for (const scan of deps.scans) {
    const listing = await scan();
    if (listing.kind === 'listed') rows.push(...listing.grants.map(shareGrantRowFrom));
    else blindSpots.push(listing.reason);
  }
  const open = await deps.ledger.upsertShareGrants(deps.tenantId, deps.mappingId, rows);
  return { open, blindSpots };
}

/** The checklist's progress line: what is settled, what still waits. */
export interface ShareChecklistSummary {
  readonly total: number;
  readonly open: number;
  readonly applied: number;
  readonly doneManual: number;
  readonly skipped: number;
  /** Open rows the tool cannot apply — the owner's own remaining steps. */
  readonly openManual: number;
}

export function summariseShareGrants(
  rows: ReadonlyArray<ShareGrantRow>,
): ShareChecklistSummary {
  return {
    total: rows.length,
    open: rows.filter((r) => r.state === 'open').length,
    applied: rows.filter((r) => r.state === 'applied').length,
    doneManual: rows.filter((r) => r.state === 'done_manual').length,
    skipped: rows.filter((r) => r.state === 'skipped').length,
    openManual: rows.filter((r) => r.state === 'open' && r.verdict === 'manual').length,
  };
}

export type ShareActionOutcome =
  | { readonly ok: true; readonly row: ShareGrantRow }
  | { readonly ok: false; readonly code: string; readonly reason: string };

export interface ShareQueueDeps {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly ledger: Pick<
    Ledger,
    'listShareGrants' | 'decideShareGrant' | 'recordAuditEvent'
  >;
  /** Who is acting — attribution is required, the checklist has no anonymous ticks. */
  readonly decidedBy: string;
  /** Called, not thrown, when the audit row cannot be written. */
  readonly onError?: (message: string, err: unknown) => void;
}

export interface ApplyShareDeps extends ShareQueueDeps {
  /**
   * The cutover gate (ADR-0032 §5), resolved by the edition: an invite is an
   * announcement that the new system is live, so a share applied into a
   * half-filled target is the wrong announcement from the right channel.
   */
  readonly lifecycleDone: boolean;
  /**
   * The target's share API, when it has one — absent means the row stays a
   * manual step. The implementation notifies the grantee itself; that is the
   * point (§4).
   */
  readonly createShare?: (
    row: ShareGrantRow,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
}

async function findOpenRow(
  deps: ShareQueueDeps,
  grantId: string,
): Promise<ShareActionOutcome> {
  const rows = await deps.ledger.listShareGrants(deps.tenantId, deps.mappingId);
  const row = rows.find((r) => r.id === grantId);
  if (!row) {
    return {
      ok: false,
      code: 'not_found',
      reason: 'No sharing-queue row under that id for this migration.',
    };
  }
  if (row.state !== 'open') {
    return {
      ok: false,
      code: 'already_settled',
      reason:
        `This row was settled as '${row.state}'` +
        (row.decidedBy ? ` by ${row.decidedBy}` : '') +
        (row.decidedAt ? ` on ${row.decidedAt}` : '') +
        ' — a settled checklist item stays settled.',
    };
  }
  return { ok: true, row };
}

async function audit(
  deps: ShareQueueDeps,
  action: string,
  row: ShareGrantRow,
): Promise<void> {
  try {
    await deps.ledger.recordAuditEvent(deps.tenantId, {
      actor: deps.decidedBy,
      action,
      entity: 'share_grant',
      detail: {
        mappingId: deps.mappingId,
        grantId: row.id,
        on: row.onLabel,
        ...(row.grantee ? { grantee: row.grantee } : {}),
        role: row.role,
      },
    });
  } catch (err) {
    // The decision row itself carries the attribution; a failed audit write
    // must not undo a settled checklist item.
    deps.onError?.('[share-queue] audit write failed', err);
  }
}

/**
 * Re-create one grant on the target, through its own share API — the target
 * notifies the grantee (the invite IS the notification). Every gate answers
 * with a reason the queue shows verbatim.
 */
/*
 * IF A BULK APPLY IS EVER WRITTEN, IT STARTS SILENT (0103 T6, ADR-0043).
 * Today every grant is applied one at a time by a person, and the button is
 * labelled outward-facing — that design IS the notification policy, and the
 * owner's cutover intent (2026-08-25) is one deliberate announcement moment,
 * not per-item mail. The per-API silence flags for that future verb, recorded
 * here so it is born silent rather than patched later:
 *   Google Drive  permissions.create?sendNotificationEmail=false
 *   MS Graph      driveItem:invite  body {"sendInvitation": false}
 *   Box           POST /collaborations?notify=false
 *   Dropbox       sharing/add_folder_member {"quiet": true}
 * (Graph/Drive verified against vendor references in workplan 0103; Box and
 * Dropbox to be re-verified at build time.)
 */
/**
 * One sentence, one source: the per-row apply and the one-go press both
 * refuse a not-yet-cut-over migration with exactly these words. Two copies
 * would drift, and a gate paraphrasing its own rule eventually disagrees
 * with it (workplan 0084, run #18).
 */
export const NOT_CUT_OVER_REASON =
  'Shares are applied at or after cutover, not before: the share invite is an ' +
  'announcement that the new system is live, and this migration is not finished. ' +
  'Finish it, then work the sharing checklist (ADR-0032).';

export async function applyShareGrant(
  deps: ApplyShareDeps,
  grantId: string,
): Promise<ShareActionOutcome> {
  const found = await findOpenRow(deps, grantId);
  if (!found.ok) return found;
  const row = found.row;

  if (row.viaLink) {
    return {
      ok: false,
      code: 'link_share',
      reason:
        'A sharing link has no addressable audience: re-creating it re-opens access to an ' +
        'unknown set of people, and no platform can notify "whoever had the old link". ' +
        'Create a new link on the target yourself if you want one, then mark this row done ' +
        '(ADR-0032).',
    };
  }
  if (row.verdict !== 'clean') {
    return {
      ok: false,
      code: 'manual_only',
      reason: `This right has no clean equivalent the tool may create. What to do instead: ${row.verdictTarget}`,
    };
  }
  if (!deps.lifecycleDone) {
    return { ok: false, code: 'not_cut_over', reason: NOT_CUT_OVER_REASON };
  }
  if (!deps.createShare) {
    return {
      ok: false,
      code: 'no_share_api',
      reason:
        'This target has no share API this tool speaks (plain WebDAV, CalDAV and JMAP have ' +
        'no portable share verb). Create the share by hand on the target, then mark this ' +
        'row done.',
    };
  }

  let created: { readonly ok: true } | { readonly ok: false; readonly reason: string };
  try {
    created = await deps.createShare(row);
  } catch (err) {
    created = { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (!created.ok) {
    // The row stays OPEN: the target refused, so nothing was carried over and
    // the checklist must keep saying so. The target's words travel verbatim.
    return { ok: false, code: 'target_refused', reason: created.reason };
  }

  const settled = await deps.ledger.decideShareGrant(deps.tenantId, deps.mappingId, grantId, {
    state: 'applied',
    decidedBy: deps.decidedBy,
  });
  if (!settled) {
    return {
      ok: false,
      code: 'already_settled',
      reason: 'This row was settled by someone else while the share was being created.',
    };
  }
  await audit(deps, 'share.applied', settled);
  return { ok: true, row: settled };
}

/** What one press did, row by row — the moment's receipt. */
export interface ApplyAllOutcome {
  readonly ok: true;
  /** Rows the press applied — each one a share the TARGET now announces itself. */
  readonly applied: ReadonlyArray<ShareGrantRow>;
  /** Rows the target refused; they stay OPEN with the server's words. */
  readonly refused: ReadonlyArray<{
    readonly id: string;
    readonly on: string;
    readonly grantee?: string;
    readonly code: string;
    readonly reason: string;
  }>;
  /**
   * Rows the press deliberately does not touch: links (no addressable
   * audience) and manual verdicts. They are the fallback digest's audience
   * (0104 T3) and the checklist's to settle — a press that converted them to
   * refusals would bury the checklist in noise about its own design.
   */
  readonly leftForChecklist: { readonly links: number; readonly manual: number };
}

/**
 * THE ONE-GO PRESS (0104 T1). Every open, clean, addressable grant applied
 * in one recorded human action, at or after cutover — and because creating a
 * share is what makes the target notify its grantee, this press IS the
 * chosen moment: one wave of platform-native announcements, exactly when a
 * person decided.
 *
 * Each row still walks through `applyShareGrant`, gates and all — the press
 * batches the decision, never the rules. A refusal on one row never stops
 * the next (the grantee whose share failed is exactly who a retry press is
 * for; the rows that succeeded must not wait on them). Applied rows carry
 * `decidedBy`/`decidedAt` per row, and the press itself lands once in the
 * audit log with its counts — who pressed, when, what happened.
 */
export async function applyAllOpenShareGrants(deps: ApplyShareDeps): Promise<
  ApplyAllOutcome | { ok: false; code: 'not_cut_over'; reason: string }
> {
  if (!deps.lifecycleDone) {
    return { ok: false, code: 'not_cut_over', reason: NOT_CUT_OVER_REASON };
  }

  const rows = await deps.ledger.listShareGrants(deps.tenantId, deps.mappingId);
  const open = rows.filter((r) => r.state === 'open');
  const links = open.filter((r) => r.viaLink).length;
  const manual = open.filter((r) => !r.viaLink && r.verdict !== 'clean').length;
  const candidates = open.filter((r) => !r.viaLink && r.verdict === 'clean');

  const applied: ShareGrantRow[] = [];
  const refused: Array<{
    id: string;
    on: string;
    grantee?: string;
    code: string;
    reason: string;
  }> = [];
  for (const row of candidates) {
    const outcome = await applyShareGrant(deps, row.id);
    if (outcome.ok) {
      applied.push(outcome.row);
    } else {
      refused.push({
        id: row.id,
        on: row.onLabel,
        ...(row.grantee ? { grantee: row.grantee } : {}),
        code: outcome.code,
        reason: outcome.reason,
      });
    }
  }

  // The press is recorded as its own event — one action, its counts, its
  // presser — beside the per-row `share.applied` entries each success wrote.
  try {
    await deps.ledger.recordAuditEvent(deps.tenantId, {
      actor: deps.decidedBy,
      action: 'share.apply_all',
      entity: 'share_grant',
      detail: {
        mappingId: deps.mappingId,
        attempted: candidates.length,
        applied: applied.length,
        refused: refused.length,
        leftForChecklist: { links, manual },
      },
    });
  } catch (err) {
    deps.onError?.('recording the apply-all press failed (the shares themselves stand)', err);
  }

  return { ok: true, applied, refused, leftForChecklist: { links, manual } };
}

/**
 * The checklist tick: `done_manual` ("I did this by hand") or `skipped`
 * ("this deliberately does not carry over"). Any verdict may be ticked —
 * manual rows are exactly what this exists for.
 */
export async function markShareGrant(
  deps: ShareQueueDeps,
  grantId: string,
  state: 'done_manual' | 'skipped',
  reason?: string,
): Promise<ShareActionOutcome> {
  const found = await findOpenRow(deps, grantId);
  if (!found.ok) return found;

  const settled = await deps.ledger.decideShareGrant(deps.tenantId, deps.mappingId, grantId, {
    state,
    decidedBy: deps.decidedBy,
    ...(reason ? { reason } : {}),
  });
  if (!settled) {
    return {
      ok: false,
      code: 'already_settled',
      reason: 'This row was settled by someone else first.',
    };
  }
  await audit(deps, state === 'done_manual' ? 'share.done_manual' : 'share.skipped', settled);
  return { ok: true, row: settled };
}
