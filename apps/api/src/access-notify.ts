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
  createNotifier,
  renderEvent,
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

/** Whether the mail channel is configured at all — for routes that refuse a press up front. */
export function channelIsOn(): boolean {
  return envChannel().config.enabled;
}

/** TEST SEAM ONLY. Pass `null` to re-read the environment. */
export function __setChannelForTests(replacement: ReturnType<typeof notifierFromEnv> | null): void {
  channel = replacement;
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
