// Copyright 2026 The Ownpace authors (Apache-2.0)

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

/** How often to ask, and for how long before the screen stops asking. */
const POLL_MS = 2000;
/**
 * FIVE MINUTES, then stop asking and say so.
 *
 * Not a timeout on the work — discovery keeps running server-side and the
 * counts land in the database whenever they land. This is a ceiling on the
 * POLLING, because a tab left open on a stuck domain would otherwise ask
 * thirty times a minute for ever. When it is reached the rows that arrived
 * stay on screen and the sentence under them gets longer; nothing is
 * discarded and nothing is called a failure.
 */
const POLL_CEILING_MS = 5 * 60 * 1000;

/**
 * Pre-sync confirm screen (workplan 0013 T6). Kicks off read-only discovery, polls the per-domain
 * counts, shows them next to the §11.2 scope manifest, and offers the "Start migration" green light
 * that activates the (paused) mapping.
 *
 * ## Polling stopped at the FIRST domain, not the last (2026-09-07)
 *
 * `discovered` is true as soon as ONE row exists — the route computes it as
 * `domains.length > 0`. So the poll ran until the quickest domain answered
 * and then stopped, with however many were still being counted left
 * permanently absent. The owner's four-domain migration settled on a
 * three-row table and stayed there; he found the fourth by reloading the page
 * himself.
 *
 * The right question is not "has anything landed" but "has everything this
 * migration carries landed", and only the mapping knows what it carries —
 * hence the second query. That list is the same `scope_selection` the
 * preflight job now counts (`resolveDiscoveryJob`), so the screen waits for
 * exactly the rows that are coming: no fourth row expected on a three-domain
 * migration, and no waiting for mail on one that carries none.
 *
 * A domain that answered with an error counts as landed. `lastError` is a
 * final answer and it is already shown in its row; treating it as unfinished
 * would spin for ever on the one thing that had definitely stopped.
 */
export function ConfirmMigration({ mappingId, onStarted }: ConfirmMigrationProps): React.ReactElement {
  const t = useT();
  // Kick off discovery once on mount.
  React.useEffect(() => {
    void mappingApi.discover(mappingId);
  }, [mappingId]);

  // WHAT TO WAIT FOR. Read from the mapping rather than assumed, for the same
  // reason the job reads scope_selection rather than defaulting: assuming all
  // five would leave "still counting: Email" under a migration that carries
  // no mail, waiting for a row that is never coming.
  const mapping = useQuery({
    queryKey: ['mapping', mappingId],
    queryFn: () => mappingApi.get(mappingId),
  });
  const expected = mapping.data?.syncConfig.domains;

  const startedAt = React.useRef(Date.now());
  const [gaveUp, setGaveUp] = React.useState(false);

  const discovery = useQuery({
    queryKey: ['discovery', mappingId],
    queryFn: () => mappingApi.getDiscovery(mappingId),
    refetchInterval: (query) => {
      if (Date.now() - startedAt.current > POLL_CEILING_MS) {
        // Rendering during another component's render is what React forbids;
        // this runs from the query client's own timer, well after.
        setGaveUp(true);
        return false;
      }
      // Until the mapping answers we do not know what to wait for, so keep
      // asking — stopping here would be the old bug with a new cause.
      if (!expected) return POLL_MS;
      const landed = new Set((query.state.data?.domains ?? []).map((d) => d.domain));
      return expected.every((d) => landed.has(d)) ? false : POLL_MS;
    },
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
        <DiscoveryCounts domains={domains} expected={expected} slow={gaveUp} />
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
