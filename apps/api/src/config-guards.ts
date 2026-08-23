// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Production URL config guards (release-readiness pass, 2026-08-10) — the
 * same fail-closed posture as assertProductionAuthConfig (0020 T2), applied
 * to the three URL values that used to fall back to localhost silently.
 *
 * Why each rule is shaped the way it is:
 *  - API_URL is where MOLLIE'S SERVERS deliver payment webhooks. A localhost
 *    value in production means payments complete and invoices never leave
 *    'sent' — a failure nobody sees until the books don't balance. With
 *    billing live (MOLLIE_API_KEY set), that config refuses to boot.
 *  - WEB_URL is where Mollie redirects the customer after payment; localhost
 *    strands them. Same gate, same reason.
 *  - CORS_ORIGIN localhost in production is only a WARNING: the standard
 *    deploy proxies /api same-origin through the web image's nginx, so CORS
 *    never fires — but a direct-to-API setup would break, so it is named.
 */

import { log } from '@openmig/shared';

const isLocalhostUrl = (value: string): boolean => {
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
};

export interface UrlConfigProblem {
  fatal: boolean;
  message: string;
}

/** Pure check so the refusal sentences are unit-testable. */
export const describeUrlConfigProblems = (env: {
  NODE_ENV?: string;
  MOLLIE_API_KEY?: string;
  API_URL?: string;
  WEB_URL?: string;
  CORS_ORIGIN?: string;
}): UrlConfigProblem[] => {
  if (env.NODE_ENV !== 'production') return [];
  const problems: UrlConfigProblem[] = [];

  if (env.MOLLIE_API_KEY) {
    for (const [name, consequence] of [
      ['API_URL', 'Mollie cannot deliver payment webhooks there, so payments would complete while invoices stay sent forever'],
      ['WEB_URL', 'Mollie would redirect paying customers to an address that only exists on this machine'],
    ] as const) {
      const value = env[name];
      if (!value || isLocalhostUrl(value)) {
        problems.push({
          fatal: true,
          message:
            `${name} is ${value ? `'${value}'` : 'unset'} in production with MOLLIE_API_KEY set: ` +
            `${consequence}. Set ${name} to the deployment's public address.`,
        });
      }
    }
  }

  // WEB_URL matters beyond Mollie now: a granted person's email names it as the
  // place to sign in (workplan 0095), so without it a grant provisions an
  // organisation and tells nobody. Non-fatal on purpose — the operator learns
  // per grant, in the response, and refusing to boot would take a deployment
  // that worked yesterday off the air over a courtesy email.
  if (!env.MOLLIE_API_KEY && (!env.WEB_URL || isLocalhostUrl(env.WEB_URL))) {
    problems.push({
      fatal: false,
      message:
        `WEB_URL is ${env.WEB_URL ? `'${env.WEB_URL}'` : 'unset'} in production. ` +
        'Granting an access request will provision the organisation and send no email, ' +
        "because there would be no address to tell the person to sign in at. The grant " +
        'response says so each time.',
    });
  }

  if (!env.CORS_ORIGIN || isLocalhostUrl(env.CORS_ORIGIN)) {
    problems.push({
      fatal: false,
      message:
        `CORS_ORIGIN is ${env.CORS_ORIGIN ? `'${env.CORS_ORIGIN}'` : 'unset (defaulting to localhost)'} in production. ` +
        'Fine when browsers reach the API through the web image\'s same-origin /api proxy; ' +
        'a direct-to-API deployment needs it set to the web app\'s public origin.',
    });
  }

  return problems;
};

/** Boot-time enforcement: throws on fatal problems, warns on the rest. */
export const assertProductionUrlConfig = (
  warn: (message: string) => void = (m) => log.warn(m),
): void => {
  const problems = describeUrlConfigProblems(process.env);
  const fatal = problems.filter((p) => p.fatal);
  for (const p of problems.filter((p) => !p.fatal)) warn(p.message);
  if (fatal.length > 0) {
    throw new Error(fatal.map((p) => p.message).join(' '));
  }
};
