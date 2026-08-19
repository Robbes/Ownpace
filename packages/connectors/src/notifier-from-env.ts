// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * One way to build the channel from an environment (workplan 0030 T4).
 *
 * Both editions do the same three things — read the environment, bind SMTP,
 * fall back to the honest no-op that says why — and both must do them the
 * SAME way, or "notifications are on" would mean something different on the
 * appliance than in the managed worker. The appliance did this inline first;
 * the rollback job needs it too, so it moved here rather than being typed out
 * a second time.
 *
 * It lives in connectors because that is where `smtpTransport` lives, and the
 * whole point of `MailTransport` being a function type in shared is that no
 * mail library reaches the browser bundle.
 *
 * Rule 3 either way: the credentials come from the environment — operator
 * secrets on managed, the owner's own `.env` on the appliance — never from a
 * mapping and never from the repo.
 */

import {
  readNotifierConfig,
  createNotifier,
  disabledNotifier,
  type Notifier,
  type NotifierConfig,
  type NotificationLocale,
} from '@openmig/shared';
import { smtpTransport } from './smtp-transport.ts';

export interface EnvNotifier {
  /** Always present. A channel that is off is an honest no-op, never absent. */
  readonly notifier: Notifier;
  /** Enabled with its settings, or off with the reason — for callers that care. */
  readonly config: NotifierConfig;
  /** The recipient's language, already defaulted. */
  readonly locale: NotificationLocale;
  /** One line an edition can log at startup, saying ON (to whom) or OFF (why). */
  readonly announcement: string;
}

/**
 * Build the channel. `sayOnce` receives the "not sending, because …" line the
 * disabled notifier emits the first time somebody tries to use it.
 */
export function notifierFromEnv(
  env: { readonly [key: string]: string | undefined },
  sayOnce: (message: string) => void,
): EnvNotifier {
  const config = readNotifierConfig(env);
  if (!config.enabled) {
    return {
      notifier: disabledNotifier(config.reason, sayOnce),
      config,
      locale: 'en',
      announcement: `notifications: OFF — ${config.reason}`,
    };
  }
  const locale = config.settings.locale ?? 'en';
  return {
    notifier: createNotifier(smtpTransport(config.smtp), config.settings),
    config,
    locale,
    announcement:
      `notifications: ON → ${config.settings.to.join(', ')} ` +
      `(${locale}, via ${config.smtp.host}:${config.smtp.port})`,
  };
}
