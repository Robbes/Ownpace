// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * ONE state vocabulary, one chip (workplan 0035 T1).
 *
 * Before this component the same underlying facts rendered as four dialects:
 * RunsPanel said "Succeeded" where the live strip said "Completed" for the
 * same idea, and the lifecycle words (`active`/`paused`/`cutover`/`done`)
 * leaked RAW — untranslated enum values in the gray corners of QueueScreen,
 * Confirm, and the hub, and `{invoice.status}` verbatim on Billing. The
 * canonical table below is the whole fix: one word per state per entity, in
 * BOTH languages (the dictionary's `state.*`, `runs.status.*`,
 * `confirm.state.*`, `decisionStatus.*` families), one colour per state, and
 * the text is always the signal — colour never carries meaning alone.
 *
 * ## The prose boundary (the rule, written down — ADR-0024)
 *
 * Two kinds of words render on these screens, and only one belongs here:
 *
 * - **Client states** — enum values the CLIENT chooses how to present:
 *   mapping lifecycle, domain pass state, run status, decision status,
 *   invoice status. These are translated and unified, and they render
 *   through this component. Different entities MAY keep different words
 *   (run `success` → "Succeeded", domain `completed` → "Completed"); what
 *   is banned is same-entity drift and unchosen raw enums.
 * - **Server vocabulary** — verification statuses (`PASS`/`FAIL`), evidence
 *   words (`reported`/`trashed`/`inferred`), refusal/effect prose, error
 *   text. These are the server's own claims and render VERBATIM, never
 *   through this component and never translated. If you are about to add a
 *   PASS entry to the table below, stop — that word is a finding, not a
 *   state.
 *
 * Each call site names its entity, which types the accepted states — a
 * server-vocabulary word does not compile.
 */
import React from 'react';
import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/index.tsx';

type Tone = 'gray' | 'muted' | 'blue' | 'green' | 'emerald' | 'yellow' | 'red' | 'void';

const TONE_CLASS: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700',
  muted: 'bg-gray-100 text-gray-500',
  blue: 'bg-blue-100 text-blue-800',
  green: 'bg-green-100 text-green-800',
  emerald: 'bg-emerald-100 text-emerald-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  red: 'bg-red-100 text-red-800',
  void: 'bg-gray-100 text-gray-500 line-through',
};

/** The canonical state table — EN and NL columns live in the dictionary
 *  under the keys named here. Exported for the vocabulary tests. */
export const STATE_TABLE = {
  /** mailbox_mapping lifecycle (the DB CHECK's four words). */
  lifecycle: {
    active: { key: 'state.lifecycle.active', tone: 'green' },
    paused: { key: 'state.lifecycle.paused', tone: 'yellow' },
    cutover: { key: 'state.lifecycle.cutover', tone: 'blue' },
    done: { key: 'state.lifecycle.done', tone: 'emerald' },
  },
  /** Per-domain pass state (migration_status.state). */
  domain: {
    pending: { key: 'confirm.state.pending', tone: 'gray' },
    in_progress: { key: 'confirm.state.in_progress', tone: 'blue' },
    completed: { key: 'confirm.state.completed', tone: 'green' },
    failed: { key: 'confirm.state.failed', tone: 'red' },
    skipped: { key: 'confirm.state.skipped', tone: 'muted' },
  },
  /** Run status (RunReport.status). `success` keeps "Succeeded". */
  run: {
    pending: { key: 'runs.status.pending', tone: 'gray' },
    running: { key: 'runs.status.running', tone: 'blue' },
    success: { key: 'runs.status.success', tone: 'green' },
    failed: { key: 'runs.status.failed', tone: 'red' },
    cancelled: { key: 'runs.status.cancelled', tone: 'muted' },
  },
  /** §11.1 decision status. Dismissed is set-aside, not rejected — gray,
   *  not the green the old hand-rolled chip gave every answered state. */
  decision: {
    resolved: { key: 'decisionStatus.resolved', tone: 'green' },
    auto_resolved: { key: 'decisionStatus.auto_resolved', tone: 'green' },
    dismissed: { key: 'decisionStatus.dismissed', tone: 'muted' },
  },
  /** Invoice status (the DB enum — Mollie's words, workplan 0039).
   *  Overdue is the one demanding action. */
  invoice: {
    draft: { key: 'state.invoice.draft', tone: 'gray' },
    sent: { key: 'state.invoice.sent', tone: 'blue' },
    paid: { key: 'state.invoice.paid', tone: 'green' },
    overdue: { key: 'state.invoice.overdue', tone: 'red' },
    void: { key: 'state.invoice.void', tone: 'void' },
  },
} as const satisfies Record<string, Record<string, { key: StringKey; tone: Tone }>>;

export type StateEntity = keyof typeof STATE_TABLE;
export type StateOf<E extends StateEntity> = keyof (typeof STATE_TABLE)[E] & string;

function StateChip<E extends StateEntity>({
  entity,
  state,
}: {
  entity: E;
  state: StateOf<E>;
}): React.ReactElement {
  const t = useT();
  const entry = (STATE_TABLE[entity] as Record<string, { key: StringKey; tone: Tone }>)[state];
  if (!entry) {
    // Defensive only — the types make this unreachable from checked call
    // sites. An unknown value renders raw and neutral rather than crashing
    // a screen over a word (hard rule 9's spirit: show what arrived).
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TONE_CLASS.gray}`}>
        {state}
      </span>
    );
  }
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TONE_CLASS[entry.tone]}`}
    >
      {t(entry.key)}
    </span>
  );
}

export default StateChip;
