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
