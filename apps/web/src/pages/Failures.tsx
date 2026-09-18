// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The failure queue (ADR-0026): items that could not be migrated.
 *
 * Split the way the server splits it, because the two halves want different
 * things from the reader. `retrying` is the tool still working and wants
 * nobody's attention. `needsDecision` will never move again until a person
 * says something — either because attempts ran out or because it was PARKED
 * on sight — and a cutover while it is non-empty leaves data behind, which is
 * the whole reason this queue exists.
 *
 * A parked row shows "waiting on you" INSTEAD of a try count. It was attempted
 * once; its stored count used to be the ceiling because parking was written
 * into that number, so the screen reported five attempts for one.
 *
 * `lastError` is rendered verbatim. It is the difference between a 507, a 403
 * and a parse error, and summarising it into "failed" would remove the only
 * thing that tells an operator whether `retry` has any chance of working.
 *
 * ABOVE it, since migration 0049, is the remedy for the item's CATEGORY — in
 * the reader's own language, from the map the domain strip and the operator's
 * support screen already share. The prose is always the provider's English and
 * always will be; a person deciding what to do needs a sentence they can act
 * on, and this queue is exactly where they are when they need it.
 *
 * Absent on a row with no category, which is every row written before that
 * migration: the prose shows alone, as it always did.
 */

import React from 'react';
import { Link, useParams } from 'react-router';
import type { FailuresQueue, ItemFailure } from '@openmig/shared';
import { QueueScreen, type ItemOutcome } from '../components/queues/QueueScreen.tsx';
import {
  ActionButton,
  DomainTag,
  GuidancePanel,
  HashChip,
  ItemRow,
  QueueSection,
  Refused,
  Resolved,
} from '../components/queues/primitives.tsx';
import { acceptFailure, fetchFailures, retryFailure } from '../services/operating-service.ts';
import { FailureGroupPanel } from '../components/queues/FailureGroupPanel.tsx';
import { useT } from '../i18n/index.tsx';
// One map, shared with the domain strip and the operator's support screen
// (0110 T4), so the person who phones and the person they phone read the same
// sentence. An item's category is the same nine-way vocabulary.
import { FAILURE_KEY } from '../i18n/failure-key.ts';
import { Hint } from '../components/Hint.tsx';

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
      {/* WHOSE CARD, WHICH APPOINTMENT (the owner, 2026-09-17). This row used
          to lead with the collection and identify the item by a hash chip, so
          the queue whose whole purpose is being acted on could not say what it
          was asking about. The name leads now; the collection follows it in
          small type on the same line, so the row is no taller than it was. */}
      {(f.displayName ?? f.collection) !== undefined && (
        <div
          className="text-gray-900 truncate"
          title={[f.displayName, f.collection].filter(Boolean).join(' \u2014 ')}
        >
          {f.displayName ?? f.collection}
          {f.displayName !== undefined && f.collection !== undefined && (
            <span className="ml-2 text-xs text-gray-500">{f.collection}</span>
          )}
        </div>
      )}
      {f.category && (
        // THE WAY OUT, FIRST — the same order the domain strip uses, and the
        // same sentence from the same map, so the customer and the operator who
        // takes their call read one thing (0110 T3, migration 0049).
        //
        // Until 2026-09-17 this row had only the line below: the provider's own
        // English, with no remedy in any language. A domain-level failure has
        // said what to do since August; the ITEM level — the common case, and
        // the whole reason this queue exists — said nothing.
        <div className="text-xs text-red-900">{t(FAILURE_KEY[f.category])}</div>
      )}
      {/*
        Verbatim, under the sentence above rather than instead of it: the
        category is coarse and actionable, this is precise. It is the difference
        between a 507, a 403 and a parse error, and summarising it away removes
        the only thing that says whether Retry has a chance.
      */}
      <div className="text-xs text-red-700 break-words">{f.lastError}</div>
    </div>
    {/*
      A PARKED item is not a count. It was tried once — a policy that answers
      the same way every pass is not something to retry five times — and then
      set aside for a person. Printing `attempts` here claimed attempts against
      somebody's Google account that never happened (owner report, 2026-09-14),
      because parking used to be stored AS the attempt count.
    */}
    <span className="text-xs text-gray-500 whitespace-nowrap">
      {f.parkedAt
        ? t('failures.parked')
        : `${f.attempts} ${f.attempts === 1 ? t('failures.try.one') : t('failures.try.many')}`}
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
        {/* Failure diagnosis is what the runs panel exists for — say so and
            link the hub that carries it (0036 T3). */}
        <p className="mb-3 text-sm">
          <Link
            to={`/mappings/${encodeURIComponent(mappingId)}`}
            className="text-blue-700 hover:underline"
          >
            {t('failures.seeRuns')}
          </Link>
        </p>
        {/* One decision over a GROUP, above both sections because it reaches
            both: `needsDecision` and `retrying` are the same `status='failed'`
            rows to the server, so a panel sitting inside the parked section
            would be showing a count over half the rows it changes.

            Offered only when there is something to group. With one failure on
            screen the per-row buttons say it better, and a form that matches a
            single item is a form somebody has to read to dismiss. */}
        {queue.needsDecision.length + queue.retrying.length > 1 && (
          <FailureGroupPanel
            mappingId={mappingId}
            failures={[...queue.needsDecision, ...queue.retrying]}
          />
        )}
        <QueueSection
          title={t('queue.waitingOnYou')}
          count={queue.needsDecision.length}
          empty={t('failures.empty.needsDecision')}
        >
          {/* What retry costs, said before it is pressed (0036 T4) — the
              sentence tracks domain-sync.ts's cursor comment. */}
          {queue.needsDecision.length > 0 && (
            <Hint className="mb-2" text={t('failures.retryCost')} why={t('failures.retryCost.why')} />
          )}
          {/* One press for the whole group. A folder of Google Forms and Maps
              parks a dozen items at once, each with the same answer, and
              pressing "Migrate without it" twelve times on a phone is how a
              decision that was already made gets postponed. Same action as
              the per-item button, applied to every item still undecided —
              the server still answers per item, so a refusal on one leaves
              the others' outcomes intact. */}
          {queue.needsDecision.length > 1 && (
            <div className="mb-3">
              <ActionButton
                pending={queue.needsDecision.some((f) => outcomes[f.naturalKeyHash]?.state === 'pending')}
                onClick={() => {
                  for (const f of queue.needsDecision) {
                    if (outcomes[f.naturalKeyHash]?.state === 'done') continue;
                    act(f.naturalKeyHash, () => acceptFailure(mappingId, f.naturalKeyHash));
                  }
                }}
              >
                {t('failures.acceptAll', { count: String(queue.needsDecision.length) })}
              </ActionButton>
            </div>
          )}
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
                      title={t('failures.retryCost')}
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

        {/* Why this queue has no "Already decided" section, said instead of
            left as an asymmetry (0036 T2): accepted items genuinely leave the
            ledger's failed set (resolveFailure sets left_behind; listFailures
            filters status='failed'). */}
        <p className="mt-2 text-xs text-gray-500">{t('failures.acceptedLeave')}</p>

        <GuidancePanel entries={queue.howToResolve} />
      </>
    )}
  />
  );
};

export default Failures;
