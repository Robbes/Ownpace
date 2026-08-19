// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The completion-report download (workplan 0047), as one component because it
 * renders in two places with one meaning: the mapping hub (a snapshot any
 * time) and the Finish screen's aftermath block (the handover document, beside
 * the permissions handover it belongs with). Client-side blob download — the
 * server never learns where the file was saved.
 */

import React from 'react';
import { useT } from '../i18n/index.tsx';
import { fetchCompletionReport } from '../services/operating-service.ts';

export const CompletionReportDownload: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  return (
    <span>
      <button
        type="button"
        className="text-sm text-blue-700 hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(null);
          fetchCompletionReport(mappingId)
            .then(({ markdown }) => {
              const blob = new Blob([markdown], { type: 'text/markdown' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `completion-report-${mappingId}.md`;
              a.click();
              URL.revokeObjectURL(url);
            })
            .catch((err: unknown) => {
              // The reason, inline and verbatim — a download button that
              // silently does nothing is a support ticket (rule 9).
              setFailed(err instanceof Error ? err.message : String(err));
            })
            .finally(() => setBusy(false));
        }}
      >
        {t('hub.completionReport')}
      </button>
      {failed && <span className="ml-2 text-sm text-amber-800">{failed}</span>}
    </span>
  );
};

export default CompletionReportDownload;
