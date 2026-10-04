// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The data ceiling at Start (`CeilingAtStart.tsx`, workplan 0109 T6), kept out
 * of the appliance's bundle (ADR-0036): the Start screens are shared with the
 * appliance, and the note reads billing. The edition is folded at build time,
 * as `AppRoutes.tsx` folds the Billing page, so the self-host build carries
 * neither the note nor the billing client behind it.
 */
import React from 'react';

const CeilingAtStart =
  import.meta.env.VITE_EDITION === 'selfhost' ? null : React.lazy(() => import('./CeilingAtStart.tsx'));

export const CeilingAtStartNote: React.FC<{ bytes: number }> = ({ bytes }) =>
  CeilingAtStart ? (
    <React.Suspense fallback={null}>
      <CeilingAtStart bytes={bytes} />
    </React.Suspense>
  ) : null;

/** What a preflight measured, added up: rows without a size, or with an error, count as nothing. */
export function measuredBytes(
  domains: ReadonlyArray<{ readonly bytes?: number; readonly lastError?: string; readonly lastErrorWithheld?: true }>,
): number {
  return domains.reduce(
    (sum, d) => (d.lastError === undefined && d.lastErrorWithheld === undefined ? sum + (d.bytes ?? 0) : sum),
    0,
  );
}
