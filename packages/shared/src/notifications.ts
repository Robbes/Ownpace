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
   * Old copies of relocated items removed UNATTENDED since the last digest
   * (ADR-0031, workplan 0048). Not a queue — nothing is waiting — but the one
   * thing that feature must never be is silent, and the digest is where an
   * owner who opted in reads what happened overnight.
   */
  readonly autoApplied: number;
  /**
   * Anything this summary could NOT read, in the server's own words.
   *
   * Present means the digest is INCOMPLETE, and rule 2 above makes that
   * enough on its own to send. Never summarise these away.
   */
  readonly blindSpots?: readonly string[];
}

/**
 * ---------------------------------------------------------------------------
 * Counting the queues (workplan 0030 T3/T4)
 * ---------------------------------------------------------------------------
 *
 * Both editions collect the digest their own way — the appliance reads its
 * PGlite ledger in-process, the managed digest task enumerates tenants — but
 * they must COUNT the same, and they must count what the screens count. A
 * summary that says four things are waiting, pointing at a queue that shows
 * three, sends the owner hunting for an item that does not exist; the next
 * digest they get goes unread. So the filters live here, once, where a test
 * can hold them to the same expressions `/api/deletions`, `/api/moves` and
 * `/api/failures` apply.
 *
 * Pure on purpose: the reading is I/O each edition does differently, the
 * counting is a rule neither may have its own version of.
 */

/** Just enough of a deletion row to count it — structural on purpose. */
export interface DeletionRow {
  readonly confirmed: boolean;
  readonly acknowledgedAt?: string | undefined;
}

/** Just enough of a move row. */
export interface MoveRow {
  readonly acknowledgedAt?: string | undefined;
}

/** Just enough of a failure row. */
export interface FailureRow {
  readonly needsDecision: boolean;
}

/** What one mapping's four reads came back with. */
export interface QueueReads {
  readonly deletions: readonly DeletionRow[];
  readonly moves: readonly MoveRow[];
  readonly failures: readonly FailureRow[];
  /** Tenant-level, counted once per tenant by the caller — zero elsewhere. */
  readonly pendingDecisions: number;
  /** The mapping's own status, or undefined when even that could not be read. */
  readonly status: string | undefined;
  /** Relocations auto-applied in the digest window; absent = zero. */
  readonly autoApplied?: number;
  /** Whatever could not be read, in the server's own words. */
  readonly blindSpots: readonly string[];
}

/**
 * Should this mapping appear in the digest at all?
 *
 * A finished migration keeps its history but stops nagging — the same rule
 * `reportingClosed` applies to the queue endpoints. Without it every appliance
 * that ever completed a migration would email its owner about it forever.
 */
export function reportsToDigest(status: string | undefined): boolean {
  return status !== 'done';
}

/** Count one mapping's queues the way the screens count them. */
export function summariseQueues(mappingId: string, reads: QueueReads): MappingAttention {
  return {
    mappingId,
    pendingDecisions: reads.pendingDecisions,
    // Confirmed but unacknowledged: a deletion still being watched has not
    // been established as real yet, so it is not waiting on anybody.
    deletionsWaiting: reads.deletions.filter((d) => d.confirmed && !d.acknowledgedAt).length,
    movesWaiting: reads.moves.filter((mv) => !mv.acknowledgedAt).length,
    // Only the ones that gave up retrying. A failure still inside its retry
    // budget is the machine's problem, not the owner's.
    failuresWaiting: reads.failures.filter((f) => f.needsDecision).length,
    readyForCutover: reads.status === 'cutover',
    autoApplied: reads.autoApplied ?? 0,
    ...(reads.blindSpots.length > 0 ? { blindSpots: reads.blindSpots } : {}),
  };
}

/** Does this mapping want a person? */
export function wantsAttention(m: MappingAttention): boolean {
  return (
    m.pendingDecisions > 0 ||
    m.deletionsWaiting > 0 ||
    m.movesWaiting > 0 ||
    m.failuresWaiting > 0 ||
    m.readyForCutover ||
    // Auto-applied removals keep the email alive on their own: an owner whose
    // only news is "3 old copies removed automatically" must receive it.
    m.autoApplied > 0 ||
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
  /**
   * Heading for what belongs to the TENANT rather than to any one migration.
   *
   * A pending decision belongs to the organisation — a newly-discovered mailbox
   * is not a fact about a mapping. Until 0043 T4 the digest was a list of
   * mappings and had nowhere to put one, so a tenant whose migrations were all
   * `done` had its decisions announced to the operator's log and to nobody
   * else. Rather than invent a row with a mapping id nobody can open (which is
   * what 0030 T4 rightly refused), the digest grew a section that is not a
   * mapping.
   */
  readonly organisation: string;
  readonly decisions: string;
  readonly deletions: string;
  readonly moves: string;
  readonly failures: string;
  readonly readyForCutover: string;
  readonly autoApplied: string;
  readonly couldNotRead: string;
  readonly footer: string;
}

const LINE: Record<NotificationLocale, DigestLines> = {
  en: {
    migration: 'Migration',
    organisation: 'Your organisation',
    decisions: 'changes needing a decision',
    deletions: 'deletions to confirm',
    moves: 'moves to acknowledge',
    failures: 'items that could not be copied',
    readyForCutover: 'checked and ready to finish',
    autoApplied:
      'old copies of moved or renamed files removed automatically (auto-apply — each is recorded)',
    couldNotRead: 'COULD NOT BE READ — this summary is incomplete:',
    footer:
      'You are receiving this because Open Migrate is configured to send you a summary. ' +
      'Open the app to act on any of the above.',
  },
  nl: {
    migration: 'Migratie',
    organisation: 'Uw organisatie',
    decisions: 'wijzigingen die een beslissing vragen',
    deletions: 'verwijderingen om te bevestigen',
    moves: 'verplaatsingen om te bevestigen',
    failures: 'items die niet gekopieerd konden worden',
    readyForCutover: 'gecontroleerd en klaar om af te ronden',
    autoApplied:
      'oude kopieën van verplaatste of hernoemde bestanden automatisch verwijderd (automatisch toepassen — elk is vastgelegd)',
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
/**
 * What is waiting on the TENANT rather than on any one migration (0043 T4).
 *
 * A pending decision belongs to the organisation: a newly-discovered mailbox is
 * not a fact about a mapping, which is why the count was always taken once per
 * tenant. The digest had no way to say so, so a tenant whose every migration was
 * `done` — precisely the tenant nobody is watching — had its decisions written
 * to the operator's log and to no one else.
 */
export interface TenantAttention {
  readonly pendingDecisions?: number;
  /** Queues that could not be READ. Verbatim, for the same reason as a mapping's. */
  readonly blindSpots?: readonly string[];
}

export function renderDigest(
  mappings: readonly MappingAttention[],
  locale: NotificationLocale,
  cadence: DigestCadence,
  tenant?: TenantAttention,
): NotificationMessage | undefined {
  const waiting = mappings.filter(wantsAttention);
  const tenantDecisions = tenant?.pendingDecisions ?? 0;
  const tenantBlindSpots = tenant?.blindSpots ?? [];
  const tenantWants = tenantDecisions > 0 || tenantBlindSpots.length > 0;

  // Silence stays the signal — an empty digest still sends nothing. What
  // changed is what counts as empty: tenant-level attention now keeps the
  // email alive on its own, so a decision no longer needs a live mapping to
  // ride along with.
  if (waiting.length === 0 && !tenantWants) return undefined;

  const t = LINE[locale];
  const lines: string[] = [DIGEST_INTRO[locale], ''];

  if (tenantWants) {
    lines.push(t.organisation);
    if (tenantDecisions > 0) lines.push(`  - ${tenantDecisions} ${t.decisions}`);
    for (const blind of tenantBlindSpots) {
      lines.push(`  - ${t.couldNotRead} ${blind}`);
    }
    lines.push('');
  }

  for (const m of waiting) {
    lines.push(`${t.migration}: ${m.mappingId}`);
    if (m.pendingDecisions > 0) lines.push(`  - ${m.pendingDecisions} ${t.decisions}`);
    if (m.deletionsWaiting > 0) lines.push(`  - ${m.deletionsWaiting} ${t.deletions}`);
    if (m.movesWaiting > 0) lines.push(`  - ${m.movesWaiting} ${t.moves}`);
    if (m.failuresWaiting > 0) lines.push(`  - ${m.failuresWaiting} ${t.failures}`);
    if (m.readyForCutover) lines.push(`  - ${t.readyForCutover}`);
    if (m.autoApplied > 0) lines.push(`  - ${m.autoApplied} ${t.autoApplied}`);
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
  /**
   * Accept a certificate the system would otherwise reject — a self-signed one.
   *
   * EXISTS FOR ONE REASON (0043 T1): the integration harness's Stalwart binds
   * TLS listeners only and presents a self-signed certificate, so without this
   * there is no way to prove — against anything — that this product can send an
   * email at all. Before it, `smtp-transport.ts` was referenced by no test and
   * nodemailer was never even constructed by the suite.
   *
   * REFUSED IN PRODUCTION. `readNotifierConfig` turns the whole channel OFF, with
   * the reason named, when this is set and `NODE_ENV === 'production'`. A
   * migration tool that mails an owner about their data must not be talked into
   * trusting any certificate presented to it, and an escape hatch that exists for
   * tests is an escape hatch that exists — unless something stops it. Losing
   * notifications is the safer failure, and since 0043 T3 it is a visible one:
   * `/status` reports the channel as off, with this as the reason.
   */
  readonly allowSelfSignedCertificate?: boolean;
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
 * ---------------------------------------------------------------------------
 * Per-tenant preferences (workplan 0030 T4)
 * ---------------------------------------------------------------------------
 *
 * The appliance is one tenant and one `.env`, so `NOTIFY_DIGEST` IS its
 * preference. Managed is not: one operator's SMTP serves many tenants, and
 * how often a customer wants to hear from us is theirs to say, not ours.
 *
 * Stored in the existing `tenant.settings` JSON rather than a new column,
 * because that is what it is for and a migration for one enum would be a
 * schema change to undo later. Read defensively: this is JSON somebody could
 * have written by hand, and an unreadable preference must fall back to the
 * default rather than take the digest down.
 */
export interface TenantNotificationPrefs {
  /** How often the summary goes out. `off` keeps the ad hoc events. */
  readonly digest: DigestCadence | 'off';
  /** The language the tenant reads. */
  readonly locale: NotificationLocale;
}

export const DEFAULT_TENANT_NOTIFICATION_PREFS: TenantNotificationPrefs = {
  // On by default, and weekly rather than daily: a managed customer is not
  // watching the appliance's log, and one summary a week is the cadence
  // somebody keeps reading. They can ask for daily.
  digest: 'weekly',
  locale: 'en',
};

/** Read a tenant's preferences out of its settings JSON, whatever is in it. */
export function readTenantNotificationPrefs(settings: unknown): TenantNotificationPrefs {
  const box = (settings as { notifications?: unknown } | null | undefined)?.notifications;
  if (!box || typeof box !== 'object') return DEFAULT_TENANT_NOTIFICATION_PREFS;
  const raw = box as { digest?: unknown; locale?: unknown };
  const digest =
    raw.digest === 'daily' || raw.digest === 'weekly' || raw.digest === 'off'
      ? raw.digest
      : // Anything else — a typo, an older shape, a hand-edited row — takes
        // the default. Never silence: a value we cannot read must not be the
        // reason somebody stops hearing about their own migration.
        DEFAULT_TENANT_NOTIFICATION_PREFS.digest;
  const locale = raw.locale === 'nl' ? 'nl' : 'en';
  return { digest, locale };
}

/** Merge a preference change into a tenant's settings, touching nothing else. */
export function withTenantNotificationPrefs(
  settings: unknown,
  prefs: TenantNotificationPrefs,
): Record<string, unknown> {
  const base =
    settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {};
  // Spread rather than replace: `settings` is shared with everything else
  // that keeps tenant configuration there, and a preference edit that dropped
  // a neighbouring key would be a silent data loss.
  return { ...base, notifications: { digest: prefs.digest, locale: prefs.locale } };
}

/**
 * Is today this tenant's digest day?
 *
 * Managed runs ONE daily task and asks this per tenant, rather than a task per
 * cadence: cadences are a per-tenant preference there, and a job that had to
 * be rescheduled whenever a customer changed a dropdown would be a scheduler
 * built out of settings rows.
 *
 * `weekday` is `Date.getDay()` — 0 is Sunday. Monday for the weekly digest,
 * so a week's queue lands at the start of a working week rather than at the
 * end of one.
 */
export function digestDueToday(
  prefs: TenantNotificationPrefs,
  weekday: number,
): DigestCadence | undefined {
  if (prefs.digest === 'off') return undefined;
  if (prefs.digest === 'daily') return 'daily';
  return weekday === 1 ? 'weekly' : undefined;
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

  // Deliberately an exact string match, and deliberately not defaulted from
  // anything else: nothing should switch certificate checking off by accident.
  const allowSelfSigned = env.SMTP_ALLOW_SELF_SIGNED === 'true';
  if (allowSelfSigned && env.NODE_ENV === 'production') {
    return {
      enabled: false,
      reason:
        'SMTP_ALLOW_SELF_SIGNED is set and NODE_ENV is production. That switch exists so ' +
        'tests can reach a self-signed mail server, and accepting any certificate in ' +
        'production would let anything that can answer on the SMTP port read what is sent ' +
        'to it. Notifications are OFF until it is unset — unsetting it is the fix.',
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
      ...(allowSelfSigned ? { allowSelfSignedCertificate: true } : {}),
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
  | { readonly kind: 'migration_finished'; readonly mappingId: string }
  | {
      readonly kind: 'rollback_finished';
      readonly mappingId: string;
      /** Why the operator rolled back, in their own words — never reworded. */
      readonly reason: string;
    };

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
    rollback_finished: 'Open Migrate — the migration was rolled back',
  },
  nl: {
    decision_raised: 'Open Migrate — een wijziging vraagt uw beslissing',
    runs_failing: 'Open Migrate — een migratie blijft mislukken',
    verification_finished: 'Open Migrate — de controle is afgerond',
    migration_finished: 'Open Migrate — de migratie is afgerond',
    rollback_finished: 'Open Migrate — de migratie is teruggedraaid',
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
  readonly rolledBack: string;
  readonly rollbackReason: string;
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
    // Says what is true NOW, because that is the question somebody reading
    // this at 22:00 actually has: where is my mail arriving?
    rolledBack:
      'This migration was rolled back. The old system is authoritative again ' +
      'and syncing has resumed. If the MX record was changed, revert it by hand — ' +
      'this system does not change DNS.',
    rollbackReason: 'The reason given was:',
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
    rolledBack:
      'Deze migratie is teruggedraaid. Het oude systeem is weer leidend en de ' +
      'synchronisatie loopt weer. Is het MX-record gewijzigd, zet het dan handmatig ' +
      'terug — dit systeem wijzigt geen DNS.',
    rollbackReason: 'De opgegeven reden was:',
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
    case 'rollback_finished':
      lines.push(`${b.migration}: ${event.mappingId}`, '');
      lines.push(b.rolledBack, '');
      // The operator's own sentence, carried through untouched — the prose
      // boundary covers a human's words for the same reason it covers the
      // server's: whoever reads this needs what was actually said.
      lines.push(b.rollbackReason, event.reason);
      break;
  }

  lines.push('', b.act);
  return { subject, body: lines.join('\n') };
}
