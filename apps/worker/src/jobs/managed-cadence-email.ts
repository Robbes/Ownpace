// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MORNING'S SLOWER CADENCES (workplan 0157 T7, the wiring half).
 *
 * Every morning each active organisation is asked which of its migrations on
 * *Automatic* stepped down since it was last told, and is told in one mail:
 * *"Everything is in step, so we now look for changes less often"*, each
 * migration by its name and its person, now every 6 hours or once a day, and
 * how to choose more often. What is said, and once, lives in
 * `the-slower-cadence-email.ts`: Free's pace, whose step went down, the claim
 * that says each step once, and to whom. It is tested there against a real
 * database. THIS FILE IS ONLY THE WIRING: the list, each organisation's
 * scopes, the mail and the schedule.
 *
 * WHY IT CROSSES ORGANISATIONS, AND WHAT IT READS OF EACH (as workplan 0138 T2
 * split the digest). One question spans organisations: which ones are active.
 * `activeOrganisations` (task-pools.ts) answers it with ids, and nothing more.
 * Everything else is one organisation's, read and written in its own scope on
 * the tenant pool, `app_user`, under row security (`openTaskPools`): the tier
 * its month bills, its migrations on the automatic cadence with their data
 * types, last visit and person, the steps already said, which it claims and
 * clears, and, once a step is claimed, its active owners and admins and its
 * notification settings.
 *
 * Its pools are opened in its run and ended in `afterwards`, after a failure
 * is on the operator's log page, whose sink is on the tenant pool: a daily job
 * holds no pool between runs.
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { schedules } from '@trigger.dev/sdk';
import type { Pool } from 'pg';
import { withTenant } from '@openmig/ledger';
import { createNotifier, log, renderEvent, type NotificationLocale, type NotificationMessage } from '@openmig/shared';
import { notifierFromEnv, smtpTransport } from '@openmig/connectors';
import { leavesAReference } from './what-a-run-leaves.ts';
import { activeOrganisations, openTaskPools } from './task-pools.ts';
import { claimSlowerSteps, whomToTell } from './the-slower-cadence-email.ts';

/** What one organisation's morning came to, for the run's summary. */
export type CadenceAnswer =
  /** On Free, outside the alpha: one pass a day whatever the cadence. */
  | 'free_pace'
  /** Nothing stepped down since it was last said. */
  | 'none'
  /** Claimed, and sent. */
  | 'sent'
  /** Claimed, and no channel is configured to send it on. */
  | 'no_channel'
  /** Claimed, and the organisation has no active owner or admin to send it to. */
  | 'no_recipients';

/** Sends one message. */
export type CadenceSend = (to: readonly string[], locale: NotificationLocale, message: NotificationMessage) => Promise<void>;

/**
 * One organisation's half: the claim in its own scope, and, once that has
 * committed, whom to tell in a second, then the mail. Exported so the tests
 * run it on a database of their own. `send` is absent where no channel is
 * configured: the steps are claimed all the same, as the first-copy email's
 * are, so a channel switched on later does not tell anyone then about today.
 */
export async function cadenceOfOrganisation(
  pool: Pool,
  organisation: string,
  now: Date,
  send: CadenceSend | undefined,
): Promise<CadenceAnswer> {
  const claim = await withTenant(pool, organisation, (db) => claimSlowerSteps(db, organisation, now));
  if (claim.kind !== 'claimed') return claim.kind;
  if (!send) return 'no_channel';
  const { to, locale } = await withTenant(pool, organisation, (db) => whomToTell(db, organisation));
  if (to.length === 0) return 'no_recipients';
  await send(to, locale, renderEvent({ kind: 'looking_less_often', migrations: claim.migrations }, locale));
  return 'sent';
}

export const managedCadenceEmail = schedules.task({
  id: 'managed-cadence-email',
  // 07:30 UTC: after the drift detector, before the digest. A morning's mail,
  // rather than one at the minute a step happened, which is as often as not
  // in the night.
  cron: '30 7 * * *',
  run: leavesAReference('managed-cadence-email', async (_payload: unknown, _context: unknown, afterwards) => {
    // This run's pools (0138 T1, T2): the tenant pool on APP_DATABASE_URL,
    // app_user, under row security, and the audit key's pool of one. Opened
    // first, so even the list's refusal reaches the log page, and ended once
    // the run is over, after its failure is recorded.
    const pools = openTaskPools();
    afterwards(() => pools.end());
    const channel = notifierFromEnv(process.env, (m) => log.warn(m));
    let send: CadenceSend | undefined;
    if (channel.config.enabled) {
      const from = channel.config.settings.from;
      // ONE transport for the whole run, as the digest's: each organisation
      // gets its own envelope, recipients and language.
      const transport = smtpTransport(channel.config.smtp);
      send = (to, locale, message) => createNotifier(transport, { from, to, locale }).notify(message);
    } else {
      // Said every morning, as the digest says it: an operator who believes
      // these are sent when no SMTP is configured is who rule 9 protects.
      log.warn(`[cadence-email] not sending: ${channel.config.reason}. Each step is claimed all the same.`);
    }

    // The one question across organisations.
    const organisations = await activeOrganisations();
    const now = new Date();
    const counts: Record<CadenceAnswer | 'failed', number> = {
      free_pace: 0,
      none: 0,
      sent: 0,
      no_channel: 0,
      no_recipients: 0,
      failed: 0,
    };
    for (const organisation of organisations) {
      try {
        // Each organisation as itself, on the tenant pool.
        counts[await cadenceOfOrganisation(pools.tenant, organisation, now, send)]++;
      } catch (err) {
        // Said, and the next organisation still asked: one that cannot be
        // read must not keep the others from hearing (hard rule 9).
        counts.failed++;
        log.error(
          `[cadence-email] organisation ${organisation}: its slower cadences could not be read, claimed or sent:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const result = { tenants: organisations.length, ...counts };
    log.info('[cadence-email]', result);
    return result;
  }),
});
