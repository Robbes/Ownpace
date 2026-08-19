// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Ending a migration (ADR-0026) — the cutover checklist, not a button.
 *
 * Finishing stops the shadow sync: the mapping is unscheduled, so copying stops
 * and so do drift, deletion and move reporting. It changes nothing on either
 * side — what is on the new system stays exactly as it is.
 *
 * **But the ORDER is the whole safety argument, and a bare "Finish" button
 * destroys it.** While a mapping is active, items arriving on the old system
 * keep flowing to the new one. Finishing stops that. So if somebody finishes
 * before mail delivery has actually moved, every message that arrives at the
 * old system afterwards is never copied — and the tool has stopped watching,
 * so nothing reports it. That is silent data loss produced by pressing the
 * right button in the wrong order.
 *
 * The runbook's sequence is therefore the screen: prove the copy is complete →
 * clear the decision queues → run a final pass → move delivery → finish. Step
 * four is outside this tool — it is MX/DNS and client reconfiguration — so it
 * is the one precondition nothing can check and the only one the operator is
 * asked to attest to. Everything above it is checked, not taken on trust.
 *
 * TWO MODES, one checklist (workplan 0019 T5). Without a route param this is
 * the appliance's whole-appliance view, driven by `/status` (which managed
 * does not serve). With `mappings/:mappingId/finish` it is a per-mapping
 * screen for EITHER edition: the lifecycle and the failure count come from the
 * queue envelopes themselves, the links stay inside the mapping, and the
 * final-pass button speaks each edition's temporal shape (the appliance runs
 * the pass and answers when it finishes; managed queues the job and says so).
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { AlertCircle, AlertTriangle, Check, Flag, Loader2, Circle } from 'lucide-react';
import type { FinishAccepted, MappingLifecycle } from '@openmig/shared';
import {
  fetchDeletions,
  fetchFailures,
  fetchMoves,
  fetchStatus,
  fetchVerifyReport,
  finishMigration,
  requestFinalPass,
  FinishRefusedError,
} from '../services/operating-service.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import MappingHubLink from '../components/MappingHubLink.tsx';
import PermissionsHandover from '../components/finish/PermissionsHandover.tsx';
import CompletionReportDownload from '../components/CompletionReportDownload.tsx';
import type { StringKey } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';

type Outcome =
  | { readonly state: 'pending' }
  | { readonly state: 'done'; readonly result: FinishAccepted }
  /** The SERVER refused and said why; force renders only when the refusal is
   *  one force can satisfy (0038 T1). */
  | { readonly state: 'refused'; readonly error: string; readonly hint?: string; readonly forceable: boolean }
  /** Transport/unknown failure — a plain error and a plain retry, never force:
   *  clicking force after a timeout could silently skip the one gate the
   *  refusal design exists to make informed. */
  | { readonly state: 'failed'; readonly error: string };

type PassState = 'running' | 'finished' | 'queued' | { readonly failed: string };

const LIFECYCLE_NOTE_KEY: Record<MappingLifecycle, StringKey> = {
  paused: 'finish.note.paused',
  active: 'finish.note.active',
  cutover: 'finish.note.cutover',
  done: 'finish.note.done',
};

/** One line of the checklist. `done` is what the tool can verify itself. */
const Step: React.FC<{
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}> = ({ n, title, done, children }) => (
  <li className="flex gap-3 py-3 border-b border-gray-100 last:border-0">
    <span className="flex-shrink-0 mt-0.5">
      {done === true ? (
        <Check className="w-5 h-5 text-emerald-600" />
      ) : done === false ? (
        <AlertTriangle className="w-5 h-5 text-amber-600" />
      ) : (
        <Circle className="w-5 h-5 text-gray-300" />
      )}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-gray-900">
        {n}. {title}
      </p>
      <div className="mt-1 text-sm text-gray-600">{children}</div>
    </div>
  </li>
);

/** What one mapping's checklist needs to know, whichever mode supplied it. */
interface FinishRow {
  readonly id: string;
  readonly lifecycle: MappingLifecycle;
  readonly needingDecision: number;
}

const Finish: React.FC = () => {
  const queryClient = useQueryClient();
  const t = useT();
  const { dateTime } = useFormatters();
  const { mappingId: routeMappingId } = useParams<{ mappingId: string }>();
  const [outcomes, setOutcomes] = React.useState<Record<string, Outcome>>({});
  const [deliveryMoved, setDeliveryMoved] = React.useState<Record<string, boolean>>({});
  const [pass, setPass] = React.useState<Record<string, PassState>>({});

  // Whole-appliance mode only: `/status` answers for every configured mapping
  // and the managed edition does not serve it. Per-mapping mode never asks.
  const status = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchOnWindowFocus: true,
    enabled: !routeMappingId,
  });
  // The queue counts, so step 2 is checked rather than asserted. Cheap DB
  // reads, unlike /verify — which is why that one stays behind its own button.
  // With a route param these are scoped to the one mapping (which is also what
  // the managed edition requires); without one the appliance answers for all.
  const failures = useQuery({
    queryKey: ['failures', routeMappingId],
    queryFn: () => fetchFailures(routeMappingId),
  });
  const moves = useQuery({
    queryKey: ['moves', routeMappingId],
    queryFn: () => fetchMoves(routeMappingId),
  });
  const deletions = useQuery({
    queryKey: ['deletions', routeMappingId],
    queryFn: () => fetchDeletions(routeMappingId),
  });
  // Step 1's claim, finally checked (0038 T3): the report endpoint is a
  // documented safe status read — it starts nothing. Both editions serve it.
  const verifyOutcome = useQuery({
    queryKey: ['verify-report', routeMappingId],
    queryFn: () => fetchVerifyReport(routeMappingId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const finish = (mappingId: string, force: boolean) => {
    setOutcomes((o) => ({ ...o, [mappingId]: { state: 'pending' } }));
    void finishMigration(mappingId, force)
      .then((result) => {
        setOutcomes((o) => ({ ...o, [mappingId]: { state: 'done', result } }));
        void queryClient.invalidateQueries();
      })
      .catch((err: unknown) => {
        if (err instanceof FinishRefusedError) {
          setOutcomes((o) => ({
            ...o,
            [mappingId]: {
              state: 'refused',
              error: err.refusal.error,
              ...(err.refusal.hint ? { hint: err.refusal.hint } : {}),
              // The stable discriminant, not sentence-matching: only the
              // unresolved-failures refusal is one force can satisfy. The
              // paused refusal gets no force button — force cannot start a
              // migration, so offering it would lie about what force does.
              forceable: err.refusal.code === 'unresolved_failures',
            },
          }));
          return;
        }
        setOutcomes((o) => ({
          ...o,
          [mappingId]: {
            state: 'failed',
            error: serverMessage(err),
          },
        }));
      });
  };

  const doPass = (mappingId: string) => {
    setPass((p) => ({ ...p, [mappingId]: 'running' }));
    void requestFinalPass(mappingId)
      .then((how) => setPass((p) => ({ ...p, [mappingId]: how })))
      .catch((err: unknown) =>
        // Keep the server's words (0038 T2): on the appliance the request can
        // time out while the single-flight pass keeps running, so "nothing
        // ran" was a claim this catch could not make.
        setPass((p) => ({
          ...p,
          [mappingId]: { failed: serverMessage(err) },
        })),
      )
      .finally(() => {
        void queryClient.invalidateQueries();
      });
  };

  // The rows the checklist renders, whichever mode supplied them.
  const perMapping = Boolean(routeMappingId);
  const loading = perMapping ? failures.isLoading : status.isLoading;
  const loadError = perMapping ? failures.error : status.error;

  let rows: FinishRow[] = [];
  let unknownMapping = false;
  if (perMapping) {
    const env = failures.data?.[routeMappingId!];
    if (failures.data && !env) {
      // Loaded, and the mapping is not in the answer: say so rather than
      // rendering an empty checklist that looks like "nothing to do".
      unknownMapping = true;
    } else if (env) {
      rows = [
        {
          id: routeMappingId!,
          lifecycle: env.migrationStatus,
          needingDecision: env.needsDecision.length,
        },
      ];
    }
  } else {
    rows = (status.data?.mappings ?? []).map((m) => ({
      id: m.mappingId,
      lifecycle: m.migrationStatus,
      needingDecision: m.domains.reduce((n, d) => n + d.itemsNeedingDecision, 0),
    }));
  }

  // Where the checklist's links live: inside the mapping when we are inside a
  // mapping, at the appliance's top level otherwise.
  const linkBase = perMapping ? `/mappings/${routeMappingId}` : '';

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">
            {perMapping ? t('finish.readError.one') : t('finish.readError.many')}
          </p>
          <p className="mt-1">
            {loadError instanceof Error ? loadError.message : String(loadError)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">{t('finish.title')}</h2>
      <p className="mt-1 mb-4 text-sm text-gray-600">{t('finish.intro')}</p>

      {unknownMapping && (
        <p className="text-sm text-amber-800">
          {t('finish.unknown.pre')} {routeMappingId} {t('finish.unknown.post')}
        </p>
      )}
      {!perMapping && rows.length === 0 && (
        <div className="text-sm text-gray-500 space-y-2">
          <p>{t('confirm.noMappings')}</p>
          <p>{t('confirm.noMappings.how')}</p>
        </div>
      )}

      {rows.map((m) => {
        const id = m.id;
        const outcome = outcomes[id];
        const finishable = m.lifecycle === 'active' || m.lifecycle === 'cutover';
        const needingDecision = m.needingDecision;
        const openMoves = moves.data?.[id]?.open.length ?? 0;
        const openDeletions = deletions.data?.[id]?.confirmed.length ?? 0;
        const queuesClear = needingDecision === 0 && openMoves === 0 && openDeletions === 0;
        // Failed reads surface as failures, never as eternal "Reading…"
        // (0038 T3) — a failed read shown as loading, at the moment the
        // operator decides the queues are clear, is the masking hard rule 9
        // forbids. The finish button stays usable: the server re-checks.
        const queueReadErrors = [failures.error, moves.error, deletions.error].filter(
          (e): e is Error => e != null,
        );
        const queuesKnown =
          failures.data !== undefined && moves.data !== undefined && deletions.data !== undefined;
        const passState = pass[id];

        return (
          <section key={id} className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-gray-900"><MappingHubLink mappingId={id} /></h3>
              <span className="text-xs text-gray-500">{m.lifecycle}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{t(LIFECYCLE_NOTE_KEY[m.lifecycle])}</p>

            {/* The take-away documents survive the finish (0038 T2): the
                handover names the post-cutover Monday morning as its purpose,
                and until now it VANISHED the moment the migration reached
                'done' — including on a reload right after success. */}
            {(m.lifecycle === 'done' || outcome?.state === 'done') && (
              <div className="mt-3">
                <PermissionsHandover mappingId={id} />
                <div className="mt-3 text-sm">
                  <p className="font-medium text-gray-900">{t('finish.aftermath.title')}</p>
                  <ul className="mt-1 list-disc pl-5 text-gray-600">
                    <li>
                      <Link to={`${linkBase}/verify`} className="text-blue-700 hover:underline">
                        {t('finish.aftermath.verify')}
                      </Link>
                    </li>
                    <li>
                      <Link
                        to={`/mappings/${encodeURIComponent(id)}`}
                        className="text-blue-700 hover:underline"
                      >
                        {t('finish.aftermath.runs')}
                      </Link>
                    </li>
                    <li>
                      {/* The closing document (workplan 0047), where closing
                          happens: generated NOW, with the verdict the queues
                          allow — which after a finish is the whole point. */}
                      <CompletionReportDownload mappingId={id} />
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {!finishable ? null : outcome?.state === 'done' ? (
              <div className="mt-3 text-sm">
                <p className="flex items-start gap-2 text-emerald-700">
                  <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {outcome.result.effect}
                </p>
                {outcome.result.leftUnmigrated !== undefined && (
                  <p className="mt-1 text-amber-800">
                    {outcome.result.leftUnmigrated}{' '}
                    {outcome.result.leftUnmigrated === 1 ? t('finish.left.one') : t('finish.left.many')}
                  </p>
                )}
                {outcome.result.ifYouNeedToResume && (
                  <p className="mt-1 text-gray-600">{outcome.result.ifYouNeedToResume}</p>
                )}
              </div>
            ) : (
              <>
              {/*
                A PANEL, not a numbered step (workplan 0029 T4). The numbered
                steps are things this tool can check or make you attest to;
                this is a document you take away and work through on systems
                it never touches. Numbering it would put it in a list of
                things somebody could reasonably expect to be ticked off.

                Above the steps because of WHEN it has to happen: rights
                carried across after delivery moves were missing for however
                long that took.
              */}
              <PermissionsHandover mappingId={id} />
              <ol className="mt-4">
                <Step
                  n={1}
                  title={t('finish.step1.title')}
                  done={
                    verifyOutcome.data?.state === 'done'
                      ? (verifyOutcome.data.report[id]?.canProceedToCutover ?? undefined) === true
                        ? true
                        : verifyOutcome.data.report[id]
                          ? false
                          : undefined
                      : undefined
                  }
                >
                  {t('finish.step1.pre')}{' '}
                  <Link to={`${linkBase}/verify`} className="text-blue-700 hover:underline">
                    {t('finish.step1.link')}
                  </Link>
                  {t('finish.step1.post')}
                  {/* The verify OUTCOME, read instead of trusted (0038 T3):
                      the header claims "checked, not taken on trust", and
                      until now this circle stayed gray over a FAIL report. */}
                  {verifyOutcome.error != null ? (
                    <p className="mt-1 text-amber-800">
                      {t('finish.step1.readFailed')}{' '}
                      {verifyOutcome.error instanceof Error
                        ? verifyOutcome.error.message
                        : String(verifyOutcome.error)}
                    </p>
                  ) : verifyOutcome.data?.state === 'done' && verifyOutcome.data.report[id] ? (
                    verifyOutcome.data.report[id]!.canProceedToCutover ? (
                      <p className="mt-1 text-emerald-700">
                        {t('finish.step1.passed')}
                        {verifyOutcome.data.finishedAt && (
                          <span className="text-gray-500">
                            {' '}
                            ({t('verify.checkedAt')} {dateTime(verifyOutcome.data.finishedAt)})
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="mt-1 text-amber-800">
                        {/* The status word verbatim — a finding, not a frame. */}
                        {t('finish.step1.notPassed')}{' '}
                        {verifyOutcome.data.report[id]!.overallStatus}
                        {verifyOutcome.data.finishedAt && (
                          <span className="text-gray-500">
                            {' '}
                            ({t('verify.checkedAt')} {dateTime(verifyOutcome.data.finishedAt)})
                          </span>
                        )}
                      </p>
                    )
                  ) : verifyOutcome.data?.state === 'running' ? (
                    <p className="mt-1 text-gray-600">{t('finish.step1.running')}</p>
                  ) : verifyOutcome.data ? (
                    <p className="mt-1 text-gray-600">{t('finish.step1.noRun')}</p>
                  ) : null}
                </Step>

                <Step
                  n={2}
                  title={t('finish.step2.title')}
                  done={queueReadErrors.length > 0 ? false : queuesKnown ? queuesClear : undefined}
                >
                  {queueReadErrors.length > 0 ? (
                    <span className="text-amber-800">
                      {queueReadErrors.map((e, i) => (
                        <span key={i} className="block">
                          {t('finish.step2.readFailed')} {e.message} {t('finish.step2.notSameAsClear')}
                        </span>
                      ))}
                    </span>
                  ) : !queuesKnown ? (
                    t('finish.step2.reading')
                  ) : queuesClear ? (
                    t('finish.step2.clear')
                  ) : (
                    <span>
                      {needingDecision > 0 && (
                        <>
                          <Link to={`${linkBase}/failures`} className="text-blue-700 hover:underline">
                            {needingDecision}{' '}
                            {t(needingDecision === 1 ? 'finish.step2.failures.one' : 'finish.step2.failures.many')}
                          </Link>
                          {(openDeletions > 0 || openMoves > 0) && ', '}
                        </>
                      )}
                      {openDeletions > 0 && (
                        <>
                          <Link to={`${linkBase}/deletions`} className="text-blue-700 hover:underline">
                            {openDeletions} {t('finish.step2.deletions')}
                          </Link>
                          {openMoves > 0 && ', '}
                        </>
                      )}
                      {openMoves > 0 && (
                        <Link to={`${linkBase}/moves`} className="text-blue-700 hover:underline">
                          {openMoves} {t('finish.step2.moves')}
                        </Link>
                      )}
                      {t('finish.step2.onlyFirstBlocks')}
                    </span>
                  )}
                </Step>

                <Step
                  n={3}
                  title={t('finish.step3.title')}
                  done={passState === 'finished' || passState === 'queued' ? true : undefined}
                >
                  {t('finish.step3.body')}{' '}
                  <button
                    onClick={() => doPass(id)}
                    disabled={passState === 'running'}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {passState === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
                    {passState === 'finished' || passState === 'queued'
                      ? t('finish.step3.runAgain')
                      : t('finish.step3.run')}
                  </button>
                  {/* Each edition's own temporal shape, said rather than blurred:
                      the appliance answered when the pass FINISHED; managed
                      queued a job that lands in the run history. */}
                  {passState === 'finished' && (
                    <p className="mt-1 text-emerald-700">{t('finish.step3.finished')}</p>
                  )}
                  {passState === 'queued' && (
                    <p className="mt-1 text-gray-600">{t('finish.step3.queued')}</p>
                  )}
                  {typeof passState === 'object' && (
                    <p className="mt-1 text-amber-800">
                      {t('finish.step3.failedFramed')}{' '}
                      <span className="font-mono text-xs">{passState.failed}</span>
                    </p>
                  )}
                </Step>

                {/*
                  The step this tool cannot check, and the one that makes the
                  difference between finishing and losing mail. It is MX/DNS and
                  client reconfiguration — outside the tool entirely — so it is
                  asked rather than verified, and the consequence is spelled out
                  instead of assumed understood.
                */}
                <Step n={4} title={t('finish.step4.title')} done={deliveryMoved[id]}>
                  <p>{t('finish.step4.body')}</p>
                  <p className="mt-1 text-amber-800">
                    <b>{t('finish.step4.warn.pre')}</b>
                    {t('finish.step4.warn.post')}
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-gray-800">
                    <input
                      type="checkbox"
                      checked={deliveryMoved[id] ?? false}
                      onChange={(e) =>
                        setDeliveryMoved((d) => ({ ...d, [id]: e.target.checked }))
                      }
                    />
                    {t('finish.step4.checkbox')}
                  </label>
                </Step>

                <Step n={5} title={t('finish.step5.title')}>
                  <p className="mb-2">
                    <b>{t('finish.step5.nothingChanges.pre')}</b>
                    {t('finish.step5.nothingChanges.post')}
                  </p>

                  {outcome?.state === 'refused' ? (
                    <div>
                      <p className="flex items-start gap-2 text-amber-800">
                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        {outcome.error}
                      </p>
                      {outcome.hint && <p className="mt-1 text-gray-600">{outcome.hint}</p>}
                      {/*
                        Offered only after the refusal has said what it costs —
                        and only for the refusal force can SATISFY (0038 T1).
                        The paused refusal renders its hint without this
                        button: force cannot start a migration. A transport
                        failure never reaches this branch at all.
                      */}
                      {outcome.forceable && (
                        <button
                          onClick={() => finish(id, true)}
                          className="mt-2 inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded border border-amber-600 text-amber-800 hover:bg-amber-50"
                        >
                          <Flag className="w-3 h-3" />
                          {t('finish.forceButton')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                    {outcome?.state === 'failed' && (
                      <p className="mb-2 flex items-start gap-2 text-red-800">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        {outcome.error}
                      </p>
                    )}
                    <button
                      onClick={() => finish(id, false)}
                      disabled={!deliveryMoved[id] || outcome?.state === 'pending'}
                      title={deliveryMoved[id] ? undefined : t('finish.button.disabledTitle')}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {outcome?.state === 'pending' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Flag className="w-4 h-4" />
                      )}
                      {outcome?.state === 'failed' ? t('finish.retryButton') : t('finish.button')}
                    </button>
                    </>
                  )}
                </Step>
              </ol>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default Finish;
