/**
 * The failure queue (ADR-0026): items that could not be migrated.
 *
 * Split the way the server splits it, because the two halves want different
 * things from the reader. `retrying` is the tool still working and wants
 * nobody's attention. `needsDecision` has run out of attempts and will never
 * move again until a person says something — and a cutover while it is non-empty
 * leaves data behind, which is the whole reason this queue exists.
 *
 * `lastError` is rendered verbatim. It is the difference between a 507, a 403
 * and a parse error, and summarising it into "failed" would remove the only
 * thing that tells an operator whether `retry` has any chance of working.
 */

import React from 'react';
import type { FailuresQueue, ItemFailure } from '@openmig/shared';
import { QueueScreen, type ItemOutcome } from '../components/queues/QueueScreen';
import {
  ActionButton,
  DomainTag,
  GuidancePanel,
  HashChip,
  ItemRow,
  QueueSection,
  Refused,
  Resolved,
} from '../components/queues/primitives';
import { acceptFailure, fetchFailures, retryFailure } from '../services/operating-service';

const Row: React.FC<{
  f: ItemFailure;
  outcome?: ItemOutcome;
  actions?: React.ReactNode;
}> = ({ f, outcome, actions }) => (
  <ItemRow>
    <DomainTag domain={f.domain} />
    <div className="flex-1 min-w-0">
      {f.collection && (
        <div className="text-gray-900 truncate" title={f.collection}>
          {f.collection}
        </div>
      )}
      <div className="text-xs text-red-700 break-words">{f.lastError}</div>
    </div>
    <span className="text-xs text-gray-500 whitespace-nowrap">
      {f.attempts} {f.attempts === 1 ? 'try' : 'tries'}
    </span>
    <HashChip hash={f.naturalKeyHash} />
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

const Failures: React.FC = () => (
  <QueueScreen<FailuresQueue>
    title="Could not be copied"
    intro="Items that did not make it across, what went wrong, and how many times we tried."
    queryKey="failures"
    fetcher={fetchFailures}
    renderMapping={(mappingId, queue, act, outcomes) => (
      <>
        <QueueSection
          title="Waiting on you"
          count={queue.needsDecision.length}
          empty="Nothing is waiting on a decision."
        >
          {queue.needsDecision.map((f) => {
            const pending = outcomes[f.naturalKeyHash]?.state === 'pending';
            return (
              <Row
                key={f.naturalKeyHash}
                f={f}
                outcome={outcomes[f.naturalKeyHash]}
                actions={
                  <>
                    <ActionButton
                      pending={pending}
                      onClick={() =>
                        act(f.naturalKeyHash, () => retryFailure(mappingId, f.naturalKeyHash))
                      }
                    >
                      Try again
                    </ActionButton>
                    {/*
                      `accept` is permanent and excludes the item from the
                      verification gate, but it destroys nothing: the item was
                      never copied, and this only stops us counting it as
                      missing. So it is an ordinary button — the two-step
                      treatment is reserved for the one action that removes
                      data, and spending it here would dilute it there.
                    */}
                    <ActionButton
                      pending={pending}
                      onClick={() =>
                        act(f.naturalKeyHash, () => acceptFailure(mappingId, f.naturalKeyHash))
                      }
                    >
                      Migrate without it
                    </ActionButton>
                  </>
                }
              />
            );
          })}
        </QueueSection>

        <QueueSection
          title="Still trying"
          count={queue.retrying.length}
          empty="Nothing is being retried."
        >
          {/*
            No actions: these are attempted again on every pass by themselves.
            Offering a retry for something already being retried would suggest
            the operator is holding it up.
          */}
          {queue.retrying.map((f) => (
            <Row key={f.naturalKeyHash} f={f} />
          ))}
        </QueueSection>

        <GuidancePanel entries={queue.howToResolve} />
      </>
    )}
  />
);

export default Failures;
