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
 */

import React from 'react';
import type { DeletionsQueue, ItemDeletion } from '@openmig/shared';
import { mayOfferApply } from '@openmig/shared';
import { QueueScreen, type ItemOutcome } from '../components/queues/QueueScreen';
import {
  ActionButton,
  DestructiveButton,
  DomainTag,
  EvidenceBadge,
  GuidancePanel,
  HashChip,
  ItemRow,
  QueueSection,
  Refused,
  Resolved,
} from '../components/queues/primitives';
import { applyDeletion, fetchDeletions, keepDeletion } from '../services/operating-service';

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
      ) : (
        actions
      )}
    </div>
  </ItemRow>
);

const Deletions: React.FC = () => (
  <QueueScreen<DeletionsQueue>
    title="Deleted on the old system"
    intro="Items the owner has deleted where they came from, which the new system still has. Nothing has been removed from either side."
    queryKey="deletions"
    fetcher={fetchDeletions}
    renderMapping={(mappingId, queue, act, outcomes) => (
      <>
        <QueueSection
          title="Waiting on you"
          count={queue.confirmed.length}
          empty="Nothing is waiting on a decision."
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
                      Keep our copy
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
                        label="Delete it here too"
                        armedLabel="Confirm delete"
                        onClick={() =>
                          act(d.naturalKeyHash, () => applyDeletion(mappingId, d.naturalKeyHash))
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
          title="Watching"
          count={queue.watching.length}
          empty="Nothing is being watched."
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
          title="Already decided"
          count={queue.acknowledged.length}
          empty="Nothing has been decided yet."
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

export default Deletions;
