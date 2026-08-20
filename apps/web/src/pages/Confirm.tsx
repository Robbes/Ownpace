// Copyright 2026 The Ownpace authors (Apache-2.0)
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
import { useT, useLocale } from '../i18n/index.tsx';
import { formatDateTime } from '../i18n/datetime.ts';
import type { StringKey } from '../i18n/index.tsx';
import DiscoveryCounts from '../components/confirm/DiscoveryCounts.tsx';
import ScopeManifestPanel from '../components/confirm/ScopeManifestPanel.tsx';
import SharedAddresses from '../components/confirm/SharedAddresses.tsx';
// The live strip is shared with the managed hub (0033 T5) — one component,
// two data sources, same DomainStatusReport rows underneath.
import LiveProgress from '../components/LiveProgress.tsx';
import MappingHubLink from '../components/MappingHubLink.tsx';
import StateChip from '../components/StateChip.tsx';
import { serverMessage } from '../services/api.ts';
import {
  fetchAllDiscovery,
  fetchScopeManifest,
  fetchSharedAddresses,
  fetchStatus,
  startMigration,
} from '../services/operating-service.ts';

const LIFECYCLE_NOTE_KEY: Record<MappingLifecycle, StringKey | null> = {
  paused: null,
  active: 'confirm.note.active',
  cutover: 'confirm.note.cutover',
  done: 'confirm.note.done',
};

const Confirm: React.FC = () => {
  const queryClient = useQueryClient();
  const t = useT();
  const { locale } = useLocale();

  // Refetched while the page is open: an operator watching an active
  // migration should see the numbers move without pressing F5.
  const status = useQuery({ queryKey: ['status'], queryFn: fetchStatus, refetchInterval: 15_000 });
  const discovery = useQuery({
    queryKey: ['discovery'],
    queryFn: fetchAllDiscovery,
    // Discovery runs on startup and lands asynchronously. Poll until something
    // shows up, then stop — an idle appliance should not be talking to itself.
    refetchInterval: (query) =>
      Object.values(query.state.data ?? {}).some((d) => d.length > 0) ? false : 2000,
  });
  const manifest = useQuery({ queryKey: ['scope-manifest'], queryFn: fetchScopeManifest });
  // Read separately from discovery: a failure here must not hide the counts,
  // and an empty result means something different from an unread one.
  const sharedAddresses = useQuery({
    queryKey: ['shared-addresses'],
    queryFn: fetchSharedAddresses,
  });

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
        {t('common.loading')}
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
          <p className="font-medium">{t('confirm.readError')}</p>
          <p className="mt-1">
            {serverMessage(status.error)}
          </p>
        </div>
      </div>
    );
  }

  const mappings = status.data?.mappings ?? [];

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">{t('confirm.title')}</h2>
      {/* "Nothing has been copied yet" was rendered UNCONDITIONALLY until
          2026-08-09 -- above a migration that had copied 1149 items. The
          sentence this screen exists to make true is only true before the
          first start, so it now follows the lifecycle. */}
      <p className="mt-1 mb-2 text-sm text-gray-600">
        {t(
          mappings.some((m) => m.migrationStatus !== 'paused')
            ? 'confirm.introStarted'
            : 'confirm.intro',
        )}
      </p>

      {/* Once something is running, say what comes next and in what order
          (0034 T4) — the appliance nav lists these screens in cutover order,
          but nothing ever said the list IS a sequence. Same numbered framing
          as the hub. */}
      {mappings.some((m) => m.migrationStatus !== 'paused') && (
        <p className="mb-6 text-sm text-gray-600">
          {t('confirm.nextSteps')}{' '}
          {(
            [
              ['/deletions', 'nav.deletions'],
              ['/moves', 'nav.moves'],
              ['/failures', 'nav.failures'],
              ['/verify', 'nav.check'],
              ['/finish', 'nav.finish'],
            ] as const
          ).map(([href, key], i) => (
            <span key={href}>
              {i > 0 && ' → '}
              <Link to={href} className="text-blue-700 hover:underline">
                {i + 1}. {t(key)}
              </Link>
            </span>
          ))}
        </p>
      )}

      {/* The literal first screen of a fresh install (release-readiness,
          2026-08-10): a bare "no mappings" here left a new operator with no
          next step — the config-directory model is not guessable from a UI
          that deliberately has no create form (standing decision 6). */}
      {mappings.length === 0 && (
        <div className="text-sm text-gray-500 space-y-2">
          <p>{t('confirm.noMappings')}</p>
          <p>{t('confirm.noMappings.how')}</p>
        </div>
      )}

      {mappings.map((m) => {
        const domains = discovery.data?.[m.mappingId] ?? [];
        const noteKey = LIFECYCLE_NOTE_KEY[m.migrationStatus];
        return (
          <section
            key={m.mappingId}
            className="mb-8 p-4 bg-white border border-gray-200 rounded-lg"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold text-gray-900"><MappingHubLink mappingId={m.mappingId} /></h3>
              <StateChip entity="lifecycle" state={m.migrationStatus} />
            </div>

            {m.migrationStatus !== 'paused' && <LiveProgress domains={m.domains} />}

            {m.migrationStatus === 'paused' ? (
              // Before the start, the scan IS the decision input -- prominent.
              <DiscoveryCounts domains={domains} scanning={domains.length === 0} />
            ) : (
              // After the start it is a historical snapshot: the source keeps
              // changing and these numbers do not. Folded, labelled with WHEN
              // it was taken, and explained -- an operator comparing it
              // against live ledger counts (2026-08-09: 510 vs 1149) should
              // find the answer here, not in a support round trip.
              <details className="mt-1">
                <summary className="cursor-pointer text-sm text-gray-500 select-none">
                  {t('confirm.snapshot.heading')}
                  {domains[0]?.discoveredAt
                    ? ` — ${formatDateTime(domains[0].discoveredAt, locale)}`
                    : ''}
                </summary>
                <p className="mt-1 mb-2 text-xs text-gray-500">{t('confirm.snapshot.note')}</p>
                <DiscoveryCounts domains={domains} scanning={domains.length === 0} />
              </details>
            )}

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
                  {t('confirm.start')}
                </button>
              ) : (
                <p className="text-sm text-gray-700">
                  {noteKey && t(noteKey)}{' '}
                  {m.migrationStatus === 'active' && (
                    <Link to="/deletions" className="text-blue-700 hover:underline">
                      {t('confirm.openConsole')}
                    </Link>
                  )}
                </p>
              )}
              {start.isError && start.variables === m.mappingId && (
                <p className="mt-2 text-sm text-red-700" role="alert">
                  {t('confirm.startError')}{' '}
                  {serverMessage(start.error)}
                </p>
              )}
            </div>
          </section>
        );
      })}

      {/*
        Shared addresses (workplan 0027 T4). TENANT-level, so it sits beside
        the manifest rather than inside a mapping's card: info@ is the
        organisation's address, not any one mapping's. Shown here because this
        is the screen that answers "what am I actually getting" BEFORE
        anything is copied — the §14.1 promises are made two panels below.
      */}
      <section className="mb-8 p-4 bg-white border border-gray-200 rounded-lg">
        <h3 className="font-semibold text-gray-900 mb-3">{t('sharedAddresses.heading')}</h3>
        {sharedAddresses.isLoading ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : (
          <SharedAddresses
            addresses={sharedAddresses.data?.addresses ?? []}
            // A failed read must not render as "nothing found": one means we
            // could not look, the other is a claim about the organisation.
            unreadable={sharedAddresses.isError}
          />
        )}
      </section>

      {manifest.data && (
        <section className="p-4 bg-white border border-gray-200 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-3">{t('confirm.whatMigrates')}</h3>
          <ScopeManifestPanel manifest={manifest.data} />
        </section>
      )}
    </div>
  );
};

export default Confirm;
