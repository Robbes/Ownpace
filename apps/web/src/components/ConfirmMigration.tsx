// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

import React from 'react';
import DiscoveryCounts from './confirm/DiscoveryCounts.tsx';
import ScopeManifestPanel from './confirm/ScopeManifestPanel.tsx';
import { useQuery, useMutation } from '@tanstack/react-query';
import { mappingApi, scopeManifestApi } from '../services/mapping-service.ts';
import { useT } from '../i18n/index.tsx';

export interface ConfirmMigrationProps {
  readonly mappingId: string;
  /** Called after the migration is successfully started (green light given). */
  readonly onStarted: () => void;
}

/**
 * Pre-sync confirm screen (workplan 0013 T6). Kicks off read-only discovery, polls the per-domain
 * counts, shows them next to the §11.2 scope manifest, and offers the "Start migration" green light
 * that activates the (paused) mapping.
 */
export function ConfirmMigration({ mappingId, onStarted }: ConfirmMigrationProps): React.ReactElement {
  const t = useT();
  // Kick off discovery once on mount.
  React.useEffect(() => {
    void mappingApi.discover(mappingId);
  }, [mappingId]);

  const discovery = useQuery({
    queryKey: ['discovery', mappingId],
    queryFn: () => mappingApi.getDiscovery(mappingId),
    // Poll until the first pass lands.
    refetchInterval: (query) => (query.state.data?.discovered ? false : 2000),
  });

  const manifest = useQuery({
    queryKey: ['scope-manifest'],
    queryFn: () => scopeManifestApi.get(),
  });

  const startMutation = useMutation({
    mutationFn: () => mappingApi.start(mappingId),
    onSuccess: onStarted,
  });

  const domains = discovery.data?.domains ?? [];

  return (
    <div className="space-y-6">
      <div>
        {/* Localized 2026-08-09: this wizard step shipped with hardcoded
            English through 0024, unrecorded -- the recorded T5 debt names
            Dashboard/Mappings only. Keys are shared with the appliance's
            Confirm page, so the two editions' prose cannot drift. The
            "nothing has been copied yet" sentence is CORRECT here, unlike on
            the appliance page: this step only exists before the start. */}
        <h2 className="text-lg font-semibold text-gray-900">{t('confirm.title')}</h2>
        <p className="text-sm text-gray-600">{t('confirm.intro')}</p>
      </div>

      {/* Discovery counts — shared with the appliance's confirm screen. */}
      <section aria-label="discovery-counts">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{t('confirm.foundInSource')}</h3>
        <DiscoveryCounts domains={domains} scanning={!discovery.data?.discovered} />
      </section>

      {/* Scope manifest (§11.2) */}
      {manifest.data && <ScopeManifestPanel manifest={manifest.data} />}

      {startMutation.isError && (
        <p className="text-sm text-red-600" role="alert">
          {t('confirm.startError')}{' '}
          {startMutation.error instanceof Error
            ? startMutation.error.message
            : t('confirm.startErrorFallback')}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {startMutation.isPending ? t('confirm.starting') : t('confirm.start')}
        </button>
      </div>
    </div>
  );
}

export default ConfirmMigration;
