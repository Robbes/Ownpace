// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The scaffolding every decision-queue screen shares: fetch state, the
 * per-mapping split, and the decision bookkeeping (ADR-0026).
 *
 * Decisions are tracked per item rather than per screen because they are
 * per-item actions: one refusal must not blank out the queue, and one success
 * must not imply anything about the row next to it. `applyDeletion` in
 * particular is designed to be used one confirmed item at a time, and a UI that
 * reported its outcome globally would be describing something the API does not
 * do.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { ApplyReceipt, QueueEnvelope } from '@openmig/shared';
import { ClosedBanner, LIFECYCLE_NOTE_KEY } from './primitives.tsx';
import MappingHubLink from '../MappingHubLink.tsx';
import StateChip from '../StateChip.tsx';
import AsOf from '../AsOf.tsx';
import { useT } from '../../i18n/index.tsx';
import { DecisionRefusedError } from '../../services/operating-service.ts';

/**
 * What happened to one item after the operator acted on it.
 *
 * `receipt` is the managed apply's temporal shape (workplan 0019 T2): the
 * outcome is a lifecycle the Deletions screen polls to a terminal state, not a
 * single reply. Other queues never produce it.
 */
export type ItemOutcome =
  | { readonly state: 'pending' }
  | { readonly state: 'done'; readonly effect: string }
  | { readonly state: 'refused'; readonly text: string }
  | { readonly state: 'receipt'; readonly receipt: ApplyReceipt };

export interface QueueScreenProps<T extends QueueEnvelope> {
  readonly title: string;
  readonly intro: string;
  readonly queryKey: string;
  readonly fetcher: () => Promise<Readonly<Record<string, T>>>;
  readonly renderMapping: (
    mappingId: string,
    queue: T,
    act: (hash: string, run: () => Promise<{ effect: string }>) => void,
    outcomes: Readonly<Record<string, ItemOutcome>>,
    /** Direct outcome control, for flows `act` cannot model (the apply receipt). */
    setOutcome: (hash: string, outcome: ItemOutcome) => void,
    /** Re-read the queue from the server (never patch the cache by hand). */
    refresh: () => void,
  ) => React.ReactNode;
}

export function QueueScreen<T extends QueueEnvelope>({
  title,
  intro,
  queryKey,
  fetcher,
  renderMapping,
}: QueueScreenProps<T>): React.ReactElement {
  const queryClient = useQueryClient();
  const t = useT();
  const [outcomes, setOutcomes] = React.useState<Record<string, ItemOutcome>>({});

  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: [queryKey],
    queryFn: fetcher,
    // These queues change when a pass runs, which is minutes apart at best, so
    // polling hard buys nothing. Refetching on focus is what actually matters:
    // an operator coming back to the tab should not act on a stale list.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const setOutcome = React.useCallback((hash: string, outcome: ItemOutcome) => {
    setOutcomes((o) => ({ ...o, [hash]: outcome }));
  }, []);

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [queryKey] });
  }, [queryClient, queryKey]);

  const act = React.useCallback(
    (hash: string, run: () => Promise<{ effect: string }>) => {
      setOutcomes((o) => ({ ...o, [hash]: { state: 'pending' } }));
      void run()
        .then((r) => {
          setOutcomes((o) => ({ ...o, [hash]: { state: 'done', effect: r.effect } }));
          // Re-read rather than patch the cache: the server decides what a
          // decision did to the queue (a `keep` moves an item to
          // `acknowledged`, an `apply` removes it), and guessing that here
          // would be a second implementation of the same rules.
          void queryClient.invalidateQueries({ queryKey: [queryKey] });
        })
        .catch((err: unknown) => {
          if (err instanceof DecisionRefusedError) {
            // The server's own words. See DecisionRefusedError.
            const { refusal } = err;
            setOutcomes((o) => ({
              ...o,
              [hash]: {
                state: 'refused',
                text: refusal.reason ?? refusal.hint ?? refusal.error,
              },
            }));
            return;
          }
          setOutcomes((o) => ({
            ...o,
            [hash]: {
              state: 'refused',
              text: err instanceof Error ? err.message : t('common.requestFailed'),
            },
          }));
        });
    },
    [queryClient, queryKey],
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  if (error) {
    // Surfaced verbatim rather than replaced with an empty queue. An empty
    // decision queue means "nothing needs you", and showing that when we simply
    // could not ask is the failure hard rule 9 exists to prevent.
    return (
      <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">{t('queue.loadFailed')}</p>
          <p className="mt-1">{error instanceof Error ? error.message : String(error)}</p>
          <p className="mt-1">{t('queue.loadFailedNotEmpty')}</p>
        </div>
      </div>
    );
  }

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
      <p className="mt-1 mb-6 text-sm text-gray-600">{intro}</p>

      {mappings.length === 0 && <p className="text-sm text-gray-500">{t('queue.noMappings')}</p>}

      {mappings.map(([mappingId, queue]) => (
        <section key={mappingId} className="mb-8 p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            {/* The id links to its hub (0034 T1) — run history and live
                progress live there, in both editions. */}
            <h3 className="font-semibold text-gray-900"><MappingHubLink mappingId={mappingId} /></h3>
            <StateChip entity="lifecycle" state={queue.migrationStatus} />
          </div>
          {queue.reportingClosed && <ClosedBanner text={queue.reportingClosed} />}
          {LIFECYCLE_NOTE_KEY[queue.migrationStatus] && (
            <p className="mb-3 text-sm text-gray-600">
              {t(LIFECYCLE_NOTE_KEY[queue.migrationStatus]!)}
            </p>
          )}
          {renderMapping(mappingId, queue, act, outcomes, setOutcome, refresh)}
        </section>
      ))}
    </div>
  );
}
