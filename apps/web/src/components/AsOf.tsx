// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * "As of when" — the label that ends the Windows weekend's most expensive
 * species of confusion: a number on screen with no statement of when it was
 * read (workplan 0036 T1).
 *
 * Renders the moment the data was READ (react-query's `dataUpdatedAt` is the
 * honest source at the query screens) as a relative time that re-renders
 * every minute, plus an optional manual refresh — the queue screens' 30s
 * staleTime + refetch-on-focus policy is good but invisible; this makes it a
 * visible fact and gives the operator a handle. Hard rule 9 both ways: the
 * label states what IS known and never implies freshness polling does not
 * provide.
 */
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useT, useFormatters } from '../i18n/index.tsx';

const AsOf: React.FC<{
  /** Epoch ms (react-query's dataUpdatedAt) or ISO string. */
  timestamp: number | string;
  onRefresh?: () => void;
  refreshing?: boolean;
}> = ({ timestamp, onRefresh, refreshing }) => {
  const t = useT();
  const { relativeToNow } = useFormatters();
  // Re-render each minute so "1 minute ago" does not silently stay true-once.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="inline-flex items-center gap-2 text-xs text-gray-500">
      <span>
        {t('asof.updated')} {relativeToNow(new Date(timestamp))}
      </span>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          {t('asof.refresh')}
        </button>
      )}
    </span>
  );
};

export default AsOf;
