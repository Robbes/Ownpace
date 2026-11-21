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
 * WHERE THE LOOP LIVES, AND WHY HERE. In the page, one item at a time, each
 * awaited to its end before the next is ordered (`applyEachInTurn`): the
 * appliance's answer, or a managed receipt polled until it is applied,
 * refused or failed. That is what lets the breaker's rule hold exactly: once
 * an item is refused as part of a mass deletion, on the request or by the
 * job, no later item of its data type is ordered. It also keeps a run to one
 * removal at a time against the new system, as a person pressing would, and
 * a page closed mid-run orders nothing more. What was ordered finishes
 * where it runs, and the list read again shows what happened.
 *
 * OFFERED ONLY WHERE A SINGLE DELETE IS, AND ONLY WHILE IT CAN GO THROUGH:
 * deleting by hand on (read as the panel above reads it; a row's own button
 * shows while it is off, and the server refuses it), and a row counts only
 * while `mayOfferApply` offers its own button, so never an assumed one, and
 * never one of a data type past its cutover. Two at least: one row says it
 * better with its own button.
 *
 * ONE CONFIRMATION, AND IT NAMES THE COUNT. The second press says how many
 * it will delete. Before anything is ordered the list is read again, and a
 * list that has changed since it was shown orders nothing: the count a
 * person confirmed is the count that is ordered.
 *
 * AFTERWARDS IT SAYS WHAT HAPPENED, in the reader's language: what was
 * deleted, and what was not and why. The why is said from the refusal's
 * stable code, and the server's own sentence with its code stays beside it,
 * verbatim, under *Technical details* (docs/i18n-prose-boundary.md, class 2).
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Check, Loader2, Square } from 'lucide-react';
import {
  applyEachInTurn,
  type ApplyEachItem,
  type ApplyEachResult,
  type ApplyReceipt,
  type DecisionEffectFields,
  type ItemDeletion,
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
import { ActionButton, DestructiveButton, ServedEffect, servedOf } from './primitives.tsx';

/** What one press answered, read to its end. A failure is thrown, and becomes `failed`. */
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
    };

/** Each refusal code a deletion's press can answer, in the reader's words. */
const REFUSED: Readonly<Record<string, StringKey>> = {
  not_enabled: 'deletions.refused.notEnabled',
  target_cannot_remove: 'deletions.refused.targetCannotRemove',
  not_found: 'deletions.refused.notFound',
  not_confirmed: 'deletions.refused.notConfirmed',
  weak_evidence: 'deletions.refused.weakEvidence',
  not_ours: 'deletions.refused.notOurs',
  already_applied: 'deletions.refused.alreadyApplied',
  after_cutover: 'deletions.refused.afterCutover',
  edited_on_target: 'deletions.refused.editedOnTarget',
  version_unknown: 'deletions.refused.versionUnknown',
  kept_for_guests: 'deletions.refused.keptForGuests',
  mass_deletion_suspected: 'deletions.refused.massDeletionSuspected',
  removed_not_recorded: 'deletions.refused.removedNotRecorded',
};

const DOMAIN_KEY: Readonly<Record<string, StringKey>> = {
  email: 'domain.email',
  calendar: 'domain.calendar',
  contact: 'domain.contact',
  file: 'domain.file',
  task: 'domain.task',
};

const isTerminal = (r: ApplyReceipt): boolean =>
  r.state === 'applied' || r.state === 'refused' || r.state === 'failed';

/** Whether a result removed the copy: a removal the ledger could not record removed it all the same. */
const removedBy = (result: RunResult): boolean =>
  'answered' in result && (result.answered.ok || result.answered.code === 'removed_not_recorded');

/** The same rows, by their handles, whatever their order. */
function sameRows(a: readonly ItemDeletion[], b: readonly ItemDeletion[]): boolean {
  if (a.length !== b.length) return false;
  const inB = new Set(b.map((d) => d.naturalKeyHash));
  return a.every((d) => inB.has(d.naturalKeyHash));
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
  /** What a row is called, as its row says it. */
  nameOf: (row: ItemDeletion) => React.ReactNode;
}> = ({ mappingId, rows, readAgain, setOutcome, refresh, receiptPollMs, nameOf }) => {
  const t = useT();
  const { locale } = useLocale();
  const [run, setRun] = React.useState<Run | undefined>(undefined);
  const busy = React.useRef(false);
  const stop = React.useRef(false);
  const gone = React.useRef(false);
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

  /** A managed receipt, polled to its end. A missed poll keeps polling, as a row's own does. */
  const settle = async (hash: string, first: ApplyReceipt): Promise<ApplyReceipt> => {
    let receipt = first;
    setOutcome(hash, { state: 'receipt', receipt });
    while (!isTerminal(receipt)) {
      await new Promise((resolve) => setTimeout(resolve, receiptPollMs));
      if (gone.current) throw new Error('The page closed before this removal was answered.');
      try {
        receipt = await fetchApplyReceipt(mappingId, hash);
      } catch {
        continue;
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
    // What a press that failed said, in the words its row shows: the run
    // records it as that row's failure (`applyEachInTurn`), never as a refusal.
    let failed: string | undefined;
    try {
      outcome = await applyDeletion(mappingId, hash);
    } catch (err) {
      if (err instanceof DecisionRefusedError) {
        const reason = err.refusal.reason ?? err.refusal.hint ?? err.refusal.error;
        setOutcome(hash, { state: 'refused', text: reason });
        return { ok: false, code: err.refusal.error, reason };
      }
      failed = err instanceof Error ? serverMessage(err) : t('common.requestFailed');
      setOutcome(hash, { state: 'refused', text: failed });
    }
    if (outcome === undefined) throw new Error(failed ?? t('common.requestFailed'));
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
    if (receipt.state === 'refused') return { ok: false, code: receipt.code, reason: receipt.reason };
    throw new Error(receipt.state === 'failed' ? receipt.error : t('common.requestFailed'));
  };

  const start = async (): Promise<void> => {
    // A second press while a run is under way orders nothing.
    if (busy.current) return;
    busy.current = true;
    stop.current = false;
    const chosen = rows;
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

  const running = run?.phase === 'reading' || run?.phase === 'running';
  const offered = deletingByHand && rows.length >= 2 && !running;
  if (!offered && run === undefined) return null;

  return (
    <div className="mb-2 space-y-2 text-sm" data-testid="delete-all">
      {offered && (
        <div className="space-y-1">
          <p className="text-xs text-gray-600">{t('deletions.all.lead', { count: String(rows.length) })}</p>
          <DestructiveButton
            label={t('deletions.all')}
            armedLabel={t('deletions.all.armed', { count: String(rows.length) })}
            onClick={() => void start()}
          />
        </div>
      )}

      {run?.phase === 'reading' && (
        <p className="inline-flex items-center gap-1 text-xs text-gray-600">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('deletions.all.reading')}
        </p>
      )}
      {run?.phase === 'changed' && (
        <p className="inline-flex items-start gap-1 text-xs text-amber-800" role="status">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          {t('deletions.all.changed', { count: String(run.count) })}
        </p>
      )}
      {run?.phase === 'unreadable' && (
        <p className="inline-flex items-start gap-1 text-xs text-red-700" role="alert">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          {t('deletions.all.unreadable')} {run.error}
        </p>
      )}

      {(run?.phase === 'running' || run?.phase === 'done') && (
        <RunReport
          run={run}
          locale={locale}
          nameOf={nameOf}
          onStop={() => {
            stop.current = true;
            setRun((current) => (current?.phase === 'running' ? { ...current, stopping: true } : current));
          }}
        />
      )}
    </div>
  );
};

/** The run as it goes, then what it did: deleted, and not deleted with why. */
const RunReport: React.FC<{
  run: Extract<Run, { phase: 'running' | 'done' }>;
  locale: string;
  nameOf: (row: ItemDeletion) => React.ReactNode;
  onStop: () => void;
}> = ({ run, locale, nameOf, onStop }) => {
  const t = useT();
  const count = String(run.rows.length);
  const settled = run.rows.filter((row) => run.results[row.naturalKeyHash] !== undefined);
  const removed = settled.filter((row) => removedBy(run.results[row.naturalKeyHash]!));
  const notRemoved = settled.filter((row) => !removedBy(run.results[row.naturalKeyHash]!));

  return (
    <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 space-y-2" role="status">
      {run.phase === 'running' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-gray-800">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t('deletions.all.running', { done: String(settled.length), count })}
          </span>
          {run.stopping ? (
            <span className="text-xs text-gray-600">{t('deletions.all.stopping')}</span>
          ) : (
            <ActionButton onClick={onStop}>
              <Square className="w-3 h-3" />
              {t('deletions.all.stop')}
            </ActionButton>
          )}
        </div>
      ) : (
        <p className="font-medium text-gray-900">
          {t('deletions.all.done', { removed: String(removed.length), count })}
        </p>
      )}

      {removed.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-gray-900">
            {t('deletions.all.removed')} <span className="font-normal text-gray-500">({removed.length})</span>
          </h5>
          <ul className="mt-1 space-y-1">
            {removed.map((row) => (
              <li key={row.naturalKeyHash} className="text-xs">
                <span className="text-gray-900">{nameOf(row)}</span>
                <Said result={run.results[row.naturalKeyHash]!} domain={row.domain} locale={locale} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {notRemoved.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-gray-900">
            {t('deletions.all.notRemoved')}{' '}
            <span className="font-normal text-gray-500">({notRemoved.length})</span>
          </h5>
          <ul className="mt-1 space-y-1">
            {notRemoved.map((row) => (
              <li key={row.naturalKeyHash} className="text-xs">
                <span className="text-gray-900">{nameOf(row)}</span>
                <Said result={run.results[row.naturalKeyHash]!} domain={row.domain} locale={locale} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/**
 * What became of one row, in the reader's language, with the server's own
 * words and code folded beside it, verbatim.
 */
const Said: React.FC<{ result: RunResult; domain: string; locale: string }> = ({ result, domain, locale }) => {
  const t = useT();
  const technical = (text: string) => (
    <details className="mt-0.5 text-gray-500">
      <summary className="cursor-pointer select-none">{t('deletions.all.technical')}</summary>
      <span lang={locale === 'en' ? undefined : 'en'}>{text}</span>
    </details>
  );

  if ('notTried' in result) {
    if (result.notTried.by === 'stop') {
      return <p className="text-gray-700">{t('deletions.all.notTried.stop')}</p>;
    }
    const key = DOMAIN_KEY[domain];
    return (
      <div className="text-amber-800">
        <p>{t('deletions.all.notTried.breaker', { dataType: key ? t(key) : domain })}</p>
        {technical(`${result.notTried.reason} (${result.notTried.code})`)}
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
    <div className="text-amber-800">
      <p>{t(key)}</p>
      {technical(`${answer.reason} (${answer.code})`)}
    </div>
  );
};
