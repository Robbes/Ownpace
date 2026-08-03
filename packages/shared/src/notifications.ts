// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * What the appliance tells an absent owner (SAD §11.2 #4, workplan 0030 T1).
 *
 * The product reason this exists: an SMB owner mid-shadow-sync checks the UI
 * weekly at best. The decision queues (0028) and the item queues only work if
 * "something is waiting on you" REACHES someone — which is an email, not a
 * bell icon. Owner decision 2026-08-02: email only, ad hoc events plus daily
 * and weekly "what needs attention" digests. No in-app notification centre.
 *
 * This file is the part with the rules in it — what goes in a message, in
 * which language, and above all WHEN NOT TO SEND. It is deliberately pure:
 * every function here is a total function of its arguments, so the decisions
 * can be tested exhaustively without an SMTP server in the loop. The
 * transport and the schedule are the next slice (see the workplan); nothing
 * calls this yet, and the workplan says so rather than implying otherwise.
 *
 * TWO RULES DO THE WORK:
 *
 *  1. **An empty digest sends nothing.** A weekly mail that says "all clear"
 *     52 times trains its reader to delete it unopened, and the one that says
 *     something goes with it. Silence is the signal that nothing is waiting.
 *
 *  2. **A blind spot is never silence.** If a queue could not be READ, the
 *     digest must say so and must send — because "I found nothing" and "I
 *     could not look" are the same email otherwise, and hard rule 9 exists to
 *     stop exactly that. `blindSpots` outranks every zero count below.
 *
 * Bilingual from birth (ADR-0013 / workplan 0024's transferred requirement):
 * EN and NL live beside each other in this file, as `APPLY_FLAG_WARNING` and
 * its NL twin already do, so a language cannot silently fall behind. The
 * PROSE BOUNDARY applies (docs/i18n-prose-boundary.md): the frame is
 * translated, the server's own findings — a decision's summary, a run's
 * `lastError` — are carried verbatim in whatever language the server said
 * them.
 */

/** The two languages the UI speaks; the same pair, deliberately. */
export type NotificationLocale = 'en' | 'nl';

/** A rendered message, ready for any transport. */
export interface NotificationMessage {
  readonly subject: string;
  readonly body: string;
}

/**
 * The channel itself. One method, because a notifier that can only be asked
 * to send a finished message cannot accidentally grow policy of its own —
 * the policy is all in this file, where it is testable.
 */
export interface Notifier {
  notify(message: NotificationMessage): Promise<void>;
}

/** How often the digest goes out. Ad hoc events are not a cadence. */
export type DigestCadence = 'daily' | 'weekly';

/**
 * Pushing the bytes — the ONE thing that needs a protocol library, kept as a
 * function so this package does not grow an SMTP dependency (it is imported
 * by the browser bundle; `@openmig/connectors` owns the nodemailer binding).
 */
export type MailTransport = (message: {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
}) => Promise<void>;

/** Everything the channel needs to send. Secrets arrive already resolved. */
export interface NotifierSettings {
  readonly from: string;
  readonly to: readonly string[];
  /** The recipient's language. Defaults to English, the dictionary's source. */
  readonly locale?: NotificationLocale;
}

/**
 * A notifier that sends, and one that honestly does not.
 *
 * The disabled case is not an oversight to be silent about: an appliance with
 * no SMTP configured is the DEFAULT state, and an owner who believes they
 * will be emailed when they will not be is worse off than one who knows the
 * channel is off. So `disabledNotifier` says so — once, with the reason —
 * rather than swallowing the call (hard rule 9), and `notificationsEnabled`
 * lets `/status` show the same fact without sending anything.
 */
export function disabledNotifier(reason: string, log: (msg: string) => void): Notifier {
  let said = false;
  return {
    notify(): Promise<void> {
      if (!said) {
        said = true;
        // Once, not per message: a channel that is off is one fact, and
        // repeating it per event would bury the run's real output.
        log(`[notify] not sending — ${reason}`);
      }
      return Promise.resolve();
    },
  };
}

/**
 * The sending notifier.
 *
 * A send failure PROPAGATES. It is tempting to swallow it — the migration
 * itself is fine, after all — but a notification that silently failed to
 * send is indistinguishable from one that was never worth sending, and the
 * whole point of this channel is reaching someone who is not watching. The
 * caller decides what a failure means; this seam refuses to decide for them.
 */
export function createNotifier(transport: MailTransport, settings: NotifierSettings): Notifier {
  return {
    async notify(message: NotificationMessage): Promise<void> {
      await transport({
        from: settings.from,
        to: settings.to,
        subject: message.subject,
        body: message.body,
      });
    },
  };
}

/**
 * One mapping's outstanding work, as the digest sees it.
 *
 * Counts come from the same envelopes the screens read — never a parallel
 * query — so the number in the email and the number on the page cannot
 * disagree.
 */
export interface MappingAttention {
  readonly mappingId: string;
  /** Drift decisions awaiting an answer (0028). */
  readonly pendingDecisions: number;
  /** Confirmed deletions not yet decided about. */
  readonly deletionsWaiting: number;
  /** Moves reported and not yet acknowledged. */
  readonly movesWaiting: number;
  /** Failures that have exhausted their retries and now want a person. */
  readonly failuresWaiting: number;
  /** Verified and waiting for the owner to finish the migration. */
  readonly readyForCutover: boolean;
  /**
   * Anything this summary could NOT read, in the server's own words.
   *
   * Present means the digest is INCOMPLETE, and rule 2 above makes that
   * enough on its own to send. Never summarise these away.
   */
  readonly blindSpots?: readonly string[];
}

/** Does this mapping want a person? */
export function wantsAttention(m: MappingAttention): boolean {
  return (
    m.pendingDecisions > 0 ||
    m.deletionsWaiting > 0 ||
    m.movesWaiting > 0 ||
    m.failuresWaiting > 0 ||
    m.readyForCutover ||
    (m.blindSpots?.length ?? 0) > 0
  );
}

const DIGEST_SUBJECT: Record<NotificationLocale, Record<DigestCadence, string>> = {
  en: {
    daily: 'Open Migrate — what needs your attention today',
    weekly: 'Open Migrate — what needs your attention this week',
  },
  nl: {
    daily: 'Open Migrate — wat vandaag uw aandacht vraagt',
    weekly: 'Open Migrate — wat deze week uw aandacht vraagt',
  },
};

const DIGEST_INTRO: Record<NotificationLocale, string> = {
  en: 'These items are waiting for a decision. Nothing happens until you answer.',
  nl: 'Deze zaken wachten op een beslissing. Er gebeurt niets totdat u antwoordt.',
};

/**
 * Named keys rather than `Record<string, string>`, so a line missing from one
 * language is a TYPE ERROR — the compile-time parity the UI dictionary has
 * (workplan 0024 T1), for the same reason: a language cannot fall behind
 * silently if it cannot compile behind.
 */
interface DigestLines {
  readonly migration: string;
  readonly decisions: string;
  readonly deletions: string;
  readonly moves: string;
  readonly failures: string;
  readonly readyForCutover: string;
  readonly couldNotRead: string;
  readonly footer: string;
}

const LINE: Record<NotificationLocale, DigestLines> = {
  en: {
    migration: 'Migration',
    decisions: 'changes needing a decision',
    deletions: 'deletions to confirm',
    moves: 'moves to acknowledge',
    failures: 'items that could not be copied',
    readyForCutover: 'checked and ready to finish',
    couldNotRead: 'COULD NOT BE READ — this summary is incomplete:',
    footer:
      'You are receiving this because Open Migrate is configured to send you a summary. ' +
      'Open the app to act on any of the above.',
  },
  nl: {
    migration: 'Migratie',
    decisions: 'wijzigingen die een beslissing vragen',
    deletions: 'verwijderingen om te bevestigen',
    moves: 'verplaatsingen om te bevestigen',
    failures: 'items die niet gekopieerd konden worden',
    readyForCutover: 'gecontroleerd en klaar om af te ronden',
    couldNotRead: 'KON NIET GELEZEN WORDEN — deze samenvatting is onvolledig:',
    footer:
      'U ontvangt dit omdat Open Migrate is ingesteld om u een samenvatting te sturen. ' +
      'Open de app om actie te ondernemen.',
  },
};

/**
 * The digest — or NOTHING when nothing is waiting.
 *
 * `undefined` is the whole point of the return type: it is the difference
 * between a channel an owner keeps reading and one they filter away. Callers
 * must treat it as "do not send", never as "send an empty one".
 */
export function renderDigest(
  mappings: readonly MappingAttention[],
  locale: NotificationLocale,
  cadence: DigestCadence,
): NotificationMessage | undefined {
  const waiting = mappings.filter(wantsAttention);
  if (waiting.length === 0) return undefined;

  const t = LINE[locale];
  const lines: string[] = [DIGEST_INTRO[locale], ''];

  for (const m of waiting) {
    lines.push(`${t.migration}: ${m.mappingId}`);
    if (m.pendingDecisions > 0) lines.push(`  - ${m.pendingDecisions} ${t.decisions}`);
    if (m.deletionsWaiting > 0) lines.push(`  - ${m.deletionsWaiting} ${t.deletions}`);
    if (m.movesWaiting > 0) lines.push(`  - ${m.movesWaiting} ${t.moves}`);
    if (m.failuresWaiting > 0) lines.push(`  - ${m.failuresWaiting} ${t.failures}`);
    if (m.readyForCutover) lines.push(`  - ${t.readyForCutover}`);
    for (const blind of m.blindSpots ?? []) {
      // Verbatim: this is the server's own reason, and paraphrasing the one
      // line that says "I could not look" would defeat its purpose.
      lines.push(`  - ${t.couldNotRead} ${blind}`);
    }
    lines.push('');
  }

  lines.push(t.footer);
  return { subject: DIGEST_SUBJECT[locale][cadence], body: lines.join('\n') };
}

/** What an SMTP transport needs. The password arrives resolved, never a ref. */
export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  /** Implicit TLS (465). False means STARTTLS on 587, the common default. */
  readonly secure: boolean;
  readonly user?: string;
  readonly password?: string;
}

/** Configured and ready, or off — with the reason, always. */
export type NotifierConfig =
  | {
      readonly enabled: true;
      readonly smtp: SmtpSettings;
      readonly settings: NotifierSettings;
      /**
       * Which digests to send. Empty means ad hoc events only — a legitimate
       * choice for someone who wants the interruptions and not the summary.
       */
      readonly digests: readonly DigestCadence[];
    }
  | { readonly enabled: false; readonly reason: string };

/** `NOTIFY_DIGEST`: daily | weekly | both | off. Defaults to daily. */
function parseDigests(raw: string | undefined): readonly DigestCadence[] {
  switch ((raw ?? 'daily').trim().toLowerCase()) {
    case 'off':
    case 'none':
      return [];
    case 'weekly':
      return ['weekly'];
    case 'both':
    case 'daily,weekly':
    case 'weekly,daily':
      return ['daily', 'weekly'];
    default:
      // Daily by default, and for anything unrecognised: a typo should not
      // silently turn the summary off, which is the failure nobody notices.
      return ['daily'];
  }
}

/**
 * When each digest goes out (workplan 0030 T3).
 *
 * Morning local time on purpose: a summary that lands at 03:00 is read twelve
 * hours late, and the whole point is reaching somebody BEFORE their day
 * starts. Weekly goes out on Monday for the same reason — a summary of last
 * week that arrives on Friday afternoon is history, not a to-do list.
 */
export const DIGEST_CRON: Record<DigestCadence, string> = {
  daily: '0 8 * * *',
  weekly: '0 8 * * 1',
};

/**
 * Which digest jobs an edition should actually register.
 *
 * A pure function rather than an `if` buried in the appliance's startup, so
 * the two properties that matter can be pinned without booting anything:
 * a channel that is OFF schedules nothing (a job that wakes every morning to
 * discover there is no SMTP server is a job that will one day log an error
 * nobody asked for), and `NOTIFY_DIGEST=off` schedules nothing while leaving
 * the ad hoc events alone.
 */
export function digestSchedule(
  config: NotifierConfig,
): readonly { readonly cadence: DigestCadence; readonly cron: string }[] {
  if (!config.enabled) return [];
  return config.digests.map((cadence) => ({ cadence, cron: DIGEST_CRON[cadence] }));
}

/**
 * Read the channel's configuration from the environment.
 *
 * Environment rather than the mapping file on purpose: notifications are an
 * APPLIANCE-wide concern (who gets told), not a per-migration one, and the
 * appliance already takes its secrets this way — `.env`, gitignored, 600
 * (hard rule 3: never inline, never in the repo).
 *
 * THE HALF-CONFIGURED CASE IS THE INTERESTING ONE. Nothing set at all is the
 * normal, expected default and says so plainly. But an operator who set
 * `SMTP_HOST` and stopped has plainly TRIED to turn this on, and silently
 * treating that as "off" would leave them believing they are covered. So a
 * partial configuration reports exactly which variables are missing —
 * still off, but never quietly (hard rule 9).
 */
export function readNotifierConfig(env: {
  readonly [key: string]: string | undefined;
}): NotifierConfig {
  const host = env.SMTP_HOST?.trim();
  const from = env.NOTIFY_FROM?.trim();
  const to = (env.NOTIFY_TO ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);

  const touched = Boolean(host || from || to.length > 0 || env.SMTP_USER || env.SMTP_PASSWORD);
  if (!touched) {
    return { enabled: false, reason: 'no SMTP settings configured (SMTP_HOST, NOTIFY_FROM, NOTIFY_TO)' };
  }

  const missing: string[] = [];
  if (!host) missing.push('SMTP_HOST');
  if (!from) missing.push('NOTIFY_FROM');
  if (to.length === 0) missing.push('NOTIFY_TO');
  if (missing.length > 0) {
    return {
      enabled: false,
      reason:
        `SMTP is partly configured and therefore OFF — missing: ${missing.join(', ')}. ` +
        'Set them all, or unset the rest to silence this.',
    };
  }

  const secure = env.SMTP_SECURE === 'true';
  const parsedPort = Number.parseInt(env.SMTP_PORT ?? '', 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : secure ? 465 : 587;
  const locale: NotificationLocale = env.NOTIFY_LOCALE === 'nl' ? 'nl' : 'en';

  return {
    enabled: true,
    smtp: {
      host: host!,
      port,
      secure,
      ...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
      ...(env.SMTP_PASSWORD ? { password: env.SMTP_PASSWORD } : {}),
    },
    settings: { from: from!, to, locale },
    digests: parseDigests(env.NOTIFY_DIGEST),
  };
}

/**
 * The immediate events — the ones worth interrupting someone for.
 *
 * Deliberately few. Every event that is not worth an interruption belongs in
 * the digest instead, and the fastest way to make this channel worthless is
 * to send from it often.
 */
export type NotificationEvent =
  | {
      readonly kind: 'decision_raised';
      readonly mappingId?: string;
      /** The server's own sentence, rendered verbatim (prose boundary). */
      readonly summary: string;
    }
  | {
      readonly kind: 'runs_failing';
      readonly mappingId: string;
      readonly consecutiveFailures: number;
      /** The server's own diagnostic, verbatim (hard rule 9). */
      readonly lastError: string;
    }
  | {
      readonly kind: 'verification_finished';
      readonly mappingId: string;
      readonly passed: boolean;
    }
  | { readonly kind: 'migration_finished'; readonly mappingId: string };

/**
 * One outage, one email (workplan 0030 T2).
 *
 * A sync that fails runs again a minute later and fails again. Notifying per
 * failed pass would send sixty emails an hour about a single unplugged
 * server, and the channel would be filtered inside a day — taking the
 * decision queue's mail with it. So the rule is: say it once when the
 * failures have gone on long enough to be real, then stay quiet until the
 * condition CHANGES.
 *
 * A threshold rather than the first failure, because one failed pass is
 * usually a blip that the next pass fixes; `MAX_ITEM_ATTEMPTS` reasoning
 * applied to whole passes. Recovery resets the streak, so a second outage
 * next week notifies again — the alternative would be a channel that goes
 * quiet permanently after its first bad day.
 */
export interface FailureStreakGate {
  /**
   * Record how a pass ended. Returns the event worth sending, or `undefined`
   * when this pass changes nothing anyone needs to be told about.
   */
  record(
    mappingId: string,
    outcome: 'ok' | 'failed',
    lastError?: string,
  ): NotificationEvent | undefined;
}

export function createFailureStreakGate(threshold = 3): FailureStreakGate {
  const streak = new Map<string, number>();
  return {
    record(mappingId, outcome, lastError) {
      if (outcome === 'ok') {
        streak.delete(mappingId);
        return undefined;
      }
      const consecutiveFailures = (streak.get(mappingId) ?? 0) + 1;
      streak.set(mappingId, consecutiveFailures);
      // EXACTLY at the threshold, never above it: the fourth, fifth and
      // hundredth consecutive failure are the same outage, already reported.
      if (consecutiveFailures !== threshold) return undefined;
      return {
        kind: 'runs_failing',
        mappingId,
        consecutiveFailures,
        // Verbatim — a diagnostic we reworded is a diagnostic we broke.
        lastError: lastError ?? 'no error message was recorded',
      };
    },
  };
}

const EVENT: Record<NotificationLocale, Record<NotificationEvent['kind'], string>> = {
  en: {
    decision_raised: 'Open Migrate — a change needs your decision',
    runs_failing: 'Open Migrate — a migration keeps failing',
    verification_finished: 'Open Migrate — the check has finished',
    migration_finished: 'Open Migrate — the migration is finished',
  },
  nl: {
    decision_raised: 'Open Migrate — een wijziging vraagt uw beslissing',
    runs_failing: 'Open Migrate — een migratie blijft mislukken',
    verification_finished: 'Open Migrate — de controle is afgerond',
    migration_finished: 'Open Migrate — de migratie is afgerond',
  },
};

/** Same compile-time parity as `DigestLines`, for the event bodies. */
interface EventLines {
  readonly migration: string;
  readonly decisionIntro: string;
  readonly failingIntro: string;
  readonly failingTail: string;
  readonly verifyPassed: string;
  readonly verifyFailed: string;
  readonly finished: string;
  readonly act: string;
}

const EVENT_BODY: Record<NotificationLocale, EventLines> = {
  en: {
    migration: 'Migration',
    decisionIntro: 'Something changed that only you can decide about:',
    failingIntro: 'This migration has failed',
    failingTail: 'times in a row. The most recent error was:',
    verifyPassed: 'The check passed: the new system matches the old one.',
    verifyFailed: 'The check did NOT pass. Open the app to see what differs.',
    finished: 'This migration is finished and no longer syncs.',
    act: 'Open the app to act on this.',
  },
  nl: {
    migration: 'Migratie',
    decisionIntro: 'Er is iets veranderd waarover alleen u kunt beslissen:',
    failingIntro: 'Deze migratie is',
    failingTail: 'keer achter elkaar mislukt. De laatste fout was:',
    verifyPassed: 'De controle is geslaagd: het nieuwe systeem komt overeen met het oude.',
    verifyFailed: 'De controle is NIET geslaagd. Open de app om te zien wat afwijkt.',
    finished: 'Deze migratie is afgerond en synchroniseert niet meer.',
    act: 'Open de app om actie te ondernemen.',
  },
};

/** One immediate event, rendered. Always sends — these are not summaries. */
export function renderEvent(
  event: NotificationEvent,
  locale: NotificationLocale,
): NotificationMessage {
  const b = EVENT_BODY[locale];
  const subject = EVENT[locale][event.kind];
  const lines: string[] = [];

  switch (event.kind) {
    case 'decision_raised':
      if (event.mappingId) lines.push(`${b.migration}: ${event.mappingId}`, '');
      lines.push(b.decisionIntro, '', event.summary);
      break;
    case 'runs_failing':
      lines.push(`${b.migration}: ${event.mappingId}`, '');
      lines.push(`${b.failingIntro} ${event.consecutiveFailures} ${b.failingTail}`, '');
      // Verbatim, always: a diagnostic we reworded is a diagnostic we broke.
      lines.push(event.lastError);
      break;
    case 'verification_finished':
      lines.push(`${b.migration}: ${event.mappingId}`, '');
      lines.push(event.passed ? b.verifyPassed : b.verifyFailed);
      break;
    case 'migration_finished':
      lines.push(`${b.migration}: ${event.mappingId}`, '');
      lines.push(b.finished);
      break;
  }

  lines.push('', b.act);
  return { subject, body: lines.join('\n') };
}
