// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The moves queue (ADR-0026): items the source has relocated since we copied
 * them.
 *
 * TWO ACTIONS, and only one of them is offered on most rows.
 *
 * `keep` accepts the target's layout and changes nothing on either side. It is
 * the only thing available for a move that kept the item's natural key — every
 * mail and calendar move — because making the target follow one of those would
 * mean deleting the copy from where it sits, which hard rule 2 forbids.
 *
 * `apply` appears only on a RELOCATION: a file whose move or rename changed its
 * key, whose bytes are therefore already on the target under the new one
 * (ADR-0030). Removing the old copy there loses nothing, and that is checked
 * again server-side at the moment of removal. `mayOfferRelocationApply` decides
 * what is SHOWN; `applyRelocation` on the server decides what happens.
 *
 * BOTH EDITIONS offer it, with the same success-shape split as Deletions: the
 * appliance answers synchronously, the managed edition queues a job
 * (`run-apply-relocation`) and the outcome arrives on a RECEIPT this screen
 * polls — the relocation's own receipt, because the same item can have a
 * deletion receipt open at the same time (migration 0010).
 *
 * A row with no apply button gets no disabled one either, for the reason
 * Deletions records: a greyed-out button invites somebody to find out how to
 * enable it, and here there is no answer to that question.
 */

import React from 'react';
import { useParams } from 'react-router';
import { ArrowRight } from 'lucide-react';
import {
  mayOfferRelocationApply,
  type ApplyReceipt,
  type ItemMove,
  type MovesQueue,
} from '@openmig/shared';
import { QueueScreen, type ItemOutcome } from '../components/queues/QueueScreen.tsx';
import {
  ActionButton,
  DestructiveButton,
  DomainTag,
  GuidancePanel,
  HashChip,
  ItemRow,
  QueueSection,
  ReceiptStatus,
  Refused,
  Resolved,
} from '../components/queues/primitives.tsx';
import {
  applyMove,
  fetchMoveApplyReceipt,
  fetchMoves,
  keepMove,
  DecisionRefusedError,
} from '../services/operating-service.ts';
import { useT, useFormatters } from '../i18n/index.tsx';

/**
 * A move that changed the item's NAME without changing its folder.
 *
 * The two folders being equal is not enough on its own — a mail move within one
 * mailbox would look the same — so the relocation key is what says the item's
 * identity changed.
 */
const renamedInPlace = (mv: ItemMove): boolean =>
  mv.toNaturalKeyHash !== undefined && mv.to === mv.from;

const Row: React.FC<{
  mv: ItemMove;
  outcome?: ItemOutcome;
  actions?: React.ReactNode;
}> = ({ mv, outcome, actions }) => {
  const t = useT();
  const { relativeToNow, dateTime } = useFormatters();
  return (
  <ItemRow>
    <DomainTag domain={mv.domain} />
    {/*
      `from` is where the target has it; `to` is where the source lists it now.
      Both are folder paths and both are necessary: a queue that says "12 items
      moved" without saying where is not one anybody can act on.
    */}
    <span className="flex items-center gap-1.5 flex-1 min-w-0 text-gray-900">
      <span className="truncate" title={mv.from}>
        {mv.from}
      </span>
      {renamedInPlace(mv) ? (
        /*
          A RENAME. "Docs → Docs" would say nothing about what changed, and the
          only other thing this row holds is `toNaturalKeyHash` — which is a
          SHA-256 of the new path, NOT the new path (see `fileNaturalKeyHash`).
          It used to be rendered here, so the row read `Docs → 3f9a2b1c…`: a
          destination nobody can recognise, in a queue whose whole job is to say
          what happened. §17 keeps the path itself off this wire deliberately, so
          the honest thing to show is that it was renamed and nothing more. The
          item's own chip below is the handle every action takes.
        */
        <span className="text-gray-500 italic flex-shrink-0">{t('moves.renamedTo')}</span>
      ) : (
        <>
          <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
          <span className="truncate" title={mv.to}>
            {mv.to}
          </span>
        </>
      )}
    </span>
    <HashChip hash={mv.naturalKeyHash} />
    {/*
      How long this report has sat (migration 0013) — the triage column. A
      report from five minutes ago is probably still in motion; one from three
      weeks ago is a decision nobody has made. Absent only for rows recorded
      before the column existed.
    */}
    {mv.recordedAt && (
      <span
        className="text-xs text-gray-400 flex-shrink-0"
        title={dateTime(mv.recordedAt)}
      >
        {relativeToNow(mv.recordedAt)}
      </span>
    )}
    <div className="flex items-center gap-2 ml-auto">
      {outcome?.state === 'done' ? (
        <Resolved effect={outcome.effect} />
      ) : outcome?.state === 'refused' ? (
        <Refused text={outcome.text} />
      ) : outcome?.state === 'receipt' ? (
        <ReceiptStatus receipt={outcome.receipt} />
      ) : (
        actions
      )}
    </div>
  </ItemRow>
  );
};

const isTerminal = (r: ApplyReceipt): boolean =>
  r.state === 'applied' || r.state === 'refused' || r.state === 'failed';

const Moves: React.FC<{
  /** Test seam: the receipt poll interval. Production uses the default. */
  receiptPollMs?: number;
}> = ({ receiptPollMs = 2000 }) => {
  // Undefined on the appliance, which answers for every configured mapping;
  // required by the managed edition, which scopes each queue to one. See
  // `queuePath()` — the shapes are shared, the URLs are not.
  const { mappingId } = useParams<{ mappingId: string }>();
  const t = useT();

  // One timer per in-flight receipt; all cleared on unmount so an abandoned
  // page never keeps polling. (Server-side nothing is lost — the receipt is a
  // row, and reopening the page re-reads the queue.)
  const pollers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  React.useEffect(() => {
    const timers = pollers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const trackReceipt = React.useCallback(
    (
      mapping: string,
      hash: string,
      receipt: ApplyReceipt,
      setOutcome: (hash: string, outcome: ItemOutcome) => void,
      refresh: () => void,
    ) => {
      setOutcome(hash, { state: 'receipt', receipt });
      if (isTerminal(receipt)) {
        pollers.current.delete(hash);
        // An applied removal changes the queue itself; re-read rather than
        // guess what the server did to it.
        if (receipt.state === 'applied') refresh();
        return;
      }
      // `queued` (or, defensively, `none`): poll on. A missed poll keeps
      // polling — a transient read failure must not strand the outcome as
      // forever-queued when the job may have finished.
      const timer = setTimeout(() => {
        fetchMoveApplyReceipt(mapping, hash)
          .then((next) => trackReceipt(mapping, hash, next, setOutcome, refresh))
          .catch(() => trackReceipt(mapping, hash, receipt, setOutcome, refresh));
      }, receiptPollMs);
      pollers.current.set(hash, timer);
    },
    [receiptPollMs],
  );

  const startApply = React.useCallback(
    (
      mapping: string,
      hash: string,
      setOutcome: (hash: string, outcome: ItemOutcome) => void,
      refresh: () => void,
    ) => {
      setOutcome(hash, { state: 'pending' });
      applyMove(mapping, hash)
        .then((outcome) => {
          if (outcome.mode === 'immediate') {
            // The appliance's synchronous answer renders as it always has.
            setOutcome(hash, { state: 'done', effect: outcome.result.effect });
            refresh();
            return;
          }
          trackReceipt(mapping, hash, outcome.receipt, setOutcome, refresh);
        })
        .catch((err: unknown) => {
          // Same split as QueueScreen's act(): the gates' words when we have
          // them, the transport error when we do not.
          setOutcome(hash, {
            state: 'refused',
            text:
              err instanceof DecisionRefusedError
                ? (err.refusal.reason ?? err.refusal.hint ?? err.refusal.error)
                : err instanceof Error
                  ? err.message
                  : t('common.requestFailed'),
          });
        });
    },
    [trackReceipt, t],
  );

  return (
  <QueueScreen<MovesQueue>
    title={t('moves.title')}
    intro={t('moves.intro')}
    queryKey="moves"
    fetcher={() => fetchMoves(mappingId)}
    renderMapping={(mappingId, queue, act, outcomes, setOutcome, refresh) => (
      <>
        <QueueSection
          title={t('queue.waitingOnYou')}
          count={queue.open.length}
          empty={t('moves.empty.open')}
        >
          {queue.open.map((mv) => (
            <Row
              key={mv.naturalKeyHash}
              mv={mv}
              outcome={outcomes[mv.naturalKeyHash]}
              actions={
                <>
                  <ActionButton
                    pending={outcomes[mv.naturalKeyHash]?.state === 'pending'}
                    onClick={() =>
                      act(mv.naturalKeyHash, () => keepMove(mappingId, mv.naturalKeyHash))
                    }
                  >
                    {t('moves.keep')}
                  </ActionButton>
                  {/* Relocations only — a key-preserving move has no second
                      copy to point at, so nothing here may be removed. */}
                  {mayOfferRelocationApply(mv) && (
                    <DestructiveButton
                      pending={outcomes[mv.naturalKeyHash]?.state === 'pending'}
                      label={t('moves.apply')}
                      armedLabel={t('moves.applyArmed')}
                      onClick={() =>
                        startApply(mappingId, mv.naturalKeyHash, setOutcome, refresh)
                      }
                    />
                  )}
                </>
              }
            />
          ))}
        </QueueSection>

        <QueueSection
          title={t('queue.alreadyDecided')}
          count={queue.acknowledged.length}
          empty={t('moves.empty.acknowledged')}
        >
          {queue.acknowledged.map((mv) => (
            <Row key={mv.naturalKeyHash} mv={mv} />
          ))}
        </QueueSection>

        <GuidancePanel meaning={queue.whatThisMeans} entries={queue.howToResolve} />
      </>
    )}
  />
  );
};

export default Moves;
