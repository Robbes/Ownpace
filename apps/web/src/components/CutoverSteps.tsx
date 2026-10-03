// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE SEVEN STEPS BEFORE A SWITCH, AS ONE ORDERED LIST (workplan 0154 T4).
 *
 * One list for a migration's page and a person's (0153 T5), so the two cannot
 * put the steps in different orders, call them different things, or say a
 * count two ways. In cutover order, with 0034's numbers, each row has:
 *
 * - **its count**: *"3 to decide"*, *"Not run yet"*, *"Passed 2 days ago"*;
 * - **its state** in words beside its colour (0145 T2): *Done*, *Needs you* or
 *   *Not yet*;
 * - **one line on what the step is**, the hub's own, within 0118's budget.
 *
 * Of one migration, a step's name opens that migration's own page for it. Of
 * a person's several, each row sums them and lists them, each link opening
 * that migration's page, and on a queue's step carrying its own count, so the
 * person sees which one the work is in.
 *
 * While a read is on its way its rows say nothing yet. A read that failed says
 * *Could not be read*, and claims no state (hard rule 9). The names link
 * whatever loads: the navigation is the deliverable (0019 T4).
 */
import React from 'react';
import { Link } from 'react-router';
import type { CheckFacts, MappingAttention } from '@openmig/shared';
import { cutoverSteps, type CheckSaid, type Step, type StepState } from '../services/cutover-steps.ts';
import { SCREENS } from '../pages/hub-screens.ts';
import { useT, useFormatters, type StringKey } from '../i18n/index.tsx';

/** The hub's step for each of the seven, for its name, its line and its path. */
const SCREEN_OF: Readonly<Record<Step['key'], (typeof SCREENS)[number]>> = {
  deletions: SCREENS.find((s) => s.path === 'deletions')!,
  moves: SCREENS.find((s) => s.path === 'moves')!,
  failures: SCREENS.find((s) => s.path === 'failures')!,
  sharing: SCREENS.find((s) => s.path === 'sharing')!,
  check: SCREENS.find((s) => s.path === 'verify')!,
  confirmed: SCREENS.find((s) => s.path === 'confirmed')!,
  finish: SCREENS.find((s) => s.path === 'finish')!,
};

const STATE_WORD: Readonly<Record<StepState, StringKey>> = {
  done: 'person.state.done',
  needsYou: 'person.state.needsYou',
  notYet: 'person.state.notYet',
};

const STATE_TONE: Readonly<Record<StepState, string>> = {
  done: 'bg-green-50 text-green-800',
  needsYou: 'bg-amber-100 text-amber-900',
  notYet: 'bg-gray-100 text-gray-700',
};

/** The steps that count a queue, whose link to each migration carries that migration's own count. */
const QUEUE_STEPS: ReadonlySet<Step['key']> = new Set(['deletions', 'moves', 'failures', 'sharing']);

/** A migration as the list reads it: its lifecycle (undefined where unread), and its name for a person's several. */
export interface StepsRow {
  readonly id: string;
  readonly status: string | undefined;
  readonly label: string;
}

/** Which reads are still on their way: the rows resting on one say nothing yet. */
export interface StepsPending {
  /** `GET /api/attention`: the four queues. */
  readonly queues: boolean;
  /** The progress read: the check, and Confirmed after it. */
  readonly check: boolean;
  /** The migration's lifecycle: Sharing's state, the check's cutover, and Finish. */
  readonly lifecycle: boolean;
}

export const CutoverSteps: React.FC<{
  migrations: ReadonlyArray<StepsRow>;
  /** Each migration's queues, by id; undefined while the read is out or where it failed. */
  attention: ReadonlyMap<string, MappingAttention> | undefined;
  /** Each migration's check, by id, from the progress read; undefined likewise. */
  checks: ReadonlyMap<string, CheckFacts> | undefined;
  pending: StepsPending;
}> = ({ migrations, attention, checks, pending: reads }) => {
  const t = useT();
  const { relativeToNow } = useFormatters();
  const steps = cutoverSteps(migrations, attention, checks);
  const only = migrations.length === 1 ? migrations[0]! : undefined;

  const pending = (step: Step): boolean => {
    switch (step.key) {
      case 'check':
      case 'confirmed':
        return reads.check || reads.lifecycle;
      case 'finish':
        return reads.lifecycle;
      case 'sharing':
        return reads.queues || reads.lifecycle;
      default:
        return reads.queues;
    }
  };

  const checkWords = (said: CheckSaid | undefined): string => {
    if (said === undefined) return t('person.step.unread');
    switch (said.kind) {
      case 'passed':
        return said.at
          ? t('person.step.check.passedWhen', { when: relativeToNow(said.at) })
          : t('person.step.check.passed');
      case 'partly':
        return t('person.step.check.partly', { n: said.passed, total: said.total });
      case 'notRun':
        return t('person.step.check.notRun');
      case 'running':
        return t('person.step.check.running');
      case 'couldNotRun':
        return t('person.step.check.couldNotRun', { when: relativeToNow(said.at) });
      case 'notPassed':
        return said.at
          ? t('person.step.check.notPassedWhen', { when: relativeToNow(said.at) })
          : t('person.step.check.notYet');
    }
  };

  const countWords = (step: Step): string => {
    if (step.key === 'check') return checkWords(step.check);
    if (step.key === 'confirmed') {
      if (step.state === undefined) return t('person.step.unread');
      return step.state === 'done' ? t('person.step.confirmed.done') : t('person.step.confirmed.notYet');
    }
    if (step.key === 'finish') {
      if (step.state === undefined) return t('person.step.unread');
      return step.state === 'done' ? t('person.step.finish.done') : t('person.step.finish.notYet');
    }
    if (step.count === undefined) return t('person.step.unread');
    if (step.count === 0) return t('person.step.none');
    if (step.key === 'failures') {
      return step.count === 1 ? t('person.step.failures.one') : t('person.step.failures.many', { n: step.count });
    }
    return t(`person.step.${step.key}` as StringKey, { n: step.count });
  };

  return (
    <ol className="mt-3 divide-y divide-gray-100">
      {steps.map((step, i) => {
        const screen = SCREEN_OF[step.key];
        const name = t(screen.nameKey);
        const waiting = pending(step);
        return (
          <li key={step.key} data-step={step.key} className="flex items-baseline gap-2 py-3">
            {/* The number is the list's: a screen reader already hears the
                item's place in an ordered list, so it is not said twice. The
                row is two columns, so a count or a state that wraps on a
                phone stays under the step's name. */}
            <span aria-hidden="true" className="w-4 shrink-0 text-right text-sm text-gray-500 tabular-nums">
              {i + 1}.
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {only ? (
                  <Link
                    to={`/mappings/${encodeURIComponent(only.id)}/${screen.path}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {name}
                  </Link>
                ) : (
                  <span className="font-medium text-gray-900">{name}</span>
                )}
                {!waiting && <span className="text-sm text-gray-700">{countWords(step)}</span>}
                {!waiting && step.state && (
                  <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${STATE_TONE[step.state]}`}>
                    {t(STATE_WORD[step.state])}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500">{t(screen.blurbKey)}</p>
              {!only && (
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {migrations.map((m) => {
                    // Which migration holds what the row sums, so the person
                    // knows which of the links has work behind it.
                    const own =
                      QUEUE_STEPS.has(step.key) && !waiting
                        ? step.perMigration.find((p) => p.id === m.id)
                        : undefined;
                    return (
                      <li key={m.id}>
                        <Link
                          to={`/mappings/${encodeURIComponent(m.id)}/${screen.path}`}
                          className="text-blue-700 hover:underline"
                        >
                          {own === undefined
                            ? m.label
                            : own.count === undefined
                              ? t('person.step.linkUnread', { name: m.label })
                              : `${m.label} (${own.count})`}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};
