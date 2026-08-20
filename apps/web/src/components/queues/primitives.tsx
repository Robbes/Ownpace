// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Shared pieces for the three decision-queue screens (ADR-0026).
 *
 * The queues differ in what they list and what can be done about each item, but
 * they are the same kind of screen: a per-mapping list of things waiting on a
 * person, with the guidance the server sent alongside it. Kept together so the
 * three cannot drift into three different idioms for the same idea.
 */

import React from 'react';
import { AlertCircle, AlertTriangle, Check, Info, Loader2, Trash2 } from 'lucide-react';
import type { ApplyReceipt, DeletionEvidence, MappingLifecycle } from '@openmig/shared';
import { useT } from '../../i18n/index.tsx';
import type { StringKey } from '../../i18n/index.tsx';

// Client-authored strings here go through the dictionary (workplan 0024 T2);
// SERVER prose (guidance entries, refusal reasons, whatThisMeans) renders
// verbatim as ever — translating it is drift (rule 2/ADR-0026).

const DOMAIN_KEY: Record<string, StringKey> = {
  email: 'domain.email',
  calendar: 'domain.calendar',
  contact: 'domain.contact',
  file: 'domain.file',
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
 * The natural-key hash, shortened.
 *
 * Shortened for reading, never for use: the full value is the handle every
 * action posts, and it stays in the `title` so an operator can copy it into a
 * ticket. §17 is why this is what identifies an item on screen at all — the
 * natural key itself is a Message-ID, an iCal UID or a file path.
 */
export const HashChip: React.FC<{ hash: string }> = ({ hash }) => (
  <code className="text-xs font-mono text-gray-500" title={hash}>
    {hash.slice(0, 12)}
  </code>
);

/**
 * How we know an item is gone — the field ADR-0024 says to read first.
 *
 * Coloured by what it LICENSES, not by severity: the two positive kinds share
 * one treatment because they are believed on sight and may be acted on, and
 * `inferred` gets a visibly different one because it may not, however long it
 * has been missing. Someone scanning this list should be able to see which
 * items could ever have an apply button without reading a word.
 */
export const EvidenceBadge: React.FC<{ evidence: DeletionEvidence }> = ({ evidence }) => {
  const t = useT();
  const style =
    evidence === 'inferred'
      ? 'bg-amber-50 text-amber-800 border-amber-200'
      : 'bg-emerald-50 text-emerald-800 border-emerald-200';
  // The badge TEXT stays the server's own evidence word (the operating
  // vocabulary the docs and receipts use); the explanatory title is client
  // prose and translates.
  const title =
    evidence === 'reported'
      ? t('evidence.reported.title')
      : evidence === 'trashed'
        ? t('evidence.trashed.title')
        : t('evidence.inferred.title');
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${style}`}
      title={title}
    >
      {evidence}
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
 * The server's own guidance, rendered verbatim.
 *
 * Deliberately not paraphrased. These strings are the operating semantics
 * (ADR-0026) and the UI's job is to put them in front of somebody, not to
 * improve them — a screen that summarised "refused for inferred evidence" into
 * "not available" would delete the reason, which is the part that matters.
 */
export const GuidancePanel: React.FC<{
  entries: Readonly<Record<string, string>>;
  meaning?: string;
}> = ({ entries, meaning }) => {
  const t = useT();
  return (
  <details className="mt-4 text-sm">
    <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
      {t('guidance.summary')}
    </summary>
    <div className="mt-2 p-4 rounded-lg bg-gray-50 space-y-2">
      {meaning && <p className="text-gray-800">{meaning}</p>}
      <dl className="space-y-2">
        {Object.entries(entries).map(([k, v]) => (
          <div key={k}>
            <dt className="font-medium text-gray-900">{k}</dt>
            <dd className="text-gray-700">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  </details>
  );
};

export const QueueSection: React.FC<{
  title: string;
  count: number;
  /** Shown when the section is empty, instead of an empty list. */
  empty: string;
  children: React.ReactNode;
}> = ({ title, count, empty, children }) => (
  <div className="mb-6">
    <h4 className="text-sm font-semibold text-gray-900 mb-2">
      {title} <span className="text-gray-500 font-normal">({count})</span>
    </h4>
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
 * destructive word appear only after somebody has already chosen once, in the
 * place their cursor already is, and it disarms itself if they walk away.
 */
export const DestructiveButton: React.FC<{
  onClick: () => void;
  pending?: boolean;
  label: string;
  armedLabel: string;
}> = ({ onClick, pending, label, armedLabel }) => {
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      onClick={() => (armed ? onClick() : setArmed(true))}
      onBlur={() => setArmed(false)}
      disabled={pending}
      className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded border disabled:opacity-50 ${
        armed
          ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
          : 'border-red-300 text-red-700 hover:bg-red-50'
      }`}
    >
      {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
      {armed ? armedLabel : label}
    </button>
  );
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

/** Dictionary keys for the lifecycle note (only `paused` has one today). */
export const LIFECYCLE_NOTE_KEY: Record<MappingLifecycle, StringKey | undefined> = {
  paused: 'lifecycle.paused',
  active: undefined,
  cutover: undefined,
  done: undefined,
};
