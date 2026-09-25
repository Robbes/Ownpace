// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT THIS MIGRATION COPIES, AND WHAT IT MAY STILL GAIN (workplan 0125 T6).
 *
 * The day Google Tasks became a face of a Google account, the owner
 * reconnected his account with Tasks ticked, and his running migration had
 * nowhere to take them: a migration's data types were fixed when it was
 * created, and a second migration between the same two accounts is refused.
 *
 * ## The panel decides nothing
 *
 * The detail payload carries `kindChoices`, made by the one rule in shared
 * that the add route runs too. A press offered here is a press the route
 * accepts, and a data type the rule refuses is shown with the rule's own
 * sentence. The panel renders nothing when there is nothing to add and
 * nothing refused (unless it just added the last one, whose confirmation must
 * stay), and nothing for a payload that carries no choices at all: an API
 * that predates them is not a migration with nothing to offer.
 *
 * ## One way, said before the press
 *
 * Adding cannot be undone from here, and what an added data type does is
 * stated before anybody presses, as the export format's consequence is: it is
 * copied from the next pass, and nothing already copied changes.
 *
 * ## A refusal is shown as a refusal
 *
 * The route answers 409 with its own reason when the rule changed under the
 * page, say because another tab added the same data type. That sentence is
 * shown verbatim, never a client-side guess at what it meant (hard rule 9).
 *
 * ## Stop and resume, on both editions (workplan 0128 T4, slice 3c)
 *
 * Each data type the migration copies can be stopped and resumed, and this
 * list is where: mail stopped on the day the old mailbox closes, while the
 * contacts keep copying. `stops` comes from the stop door's own rule
 * (`pathStopChoices`), so the button shown is the press the door accepts,
 * and a line with none says why only where the owner would look for one: the
 * last data type still copying (D5), and a stopped one on a migration that
 * does not run. What a stop does is said before the press, as adding is.
 *
 * The appliance renders this too, with its stops off `/status`: it has no
 * data type to add, so its lines are the stops alone.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CirclePause, ListPlus } from 'lucide-react';
import { mappingApi, type KindChoiceView, type StopChoiceView } from '../services/mapping-service.ts';
import { stopOrResumeDataType } from '../services/operating-service.ts';
import { serverMessage } from '../services/api.ts';
import { useT, type StringKey } from '../i18n/index.tsx';
import { Hint } from './Hint.tsx';

const MigrationKindsPanel: React.FC<{
  mappingId: string;
  /** `kindChoices` off the detail payload; undefined when the API sent none. */
  choices: ReadonlyArray<KindChoiceView> | undefined;
  /**
   * Each data type's stop, off the payload this edition serves (managed's
   * `stopChoices`, the appliance's `stops`); undefined when it sent none.
   */
  stops?: ReadonlyArray<StopChoiceView> | undefined;
}> = ({ mappingId, choices, stops }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const [adding, setAdding] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [pressing, setPressing] = React.useState<string | null>(null);
  const [pressed, setPressed] = React.useState<{ domain: string; action: 'stop' | 'resume' } | null>(
    null,
  );

  // The appliance adds nothing here, so without choices its lines are the
  // data types its stops name, every one of them copied.
  const lines: ReadonlyArray<KindChoiceView> =
    choices ?? stops?.map((s) => ({ domain: s.domain, state: 'on' as const })) ?? [];
  const stopOf = (domain: string) => stops?.find((s) => s.domain === domain);
  const stopsSay = stops?.some((s) => s.offer !== null || s.stopped || s.held !== undefined) ?? false;

  // Nothing to add, nothing refused and no stop to offer or show is nothing
  // to say, UNLESS this panel just added or pressed something: the re-read
  // must not take the confirmation of the press with it.
  if (!choices && !stops) return null;
  if (lines.every((c) => c.state === 'on') && added === null && pressed === null && !stopsSay) {
    return null;
  }

  const label = (domain: string) => t(`domain.${domain}` as StringKey);
  const busy = adding !== null || pressing !== null;

  // What the last press said is cleared before the next one speaks, so a
  // confirmation and a refusal are never on screen together.
  const clearSaid = () => {
    setAdded(null);
    setPressed(null);
    setFailed(null);
  };

  // The lists are the payloads', so a press is not finished until they have
  // been read again: the detail on managed, `/status` on the appliance.
  const reread = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['mapping', mappingId] }),
      queryClient.invalidateQueries({ queryKey: ['status'] }),
    ]);
  };

  const add = async (domain: string) => {
    setAdding(domain);
    clearSaid();
    try {
      await mappingApi.addDomain(mappingId, domain);
      setAdded(domain);
      await reread();
    } catch (err) {
      setFailed(t('settings.kinds.failed') + ' ' + serverMessage(err));
    } finally {
      setAdding(null);
    }
  };

  const press = async (domain: string, action: 'stop' | 'resume') => {
    setPressing(domain);
    clearSaid();
    try {
      await stopOrResumeDataType(mappingId, domain, action);
      setPressed({ domain, action });
      await reread();
    } catch (err) {
      // The door's own sentence, as it is: another tab may have stopped the
      // last other data type first, and only the door knows.
      setFailed(t('settings.kinds.stop.failed') + ' ' + serverMessage(err));
    } finally {
      setPressing(null);
    }
  };

  const offersAny = lines.some((c) => c.state === 'addable');
  const offersStop = stops?.some((s) => s.offer === 'stop') ?? false;

  return (
    <section className="mt-8 p-4 bg-white border border-gray-200 rounded-lg">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <ListPlus className="w-4 h-4 text-gray-500" />
        {t('settings.kinds')}
      </h3>
      <ul className="mt-3 space-y-2">
        {lines.map((c) => {
          const stop = stopOf(c.domain);
          return (
            <li key={c.domain} className="text-sm">
              {c.state === 'on' && (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-800">
                  <span className="inline-flex items-center gap-1">
                    {stop?.stopped ? (
                      <CirclePause className="w-4 h-4 text-amber-600" aria-hidden="true" />
                    ) : (
                      <Check className="w-4 h-4 text-green-600" aria-hidden="true" />
                    )}
                    {label(c.domain)}
                  </span>
                  {stop?.stopped && (
                    <span className="text-amber-800">{t('settings.kinds.stoppedByYou')}</span>
                  )}
                  {stop?.offer && (
                    <button
                      type="button"
                      onClick={() => void press(c.domain, stop.offer!)}
                      disabled={busy}
                      className="px-2 py-0.5 text-xs font-medium rounded border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {pressing === c.domain
                        ? t(stop.offer === 'stop' ? 'settings.kinds.stopping' : 'settings.kinds.resuming')
                        : t(stop.offer === 'stop' ? 'settings.kinds.stop' : 'settings.kinds.resume', {
                            kind: label(c.domain),
                          })}
                    </button>
                  )}
                  {stop?.held && (
                    <span className="basis-full text-xs text-gray-600">
                      {t(
                        stop.held === 'last_one_copying'
                          ? 'settings.kinds.held.lastOne'
                          : 'settings.kinds.held.notRunning',
                      )}
                    </span>
                  )}
                </span>
              )}
              {c.state === 'addable' && (
                <button
                  type="button"
                  onClick={() => void add(c.domain)}
                  disabled={busy}
                  className="px-3 py-1 text-sm font-medium rounded border border-blue-300 text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                >
                  {adding === c.domain
                    ? t('settings.kinds.adding')
                    : t('settings.kinds.add', { kind: label(c.domain) })}
                </button>
              )}
              {c.state === 'refused' && (
                <span className="text-gray-700">
                  <span className="font-medium">{label(c.domain)}</span>
                  <span className="block text-amber-800">{c.reason}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {offersStop && (
        <Hint
          tone="note"
          className="mt-3"
          text={t('settings.kinds.stop.consequence')}
          why={t('settings.kinds.stop.consequence.why')}
        />
      )}
      {offersAny && (
        <Hint
          tone="caution"
          className="mt-3"
          text={t('settings.kinds.consequence')}
          why={t('settings.kinds.consequence.why')}
        />
      )}
      {added !== null && (
        <p className="mt-2 text-sm text-green-700">
          {t('settings.kinds.added', { kind: label(added) })}
        </p>
      )}
      {pressed !== null && (
        <p className="mt-2 text-sm text-green-700">
          {t(pressed.action === 'stop' ? 'settings.kinds.stopped' : 'settings.kinds.resumed', {
            kind: label(pressed.domain),
          })}
        </p>
      )}
      {failed !== null && <p className="mt-2 text-sm text-red-700">{failed}</p>}
    </section>
  );
};

export default MigrationKindsPanel;
