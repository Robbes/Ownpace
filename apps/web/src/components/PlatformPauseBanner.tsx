// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * "We have paused copying" — where a customer will actually meet it.
 *
 * A hold is platform-wide, so it does not belong on one migration's row: it
 * renders once, above whatever screen the person is on. Every OTHER pause has
 * a place already (a data type's own line in the progress strip), and this one
 * has none — which is exactly why, before this, a drain was invisible.
 *
 * The shape is `NotificationChannelBanner`'s, deliberately: an amber note at
 * the top of the page, `role="note"`, nothing when there is nothing to say. A
 * second banner shape would make two kinds of platform news look like two
 * kinds of thing.
 *
 * A failed read renders NOTHING rather than an alarming banner — "we could
 * not ask" is not "we are holding", and this component must not become a
 * second way to be wrong about the same question. `retry: false` for the same
 * reason.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPlatformPause } from '../services/platform-service.ts';
import PausedBecause from './PausedBecause.tsx';

export function PlatformPauseBanner(): React.ReactElement | null {
  const { data } = useQuery({
    queryKey: ['platform-pause'],
    queryFn: fetchPlatformPause,
    retry: false,
    // A hold is lifted by a person, and the screen it explains is one people
    // sit on. A minute is the same cadence the tick runs at, so the banner
    // clears at about the moment passes start again.
    refetchInterval: 60_000,
  });

  if (!data?.held || !data.since) return null;

  return (
    <PausedBecause
      variant="banner"
      reason={{
        kind: 'operator-hold',
        since: data.since,
        ...(data.message ? { message: data.message } : {}),
      }}
    />
  );
}

export default PlatformPauseBanner;
