// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Connections, as things you can see and re-test (workplan 0062).
 *
 * These rows have always existed — creating a mapping inserts two — but
 * nothing ever showed them, so a credential could expire and the only way to
 * find out was a failing pass. The point of this page is the **Test** button:
 * it runs the same read-only probe the wizard runs, through the builders a
 * sync pass uses, against the stored credentials, and shows the provider's
 * own words.
 *
 * A refusal is an ANSWER here, not an error state: "your refresh token was
 * revoked" is exactly what somebody came to find out, so it renders as text
 * rather than a toast that disappears.
 */

import React from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, HelpCircle, Loader2 } from 'lucide-react';
import {
  connectionsApi,
  type ConnectionSummary,
  type TestConnectionResult,
} from '../services/mapping-service';
import { useT, useFormatters } from '../i18n';

const StatusIcon: React.FC<{ status: ConnectionSummary['status'] }> = ({ status }) => {
  if (status === 'connected') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  if (status === 'error') return <XCircle className="w-4 h-4 text-red-600" />;
  return <HelpCircle className="w-4 h-4 text-gray-400" />;
};

const Row: React.FC<{ connection: ConnectionSummary }> = ({ connection }) => {
  const t = useT();
  const { relativeToNow } = useFormatters();
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<TestConnectionResult | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await connectionsApi.test(connection.id));
    } catch (err) {
      setResult({ ok: false, reason: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <li className="border border-gray-200 rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusIcon status={connection.status} />
        <span className="font-medium text-gray-900">{connection.displayName}</span>
        <span className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
          {connection.kind}
        </span>
        <span className="text-sm text-gray-500">
          {connection.usedByMailboxes} {t('connections.usedBy')}
        </span>
        <span className="text-xs text-gray-400">{relativeToNow(connection.createdAt)}</span>

        <div className="ml-auto flex items-center gap-3">
          {/* The prerequisites for this provider, in case the answer is
              "somebody has to re-authorise the app". */}
          <Link
            to={`/setup/${connection.role}/${connection.kind}`}
            className="text-sm text-blue-700 hover:underline"
          >
            {t('connections.setupSteps')}
          </Link>
          <button
            type="button"
            onClick={test}
            disabled={testing}
            className="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {testing && <Loader2 className="w-3 h-3 animate-spin" />}
            {testing ? t('connections.testing') : t('connections.test')}
          </button>
        </div>
      </div>

      {result && (
        <p
          className={`mt-3 text-sm ${result.ok ? 'text-green-800 bg-green-50 border-green-200' : 'text-amber-900 bg-amber-50 border-amber-200'} border rounded p-2`}
        >
          {/* Verbatim, both ways: the provider's sentence is the whole value. */}
          {result.ok ? (result.detail ?? t('connections.ok')) : (result.reason ?? t('connections.failed'))}
        </p>
      )}
    </li>
  );
};

const Connections: React.FC = () => {
  const t = useT();
  const { data, isLoading, error } = useQuery<ConnectionSummary[]>({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
  });

  if (isLoading) return <div className="p-6 text-gray-500">{t('common.loading')}</div>;
  if (error) return <div className="p-6 text-red-700">{String(error)}</div>;

  const sources = (data ?? []).filter((c) => c.role === 'source');
  const targets = (data ?? []).filter((c) => c.role === 'target');

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-xl font-semibold text-gray-900">{t('connections.title')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('connections.intro')}</p>

      {(data ?? []).length === 0 ? (
        <p className="mt-6 text-gray-600">{t('connections.none')}</p>
      ) : (
        <>
          <h3 className="mt-6 font-medium text-gray-900">{t('connections.sources')}</h3>
          <ul className="mt-2 space-y-3">
            {sources.map((c) => (
              <Row key={c.id} connection={c} />
            ))}
          </ul>

          <h3 className="mt-6 font-medium text-gray-900">{t('connections.targets')}</h3>
          <ul className="mt-2 space-y-3">
            {targets.map((c) => (
              <Row key={c.id} connection={c} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default Connections;
