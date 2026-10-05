// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE SCHEDULE, CHANGED ON THE MIGRATION'S OWN PAGE (the owner, 2026-09-28).
 *
 * The owner asked, of a Dropbox migration made hourly, what every 15 minutes
 * would have done, and whether he could change it now. He could not: the
 * update route did not write a schedule, so a migration's cadence was fixed
 * when it was created, although the revision table has always said it may
 * change (`config-revision.ts`: *"The next pass simply happens sooner or
 * later"*). His answer to the three ways out was (c): make it editable here.
 *
 * WHAT IT OFFERS is the wizard's four cadences, through the wizard's own
 * control (`ScheduleChooser`), so the two screens cannot offer different
 * ones.
 *
 * WHAT IT SHOWS FIRST is the schedule in force. A migration without a schedule
 * of its own runs the automatic cadence (workplan 0157 T7), and *Automatic* is
 * selected; one with a cron the chooser offers has that one selected. One made
 * through the API may hold any cadence the tick can read; for that none is
 * selected, and a line says what runs instead. A chooser with nothing
 * selected, and nothing said, would read as a migration with no schedule at
 * all.
 *
 * `mayRevise('schedule')` is asked, not assumed, as the export-format panel
 * asks for its field: refuse it in the table and this panel stops offering the
 * press and says why. A refusal from the route is shown as the refusal it is
 * (hard rule 9), never as a save that worked.
 *
 * AT THE TIER'S PACE (workplan 0157 T4): on Free, outside the alpha, a
 * migration runs one pass a day whatever its schedule, so the chooser offers
 * Automatic and Daily and says why the faster ones are not offered, with the
 * way to them: a higher tier, on the Billing page. A schedule faster than that,
 * kept from when the organisation was on a higher tier, stays selected, and
 * the same line says it runs once a day: nothing is rewritten. The route
 * refuses a faster one too (`free_pace_schedule`), said here in the reader's
 * words.
 *
 * FOLDED, IN A FAMILY'S WORDS (workplan 0153 T6 (b), approved by the owner on
 * 2026-09-28): *How often to look for changes*, where it said *Sync schedule*.
 * Closed, the fold still says the cadence in force, in the chooser's own words,
 * so nobody opens it to find out how often a migration runs.
 */
import React from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { mayRevise } from '@openmig/shared';
import { mappingApi } from '../services/mapping-service.ts';
import { revisionRefusals, scheduleAtPaceRefusal, serverMessage } from '../services/api.ts';
import { useT } from '../i18n/index.tsx';
import { Hint } from './Hint.tsx';
import { SCHEDULE_PRESETS, ScheduleChooser, isSchedulePreset } from './ScheduleChooser.tsx';

/** Free's pace, one pass a day (`FREE_PASS_EVERY_MINUTES` in `@openmig/managed`). */
const ONE_DAY_MINUTES = 24 * 60;

const SchedulePanel: React.FC<{
  mappingId: string;
  /** The detail payload's `syncConfig.schedule`: absent when the migration holds none. */
  current: string | undefined;
  /**
   * The detail payload's `pace` (workplan 0157 T4): the least minutes between
   * two passes. Absent from an API that predates it, which held no pace.
   */
  leastMinutesBetweenPasses?: number;
}> = ({ mappingId, current, leastMinutesBetweenPasses = 0 }) => {
  const t = useT();
  const queryClient = useQueryClient();
  // What the migration holds: a cron, or null for Automatic (no schedule).
  const stored = current ?? null;
  const [chosen, setChosen] = React.useState<string | null>(stored);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [refused, setRefused] = React.useState<ReadonlyArray<{ field: string; reason: string }>>([]);
  const [failed, setFailed] = React.useState<string | null>(null);

  // What the migration holds is the source of truth, and it changes under
  // this panel when a save lands and the detail query is read again.
  React.useEffect(() => {
    setChosen(stored);
  }, [stored]);
  const changed = chosen !== stored;

  const verdict = mayRevise('schedule');
  // What runs now, in the chooser's words: Automatic for a migration with no
  // schedule of its own, and nothing for one that holds a cadence the chooser
  // does not offer, which the line inside says.
  const inForce =
    stored === null
      ? t('wizard.schedule.automatic')
      : (() => {
          const preset = SCHEDULE_PRESETS.find((p) => p.value === stored);
          return preset ? t(preset.labelKey) : undefined;
        })();

  const save = async () => {
    setSaving(true);
    // What the last press said is cleared before this one speaks, so "Saved"
    // and a refusal are never on screen together.
    setRefused([]);
    setFailed(null);
    setSaved(false);
    try {
      await mappingApi.setSchedule(mappingId, chosen);
      setSaved(true);
      // The panel reads the schedule off the detail query, so the save is not
      // finished until that has been read again.
      await queryClient.invalidateQueries({ queryKey: ['mapping', mappingId] });
    } catch (err) {
      const refusal = revisionRefusals(err);
      if (refusal !== null && refusal.length > 0) setRefused(refusal);
      // Free's pace, in the reader's words (0157 T4); any other in the server's.
      else if (scheduleAtPaceRefusal(err)) setFailed(t('settings.schedule.freePace'));
      else setFailed(serverMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="mt-8 p-4 bg-white border border-gray-200 rounded-lg">
      {/* A plain summary, as the app's other folds have, so it keeps the
          browser's disclosure triangle and reads as something that opens. */}
      <summary className="cursor-pointer select-none text-sm font-semibold text-gray-900">
        <Clock className="inline w-4 h-4 mr-1.5 align-text-bottom text-gray-500" />
        {t('settings.schedule')}
        {inForce && <span className="font-normal text-gray-600"> · {inForce}</span>}
      </summary>
      {verdict.allowed ? (
        <>
          {stored !== null && !isSchedulePreset(stored) && (
            <p className="mt-2 text-sm text-gray-700">{t('settings.schedule.own', { schedule: stored })}</p>
          )}
          {leastMinutesBetweenPasses >= ONE_DAY_MINUTES && (
            <p className="mt-2 text-sm text-gray-700">
              {t('settings.schedule.freePace')}{' '}
              <Link to="/billing" className="text-blue-700 hover:underline">
                {t('settings.schedule.freePace.link')}
              </Link>
            </p>
          )}
          <div className="mt-3">
            <ScheduleChooser
              value={chosen}
              onChange={setChosen}
              disabled={saving}
              leastMinutesBetweenPasses={leastMinutesBetweenPasses}
            />
          </div>
          <Hint className="mt-3" text={t('settings.schedule.hint')} why={t('settings.schedule.hint.why')} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !changed}
              className="px-3 py-1 text-sm font-medium rounded border border-blue-300 text-blue-800 hover:bg-blue-50 disabled:opacity-50"
            >
              {saving ? t('settings.schedule.saving') : t('settings.schedule.save')}
            </button>
            {saved && <span className="text-sm text-green-700">{t('settings.schedule.saved')}</span>}
          </div>
        </>
      ) : (
        // Unreachable while the table permits this field, and deliberately not
        // asserted away: the day the rule changes, this says so instead of
        // offering a press the route will refuse. The reason is the table's.
        <p className="mt-2 text-sm text-amber-800">{verdict.reason}</p>
      )}
      {refused.length > 0 && (
        <div className="mt-2">
          <p className="text-sm text-amber-800">{t('settings.schedule.refused')}</p>
          <ul className="mt-1 list-disc pl-5">
            {refused.map((r) => (
              <li key={r.field} className="text-sm text-amber-800">
                {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {failed !== null && (
        <p className="mt-2 text-sm text-red-700">
          {t('settings.schedule.failed')} {failed}
        </p>
      )}
    </details>
  );
};

export default SchedulePanel;
