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
 * A row with no apply button gets no disabled one either, for the reason
 * Deletions records: a greyed-out button invites somebody to find out how to
 * enable it, and here there is no answer to that question.
 */

import React from 'react';
import { useParams } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { mayOfferRelocationApply, type ItemMove, type MovesQueue } from '@openmig/shared';
import { QueueScreen, type ItemOutcome } from '../components/queues/QueueScreen';
import {
  ActionButton,
  DestructiveButton,
  DomainTag,
  GuidancePanel,
  HashChip,
  ItemRow,
  QueueSection,
  Refused,
  Resolved,
} from '../components/queues/primitives';
import { applyMove, fetchMoves, keepMove } from '../services/operating-service';
import { isSelfHost } from '../services/edition';
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
      {/*
        For a RENAME the two folders are the same, and showing "Docs → Docs"
        would say nothing about what changed. The key is what moved, so it is
        what gets shown — truncated, because a file's natural key is its path.
      */}
      <span className="truncate" title={mv.toNaturalKeyHash ?? mv.to}>
        {mv.toNaturalKeyHash && mv.to === mv.from ? mv.toNaturalKeyHash : mv.to}
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
                <>
                  <ActionButton
                    pending={outcomes[mv.naturalKeyHash]?.state === 'pending'}
                    onClick={() =>
                      act(mv.naturalKeyHash, () => keepMove(mappingId, mv.naturalKeyHash))
                    }
                  >
                    {t('moves.keep')}
                  </ActionButton>
                  {/*
                    Relocations only, and appliance only: the managed edition's
                    destructive path runs through a queued job and a receipt,
                    and there is no such job for this action yet (ADR-0030).
                    Offering a button that 404s would be worse than not showing
                    one.
                  */}
                  {mayOfferRelocationApply(mv) && isSelfHost() && (
                    <DestructiveButton
                      pending={outcomes[mv.naturalKeyHash]?.state === 'pending'}
                      label={t('moves.apply')}
                      armedLabel={t('moves.applyArmed')}
                      onClick={() =>
                        act(mv.naturalKeyHash, () => applyMove(mappingId, mv.naturalKeyHash))
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
