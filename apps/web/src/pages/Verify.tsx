// Copyright 2026 The Ownpace authors (Apache-2.0)
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
  ContentEvidence,
  DataTypeVerification,
  DataTypeVerificationStatus,
  VerificationResult,
  VerifyResponse,
} from '@openmig/shared';
import { VERIFICATION_DOMAINS } from '@openmig/shared';
import { startVerification, fetchVerifyReport } from '../services/operating-service.ts';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
import { isSelfHost } from '../services/edition.ts';
import MappingHubLink from '../components/MappingHubLink.tsx';
import type { StringKey } from '../i18n/index.tsx';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import { serverMessage } from '../services/api.ts';
import { issueSentence, SEVERITY_KEY, VERDICT_KEY } from '../i18n/verdict-words.ts';

// Each verdict's look and its hover help (workplan 0024 T2). Its WORD is the
// client's since the owner's answer of 2026-10-18 (`verdict-words.ts`); the
// server's token stays in the title, to quote.
const STATUS_STYLE: Record<DataTypeVerificationStatus, { icon: React.ReactNode; className: string; helpKey: StringKey }> = {
  PASS: { icon: <CheckCircle2 className="w-4 h-4" />, className: 'text-emerald-700', helpKey: 'verify.help.PASS' },
  WARN: { icon: <AlertCircle className="w-4 h-4" />, className: 'text-amber-700', helpKey: 'verify.help.WARN' },
  FAIL: { icon: <XCircle className="w-4 h-4" />, className: 'text-red-700', helpKey: 'verify.help.FAIL' },
  SKIPPED: { icon: <MinusCircle className="w-4 h-4" />, className: 'text-gray-500', helpKey: 'verify.help.SKIPPED' },
  NOT_VERIFIABLE: { icon: <HelpCircle className="w-4 h-4" />, className: 'text-amber-800', helpKey: 'verify.help.NOT_VERIFIABLE' },
};

/**
 * THE SECOND AXIS, beside the verdict rather than inside it (2026-09-21).
 *
 * `determineVerificationStatus` is handed percentages and counts and never the
 * issue list, so a run in which NOT ONE item's content could be compared still
 * reads PASS on count parity when the target has no way to hash (JMAP
 * contacts), and the owner's decision is that it keeps opening the gate there.
 * A target that CAN hash and answered nothing fails the domain instead (the
 * owner's D2 of 2026-09-24, workplan 0149 T4). What an open gate on counts
 * must not do is look identical to a run that compared everything. So the word
 * sits next to the status, and `counts only` is amber even beside a green
 * PASS: nothing is wrong, and something was not done.
 */
const EVIDENCE_STYLE: Record<ContentEvidence, { className: string; labelKey: StringKey; helpKey: StringKey }> = {
  checked: {
    className: 'text-gray-500',
    labelKey: 'verify.evidence.checked',
    helpKey: 'verify.evidence.help.checked',
  },
  partial: {
    className: 'text-amber-700',
    labelKey: 'verify.evidence.partial',
    helpKey: 'verify.evidence.help.partial',
  },
  none: {
    className: 'text-amber-700',
    labelKey: 'verify.evidence.none',
    helpKey: 'verify.evidence.help.none',
  },
};

// Reuses the queue screens' domain keys — one vocabulary, one translation.
//
// The verification report has a THIRD spelling of the domains: plural, and
// `mail`/`contacts`/`files` where the wizard says `email`/`contact`/`file`.
// So this maps its words onto the one word map rather than restating the
// words themselves (workplan 0113 T5) — a total record, so a sixth domain is
// a compile error here rather than a row on the gate with no name.
const DOMAIN_KEY: Record<DataTypeVerification['dataType'], StringKey> = {
  mail: DOMAIN_STRING_KEY.email,
  calendar: DOMAIN_STRING_KEY.calendar,
  contacts: DOMAIN_STRING_KEY.contact,
  files: DOMAIN_STRING_KEY.file,
  tasks: DOMAIN_STRING_KEY.task,
};

/**
 * One count on a data type's line, as `MigrationReport`'s `Count` draws it.
 * Below 640 pixels the line is a grid and the table's header is not drawn, so
 * the count says its own column above itself; from 640 the header says it, and
 * the label goes.
 */
const Count: React.FC<{ label: string; className: string; last?: boolean; children: React.ReactNode }> = ({
  label,
  className,
  last = false,
  children,
}) => (
  <td className={`flex flex-col justify-between sm:table-cell sm:py-2 ${last ? '' : 'sm:pr-3'} ${className}`}>
    <span className="text-xs text-gray-500 sm:hidden">{label}</span>
    <span>{children}</span>
  </td>
);

/** A verdict's hover: what it means, then the server's token, to quote. */
function verdictTitle(t: ReturnType<typeof useT>, status: DataTypeVerificationStatus): string {
  return `${t(STATUS_STYLE[status].helpKey)} (${status})`;
}

function DomainRow({ d }: { d: DataTypeVerification }): React.ReactElement {
  const t = useT();
  const { number } = useFormatters();
  const s = STATUS_STYLE[d.status];
  return (
    // A table row from 640 pixels. Below that, a block of its own: the type and
    // its result on top, its five counts labelled beneath, so no column waits
    // behind a sideways scroll a phone does not show. The result takes two of
    // the three columns: NOT_VERIFIABLE is wider than one.
    <tr className="grid grid-cols-3 gap-x-2 gap-y-1 border-b border-gray-100 py-2 last:border-0 sm:table-row sm:py-0">
      <td className="col-span-1 font-medium text-gray-900 sm:table-cell sm:py-2 sm:pr-3">
        {t(DOMAIN_KEY[d.dataType])}
      </td>
      <td className="col-span-2 sm:table-cell sm:py-2 sm:pr-3">
        <span className={`inline-flex items-center gap-1 ${s.className}`} title={verdictTitle(t, d.status)}>
          {s.icon}
          {t(VERDICT_KEY[d.status])}
        </span>
      </td>
      <Count label={t('verify.th.source')} className="tabular-nums">
        {number(d.sourceCount)}
      </Count>
      <Count label={t('verify.th.target')} className="tabular-nums">
        {number(d.targetCount)}
      </Count>
      <Count label={t('verify.th.missing')} className="tabular-nums">
        {d.missingOnTarget > 0 ? (
          <span className="text-red-700 font-medium">{number(d.missingOnTarget)}</span>
        ) : (
          '0'
        )}
      </Count>
      <Count label={t('verify.th.sample')} className="col-span-2 text-xs text-gray-600">
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
      </Count>
      <Count label={t('verify.th.bytes')} className="text-xs text-gray-600" last>
        {d.totalBytesTarget === null ? (
          <span title={t('verify.notMeasured.title')}>{t('verify.notMeasured')}</span>
        ) : (
          number(d.totalBytesTarget)
        )}
      </Count>
    </tr>
  );
}

function Report({ mappingId, r }: { mappingId: string; r: VerificationResult }): React.ReactElement {
  const { t, locale } = useLocale();
  const { number } = useFormatters();
  // In the reader's decimals: 100,0% in Dutch, 100.0% in English.
  const score = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(r.score);
  // Walked, not listed. The label map below has been total since T5 — and this
  // line listed four, so the Tasks row had a translated name and never a row.
  const domains = VERIFICATION_DOMAINS.map((k) => r[k]);
  const evidence = EVIDENCE_STYLE[r.contentEvidence];
  // Each finding with its data type's line, which holds the counts a known
  // finding's sentence says.
  const issues = domains.flatMap((d) => d.issues.map((issue) => ({ issue, d })));
  /** What a known finding says, in the reader's words; the server's text for any other. */
  const said = ({ issue, d }: (typeof issues)[number]): string => {
    const known = issueSentence(issue, d);
    if (!known) return issue.message;
    return t(known.key, {
      type: t(DOMAIN_KEY[d.dataType]).toLocaleLowerCase(locale),
      ...(known.n === undefined ? {} : { n: number(known.n) }),
    });
  };
  // Names the table's box below. The appliance draws one report per migration,
  // so the screen's title would give every box the same name.
  const headingId = React.useId();
  return (
    <section className="mb-8 p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 id={headingId} className="font-semibold text-gray-900"><MappingHubLink mappingId={mappingId} /></h3>
        {/* Wraps whole: a verdict in words is wider than its token was, and
            on a phone each of the three would otherwise break mid-phrase. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className={STATUS_STYLE[r.overallStatus].className} title={verdictTitle(t, r.overallStatus)}>
            {t(VERDICT_KEY[r.overallStatus])}
          </span>
          <span className="text-gray-500">{t('verify.score')} {score}</span>
          <span className={evidence.className} title={t(evidence.helpKey)}>
            {t(evidence.labelKey)}
          </span>
        </div>
      </div>

      <div
        className={`p-3 mb-4 rounded-lg text-sm ${
          r.canProceedToCutover ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'
        }`}
      >
        {r.canProceedToCutover ? t('verify.ready') : t('verify.notReady')}
        {/* On the SENTENCE a person acts on, not only in the chip above it.
            "Ready to switch" with nothing compared is the exact reading this
            field exists to prevent. */}
        {r.contentEvidence === 'none' ? ` ${t('verify.countsOnly')}` : ''}
      </div>

      {/* The box takes the focus, so a keyboard can scroll it too where it is
          wider than the screen. Its name is its migration's. */}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-labelledby={headingId}>
        <table className="block w-full text-sm sm:table">
          <thead className="hidden sm:table-header-group">
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
          <tbody className="block sm:table-row-group">
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
            {issues.map((found) => (
              <li key={`${found.d.dataType}-${found.issue.id}`} className="flex items-start gap-2">
                <span
                  title={found.issue.severity}
                  className={
                    found.issue.severity === 'ERROR' ? 'text-red-700 text-xs' : 'text-amber-700 text-xs'
                  }
                >
                  {t(SEVERITY_KEY[found.issue.severity])}
                </span>
                <span className="text-gray-800">{said(found)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* THE SERVER'S OWN WORDS, closed (the owner, 2026-10-18): each finding
          by its id and severity token as the check wrote it, and the check's
          recommendations. English, and for whoever quotes them in a support
          thread; the sentences above are what the reader acts on. */}
      {(issues.length > 0 || r.recommendations.length > 0) && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer select-none text-gray-600">{t('verify.technical')}</summary>
          {issues.length > 0 && (
            <ul className="mt-2 space-y-1 text-gray-800">
              {issues.map(({ issue, d }) => (
                <li key={`${d.dataType}-${issue.id}`} className="break-words">
                  <span className="font-mono text-xs text-gray-600">
                    {issue.severity} {issue.id}
                  </span>{' '}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          {r.recommendations.length > 0 && (
            <>
              <h4 className="mt-3 mb-1 font-semibold text-gray-900">{t('verify.whatToDo')}</h4>
              <ul className="list-disc list-inside space-y-1 text-gray-800">
                {r.recommendations.map((rec) => (
                  <li key={rec}>{rec}</li>
                ))}
              </ul>
            </>
          )}
        </details>
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

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={state.kind === 'running'}
          className="inline-flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
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
