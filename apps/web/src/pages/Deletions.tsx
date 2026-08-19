// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The deletions queue (ADR-0026): items the source no longer has, which the
 * target still holds.
 *
 * This is the only screen in the product with a destructive button, and most of
 * what it does is decide when NOT to show one. `mayOfferApply` from
 * `@openmig/shared` is the gate — imported rather than re-derived, because
 * getting it wrong here means offering to delete a customer's data on the
 * strength of a listing that was merely throttled.
 *
 * The gate decides what is SHOWN. `applyDeletion` on the server decides what
 * happens, and enforces four more conditions this page cannot see (the
 * mapping's opt-in, an untouched target copy, the target being capable of
 * removal, and the mass-deletion breaker). A refusal is therefore a normal
 * outcome here, not an error, and is rendered as the server's own words.
 *
 * ONE screen, TWO temporal shapes (workplan 0019 T1/T2): the appliance answers
 * an apply synchronously, and the managed edition answers `202 queued` with the
 * outcome landing later on a receipt. This screen polls that receipt to a
 * terminal state with the Verify screen's discipline — stop on every terminal
 * state, a missed poll keeps polling — and renders each terminal state in its
 * own character (`refused` is never softened into an error, `failed` never
 * into silence).
 */

import React from 'react';
import { useParams } from 'react-router';
import type { ApplyReceipt, DeletionsQueue, ItemDeletion } from '@openmig/shared';
import { mayOfferApply } from '@openmig/shared';
import { QueueScreen, type ItemOutcome } from '../components/queues/QueueScreen.tsx';
import { ApplyDeletionsPanel } from '../components/queues/ApplyDeletionsPanel.tsx';
import {
  ActionButton,
  DestructiveButton,
  DomainTag,
  EvidenceBadge,
  GuidancePanel,
  HashChip,
  ItemRow,
  QueueSection,
  ReceiptStatus,
  Refused,
  Resolved,
} from '../components/queues/primitives.tsx';
import {
  applyDeletion,
  DecisionRefusedError,
  fetchApplyReceipt,
  fetchDeletions,
  keepDeletion,
} from '../services/operating-service.ts';
import { useT } from '../i18n/index.tsx';

const Row: React.FC<{
  d: ItemDeletion;
  outcome?: ItemOutcome;
  actions?: React.ReactNode;
}> = ({ d, outcome, actions }) => (
  <ItemRow>
    <DomainTag domain={d.domain} />
    <EvidenceBadge evidence={d.evidence} />
    <span className="text-gray-900 flex-1 min-w-0 truncate" title={d.collection}>
      {d.collection}
    </span>
    <HashChip hash={d.naturalKeyHash} />
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

const isTerminal = (r: ApplyReceipt): boolean =>
  r.state === 'applied' || r.state === 'refused' || r.state === 'failed';

const Deletions: React.FC<{
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
      const t = setTimeout(() => {
        fetchApplyReceipt(mapping, hash)
          .then((next) => trackReceipt(mapping, hash, next, setOutcome, refresh))
          .catch(() => trackReceipt(mapping, hash, receipt, setOutcome, refresh));
      }, receiptPollMs);
      pollers.current.set(hash, t);
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
      applyDeletion(mapping, hash)
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
  <QueueScreen<DeletionsQueue>
    title={t('deletions.title')}
    intro={t('deletions.intro')}
    queryKey="deletions"
    fetcher={() => fetchDeletions(mappingId)}
    renderMapping={(mappingId, queue, act, outcomes, setOutcome, refresh) => (
      <>
        {/* Gate 1, visible where it bites (0019 T3): the delete buttons below
            are refused by the server while this is off. */}
        <ApplyDeletionsPanel mappingId={mappingId} />
        <QueueSection
          title={t('queue.waitingOnYou')}
          count={queue.confirmed.length}
          empty={t('deletions.empty.confirmed')}
        >
          {queue.confirmed.map((d) => {
            const pending = outcomes[d.naturalKeyHash]?.state === 'pending';
            return (
              <Row
                key={d.naturalKeyHash}
                d={d}
                outcome={outcomes[d.naturalKeyHash]}
                actions={
                  <>
                    <ActionButton
                      pending={pending}
                      onClick={() =>
                        act(d.naturalKeyHash, () => keepDeletion(mappingId, d.naturalKeyHash))
                      }
                    >
                      {t('deletions.keep')}
                    </ActionButton>
                    {/*
                      The apply button exists only for positive evidence. An
                      inferred deletion is shown in this same list — it is
                      confirmed, and worth telling somebody about — but it gets
                      no destructive option at all, rather than a disabled one:
                      a greyed-out button invites somebody to find out how to
                      enable it, and there is no answer to that question here.
                    */}
                    {mayOfferApply(d) && (
                      <DestructiveButton
                        pending={pending}
                        label={t('deletions.apply')}
                        armedLabel={t('deletions.applyArmed')}
                        onClick={() =>
                          startApply(mappingId, d.naturalKeyHash, setOutcome, refresh)
                        }
                      />
                    )}
                  </>
                }
              />
            );
          })}
        </QueueSection>

        <QueueSection
          title={t('deletions.watching')}
          count={queue.watching.length}
          empty={t('deletions.empty.watching')}
        >
          {/*
            Shown so the queue is not a black box, and deliberately without
            actions: these have not met the bar to be put in front of a person
            as a decision, so offering one would contradict saying so.
          */}
          {queue.watching.map((d) => (
            <Row key={d.naturalKeyHash} d={d} />
          ))}
        </QueueSection>

        <QueueSection
          title={t('queue.alreadyDecided')}
          count={queue.acknowledged.length}
          empty={t('deletions.empty.acknowledged')}
        >
          {queue.acknowledged.map((d) => (
            <Row key={d.naturalKeyHash} d={d} />
          ))}
        </QueueSection>

        <GuidancePanel meaning={queue.whatThisMeans} entries={queue.howToResolve} />
      </>
    )}
  />
  );
};

export default Deletions;
