// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The acceptance screen in front of every signed-in page (workplan 0139 T3).
 *
 * Wraps the signed-in part of the route table. While `GET /api/me` says
 * acceptance is due, it renders the acceptance screen instead of the page, so
 * the screen comes after sign-in and before any other page, comes back when a
 * text gets a new version, and meets an invited member at their first
 * sign-in, after they joined (0099): every one of those arrives at a signed-in
 * page, and this stands in front of all of them. The invitation screen and the
 * sign-in pages are outside it, because joining comes first and acceptance is
 * per organisation.
 *
 * Nothing is shown before the answer is in: a page that flashed and then gave
 * way would be the page "before" the screen. A read that fails is said, with a
 * way to ask again, and never taken for "nothing due" (hard rule 9). The server
 * refuses every door that stores a credential on the same reading, so this is
 * the notice and not the lock.
 *
 * ## Only a bundle built for the Alpha asks on load (review of 2026-09-29)
 *
 * The deployment that asks is the Alpha's (`OWNPACE_STAGE=alpha`), and its
 * bundle knows it: `VITE_OWNPACE_STAGE`, baked in at build, held in step with
 * the API's setting by `scripts/an-alpha-both-halves-know-about.unit.test.ts`.
 * Any other managed bundle (the OTA stack, a developer's, CI) renders its
 * pages as before: no wait on `GET /api/me`, and no page withheld when that
 * read fails. The appliance never asks, and never reads: it has no terms, and
 * its API has no such answer.
 *
 * ## A door's refusal brings the screen up at once
 *
 * The answer is read once per page load: this wraps the layout, which stays
 * while the pages under it change. So a text that gets a new version while
 * somebody has the app open reaches them as a door's 409
 * `conditions_not_accepted`, which the app's client reports
 * (`conditions-refused.ts`). This reads again at once, and shows the screen.
 * A bundle not built for the Alpha starts asking at that refusal too, so a
 * bundle that was not told still shows the screen the API asks for.
 *
 * The page a refusal interrupts stays mounted underneath, hidden, so what
 * somebody had typed into it (a wizard, a form) is there when the
 * texts are accepted and the page comes back. A page never shown yet is not
 * rendered until the answer allows it, as above.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../i18n/index.tsx';
import { isSelfHost } from '../services/edition.ts';
import {
  acceptanceFailure,
  readAcceptance,
  takeSignIn,
  type Acceptance as AcceptanceState,
} from '../services/acceptance.ts';
import { onConditionsNotAccepted } from '../services/conditions-refused.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { isAlpha } from './AlphaNote.tsx';
import Acceptance from '../pages/Acceptance.tsx';

/** One reading per organisation acted as: acceptance is recorded per organisation. */
export const acceptanceQueryKey = (tenantId: string | null) => ['acceptance', tenantId ?? ''] as const;

const AcceptanceGate: React.FC<{ readonly children: React.ReactNode }> = ({ children }) => {
  const t = useT();
  const selfhost = isSelfHost();
  const tenantId = useAuthStore((s) => s.tenantId);
  const queryClient = useQueryClient();
  const key = acceptanceQueryKey(tenantId);

  // A door answered 409 conditions_not_accepted: ask now, whatever the bundle.
  const [refused, setRefused] = React.useState(false);
  React.useEffect(() => {
    if (selfhost) return undefined;
    return onConditionsNotAccepted(() => {
      setRefused(true);
      void queryClient.invalidateQueries({ queryKey: ['acceptance'] });
    });
  }, [selfhost, queryClient]);

  const asks = !selfhost && (isAlpha() || refused);

  // The answer the sign-in read a moment ago, when this page is where it
  // landed: the same question is not asked twice in a row.
  const [handed] = React.useState(() => (asks ? takeSignIn(tenantId ?? '') : undefined));
  const reading = useQuery({
    queryKey: key,
    queryFn: readAcceptance,
    enabled: asks,
    // Asked once per page load, and again when a door refuses (above).
    staleTime: 5 * 60_000,
    ...(handed ? { initialData: handed.acceptance, initialDataUpdatedAt: handed.at } : {}),
  });

  // What stands in front of the page, if anything.
  let front: React.ReactNode = null;
  if (asks && reading.isPending) {
    front = (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <p role="status" className="text-sm text-gray-600">
          {t('acceptance.checking')}
        </p>
      </div>
    );
  } else if (asks && reading.isError) {
    front = (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <p role="alert" className="text-sm text-red-600">
            {t('acceptance.readFailed')} {acceptanceFailure(reading.error, 'read', t)}
          </p>
          <button
            type="button"
            onClick={() => void reading.refetch()}
            className="text-sm text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            {t('acceptance.retry')}
          </button>
        </div>
      </div>
    );
  } else if (asks && reading.data?.due) {
    front = (
      <Acceptance
        acceptance={reading.data}
        onAccepted={(next: AcceptanceState) => queryClient.setQueryData(key, next)}
        onStale={() => void reading.refetch()}
      />
    );
  }

  // Once the page has been shown, it stays mounted behind whatever stands in
  // front of it, so nothing typed into it is lost.
  const [pageShown, setPageShown] = React.useState(front === null);
  React.useEffect(() => {
    if (front === null && !pageShown) setPageShown(true);
  }, [front, pageShown]);
  const renderPage = front === null || pageShown;

  return (
    <>
      {renderPage && (
        // `display: none` takes it out of sight, out of the tab order and out
        // of the accessibility tree at once; `contents` adds no box of its own.
        <div style={{ display: front === null ? 'contents' : 'none' }}>{children}</div>
      )}
      {front}
    </>
  );
};

export default AcceptanceGate;
