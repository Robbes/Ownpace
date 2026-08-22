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
    await notifier.notify(renderEvent(event, locale));
    return 'sent';
  } catch (error) {
    // Loudly, because nobody is watching this log and the operator's screen is
    // about to say `failed` with no reason on it.
    log.error(`[access-notify] could not tell ${to}:`, error);
    return 'failed';
  }
}
