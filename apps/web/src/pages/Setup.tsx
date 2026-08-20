// Copyright 2026 The Ownpace authors (Apache-2.0)
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
import { useParams, useLocation, Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDashed, SkipForward, UserCog } from 'lucide-react';
import { setupApi, type SetupChecklist, type SetupStepStatusDto } from '../services/mapping-service.ts';
import { providersWithSetup, providerDisplayName } from '@openmig/shared';
import { useT, useFormatters, type StringKey } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';

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

/**
 * "Which provider?" — the screen the nav used to skip (workplan 0068).
 *
 * `Layout.tsx` linked straight to `/setup/source/box`, so everybody's checklist
 * was Box's regardless of what they were actually migrating. The owner hit it
 * within a minute of opening the page and asked whether it was demo data. It
 * was not; it was a hardcoded href.
 */
const ProviderChooser: React.FC = () => {
  const t = useT();
  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-xl font-semibold text-gray-900">{t('setup.choose.title')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('setup.choose.intro')}</p>
      {(['source', 'target'] as const).map((side) => (
        <div key={side} className="mt-6">
          <h3 className="text-sm font-medium text-gray-700">
            {t(side === 'source' ? 'setup.choose.sources' : 'setup.choose.targets')}
          </h3>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {providersWithSetup(side).map((p) => (
              <Link
                key={`${side}:${p}`}
                to={`/setup/${side}/${p}`}
                className="border border-gray-200 rounded-lg px-4 py-3 hover:border-gray-300 hover:bg-gray-50 text-gray-900"
              >
                {/* The provider's own name, not the wizard's key: nobody can
                    guess `oauth2` means Entra ID (workplan 0074). */}
                {providerDisplayName(p)}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Whether this PERSON administers the provider — which narrows what they can
 * usefully be shown (owner decision, workplan 0068).
 *
 * Deliberately **not** stored in the ledger beside the step states. A step's
 * state is a fact about the tenant's setup that a colleague should inherit;
 * "am I an administrator?" is a fact about whoever is looking, and two people
 * on the same tenant have different answers. Storing it per tenant would mean
 * the first person to answer decides what the second one sees.
 */
type AdminAnswer = 'yes' | 'no' | 'unknown';

function useAdminAnswer(side: string, provider: string) {
  const key = `setup.admin.${side}.${provider}`;
  const [answer, setAnswer] = React.useState<AdminAnswer>(() => {
    const stored = globalThis.localStorage?.getItem(key);
    return stored === 'yes' || stored === 'no' ? stored : 'unknown';
  });
  const set = (a: AdminAnswer) => {
    setAnswer(a);
    if (a === 'unknown') globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, a);
  };
  return [answer, set] as const;
}

const Setup: React.FC = () => {
  const t = useT();
  const { side, provider } = useParams<{ side: string; provider: string }>();
  const location = useLocation();
  const cameFrom = (location.state as { from?: string } | null)?.from;
  const backTo: { to: string; labelKey: StringKey } =
    cameFrom === '/connections'
      ? { to: '/connections', labelKey: 'setup.backToConnections' }
      : { to: '/mappings/new', labelKey: 'setup.backToWizard' };
  const queryClient = useQueryClient();
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const resolvedSide: 'source' | 'target' = side === 'target' ? 'target' : 'source';
  const [adminAnswer, setAdminAnswer] = useAdminAnswer(resolvedSide, provider ?? '');
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

  // No provider in the URL: ask which one, rather than picking for them.
  if (!provider) return <ProviderChooser />;

  if (isLoading) return <div className="p-6 text-gray-500">{t('common.loading')}</div>;
  if (error) return <div className="p-6 text-red-700">{serverMessage(error)}</div>;
  if (!data) return null;

  const { progress } = data;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex flex-wrap gap-4">
        {/* Back to where you actually came FROM (workplan 0074). This was a
            hardcoded link to the wizard, so reaching the checklist from
            Connections — which links here by design since 0065 — sent you
            somewhere you had never been. The linking screen says where it is;
            the wizard stays the default for a direct URL, because that is
            where most people arrive from. */}
        <Link to={backTo.to} className="text-sm text-blue-700 hover:underline">
          {t(backTo.labelKey)}
        </Link>
        {/* The long-form guide, in the app rather than as a filename nobody
            in a browser can open (workplan 0063). */}
        <Link to={`/docs/${guideSlug(data.provider)}`} className="text-sm text-blue-700 hover:underline">
          {t('setup.fullGuide')}
        </Link>
      </div>

      <h2 className="mt-2 text-xl font-semibold text-gray-900">
        {t('setup.title')} — {providerDisplayName(data.provider)}
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

          {/* The narrowing question (owner decision, workplan 0068). Asked
              BEFORE the list, because the answer changes what most of the list
              means: an admin sees seven things to do, while somebody without
              those rights sees four they can do and three to hand over. Showing
              everyone all seven made the page look like more work than it is. */}
          <div className="mt-4 border border-gray-200 rounded-lg p-4">
            <p className="text-sm font-medium text-gray-900">
              {t('setup.admin.question')} — {providerDisplayName(data.provider)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['yes', 'no', 'unknown'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAdminAnswer(a)}
                  className={`text-sm rounded px-3 py-1.5 border ${
                    adminAnswer === a
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                  }`}
                >
                  {t(
                    a === 'yes'
                      ? 'setup.admin.yes'
                      : a === 'no'
                        ? 'setup.admin.no'
                        : 'setup.admin.unsure',
                  )}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">{t('setup.admin.hint')}</p>
          </div>

          {(() => {
            // With "no", the admin-gated steps are not hidden — hiding work
            // does not make it go away, and somebody has to chase it. They are
            // SEPARATED, under a heading that says whose they are.
            const mine =
              adminAnswer === 'no'
                ? data.steps.filter((s) => !s.step.needsAnotherPerson)
                : data.steps;
            const theirs =
              adminAnswer === 'no'
                ? data.steps.filter((s) => s.step.needsAnotherPerson)
                : [];
            const list = (rows: typeof data.steps) => (
              <ul className="mt-4 space-y-3">
                {rows.map((s) => (
                  <li key={s.step.key} className="list-none">
                    <StepRow
                      status={s}
                      busy={busyKey === s.step.key}
                      onSet={(state) => set(s.step.key, state)}
                    />
                  </li>
                ))}
              </ul>
            );
            return (
              <>
                {adminAnswer === 'no' && mine.length > 0 && (
                  <h3 className="mt-6 text-sm font-medium text-gray-700">{t('setup.yours')}</h3>
                )}
                {list(mine)}
                {theirs.length > 0 && (
                  <>
                    <h3 className="mt-8 text-sm font-medium text-amber-800">
                      {t('setup.forYourAdmin')}
                    </h3>
                    <p className="mt-1 text-sm text-gray-600">{t('setup.forYourAdmin.hint')}</p>
                    {list(theirs)}
                  </>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
};

export default Setup;
