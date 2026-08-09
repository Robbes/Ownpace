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
  finishMigration,
  requestFinalPass,
  FinishRefusedError,
} from '../services/operating-service';
import { useT } from '../i18n';
import MappingHubLink from '../components/MappingHubLink';
import PermissionsHandover from '../components/finish/PermissionsHandover';
import type { StringKey } from '../i18n';

type Outcome =
  | { readonly state: 'pending' }
  | { readonly state: 'done'; readonly result: FinishAccepted }
  | { readonly state: 'blocked'; readonly error: string; readonly hint?: string };

type PassState = 'running' | 'finished' | 'queued' | 'failed';

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
              state: 'blocked',
              error: err.refusal.error,
              ...(err.refusal.hint ? { hint: err.refusal.hint } : {}),
            },
          }));
          return;
        }
        setOutcomes((o) => ({
          ...o,
          [mappingId]: {
            state: 'blocked',
            error: err instanceof Error ? err.message : t('deletions.requestFailed'),
          },
        }));
      });
  };

  const doPass = (mappingId: string) => {
    setPass((p) => ({ ...p, [mappingId]: 'running' }));
    void requestFinalPass(mappingId)
      .then((how) => setPass((p) => ({ ...p, [mappingId]: how })))
      .catch(() => setPass((p) => ({ ...p, [mappingId]: 'failed' })))
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
        <p className="text-sm text-gray-500">{t('confirm.noMappings')}</p>
      )}

      {rows.map((m) => {
        const id = m.id;
        const outcome = outcomes[id];
        const finishable = m.lifecycle === 'active' || m.lifecycle === 'cutover';
        const needingDecision = m.needingDecision;
        const openMoves = moves.data?.[id]?.open.length ?? 0;
        const openDeletions = deletions.data?.[id]?.confirmed.length ?? 0;
        const queuesClear = needingDecision === 0 && openMoves === 0 && openDeletions === 0;
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
                <Step n={1} title={t('finish.step1.title')}>
                  {t('finish.step1.pre')}{' '}
                  <Link to={`${linkBase}/verify`} className="text-blue-700 hover:underline">
                    {t('finish.step1.link')}
                  </Link>
                  {t('finish.step1.post')}
                </Step>

                <Step n={2} title={t('finish.step2.title')} done={queuesKnown ? queuesClear : undefined}>
                  {!queuesKnown ? (
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
                  {passState === 'failed' && (
                    <p className="mt-1 text-amber-800">{t('finish.step3.failed')}</p>
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

                  {outcome?.state === 'blocked' ? (
                    <div>
                      <p className="flex items-start gap-2 text-amber-800">
                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        {outcome.error}
                      </p>
                      {outcome.hint && <p className="mt-1 text-gray-600">{outcome.hint}</p>}
                      {/*
                        Offered only after the refusal has said what it costs.
                        A "force" checkbox next to the first button would let
                        somebody tick it before they knew what it meant.
                      */}
                      <button
                        onClick={() => finish(id, true)}
                        className="mt-2 inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded border border-amber-600 text-amber-800 hover:bg-amber-50"
                      >
                        <Flag className="w-3 h-3" />
                        {t('finish.forceButton')}
                      </button>
                    </div>
                  ) : (
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
                      {t('finish.button')}
                    </button>
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
