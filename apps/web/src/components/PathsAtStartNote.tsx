// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The question at *Start* (`PathsAtStart.tsx`, workplan 0109 T6, the path
 * axis), kept out of the appliance's bundle (ADR-0036), as
 * `CeilingAtStartNote` keeps the data ceiling's note: the Start screens are
 * shared with the appliance, and the question reads billing. The self-host
 * build carries neither, and never asks, so its *Start* stays as it is.
 */
import React from 'react';
import type { PathsAtStartProps } from './PathsAtStart.tsx';

const PathsAtStart =
  import.meta.env.VITE_EDITION === 'selfhost' ? null : React.lazy(() => import('./PathsAtStart.tsx'));

export const PathsAtStartNote: React.FC<PathsAtStartProps> = (props) =>
  PathsAtStart ? (
    <React.Suspense fallback={null}>
      <PathsAtStart {...props} />
    </React.Suspense>
  ) : null;
