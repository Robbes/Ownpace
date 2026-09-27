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
import type { DiscoveryDomain, Ledger, MappingId, PermissionGrant, ShareGrantRow, TenantId } from '@openmig/shared';
import { DISCOVERY_DOMAINS, dataTypeOfShare, groupShareGrants } from '@openmig/shared';
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
  itemKey?: string;
  parentKey?: string;
  isContainer?: boolean;
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
    // Where the source says it sits (workplan 0123 T4), carried through
    // UNCHANGED and never defaulted. A source that did not say leaves these
    // absent all the way to the column, so the queue lists that row on its own
    // instead of folding it under a container nobody reported.
    //
    // `isContainer` is compared to undefined rather than spread on truthiness:
    // `false` is a source saying "not a folder", which must not be dropped as
    // if it had said nothing.
    ...(grant.itemKey !== undefined ? { itemKey: grant.itemKey } : {}),
    ...(grant.parentKey !== undefined ? { parentKey: grant.parentKey } : {}),
    ...(grant.isContainer !== undefined ? { isContainer: grant.isContainer } : {}),
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
  /**
   * Why mailbox delegation could not be inventoried, in the source's words.
   *
   * REQUIRED, and not one of `scans`, for the same reason
   * `runPermissionInventory` refuses to make it a dep: no connector emits a
   * `mailbox` grant on any provider, so this section is always true and the
   * way it would get lost is the way sections always get lost — a caller that
   * forgot to pass one. The report has enforced that since 0029 T1; this
   * queue did not, and the two surfaces answering the same question
   * differently is what the owner found on his first live run: the report
   * named mailbox delegation, and the checklist beside it said nothing, so
   * "nobody looked" read as "nothing to find" on the screen built to keep
   * those apart (hard rule 9).
   */
  readonly delegationReason: string;
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
  // First and always, whatever the caller passed. See `delegationReason`.
  const blindSpots: string[] = [deps.delegationReason];
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
   * Asked of each share's own data type (0128 T5, slice 6, the owner's D8):
   * whether it is at or past its cutover (`shareMayBeApplied`, by subject).
   */
  readonly isCutOver: (subject: string) => boolean;
  /**
   * The target's share API, when it has one — absent means the row stays a
   * manual step. The implementation notifies the grantee itself; that is the
   * point (§4).
   */
  readonly createShare?: (
    row: ShareGrantRow,
    /**
     * Where to actually send it, when a person confirmed an address that is
     * not the one the source recorded (ADR-0032 §6). Absent means the row's
     * own grantee — the implementation decides, so a target with no notion of
     * an address override is not obliged to grow one.
     */
    shareWith?: string,
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
  /** Where it actually went, when that is not the address the source named. */
  sentTo?: string,
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
        // THE RECORD SAYS WHERE IT WENT, not only where the source pointed.
        // A corrected address (§6) used to leave `grantee: anna@old` in the
        // log while the invitation landed at anna@new — a record of an act
        // that names the wrong recipient is worse than one that names none.
        ...(sentTo && sentTo !== row.grantee ? { sentTo } : {}),
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
 * One sentence, one source: every press refuses a share applied before its
 * cutover in these words, the per-row apply, the one-go press and the folder
 * press alike. Two copies would drift, and a gate paraphrasing its own rule
 * eventually disagrees with it (workplan 0084, run #18).
 *
 * This one is the whole migration's: a share the gate cannot place, and the
 * announcement of the shares carried by hand (0104 T3), which waits for every
 * data type. A share of one data type is refused in its own words
 * (`notCutOverReason`).
 */
export const NOT_CUT_OVER_REASON =
  'Shares are applied at or after cutover, not before: the share invite is an ' +
  'announcement that the new system is live, and this migration is not cut over yet. ' +
  'Work the sharing checklist once it is (ADR-0032).';

/** How a refusal names a data type: its shares are "on this migration's calendars". */
const SHARED_DATA: Record<DiscoveryDomain, { readonly noun: string; readonly plural: boolean }> = {
  email: { noun: 'mail', plural: false },
  calendar: { noun: 'calendars', plural: true },
  contact: { noun: 'contacts', plural: true },
  file: { noun: 'files', plural: true },
  task: { noun: 'tasks', plural: true },
};

/**
 * The data types a refusal names for these shares, in the order the product
 * lists data types; none when there are no shares, or one it cannot place (a
 * refusal then speaks of the whole migration).
 */
export function sharedDataNamed(
  subjects: readonly string[],
): ReadonlyArray<{ readonly noun: string; readonly plural: boolean }> | undefined {
  const domains = subjects.map(dataTypeOfShare);
  if (domains.length === 0 || domains.includes(undefined)) return undefined;
  return DISCOVERY_DOMAINS.filter((d) => domains.includes(d)).map((d) => SHARED_DATA[d]);
}

/**
 * The refusal of shares whose own data types are not cut over yet (0128 T5,
 * slice 6), naming them: each share waits for its own data type's cutover,
 * while the others may already be applied.
 */
export function notCutOverReason(subjects: readonly string[]): string {
  const named = sharedDataNamed(subjects);
  if (named === undefined) return NOT_CUT_OVER_REASON;
  if (named.length === 1) {
    const { noun, plural } = named[0]!;
    const be = plural ? 'are' : 'is';
    return (
      `Shares on this migration's ${noun} are applied once the ${noun} ${be} cut over, not before: ` +
      'the share invite is an announcement that the new system is live, and the ' +
      `${noun} ${be} not cut over yet. Work these rows once ${plural ? 'they are' : 'it is'} (ADR-0032).`
    );
  }
  const nouns = named.map((n) => n.noun);
  const list = `${nouns.slice(0, -1).join(', ')} and ${nouns[nouns.length - 1]}`;
  return (
    `Shares on this migration's ${list} are applied once each is cut over, not before: ` +
    'the share invite is an announcement that the new system is live, and none of them ' +
    'is cut over yet. Work these rows once they are (ADR-0032).'
  );
}

export async function applyShareGrant(
  deps: ApplyShareDeps,
  grantId: string,
  /**
   * The address a person confirmed for this row's grantee (ADR-0032 §6).
   * Absent means the source's own address is used, unchanged — the caller
   * that has no confirmation passes nothing rather than guessing one.
   */
  shareWith?: string,
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
  if (!deps.isCutOver(row.subject)) {
    return { ok: false, code: 'not_cut_over', reason: notCutOverReason([row.subject]) };
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
    created = await deps.createShare(row, shareWith);
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
  await audit(deps, 'share.applied', settled, shareWith);
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
  /**
   * Rows left open because their own data type is not cut over yet (0128 T5,
   * slice 6): they are announced by a press at that data type's cutover, not
   * by this one.
   */
  readonly waitingForCutover: number;
}

/**
 * THE ONE-GO PRESS (0104 T1). Every open, clean, addressable grant applied
 * in one recorded human action, each at or after its own data type's cutover
 * (0128 T5, slice 6) — and because creating a share is what makes the target
 * notify its grantee, this press IS the chosen moment: one wave of
 * platform-native announcements per data type, exactly when a person
 * decided.
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
  const rows = await deps.ledger.listShareGrants(deps.tenantId, deps.mappingId);
  const open = rows.filter((r) => r.state === 'open');
  const links = open.filter((r) => r.viaLink).length;
  const manual = open.filter((r) => !r.viaLink && r.verdict !== 'clean').length;
  const addressable = open.filter((r) => !r.viaLink && r.verdict === 'clean');

  // EACH DATA TYPE'S SHARES AT ITS OWN CUTOVER (0128 T5, slice 6, D8). The
  // press is the moment for every data type that is cut over, and leaves the
  // others for the press at their own cutover: one wave per data type, never
  // a trickle. With none of them cut over, the press is refused as before.
  const candidates = addressable.filter((r) => deps.isCutOver(r.subject));
  const waiting = addressable.filter((r) => !deps.isCutOver(r.subject));
  if (candidates.length === 0 && waiting.length > 0) {
    return { ok: false, code: 'not_cut_over', reason: notCutOverReason(waiting.map((r) => r.subject)) };
  }

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
        waitingForCutover: waiting.length,
      },
    });
  } catch (err) {
    deps.onError?.('recording the apply-all press failed (the shares themselves stand)', err);
  }

  return { ok: true, applied, refused, leftForChecklist: { links, manual }, waitingForCutover: waiting.length };
}

/** Where to send, per grantee the SOURCE named — one address a person confirmed. */
export type ConfirmedGrantees = Readonly<Record<string, string>>;

export interface ApplyFolderDeps extends ApplyShareDeps {
  /**
   * The address a person confirmed for each grantee in this folder.
   *
   * ADR-0032 §6 confirms once PER GRANTEE — the machine proposes, a person
   * confirms or corrects, and the confirmed pair applies to that grantee's
   * other rows. This is that rule carried to folder scale: one press over
   * eleven files is still one invitation per person, and the person who
   * pressed has seen every address it will reach.
   *
   * An entry may repeat the source's own address unchanged. That is still a
   * confirmation — §6 asks for a person's judgement on the address, not for
   * the address to be different.
   */
  readonly confirmed: ConfirmedGrantees;
}

export type ApplyFolderRefusal =
  | { readonly ok: false; readonly code: 'not_cut_over'; readonly reason: string }
  | { readonly ok: false; readonly code: 'no_such_folder'; readonly reason: string }
  | {
      readonly ok: false;
      readonly code: 'unconfirmed_grantees';
      readonly reason: string;
      /** Exactly who has not been confirmed, so the screen can ask for them. */
      readonly grantees: readonly string[];
    };

/**
 * ONE PRESS OVER ONE FOLDER, and not one address further (owner's call,
 * 2026-09-19: "folder-scope with a confirm-first gate").
 *
 * ## Why a folder press exists at all
 *
 * The fold (workplan 0123 T4) turned 482 rows into about twenty on the
 * owner's live page. Working them is now readable and still per-row: a folder
 * shared with one person is one line on screen and eleven presses underneath.
 * This is the press that matches what the screen shows.
 *
 * ## Why it is NOT the one-go press with a filter
 *
 * `applyAllOpenShareGrants` is the cutover moment — every remaining share, one
 * wave, deliberately. A folder press is a different decision about blast
 * radius, so it gets a different gate rather than a narrower argument:
 *
 * **Every distinct grantee in the folder must carry a confirmed address, or
 * nothing is sent.** Not one row, not the ones we happen to have — all of
 * them, checked before the first invitation leaves. §6's confirmation is per
 * grantee and this press is per folder, so the only honest join is "every
 * grantee this press would reach". The refusal names exactly who is missing,
 * because "some address is unconfirmed" is not something a person can act on.
 *
 * ## Which rows are IN the folder is not the caller's claim
 *
 * The group is derived here, from `groupShareGrants` in `@openmig/shared` —
 * the same pure rule the screen folds with. A press that took a list of row
 * ids would be acting on the caller's idea of the folder, and the two would
 * drift the first time the grouping rule changed. A container heads at most
 * one group (a bucket that deviates from its container leaves the group and
 * becomes its own row), so `parentKey` names it exactly.
 *
 * Deviating rows are therefore NOT in this press, which is the point of
 * surfacing them above the fold in the first place: the file shared with
 * somebody its siblings are not is the one a person must decide about alone.
 *
 * Links and manual verdicts are counted and left, exactly as the one-go press
 * leaves them — they are the fallback digest's audience (0104 T3).
 */
export async function applyShareGrantsInFolder(
  deps: ApplyFolderDeps,
  parentKey: string,
): Promise<ApplyAllOutcome | ApplyFolderRefusal> {
  const rows = await deps.ledger.listShareGrants(deps.tenantId, deps.mappingId);
  const group = groupShareGrants(rows).groups.find((g) => g.parentKey === parentKey);
  if (!group) {
    return {
      ok: false,
      code: 'no_such_folder',
      reason:
        'This migration has no folder group under that container. It may have been settled, ' +
        'or a rescan may have regrouped it — reload the checklist and press again.',
    };
  }

  const inFolder = new Set(group.rowIds);
  const open = rows.filter((r) => inFolder.has(r.id) && r.state === 'open');
  const links = open.filter((r) => r.viaLink).length;
  const manual = open.filter((r) => !r.viaLink && r.verdict !== 'clean').length;
  const candidates = open.filter((r) => !r.viaLink && r.verdict === 'clean');

  // Its own data type's cutover first (0128 T5, slice 6), for every row the
  // press would reach: all or nothing, as the grantees' gate below is.
  const early = candidates.filter((r) => !deps.isCutOver(r.subject));
  if (early.length > 0) {
    return { ok: false, code: 'not_cut_over', reason: notCutOverReason(early.map((r) => r.subject)) };
  }

  // THE GATE. Every grantee this press would reach, checked BEFORE the first
  // invitation leaves — an all-or-nothing check, because a press that sent
  // eight of eleven and then refused would have already done the thing the
  // gate exists to prevent. A row with no grantee at all (a domain share) is
  // not checked here: there is nobody to confirm, and the target's own
  // refusal says so per row, in its words.
  const needed = [...new Set(candidates.map((r) => r.grantee).filter((g): g is string => !!g))];
  const unconfirmed = needed.filter((g) => !(deps.confirmed[g] ?? '').trim()).sort();
  if (unconfirmed.length > 0) {
    return {
      ok: false,
      code: 'unconfirmed_grantees',
      grantees: unconfirmed,
      reason:
        'Applying a whole folder invites every one of these people at once, so each address ' +
        `is confirmed first and ${unconfirmed.length} ${
          unconfirmed.length === 1 ? 'has' : 'have'
        } not been: ${unconfirmed.join(', ')}. Check each one, then press again.`,
    };
  }

  const applied: ShareGrantRow[] = [];
  const refused: Array<{
    id: string;
    on: string;
    grantee?: string;
    code: string;
    reason: string;
  }> = [];
  for (const row of candidates) {
    const confirmed = row.grantee ? deps.confirmed[row.grantee]?.trim() : undefined;
    const outcome = await applyShareGrant(deps, row.id, confirmed || undefined);
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

  // The press is its own event beside the per-row entries. It records WHICH
  // folder and how many people, never the addresses: the per-row rows already
  // carry those, and §17 asks a summary to narrate counts.
  try {
    await deps.ledger.recordAuditEvent(deps.tenantId, {
      actor: deps.decidedBy,
      action: 'share.apply_folder',
      entity: 'share_grant',
      detail: {
        mappingId: deps.mappingId,
        parentKey,
        ...(group.label ? { folder: group.label } : {}),
        attempted: candidates.length,
        applied: applied.length,
        refused: refused.length,
        grantees: needed.length,
        leftForChecklist: { links, manual },
      },
    });
  } catch (err) {
    deps.onError?.('recording the folder press failed (the shares themselves stand)', err);
  }

  return { ok: true, applied, refused, leftForChecklist: { links, manual }, waitingForCutover: 0 };
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
