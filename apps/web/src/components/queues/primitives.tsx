// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Shared pieces for the three decision-queue screens (ADR-0026).
 *
 * The queues differ in what they list and what can be done about each item, but
 * they are the same kind of screen: a per-mapping list of things waiting on a
 * person, with what it means and what can be done about it. Kept together so
 * the three cannot drift into three different idioms for the same idea.
 */

import React from 'react';
import { AlertCircle, AlertTriangle, Check, Info, Loader2, Trash2 } from 'lucide-react';
import {
  queueGuidance,
  type ApplyReceipt,
  type DeletionEvidence,
  type GuidedQueue,
  type MappingLifecycle,
} from '@openmig/shared';
import { useLocale, useT } from '../../i18n/index.tsx';
import type { StringKey } from '../../i18n/index.tsx';

// Client-authored strings here go through the dictionary (workplan 0024 T2);
// SERVER prose (refusal reasons, effects) renders verbatim as ever —
// translating it is drift (rule 2/ADR-0026). The queues' guidance is the
// customer's version from @openmig/shared, in both languages (the owner,
// 2026-10-18); the operator's stays on the API.

const DOMAIN_KEY: Record<string, StringKey> = {
  email: 'domain.email',
  calendar: 'domain.calendar',
  contact: 'domain.contact',
  file: 'domain.file',
  task: 'domain.task',
};

export const DomainTag: React.FC<{ domain: string }> = ({ domain }) => {
  const t = useT();
  const key = DOMAIN_KEY[domain];
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
      {key ? t(key) : domain}
    </span>
  );
};

/**
 * The natural-key hash, shortened, and folded under *ID* (0154 T6).
 *
 * Shortened for reading, never for use: the full value is the handle every
 * action posts, and it stays in the `title` so an operator can copy it into a
 * ticket. §17 is why this is what identifies an item on screen at all — the
 * natural key itself is a Message-ID, an iCal UID or a file path.
 *
 * Folded because nobody recognises an item by twelve hex digits: the row
 * says what it is and where, and the digits are for a support ticket.
 */
export const HashChip: React.FC<{ hash: string }> = ({ hash }) => {
  const t = useT();
  return (
    <details className="text-xs text-gray-500">
      {/* Padded to a target a finger can hit (at least 24 px tall); the
          negative margin keeps the word where it was. Left a list item, the
          display that draws the fold's triangle: inline-block hid it. */}
      <summary className="cursor-pointer select-none py-1 px-1 -mx-1">{t('queue.itemId')}</summary>
      <code className="font-mono" title={hash}>
        {hash.slice(0, 12)}
      </code>
    </details>
  );
};

/**
 * How we know an item is gone — the field ADR-0024 says to read first.
 *
 * Coloured by what it LICENSES, not by severity: the two positive kinds share
 * one treatment because they are believed on sight and may be acted on, and
 * `inferred` gets a visibly different one because it may not, however long it
 * has been missing. Someone scanning this list should be able to see which
 * items could ever have an apply button without reading a word.
 *
 * THE WORD IS THE CLIENT'S, THE TOKEN STAYS IN THE TITLE (the owner,
 * 2026-10-18). The chip said the server's token, *reported*, *trashed* or
 * *inferred*, in English on a Dutch screen. It says the client's word now,
 * and the token closes the title, the way a refused receipt's code follows its
 * reason (`ReceiptStatus`), so a support thread can still quote it. The API
 * and its downloads keep the token.
 */
const EVIDENCE_WORDS: Record<DeletionEvidence, { word: StringKey; title: StringKey }> = {
  reported: { word: 'evidence.reported', title: 'evidence.reported.title' },
  trashed: { word: 'evidence.trashed', title: 'evidence.trashed.title' },
  inferred: { word: 'evidence.inferred', title: 'evidence.inferred.title' },
};

export const EvidenceBadge: React.FC<{ evidence: DeletionEvidence }> = ({ evidence }) => {
  const t = useT();
  const style =
    evidence === 'inferred'
      ? 'bg-amber-50 text-amber-800 border-amber-200'
      : 'bg-emerald-50 text-emerald-800 border-emerald-200';
  const words = EVIDENCE_WORDS[evidence];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${style}`}
      title={`${t(words.title)} (${evidence})`}
    >
      {t(words.word)}
    </span>
  );
};

/** Shown above a finished migration's queues, in place of nagging. */
export const ClosedBanner: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-gray-100 text-gray-700 text-sm">
    <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
    <span>{text}</span>
  </div>
);

/**
 * What a queue means and what can be done about it, in the reader's language.
 *
 * It showed the server's `whatThisMeans` and `howToResolve` verbatim, which
 * are the operator's: `POST /mappings/{mappingId}/moves/…/keep` and
 * `toNaturalKeyHash`, in English under a Dutch heading (the UX sweep,
 * 2026-10-17). The owner chose words for the person reading it (2026-10-18):
 * they live in `@openmig/shared` (`queue-guidance.ts`), English and Dutch
 * beside each other, the way `APPLY_FLAG_WARNING_NL` does, and this only
 * PICKS the language, never rephrases. The API keeps serving the operator's.
 *
 * Each option is said as one line, the button's name and then what it does,
 * so the reader finds the button the sentence is about.
 */
export const GuidancePanel: React.FC<{ queue: GuidedQueue }> = ({ queue }) => {
  const { locale, t } = useLocale();
  const guidance = queueGuidance(queue, locale);
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
        {t('guidance.summary')}
      </summary>
      <div className="mt-2 p-4 rounded-lg bg-gray-50 space-y-2">
        {guidance.meaning && <p className="text-gray-800">{guidance.meaning}</p>}
        <dl className="space-y-2">
          {guidance.options.map((option) => (
            <div key={option.label}>
              <dt className="inline font-medium text-gray-900">{option.label}:</dt>{' '}
              <dd className="inline text-gray-700">{option.text}</dd>
            </div>
          ))}
        </dl>
        {guidance.closing && <p className="text-gray-700">{guidance.closing}</p>}
      </div>
    </details>
  );
};

/**
 * A path that breaks at its slashes on a narrow screen.
 *
 * Each part stays a text node directly under the caller's element, so the
 * path still reads, and is still found, as one text (`INBOX/Projects`); the
 * `<wbr>` after each slash only says where a line may end.
 */
export const PathText: React.FC<{ path: string }> = ({ path }) => (
  <>
    {path.split('/').map((part, i) => (
      <React.Fragment key={i}>
        {i > 0 && (
          <>
            /<wbr />
          </>
        )}
        {part}
      </React.Fragment>
    ))}
  </>
);

export const QueueSection: React.FC<{
  title: string;
  count: number;
  /** Shown when the section is empty, instead of an empty list. */
  empty: string;
  /**
   * What is said above the rows: a hint, a line explaining them, a button for
   * all of them. Never inside the list, which holds its rows only (axe
   * 'list'), and only when there are rows to say it about.
   */
  lead?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, count, empty, lead, children }) => (
  <div className="mb-6">
    <h4 className="text-sm font-semibold text-gray-900 mb-2">
      {title} <span className="text-gray-500 font-normal">({count})</span>
    </h4>
    {count > 0 && lead !== undefined && <div className="mb-2">{lead}</div>}
    {count === 0 ? (
      <p className="text-sm text-gray-500">{empty}</p>
    ) : (
      <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">{children}</ul>
    )}
  </div>
);

export const ItemRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">{children}</li>
);

export const ActionButton: React.FC<{
  onClick: () => void;
  pending?: boolean;
  title?: string;
  children: React.ReactNode;
}> = ({ onClick, pending, title, children }) => (
  <button
    onClick={onClick}
    disabled={pending}
    title={title}
    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
  >
    {pending && <Loader2 className="w-3 h-3 animate-spin" />}
    {children}
  </button>
);

/**
 * The apply button, which is not like the others.
 *
 * Two-step by construction: the first click arms it and the second does it.
 * Not a modal, because a modal trains people to click through — this makes the
 * consequence appear only after somebody has already chosen once, in the place
 * their cursor already is, and it disarms itself if they walk away.
 *
 * THE ARMING AND THE DRESSING ARE DIFFERENT QUESTIONS, and conflating them
 * put a red button with a **trash can on it** under "create a share" — which
 * the owner read, correctly, as a delete. The ceremony is owed by anything
 * hard to take back; the red and the bin are owed only by what destroys. A
 * share is outward-facing and cannot be unsent, so it keeps the two presses
 * and loses the funeral.
 *
 * `tone` picks the dressing, `icon` the glyph. `DestructiveButton` below is
 * the destructive preset, so every caller that really does destroy something
 * reads exactly as it did.
 */
export const ConfirmButton: React.FC<{
  onClick: () => void;
  pending?: boolean;
  label: string;
  armedLabel: string;
  tone?: 'destructive' | 'outward';
  icon?: React.ReactNode;
}> = ({ onClick, pending, label, armedLabel, tone = 'destructive', icon }) => {
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const dressing =
    tone === 'destructive'
      ? armed
        ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
        : 'border-red-300 text-red-700 hover:bg-red-50'
      : armed
        ? 'border-sky-700 bg-sky-700 text-white hover:bg-sky-800'
        : 'border-sky-300 text-sky-800 hover:bg-sky-50';

  return (
    <button
      onClick={() => (armed ? onClick() : setArmed(true))}
      onBlur={() => setArmed(false)}
      disabled={pending}
      className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded border disabled:opacity-50 ${dressing}`}
    >
      {pending ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        (icon ?? <Trash2 className="w-3 h-3" />)
      )}
      {armed ? armedLabel : label}
    </button>
  );
};

/** The destructive preset: red, a bin, and two presses. */
export const DestructiveButton: React.FC<{
  onClick: () => void;
  pending?: boolean;
  label: string;
  armedLabel: string;
}> = (props) => <ConfirmButton {...props} tone="destructive" />;

/**
 * Why some rows of a queue have no remove button (2026-10-05): their data type
 * is past its cutover, the old system no longer decides what exists, and the
 * server refuses such an apply (`after_cutover`). Said once, above the rows,
 * naming only the data types of rows that would otherwise have offered one
 * (`withheld`), so a migration past its cutover with nothing waiting says
 * nothing; the rows themselves simply offer none, as an inferred deletion
 * offers none. The owner, asked whether such a press should be refused:
 * "Refuse after cutover (Recommended)".
 */
export const AfterCutoverNote: React.FC<{ withheld: readonly { domain: string }[] }> = ({ withheld }) => {
  const t = useT();
  const dataTypes = [...new Set(withheld.map((row) => row.domain))];
  if (dataTypes.length === 0) return null;
  const named = dataTypes.map((domain) => {
    const key = DOMAIN_KEY[domain];
    return key ? t(key) : domain;
  });
  return <p className="mb-3 text-sm text-gray-600">{t('queue.afterCutover', { dataTypes: named.join(', ') })}</p>;
};

/** A decision that went through, shown where the buttons were. */
export const Resolved: React.FC<{ effect: string }> = ({ effect }) => (
  <span className="inline-flex items-start gap-1 text-xs text-emerald-700">
    <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
    {effect}
  </span>
);

/**
 * A refusal, shown where the buttons were.
 *
 * Amber rather than red, and kept alongside the item rather than raised as an
 * error: the gates refusing is the product working correctly, and the operator
 * needs to read why, not be told something broke.
 */
export const Refused: React.FC<{ text: string }> = ({ text }) => (
  <span className="inline-flex items-start gap-1 text-xs text-amber-800">
    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
    {text}
  </span>
);

/**
 * A job failure, which is NOT a refusal (workplan 0019 T2, hard rule 9).
 *
 * `Refused` is amber and carries the gates' own words — the product working.
 * This is red and carries the error, because the removal job CRASHED and
 * nobody knows the item's fate until someone looks. Softening one into the
 * other would either dress a failure up as an answer or bury an answer in an
 * error style nobody reads calmly.
 */
export const JobFailed: React.FC<{ error: string }> = ({ error }) => {
  const t = useT();
  return (
    <span className="inline-flex items-start gap-1 text-xs text-red-700">
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      {t('receipt.failedPrefix')} {error}
    </span>
  );
};

/**
 * One apply receipt's lifecycle, rendered without softening (workplan 0019 T2).
 *
 * The managed edition's "apply" is queued → terminal, and every terminal state
 * keeps its own character: `applied` says how final the removal was (`binned`
 * targets may still hold a copy — reported, never inferred), `refused` renders
 * the gates' code and prose verbatim, `failed` is a failure with its reason.
 */
export const ReceiptStatus: React.FC<{ receipt: ApplyReceipt }> = ({ receipt }) => {
  const t = useT();
  switch (receipt.state) {
    case 'queued':
    case 'none':
      return (
        <span className="inline-flex items-start gap-1 text-xs text-gray-600">
          <Loader2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 animate-spin" />
          {t('receipt.queued')}
        </span>
      );
    case 'applied':
      return (
        <Resolved
          effect={
            receipt.kind === 'binned'
              ? t('receipt.applied.binned')
              : receipt.kind === 'deleted'
                ? t('receipt.applied.deleted')
                : t('receipt.applied.unknown')
          }
        />
      );
    // Refusals render the gates' code + prose VERBATIM (rule 2) — no t().
    case 'refused':
      return <Refused text={`${receipt.reason} (${receipt.code})`} />;
    case 'failed':
      return <JobFailed error={receipt.error} />;
  }
};

/** Dictionary keys for the lifecycle note (only `paused` has one today).
 *
 *  `continuous` has none for the same reason `active` has none: its queues are
 *  LIVE. The note exists to explain a queue that is empty because nothing has
 *  been copied yet (`paused`); a lane that keeps copying after cutover has
 *  ordinary queues and needs no apology for them. */
export const LIFECYCLE_NOTE_KEY: Record<MappingLifecycle, StringKey | undefined> = {
  paused: 'lifecycle.paused',
  active: undefined,
  cutover: undefined,
  done: undefined,
  continuous: undefined,
};
