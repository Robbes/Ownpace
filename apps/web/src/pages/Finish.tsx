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
 * old system afterwards is never copied — and the appliance has stopped
 * watching, so nothing reports it. That is silent data loss produced by
 * pressing the right button in the wrong order.
 *
 * The runbook's sequence is therefore the screen: prove the copy is complete →
 * clear the decision queues → run a final pass → move delivery → finish. Step
 * four is outside this tool — it is MX/DNS and client reconfiguration — so it
 * is the one precondition the appliance cannot check and the only one the
 * operator is asked to attest to. Everything above it, the appliance checks for
 * itself and refuses to take on trust.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertCircle, AlertTriangle, Check, Flag, Loader2, Circle } from 'lucide-react';
import type { FinishAccepted, MappingLifecycle } from '@openmig/shared';
import {
  fetchDeletions,
  fetchFailures,
  fetchMoves,
  fetchStatus,
  finishMigration,
  runPass,
  FinishRefusedError,
} from '../services/operating-service';

type Outcome =
  | { readonly state: 'pending' }
  | { readonly state: 'done'; readonly result: FinishAccepted }
  | { readonly state: 'blocked'; readonly error: string; readonly hint?: string };

const LIFECYCLE_NOTE: Record<MappingLifecycle, string> = {
  paused: 'Never started, so there is nothing to finish. Remove it from the config directory to retire it.',
  active: 'Syncing on a schedule. Items still arriving on the old system are being copied across.',
  cutover: 'In cutover. Still syncing until you finish it.',
  done: 'Finished. This mapping no longer syncs and nothing is being reported for it.',
};

/** One line of the checklist. `done` is what the appliance can verify itself. */
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

const Finish: React.FC = () => {
  const queryClient = useQueryClient();
  const [outcomes, setOutcomes] = React.useState<Record<string, Outcome>>({});
  const [deliveryMoved, setDeliveryMoved] = React.useState<Record<string, boolean>>({});
  const [passRunning, setPassRunning] = React.useState<Record<string, boolean>>({});
  const [passDone, setPassDone] = React.useState<Record<string, boolean>>({});

  const status = useQuery({ queryKey: ['status'], queryFn: fetchStatus, refetchOnWindowFocus: true });
  // The queue counts, so step 2 is checked rather than asserted. Cheap DB reads,
  // unlike /verify — which is why that one stays behind its own button.
  const failures = useQuery({ queryKey: ['failures'], queryFn: fetchFailures });
  const moves = useQuery({ queryKey: ['moves'], queryFn: fetchMoves });
  const deletions = useQuery({ queryKey: ['deletions'], queryFn: fetchDeletions });

  const finish = (mappingId: string, force: boolean) => {
    setOutcomes((o) => ({ ...o, [mappingId]: { state: 'pending' } }));
    void finishMigration(mappingId, force)
      .then((result) => {
        setOutcomes((o) => ({ ...o, [mappingId]: { state: 'done', result } }));
        void queryClient.invalidateQueries({ queryKey: ['status'] });
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
            error: err instanceof Error ? err.message : 'The request did not complete.',
          },
        }));
      });
  };

  const doPass = (mappingId: string) => {
    setPassRunning((p) => ({ ...p, [mappingId]: true }));
    void runPass(mappingId)
      .then(() => setPassDone((p) => ({ ...p, [mappingId]: true })))
      .finally(() => {
        setPassRunning((p) => ({ ...p, [mappingId]: false }));
        void queryClient.invalidateQueries();
      });
  };

  if (status.isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (status.error) {
    return (
      <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">Could not read the migrations.</p>
          <p className="mt-1">
            {status.error instanceof Error ? status.error.message : String(status.error)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Finish a migration</h2>
      <p className="mt-1 mb-4 text-sm text-gray-600">
        Finishing stops the copying and the reporting. Work through the steps in order — the last
        one is the only one that cannot be undone by simply carrying on.
      </p>

      {status.data?.mappings.length === 0 && (
        <p className="text-sm text-gray-500">No mappings configured.</p>
      )}

      {status.data?.mappings.map((m) => {
        const id = m.mappingId;
        const outcome = outcomes[id];
        const finishable = m.migrationStatus === 'active' || m.migrationStatus === 'cutover';
        const needingDecision = m.domains.reduce((n, d) => n + d.itemsNeedingDecision, 0);
        const openMoves = moves.data?.[id]?.open.length ?? 0;
        const openDeletions = deletions.data?.[id]?.confirmed.length ?? 0;
        const queuesClear = needingDecision === 0 && openMoves === 0 && openDeletions === 0;
        const queuesKnown =
          failures.data !== undefined && moves.data !== undefined && deletions.data !== undefined;

        return (
          <section key={id} className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-gray-900">{id}</h3>
              <span className="text-xs text-gray-500">{m.migrationStatus}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{LIFECYCLE_NOTE[m.migrationStatus]}</p>

            {!finishable ? null : outcome?.state === 'done' ? (
              <div className="mt-3 text-sm">
                <p className="flex items-start gap-2 text-emerald-700">
                  <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {outcome.result.effect}
                </p>
                {outcome.result.leftUnmigrated !== undefined && (
                  <p className="mt-1 text-amber-800">
                    {outcome.result.leftUnmigrated} item
                    {outcome.result.leftUnmigrated === 1 ? '' : 's'} left unmigrated.
                  </p>
                )}
                {outcome.result.ifYouNeedToResume && (
                  <p className="mt-1 text-gray-600">{outcome.result.ifYouNeedToResume}</p>
                )}
              </div>
            ) : (
              <ol className="mt-4">
                <Step n={1} title="Check the copy is complete">
                  Compare the two systems and sample the contents.{' '}
                  <Link to="/verify" className="text-blue-700 hover:underline">
                    Run the check
                  </Link>
                  . Reads the whole destination, so it takes minutes on a large mailbox.
                </Step>

                <Step n={2} title="Clear the decision queues" done={queuesKnown ? queuesClear : undefined}>
                  {!queuesKnown ? (
                    'Reading…'
                  ) : queuesClear ? (
                    'Nothing is waiting on you.'
                  ) : (
                    <span>
                      {needingDecision > 0 && (
                        <>
                          <Link to="/failures" className="text-blue-700 hover:underline">
                            {needingDecision} could not be copied
                          </Link>
                          {(openDeletions > 0 || openMoves > 0) && ', '}
                        </>
                      )}
                      {openDeletions > 0 && (
                        <>
                          <Link to="/deletions" className="text-blue-700 hover:underline">
                            {openDeletions} deleted on the old system
                          </Link>
                          {openMoves > 0 && ', '}
                        </>
                      )}
                      {openMoves > 0 && (
                        <Link to="/moves" className="text-blue-700 hover:underline">
                          {openMoves} moved
                        </Link>
                      )}
                      . Only the first of these blocks finishing — the other two are already
                      answered by the new system keeping its copy.
                    </span>
                  )}
                </Step>

                <Step n={3} title="Run one final pass" done={passDone[id] ? true : undefined}>
                  So the new system reflects the old one as of right now.{' '}
                  <button
                    onClick={() => doPass(id)}
                    disabled={passRunning[id]}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {passRunning[id] && <Loader2 className="w-3 h-3 animate-spin" />}
                    {passDone[id] ? 'Run another' : 'Run a pass now'}
                  </button>
                </Step>

                {/*
                  The step this tool cannot check, and the one that makes the
                  difference between finishing and losing mail. It is MX/DNS and
                  client reconfiguration — outside the appliance entirely — so
                  it is asked rather than verified, and the consequence is
                  spelled out instead of assumed understood.
                */}
                <Step n={4} title="Move delivery to the new system" done={deliveryMoved[id]}>
                  <p>
                    Change MX/DNS and reconfigure clients so new mail arrives on the new system.
                    This happens outside this tool, so it is the one step here nobody can check for
                    you.
                  </p>
                  <p className="mt-1 text-amber-800">
                    <b>If you finish before this is done</b>, anything that arrives on the old
                    system afterwards will not be copied, and nothing will report it — the
                    appliance has stopped watching.
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-gray-800">
                    <input
                      type="checkbox"
                      checked={deliveryMoved[id] ?? false}
                      onChange={(e) =>
                        setDeliveryMoved((d) => ({ ...d, [id]: e.target.checked }))
                      }
                    />
                    Delivery now goes to the new system.
                  </label>
                </Step>

                <Step n={5} title="Finish">
                  <p className="mb-2">
                    <b>Nothing is added to or removed from either system.</b> What is on the new
                    system stays exactly as it is — this only stops the tool watching the old one.
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
                        Finish anyway, leaving them behind
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => finish(id, false)}
                      disabled={!deliveryMoved[id] || outcome?.state === 'pending'}
                      title={
                        deliveryMoved[id]
                          ? undefined
                          : 'Confirm step 4 first — finishing before delivery has moved loses anything that arrives afterwards.'
                      }
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {outcome?.state === 'pending' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Flag className="w-4 h-4" />
                      )}
                      Finish this migration
                    </button>
                  )}
                </Step>
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default Finish;
