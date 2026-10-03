// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN INVITATION IS MAILED (workplan 0156 T3).
 *
 * Until 2026-10-03, inviting somebody wrote their `tenant_member` row and
 * nothing else; the form said "No email yet; tell them yourself, and they
 * appear below as invited". The owner invited a tester, nobody heard, and
 * asked how this should work. Their answer, the same day: the invited person
 * is mailed. Who invited them to which organisation, where to sign in, and
 * the exact address to sign in with, because the invitation binds to the
 * address the issuer says it verified (migration 0006) and a different one
 * signs in to nothing. No token and no link that signs anybody in: the mail
 * authorises nothing, as the access-granted mail does not (`access_granted`).
 *
 * WHAT EACH OUTCOME MEANS, said to the person who pressed Invite, because each
 * leaves them a different thing to do (`TellOutcome`, `access-notify.ts`):
 *
 *   sent    — they have it.
 *   off     — this deployment sends no mail (no SMTP, or no `WEB_URL` to name
 *             where to sign in). Nobody was told; telling them is yours.
 *   failed  — the mail server refused, or the privacy policy's address could
 *             not be built. The invitation stands; send again, or tell them.
 *   limited — this organisation has used today's invitation mails. The relay
 *             also carries the sign-in codes (0133), so a script inviting
 *             addresses by the hundred must not spend them.
 *
 * Never thrown: the invitation is already committed when this runs, and a
 * mail server being down must not make an invitation that exists look like
 * one that failed (the 0030 T4 rule `tell` keeps).
 *
 * The limits are kept in this process, like the report channel's
 * (`report-channel.ts`): a restart forgets them, which costs at most one more
 * day's allowance and needs no table.
 */

import { eq } from 'drizzle-orm';
import { tenant } from '@openmig/ledger/schema-pg';
import { log, privacyPolicyUrl, readTenantNotificationPrefs } from '@openmig/shared';
import {
  appUrl,
  channelIsOn,
  memberInvitedEvent,
  tell,
  type TellOutcome,
} from '../../access-notify.ts';
import { createKnockLimiter, type KnockLimiter } from '../../knock-limit.ts';
import { withTenantDb, type getDbPool } from '../../middleware/auth.ts';

export type InvitationMailOutcome = TellOutcome | 'limited';

/** The outcomes, in the order the screen knows them. */
export const INVITATION_MAIL_OUTCOMES: ReadonlyArray<InvitationMailOutcome> = [
  'sent',
  'off',
  'failed',
  'limited',
];

/** At most twenty invitation mails a day per organisation; an alpha family sends a handful. */
export const INVITATION_MAILS_PER_DAY = { windowMs: 24 * 60 * 60 * 1000, max: 20 } as const;

/** One invitation is mailed again at most once in ten minutes. */
export const SEND_AGAIN_AFTER = { windowMs: 10 * 60 * 1000, max: 1 } as const;

let perOrganisation: KnockLimiter = createKnockLimiter(INVITATION_MAILS_PER_DAY);
let perInvitation: KnockLimiter = createKnockLimiter(SEND_AGAIN_AFTER);

/** TEST SEAM ONLY: forget every count, so a test drives the real limits from zero. */
export function __forgetInvitationMailsForTests(): void {
  perOrganisation = createKnockLimiter(INVITATION_MAILS_PER_DAY);
  perInvitation = createKnockLimiter(SEND_AGAIN_AFTER);
}

/** Seconds until this invitation may be mailed again; 0 when it may be now. */
export function sendAgainAfterSeconds(memberId: string): number {
  return perInvitation.retryAfterSeconds(memberId);
}

/**
 * Mail one invitation, and say what became of it.
 *
 * In the organisation's own language, the one its email summaries use
 * (`readTenantNotificationPrefs`, the Team page's *Language*): the inviter
 * chose it for the people they bring in, and the invited person has no
 * setting of their own yet.
 */
export async function mailInvitation(
  pool: ReturnType<typeof getDbPool>,
  tenantId: string,
  invitation: { readonly memberId: string; readonly email: string },
  invitedBy: string | undefined,
): Promise<InvitationMailOutcome> {
  const where = appUrl();
  if (!where) {
    // Why, for the operator: the person who pressed Invite hears `off`.
    log.error(
      `[members] WEB_URL is not set — invited ${invitation.email} but sent no email, ` +
        'because it would have named no address to sign in at',
    );
    return 'off';
  }
  if (!channelIsOn()) return 'off';

  const [organisation] = await withTenantDb(tenantId, pool, (db) =>
    db
      .select({ name: tenant.name, settings: tenant.settings })
      .from(tenant)
      .where(eq(tenant.id, tenantId)),
  );
  if (!organisation) {
    log.error(`[members] invited ${invitation.email}, but organisation ${tenantId} is not there to name`);
    return 'failed';
  }
  const locale = readTenantNotificationPrefs(organisation.settings).locale;
  let privacyPolicy: string;
  try {
    privacyPolicy = privacyPolicyUrl(locale, process.env);
  } catch (error) {
    // A LEGAL_SITE_URL the mail cannot use: sent without its privacy line,
    // the mail would say less than privacy §4.6 promises, so it is not sent.
    log.error('[members] the invitation mail cannot name the privacy policy:', error);
    return 'failed';
  }

  // Taken only for a mail that is about to be attempted.
  if (!perOrganisation.take(tenantId)) {
    log.warn(
      `[members] organisation ${tenantId} has sent ${INVITATION_MAILS_PER_DAY.max} invitation ` +
        `mails today; ${invitation.email} was invited and not mailed`,
    );
    return 'limited';
  }
  perInvitation.take(invitation.memberId);

  return tell(
    invitation.email,
    locale,
    memberInvitedEvent({
      organisation: organisation.name,
      invitedBy,
      appUrl: where,
      email: invitation.email,
      privacyPolicy,
    }),
  );
}
