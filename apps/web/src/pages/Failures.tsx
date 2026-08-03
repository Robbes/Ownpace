// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import { useParams } from 'react-router';
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
import { useT } from '../i18n';

const Row: React.FC<{
  f: ItemFailure;
  outcome?: ItemOutcome;
  actions?: React.ReactNode;
}> = ({ f, outcome, actions }) => {
  const t = useT();
  return (
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
      {f.attempts} {f.attempts === 1 ? t('failures.try.one') : t('failures.try.many')}
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
};

const Failures: React.FC = () => {
  // Undefined on the appliance, which answers for every configured mapping;
  // required by the managed edition, which scopes each queue to one. See
  // `queuePath()` — the shapes are shared, the URLs are not.
  const { mappingId } = useParams<{ mappingId: string }>();
  const t = useT();
  return (
  <QueueScreen<FailuresQueue>
    title={t('failures.title')}
    intro={t('failures.intro')}
    queryKey="failures"
    fetcher={() => fetchFailures(mappingId)}
    renderMapping={(mappingId, queue, act, outcomes) => (
      <>
        <QueueSection
          title={t('queue.waitingOnYou')}
          count={queue.needsDecision.length}
          empty={t('failures.empty.needsDecision')}
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
                      {t('failures.retry')}
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
                      {t('failures.accept')}
                    </ActionButton>
                  </>
                }
              />
            );
          })}
        </QueueSection>

        <QueueSection
          title={t('failures.stillTrying')}
          count={queue.retrying.length}
          empty={t('failures.empty.retrying')}
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
};

export default Failures;
