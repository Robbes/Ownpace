// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE SCREEN BEHIND "SET AN EXPORT POLICY ON THE MAPPING" (workplan 0125 T3).
 *
 * ## The defect this closes
 *
 * The owner's live Google migration refused thirty files. Twenty-one of them
 * carried this remedy, per item, by name:
 *
 * > *"…is not copied here because this migration is configured with
 * > `nativeFilePolicy="refuse"`. **Set an export policy on the mapping** —
 * > "export-odf", "export-office" or "export-pdf" — to migrate these, or move
 * > them out of scope."*
 *
 * Neither instruction could be carried out. `nativeFilePolicy` appeared in the
 * entire web app in ONE file — the creation wizard — and `PUT
 * /api/migrations/:mappingId` parsed a `sourceConfig` and dropped it. So the
 * product's own remedy named a setting with no screen behind it, which is the
 * shape of defect that makes a person conclude the tool is broken rather than
 * that they have missed something.
 *
 * #1004 made the route apply it and refuse what may not change; #1005 made the
 * detail route answer the MAPPING's own policy rather than its connection's.
 * This is the third piece: somewhere to press.
 *
 * ## What may change is not decided here
 *
 * `mayRevise` lives in `shared` and is called by both editions — hard rule 5,
 * the rule 0125 exists to extend. This panel ASKS it rather than knowing the
 * answer: if the field is ever refused, the panel stops offering the press and
 * says the reason, with no second copy of the table to keep in step. The same
 * call supplies whether there is a consequence worth stating before the press.
 *
 * ## The consequence is shown BEFORE the press, not after
 *
 * Items already copied keep the format they were copied in — this product does
 * not overwrite what is on a target (hard rule 2), so the new policy applies to
 * what is copied from here on. That is a fact somebody should have before they
 * press, not a thing they discover about their own migration afterwards.
 *
 * ## And a refusal is shown as a refusal
 *
 * The route answers 409 with every refused field and its reason. This panel
 * only ever proposes the export policy, which the table permits — so a 409 here
 * means the rule changed under it, and hard rule 9 says that must not look like
 * a save that worked. The server's own sentences are rendered rather than a
 * client-side guess at what it must have meant.
 */
import React from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import {
  carriesGoogleNativeFiles,
  mayRevise,
  type GoogleNativeFilePolicy,
} from '@openmig/shared';
import { mappingApi } from '../services/mapping-service.ts';
import { revisionRefusals, serverMessage } from '../services/api.ts';
import { useT } from '../i18n/index.tsx';
import { Hint } from './Hint.tsx';
import { NativeFilePolicyChooser } from './NativeFilePolicyChooser.tsx';

/**
 * The policy this migration is running under, as a value the chooser can show.
 *
 * `undefined` is `refuse` and says so, because that is what the engine does
 * with an absent value — `parseNativeFilePolicy`'s default, and the reason
 * thirty of the owner's files were refused by a setting he had never been
 * offered. A chooser showing nothing selected would read as "no answer yet"
 * about a migration that has already acted on one.
 */
export function policyInForce(value: unknown): GoogleNativeFilePolicy {
  return value === 'export-odf' || value === 'export-office' || value === 'export-pdf'
    ? value
    : 'refuse';
}

const ExportPolicyPanel: React.FC<{
  mappingId: string;
  /** The connection kind this migration reads from. */
  sourceType: string;
  /** What it carries — a migration with no files has no Docs to decide about. */
  domains: ReadonlyArray<string>;
  /** `sourceConfig.nativeFilePolicy` off the detail payload. */
  current: unknown;
}> = ({ mappingId, sourceType, domains, current }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const inForce = policyInForce(current);
  const [chosen, setChosen] = React.useState<GoogleNativeFilePolicy>(inForce);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState<GoogleNativeFilePolicy | null>(null);
  const [refused, setRefused] = React.useState<
    ReadonlyArray<{ field: string; reason: string }>
  >([]);
  const [failed, setFailed] = React.useState<string | null>(null);

  // What the mapping holds is the source of truth, and it changes under this
  // panel every time a save lands and the query refetches. Without this, a
  // second save would be offered against the value that was on screen when the
  // page loaded.
  React.useEffect(() => {
    setChosen(inForce);
  }, [inForce]);

  const verdict = mayRevise('source.nativeFilePolicy');

  // The two questions the wizard asks before offering this control, asked
  // again here so the settings panel and the wizard cannot disagree about
  // whose migration the question belongs to.
  if (!carriesGoogleNativeFiles(sourceType) || !domains.includes('file')) return null;

  const save = async () => {
    setSaving(true);
    // WHAT THE LAST PRESS SAID IS CLEARED BEFORE THIS ONE SPEAKS, and it is the
    // only thing keeping "Saved" and a refusal off the screen together: the
    // three renders below ask `saved !== null` and nothing more. A second,
    // compound condition on each of them was written first and removed — with
    // this reset in place no test could reach it, and a branch nothing can
    // execute is a branch nothing can prove. The sequence it guards (a refusal,
    // then a successful save) is a test instead.
    setRefused([]);
    setFailed(null);
    setSaved(null);
    try {
      await mappingApi.setNativeFilePolicy(mappingId, chosen);
      setSaved(chosen);
      // The panel reads its current value off the detail query, so the save is
      // not finished until that has been re-read.
      await queryClient.invalidateQueries({ queryKey: ['mapping', mappingId] });
    } catch (err) {
      const refusal = revisionRefusals(err);
      // A refusal that named nothing readable still is not a save that worked:
      // it falls through to the server's own sentence rather than to silence.
      if (refusal !== null && refusal.length > 0) setRefused(refusal);
      else setFailed(serverMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-8 p-4 bg-white border border-gray-200 rounded-lg">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Settings2 className="w-4 h-4 text-gray-500" />
        {t('settings.exportPolicy')}
      </h3>
      {verdict.allowed ? (
        <>
          <div className="mt-3">
            <NativeFilePolicyChooser
              id="settings-native-file-policy"
              value={chosen}
              onChange={setChosen}
              disabled={saving}
            />
          </div>
          {/* BEFORE the press, and only when something would actually change:
              restating it under a chooser nobody has touched is noise, and the
              rule this repo keeps is one line per thing to read. */}
          {chosen !== inForce && verdict.consequence !== undefined && (
            <Hint
              tone="caution"
              className="mt-3"
              text={t('settings.exportPolicy.consequence')}
              why={t('settings.exportPolicy.consequence.why')}
            />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || chosen === inForce}
              className="px-3 py-1 text-sm font-medium rounded border border-blue-300 text-blue-800 hover:bg-blue-50 disabled:opacity-50"
            >
              {saving ? t('settings.exportPolicy.saving') : t('settings.exportPolicy.save')}
            </button>
            {saved !== null && (
              <span className="text-sm text-green-700">{t('settings.exportPolicy.saved')}</span>
            )}
          </div>
          {/* WHAT A CHANGED POLICY DOES NOT DO BY ITSELF (0125 T5, offered
              rather than automatic). The items refused under the old policy
              stay refused until somebody says to try them again: a settings
              save that silently reset a queue of decisions would be the bulk
              mutation of the ledger this codebase consistently refuses to
              make. The Failures page already groups them and presses them as
              a group, so this is a link to it, not a second button. */}
          {saved !== null && (
            <Hint
              className="mt-2"
              text={t('settings.exportPolicy.refusedBefore')}
              why={t('settings.exportPolicy.refusedBefore.why')}
            />
          )}
          {saved !== null && (
            <Link
              to={`/mappings/${encodeURIComponent(mappingId)}/failures`}
              className="mt-1 inline-block text-sm font-medium text-blue-700 hover:underline"
            >
              {t('settings.exportPolicy.toFailures')}
            </Link>
          )}
        </>
      ) : (
        // Unreachable while the table permits this field, and deliberately not
        // asserted away: the panel asks rather than assumes, so the day the
        // rule changes it says so instead of offering a press the route will
        // refuse. The reason is the table's own words.
        <p className="mt-2 text-sm text-amber-800">{verdict.reason}</p>
      )}
      {refused.length > 0 && (
        <div className="mt-2">
          <p className="text-sm text-amber-800">{t('settings.exportPolicy.refused')}</p>
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
          {t('settings.exportPolicy.failed')} {failed}
        </p>
      )}
    </section>
  );
};

export default ExportPolicyPanel;
