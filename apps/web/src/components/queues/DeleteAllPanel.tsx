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
 * pass a refusal it never got to say. So a run has one removal at a time
 * under way for its migration, as a person pressing would. It does not wait
 * for a single press still under way, nor for another migration's run on the
 * same page: each migration's panel runs by itself, as each migration's
 * breaker counts by itself. A page closed mid-run orders nothing more; what
 * was ordered finishes where it runs.
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
 * frozen then). Its *Cancel* comes first and takes the focus; the focus
 * stays inside it until it closes, Escape closes it from anywhere in it, and
 * the focus then goes back to the button. Its *Delete N* ignores the second
 * click of a double click and any click within `CONFIRM_GUARD_MS` of
 * opening, so a double click cannot pass it. Nothing is ordered unless the
 * page's rows at the confirming press, and the list read again from the
 * server, are both that frozen set, each row with the evidence it was
 * counted with: a row turned from reported into binned, or back, is a list
 * that changed.
 *
 * THE BIN'S ROWS, COUNTED APART. A run takes both kinds of row a single
 * delete is offered for: those the old system reported deleted, and those
 * found in its bin (`trashed`). When some came from the bin, the
 * confirmation names how many, apart from the reported ones. When one of
 * those is mail, it also says why that matters: a message can be in the bin
 * and in a live folder at once, so a copy here may be one still in use, and
 * once deleted it is never copied again. Both numbers are counted from the
 * frozen set, and the press orders nothing unless every row still has the
 * evidence it was counted with, on the page and in the list read again. What
 * happens to a row's evidence after that, during the run, its own gates
 * decide. When none came from the bin, it says nothing about the bin.
 *
 * From the confirming press on, every row of the run waits its turn with no
 * button of its own, the reading of the list included: a keep pressed there
 * was overwritten by the run, and a single delete pressed there ran beside it
 * (the second review, F-A). A run that orders nothing gives the rows their
 * buttons back.
 *
 * A REFUSAL IS A GATE'S, OR IT IS NOT A REFUSAL. A 403 or 404 with a code
 * the destructive path refuses with (`APPLY_REFUSAL_CODES`), or the 500
 * `removed_not_recorded`, is a gate's answer. A 409 hold or closed account,
 * and the 502 that could not queue the removal, started nothing: the row is
 * not deleted, and the run stops, as the next press would meet the same.
 * Anything else (a fault, a code no gate refuses with) is a press that did
 * not answer: not known.
 *
 * AFTERWARDS IT SAYS WHAT HAPPENED, in the reader's language, in four
 * groups: deleted, the copy already removed, not deleted, and not known. A
 * copy already removed (`already_applied`) is never counted as deleted: an
 * earlier removal took it, a move's included, and the item may live on,
 * moved. The why is said from the
 * refusal's stable code, and the server's own sentence with its code stays
 * beside it, verbatim, under *Technical details* (docs/i18n-prose-boundary.md,
 * class 2), marked English only where it is the server's.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Check, Loader2, Square, Trash2 } from 'lucide-react';
import {
  APPLY_REFUSAL_CODES,
  BREAKER_CODES,
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

/** The managed route's 502 when the removal's job could not be queued: its `error` field, as served. */
const NOT_QUEUED = 'Could not queue the removal';

/** A 409 that started nothing (`enqueueUnlessHeld`): the operator's hold, or the organisation's close. */
const NOTHING_STARTED_409: ReadonlySet<string> = new Set(['platform_held', 'account_closed']);

/** What one press answered, read to its end. A press that did not answer is thrown, and becomes `failed`. */
export type DeleteAllAnswer =
  | {
      readonly ok: true;
      /** The appliance's own line about the removal, in both languages. */
      readonly served?: Partial<DecisionEffectFields>;
      /** A managed receipt's word for how final it was. */
      readonly kind?: string;
    }
  | {
      readonly ok: false;
      /** The gate's refusal code, or for a press that started nothing, the `error` it was answered with. */
      readonly code: string;
      readonly reason: string;
      /** The server's own words and code, as served, for *Technical details*. */
      readonly technical: string;
      /** Nothing was started for it, for a reason the next press would meet too. */
      readonly stopsTheRun?: true;
    };

type Refusal = Extract<DeleteAllAnswer, { ok: false }>;

type RunResult = ApplyEachResult<DeleteAllAnswer>;

type Run =
  | { readonly phase: 'reading'; readonly stopping: boolean }
  | { readonly phase: 'changed'; readonly count: number }
  | { readonly phase: 'unreadable'; readonly error: string }
  | {
      readonly phase: 'running' | 'done';
      readonly rows: readonly ItemDeletion[];
      readonly results: Readonly<Record<string, RunResult>>;
      readonly stopping: boolean;
      /** Rows whose *not known* words are the server's English, as served. */
      readonly english: Readonly<Record<string, true>>;
      /** The receipt being read could not be, this many times in a row. */
      readonly pollTrouble?: { readonly count: number; readonly error: string };
    };

/** The confirmation, open: the rows as they were when it opened, and when that was. */
interface Armed {
  readonly rows: readonly ItemDeletion[];
  readonly at: number;
}

const KNOWN_REFUSALS: ReadonlySet<string> = new Set(APPLY_REFUSAL_CODES);

/**
 * Refusals that mean a row's evidence was withdrawn during the run: it had
 * positive evidence when the list was read again, so the list changed under
 * the run. They stop it (`RUN_STOPPING_REFUSALS`).
 */
const EVIDENCE_WITHDRAWN: ReadonlySet<string> = new Set(['not_confirmed', 'weak_evidence']);

/** A refusal that means this press removed the copy all the same: the ledger could not record it. */
const REMOVED_ALL_THE_SAME: ReadonlySet<string> = new Set(['removed_not_recorded']);

/**
 * A refusal that means the copy was gone before this press: an earlier
 * removal took it, a move's included, so the item itself may live on. Said
 * and counted apart, never as deleted.
 */
const ALREADY_REMOVED: ReadonlySet<string> = new Set(['already_applied']);

/** Each refusal code a deletion's press can answer, and each press that started nothing, in the reader's words. */
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
  platform_held: 'deletions.refused.held',
  account_closed: 'deletions.refused.accountClosed',
  [NOT_QUEUED]: 'deletions.refused.notQueued',
};

const isTerminal = (r: ApplyReceipt): boolean =>
  r.state === 'applied' || r.state === 'refused' || r.state === 'failed';

/** The words a refusal's body carries, as served: `reason`, else `hint`, else `message`. */
function wordsOf(err: DecisionRefusedError): string | undefined {
  const said = err.refusal as { reason?: string; hint?: string; message?: unknown };
  return said.reason ?? said.hint ?? (typeof said.message === 'string' ? said.message : undefined);
}

/** A refused press as served: its words, its `error` and its status. */
function servedAs(err: DecisionRefusedError): string {
  const words = wordsOf(err);
  return `${words !== undefined ? `${words} ` : ''}(${err.refusal.error}, HTTP ${err.httpStatus})`;
}

/**
 * What a thrown press said, where it said something this page counts: a
 * gate's refusal (a 403 or 404 whose code the destructive path refuses with,
 * or the 500 `removed_not_recorded`), or a press the server started nothing
 * for (a 409 hold or closed account, or the 502 that could not queue the
 * removal). Undefined for everything else a press can throw, which is a
 * fault, not an answer.
 */
export function answerOf(err: unknown): Refusal | undefined {
  if (!(err instanceof DecisionRefusedError)) return undefined;
  const code = err.refusal.error;
  const status = err.httpStatus;
  const reason = wordsOf(err) ?? code;
  if (((status === 403 || status === 404) && KNOWN_REFUSALS.has(code)) || (status === 500 && code === 'removed_not_recorded')) {
    return { ok: false, code, reason, technical: `${reason} (${code})` };
  }
  if ((status === 409 && NOTHING_STARTED_409.has(code)) || (status === 502 && code === NOT_QUEUED)) {
    return { ok: false, code, reason, technical: servedAs(err), stopsTheRun: true };
  }
  return undefined;
}

type Group = 'deleted' | 'alreadyRemoved' | 'notDeleted' | 'unknown';

/** Which of the four a row's result belongs to. */
function groupOf(result: RunResult): Group {
  if ('failed' in result) return 'unknown';
  if ('notTried' in result) return 'notDeleted';
  if (result.answered.ok) return 'deleted';
  if (ALREADY_REMOVED.has(result.answered.code)) return 'alreadyRemoved';
  return REMOVED_ALL_THE_SAME.has(result.answered.code) ? 'deleted' : 'notDeleted';
}

/** A row as the confirmation counted it: its handle and its evidence. */
const asCounted = (d: ItemDeletion): string => `${d.naturalKeyHash}\u0000${d.evidence}`;

/**
 * The same rows, whatever their order: the same handles, each with the same
 * evidence. A row whose evidence changed is not the row the confirmation
 * counted (a reported row now in the bin was never named as one).
 */
function sameRows(a: readonly ItemDeletion[], b: readonly ItemDeletion[]): boolean {
  if (a.length !== b.length) return false;
  const inB = new Set(b.map(asCounted));
  return a.every((d) => inB.has(asCounted(d)));
}

/** What stopped a run, in the summary's words. */
function stoppedKey(by: NotTried): StringKey {
  if (by.by === 'stop') return 'deletions.all.stoppedBy.stop';
  if (by.by === 'failure') return 'deletions.all.stoppedBy.failure';
  if (BREAKER_CODES.has(by.code)) return 'deletions.all.stoppedBy.breaker';
  if (by.code === 'not_enabled') return 'deletions.all.stoppedBy.notEnabled';
  if (by.code === 'removed_not_recorded') return 'deletions.all.stoppedBy.notRecorded';
  if (EVIDENCE_WITHDRAWN.has(by.code)) return 'deletions.all.stoppedBy.evidenceWithdrawn';
  return 'deletions.all.stoppedBy.notStarted';
}

/** Why a row the run never reached was not tried, in its line's words. */
function notTriedKey(by: NotTried): StringKey {
  if (by.by === 'stop') return 'deletions.all.notTried.stop';
  if (by.by === 'failure') return 'deletions.all.notTried.failure';
  if (BREAKER_CODES.has(by.code)) return 'deletions.all.notTried.breaker';
  if (by.code === 'not_enabled') return 'deletions.all.notTried.notEnabled';
  if (by.code === 'removed_not_recorded') return 'deletions.all.notTried.notRecorded';
  if (EVIDENCE_WITHDRAWN.has(by.code)) return 'deletions.all.notTried.evidenceWithdrawn';
  return 'deletions.all.notTried.notStarted';
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
  /** Rows of this run whose *not known* words are the server's English. */
  const english = React.useRef(new Set<string>());
  /** The confirmation closed without a run: the focus goes back to the button. */
  const focusBack = React.useRef(false);
  const allRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const stopRef = React.useRef<HTMLButtonElement>(null);
  const statusRef = React.useRef<HTMLParagraphElement>(null);
  const questionId = React.useId();
  const leadId = React.useId();
  const binId = React.useId();

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

  const running = run?.phase === 'reading' || run?.phase === 'running';
  const showConfirm = armed !== undefined && deletingByHand && !running;
  const offered = deletingByHand && rows.length >= 2 && !running && !showConfirm;

  // Focus follows the run: Cancel when the confirmation opens, the button
  // again when it closes without a run, Stop while the list is read and the
  // run runs, the summary when it ends.
  React.useEffect(() => {
    if (armed) {
      cancelRef.current?.focus();
      return;
    }
    if (focusBack.current) {
      focusBack.current = false;
      allRef.current?.focus();
    }
  }, [armed]);
  const phase = run?.phase;
  React.useEffect(() => {
    if (phase === 'reading' || phase === 'running') stopRef.current?.focus();
    if (phase === 'done') statusRef.current?.focus();
  }, [phase]);

  // While the confirmation is open the focus stays in it: a focus that lands
  // anywhere else on the page is brought back to Cancel. Except in another
  // confirmation: two migrations' panels on one page can each have one open,
  // and two traps pulling the focus back would pull it back and forth for
  // ever (the third review, R5).
  React.useEffect(() => {
    if (!showConfirm) return;
    const keepIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || !(event.target instanceof Element) || dialog.contains(event.target)) return;
      if (event.target.closest('[role="alertdialog"]')) return;
      cancelRef.current?.focus();
    };
    document.addEventListener('focusin', keepIn);
    return () => document.removeEventListener('focusin', keepIn);
  }, [showConfirm]);

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

  /**
   * One row's own press, read to its end: exactly what its own button does.
   * The queue is read again once, when the run ends, not after every row.
   */
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
      const answer = answerOf(err);
      if (answer) {
        setOutcome(hash, { state: 'refused', text: answer.reason });
        return answer;
      }
      if (err instanceof DecisionRefusedError) {
        fault = servedAs(err);
        english.current.add(hash);
      } else {
        // A transport's message, or `serverMessage`'s own sentence in the
        // reader's language: said as it came, never marked English.
        fault = err instanceof Error ? serverMessage(err) : t('common.requestFailed');
      }
      setOutcome(hash, { state: 'unknown', text: fault });
    }
    if (outcome === undefined) throw new Error(fault ?? t('common.requestFailed'));
    if (outcome.mode === 'immediate') {
      const served = servedOf(outcome.result);
      setOutcome(hash, { state: 'done', served });
      return { ok: true, served };
    }
    const receipt = await settle(hash, outcome.receipt);
    if (receipt.state === 'applied') return { ok: true, kind: receipt.kind };
    if (receipt.state === 'refused' && KNOWN_REFUSALS.has(receipt.code)) {
      return {
        ok: false,
        code: receipt.code,
        reason: receipt.reason,
        technical: `${receipt.reason} (${receipt.code})`,
      };
    }
    // A receipt that failed, or that was refused with a code no gate refuses
    // with, is no answer this page can count. A failed job may be tried again
    // where it runs, so its removal may still happen: not known, and the run
    // stops.
    const said =
      receipt.state === 'failed'
        ? receipt.error
        : receipt.state === 'refused'
          ? `${receipt.reason} (${receipt.code})`
          : undefined;
    if (said !== undefined) english.current.add(hash);
    const text = said ?? t('common.requestFailed');
    if (receipt.state !== 'failed') setOutcome(hash, { state: 'unknown', text });
    throw new Error(text);
  };

  const start = async (chosen: readonly ItemDeletion[]): Promise<void> => {
    // A second press while a run is under way orders nothing.
    if (busy.current) return;
    busy.current = true;
    stop.current = false;
    english.current = new Set();
    // From the confirming press on, every row of the run waits its turn,
    // with no button of its own: not even while the list is read again,
    // where a keep was overwritten by the run and a single delete ran beside
    // it. A run that orders nothing gives the rows their buttons back.
    for (const row of chosen) setOutcome(row.naturalKeyHash, { state: 'waiting' });
    const giveBack = () => {
      for (const row of chosen) setOutcome(row.naturalKeyHash, undefined);
    };
    setRun({ phase: 'reading', stopping: false });
    try {
      let fresh: readonly ItemDeletion[];
      try {
        fresh = await readAgain();
      } catch (err) {
        giveBack();
        setRun({ phase: 'unreadable', error: err instanceof Error ? serverMessage(err) : t('common.requestFailed') });
        return;
      }
      if (!sameRows(chosen, fresh)) {
        giveBack();
        setRun({ phase: 'changed', count: fresh.length });
        refresh();
        return;
      }

      setRun({ phase: 'running', rows: chosen, results: {}, stopping: stop.current, english: {} });

      await applyEachInTurn(
        chosen.map((row) => ({ naturalKeyHash: row.naturalKeyHash, domain: row.domain })),
        applyOne,
        {
          stopRequested: () => stop.current || gone.current,
          onResult: (result) => {
            const hash = result.item.naturalKeyHash;
            // Nothing happened to a row the run never reached: its buttons come back.
            if ('notTried' in result) setOutcome(hash, undefined);
            const isEnglish = 'failed' in result && english.current.has(hash);
            setRun((current) =>
              current?.phase === 'running'
                ? {
                    ...current,
                    results: { ...current.results, [hash]: result },
                    english: isEnglish ? { ...current.english, [hash]: true } : current.english,
                  }
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

  const cancel = () => {
    focusBack.current = true;
    setArmed(undefined);
  };

  const confirm = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!armed) return;
    // The second click of a double click, or a click that landed as the
    // confirmation opened: not a decision.
    if (event.detail > 1 || Date.now() - armed.at < confirmGuardMs) return;
    const frozen = armed.rows;
    // The rows the confirmation counted, or nothing: a list that moved while
    // it was open (a refetch, a row pressed on its own) is asked again.
    if (!sameRows(frozen, rows)) {
      focusBack.current = true;
      setArmed(undefined);
      setRun({ phase: 'changed', count: rows.length });
      return;
    }
    setArmed(undefined);
    void start(frozen);
  };

  /** Tab and Shift+Tab go round the confirmation's own buttons; Escape closes it from anywhere in it. */
  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) return;
    const at = document.activeElement;
    if (event.shiftKey && (at === first || at === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (at === last || at === dialogRef.current)) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!offered && !showConfirm && run === undefined) return null;

  const count = String((showConfirm ? armed.rows : rows).length);
  // The bin's rows, from the frozen set the press acts on, never from the
  // page as it is now.
  const fromTheBin = showConfirm ? armed.rows.filter((d) => d.evidence === 'trashed').length : 0;
  const reportedCount = showConfirm ? armed.rows.length - fromTheBin : 0;
  // The bin's sentence speaks of a message: said when one of the bin's rows is mail.
  const mailFromTheBin = showConfirm && armed.rows.some((d) => d.evidence === 'trashed' && d.domain === 'email');
  const stoppable = (run?.phase === 'reading' || run?.phase === 'running') && !run.stopping;

  return (
    <div className="mb-2 space-y-2 text-sm" data-testid="delete-all">
      {offered && (
        <div className="space-y-1">
          <p className="text-xs text-gray-600">{t('deletions.all.lead', { count })}</p>
          <button
            ref={allRef}
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
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={questionId}
          aria-describedby={fromTheBin > 0 ? `${leadId} ${binId}` : leadId}
          tabIndex={-1}
          className="p-3 rounded-lg border border-red-300 bg-red-50 space-y-2 outline-none"
          onKeyDown={onDialogKeyDown}
        >
          <p id={questionId} className="font-medium text-red-900">
            {t('deletions.all.confirm.question', { count })}
          </p>
          <p id={leadId} className="text-xs text-gray-700">
            {t('deletions.all.lead', { count })}
          </p>
          {fromTheBin > 0 && (
            <div id={binId} className="space-y-1 text-xs text-red-900">
              <p>
                {t('deletions.all.confirm.split', {
                  reported: String(reportedCount),
                  bin: String(fromTheBin),
                })}
              </p>
              {mailFromTheBin && <p>{t('deletions.all.confirm.bin')}</p>}
            </div>
          )}
          {/* Cancel first, and focused: the end of a double click lands on
              nothing that deletes. */}
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
        {stoppable && (
          <button
            ref={stopRef}
            type="button"
            onClick={() => {
              stop.current = true;
              setRun((current) =>
                current?.phase === 'reading' || current?.phase === 'running'
                  ? { ...current, stopping: true }
                  : current,
              );
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
        <span className="inline-flex flex-wrap items-center gap-1 text-gray-600">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('deletions.all.reading')}
          {run.stopping && <span>{t('deletions.all.stoppingBeforeStart')}</span>}
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
      const counts = { deleted: 0, alreadyRemoved: 0, notDeleted: 0, unknown: 0 };
      for (const r of results) counts[groupOf(r)] += 1;
      const stoppedBy = results.find((r) => 'notTried' in r);
      return (
        <span className="font-medium text-gray-900">
          {t('deletions.all.done', {
            deleted: String(counts.deleted),
            alreadyRemoved: String(counts.alreadyRemoved),
            notDeleted: String(counts.notDeleted),
            unknown: String(counts.unknown),
          })}
          {stoppedBy && 'notTried' in stoppedBy && <> {t(stoppedKey(stoppedBy.notTried))}</>}
        </span>
      );
    }
  }
};

/** What the run did, in four groups, outside the status line. */
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
    { group: 'alreadyRemoved', title: 'deletions.all.alreadyRemoved' },
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
                  <Said
                    result={run.results[row.naturalKeyHash]!}
                    locale={locale}
                    english={run.english[row.naturalKeyHash] === true}
                  />
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
 * words and code folded beside it, verbatim. Only the server's words are
 * marked English: a *not known* line can be this page's own sentence, in the
 * reader's language (`english` says which).
 */
const Said: React.FC<{ result: RunResult; locale: string; english: boolean }> = ({ result, locale, english }) => {
  const t = useT();
  const technical = (text: string, served: boolean) => (
    <details className="mt-0.5 text-gray-500">
      <summary className="cursor-pointer select-none">{t('deletions.all.technical')}</summary>
      <span lang={served && locale !== 'en' ? 'en' : undefined}>{text}</span>
    </details>
  );

  if ('notTried' in result) {
    const by = result.notTried;
    if (by.by !== 'refusal') return <p className="text-gray-700">{t(notTriedKey(by))}</p>;
    return (
      <div className="text-amber-800">
        <p>{t(notTriedKey(by))}</p>
        {technical(`${by.reason} (${by.code})`, true)}
      </div>
    );
  }
  if ('failed' in result) {
    return (
      <div className="text-red-700">
        <p>{t('deletions.all.failed')}</p>
        {technical(result.failed, english)}
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
    <div
      className={
        REMOVED_ALL_THE_SAME.has(answer.code) || ALREADY_REMOVED.has(answer.code) ? 'text-gray-700' : 'text-amber-800'
      }
    >
      <p>{t(key)}</p>
      {technical(answer.technical, true)}
    </div>
  );
};
