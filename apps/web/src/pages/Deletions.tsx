// Copyright 2026 The Ownpace authors (Apache-2.0)
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
 * happens, and enforces three more conditions this page cannot see (an
 * untouched target copy, the target being capable of removal, and the
 * mass-deletion breaker). No switch has to be turned on for it since alpha.21
 * (ADR-0024, 2026-11-25): the two presses on this page are the consent. A refusal is therefore a normal
 * outcome here, not an error, and is rendered as the server's own words.
 *
 * ONE screen, TWO temporal shapes (workplan 0019 T1/T2): the appliance answers
 * an apply synchronously, and the managed edition answers `202 queued` with the
 * outcome landing later on a receipt. This screen polls that receipt to a
 * terminal state with the Verify screen's discipline — stop on every terminal
 * state, a missed poll keeps polling — and renders each terminal state in its
 * own character (`refused` is never softened into an error, `failed` never
 * into silence).
 *
 * AND ONE PRESS FOR ALL OF THEM (workplan 0164 T3): *Delete all of these here
 * too* presses each row's own button in turn, through the same call, and says
 * afterwards what was deleted and what was not, and why (`DeleteAllPanel`).
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { useParams } from 'react-router';
import type { ApplyReceipt, DeletionsQueue, EarlierExport, ItemDeletion } from '@openmig/shared';
import { mayOfferApply } from '@openmig/shared';
import { QueueScreen, type ItemOutcome } from '../components/queues/QueueScreen.tsx';
import { ApplyDeletionsPanel, WhatADeleteDoes } from '../components/queues/ApplyDeletionsPanel.tsx';
import { DeleteAllPanel } from '../components/queues/DeleteAllPanel.tsx';
import {
  ActionButton,
  AfterCutoverNote,
  DestructiveButton,
  DomainTag,
  EvidenceBadge,
  GuidancePanel,
  HashChip,
  ItemRow,
  PathText,
  QueueSection,
  ReceiptStatus,
  Refused,
  Resolved,
  ServedEffect,
  fileAt,
  servedOf,
} from '../components/queues/primitives.tsx';
import {
  applyDeletion,
  DecisionRefusedError,
  fetchApplyReceipt,
  fetchDeletions,
  keepDeletion,
} from '../services/operating-service.ts';
import { useT, type StringKey } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';

/**
 * What a decided row's decision did on the new system (workplan 0159 §6 item
 * 6), from the server's `decided`.
 *
 * The ledger closes an entry the same way for *Keep our copy* and for *Delete
 * it here too*, so the section's heading cannot say which and stays the
 * owner's *Already decided*: a title that guessed named the opposite of what
 * happened after a delete (#1621's review). Each row says it instead, where
 * its buttons were. A row the server says nothing about says nothing more.
 */
const DECIDED: Record<NonNullable<ItemDeletion['decided']>, StringKey> = {
  kept: 'deletions.decided.kept',
  applied: 'deletions.decided.applied',
  // The old copy of an item that MOVED: never called deleted, because the
  // item is on the new system under its new name.
  relocated: 'deletions.decided.relocated',
};

const Decided: React.FC<{ decided: NonNullable<ItemDeletion['decided']> }> = ({ decided }) => {
  const t = useT();
  return <Resolved effect={t(DECIDED[decided])} />;
};

/**
 * WHICH ITEM a row is about, from what the ledger already holds for it
 * (`displayName`, read by `nameOnRow`). A row named only its folder, so a file
 * at the top of a drive read `/` beside a hash, under a button that deletes it
 * on the new system (found 2026-11-19, as on Moves).
 *
 * A FILE's name is part of its place: `/Docs/report.pdf`. Anything else leads
 * with its name and keeps its folder after it in small type, as Failures does.
 * A row with no name says what it always said: its folder.
 */
const WhichItem: React.FC<{ domain: string; displayName: string | undefined; collection: string }> = ({
  domain,
  displayName,
  collection,
}) => {
  if (displayName === undefined) {
    return (
      <span className="text-gray-900 flex-1 min-w-[12rem] break-words" title={collection}>
        <PathText path={collection} />
      </span>
    );
  }
  if (domain === 'file') {
    const path = fileAt(collection, displayName);
    return (
      <span className="text-gray-900 flex-1 min-w-[12rem] break-words" title={path}>
        <PathText path={path} />
      </span>
    );
  }
  return (
    <span
      className="text-gray-900 flex-1 min-w-[12rem] break-words"
      title={`${displayName} — ${collection}`}
    >
      {displayName}
      <span className="ml-2 text-xs text-gray-500">
        <PathText path={collection} />
      </span>
    </span>
  );
};

const Row: React.FC<{
  d: ItemDeletion;
  outcome?: ItemOutcome;
  actions?: React.ReactNode;
}> = ({ d, outcome, actions }) => (
  <ItemRow>
    <DomainTag domain={d.domain} />
    <EvidenceBadge evidence={d.evidence} />
    {/* At least 12rem: on a phone the name takes a line of its own and
        wraps, instead of shrinking to a letter (the UX sweep, 2026-10-17). */}
    <WhichItem domain={d.domain} displayName={d.displayName} collection={d.collection} />
    <HashChip hash={d.naturalKeyHash} />
    <div className="flex items-center gap-2 ml-auto">
      {outcome?.state === 'done' ? (
        <ServedEffect served={outcome.served} />
      ) : outcome?.state === 'refused' ? (
        <Refused text={outcome.text} />
      ) : outcome?.state === 'receipt' ? (
        <ReceiptStatus receipt={outcome.receipt} />
      ) : outcome?.state === 'waiting' ? (
        <WaitingItsTurn />
      ) : outcome?.state === 'unknown' ? (
        <NotKnown text={outcome.text} />
      ) : d.decided ? (
        <Decided decided={d.decided} />
      ) : (
        actions
      )}
    </div>
  </ItemRow>
);

/** A row a *Delete all of these here too* run will reach: no button to press meanwhile. */
const WaitingItsTurn: React.FC = () => {
  const t = useT();
  return <span className="text-xs text-gray-600">{t('deletions.all.waiting')}</span>;
};

/**
 * A row whose press did not answer, in a run: a fault, a time-out, a receipt
 * that never landed. Red, like a failed receipt, and never a refusal's amber:
 * whether the copy is gone is not known. What the press said follows, as
 * served.
 */
const NotKnown: React.FC<{ text: string }> = ({ text }) => {
  const t = useT();
  return (
    <span className="inline-flex items-start gap-1 text-xs text-red-700">
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      {t('deletions.all.unknownRow')} {text}
    </span>
  );
};

/** What a row is called, for the list a run leaves: as `WhichItem` says it, in one line. */
const nameOf = (d: ItemDeletion): React.ReactNode => {
  if (d.displayName === undefined) return <PathText path={d.collection} />;
  if (d.domain === 'file') return <PathText path={fileAt(d.collection, d.displayName)} />;
  return d.displayName;
};

/**
 * A copy an earlier export policy left (workplan 0042 T8 (b), second half).
 *
 * Its own row, not a `Row` with an evidence badge: nothing was deleted at the
 * source, and an evidence word here would say it was. It never has a delete
 * button; the owner keeps it or removes it on the new system.
 */
const EarlierRow: React.FC<{
  e: EarlierExport;
  outcome?: ItemOutcome;
  actions?: React.ReactNode;
}> = ({ e, outcome, actions }) => {
  const t = useT();
  return (
    <ItemRow>
      <DomainTag domain={e.domain} />
      <span
        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-sky-50 text-sky-800 border-sky-200"
        title={t('deletions.earlierExport.badgeTitle')}
      >
        {t('deletions.earlierExport.badge')}
      </span>
      <WhichItem domain={e.domain} displayName={e.displayName} collection={e.collection} />
      <HashChip hash={e.naturalKeyHash} />
      <div className="flex items-center gap-2 ml-auto">
        {outcome?.state === 'done' ? (
          <ServedEffect served={outcome.served} />
        ) : outcome?.state === 'refused' ? (
          <Refused text={outcome.text} />
        ) : e.acknowledgedAt !== undefined ? (
          // Kept is the only answer an earlier export has: nothing removes
          // one for you (the owner, 2026-09-23).
          <Resolved effect={t('deletions.decided.kept')} />
        ) : (
          actions
        )}
      </div>
    </ItemRow>
  );
};

const isTerminal = (r: ApplyReceipt): boolean =>
  r.state === 'applied' || r.state === 'refused' || r.state === 'failed';

/** A receipt timer's key: the migration and the item, as an outcome's. */
const pollKey = (mapping: string, hash: string): string => `${mapping}\u0000${hash}`;

/**
 * The rows *Delete all of these here too* would order: waiting on you, each
 * offered a delete button of its own by `mayOfferApply` (positive evidence,
 * not past its data type's cutover), and none pressed on this page yet.
 */
const offeredAll = (
  queue: DeletionsQueue,
  outcomes: Readonly<Record<string, ItemOutcome>>,
): ItemDeletion[] =>
  queue.confirmed.filter(
    (d) => mayOfferApply(d, queue.afterCutover) && outcomes[d.naturalKeyHash] === undefined,
  );

const Deletions: React.FC<{
  /** Test seam: the receipt poll interval. Production uses the default. */
  receiptPollMs?: number;
  /** Test seam: how long a run waits for one receipt (`RECEIPT_DEADLINE_MS`). */
  receiptDeadlineMs?: number;
  /** Test seam: the run's confirmation guard (`CONFIRM_GUARD_MS`). */
  confirmGuardMs?: number;
}> = ({ receiptPollMs = 2000, receiptDeadlineMs, confirmGuardMs }) => {
  // Undefined on the appliance, which answers for every configured mapping;
  // required by the managed edition, which scopes each queue to one. See
  // `queuePath()` — the shapes are shared, the URLs are not.
  const { mappingId } = useParams<{ mappingId: string }>();
  const routeMappingId = mappingId;
  const t = useT();

  // One timer per in-flight receipt; all cleared on unmount so an abandoned
  // page never keeps polling. (Server-side nothing is lost — the receipt is a
  // row, and reopening the page re-reads the queue.) Keyed by migration and
  // item, as the outcomes are: one hash can be an item of two migrations.
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
        pollers.current.delete(pollKey(mapping, hash));
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
      pollers.current.set(pollKey(mapping, hash), t);
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
            // The appliance's synchronous answer renders as it always has,
            // in the reader's language where it says both.
            setOutcome(hash, { state: 'done', served: servedOf(outcome.result) });
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
                ? (err.refusal.reason ??
                  err.refusal.hint ??
                  err.refusal.error)
                : err instanceof Error
                  ? serverMessage(err)
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
        {/* The one switch left: removing moved files' old copies unattended
            (ADR-0031). Deleting by hand has none since alpha.21 (ADR-0024,
            2026-11-25). */}
        <ApplyDeletionsPanel mappingId={mappingId} />
        {/* What a delete does, said where the press is made (workplan 0173
            T3): it stood in front of the switch that is gone. Only where a
            row offers a delete. */}
        {queue.confirmed.some((d) => mayOfferApply(d, queue.afterCutover)) && <WhatADeleteDoes />}
        {/* Only the rows whose button the cutover took away (2026-10-05). */}
        <AfterCutoverNote
          withheld={queue.confirmed.filter((d) => mayOfferApply(d, []) && !mayOfferApply(d, queue.afterCutover))}
        />
        {/* One press for every row with a delete button of its own, and for
            no other row (0164 T3): the same gate the buttons below are
            offered by, and none already pressed on this page; the list is
            read again at the press, by the same rule. Above the section, not
            in its `lead` prop: a section with no rows draws none, and a run
            that deleted every row still has to say so. */}
        <DeleteAllPanel
          mappingId={mappingId}
          rows={offeredAll(queue, outcomes)}
          readAgain={async () => {
            const fresh = (await fetchDeletions(routeMappingId))[mappingId];
            return fresh ? offeredAll(fresh, outcomes) : [];
          }}
          setOutcome={setOutcome}
          refresh={refresh}
          receiptPollMs={receiptPollMs}
          {...(receiptDeadlineMs !== undefined ? { receiptDeadlineMs } : {})}
          {...(confirmGuardMs !== undefined ? { confirmGuardMs } : {})}
          nameOf={nameOf}
        />
        {/* What the chips mean is said here, where a phone can read it, not
            only in a hover title, and only for the chips the rows carry: an
            assumed row is the one with no delete button, and says why (the
            owner, 2026-10-18). */}
        <QueueSection
          title={t('queue.waitingOnYou')}
          count={queue.confirmed.length}
          empty={t('deletions.empty.confirmed')}
          lead={
            <div className="space-y-1 text-xs text-gray-600">
              {queue.confirmed.some((d) => d.evidence !== 'inferred') && <p>{t('deletions.evidence.lead')}</p>}
              {queue.confirmed.some((d) => d.evidence === 'inferred') && (
                <p>{t('deletions.evidence.lead.inferred')}</p>
              )}
            </div>
          }
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
                      The same for a kind past its cutover (2026-10-05).
                    */}
                    {mayOfferApply(d, queue.afterCutover) && (
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
          lead={<p className="text-xs text-gray-600">{t('deletions.watching.lead')}</p>}
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

        {/* Only when there are some: most migrations have no Google
            documents, and an empty section about export formats would be a
            question nobody asked. */}
        {queue.earlierExports.waiting.length > 0 && (
          <>
            <p className="text-sm text-gray-600 mb-2">{t('deletions.earlierExports.intro')}</p>
            <QueueSection
              title={t('deletions.earlierExports')}
              count={queue.earlierExports.waiting.length}
              empty=""
            >
              {queue.earlierExports.waiting.map((e) => (
                <EarlierRow
                  key={e.naturalKeyHash}
                  e={e}
                  outcome={outcomes[e.naturalKeyHash]}
                  actions={
                    <ActionButton
                      pending={outcomes[e.naturalKeyHash]?.state === 'pending'}
                      onClick={() =>
                        act(e.naturalKeyHash, () => keepDeletion(mappingId, e.naturalKeyHash))
                      }
                    >
                      {t('deletions.keep')}
                    </ActionButton>
                  }
                />
              ))}
            </QueueSection>
          </>
        )}

        <QueueSection
          title={t('queue.alreadyDecided')}
          count={queue.acknowledged.length + queue.earlierExports.kept.length}
          empty={t('deletions.empty.acknowledged')}
        >
          {queue.acknowledged.map((d) => (
            <Row key={d.naturalKeyHash} d={d} />
          ))}
          {queue.earlierExports.kept.map((e) => (
            <EarlierRow key={e.naturalKeyHash} e={e} />
          ))}
        </QueueSection>

        <GuidancePanel queue="deletions" />
      </>
    )}
  />
  );
};

export default Deletions;
