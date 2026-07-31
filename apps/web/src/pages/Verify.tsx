/**
 * The §20 verification gate (ADR-0026).
 *
 * **Behind a button, deliberately.** `GET /verify` is not a status read: it
 * counts and samples the TARGET for every enabled domain, so opening this page
 * must not start it and nothing here may poll it. That is why this screen has
 * an empty state with a button rather than a spinner on mount.
 *
 * The report is rendered without softening. `NOT_VERIFIABLE` is not a pass and
 * is not a warning — it means the domain is enabled and there is no way to read
 * the target for it, so nobody has checked; `totalBytesTarget: null` means the
 * target was never measured, and is shown as "not measured" rather than as the
 * source figure, which would read as perfect byte parity that was never
 * established.
 */

import React from 'react';
import { useParams } from 'react-router';
import { AlertCircle, CheckCircle2, HelpCircle, Loader2, MinusCircle, XCircle } from 'lucide-react';
import type {
  DataTypeVerification,
  DataTypeVerificationStatus,
  VerificationResult,
  VerifyResponse,
} from '@openmig/shared';
import { startVerification, fetchVerifyReport } from '../services/operating-service';

const STATUS_STYLE: Record<DataTypeVerificationStatus, { icon: React.ReactNode; className: string; help: string }> = {
  PASS: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    className: 'text-emerald-700',
    help: 'Counts matched and the sampled content compared clean.',
  },
  WARN: {
    icon: <AlertCircle className="w-4 h-4" />,
    className: 'text-amber-700',
    help: 'Discrepancies within tolerance. Read the issues before proceeding.',
  },
  FAIL: {
    icon: <XCircle className="w-4 h-4" />,
    className: 'text-red-700',
    help: 'Items are missing on the target, or sampled content did not match.',
  },
  SKIPPED: {
    icon: <MinusCircle className="w-4 h-4" />,
    className: 'text-gray-500',
    help: 'You turned this domain off in the config. Your call, so it does not block cutover — but nobody checked it.',
  },
  NOT_VERIFIABLE: {
    icon: <HelpCircle className="w-4 h-4" />,
    className: 'text-amber-800',
    help: 'This domain IS enabled, but there is no way to read the target for it, so nothing could be checked. This blocks cutover — an unchecked domain has not passed.',
  },
};

const DOMAIN_LABEL: Record<DataTypeVerification['dataType'], string> = {
  mail: 'Email',
  calendar: 'Calendar',
  contacts: 'Contacts',
  files: 'Files',
};

function DomainRow({ d }: { d: DataTypeVerification }): React.ReactElement {
  const s = STATUS_STYLE[d.status];
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-2 pr-3 font-medium text-gray-900">{DOMAIN_LABEL[d.dataType]}</td>
      <td className="py-2 pr-3">
        <span className={`inline-flex items-center gap-1 ${s.className}`} title={s.help}>
          {s.icon}
          {d.status}
        </span>
      </td>
      <td className="py-2 pr-3 tabular-nums">{d.sourceCount.toLocaleString()}</td>
      <td className="py-2 pr-3 tabular-nums">{d.targetCount.toLocaleString()}</td>
      <td className="py-2 pr-3 tabular-nums">
        {d.missingOnTarget > 0 ? (
          <span className="text-red-700 font-medium">{d.missingOnTarget.toLocaleString()}</span>
        ) : (
          '0'
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-gray-600">
        {/*
          The checksum leg, stated honestly. `checksumUnavailable` is neither a
          match nor a mismatch — the target exposed no content hash for those
          items — and a non-zero count means this half of the gate did not
          really run for them. Reporting only matches/mismatches would hide that.
        */}
        {d.checksumSampleSize === 0
          ? '—'
          : `${d.checksumMatches}/${d.checksumSampleSize} matched` +
            (d.checksumMismatches > 0 ? `, ${d.checksumMismatches} differed` : '') +
            (d.checksumUnavailable > 0 ? `, ${d.checksumUnavailable} not comparable` : '')}
      </td>
      <td className="py-2 text-xs text-gray-600">
        {d.totalBytesTarget === null ? (
          <span title="The target exposes no per-item size, so nothing was measured on that side. Not the same as a match.">
            not measured
          </span>
        ) : (
          d.totalBytesTarget.toLocaleString()
        )}
      </td>
    </tr>
  );
}

function Report({ mappingId, r }: { mappingId: string; r: VerificationResult }): React.ReactElement {
  const domains = [r.mail, r.calendar, r.contacts, r.files];
  const issues = domains.flatMap((d) => d.issues.map((i) => ({ ...i, domain: d.dataType })));
  return (
    <section className="mb-8 p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold text-gray-900">{mappingId}</h3>
        <div className="flex items-center gap-3 text-sm">
          <span className={STATUS_STYLE[r.overallStatus].className}>{r.overallStatus}</span>
          <span className="text-gray-500">score {(r.score * 100).toFixed(1)}%</span>
        </div>
      </div>

      <div
        className={`p-3 mb-4 rounded-lg text-sm ${
          r.canProceedToCutover ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'
        }`}
      >
        {r.canProceedToCutover
          ? 'This migration is ready to cut over.'
          : 'Not ready to cut over. See the domains and issues below.'}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Result</th>
              <th className="py-2 pr-3 font-medium">On the old system</th>
              <th className="py-2 pr-3 font-medium">On the new one</th>
              <th className="py-2 pr-3 font-medium">Missing</th>
              <th className="py-2 pr-3 font-medium">Content sample</th>
              <th className="py-2 font-medium">Bytes (target)</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <DomainRow key={d.dataType} d={d} />
            ))}
          </tbody>
        </table>
      </div>

      {issues.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Issues ({issues.length})</h4>
          <ul className="space-y-1 text-sm">
            {issues.map((i) => (
              <li key={`${i.domain}-${i.id}`} className="flex items-start gap-2">
                <span
                  className={
                    i.severity === 'ERROR' ? 'text-red-700 text-xs' : 'text-amber-700 text-xs'
                  }
                >
                  {i.severity}
                </span>
                <span className="text-gray-800">{i.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.recommendations.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">What to do</h4>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-800">
            {r.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const Verify: React.FC = () => {
  // Present on the managed per-mapping route (`mappings/:mappingId/verify`),
  // absent on the appliance's flat one — `verifyPath()` needs it for the former
  // and ignores it for the latter, the same split the queue screens have.
  const { mappingId } = useParams<{ mappingId: string }>();
  const [state, setState] = React.useState<
    | { kind: 'idle' }
    | { kind: 'running'; startedAt?: string }
    | { kind: 'done'; report: VerifyResponse }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // Start + poll (workplan 0017 T5). The POST begins the scan — or joins one
  // already under way, which reads identically here — and the interval reads
  // `/verify/report`, a status endpoint that never triggers anything. The old
  // synchronous GET held a single request open behind a 15-minute timeout,
  // which any proxy between the browser and the appliance was free to cut.
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  React.useEffect(() => stopPolling, []);

  const poll = () => {
    void fetchVerifyReport(mappingId)
      .then((r) => {
        if (r.state === 'done') {
          stopPolling();
          setState({ kind: 'done', report: r.report });
        } else if (r.state === 'failed') {
          stopPolling();
          setState({ kind: 'error', message: r.error });
        } else if (r.state === 'never-run') {
          // The appliance restarted mid-run and honestly forgot. Say so rather
          // than spinning forever against a run that no longer exists.
          stopPolling();
          setState({
            kind: 'error',
            message: 'The appliance restarted while the check ran. Run it again.',
          });
        }
        // 'running': keep polling.
      })
      .catch(() => {
        // A missed poll is not a failed RUN — the appliance may be busy or the
        // laptop asleep. Keep polling; the run's own state is authoritative.
      });
  };

  const run = () => {
    setState({ kind: 'running' });
    void startVerification(mappingId)
      .then(({ report }) => {
        setState({
          kind: 'running',
          ...(report.state === 'running' ? { startedAt: report.startedAt } : {}),
        });
        stopPolling();
        pollRef.current = setInterval(poll, 3000);
        // One immediate read, so a scan that finishes fast is not stuck
        // waiting out the first interval.
        poll();
      })
      .catch((err: unknown) => {
        stopPolling();
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'The check did not start.',
        });
      });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Check the migration</h2>
      <p className="mt-1 mb-4 text-sm text-gray-600">
        Compares what the old system has against what the new one has, and samples the contents to
        confirm they match. Read-only — it never writes to either side.
      </p>

      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={run}
          disabled={state.kind === 'running'}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {state.kind === 'running' && <Loader2 className="w-4 h-4 animate-spin" />}
          {state.kind === 'done' ? 'Check again' : 'Run the check'}
        </button>
        {/*
          Said before they press it, not after. This reads the whole target and
          can take minutes on a real mailbox — an operator who is not told that
          will assume it has hung and reload.
        */}
        <span className="text-xs text-gray-500">
          Reads the whole destination — on a large mailbox this takes minutes.
        </span>
      </div>

      {state.kind === 'error' && (
        <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">The check did not complete.</p>
            <p className="mt-1">{state.message}</p>
            <p className="mt-1">
              Nothing is known about the migration&apos;s completeness either way — this is not a
              result.
            </p>
          </div>
        </div>
      )}

      {state.kind === 'done' &&
        Object.entries(state.report).map(([mappingId, r]) => (
          <Report key={mappingId} mappingId={mappingId} r={r} />
        ))}
    </div>
  );
};

export default Verify;
