// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import React from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  FolderGit2,
  Plus,
  MoreVertical as _MoreVertical,
  Play,
  Pause as _Pause,
  Trash2,
  Edit,
  AlertCircle
} from 'lucide-react';
import { mappingApi } from '../services/mapping-service';
import { serverMessage } from '../services/api';
import StateChip from '../components/StateChip';
import { useT, useFormatters } from '../i18n';

const Mappings: React.FC = () => {
  const t = useT();
  const { relativeToNow } = useFormatters();
  const { data: mappings, isLoading, error, refetch } = useQuery({
    queryKey: ['mappings'],
    queryFn: mappingApi.list,
  });

  // Per-row sync outcome (0033 T3). The old handleSync caught failures with
  // console.error only — the operator who clicked saw nothing. A refusal now
  // renders under the row with the server's words verbatim (the 409 for a
  // paused mapping names what to do); success clears the marker and the
  // refetched row is the feedback.
  const [syncOutcomes, setSyncOutcomes] = React.useState<
    Record<string, { state: 'pending' } | { state: 'failed'; text: string }>
  >({});

  const handleSync = async (mappingId: string, type: 'full' | 'delta') => {
    setSyncOutcomes((o) => ({ ...o, [mappingId]: { state: 'pending' } }));
    try {
      await mappingApi.triggerSync(mappingId, type);
      setSyncOutcomes((o) => {
        const { [mappingId]: _done, ...rest } = o;
        return rest;
      });
      refetch();
    } catch (error) {
      setSyncOutcomes((o) => ({
        ...o,
        [mappingId]: { state: 'failed', text: serverMessage(error) },
      }));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('mappings.title')}</h1>
          <p className="text-gray-500 mt-1">{t('mappings.subtitle')}</p>
        </div>
        <Link
          to="/mappings/new"
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5 mr-2" />
          {t('mappings.new')}
        </Link>
      </div>

      {/* Failed read ≠ empty list (hard rule 9 / 0033 T2). Before this branch
          existed, a failed fetch fell through `mappings?.length === 0`
          (undefined ≠ 0) into the table branch and rendered empty headers — "no
          mappings" said about a list we could not read. That masking is what
          hid the T1 schema break for as long as it existed. */}
      {error != null ? (
        <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t('mappings.loadFailed')}</p>
            <p className="mt-1">{serverMessage(error)}</p>
            <p className="mt-1">{t('mappings.loadFailedNotEmpty')}</p>
          </div>
        </div>
      ) : mappings?.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <FolderGit2 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t('mappings.empty.title')}</h3>
          <p className="text-gray-500 mb-6">{t('mappings.empty.hint')}</p>
          <Link
            to="/mappings/new"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5 mr-2" />
            {t('mappings.empty.cta')}
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('mappings.th.name')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('mappings.th.sourceTarget')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('mappings.th.status')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('mappings.th.lastSync')}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('mappings.th.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {mappings?.map((mapping) => (
                <React.Fragment key={mapping.id}>
                <tr className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <FolderGit2 className="w-6 h-6 text-blue-600" />
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{mapping.name}</div>
                        <div className="text-sm text-gray-500">
                          {mapping.domains.join(', ')}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-gray-900">
                      <span className="font-medium">{mapping.sourceType}</span>
                      <span className="mx-2 text-gray-400">→</span>
                      <span className="font-medium">{mapping.targetType}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {/* The canonical lifecycle words, translated — StateChip
                        (0035 T1). 'error' is not a mapping state and never
                        arrives; failures live on the runs and failure queues. */}
                    <StateChip entity="lifecycle" state={mapping.status} />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {mapping.lastSyncAt
                      ? relativeToNow(mapping.lastSyncAt)
                      : t('mappings.never')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end space-x-2">
                      {mapping.status === 'active' ? (
                        <button
                          onClick={() => handleSync(mapping.id, 'delta')}
                          disabled={syncOutcomes[mapping.id]?.state === 'pending'}
                          className="text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={t('mappings.action.triggerSync')}
                        >
                          <Play className="w-5 h-5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSync(mapping.id, 'full')}
                          disabled={syncOutcomes[mapping.id]?.state === 'pending'}
                          className="text-green-600 hover:text-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={t('mappings.action.startSync')}
                        >
                          <Play className="w-5 h-5" />
                        </button>
                      )}
                      <Link
                        to={`/mappings/${mapping.id}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <Edit className="w-5 h-5" />
                      </Link>
                      <button
                        className="text-red-600 hover:text-red-800"
                        title={t('mappings.action.delete')}
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
                {syncOutcomes[mapping.id]?.state === 'failed' && (
                  <tr>
                    <td colSpan={5} className="px-6 py-2 bg-red-50 text-sm text-red-800">
                      {/* The server's refusal verbatim — for a paused mapping
                          the 409 names what to do next. */}
                      <span className="font-medium">{t('mappings.syncFailed')}</span>{' '}
                      {(syncOutcomes[mapping.id] as { text: string }).text}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Mappings;
