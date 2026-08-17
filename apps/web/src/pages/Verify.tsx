// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import { useT, useFormatters } from '../i18n';
import { isSelfHost } from '../services/edition';
import MappingHubLink from '../components/MappingHubLink';
import type { StringKey } from '../i18n';
import { serverMessage } from '../services/api';

// The status WORD (PASS/FAIL/…) stays the server's vocabulary; the hover help
// is client prose and translates (workplan 0024 T2).
const STATUS_STYLE: Record<DataTypeVerificationStatus, { icon: React.ReactNode; className: string; helpKey: StringKey }> = {
  PASS: { icon: <CheckCircle2 className="w-4 h-4" />, className: 'text-emerald-700', helpKey: 'verify.help.PASS' },
  WARN: { icon: <AlertCircle className="w-4 h-4" />, className: 'text-amber-700', helpKey: 'verify.help.WARN' },
  FAIL: { icon: <XCircle className="w-4 h-4" />, className: 'text-red-700', helpKey: 'verify.help.FAIL' },
  SKIPPED: { icon: <MinusCircle className="w-4 h-4" />, className: 'text-gray-500', helpKey: 'verify.help.SKIPPED' },
  NOT_VERIFIABLE: { icon: <HelpCircle className="w-4 h-4" />, className: 'text-amber-800', helpKey: 'verify.help.NOT_VERIFIABLE' },
};

// Reuses the queue screens' domain keys — one vocabulary, one translation.
const DOMAIN_KEY: Record<DataTypeVerification['dataType'], StringKey> = {
  mail: 'domain.email',
  calendar: 'domain.calendar',
  contacts: 'domain.contact',
  files: 'domain.file',
};

function DomainRow({ d }: { d: DataTypeVerification }): React.ReactElement {
  const t = useT();
  const { number } = useFormatters();
  const s = STATUS_STYLE[d.status];
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-2 pr-3 font-medium text-gray-900">{t(DOMAIN_KEY[d.dataType])}</td>
      <td className="py-2 pr-3">
        <span className={`inline-flex items-center gap-1 ${s.className}`} title={t(s.helpKey)}>
          {s.icon}
          {d.status}
        </span>
      </td>
      <td className="py-2 pr-3 tabular-nums">{number(d.sourceCount)}</td>
      <td className="py-2 pr-3 tabular-nums">{number(d.targetCount)}</td>
      <td className="py-2 pr-3 tabular-nums">
        {d.missingOnTarget > 0 ? (
          <span className="text-red-700 font-medium">{number(d.missingOnTarget)}</span>
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
          : `${d.checksumMatches}/${d.checksumSampleSize} ${t('verify.matched')}` +
            (d.checksumMismatches > 0 ? `, ${d.checksumMismatches} ${t('verify.differed')}` : '') +
            (d.checksumUnavailable > 0 ? `, ${d.checksumUnavailable} ${t('verify.notComparable')}` : '')}
      </td>
      <td className="py-2 text-xs text-gray-600">
        {d.totalBytesTarget === null ? (
          <span title={t('verify.notMeasured.title')}>{t('verify.notMeasured')}</span>
        ) : (
          number(d.totalBytesTarget)
        )}
      </td>
    </tr>
  );
}

function Report({ mappingId, r }: { mappingId: string; r: VerificationResult }): React.ReactElement {
  const t = useT();
  const domains = [r.mail, r.calendar, r.contacts, r.files];
  const issues = domains.flatMap((d) => d.issues.map((i) => ({ ...i, domain: d.dataType })));
  return (
    <section className="mb-8 p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold text-gray-900"><MappingHubLink mappingId={mappingId} /></h3>
        <div className="flex items-center gap-3 text-sm">
          <span className={STATUS_STYLE[r.overallStatus].className}>{r.overallStatus}</span>
          <span className="text-gray-500">{t('verify.score')} {(r.score * 100).toFixed(1)}%</span>
        </div>
      </div>

      <div
        className={`p-3 mb-4 rounded-lg text-sm ${
          r.canProceedToCutover ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'
        }`}
      >
        {r.canProceedToCutover ? t('verify.ready') : t('verify.notReady')}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-3 font-medium">{t('verify.th.type')}</th>
              <th className="py-2 pr-3 font-medium">{t('verify.th.result')}</th>
              <th className="py-2 pr-3 font-medium">{t('verify.th.source')}</th>
              <th className="py-2 pr-3 font-medium">{t('verify.th.target')}</th>
              <th className="py-2 pr-3 font-medium">{t('verify.th.missing')}</th>
              <th className="py-2 pr-3 font-medium">{t('verify.th.sample')}</th>
              <th className="py-2 font-medium">{t('verify.th.bytes')}</th>
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
          <h4 className="text-sm font-semibold text-gray-900 mb-2">{t('verify.issues')} ({issues.length})</h4>
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
          <h4 className="text-sm font-semibold text-gray-900 mb-2">{t('verify.whatToDo')}</h4>
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
  const t = useT();
  const { dateTime } = useFormatters();
  const [state, setState] = React.useState<
    | { kind: 'idle' }
    | { kind: 'running'; startedAt?: string }
    | { kind: 'done'; report: VerifyResponse; finishedAt?: string }
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

  // Navigation must not cost a re-scan (0038 T6): both servers RETAIN the
  // last run, and the report endpoint is a documented safe status read — it
  // starts nothing. On mount, read it once: a stored done report renders
  // (labelled with its as-of, which is what keeps that honest), a running
  // scan is rejoined and polled. 'never-run' and a failed mount read stay
  // idle — the screen still touches nothing the operator did not ask for.
  React.useEffect(() => {
    let cancelled = false;
    void fetchVerifyReport(mappingId)
      .then((r) => {
        if (cancelled) return;
        if (r.state === 'done') {
          setState({ kind: 'done', report: r.report, finishedAt: r.finishedAt });
        } else if (r.state === 'running') {
          setState({ kind: 'running', ...(r.startedAt ? { startedAt: r.startedAt } : {}) });
          stopPolling();
          pollRef.current = setInterval(poll, 3000);
        }
      })
      .catch(() => {
        // A failed status read on mount changes nothing: idle is still true.
      });
    return () => {
      cancelled = true;
    };
  }, [mappingId]);

  const poll = () => {
    void fetchVerifyReport(mappingId)
      .then((r) => {
        if (r.state === 'done') {
          stopPolling();
          // finishedAt was served all along and discarded on the floor
          // (0036 T1) — a report generated before a further pass read as
          // current.
          setState({ kind: 'done', report: r.report, finishedAt: r.finishedAt });
        } else if (r.state === 'failed') {
          stopPolling();
          setState({ kind: 'error', message: r.error });
        } else if (r.state === 'never-run') {
          // The appliance restarted mid-run and honestly forgot. Say so rather
          // than spinning forever against a run that no longer exists.
          stopPolling();
          setState({ kind: 'error', message: t('verify.restarted') });
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
          message: serverMessage(err),
        });
      });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">{t('verify.title')}</h2>
      <p className="mt-1 mb-4 text-sm text-gray-600">{t('verify.intro')}</p>

      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={run}
          disabled={state.kind === 'running'}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {state.kind === 'running' && <Loader2 className="w-4 h-4 animate-spin" />}
          {state.kind === 'done' ? t('verify.runAgain') : t('verify.run')}
        </button>
        {/*
          Said before they press it, not after. This reads the whole target and
          can take minutes on a real mailbox — an operator who is not told that
          will assume it has hung and reload.
        */}
        <span className="text-xs text-gray-500">
          {t('verify.durationHint')}
          {isSelfHost() && (
            // The per-mapping route runs the whole-appliance scan there
            // (verifyPathFor ignores the id) — say so instead of letting a
            // multi-mapping report surprise the operator (0038 T6).
            <> {t('verify.applianceScope')}</>
          )}
          {/*
            The server said when the run began (stored since the async rewrite,
            shown since 0024 T3). It matters for the same reason the hint does:
            "running since five minutes ago" answers "has it hung?" honestly.
          */}
          {state.kind === 'running' && state.startedAt
            ? ` ${t('verify.runningSince')} ${dateTime(state.startedAt)}.`
            : null}
        </span>
      </div>

      {state.kind === 'error' && (
        <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t('verify.didNotComplete')}</p>
            <p className="mt-1">{state.message}</p>
            <p className="mt-1">{t('verify.notAResult')}</p>
          </div>
        </div>
      )}

      {state.kind === 'done' && state.finishedAt && (
        <p className="mb-2 text-xs text-gray-500">
          {t('verify.checkedAt')} {dateTime(state.finishedAt)}
        </p>
      )}
      {state.kind === 'done' &&
        Object.entries(state.report).map(([mappingId, r]) => (
          <Report key={mappingId} mappingId={mappingId} r={r} />
        ))}
    </div>
  );
};

export default Verify;
