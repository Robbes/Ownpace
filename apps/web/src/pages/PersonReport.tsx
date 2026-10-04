// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PERSON'S REPORT: EACH OF THEIR MIGRATIONS, ONE SECTION EACH (workplan 0154 T5).
 *
 * `/people/:personId/report`, linked from the person's page: what a move did,
 * migration by migration, in the same section a migration's own report page
 * draws (`MigrationReport`), each with its own download and its own page.
 *
 * Each migration's report is read on its own, so one that could not be read
 * says so in its section and the others still stand. A person the people read
 * does not hold is said as that, never as a person with nothing moved.
 */
import React from 'react';
import { Link, useParams } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { fetchPeople, fetchVerifyReport } from '../services/operating-service.ts';
import { fetchReport } from '../services/report-service.ts';
import { serverMessage } from '../services/api.ts';
import { MigrationReport } from '../components/MigrationReport.tsx';
import CompletionReportDownload from '../components/CompletionReportDownload.tsx';
import { useT } from '../i18n/index.tsx';

const PersonReport: React.FC = () => {
  const { personId } = useParams<{ personId: string }>();
  const t = useT();
  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople });
  const person = people.data?.people.find((p) => p.id === personId);
  const ids = person?.migrations.map((m) => m.id) ?? [];
  const reports = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['report', id],
      queryFn: () => fetchReport(id),
      retry: false,
    })),
  });
  const checks = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['verify-report', id],
      queryFn: () => fetchVerifyReport(id),
      retry: false,
    })),
  });

  const back = personId ? (
    <Link to={`/people/${encodeURIComponent(personId)}`} className="text-sm text-blue-700 hover:underline">
      ← {person?.displayName ?? t('people.implicit')}
    </Link>
  ) : null;

  if (people.isPending) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }
  if (people.error != null) {
    return (
      <div role="alert" className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">{t('person.loadFailed')}</p>
          <p className="mt-1">{serverMessage(people.error)}</p>
        </div>
      </div>
    );
  }
  if (!person) return <p className="text-gray-700">{t('person.notFound')}</p>;

  return (
    <div className="space-y-6">
      {back}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {t('migrationReport.person.title', { name: person.displayName ?? t('people.implicit') })}
        </h1>
        <p className="mt-1 text-sm text-gray-600">{t('migrationReport.lead')}</p>
      </div>
      {person.migrations.length === 0 && <p className="text-sm text-gray-500">{t('people.noneYet')}</p>}
      {person.migrations.map((m, i) => {
        const read = reports[i];
        const check = checks[i];
        const id = encodeURIComponent(m.id);
        return (
          <section
            key={m.id}
            aria-labelledby={`report-${m.id}`}
            className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`report-${m.id}`} className="text-lg font-semibold text-gray-900">
                <Link to={`/mappings/${id}/report`} className="hover:underline">
                  {read?.data?.report.name ?? t('migrationReport.title')}
                </Link>
              </h2>
              <CompletionReportDownload mappingId={m.id} />
            </div>
            <div className="mt-3">
              {read?.isPending && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
              {read?.error != null && (
                <p role="alert" className="text-sm text-red-800">
                  {t('migrationReport.loadFailed')} {serverMessage(read.error)}
                </p>
              )}
              {read?.data && (
                <MigrationReport
                  report={read.data.report}
                  check={check?.isSuccess ? check.data : undefined}
                  level={3}
                />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default PersonReport;
