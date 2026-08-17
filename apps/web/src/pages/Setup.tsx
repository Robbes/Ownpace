// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The provider setup checklist (workplan 0061).
 *
 * What a person must do IN THE PROVIDER before a migration can read anything.
 * The wizard already said all of this, but it said it in one amber paragraph
 * and kept its state in memory — so somebody who reached the credentials step,
 * found that a Box admin has to authorise the app, and came back the next day
 * started from an empty form. This is the same guidance as a list that
 * REMEMBERS, per tenant, so a colleague can pick it up.
 *
 * Two things are deliberately prominent:
 *
 *  - **What each step yields.** Nearly every step ends with a value to paste
 *    into the wizard later; naming it turns "do this in the console" into
 *    "come back with this".
 *  - **Which steps need somebody else.** An administrator authorising the app
 *    is the usual reason a setup stops halfway, so the header counts those
 *    separately rather than leaving "3 of 7" to explain itself.
 *
 * `skipped` is a first-class answer, not a hidden one: a step that genuinely
 * does not apply is recorded as decided rather than left open forever.
 */

import React from 'react';
import { useParams, Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDashed, SkipForward, UserCog } from 'lucide-react';
import { setupApi, type SetupChecklist, type SetupStepStatusDto } from '../services/mapping-service';
import { useT, useFormatters, type StringKey } from '../i18n';

const StepRow: React.FC<{
  status: SetupStepStatusDto;
  busy: boolean;
  onSet: (state: 'open' | 'done' | 'skipped') => void;
}> = ({ status, busy, onSet }) => {
  const t = useT();
  const { relativeToNow, dateTime } = useFormatters();
  const { step, state } = status;
  const settled = state !== 'open';

  return (
    <li className="border border-gray-200 rounded-lg p-4 flex gap-4 items-start">
      <button
        type="button"
        disabled={busy}
        onClick={() => onSet(state === 'done' ? 'open' : 'done')}
        aria-label={state === 'done' ? t('setup.untick') : t('setup.tick')}
        className={`mt-0.5 shrink-0 w-6 h-6 rounded border flex items-center justify-center disabled:opacity-50 ${
          state === 'done'
            ? 'bg-green-600 border-green-600 text-white'
            : 'bg-white border-gray-300 text-transparent hover:border-gray-400'
        }`}
      >
        <Check className="w-4 h-4" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`font-medium ${state === 'skipped' ? 'text-gray-400 line-through' : 'text-gray-900'}`}
          >
            {t(step.titleKey as StringKey)}
          </span>
          {step.needsAnotherPerson && (
            <span
              className="inline-flex items-center gap-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
              title={t('setup.needsAnotherPerson.hint')}
            >
              <UserCog className="w-3 h-3" />
              {t('setup.needsAnotherPerson')}
            </span>
          )}
        </div>

        <p className="mt-1 text-sm text-gray-600">{t(step.detailKey as StringKey)}</p>

        {step.yieldsKey && (
          <p className="mt-1 text-sm text-blue-800">
            <span className="font-medium">{t('setup.yields')}</span>{' '}
            {t(step.yieldsKey as StringKey)}
          </p>
        )}

        {settled && (
          <p className="mt-2 text-xs text-gray-500">
            {state === 'done' ? t('setup.state.done') : t('setup.state.skipped')}
            {status.decidedAt ? (
              <span title={dateTime(status.decidedAt)}>
                {' · '}
                {status.decidedBy ?? ''} {relativeToNow(status.decidedAt)}
              </span>
            ) : null}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => onSet(state === 'skipped' ? 'open' : 'skipped')}
        className="shrink-0 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 inline-flex items-center gap-1"
      >
        <SkipForward className="w-4 h-4" />
        {state === 'skipped' ? t('setup.unskip') : t('setup.skip')}
      </button>
    </li>
  );
};

/**
 * Which shipped guide covers this provider. The four Google source types share
 * one document, exactly as they share one setup profile.
 */
function guideSlug(provider: string): string {
  if (provider.startsWith('google') || provider === 'gmail') return 'google-workspace-setup';
  if (provider === 'oauth2' || provider === 'graph') return 'o365-setup';
  return `${provider}-setup`;
}

const Setup: React.FC = () => {
  const t = useT();
  const { side, provider } = useParams<{ side: string; provider: string }>();
  const queryClient = useQueryClient();
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const resolvedSide: 'source' | 'target' = side === 'target' ? 'target' : 'source';
  const key = ['setup', resolvedSide, provider ?? ''];

  const { data, isLoading, error } = useQuery<SetupChecklist>({
    queryKey: key,
    queryFn: () => setupApi.get(resolvedSide, provider ?? ''),
    enabled: Boolean(provider),
  });

  const set = async (stepKey: string, state: 'open' | 'done' | 'skipped') => {
    setBusyKey(stepKey);
    try {
      const refreshed = await setupApi.setStep(resolvedSide, provider ?? '', stepKey, state);
      queryClient.setQueryData(key, refreshed);
    } finally {
      setBusyKey(null);
    }
  };

  if (isLoading) return <div className="p-6 text-gray-500">{t('common.loading')}</div>;
  if (error) return <div className="p-6 text-red-700">{String(error)}</div>;
  if (!data) return null;

  const { progress } = data;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex flex-wrap gap-4">
        <Link to="/mappings/new" className="text-sm text-blue-700 hover:underline">
          {t('setup.backToWizard')}
        </Link>
        {/* The long-form guide, in the app rather than as a filename nobody
            in a browser can open (workplan 0063). */}
        <Link to={`/docs/${guideSlug(data.provider)}`} className="text-sm text-blue-700 hover:underline">
          {t('setup.fullGuide')}
        </Link>
      </div>

      <h2 className="mt-2 text-xl font-semibold text-gray-900">
        {t('setup.title')} — {data.provider}
      </h2>

      {data.steps.length === 0 ? (
        // An empty list is a real answer, not a missing page.
        <p className="mt-4 text-gray-600">{t('setup.nothingToDo')}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-600">{t('setup.intro')}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className={progress.complete ? 'text-green-700 font-medium' : 'text-gray-700'}>
              {progress.done + progress.skipped} / {progress.total} {t('setup.settled')}
            </span>
            {progress.blockedOnOthers > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-800">
                <UserCog className="w-4 h-4" />
                {progress.blockedOnOthers} {t('setup.waitingOnOthers')}
              </span>
            )}
            {progress.complete && <span className="text-green-700">{t('setup.allDone')}</span>}
            {!progress.complete && progress.open > 0 && (
              <span className="inline-flex items-center gap-1 text-gray-500">
                <CircleDashed className="w-4 h-4" />
                {progress.open} {t('setup.stillOpen')}
              </span>
            )}
          </div>

          <ul className="mt-4 space-y-3">
            {data.steps.map((s) => (
              <li key={s.step.key} className="list-none">
                <StepRow
                  status={s}
                  busy={busyKey === s.step.key}
                  onSet={(state) => set(s.step.key, state)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default Setup;
