/**
 * Review & confirm, for the appliance (ADR-0026).
 *
 * This replaces `apps/selfhost/src/confirm-page.ts` — 135 lines of hand-rolled
 * HTML that were the appliance's only screen. Folding it in was the last piece
 * of the ADR: until now the appliance ran two UI technologies, and the counts
 * table lived twice in two languages, which is how the React copy came to be
 * typed against a stale `DiscoveryRecord` that dropped the adoption count.
 *
 * It lists EVERY configured mapping, because the appliance's operator holds a
 * config directory rather than a wizard — the managed edition's confirm step is
 * about the one mapping just created, which is why that one stays its own
 * component with the same presentational pieces underneath.
 *
 * Nothing here has been copied yet. That is the sentence the whole screen
 * exists to make true and visible: discovery is read-only and body-free, and
 * pressing Start is the first thing that writes anything anywhere.
 */

import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, Play } from 'lucide-react';
import { Link } from 'react-router';
import type { MappingLifecycle } from '@openmig/shared';
import DiscoveryCounts from '../components/confirm/DiscoveryCounts';
import ScopeManifestPanel from '../components/confirm/ScopeManifestPanel';
import {
  fetchAllDiscovery,
  fetchScopeManifest,
  fetchStatus,
  startMigration,
} from '../services/operating-service';

const LIFECYCLE_NOTE: Record<MappingLifecycle, string | null> = {
  paused: null,
  active: 'Running. It syncs on its schedule and reports anything that needs you.',
  cutover: 'In cutover.',
  done: 'Finished. This migration no longer syncs.',
};

const Confirm: React.FC = () => {
  const queryClient = useQueryClient();

  const status = useQuery({ queryKey: ['status'], queryFn: fetchStatus });
  const discovery = useQuery({
    queryKey: ['discovery'],
    queryFn: fetchAllDiscovery,
    // Discovery runs on startup and lands asynchronously. Poll until something
    // shows up, then stop — an idle appliance should not be talking to itself.
    refetchInterval: (query) =>
      Object.values(query.state.data ?? {}).some((d) => d.length > 0) ? false : 2000,
  });
  const manifest = useQuery({ queryKey: ['scope-manifest'], queryFn: fetchScopeManifest });

  const start = useMutation({
    mutationFn: (mappingId: string) => startMigration(mappingId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });

  if (status.isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (status.error) {
    // Surfaced rather than replaced with "no mappings configured", which would
    // read as "nothing to do" when we simply could not ask (hard rule 9).
    return (
      <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">Could not read the migrations.</p>
          <p className="mt-1">
            {status.error instanceof Error ? status.error.message : String(status.error)}
          </p>
        </div>
      </div>
    );
  }

  const mappings = status.data?.mappings ?? [];

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Review &amp; confirm your migration</h2>
      <p className="mt-1 mb-6 text-sm text-gray-600">
        Nothing has been copied yet. Review what will migrate, then start it.
      </p>

      {mappings.length === 0 && <p className="text-sm text-gray-500">No mappings configured.</p>}

      {mappings.map((m) => {
        const domains = discovery.data?.[m.mappingId] ?? [];
        const note = LIFECYCLE_NOTE[m.migrationStatus];
        return (
          <section
            key={m.mappingId}
            className="mb-8 p-4 bg-white border border-gray-200 rounded-lg"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold text-gray-900">{m.mappingId}</h3>
              <span className="text-xs text-gray-500">{m.migrationStatus}</span>
            </div>

            <DiscoveryCounts domains={domains} scanning={domains.length === 0} />

            <div className="mt-4">
              {m.migrationStatus === 'paused' ? (
                <button
                  onClick={() => start.mutate(m.mappingId)}
                  disabled={start.isPending && start.variables === m.mappingId}
                  className="inline-flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {start.isPending && start.variables === m.mappingId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  Start migration
                </button>
              ) : (
                <p className="text-sm text-gray-700">
                  {note}{' '}
                  {m.migrationStatus === 'active' && (
                    <Link to="/deletions" className="text-blue-700 hover:underline">
                      Open the migration console
                    </Link>
                  )}
                </p>
              )}
              {start.isError && start.variables === m.mappingId && (
                <p className="mt-2 text-sm text-red-700" role="alert">
                  Could not start it:{' '}
                  {start.error instanceof Error ? start.error.message : 'the request failed'}
                </p>
              )}
            </div>
          </section>
        );
      })}

      {manifest.data && (
        <section className="p-4 bg-white border border-gray-200 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-3">What migrates</h3>
          <ScopeManifestPanel manifest={manifest.data} />
        </section>
      )}
    </div>
  );
};

export default Confirm;
