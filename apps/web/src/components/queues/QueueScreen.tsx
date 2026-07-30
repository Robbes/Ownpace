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
import type { QueueEnvelope } from '@openmig/shared';
import { ClosedBanner, LIFECYCLE_NOTE } from './primitives';
import { DecisionRefusedError } from '../../services/operating-service';

/** What happened to one item after the operator acted on it. */
export type ItemOutcome =
  | { readonly state: 'pending' }
  | { readonly state: 'done'; readonly effect: string }
  | { readonly state: 'refused'; readonly text: string };

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
  const [outcomes, setOutcomes] = React.useState<Record<string, ItemOutcome>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: [queryKey],
    queryFn: fetcher,
    // These queues change when a pass runs, which is minutes apart at best, so
    // polling hard buys nothing. Refetching on focus is what actually matters:
    // an operator coming back to the tab should not act on a stale list.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

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
              text: err instanceof Error ? err.message : 'The request did not complete.',
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
        Loading…
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
          <p className="font-medium">Could not load this queue.</p>
          <p className="mt-1">{error instanceof Error ? error.message : String(error)}</p>
          <p className="mt-1">
            This is not the same as an empty queue — items may be waiting that we could not read.
          </p>
        </div>
      </div>
    );
  }

  const mappings = Object.entries(data ?? {});

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 mb-6 text-sm text-gray-600">{intro}</p>

      {mappings.length === 0 && <p className="text-sm text-gray-500">No mappings configured.</p>}

      {mappings.map(([mappingId, queue]) => (
        <section key={mappingId} className="mb-8 p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">{mappingId}</h3>
            <span className="text-xs text-gray-500">{queue.migrationStatus}</span>
          </div>
          {queue.reportingClosed && <ClosedBanner text={queue.reportingClosed} />}
          {LIFECYCLE_NOTE[queue.migrationStatus] && (
            <p className="mb-3 text-sm text-gray-600">{LIFECYCLE_NOTE[queue.migrationStatus]}</p>
          )}
          {renderMapping(mappingId, queue, act, outcomes)}
        </section>
      ))}
    </div>
  );
}
