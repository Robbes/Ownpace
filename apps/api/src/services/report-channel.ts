// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE A REPORT GOES (workplan 0130): the owner's Zammad when there is one,
 * and otherwise the support mailbox, by mail.
 *
 * The owner, 2026-09-28, for the whole alpha: the report form is on (*"yes, we
 * need that. I haven't seen it funcitonal yet."*), and a report goes by mail
 * (*"b"*: *"The report form sends its report as an email to
 * support@ownpace.eu, with the screenshot attached, through the Proton relay
 * that already works"*). Zammad stays the long-term plan, so it still wins:
 *
 * - **`ZAMMAD_URL` and `ZAMMAD_TOKEN` both set:** a ticket, as before
 *   (`zammad.ts`). Set wrongly (an http address that is not localhost), the
 *   form is off and the log says why, as before; it does not fall back to mail,
 *   because somebody who set both meant a helpdesk.
 * - **Otherwise, the API's mail configured:** one mail per report, through the
 *   same relay, with the same settings and TLS rules as every other mail the
 *   API sends (`SMTP_*`, `NOTIFY_FROM`; `readNotifierConfig`,
 *   `smtpTransport`). It goes to `REPORT_MAIL_TO`, one address or several,
 *   comma-separated, and to `NOTIFY_TO` when that is empty.
 * - **Neither:** no form, as before. When `REPORT_MAIL_TO` is set and the
 *   mail is still off, the log says why, once, as it does for a Zammad set
 *   wrongly: somebody who set a recipient meant reports to be sent.
 *
 * Every door asks {@link reportChannel} and nothing else: the signed-in form
 * (0130) and a link's report (0108 T8 (d)).
 *
 * ## The relay is shared, so the mail is capped and quick
 *
 * On live the relay's login is the one the identity provider sends its
 * sign-in codes with (0133 T0). Reports that ran up the relay's sending quota
 * would stop those codes reaching testers, and the link door needs no account.
 * So report mails are capped for the whole service, {@link REPORT_MAIL_PER_DAY},
 * whichever door they came through. And a person is waiting on each one: the
 * web client gives up after thirty seconds, so a send that hangs on the relay
 * fails within {@link REPORT_MAIL_TIMEOUTS}, as a Zammad call does within its
 * twenty seconds, and the person is answered with a reference.
 */

import { log, readNotifierConfig, type MailTransport, type SmtpSettings } from '@openmig/shared';
import { smtpTransport, type SmtpTimeouts } from '@openmig/connectors';
import { createKnockLimiter, type KnockLimiter } from '../knock-limit.ts';
import { zammadConfigFrom, type ZammadConfig } from './zammad.ts';

/** The relay, the sender and the support mailbox a report mail goes to. */
export interface ReportMailConfig {
  readonly smtp: SmtpSettings;
  readonly from: string;
  readonly to: readonly string[];
}

/**
 * The API's own mail settings with the report's recipient, or undefined when
 * mail is off. Read by the notifier's own reader, so "mail is configured" means
 * here exactly what it means for every other mail, a production refusal of
 * `SMTP_ALLOW_SELF_SIGNED` included. `REPORT_MAIL_TO` stands in for `NOTIFY_TO`
 * when set; empty, the operator's own address receives the reports.
 */
export function reportMailConfigFrom(env: NodeJS.ProcessEnv = process.env): ReportMailConfig | undefined {
  const to = env.REPORT_MAIL_TO?.trim();
  const mail = readNotifierConfig(to ? { ...env, NOTIFY_TO: to } : env);
  if (!mail.enabled) {
    if (to) sayOnce(`[api] problem reports are switched off: REPORT_MAIL_TO is set, but the mail is off: ${mail.reason}`);
    return undefined;
  }
  return { smtp: mail.smtp, from: mail.settings.from, to: mail.settings.to };
}

/**
 * What has been said already. `/available` asks on every signed-in page, so
 * a reason said on every ask would bury the log; a new reason is still said.
 */
const said = new Set<string>();
function sayOnce(message: string): void {
  if (said.has(message)) return;
  said.add(message);
  log.error(message);
}

/** TEST SEAM ONLY: forget what was said, so a test sees its own line. */
export function __forgetWhatWasSaidForTests(): void {
  said.clear();
}

export type ReportChannel =
  | { readonly kind: 'zammad'; readonly zammad: ZammadConfig }
  | { readonly kind: 'mail'; readonly mail: ReportMailConfig };

/**
 * The way a report can travel on this service, or undefined when it cannot,
 * and then, if a Zammad was set up wrongly, said in the log.
 */
export function reportChannel(env: NodeJS.ProcessEnv = process.env): ReportChannel | undefined {
  let zammad: ZammadConfig | undefined;
  try {
    zammad = zammadConfigFrom(env);
  } catch (err) {
    log.error(`[api] problem reports are switched off: ${(err as Error).message}`);
    return undefined;
  }
  if (zammad) return { kind: 'zammad', zammad };
  const mail = reportMailConfigFrom(env);
  return mail ? { kind: 'mail', mail } : undefined;
}

/**
 * How long a report mail may wait on the relay: ten seconds to connect, ten
 * for its greeting, twenty of silence after that. Nodemailer's own defaults
 * are two minutes, thirty seconds and ten minutes, and the web client stops
 * waiting at thirty seconds: past that, the person sees a failure with no
 * reference, sends again, and the support mailbox may get both.
 */
export const REPORT_MAIL_TIMEOUTS: SmtpTimeouts = { connectionMs: 10_000, greetingMs: 10_000, socketMs: 20_000 };

/**
 * At most fifty report mails a day, for the whole service together, the
 * signed-in form's and the link doors' alike. Far above what the alpha's
 * testers write, and far below what would put the relay's login, which the
 * identity provider's sign-in codes use too, at risk (0133).
 */
export const REPORT_MAIL_PER_DAY = { windowMs: 24 * 60 * 60 * 1000, max: 50 } as const;

/** The one key the day's count is kept under. */
const EVERY_REPORT_MAIL = 'every-report-mail';

// Module-level, so both doors count together.
const REPORT_MAILS = createKnockLimiter(REPORT_MAIL_PER_DAY);

/**
 * Whether one more report may go by mail today; when not, the seconds until
 * one may, for `Retry-After`, and said in the log, since the owner would
 * otherwise not know that reports are being turned away.
 */
export function takeReportMail(limiter: KnockLimiter = REPORT_MAILS): { ok: true } | { ok: false; retryAfter: number } {
  if (limiter.take(EVERY_REPORT_MAIL)) return { ok: true };
  log.warn(`[api] a report was refused: the ${REPORT_MAIL_PER_DAY.max} report mails a day are used up`);
  return { ok: false, retryAfter: limiter.retryAfterSeconds(EVERY_REPORT_MAIL) };
}

/** How a report mail reaches the relay: `smtpTransport`, or a test's fake. */
export type ReportMailTransport = (smtp: SmtpSettings, timeouts: SmtpTimeouts) => MailTransport;

/**
 * Send one report as one mail, from `NOTIFY_FROM` to the support mailbox,
 * within {@link REPORT_MAIL_TIMEOUTS}. A failure is thrown to the route, which
 * answers it as it answers a Zammad refusal: a 502 with a reference.
 */
export async function sendReportMail(
  config: ReportMailConfig,
  mail: Omit<Parameters<MailTransport>[0], 'from' | 'to'>,
  transportFor: ReportMailTransport = smtpTransport,
): Promise<void> {
  await transportFor(config.smtp, REPORT_MAIL_TIMEOUTS)({ ...mail, from: config.from, to: config.to });
}
