// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * EACH DATA TYPE ENDED, OR KEPT COPYING (workplan 0128 T3, T5 slice 7b; the
 * owner's D3 and D8: *"the ending is chosen per data type"*).
 *
 * Where a migration ends, each data type it carries has its own *End* and its
 * own *Keep copying*: mail ended on the day the old mailbox closes, while the
 * files keep copying. The migration is done once every data type has ended.
 *
 * ## The rows decide nothing
 *
 * `endings` comes from the ending door's own rule (`pathEndingChoices`), so
 * a button shown is a press the door accepts. End is offered without counting
 * the data type's open failures: the door refuses over them with its own
 * sentence, shown verbatim, and only that refusal offers the force.
 *
 * ## Mail waits for its delivery (D3, D8)
 *
 * Step 4 asks for mail only. Before its cutover, mail's End and Keep wait
 * for step 4's tick, because either press is its cutover: ending it before
 * delivery has moved loses what arrives afterwards. No other data type has a
 * delivery to move, so none waits.
 *
 * ## Keep copying is two presses
 *
 * The first opens the sentence and the second acts, as the lane's door always
 * has: a data type kept copying holds its slot, so the tier does not fall
 * the way ending makes it fall, and somebody has to meet that sentence before
 * they enter (ADR-0014's amendment). The appliance bills nothing, and says so.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Flag, Loader2, Repeat } from 'lucide-react';
import type { PathEndingChoice } from '@openmig/shared';
import { endOrKeepDataType, PathEndingRefusedError } from '../../services/operating-service.ts';
import { serverMessage } from '../../services/api.ts';
import { isSelfHost } from '../../services/edition.ts';
import { useT, type StringKey } from '../../i18n/index.tsx';
import { DOMAIN_STRING_KEY } from '../../i18n/domain-words.ts';
import { Hint } from '../Hint.tsx';

/** A data type's phase in words; one outside these says nothing. */
const PHASE_KEY: Readonly<Record<string, StringKey>> = {
  active: 'finish.ending.phase.active',
  cutover: 'finish.ending.phase.cutover',
  done: 'finish.ending.phase.done',
  continuous: 'finish.ending.phase.continuous',
};

type Said =
  | { readonly state: 'pending' }
  /** The door refused and said why; the force only where it said it is forceable. */
  | { readonly state: 'refused'; readonly message: string; readonly forceable: boolean }
  /** Anything else: the server's words, and never a force. */
  | { readonly state: 'failed'; readonly message: string };

const EachDataTypeEnds: React.FC<{
  mappingId: string;
  /** Each data type's ending, off the payload this edition serves; undefined when it sent none. */
  endings: ReadonlyArray<PathEndingChoice> | undefined;
  /** Step 4's tick: mail before its cutover waits on it. */
  deliveryMoved: boolean;
}> = ({ mappingId, endings, deliveryMoved }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const [said, setSaid] = React.useState<Readonly<Record<string, Said>>>({});
  const [keepAsked, setKeepAsked] = React.useState<string | null>(null);

  if (!endings || endings.length === 0) return null;

  const busy = Object.values(said).some((s) => s.state === 'pending');

  const press = async (domain: string, ending: 'end' | 'keep', force = false) => {
    setSaid((s) => ({ ...s, [domain]: { state: 'pending' } }));
    try {
      await endOrKeepDataType(mappingId, domain, ending, force);
      setKeepAsked(null);
      setSaid((s) => {
        const { [domain]: _gone, ...rest } = s;
        return rest;
      });
      // Every read the page makes: the data type's phase, the migration's
      // lifecycle once it rolls up, and the queues its steps count.
      await queryClient.invalidateQueries();
    } catch (err) {
      setSaid((s) => ({
        ...s,
        [domain]:
          err instanceof PathEndingRefusedError
            ? { state: 'refused', message: err.refusal.message, forceable: err.refusal.forceable === true }
            : { state: 'failed', message: serverMessage(err) },
      }));
    }
  };

  return (
    <ul className="divide-y divide-gray-100">
      {endings.map((e) => {
        const kind = t(DOMAIN_STRING_KEY[e.domain]);
        const phaseKey = PHASE_KEY[e.phase];
        const waitsForDelivery = e.domain === 'email' && e.phase === 'active' && !deliveryMoved;
        const s = said[e.domain];
        const pending = s?.state === 'pending';
        return (
          <li key={e.domain} className="py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{kind}</span>
              {phaseKey && <span className="text-xs text-gray-500">{t(phaseKey)}</span>}
              <span className="ml-auto flex flex-wrap gap-2">
                {e.offers.includes('end') && (
                  <button
                    type="button"
                    onClick={() => void press(e.domain, 'end')}
                    disabled={busy || waitsForDelivery}
                    title={waitsForDelivery ? t('finish.button.disabledTitle') : undefined}
                    className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Flag className="w-3 h-3" />}
                    {t('finish.ending.end', { kind })}
                  </button>
                )}
                {e.offers.includes('keep') && keepAsked !== e.domain && (
                  <button
                    type="button"
                    onClick={() => setKeepAsked(e.domain)}
                    disabled={busy || waitsForDelivery}
                    title={waitsForDelivery ? t('finish.button.disabledTitle') : undefined}
                    className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Repeat className="w-3 h-3" />
                    {t('finish.ending.keep', { kind })}
                  </button>
                )}
              </span>
            </div>

            {/* Stopped by its owner: ended, or kept once it is resumed. */}
            {e.stopped && !e.offers.includes('keep') && (
              <p className="mt-1 text-sm text-gray-600">{t('finish.ending.stopped', { kind })}</p>
            )}

            {keepAsked === e.domain && e.offers.includes('keep') && (
              <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded">
                <Hint
                  text={t('lane.intro')}
                  why={t(isSelfHost() ? 'lane.selfhost.why' : 'lane.why')}
                  tone="body"
                  open
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void press(e.domain, 'keep')}
                    className="px-3 py-1.5 text-sm rounded bg-blue-700 text-white disabled:opacity-50"
                  >
                    {t(isSelfHost() ? 'lane.selfhost.confirm' : 'lane.confirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setKeepAsked(null)}
                    className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700"
                  >
                    {t('lane.cancel')}
                  </button>
                </div>
              </div>
            )}

            {s?.state === 'refused' && (
              <div className="mt-2 text-sm">
                <p className="flex items-start gap-2 text-amber-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {s.message}
                </p>
                {/* Only after the refusal has said what it costs, and only
                    for the refusal a forced End can satisfy (0038 T1). */}
                {s.forceable && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void press(e.domain, 'end', true)}
                    className="mt-2 inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded border border-amber-600 text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                  >
                    <Flag className="w-3 h-3" />
                    {t('finish.ending.forceButton', { kind })}
                  </button>
                )}
              </div>
            )}
            {s?.state === 'failed' && (
              <p className="mt-2 text-sm text-red-800">
                {t('finish.ending.failed')} {s.message}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default EachDataTypeEnds;
