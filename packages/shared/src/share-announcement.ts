// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The announcement the platform cannot make (workplan 0104 T3).
 *
 * The primary announcement is the target's own share notification, released
 * by the one-go press (0104 T0/T1): platform-native mail, real deep link,
 * sent when the grant is applied. This module carries the FALLBACK lane —
 * the rows no platform will announce:
 *
 *   - `done_manual`: a person carried the right over by hand, and whether
 *     anything was ever mailed is unknown. The grantee still needs to hear
 *     that their shared things live somewhere new.
 *
 * Rows the press applied need nothing here (the platform already spoke).
 * Rows without a grantee address (links) CANNOT be mailed by anything — they
 * are counted, visibly, and remain the owner's own communication. `skipped`
 * rows were decided not to carry over; announcing them would announce access
 * that does not exist.
 *
 * One digest per grantee, listing THEIR items only — least disclosure (§17):
 * a person learns what was shared with them, never the tenant's inventory.
 *
 * The rendered mail deliberately carries no link to where the items are. The
 * product cannot know where a by-hand share landed; the owner's NOTE is
 * required at the press exactly because the "where" must come from the person
 * who did the carrying — a mail that says "things moved" without saying where
 * is noise with a subject line.
 *
 * THE ONE LINK IT DOES CARRY is the privacy policy's, on the managed service
 * (workplan 0139 T4; the owner's privacy-share-mail-notice (a), 2026-09-28).
 * The people it reaches never signed up with us, and Art. 14(3)(b) GDPR asks
 * that they be told who holds their address, and why, at the first
 * communication at the latest (privacy §4.6; the privacy briefing, question
 * 2). So the mail closes with one sentence and the policy's address, in the
 * mail's language (`privacy-policy-link.ts`). The appliance hands no address,
 * and its mail has no such line: its owner sends it from their own box, and
 * our policy is not theirs.
 */

import type { ShareGrantRow } from './ports.ts';
import type { NotificationLocale, NotificationMessage } from './notifications.ts';

export interface ShareAnnouncementDigest {
  /** The address the source platform knew this person by. */
  readonly grantee: string;
  /** Their items, nobody else's. */
  readonly items: ReadonlyArray<{ readonly on: string; readonly role: string }>;
}

export interface ShareAnnouncementAssembly {
  /** One entry per grantee with at least one by-hand row — the mail run. */
  readonly digests: ReadonlyArray<ShareAnnouncementDigest>;
  /** Rows the platform already announced (state `applied`) — nothing to do. */
  readonly platformAnnounced: number;
  /**
   * By-hand rows with NO address — links foremost. Nothing can mail these;
   * the count is shown so "announced" never quietly means "announced to the
   * addressable".
   */
  readonly withoutAddress: number;
}

/** Group the fallback lane's rows per person. Deterministic order, twice over. */
export function assembleShareAnnouncements(
  rows: ReadonlyArray<ShareGrantRow>,
): ShareAnnouncementAssembly {
  const manual = rows.filter((r) => r.state === 'done_manual');
  const byGrantee = new Map<string, Array<{ on: string; role: string }>>();
  let withoutAddress = 0;
  for (const row of manual) {
    if (!row.grantee) {
      withoutAddress += 1;
      continue;
    }
    const items = byGrantee.get(row.grantee) ?? [];
    items.push({ on: row.onLabel, role: row.role });
    byGrantee.set(row.grantee, items);
  }
  const digests = [...byGrantee.entries()]
    .map(([grantee, items]) => ({
      grantee,
      items: items.sort((a, b) => a.on.localeCompare(b.on)),
    }))
    .sort((a, b) => a.grantee.localeCompare(b.grantee));
  return {
    digests,
    platformAnnounced: rows.filter((r) => r.state === 'applied').length,
    withoutAddress,
  };
}

/**
 * Template 6 (docs/cutover-communication-templates.md carries the human copy;
 * a test keeps the subjects from drifting apart).
 */
const SUBJECTS: Record<NotificationLocale, string> = {
  en: 'Files shared with you have moved',
  nl: 'Met u gedeelde bestanden zijn gemigreerd',
};

/**
 * The privacy line (0139 T4), without the address that follows it. It names
 * who sent the mail, what is kept about the reader, and where to read why and
 * for how long: privacy §4.6 keeps their address and the names of the items
 * shared with them, and a copy of the mail itself. Exported so the human copy
 * in the templates file can be held to it.
 */
const PRIVACY: Record<NotificationLocale, string> = {
  en:
    'Ownpace, the migration service that sent this message, keeps your address and the ' +
    'names of these items; its privacy policy says why, and for how long:',
  nl:
    'Ownpace, de migratiedienst die dit bericht verstuurde, bewaart uw adres en de namen ' +
    'van deze items; waarom en hoelang staat in de privacyverklaring:',
};

/**
 * @param privacyPolicy The privacy policy's address in `locale`, which closes
 *   the mail after the privacy line: the managed service's. `null` on the
 *   appliance, whose mail then has no privacy line at all.
 */
export function renderShareAnnouncement(
  digest: ShareAnnouncementDigest,
  locale: NotificationLocale,
  note: string,
  privacyPolicy: string | null,
): NotificationMessage {
  const items = digest.items.map((i) => `  - ${i.on} (${i.role})`).join('\n');
  const told =
    locale === 'nl'
      ? `De onderstaande bestanden of mappen waren met u gedeeld. Ze zijn naar een ` +
        `ander platform gemigreerd, en uw toegang is meegegaan.\n\n` +
        `${note}\n\n` +
        `Wat er met u gedeeld is:\n${items}\n\n` +
        `U ontvangt dit bericht eenmalig, omdat de locatie is veranderd. Werkt een ` +
        `verwijzing niet, antwoord dan aan de afzender die u kent.`
      : `The files or folders below were shared with you. They have moved to a ` +
        `different platform, and your access has moved with them.\n\n` +
        `${note}\n\n` +
        `What is shared with you:\n${items}\n\n` +
        `You receive this message once, because the location changed. If a ` +
        `reference in it does not work, reply to the sender you know.`;
  // Last, as a paragraph of its own, so the note, the items and the way to
  // reply stay together above it.
  const body = privacyPolicy === null ? told : `${told}\n\n${PRIVACY[locale]} ${privacyPolicy}`;
  return { subject: SUBJECTS[locale], body };
}

/** Exported for the doc-pinning test — the doc shows what the code sends. */
export const SHARE_ANNOUNCEMENT_SUBJECTS = SUBJECTS;

/** Exported for the doc-pinning test and the managed press's own test. */
export const SHARE_ANNOUNCEMENT_PRIVACY = PRIVACY;
