// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *Delete all of these here too* (workplan 0164 T3; ADR-0024, amended
 * 2026-11-21: "per item" reads as "each item decided by itself").
 *
 * One press for the rows on *Deleted on the old system* that have a delete
 * button of their own, and nothing else. It is the single button pressed for
 * each of them in turn, through the same call, `applyDeletion` in the
 * operating service, so every gate the server holds is in front of every
 * item, and the server cannot tell a row of a run from a row pressed by
 * hand: the appliance answers each press itself; on managed each one gets
 * its own receipt and its own record of who ordered it, and its own job.
 *
 * WHERE THE LOOP LIVES, AND WHY HERE. In the page (`applyEachInTurn`). The
 * next row is pressed only once the one before it has answered: the
 * appliance's answer, or a managed receipt read until it is applied, refused
 * or failed. That is what lets the breaker's rule hold for a refusal that
 * lands on a receipt too. A press that does not answer (a fault, a time-out,
 * a receipt that failed or does not land in `RECEIPT_DEADLINE_MS`) stops the
 * run: its removal may still be running, and a next press beside it could
 * pass a refusal it never got to say. So one removal at a time reaches the
 * new system, as a person pressing would, and a page closed mid-run orders
 * nothing more. What was ordered finishes where it runs.
 *
 * OFFERED ONLY WHERE A SINGLE DELETE IS, AND ONLY WHILE IT CAN GO THROUGH:
 * deleting by hand on (read as the panel above reads it; a row's own button
 * shows while it is off, and the server refuses it), and a row counts only
 * while `mayOfferApply` offers its own button, so never an assumed one, and
 * never one of a data type past its cutover. Two at least: one row says it
 * better with its own button.
 *
 * ONE CONFIRMATION, A CONTROL OF ITS OWN. The button opens a confirmation
 * that names how many, over the rows as they were when it opened (the set is
 * frozen then). Its *Cancel* takes the focus and sits where the button was,
 * and its *Delete N* ignores the second click of a double click and any click
 * within `CONFIRM_GUARD_MS` of opening, so a double click cannot pass it.
 * Nothing is ordered unless the page's rows at the confirming press, and the
 * list read again from the server, are both that frozen set. What is ordered
 * is never more than the rows the confirmation counted.
 *
 * A REFUSAL IS A GATE'S, OR IT IS NOT A REFUSAL. A 403 or 404 with a code
 * the destructive path refuses with (`APPLY_REFUSAL_CODES`), or the 500
 * `removed_not_recorded`, is a gate's answer. Anything else (a fault, a hold,
 * a 502, an unknown code) is a press that did not answer: not known.
 *
 * AFTERWARDS IT SAYS WHAT HAPPENED, in the reader's language, in three
 * groups: deleted, not deleted, and not known. The why is said from the
 * refusal's stable code, and the server's own sentence with its code stays
 * beside it, verbatim, under *Technical details* (docs/i18n-prose-boundary.md,
 * class 2).
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Check, Loader2, Square, Trash2 } from 'lucide-react';
import {
  APPLY_REFUSAL_CODES,
  applyEachInTurn,
  type ApplyEachItem,
  type ApplyEachResult,
  type ApplyReceipt,
  type DecisionEffectFields,
  type ItemDeletion,
  type NotTried,
} from '@openmig/shared';
import { useLocale, useT, type StringKey } from '../../i18n/index.tsx';
import {
  applyDeletion,
  DecisionRefusedError,
  fetchApplyDeletionsFlag,
  fetchApplyReceipt,
  type ApplyOutcome,
} from '../../services/operating-service.ts';
import { serverMessage } from '../../services/api.ts';
import type { ItemOutcome } from './QueueScreen.tsx';
import { ServedEffect, servedOf } from './primitives.tsx';

/** How long a managed receipt may stay queued before its row is not known, and the run stops. */
export const RECEIPT_DEADLINE_MS = 5 * 60_000;

/** A confirming click this soon after the confirmation opened is the end of a double click, not a decision. */
export const CONFIRM_GUARD_MS = 800;

/** What one press answered, read to its end. A press that did not answer is thrown, and becomes `failed`. */
export type DeleteAllAnswer =
  | {
      readonly ok: true;
      /** The appliance's own line about the removal, in both languages. */
      readonly served?: Partial<DecisionEffectFields>;
      /** A managed receipt's word for how final it was. */
      readonly kind?: string;
    }
  | { readonly ok: false; readonly code: string; readonly reason: string };

type RunResult = ApplyEachResult<DeleteAllAnswer>;

type Run =
  | { readonly phase: 'reading' }
  | { readonly phase: 'changed'; readonly count: number }
  | { readonly phase: 'unreadable'; readonly error: string }
  | {
      readonly phase: 'running' | 'done';
      readonly rows: readonly ItemDeletion[];
      readonly results: Readonly<Record<string, RunResult>>;
      readonly stopping: boolean;
      /** The receipt being read could not be, this many times in a row. */
      readonly pollTrouble?: { readonly count: number; readonly error: string };
    };

/** The confirmation, open: the rows as they were when it opened, and when that was. */
interface Armed {
  readonly rows: readonly ItemDeletion[];
  readonly at: number;
}

const KNOWN_REFUSALS: ReadonlySet<string> = new Set(APPLY_REFUSAL_CODES);

/** Refusals that mean the copy is gone all the same: someone else's removal, or one the ledger did not record. */
const GONE_ALL_THE_SAME: ReadonlySet<string> = new Set(['already_applied', 'removed_not_recorded']);

/** Each refusal code a deletion's press can answer, in the reader's words. */
const REFUSED: Readonly<Record<string, StringKey>> = {
  not_enabled: 'deletions.refused.notEnabled',
  target_cannot_remove: 'deletions.refused.targetCannotRemove',
  not_found: 'deletions.refused.notFound',
  not_confirmed: 'deletions.refused.notConfirmed',
  weak_evidence: 'deletions.refused.weakEvidence',
  not_ours: 'deletions.refused.notOurs',
  already_applied: 'deletions.refused.alreadyApplied',
  already_kept: 'deletions.refused.alreadyKept',
  after_cutover: 'deletions.refused.afterCutover',
  edited_on_target: 'deletions.refused.editedOnTarget',
  version_unknown: 'deletions.refused.versionUnknown',
  kept_for_guests: 'deletions.refused.keptForGuests',
  mass_deletion_suspected: 'deletions.refused.massDeletionSuspected',
  removed_not_recorded: 'deletions.refused.removedNotRecorded',
};

const isTerminal = (r: ApplyReceipt): boolean =>
  r.state === 'applied' || r.state === 'refused' || r.state === 'failed';

/**
 * A gate's refusal, as this page counts one: a 403 or 404 whose code the
 * destructive path refuses with, or the 500 `removed_not_recorded`. Undefined
 * for everything else a press can throw, which is a fault, not an answer.
 */
export function refusalOf(err: unknown): { readonly code: string; readonly reason: string } | undefined {
  if (!(err instanceof DecisionRefusedError)) return undefined;
  const code = err.refusal.error;
  const reason = err.refusal.reason ?? err.refusal.hint ?? code;
  if ((err.httpStatus === 403 || err.httpStatus === 404) && KNOWN_REFUSALS.has(code)) return { code, reason };
  if (err.httpStatus === 500 && code === 'removed_not_recorded') return { code, reason };
  return undefined;
}

/** What a press that did not answer said, as served, with its status where it had one. */
function faultOf(err: unknown, fallback: string): string {
  if (err instanceof DecisionRefusedError) {
    const said = err.refusal as { error: string; reason?: string; hint?: string; message?: unknown };
    const words = said.reason ?? said.hint ?? (typeof said.message === 'string' ? said.message : undefined);
    return `${words !== undefined ? `${words} ` : ''}(${said.error}, HTTP ${err.httpStatus})`;
  }
  return err instanceof Error ? serverMessage(err) : fallback;
}

type Group = 'deleted' | 'notDeleted' | 'unknown';

/** Which of the three a row's result belongs to. */
function groupOf(result: RunResult): Group {
  if ('failed' in result) return 'unknown';
  if ('notTried' in result) return 'notDeleted';
  if (result.answered.ok) return 'deleted';
  return GONE_ALL_THE_SAME.has(result.answered.code) ? 'deleted' : 'notDeleted';
}

/** The same rows, by their handles, whatever their order. */
function sameRows(a: readonly ItemDeletion[], b: readonly ItemDeletion[]): boolean {
  if (a.length !== b.length) return false;
  const inB = new Set(b.map((d) => d.naturalKeyHash));
  return a.every((d) => inB.has(d.naturalKeyHash));
}

/** What stopped a run, in the summary's words. */
function stoppedKey(by: NotTried): StringKey {
  if (by.by === 'stop') return 'deletions.all.stoppedBy.stop';
  if (by.by === 'failure') return 'deletions.all.stoppedBy.failure';
  return by.code === 'not_enabled' ? 'deletions.all.stoppedBy.notEnabled' : 'deletions.all.stoppedBy.breaker';
}

export const DeleteAllPanel: React.FC<{
  mappingId: string;
  /**
   * The rows this press would order: waiting on you, each offered its own
   * delete button (`mayOfferApply`), none decided on this page yet.
   */
  rows: readonly ItemDeletion[];
  /** The same rows, read again from the server at the press. */
  readAgain: () => Promise<readonly ItemDeletion[]>;
  setOutcome: (hash: string, outcome: ItemOutcome | undefined) => void;
  /** Re-read the queue from the server. */
  refresh: () => void;
  receiptPollMs: number;
  /** Test seam: how long a receipt may stay queued. Production uses `RECEIPT_DEADLINE_MS`. */
  receiptDeadlineMs?: number;
  /** Test seam: the confirmation's guard. Production uses `CONFIRM_GUARD_MS`. */
  confirmGuardMs?: number;
  /** What a row is called, as its row says it. */
  nameOf: (row: ItemDeletion) => React.ReactNode;
}> = ({
  mappingId,
  rows,
  readAgain,
  setOutcome,
  refresh,
  receiptPollMs,
  receiptDeadlineMs = RECEIPT_DEADLINE_MS,
  confirmGuardMs = CONFIRM_GUARD_MS,
  nameOf,
}) => {
  const t = useT();
  const { locale } = useLocale();
  const [armed, setArmed] = React.useState<Armed | undefined>(undefined);
  const [run, setRun] = React.useState<Run | undefined>(undefined);
  const busy = React.useRef(false);
  const stop = React.useRef(false);
  const gone = React.useRef(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const stopRef = React.useRef<HTMLButtonElement>(null);
  const statusRef = React.useRef<HTMLParagraphElement>(null);
  const questionId = React.useId();
  const leadId = React.useId();

  React.useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);

  // Gate 1, read as the panel above reads it (same key, one request): no
  // press for all of them where the single press would be refused.
  const flag = useQuery({
    queryKey: ['apply-deletions-flag', mappingId],
    queryFn: () => fetchApplyDeletionsFlag(mappingId),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const deletingByHand = flag.data?.allowApplyDeletions === true;

  // Focus follows the run: Cancel when the confirmation opens, Stop while it
  // runs, the summary when it ends.
  React.useEffect(() => {
    if (armed) cancelRef.current?.focus();
  }, [armed]);
  const phase = run?.phase;
  React.useEffect(() => {
    if (phase === 'running') stopRef.current?.focus();
    if (phase === 'done') statusRef.current?.focus();
  }, [phase]);

  /** A managed receipt, read to its end, within `receiptDeadlineMs`. A missed read is said and read again. */
  const settle = async (hash: string, first: ApplyReceipt): Promise<ApplyReceipt> => {
    const deadline = Date.now() + receiptDeadlineMs;
    let receipt = first;
    let misses = 0;
    setOutcome(hash, { state: 'receipt', receipt });
    while (!isTerminal(receipt)) {
      await new Promise((resolve) => setTimeout(resolve, receiptPollMs));
      if (gone.current) throw new Error('The page closed before this removal was answered.');
      if (Date.now() > deadline) {
        const late = t('deletions.all.late', { minutes: String(Math.round(receiptDeadlineMs / 60_000)) });
        setOutcome(hash, { state: 'unknown', text: late });
        throw new Error(late);
      }
      try {
        receipt = await fetchApplyReceipt(mappingId, hash);
      } catch (err) {
        misses += 1;
        const error = err instanceof Error ? serverMessage(err) : t('common.requestFailed');
        setRun((current) =>
          current?.phase === 'running' ? { ...current, pollTrouble: { count: misses, error } } : current,
        );
        continue;
      }
      if (misses > 0) {
        misses = 0;
        setRun((current) => {
          if (current?.phase !== 'running') return current;
          const { pollTrouble: _cleared, ...rest } = current;
          return rest;
        });
      }
      setOutcome(hash, { state: 'receipt', receipt });
    }
    return receipt;
  };

  /** One row's own press, read to its end: exactly what its own button does. */
  const applyOne = async (item: ApplyEachItem): Promise<DeleteAllAnswer> => {
    const hash = item.naturalKeyHash;
    setOutcome(hash, { state: 'pending' });
    let outcome: ApplyOutcome | undefined;
    // What a press that did not answer said: the run records it as that
    // row's failure, never as a refusal.
    let fault: string | undefined;
    try {
      outcome = await applyDeletion(mappingId, hash);
    } catch (err) {
      const refusal = refusalOf(err);
      if (refusal) {
        setOutcome(hash, { state: 'refused', text: refusal.reason });
        return { ok: false, ...refusal };
      }
      fault = faultOf(err, t('common.requestFailed'));
      setOutcome(hash, { state: 'unknown', text: fault });
    }
    if (outcome === undefined) throw new Error(fault ?? t('common.requestFailed'));
    if (outcome.mode === 'immediate') {
      const served = servedOf(outcome.result);
      setOutcome(hash, { state: 'done', served });
      refresh();
      return { ok: true, served };
    }
    const receipt = await settle(hash, outcome.receipt);
    if (receipt.state === 'applied') {
      refresh();
      return { ok: true, kind: receipt.kind };
    }
    if (receipt.state === 'refused' && KNOWN_REFUSALS.has(receipt.code)) {
      return { ok: false, code: receipt.code, reason: receipt.reason };
    }
    const said =
      receipt.state === 'failed'
        ? receipt.error
        : receipt.state === 'refused'
          ? `${receipt.reason} (${receipt.code})`
          : t('common.requestFailed');
    if (receipt.state !== 'failed') setOutcome(hash, { state: 'unknown', text: said });
    throw new Error(said);
  };

  const start = async (chosen: readonly ItemDeletion[]): Promise<void> => {
    // A second press while a run is under way orders nothing.
    if (busy.current) return;
    busy.current = true;
    stop.current = false;
    setRun({ phase: 'reading' });
    try {
      let fresh: readonly ItemDeletion[];
      try {
        fresh = await readAgain();
      } catch (err) {
        setRun({ phase: 'unreadable', error: err instanceof Error ? serverMessage(err) : t('common.requestFailed') });
        return;
      }
      if (!sameRows(chosen, fresh)) {
        setRun({ phase: 'changed', count: fresh.length });
        refresh();
        return;
      }

      for (const row of chosen) setOutcome(row.naturalKeyHash, { state: 'waiting' });
      setRun({ phase: 'running', rows: chosen, results: {}, stopping: false });

      await applyEachInTurn(
        chosen.map((row) => ({ naturalKeyHash: row.naturalKeyHash, domain: row.domain })),
        applyOne,
        {
          stopRequested: () => stop.current || gone.current,
          onResult: (result) => {
            // Nothing happened to a row the run never reached: its buttons come back.
            if ('notTried' in result) setOutcome(result.item.naturalKeyHash, undefined);
            setRun((current) =>
              current?.phase === 'running'
                ? { ...current, results: { ...current.results, [result.item.naturalKeyHash]: result } }
                : current,
            );
          },
        },
      );
      if (!gone.current) {
        setRun((current) => (current?.phase === 'running' ? { ...current, phase: 'done' } : current));
        refresh();
      }
    } finally {
      busy.current = false;
    }
  };

  const open = () => {
    if (busy.current) return;
    setArmed({ rows, at: Date.now() });
  };

  const cancel = () => setArmed(undefined);

  const confirm = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!armed) return;
    // The second click of a double click, or a click that landed as the
    // confirmation opened: not a decision.
    if (event.detail > 1 || Date.now() - armed.at < confirmGuardMs) return;
    const frozen = armed.rows;
    setArmed(undefined);
    // The rows the confirmation counted, or nothing: a list that moved under
    // the pointer (a refetch, a row pressed on its own) is asked again.
    if (!sameRows(frozen, rows)) {
      setRun({ phase: 'changed', count: rows.length });
      return;
    }
    void start(frozen);
  };

  const running = run?.phase === 'reading' || run?.phase === 'running';
  const showConfirm = armed !== undefined && deletingByHand && !running;
  const offered = deletingByHand && rows.length >= 2 && !running && !showConfirm;
  if (!offered && !showConfirm && run === undefined) return null;

  const count = String((showConfirm ? armed.rows : rows).length);

  return (
    <div className="mb-2 space-y-2 text-sm" data-testid="delete-all">
      {offered && (
        <div className="space-y-1">
          <p className="text-xs text-gray-600">{t('deletions.all.lead', { count })}</p>
          <button
            type="button"
            onClick={open}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded border border-red-300 text-red-700 hover:bg-red-50"
          >
            <Trash2 className="w-3 h-3" />
            {t('deletions.all')}
          </button>
        </div>
      )}

      {showConfirm && (
        <div
          role="alertdialog"
          aria-labelledby={questionId}
          aria-describedby={leadId}
          className="p-3 rounded-lg border border-red-300 bg-red-50 space-y-2"
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancel();
          }}
        >
          <p id={questionId} className="font-medium text-red-900">
            {t('deletions.all.confirm.question', { count })}
          </p>
          <p id={leadId} className="text-xs text-gray-700">
            {t('deletions.all.lead', { count })}
          </p>
          {/* Cancel first, where the button was, and focused: the end of a
              double click lands on it, not on the delete. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={cancel}
              className="inline-flex items-center px-3 py-1 text-xs font-medium rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
            >
              {t('deletions.all.confirm.no')}
            </button>
            <button
              type="button"
              onClick={confirm}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded border border-red-600 bg-red-600 text-white hover:bg-red-700"
            >
              <Trash2 className="w-3 h-3" />
              {t('deletions.all.confirm.yes', { count })}
            </button>
          </div>
        </div>
      )}

      {/* One line, said as it changes: what the run is doing, then what it did. */}
      <div className="flex flex-wrap items-center gap-2">
        <p ref={statusRef} role="status" tabIndex={-1} className="text-xs text-gray-800 outline-none">
          <StatusLine run={run} />
        </p>
        {run?.phase === 'running' && !run.stopping && (
          <button
            ref={stopRef}
            type="button"
            onClick={() => {
              stop.current = true;
              setRun((current) => (current?.phase === 'running' ? { ...current, stopping: true } : current));
            }}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Square className="w-3 h-3" />
            {t('deletions.all.stop')}
          </button>
        )}
      </div>

      {(run?.phase === 'running' || run?.phase === 'done') && (
        <RunLists run={run} locale={locale} nameOf={nameOf} />
      )}
    </div>
  );
};

/** The status line's words for where the run is. */
const StatusLine: React.FC<{ run: Run | undefined }> = ({ run }) => {
  const t = useT();
  if (run === undefined) return null;
  switch (run.phase) {
    case 'reading':
      return (
        <span className="inline-flex items-center gap-1 text-gray-600">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('deletions.all.reading')}
        </span>
      );
    case 'changed':
      return (
        <span className="inline-flex items-start gap-1 text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          {run.count >= 2
            ? t('deletions.all.changed', { count: String(run.count) })
            : t('deletions.all.changed.few')}
        </span>
      );
    case 'unreadable':
      return (
        <span className="inline-flex items-start gap-1 text-red-700">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          {t('deletions.all.unreadable')} {run.error}
        </span>
      );
    case 'running': {
      const done = run.rows.filter((row) => run.results[row.naturalKeyHash] !== undefined).length;
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('deletions.all.running', { done: String(done), count: String(run.rows.length) })}
          {run.stopping && <span className="text-gray-600">{t('deletions.all.stopping')}</span>}
          {run.pollTrouble !== undefined && run.pollTrouble.count >= 2 && (
            <span className="text-amber-800">
              {t('deletions.all.pollTrouble', {
                count: String(run.pollTrouble.count),
                error: run.pollTrouble.error,
              })}
            </span>
          )}
        </span>
      );
    }
    case 'done': {
      const results = run.rows.map((row) => run.results[row.naturalKeyHash]).filter((r) => r !== undefined);
      const counts = { deleted: 0, notDeleted: 0, unknown: 0 };
      for (const r of results) counts[groupOf(r)] += 1;
      const stoppedBy = results.find((r) => 'notTried' in r);
      return (
        <span className="font-medium text-gray-900">
          {t('deletions.all.done', {
            deleted: String(counts.deleted),
            notDeleted: String(counts.notDeleted),
            unknown: String(counts.unknown),
          })}
          {stoppedBy && 'notTried' in stoppedBy && <> {t(stoppedKey(stoppedBy.notTried))}</>}
        </span>
      );
    }
  }
};

/** What the run did, in three groups, outside the status line. */
const RunLists: React.FC<{
  run: Extract<Run, { phase: 'running' | 'done' }>;
  locale: string;
  nameOf: (row: ItemDeletion) => React.ReactNode;
}> = ({ run, locale, nameOf }) => {
  const t = useT();
  const settled = run.rows.filter((row) => run.results[row.naturalKeyHash] !== undefined);
  const inGroup = (group: Group) => settled.filter((row) => groupOf(run.results[row.naturalKeyHash]!) === group);
  const groups: ReadonlyArray<{ group: Group; title: StringKey }> = [
    { group: 'deleted', title: 'deletions.all.removed' },
    { group: 'notDeleted', title: 'deletions.all.notRemoved' },
    { group: 'unknown', title: 'deletions.all.unknown' },
  ];

  return (
    <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 space-y-2">
      {groups.map(({ group, title }) => {
        const rows = inGroup(group);
        if (rows.length === 0) return null;
        return (
          <div key={group} data-group={group}>
            <h4 className="text-xs font-semibold text-gray-900">
              {t(title)} <span className="font-normal text-gray-500">({rows.length})</span>
            </h4>
            <ul className="mt-1 space-y-1">
              {rows.map((row) => (
                <li key={row.naturalKeyHash} className="text-xs">
                  <span className="text-gray-900">{nameOf(row)}</span>
                  <Said result={run.results[row.naturalKeyHash]!} locale={locale} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
};

/**
 * What became of one row, in the reader's language, with the server's own
 * words and code folded beside it, verbatim.
 */
const Said: React.FC<{ result: RunResult; locale: string }> = ({ result, locale }) => {
  const t = useT();
  const technical = (text: string) => (
    <details className="mt-0.5 text-gray-500">
      <summary className="cursor-pointer select-none">{t('deletions.all.technical')}</summary>
      <span lang={locale === 'en' ? undefined : 'en'}>{text}</span>
    </details>
  );

  if ('notTried' in result) {
    const by = result.notTried;
    if (by.by === 'stop') return <p className="text-gray-700">{t('deletions.all.notTried.stop')}</p>;
    if (by.by === 'failure') return <p className="text-gray-700">{t('deletions.all.notTried.failure')}</p>;
    return (
      <div className="text-amber-800">
        <p>
          {by.code === 'not_enabled'
            ? t('deletions.all.notTried.notEnabled')
            : t('deletions.all.notTried.breaker')}
        </p>
        {technical(`${by.reason} (${by.code})`)}
      </div>
    );
  }
  if ('failed' in result) {
    return (
      <div className="text-red-700">
        <p>{t('deletions.all.failed')}</p>
        {technical(result.failed)}
      </div>
    );
  }
  const answer = result.answered;
  if (answer.ok) {
    if (answer.served) return <ServedEffect served={answer.served} />;
    return (
      <p className="inline-flex items-start gap-1 text-emerald-700">
        <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        {answer.kind === 'binned'
          ? t('receipt.applied.binned')
          : answer.kind === 'deleted'
            ? t('receipt.applied.deleted')
            : t('receipt.applied.unknown')}
      </p>
    );
  }
  const key = REFUSED[answer.code] ?? 'deletions.refused.other';
  return (
    <div className={GONE_ALL_THE_SAME.has(answer.code) ? 'text-gray-700' : 'text-amber-800'}>
      <p>{t(key)}</p>
      {technical(`${answer.reason} (${answer.code})`)}
    </div>
  );
};
