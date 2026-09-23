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
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ListPlus } from 'lucide-react';
import { mappingApi, type KindChoiceView } from '../services/mapping-service.ts';
import { serverMessage } from '../services/api.ts';
import { useT, type StringKey } from '../i18n/index.tsx';
import { Hint } from './Hint.tsx';

const MigrationKindsPanel: React.FC<{
  mappingId: string;
  /** `kindChoices` off the detail payload; undefined when the API sent none. */
  choices: ReadonlyArray<KindChoiceView> | undefined;
}> = ({ mappingId, choices }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const [adding, setAdding] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);

  // Nothing to add and nothing refused is nothing to say, UNLESS this panel
  // just added the last one: the re-read then lists everything as copied, and
  // hiding the panel would take the confirmation of the press with it.
  if (!choices) return null;
  if (choices.every((c) => c.state === 'on') && added === null) return null;

  const label = (domain: string) => t(`domain.${domain}` as StringKey);

  const add = async (domain: string) => {
    // What the last press said is cleared before this one speaks, so "added"
    // and a refusal are never on screen together.
    setAdding(domain);
    setAdded(null);
    setFailed(null);
    try {
      await mappingApi.addDomain(mappingId, domain);
      setAdded(domain);
      // The list is the detail payload's, so the press is not finished until
      // that has been read again and shows the data type as copied.
      await queryClient.invalidateQueries({ queryKey: ['mapping', mappingId] });
    } catch (err) {
      setFailed(serverMessage(err));
    } finally {
      setAdding(null);
    }
  };

  const offersAny = choices.some((c) => c.state === 'addable');

  return (
    <section className="mt-8 p-4 bg-white border border-gray-200 rounded-lg">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <ListPlus className="w-4 h-4 text-gray-500" />
        {t('settings.kinds')}
      </h3>
      <ul className="mt-3 space-y-2">
        {choices.map((c) => (
          <li key={c.domain} className="text-sm">
            {c.state === 'on' && (
              <span className="inline-flex items-center gap-1 text-gray-800">
                <Check className="w-4 h-4 text-green-600" aria-hidden="true" />
                {label(c.domain)}
              </span>
            )}
            {c.state === 'addable' && (
              <button
                type="button"
                onClick={() => void add(c.domain)}
                disabled={adding !== null}
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
        ))}
      </ul>
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
      {failed !== null && (
        <p className="mt-2 text-sm text-red-700">
          {t('settings.kinds.failed')} {failed}
        </p>
      )}
    </section>
  );
};

export default MigrationKindsPanel;
