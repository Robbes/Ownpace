// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE FOUR CADENCES A MIGRATION IS OFFERED, as one control.
 *
 * The wizard drew them as four buttons of its own. Since the owner's decision
 * of 2026-09-28 the migration page offers the same four, so they are one
 * control, rendered by both, for the reason `NativeFilePolicyChooser` is
 * (0125 T3): two copies drift, and a person would be told different things
 * about their migration depending on which screen they read.
 *
 * The presets are the whole offer (the owner, 2026-09-07). The API accepts any
 * cadence the tick can read, so a migration made through it may hold one that
 * is none of these. The panel that shows such a migration says so beside this
 * control, rather than this control pretending one of the four is selected.
 *
 * AND AUTOMATIC, FIRST (workplan 0157 T7; the owner, 2026-10-05: *"sync slow
 * down once a migration is in step: yes"*): no schedule of its own, which the
 * tick reads as every hour for 14 days once everything is copied, then every
 * 6 hours, then once a day from day 30, with the 14 days starting again when
 * somebody opens the migration or presses *Sync now* (`automaticScheduleFor`).
 * It is what *Start a migration* makes, and `null` here, as the API stores it.
 */
import React from 'react';
import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';

export interface SchedulePreset {
  /** The cron expression stored on the migration and read by the tick. */
  readonly value: string;
  readonly labelKey: StringKey;
  /** How often that is, in words. It must say what the cron does. */
  readonly hintKey: StringKey;
  /** The shortest gap between two of its passes, in minutes, as the tick reads it. */
  readonly everyMinutes: number;
}

export const SCHEDULE_PRESETS: ReadonlyArray<SchedulePreset> = [
  { value: '0 * * * *', labelKey: 'wizard.schedule.hourly', hintKey: 'wizard.schedule.hourly.hint', everyMinutes: 60 },
  { value: '0 2 * * *', labelKey: 'wizard.schedule.daily', hintKey: 'wizard.schedule.daily.hint', everyMinutes: 1440 },
  {
    value: '0 */6 * * *',
    labelKey: 'wizard.schedule.sixHourly',
    hintKey: 'wizard.schedule.sixHourly.hint',
    everyMinutes: 360,
  },
  {
    value: '*/15 * * * *',
    labelKey: 'wizard.schedule.quarterHourly',
    hintKey: 'wizard.schedule.quarterHourly.hint',
    everyMinutes: 15,
  },
];

/** Whether a stored schedule is one of the four this control offers. */
export function isSchedulePreset(value: string | undefined): boolean {
  return SCHEDULE_PRESETS.some((preset) => preset.value === value);
}

/**
 * The automatic cadence: no schedule of its own (workplan 0157 T7). Never held
 * back by a tier's pace: on Free it runs once a day, as the pace does.
 */
const AUTOMATIC: Omit<SchedulePreset, 'value' | 'everyMinutes'> & {
  readonly value: null;
  readonly everyMinutes: 0;
} = {
  value: null,
  labelKey: 'wizard.schedule.automatic',
  hintKey: 'wizard.schedule.automatic.hint',
  everyMinutes: 0,
};

export const ScheduleChooser: React.FC<{
  /** The selected cron; null for Automatic; a cron this control does not offer selects none. */
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /**
   * The tier's pace (workplan 0157 T4): the least minutes between two passes,
   * 1,440 on Free outside the alpha. A cadence faster than it is not offered,
   * since the tick would not run it; the panel says why beside this control.
   */
  leastMinutesBetweenPasses?: number;
}> = ({ value, onChange, disabled, leastMinutesBetweenPasses = 0 }) => {
  const t = useT();
  return (
    <div className="space-y-3">
      {[AUTOMATIC, ...SCHEDULE_PRESETS].map((preset) => (
        <button
          key={preset.value ?? 'automatic'}
          type="button"
          onClick={() => onChange(preset.value)}
          disabled={disabled || (preset.value !== null && preset.everyMinutes < leastMinutesBetweenPasses)}
          aria-pressed={value === preset.value}
          className={`w-full p-4 border-2 rounded-lg text-left transition-colors disabled:opacity-50 ${
            value === preset.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <p className="font-medium text-gray-900">{t(preset.labelKey)}</p>
          <p className="text-sm text-gray-500">{t(preset.hintKey)}</p>
        </button>
      ))}
    </div>
  );
};
