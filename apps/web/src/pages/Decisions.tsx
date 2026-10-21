// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The drift decision queue (SAD §11.1/§11.2, workplan 0028 T1 — the skeleton).
 *
 * The mapping-level lifecycle queue above the item queues: drift the sync
 * notices becomes a question the owner answers here. Both detectors ship
 * (0028 T2/T3 — managed-drift-detect and managed-group-discovery run daily);
 * what they still lack is the tenant's admin consent to LOOK, and the empty
 * state distinguishes "no drift" from "cannot look yet" (rule 9).
 *
 * The frame is the dictionary's (bilingual, 0024). A decision's question
 * and its accept button are said in the reader's language by
 * `@openmig/shared` (`decision-words.ts`, class 4 of the prose boundary),
 * built from its category and detail (the owner, 2026-10-18); where they
 * cannot be, the stored summary and the detector's proposal render as
 * served, marked English. The recorded answer and the facts in Details are
 * said through the dictionary (UX sweep, 2026-10-17): they are stored as JSON
 * and internal keys, which is what the screen used to print. The line under
 * an answer is the server's, which serves it in both languages (`effect`,
 * `effectNl`; workplan 0159 §6 item 12); the page shows the reader's half.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListTodo } from 'lucide-react';
import {
  NEW_MAILBOX_ANSWER,
  decisionAcceptLabel,
  decisionEffectText,
  decisionSummary,
  type DecisionEffectFields,
  type DecisionRow,
} from '@openmig/shared';
import {
  fetchAttention,
  fetchDriftDecisions,
  resolveDriftDecision,
  dismissDriftDecision,
  fetchDecisionPresets,
  setDecisionPreset,
} from '../services/operating-service.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { isSelfHost } from '../services/edition.ts';
import { useLocale, useFormatters } from '../i18n/index.tsx';
import StateChip from '../components/StateChip.tsx';
import AsOf from '../components/AsOf.tsx';
import type { StringKey } from '../i18n/index.tsx';
import { Hint } from '../components/Hint.tsx';
import { AttentionSummary } from '../components/AttentionSummary.tsx';

/**
 * The recorded answer, in words — or nothing (UX sweep, 2026-10-17).
 *
 * "Already decided" printed the answer as it is stored, `{"action":
 * "accept_default"}` in a code font. The shapes are few and known: a named
 * shared-address pattern, an accepted proposal, a standing answer. Anything
 * else gets no line, because the status chip beside it already says how the
 * row was closed, and its JSON would say nothing more to a person. Neither
 * does an auto-resolved row: its chip reads "Decided by preset".
 */
function answerKey(decision: DecisionRow): StringKey | undefined {
  if (decision.status === 'auto_resolved') return undefined;
  const r = decision.resolution;
  if (!r) return undefined;
  if (r.pattern === 'shared_s') return 'decisions.sharedAddress.shared_s';
  if (r.pattern === 'distribution_d') return 'decisions.sharedAddress.distribution_d';
  if (r.action === 'accept_default') return 'decisions.answer.acceptDefault';
  if ('preset' in r) return 'decisions.answer.preset';
  return undefined;
}

/**
 * The recorded answer's words. A new mailbox's accepted answer is said in the
 * words of the button that gave it, *Noted, I will handle it*: the page never
 * showed that row a proposal, so *Accepted the proposal* would record
 * something nobody read (review of the owner's 2026-10-18 answers).
 */
function answerWords(
  decision: DecisionRow,
  locale: 'en' | 'nl',
  t: (key: StringKey) => string,
): string | undefined {
  const key = answerKey(decision);
  if (key === 'decisions.answer.acceptDefault' && decision.category === 'new_mailbox') {
    return NEW_MAILBOX_ANSWER[locale];
  }
  return key && t(key);
}

/** One of the detail's facts when it is text, else nothing. */
function detailText(decision: DecisionRow, key: 'address' | 'displayName'): string | undefined {
  const v = decision.detail?.[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** The server's message for a failed request, verbatim; dictionary fallback. */
function errorText(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: unknown } } })?.response?.data;
  if (data && typeof data.message === 'string' && data.message) return data.message;
  return fallback;
}

const Decisions: React.FC = () => {
  const { t, locale } = useLocale();
  // Text in another language than the page's says which (a stored English
  // sentence under Dutch), so a screen reader reads it as English.
  const langOf = (said: { lang: string }) => (said.lang !== locale ? said.lang : undefined);
  const { dateTime } = useFormatters();
  const queryClient = useQueryClient();
  const [busyRow, setBusyRow] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});
  // Both halves of each row's effect, as served: the line follows the
  // reader's language, also when they switch it after answering.
  const [rowEffects, setRowEffects] = React.useState<
    Record<string, Partial<DecisionEffectFields>>
  >({});
  const { user } = useAuthStore();
  // The appliance has ONE operator and no roles (a genuine edition seam,
  // hard rule 5): its server accepts the preset PUT from that operator, but
  // this managed-role check locked the standing-answers control forever and
  // captioned it with roles that do not exist there (0038 T4).
  const canManage = isSelfHost() || user?.role === 'owner' || user?.role === 'admin';
  const [presetBusy, setPresetBusy] = React.useState(false);
  const [presetSaved, setPresetSaved] = React.useState(false);
  const [presetError, setPresetError] = React.useState<string | null>(null);
  const [presetDraft, setPresetDraft] = React.useState<'auto' | 'ask' | null>(null);

  // No per-query staleTime: this screen inherits the app's 5-minute default,
  // which made it the STALEST decision surface in the product — the as-of
  // below is what makes that visible (0036 T1).
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

  // EVERYTHING waiting, not just the queue below (owner report, 2026-09-14).
  // Read separately from the decisions for the same reason the presets are:
  // one failing read must not empty the screen, and this one especially —
  // the drift queue being answerable says nothing about the 34 files that
  // are not.
  const attentionQuery = useQuery({
    queryKey: ['attention'],
    queryFn: fetchAttention,
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
    setPresetError(null);
    try {
      setPresetDraft((await setDecisionPreset('new_mailbox', action)).action);
      setPresetSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['decision-presets'] });
    } catch (err) {
      // Back to what is actually stored: leaving the new value on screen
      // would show a standing answer nobody has. But say WHY it reverted —
      // the silent snap-back read as a flaky dropdown (0038 T4).
      setPresetDraft(null);
      setPresetError(errorText(err, t('common.requestFailed')));
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
      let closed: Partial<DecisionEffectFields>;
      if (action === 'resolve') {
        // Two shapes of answer. Accepting a proposed default is the general
        // one; `shared_address_pattern` names WHICH pattern instead, because
        // it has no default — not knowing which of the two it is is the whole
        // reason it was asked. The server reads `pattern` and writes it back
        // to the discovered group.
        closed = await resolveDriftDecision(
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
        closed = await dismissDriftDecision(decision.id);
      }
      // The server's effect sentence (0036 T2), in English and in Dutch
      // (0159 §6 item 12) — the row moves to "Already decided" on the
      // refetch, and this line under it says what the click actually did.
      // Decisions was the one surface whose answers vanished silently.
      const { effect, effectNl } = closed;
      if (effect || effectNl) {
        setRowEffects((prev) => ({ ...prev, [decision.id]: { effect, effectNl } }));
      }
      await queryClient.invalidateQueries({ queryKey: ['drift-decisions'] });
    } catch (err) {
      setRowErrors((errors) => ({
        ...errors,
        [decision.id]: errorText(err, t('common.requestFailed')),
      }));
    } finally {
      setBusyRow(null);
    }
  };

  const decisions = query.data?.decisions ?? [];
  // Each row's question and accept button, in the reader's language.
  const pending = decisions
    .filter((d) => d.status === 'pending')
    .map((decision) => ({
      decision,
      said: decisionSummary(decision, locale),
      accept: decisionAcceptLabel(decision, locale),
    }));
  const answered = decisions.filter((d) => d.status !== 'pending');

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-gray-900">{t('decisions.title')}</h1>
          {query.dataUpdatedAt > 0 && (
            <AsOf
              timestamp={query.dataUpdatedAt}
              onRefresh={() => void query.refetch()}
              refreshing={query.isFetching}
            />
          )}
        </div>
      </div>

      {/* FIRST, above the drift queue. The menu calls this page *Needs you*
          (0153 T6 (b), where it said "Attention") and this is the answer to
          it; the queue below is one of the things it counts, and was the
          only one this screen ever showed. */}
      <AttentionSummary
        mappings={attentionQuery.data?.mappings ?? []}
        {...(attentionQuery.data?.tenant ? { tenant: attentionQuery.data.tenant } : {})}
        failed={attentionQuery.isError}
      />

      {/* Standing answers (workplan 0028 T5) */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          {t('decisions.presets.heading')}
        </h2>
        <Hint className="mb-3" label="more" text={t('decisions.presets.intro')} why={t('decisions.presets.intro.more')} />
        {presetQuery.isError ? (
          /* Said, not hidden: a queue that answers some categories without
             showing which is exactly the silence this feature exists to
             explain (rule 9). */
          <p className="text-amber-700">{t('decisions.presets.readError')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {/* A column on a phone: beside the select, the label was squeezed
                into a strip five lines tall. */}
            <label className="flex flex-col items-start gap-1 text-sm text-gray-700 sm:flex-row sm:items-center sm:gap-2">
              {t('decisions.presets.newMailbox')}
              <select
                value={newMailboxPreset}
                disabled={!canManage || presetBusy || !presetQuery.isSuccess}
                onChange={(e) => savePreset(e.target.value as 'auto' | 'ask')}
                className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
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
            {presetError && (
              // The server's words for why the dropdown snapped back.
              <span className="text-sm text-amber-800">{presetError}</span>
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
            {/* The organisation's own decisions, under the name the page had
                before it was *Needs you*: a heading that repeated the page's
                would say nothing about what this list holds. */}
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              {t('decisions.waiting')}{' '}
              <span className="text-gray-500 font-normal">({pending.length})</span>
            </h2>
            <p className="text-gray-500 mb-3">{t('decisions.intro')}</p>
            {pending.length === 0 ? (
              <div className="flex items-start gap-3 text-gray-500">
                <ListTodo className="w-5 h-5 mt-0.5 flex-shrink-0" />
                {/* The honest empty state: this queue CANNOT fill yet. */}
                <p>{t('decisions.empty.noDetectors')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {pending.map(({ decision, said, accept }) => (
                  <li key={decision.id} className="py-3 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                        {t(`decisionCategory.${decision.category}` as StringKey)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {dateTime(decision.createdAt)}
                      </span>
                    </div>
                    {/* The question in the reader's language, or the stored
                        English where it cannot be built. */}
                    <p className="text-gray-900" lang={langOf(said)}>{said.text}</p>
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
                      {accept && (
                        <button
                          onClick={() => act(decision, 'resolve')}
                          disabled={busyRow === decision.id}
                          lang={langOf(accept)}
                          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          {/* What pressing does: a new mailbox's answer only
                              records it, and says so; another category's is
                              the detector's own proposal, as served. */}
                          {accept.text}
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
              <span className="text-gray-500 font-normal">({answered.length})</span>
            </h2>
            {answered.length === 0 ? (
              <p className="text-gray-500">{t('decisions.empty.answered')}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {answered.map((decision) => {
                  const answer = answerWords(decision, locale, t);
                  // "by" names somebody only when it is an address a person
                  // can read: on managed the server holds the sign-in's id,
                  // and a preset's own name, neither of which says who.
                  const by = decision.resolvedBy?.includes('@') ? decision.resolvedBy : undefined;
                  const address = detailText(decision, 'address');
                  const displayName = detailText(decision, 'displayName');
                  const said = decisionSummary(decision, locale);
                  const served = rowEffects[decision.id];
                  const effect = served && decisionEffectText(served, locale);
                  return (
                    <li key={decision.id} className="py-3 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          {t(`decisionCategory.${decision.category}` as StringKey)}
                        </span>
                        <StateChip
                          entity="decision"
                          state={decision.status as 'resolved' | 'auto_resolved' | 'dismissed'}
                        />
                        {decision.resolvedAt && (
                          <span className="text-xs text-gray-500">
                            {dateTime(decision.resolvedAt)}
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600" lang={langOf(said)}>{said.text}</p>
                      {/* The whole story (0038 T5): the contract carries the
                          recorded answer, who gave it, and the structured facts
                          — the screen rendered none of them (its own header
                          comment claimed detail renders; it never did). */}
                      {answer ? (
                        <p className="text-xs text-gray-600">
                          {t('decisions.answer')} {answer}
                          {by && (
                            <span className="text-gray-500">
                              {' '}
                              {t('decisions.answeredBy')} {by}
                            </span>
                          )}
                        </p>
                      ) : (
                        // No answer in words to hang "by" on, but who closed
                        // it is still part of the story.
                        by && (
                          <p className="text-xs text-gray-500">
                            {t('decisions.decidedBy', { who: by })}
                          </p>
                        )
                      )}
                      {/* The two facts a person recognises, labelled. The rest of
                          the detail is the detector's own ids, which said
                          nothing to anyone reading them here. */}
                      {(address || displayName) && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-gray-500 select-none">
                            {t('decisions.detailToggle')}
                          </summary>
                          <dl className="mt-1 pl-3 border-l-2 border-gray-100 space-y-0.5">
                            {address && (
                              <div className="flex flex-wrap gap-x-2">
                                <dt className="text-gray-500">{t('decisions.detail.address')}</dt>
                                <dd className="text-gray-700 break-words">{address}</dd>
                              </div>
                            )}
                            {displayName && (
                              <div className="flex flex-wrap gap-x-2">
                                <dt className="text-gray-500">{t('decisions.detail.displayName')}</dt>
                                <dd className="text-gray-700 break-words">{displayName}</dd>
                              </div>
                            )}
                          </dl>
                        </details>
                      )}
                      {effect && (
                        // What the click DID — the server's sentence, in the
                        // reader's language; the English as served, marked so
                        // under Dutch, from a server that sent no Dutch.
                        <p className="text-xs text-emerald-700" lang={langOf(effect)}>
                          {effect.text}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Decisions;
