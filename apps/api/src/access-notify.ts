// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Telling one person, at an address that is not a member's (workplan 0095 T2).
 *
 * ## Why this is not `notifierFromEnv`
 *
 * Every other notification in the product goes to a fixed list — the appliance
 * owner's address, or a tenant's active owners and admins — and `Notifier`
 * carries those recipients in its settings. This one goes to an address on an
 * `access_request` row, for somebody who is deliberately NOT a member until
 * they first sign in (0093 T6b).
 *
 * So the shape is the digest's: **one transport, many envelopes.** The channel
 * is read from the environment once and the TLS connection is made per send;
 * a notifier with `to: [them]` and their language is built for each. Nothing
 * about the channel is re-derived per grant.
 *
 * ## It reports what happened instead of deciding what it means
 *
 * `createNotifier` propagates a send failure on purpose (0030 T1) — a
 * notification that silently failed to send is indistinguishable from one that
 * was never worth making. That rule is right and this keeps it: the outcome is
 * RETURNED, and the grant route decides what a failure means there.
 *
 * The three outcomes are genuinely different and the route says which to the
 * operator, because they change what a human has to do next:
 *
 *   sent    — they know.
 *   off     — no SMTP is configured. Nobody was told and nobody will be;
 *             the manual step is back and the operator needs to know that.
 *   failed  — we tried and the mail server refused. Also a manual step, but a
 *             different conversation: something is broken rather than absent.
 */

import { notifierFromEnv } from '@openmig/connectors';
import {
  alphaConditionsUrl,
  createNotifier,
  renderEvent,
  testerGuideUrl,
  type LegalSiteForMailEnv,
  type NotificationEvent,
  type NotificationLocale,
  type NotificationMessage,
} from '@openmig/shared';
import { smtpTransport } from '@openmig/connectors';
import { log } from '@openmig/shared';

export type TellOutcome = 'sent' | 'off' | 'failed';

/**
 * Read once. `readNotifierConfig` distinguishes NOTHING SET — the ordinary
 * default — from HALF SET, where somebody tried and it names the missing
 * variables rather than going quietly off (0030 T1). Re-reading per request
 * would repeat that announcement in the log on every grant.
 */
let channel: ReturnType<typeof notifierFromEnv> | null = null;
function envChannel(): ReturnType<typeof notifierFromEnv> {
  if (!channel) channel = notifierFromEnv(process.env, (message) => log.info(message));
  return channel;
}

/**
 * Where to send somebody to sign in, or null if this deployment cannot say.
 *
 * `WEB_URL` is the address a BROWSER uses — the same value the status page
 * probes and the identity provider registers its redirect against. Never
 * defaulted: a grant email carrying `http://localhost:3123` has told somebody
 * to go nowhere, and would go out looking exactly like a successful one.
 *
 * **And never thrown, either.** The first version of this threw, which turned a
 * missing variable into a 500 on a grant whose transaction had ALREADY
 * COMMITTED — the organisation existed and the operator was told it had failed.
 * That is precisely the inversion the send is placed after the commit to avoid,
 * reintroduced two lines away from the comment saying so. CI caught it.
 *
 * A deployment with no `WEB_URL` gets a warning at boot (`config-guards.ts`)
 * and, per mail, a person who is told nobody was emailed. Moved here from the
 * access-request route so the grant mail and the invitation (0156 T3) read
 * one address.
 */
export function appUrl(env: { readonly WEB_URL?: string } = process.env): string | null {
  const url = env.WEB_URL;
  return url ? url.replace(/\/+$/, '') : null;
}

/** Whether the mail channel is configured at all — for routes that refuse a press up front. */
export function channelIsOn(): boolean {
  return envChannel().config.enabled;
}

/** TEST SEAM ONLY. Pass `null` to re-read the environment. */
export function __setChannelForTests(replacement: ReturnType<typeof notifierFromEnv> | null): void {
  channel = replacement;
}

/**
 * Whether this deployment runs the alpha (workplan 0131 T1).
 *
 * One setting, `OWNPACE_STAGE=alpha`, which `managed.yml` hands to this
 * process and, as the build arg `VITE_OWNPACE_STAGE`, to the web bundle
 * (`scripts/an-alpha-both-halves-know-about.unit.test.ts`). The same rule as
 * the bundle's (`apps/web/src/services/stage.ts`): unset or empty is off, and
 * only `alpha`, trimmed and in any case, is on. The appliance never sets it;
 * it has no access queue and sends no grant mail.
 */
export function alphaFrom(env: { readonly OWNPACE_STAGE?: string }): boolean {
  return env.OWNPACE_STAGE?.trim().toLowerCase() === 'alpha';
}

/**
 * The mail a granted person receives, marked when the deployment runs the
 * alpha so that it says so in the note's words (`renderEvent`).
 *
 * Built here rather than in the route so the setting is read in one place,
 * at the moment the mail is written, and so a test can hand it an
 * environment instead of changing the process's.
 *
 * During the alpha it also carries where the Alpha conditions are (0139 T4,
 * with 0131 T1) and where the tester guide is (0131 T1 (b), 0144 T1), in both
 * languages, so the mail links them in its own:
 * `LEGAL_SITE_URL`, which `managed.yml` fills from the web build's
 * `VITE_LEGAL_SITE_URL`, empty being the production site. A value the link
 * cannot use never reaches here after a commit: the api's start makes the
 * share mail's address from the same key by the same rule
 * (`legalSiteForMailFrom`), so it refuses to start on one instead.
 */
export function accessGrantedEvent(
  granted: { readonly organisation: string; readonly appUrl: string; readonly email: string },
  env: { readonly OWNPACE_STAGE?: string } & LegalSiteForMailEnv = process.env,
): NotificationEvent {
  return {
    kind: 'access_granted',
    organisation: granted.organisation,
    appUrl: granted.appUrl,
    email: granted.email,
    ...(alphaFrom(env)
      ? {
          alpha: true,
          alphaConditions: { en: alphaConditionsUrl('en', env), nl: alphaConditionsUrl('nl', env) },
          testerGuide: { en: testerGuideUrl('en', env), nl: testerGuideUrl('nl', env) },
        }
      : {}),
  };
}

/**
 * The mail an invited person receives (workplan 0156 T3), marked for the alpha
 * the same way and for the same reason as `accessGrantedEvent`: the setting is
 * read in one place, when the mail is written.
 *
 * During the alpha it carries the Alpha conditions' and the tester guide's
 * addresses too (0131 T1 (b)), as it carries the privacy policy's: one string
 * each, in the mail's own language, which `locale` names (the organisation's
 * summary language, `invitation-mail.ts`). Built from `LEGAL_SITE_URL` by the
 * same rule; a value it cannot use throws, and the caller builds this inside
 * the guard that turns that into `failed`.
 */
export function memberInvitedEvent(
  invited: {
    readonly organisation: string;
    readonly invitedBy?: string | undefined;
    readonly appUrl: string;
    readonly email: string;
    readonly privacyPolicy: string;
    /** The mail's language, for the alpha's addresses. */
    readonly locale: NotificationLocale;
  },
  env: { readonly OWNPACE_STAGE?: string } & LegalSiteForMailEnv = process.env,
): NotificationEvent {
  return {
    kind: 'member_invited',
    organisation: invited.organisation,
    ...(invited.invitedBy ? { invitedBy: invited.invitedBy } : {}),
    appUrl: invited.appUrl,
    email: invited.email,
    privacyPolicy: invited.privacyPolicy,
    ...(alphaFrom(env)
      ? {
          alpha: true,
          alphaConditions: alphaConditionsUrl(invited.locale, env),
          testerGuide: testerGuideUrl(invited.locale, env),
        }
      : {}),
  };
}

/**
 * Send one event to one address, and say what became of it.
 *
 * Never throws. The caller is a route that has already committed something
 * real, and an exception here would report a completed grant as a failure —
 * which is the 0030 T4 rollback rule in the same shape: a mail server being
 * down must not make a thing that happened look like a thing that did not.
 */
export async function tell(
  to: string,
  locale: NotificationLocale,
  event: NotificationEvent,
): Promise<TellOutcome> {
  return tellMessage(to, locale, renderEvent(event, locale));
}

/**
 * The same envelope-per-person channel for a message already rendered — the
 * sharing queue's fallback digest (0104 T3) sends Template 6 through here so
 * "one transport, many envelopes" stays one implementation.
 */
export async function tellMessage(
  to: string,
  locale: NotificationLocale,
  message: NotificationMessage,
): Promise<TellOutcome> {
  const { config } = envChannel();
  if (!config.enabled) {
    // Once per process, from `notifierFromEnv`'s own announcement — not per
    // grant. But the CALLER still hears `off` every time, because "nobody was
    // told" is a fact about this grant and not about the process.
    return 'off';
  }

  try {
    const notifier = createNotifier(smtpTransport(config.smtp), {
      from: config.settings.from,
      to: [to],
      locale,
    });
    await notifier.notify(message);
    return 'sent';
  } catch (error) {
    // Loudly, because nobody is watching this log and the operator's screen is
    // about to say `failed` with no reason on it.
    log.error(`[access-notify] could not tell ${to}:`, error);
    return 'failed';
  }
}

/**
 * Tell the OPERATOR that somebody knocked.
 *
 * `tell` above addresses one person on an `access_request` row. This one goes
 * the other way, to the fixed list the rest of the product already uses —
 * `NOTIFY_TO`, in `NOTIFY_LOCALE` — so it takes `config.settings` verbatim
 * rather than building an envelope per recipient. `readNotifierConfig` only
 * reports `enabled` when `SMTP_HOST`, `NOTIFY_FROM` and `NOTIFY_TO` are all
 * present, so an enabled channel always has somebody to send to.
 *
 * WHY THIS EXISTS. `POST /api/access-requests` inserted a row, wrote one log
 * line and told nobody: the queue was the intended channel, which works
 * exactly as well as somebody's habit of opening it. Reported from the live
 * site on 2026-08-24 — "i filled in the request access, but did not receive
 * mail" — and the honest answer was that no code path sent one.
 *
 * Never throws, for the same reason as `tell`: the row is already committed,
 * and a mail server being down must not turn a recorded request into a 500
 * that tells the asker to try again. It reports what happened and the route
 * decides what that means.
 */
export async function tellOperator(event: NotificationEvent): Promise<TellOutcome> {
  const { config } = envChannel();
  if (!config.enabled) return 'off';

  try {
    // NOTIFY_LOCALE is optional, and `en` is the default the rest of the
    // product already settles on (`raw.locale === 'nl' ? 'nl' : 'en'`).
    // Resolved once so the rendered message and the notifier cannot disagree
    // about which language this is.
    const locale: NotificationLocale = config.settings.locale ?? 'en';
    const notifier = createNotifier(smtpTransport(config.smtp), { ...config.settings, locale });
    await notifier.notify(renderEvent(event, locale));
    return 'sent';
  } catch (error) {
    log.error('[access-notify] could not tell the operator about a new request:', error);
    return 'failed';
  }
}
