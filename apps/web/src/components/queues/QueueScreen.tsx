// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The scaffolding every decision-queue screen shares: fetch state, the
 * per-mapping split, and the decision bookkeeping (ADR-0026).
 *
 * Decisions are tracked per item rather than per screen because they are
 * per-item actions: one refusal must not blank out the queue, and one success
 * must not imply anything about the row next to it. An item is a migration's
 * item: an outcome is kept under the migration AND the item's hash, and each
 * migration's rows are handed only their own. The hash alone is not an item
 * across migrations: a mail item's comes from its Message-ID, so one message
 * in two migrations has one hash, and a removal in the first marked the
 * second's row *Deleted on the new system too* (the second review of workplan
 * 0164 T3, F-F). `applyDeletion` in
 * particular is designed to be used one confirmed item at a time, and a UI that
 * reported its outcome globally would be describing something the API does not
 * do.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { ApplyReceipt, DecisionEffectFields, QueueEnvelope } from '@openmig/shared';
import { ClosedBanner, LIFECYCLE_NOTE_KEY, servedOf } from './primitives.tsx';
import MappingHubLink from '../MappingHubLink.tsx';
import StateChip from '../StateChip.tsx';
import AsOf from '../AsOf.tsx';
import { useT } from '../../i18n/index.tsx';
import { DecisionRefusedError } from '../../services/operating-service.ts';
import { Hint } from '../Hint.tsx';
import { serverMessage } from '../../services/api.ts';

/**
 * What happened to one item after the operator acted on it.
 *
 * `receipt` is the managed apply's temporal shape (workplan 0019 T2): the
 * outcome is a lifecycle the Deletions screen polls to a terminal state, not a
 * single reply. Other queues never produce it.
 *
 * `done` keeps both halves of what the server said the press did, as served
 * (`effect`, `effectNl`; workplan 0159 §6 item 18): the row says the half in
 * its reader's language, also after a language switch (`ServedEffect`).
 */
export type ItemOutcome =
  /**
   * In a *Delete all of these here too* run (workplan 0164 T3), not yet its
   * turn: its buttons give way to a word saying so, so nothing is pressed on
   * a row the run is about to order.
   */
  | { readonly state: 'waiting' }
  | { readonly state: 'pending' }
  | { readonly state: 'done'; readonly served: Partial<DecisionEffectFields> }
  | { readonly state: 'refused'; readonly text: string }
  /**
   * A press that did not answer, in a run (workplan 0164 T3): a fault, a
   * time-out, a receipt that never landed. Not a refusal: whether the copy is
   * gone is not known, and the row says so.
   */
  | { readonly state: 'unknown'; readonly text: string }
  | { readonly state: 'receipt'; readonly receipt: ApplyReceipt };

export interface QueueScreenProps<T extends QueueEnvelope> {
  readonly title: string;
  readonly intro: string;
  /** What folds under the intro (0118 T4): a page with more to say than one line says it here. */
  readonly more?: string;
  readonly queryKey: string;
  readonly fetcher: () => Promise<Readonly<Record<string, T>>>;
  readonly renderMapping: (
    mappingId: string,
    queue: T,
    act: (hash: string, run: () => Promise<Partial<DecisionEffectFields>>) => void,
    outcomes: Readonly<Record<string, ItemOutcome>>,
    /**
     * Direct outcome control, for flows `act` cannot model (the apply receipt,
     * a run over many rows). `undefined` gives a row back its buttons: a row
     * a run never reached had nothing happen to it.
     */
    setOutcome: (hash: string, outcome: ItemOutcome | undefined) => void,
    /** Re-read the queue from the server (never patch the cache by hand). */
    refresh: () => void,
  ) => React.ReactNode;
}

/** A migration's outcomes before anything was decided in it: one object, so its identity holds. */
const NO_OUTCOMES: Readonly<Record<string, ItemOutcome>> = Object.freeze({});

type Act = (hash: string, run: () => Promise<Partial<DecisionEffectFields>>) => void;
type SetOutcome = (hash: string, outcome: ItemOutcome | undefined) => void;

export function QueueScreen<T extends QueueEnvelope>({
  title,
  intro,
  more,
  queryKey,
  fetcher,
  renderMapping,
}: QueueScreenProps<T>): React.ReactElement {
  const queryClient = useQueryClient();
  const t = useT();
  /** Per migration, then per item hash. */
  const [outcomes, setOutcomes] = React.useState<Record<string, Record<string, ItemOutcome>>>({});

  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: [queryKey],
    queryFn: fetcher,
    // These queues change when a pass runs, which is minutes apart at best, so
    // polling hard buys nothing. Refetching on focus is what actually matters:
    // an operator coming back to the tab should not act on a stale list.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const setOutcomeIn = React.useCallback(
    (mappingId: string, hash: string, outcome: ItemOutcome | undefined) => {
      setOutcomes((all) => {
        const mine = all[mappingId] ?? NO_OUTCOMES;
        if (outcome !== undefined) return { ...all, [mappingId]: { ...mine, [hash]: outcome } };
        const { [hash]: _cleared, ...rest } = mine;
        return { ...all, [mappingId]: rest };
      });
    },
    [],
  );

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [queryKey] });
  }, [queryClient, queryKey]);

  const actIn = React.useCallback(
    (mappingId: string, hash: string, run: () => Promise<Partial<DecisionEffectFields>>) => {
      setOutcomeIn(mappingId, hash, { state: 'pending' });
      void run()
        .then((r) => {
          setOutcomeIn(mappingId, hash, { state: 'done', served: servedOf(r) });
          // Re-read rather than patch the cache: the server decides what a
          // decision did to the queue (a `keep` and an `apply` both move the
          // item to `acknowledged`, because the ledger closes the entry either
          // way), and guessing that here would be a second implementation of
          // the same rules.
          void queryClient.invalidateQueries({ queryKey: [queryKey] });
        })
        .catch((err: unknown) => {
          if (err instanceof DecisionRefusedError) {
            // The server's own words. See DecisionRefusedError.
            const { refusal } = err;
            setOutcomeIn(mappingId, hash, {
              state: 'refused',
              text: refusal.reason ?? refusal.hint ?? refusal.error,
            });
            return;
          }
          setOutcomeIn(mappingId, hash, {
            state: 'refused',
            text: err instanceof Error ? serverMessage(err) : t('common.requestFailed'),
          });
        });
    },
    [queryClient, queryKey, setOutcomeIn, t],
  );

  // Each migration's `act` and `setOutcome`, bound to it once, so a row is
  // only ever told about its own migration's items and keeps one function
  // across renders. They call through a ref, so a bound pair never holds an
  // `actIn` older than this render's.
  const actInRef = React.useRef(actIn);
  actInRef.current = actIn;
  const bound = React.useRef(new Map<string, { act: Act; setOutcome: SetOutcome }>());
  const boundTo = (mappingId: string) => {
    let pair = bound.current.get(mappingId);
    if (!pair) {
      pair = {
        act: (hash, run) => actInRef.current(mappingId, hash, run),
        setOutcome: (hash, outcome) => setOutcomeIn(mappingId, hash, outcome),
      };
      bound.current.set(mappingId, pair);
    }
    return pair;
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  // Surfaced verbatim rather than replaced with an empty queue. An empty
  // decision queue means "nothing needs you", and showing that when we simply
  // could not ask is the failure hard rule 9 exists to prevent.
  const loadFailed = error ? (
    <div className="flex items-start gap-2 p-4 mb-4 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">
      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div>
        <p className="font-medium">{t('queue.loadFailed')}</p>
        <p className="mt-1">{serverMessage(error)}</p>
      </div>
    </div>
  ) : null;

  // Nothing read yet: the failure is all there is to show.
  if (error && data === undefined) return loadFailed!;

  const mappings = Object.entries(data ?? {});

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {/* When this list was READ (0036 T1): the 30s-stale + refetch-on-focus
            policy is good but was invisible — a fresh list and a half-minute-old
            one looked identical on the screen where deletions are decided. */}
        {dataUpdatedAt > 0 && (
          <AsOf timestamp={dataUpdatedAt} onRefresh={() => void refetch()} refreshing={isFetching} />
        )}
      </div>
      <Hint className="mt-1 mb-6" label="more" text={intro} why={more} />

      {/* A read that failed AFTER one that worked (workplan 0164 T3): said
          above the rows, which stay. Replacing them took everything below
          with it, a run under way and what it had said included. The rows
          are as last read, and the time beside the title says when. */}
      {loadFailed}

      {mappings.length === 0 && <p className="text-sm text-gray-500">{t('queue.noMappings')}</p>}

      {mappings.map(([mappingId, queue]) => (
        <section key={mappingId} className="mb-8 p-4 bg-white border border-gray-200 rounded-lg">
          {/* On a phone the heading wraps and the chip keeps its words on
              one line, instead of the heading squeezing it to 'In / cutover'. */}
          <div className="flex items-start justify-between gap-3 mb-3">
            {/* The id links to its hub (0034 T1) — run history and live
                progress live there, in both editions. */}
            <h3 className="font-semibold text-gray-900 min-w-0 break-words"><MappingHubLink mappingId={mappingId} /></h3>
            <span className="flex-shrink-0 whitespace-nowrap">
              <StateChip entity="lifecycle" state={queue.migrationStatus} />
            </span>
          </div>
          {queue.reportingClosed && <ClosedBanner text={queue.reportingClosed} />}
          {LIFECYCLE_NOTE_KEY[queue.migrationStatus] && (
            <p className="mb-3 text-sm text-gray-600">
              {t(LIFECYCLE_NOTE_KEY[queue.migrationStatus]!)}
            </p>
          )}
          {renderMapping(
            mappingId,
            queue,
            boundTo(mappingId).act,
            outcomes[mappingId] ?? NO_OUTCOMES,
            boundTo(mappingId).setOutcome,
            refresh,
          )}
        </section>
      ))}
    </div>
  );
}
