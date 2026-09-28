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
 * The appliance never asks, and never reads: it has no terms, and its API has
 * no such answer. A managed deployment that does not ask (no `acceptance` in
 * the answer) shows its pages as before.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../i18n/index.tsx';
import { isSelfHost } from '../services/edition.ts';
import { serverMessage } from '../services/api.ts';
import { readAcceptance, takeSignIn, type Acceptance as AcceptanceState } from '../services/acceptance.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import Acceptance from '../pages/Acceptance.tsx';

/** One reading per organisation acted as: acceptance is recorded per organisation. */
export const acceptanceQueryKey = (tenantId: string | null) => ['acceptance', tenantId ?? ''] as const;

const AcceptanceGate: React.FC<{ readonly children: React.ReactNode }> = ({ children }) => {
  const t = useT();
  const selfhost = isSelfHost();
  const tenantId = useAuthStore((s) => s.tenantId);
  const queryClient = useQueryClient();
  const key = acceptanceQueryKey(tenantId);
  // The answer the sign-in read a moment ago, when this page is where it
  // landed: the same question is not asked twice in a row.
  const [handed] = React.useState(() => (selfhost ? undefined : takeSignIn(tenantId ?? '')));
  const reading = useQuery({
    queryKey: key,
    queryFn: readAcceptance,
    enabled: !selfhost,
    // Asked once per page load: the gate wraps the layout, which stays while
    // the pages under it change. A new version reaches a signed-in person at
    // their next load, and the doors refuse on the server's reading meanwhile.
    staleTime: 5 * 60_000,
    ...(handed ? { initialData: handed.acceptance, initialDataUpdatedAt: handed.at } : {}),
  });

  if (selfhost) return <>{children}</>;

  if (reading.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <p role="status" className="text-sm text-gray-600">
          {t('acceptance.checking')}
        </p>
      </div>
    );
  }

  if (reading.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <p role="alert" className="text-sm text-red-600">
            {t('acceptance.readFailed')} {serverMessage(reading.error)}
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
  }

  if (reading.data?.due) {
    return (
      <Acceptance
        acceptance={reading.data}
        onAccepted={(next: AcceptanceState) => queryClient.setQueryData(key, next)}
        onStale={() => void reading.refetch()}
      />
    );
  }

  return <>{children}</>;
};

export default AcceptanceGate;
