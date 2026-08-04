// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The drift decision queue (SAD §11.1/§11.2, workplan 0028 T1 — the skeleton).
 *
 * The mapping-level lifecycle queue above the item queues: drift the sync
 * notices becomes a question the owner answers here. This slice reads and
 * answers; NOTHING can raise yet — the two detectors (0028 T2/T3) are not
 * built — and the empty state says exactly that (rule 9): an empty queue that
 * cannot fill must not read as "no drift".
 *
 * The frame is the dictionary's (bilingual, 0024); `summary` and `detail` are
 * the server's words, verbatim — the prose boundary.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListTodo } from 'lucide-react';
import type { DecisionRow } from '@openmig/shared';
import {
  fetchDriftDecisions,
  resolveDriftDecision,
  dismissDriftDecision,
  fetchDecisionPresets,
  setDecisionPreset,
} from '../services/operating-service';
import { useAuthStore } from '../stores/auth-store';
import { useT, useFormatters } from '../i18n';
import type { StringKey } from '../i18n';

/** The server's message for a failed request, verbatim; dictionary fallback. */
function errorText(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: unknown } } })?.response?.data;
  if (data && typeof data.message === 'string' && data.message) return data.message;
  return fallback;
}

const Decisions: React.FC = () => {
  const t = useT();
  const { dateTime } = useFormatters();
  const queryClient = useQueryClient();
  const [busyRow, setBusyRow] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});
  const { user } = useAuthStore();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const [presetBusy, setPresetBusy] = React.useState(false);
  const [presetSaved, setPresetSaved] = React.useState(false);
  const [presetDraft, setPresetDraft] = React.useState<'auto' | 'ask' | null>(null);

  const query = useQuery({
    queryKey: ['drift-decisions'],
    queryFn: fetchDriftDecisions,
  });

  // The standing answers (0028 T5). Read separately from the queue: a
  // failure here must not hide the decisions themselves, and a queue shown
  // without saying which categories answer themselves is a queue whose
  // silence is unexplained.
  const presetQuery = useQuery({
    queryKey: ['decision-presets'],
    queryFn: fetchDecisionPresets,
  });

  /** The standing answer for new_mailbox — the only category with a detector. */
  const newMailboxPreset: 'auto' | 'ask' =
    presetDraft ??
    presetQuery.data?.presets.find((p) => p.category === 'new_mailbox')?.action ??
    presetQuery.data?.defaultAction ??
    'ask';

  const savePreset = async (action: 'auto' | 'ask') => {
    setPresetBusy(true);
    setPresetSaved(false);
    setPresetDraft(action);
    try {
      setPresetDraft((await setDecisionPreset('new_mailbox', action)).action);
      setPresetSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['decision-presets'] });
    } catch {
      // Back to what is actually stored: leaving the new value on screen
      // would show a standing answer nobody has.
      setPresetDraft(null);
    } finally {
      setPresetBusy(false);
    }
  };

  const act = async (
    decision: DecisionRow,
    action: 'resolve' | 'dismiss',
    /** §14.1's answer, for `shared_address_pattern` (0028 T3). */
    pattern?: 'shared_s' | 'distribution_d',
  ) => {
    setBusyRow(decision.id);
    setRowErrors((errors) => ({ ...errors, [decision.id]: '' }));
    try {
      if (action === 'resolve') {
        // Two shapes of answer. Accepting a proposed default is the general
        // one; `shared_address_pattern` names WHICH pattern instead, because
        // it has no default — not knowing which of the two it is is the whole
        // reason it was asked. The server reads `pattern` and writes it back
        // to the discovered group.
        await resolveDriftDecision(
          decision.id,
          pattern
            ? { action: 'set_shared_address_pattern', pattern }
            : {
                action: 'accept_default',
                ...(decision.proposedDefault
                  ? { proposedDefault: decision.proposedDefault }
                  : {}),
              },
        );
      } else {
        await dismissDriftDecision(decision.id);
      }
      await queryClient.invalidateQueries({ queryKey: ['drift-decisions'] });
    } catch (err) {
      setRowErrors((errors) => ({
        ...errors,
        [decision.id]: errorText(err, t('decisions.requestFailed')),
      }));
    } finally {
      setBusyRow(null);
    }
  };

  const decisions = query.data?.decisions ?? [];
  const pending = decisions.filter((d) => d.status === 'pending');
  const answered = decisions.filter((d) => d.status !== 'pending');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('decisions.title')}</h1>
        <p className="text-gray-500 mt-1">{t('decisions.intro')}</p>
      </div>

      {/* Standing answers (workplan 0028 T5) */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          {t('decisions.presets.heading')}
        </h2>
        <p className="text-sm text-gray-500 mb-3">{t('decisions.presets.intro')}</p>
        {presetQuery.isError ? (
          /* Said, not hidden: a queue that answers some categories without
             showing which is exactly the silence this feature exists to
             explain (rule 9). */
          <p className="text-amber-700">{t('decisions.presets.readError')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              {t('decisions.presets.newMailbox')}
              <select
                value={newMailboxPreset}
                disabled={!canManage || presetBusy || !presetQuery.isSuccess}
                onChange={(e) => savePreset(e.target.value as 'auto' | 'ask')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="ask">{t('decisions.presets.ask')}</option>
                <option value="auto">{t('decisions.presets.auto')}</option>
              </select>
            </label>
            {!canManage && (
              <span className="text-sm text-gray-500">{t('decisions.presets.readOnly')}</span>
            )}
            {presetSaved && (
              <span className="text-sm text-green-700">{t('decisions.presets.saved')}</span>
            )}
          </div>
        )}
      </div>

      {query.isError ? (
        <p className="text-amber-700">{t('decisions.readError')}</p>
      ) : query.isLoading ? (
        <p className="text-gray-500">{t('common.loading')}</p>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              {t('queue.waitingOnYou')}{' '}
              <span className="text-gray-400 font-normal">({pending.length})</span>
            </h2>
            {pending.length === 0 ? (
              <div className="flex items-start gap-3 text-gray-500">
                <ListTodo className="w-5 h-5 mt-0.5 flex-shrink-0" />
                {/* The honest empty state: this queue CANNOT fill yet. */}
                <p>{t('decisions.empty.noDetectors')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {pending.map((decision) => (
                  <li key={decision.id} className="py-3 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                        {t(`decisionCategory.${decision.category}` as StringKey)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {dateTime(decision.createdAt)}
                      </span>
                    </div>
                    {/* The server's words, verbatim. */}
                    <p className="text-gray-900">{decision.summary}</p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {/* §14.1's two answers (0028 T3). Named, not defaulted:
                          this category is raised precisely because the source
                          could not tell which one it is. */}
                      {decision.category === 'shared_address_pattern' &&
                        (['shared_s', 'distribution_d'] as const).map((pattern) => (
                          <button
                            key={pattern}
                            onClick={() => act(decision, 'resolve', pattern)}
                            disabled={busyRow === decision.id}
                            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            {t(`decisions.sharedAddress.${pattern}` as StringKey)}
                          </button>
                        ))}
                      {decision.proposedDefault && (
                        <button
                          onClick={() => act(decision, 'resolve')}
                          disabled={busyRow === decision.id}
                          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          {/* The detector's own proposal, verbatim, as the button. */}
                          {decision.proposedDefault}
                        </button>
                      )}
                      <button
                        onClick={() => act(decision, 'dismiss')}
                        disabled={busyRow === decision.id}
                        className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                      >
                        {t('decisions.dismiss')}
                      </button>
                    </div>
                    {rowErrors[decision.id] && (
                      <p className="text-sm text-amber-700">{rowErrors[decision.id]}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              {t('queue.alreadyDecided')}{' '}
              <span className="text-gray-400 font-normal">({answered.length})</span>
            </h2>
            {answered.length === 0 ? (
              <p className="text-gray-500">{t('decisions.empty.answered')}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {answered.map((decision) => (
                  <li key={decision.id} className="py-3 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                        {t(`decisionCategory.${decision.category}` as StringKey)}
                      </span>
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                        {t(`decisionStatus.${decision.status}` as StringKey)}
                      </span>
                      {decision.resolvedAt && (
                        <span className="text-xs text-gray-400">
                          {dateTime(decision.resolvedAt)}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600">{decision.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Decisions;
