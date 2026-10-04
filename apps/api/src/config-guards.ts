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
 *
 * And one that is not about a URL (workplan 0134 T1): a blank
 * BACKUP_RETENTION_DAYS, which makes the erasure sentence name backups kept
 * for the default 7 days whether or not anything backs the database up.
 */

import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  backupRetentionIsBlank,
  log,
} from '@openmig/shared';
import { alphaFrom } from './access-notify.ts';

const isLocalhostUrl = (value: string): boolean => {
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
};

export interface ConfigProblem {
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
}): ConfigProblem[] => {
  if (env.NODE_ENV !== 'production') return [];
  const problems: ConfigProblem[] = [];

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

/** Throws on fatal problems, warns on the rest. */
const enforce = (problems: ConfigProblem[], warn: (message: string) => void): void => {
  const fatal = problems.filter((p) => p.fatal);
  for (const p of problems.filter((p) => !p.fatal)) warn(p.message);
  if (fatal.length > 0) {
    throw new Error(fatal.map((p) => p.message).join(' '));
  }
};

/** Boot-time enforcement: throws on fatal problems, warns on the rest. */
export const assertProductionUrlConfig = (
  warn: (message: string) => void = (m) => log.warn(m),
): void => {
  enforce(describeUrlConfigProblems(process.env), warn);
};

/**
 * A backup retention somebody stated (workplan 0134 T1).
 *
 * `POST /api/tenants/:tenantId/close` tells a customer when their erasure
 * completes, from `BACKUP_RETENTION_DAYS` (0085 T5). A blank value reads as
 * the default of 7, so the sentence names backups kept for 7 days after the
 * purge, and nothing checked that any exist. Nothing in this repository backs
 * up the managed application database yet, and the alpha takes no backups at
 * all (0134 D1). The default stays 7 (0134 §3); this makes the blank visible.
 *
 *  - In production, blank is a WARNING. It names both honest answers: 0 when
 *    nothing is backed up, and the number of days backups are kept.
 *  - With the alpha setting on (`OWNPACE_STAGE=alpha`, 0131 T1), blank is
 *    FATAL whatever NODE_ENV says, so an alpha stack cannot start while it
 *    quotes backups by default. It does not wait for production because the
 *    OTA stack runs `development` by the owner's choice (workplan 0132 T4,
 *    2026-10-04); `managed.yml` no longer defaults NODE_ENV, every stack's
 *    `.env` names it. It names live's own number, 7, the most days a dump
 *    taken before a deploy is kept (0134 open question 1 (b), 2026-09-28),
 *    so it never points live's operator at 0.
 *  - A stated number, 0 or 7 or any other, is never a problem here. A value
 *    that is not a whole number is refused where it is read, by
 *    `backupRetentionDaysFromEnv`.
 *
 * Fatal on the alpha is the plan's recommendation; whether it should only warn
 * is 0134 open question 4, still the owner's to answer.
 *
 * At most one problem, in the shape `describeUrlConfigProblems` returns, so
 * the boot path treats both alike. The guard is
 * `apps/api/src/a-retention-somebody-stated.unit.test.ts`.
 */
export const describeBackupRetentionProblem = (env: {
  NODE_ENV?: string;
  OWNPACE_STAGE?: string;
  BACKUP_RETENTION_DAYS?: string;
}): ConfigProblem[] => {
  const raw = env.BACKUP_RETENTION_DAYS;
  if (!backupRetentionIsBlank(raw)) return [];
  const blank = raw === undefined ? 'unset' : 'empty';
  const days = DEFAULT_BACKUP_RETENTION_DAYS;

  if (alphaFrom(env)) {
    return [
      {
        fatal: true,
        message:
          `BACKUP_RETENTION_DAYS is ${blank} on a stack with OWNPACE_STAGE=alpha. ` +
          `The erasure sentence would then name backups kept for ${days} days after the purge, ` +
          'and an alpha stack must say whether it keeps any. ' +
          "Set it to 0 if nothing backs up or dumps this deployment's database, " +
          'or to the number of days its backups or dumps are kept: 7 on ownpace-live, ' +
          'the most days a dump of its databases taken before a deploy is kept (workplan 0134).',
      },
    ];
  }

  if (env.NODE_ENV !== 'production') return [];
  return [
    {
      fatal: false,
      message:
        `BACKUP_RETENTION_DAYS is ${blank} in production, so the erasure sentence a closing ` +
        `customer is given names backups kept for ${days} days after the purge. ` +
        "Set it to 0 if nothing backs up this deployment's database, " +
        'or to the number of days its backups are kept (workplan 0134).',
    },
  ];
};

/** Boot-time enforcement of the retention check: throws on the alpha case, warns in production. */
export const assertBackupRetentionConfig = (
  warn: (message: string) => void = (m) => log.warn(m),
): void => {
  enforce(describeBackupRetentionProblem(process.env), warn);
};
