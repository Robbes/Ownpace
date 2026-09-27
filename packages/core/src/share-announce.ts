// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ANNOUNCEMENT THE PLATFORM CANNOT MAKE (workplan 0104 T3), one wave per
 * data type (0128 T5, slice 6, the owner's D8).
 *
 * One press mails a Template-6 digest to each grantee of a share carried by
 * hand (`done_manual`) whose own data type is at or past its cutover. The
 * announcement says the new system is live, so a data type's shares are
 * announced at its own cutover: the calendars' when the calendars are cut
 * over, the files' when the files are. A press between the two leaves the
 * files' shares, counted, for the press at their cutover. With none of them
 * cut over, the press is refused, naming the data types that wait.
 *
 * ONCE PER DATA TYPE. A data type announced before is left out of the next
 * press, and counted, unless the presser asks to mail it again on purpose
 * (`confirmResend`): mailing the same people twice is a choice, never a
 * repeat. The audit log is the memory. Each press is recorded once, with the
 * share subjects it announced (`subjects`; a subject names its data type,
 * `dataTypeOfShare`), and a press recorded before the waves, with none,
 * announced every data type (`latestAuditEventAt`'s `subject`).
 *
 * Both editions press it, each with its own gate reader, mail channel and
 * sender. The grouping per grantee and the mail itself are
 * `share-announcement.ts`'s (shared).
 */

import type {
  Ledger,
  MappingId,
  NotificationLocale,
  NotificationMessage,
  TenantId,
} from '@openmig/shared';
import { assembleShareAnnouncements, renderShareAnnouncement } from '@openmig/shared';
import { sharedDataNamed } from './share-queue.ts';

export interface AnnounceByHandDeps {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly ledger: Pick<Ledger, 'listShareGrants' | 'latestAuditEventAt' | 'recordAuditEvent'>;
  /** Who pressed: the press is recorded in their name. */
  readonly pressedBy: string;
  /**
   * Whether a share's own data type is at or past its cutover
   * (`readShareGate`), as every press on the sharing checklist asks it.
   */
  readonly isCutOver: (subject: string) => boolean;
  /** Whether a mail channel is configured: without one, nobody can be told. */
  readonly channelIsOn: boolean;
  /** Mail one grantee their digest. True when it went; never throws. */
  readonly tell: (grantee: string, message: NotificationMessage) => Promise<boolean>;
  /** Called, not thrown, when the audit row cannot be written. */
  readonly onError?: (message: string, err: unknown) => void;
}

export interface AnnounceByHandPress {
  /** Where things live now, in the presser's own words. */
  readonly note: string;
  readonly locale: NotificationLocale;
  /** Mail the data types announced before again, on purpose. */
  readonly confirmResend: boolean;
}

export interface AnnounceByHandOutcome {
  readonly ok: true;
  /** The grantees who were told, and those who could not be. */
  readonly sent: readonly string[];
  readonly failed: readonly string[];
  /** Rows the one-go press applied: the platform announced those itself. */
  readonly platformAnnounced: number;
  /** Rows of this wave with no address to mail, links foremost. */
  readonly withoutAddress: number;
  /** Whether this press mailed a data type announced before. */
  readonly resend: boolean;
  /** Rows left for the press at their own data type's cutover. */
  readonly waitingForCutover: number;
  /** Rows left out because their data type was announced before. */
  readonly alreadyAnnounced: number;
}

export interface AnnounceByHandRefusal {
  readonly ok: false;
  readonly code: 'not_cut_over' | 'notifications_off' | 'already_announced';
  readonly reason: string;
}

export const NOTIFICATIONS_OFF_REASON =
  'No mail channel is configured (SMTP_* / NOTIFY_*), so nobody can be told. ' +
  'Configure the channel, then press again — nothing was sent.';

const andList = (words: readonly string[]): string =>
  words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/**
 * The announcement's refusal while the data types of its shares are not cut
 * over yet, naming them; a share it cannot place waits for the whole
 * migration.
 */
export function notCutOverToAnnounceReason(subjects: readonly string[]): string {
  const named = sharedDataNamed(subjects);
  if (named === undefined) {
    return (
      'The shares carried by hand are announced at or after cutover, not before: the ' +
      'announcement says the new system is live, and this migration is not cut over yet. ' +
      'Press again once it is (ADR-0032).'
    );
  }
  if (named.length === 1) {
    const { noun, plural } = named[0]!;
    const be = plural ? 'are' : 'is';
    return (
      `The shares carried by hand on this migration's ${noun} are announced once the ${noun} ` +
      `${be} cut over, not before: the announcement says the new system is live, and the ` +
      `${noun} ${be} not cut over yet. Press again once ${plural ? 'they are' : 'it is'} (ADR-0032).`
    );
  }
  return (
    `The shares carried by hand on this migration's ${andList(named.map((n) => n.noun))} are ` +
    'announced once each is cut over, not before: the announcement says the new system is ' +
    'live, and none of them is cut over yet. Press again once one is (ADR-0032).'
  );
}

/** The refusal of a press whose data types were all announced before. */
export function alreadyAnnouncedReason(before: ReadonlyMap<string, string>): string {
  const last = [...before.values()].sort().at(-1);
  const again =
    'Sending again mails the same people again: pass confirmResend: true to do that on purpose.';
  const named = sharedDataNamed([...before.keys()]);
  if (named === undefined) {
    return `This migration's shares carried by hand were already announced, the last time on ${last}. ${again}`;
  }
  const on = named.length === 1 ? ` on ${last}` : `, the last time on ${last}`;
  return (
    `The shares carried by hand on this migration's ${andList(named.map((n) => n.noun))} ` +
    `were already announced${on}. ${again}`
  );
}

/**
 * THE PRESS. Each data type's shares carried by hand, announced once, at its
 * own cutover; the ones that wait, and the ones announced before, counted.
 */
export async function announceByHandShares(
  deps: AnnounceByHandDeps,
  press: AnnounceByHandPress,
): Promise<AnnounceByHandOutcome | AnnounceByHandRefusal> {
  const rows = await deps.ledger.listShareGrants(deps.tenantId, deps.mappingId);
  const byHand = rows.filter((r) => r.state === 'done_manual');
  const subjects = [...new Set(byHand.map((r) => r.subject))];
  const mayGo = subjects.filter((s) => deps.isCutOver(s));
  const waiting = subjects.filter((s) => !deps.isCutOver(s));
  if (mayGo.length === 0 && waiting.length > 0) {
    return { ok: false, code: 'not_cut_over', reason: notCutOverToAnnounceReason(waiting) };
  }
  if (!deps.channelIsOn) {
    return { ok: false, code: 'notifications_off', reason: NOTIFICATIONS_OFF_REASON };
  }

  // ONCE PER DATA TYPE: when each was announced last, if ever.
  const before = new Map<string, string>();
  for (const subject of mayGo) {
    const at = await deps.ledger.latestAuditEventAt(deps.tenantId, {
      action: 'share.announce',
      mappingId: deps.mappingId,
      subject,
    });
    if (at !== undefined) before.set(subject, at);
  }
  const wave = press.confirmResend ? mayGo : mayGo.filter((s) => !before.has(s));
  if (wave.length === 0 && before.size > 0) {
    return { ok: false, code: 'already_announced', reason: alreadyAnnouncedReason(before) };
  }

  // This wave's shares carried by hand; the platform's own announcements are
  // counted over the whole migration, as they always were.
  const assembly = assembleShareAnnouncements(
    rows.filter((r) => r.state !== 'done_manual' || wave.includes(r.subject)),
  );
  const sent: string[] = [];
  const failed: string[] = [];
  for (const digest of assembly.digests) {
    const told = await deps.tell(digest.grantee, renderShareAnnouncement(digest, press.locale, press.note));
    (told ? sent : failed).push(digest.grantee);
  }

  const resend = wave.some((s) => before.has(s));
  const waitingForCutover = byHand.filter((r) => waiting.includes(r.subject)).length;
  const alreadyAnnounced = byHand.filter((r) => before.has(r.subject) && !wave.includes(r.subject)).length;
  try {
    await deps.ledger.recordAuditEvent(deps.tenantId, {
      actor: deps.pressedBy,
      action: 'share.announce',
      entity: 'share_grant',
      detail: {
        mappingId: deps.mappingId,
        subjects: wave,
        grantees: assembly.digests.length,
        sent: sent.length,
        failed: failed.length,
        withoutAddress: assembly.withoutAddress,
        locale: press.locale,
        resend,
        waitingForCutover,
        alreadyAnnounced,
      },
    });
  } catch (err) {
    deps.onError?.('recording the announce press failed (the mails themselves stand)', err);
  }

  return {
    ok: true,
    sent,
    failed,
    platformAnnounced: assembly.platformAnnounced,
    withoutAddress: assembly.withoutAddress,
    resend,
    waitingForCutover,
    alreadyAnnounced,
  };
}
