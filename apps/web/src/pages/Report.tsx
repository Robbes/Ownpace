// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MIGRATION'S REPORT, AS A PAGE (workplan 0154 T5).
 *
 * `/mappings/:mappingId/report`, on both editions: the completion report
 * (0047) in the reader's language (`MigrationReport`), its download beside
 * it, and the confirmed list one link away. The two say different things and
 * point at each other: the report what happened, the confirmed list what is
 * verified, item by item.
 *
 * A report that could not be read says so, with the server's words; it never
 * draws an empty page that reads as a migration with nothing in it (hard rule
 * 9). The check is read beside it, and a check that could not be read is said
 * as that inside the report, not as one that never ran.
 */
import React from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { fetchReport } from '../services/report-service.ts';
import { fetchVerifyReport } from '../services/operating-service.ts';
import { serverMessage } from '../services/api.ts';
import { MigrationReport } from '../components/MigrationReport.tsx';
import CompletionReportDownload from '../components/CompletionReportDownload.tsx';
import { useT } from '../i18n/index.tsx';

const Report: React.FC = () => {
  const { mappingId } = useParams<{ mappingId: string }>();
  const t = useT();
  const report = useQuery({
    queryKey: ['report', mappingId],
    queryFn: () => fetchReport(mappingId!),
    enabled: Boolean(mappingId),
    retry: false,
  });
  const check = useQuery({
    queryKey: ['verify-report', mappingId],
    queryFn: () => fetchVerifyReport(mappingId),
    enabled: Boolean(mappingId),
    retry: false,
  });
  if (!mappingId) return <p className="text-sm text-amber-800">{t('hub.noId')}</p>;
  const id = encodeURIComponent(mappingId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">
          {report.data?.report.name ?? t('migrationReport.title')}
        </h1>
        <CompletionReportDownload mappingId={mappingId} />
      </div>
      <p className="text-sm text-gray-600">{t('migrationReport.lead')}</p>
      {report.isPending && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      )}
      {report.error != null && (
        <div role="alert" className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t('migrationReport.loadFailed')}</p>
            <p className="mt-1">{serverMessage(report.error)}</p>
          </div>
        </div>
      )}
      {report.data && (
        <MigrationReport report={report.data.report} check={check.isSuccess ? check.data : undefined} />
      )}
      <p className="text-sm">
        <Link to={`/mappings/${id}/confirmed`} className="text-blue-700 hover:underline">
          {t('migrationReport.toConfirmed')} →
        </Link>
      </p>
    </div>
  );
};

export default Report;
