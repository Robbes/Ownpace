/**
 * The moves queue (ADR-0026): items the source has relocated since we copied
 * them.
 *
 * One action, and it changes nothing on either side. Making the target follow a
 * move would mean deleting the copy from where it currently sits — the delete
 * half of a move, which hard rule 2 forbids outright — so the only thing on
 * offer is to accept the target's layout and stop being told about this one.
 * The screen says that rather than leaving somebody to wonder where the "apply"
 * button went.
 */

import React from 'react';
import { useParams } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { ItemMove, MovesQueue } from '@openmig/shared';
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
import { fetchMoves, keepMove } from '../services/operating-service';
import { useT } from '../i18n';

const Row: React.FC<{
  mv: ItemMove;
  outcome?: ItemOutcome;
  actions?: React.ReactNode;
}> = ({ mv, outcome, actions }) => (
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
      <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
      <span className="truncate" title={mv.to}>
        {mv.to}
      </span>
    </span>
    <HashChip hash={mv.naturalKeyHash} />
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

const Moves: React.FC = () => {
  // Undefined on the appliance, which answers for every configured mapping;
  // required by the managed edition, which scopes each queue to one. See
  // `queuePath()` — the shapes are shared, the URLs are not.
  const { mappingId } = useParams<{ mappingId: string }>();
  const t = useT();
  return (
  <QueueScreen<MovesQueue>
    title={t('moves.title')}
    intro={t('moves.intro')}
    queryKey="moves"
    fetcher={() => fetchMoves(mappingId)}
    renderMapping={(mappingId, queue, act, outcomes) => (
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
                <ActionButton
                  pending={outcomes[mv.naturalKeyHash]?.state === 'pending'}
                  onClick={() =>
                    act(mv.naturalKeyHash, () => keepMove(mappingId, mv.naturalKeyHash))
                  }
                >
                  {t('moves.keep')}
                </ActionButton>
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
