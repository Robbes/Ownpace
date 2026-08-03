// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Gate 1 of the destructive path, visible and — on managed, for an owner —
 * switchable (workplan 0019 T3).
 *
 * The flag used to be flipped by SQL, which meant the Deletions screen's
 * delete button was refused with no way to see why or change it. This panel
 * makes the current value a visible fact on the mapping, puts the shared
 * runbook warning IN FRONT of the enabling switch, and makes enabling a
 * two-step action (the same arm-then-confirm as the delete button itself).
 * Turning it OFF is one click — reducing capability never needs a ceremony.
 *
 * On the appliance the value is config-file-owned (`source: 'config'`) and the
 * panel is read-only, naming the file instead of offering a switch that would
 * 405.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck, ShieldOff } from 'lucide-react';
import { APPLY_FLAG_WARNING, APPLY_FLAG_WARNING_NL } from '@openmig/shared';
import { useLocale } from '../../i18n';
import { ActionButton, DestructiveButton, Refused } from './primitives';
import {
  DecisionRefusedError,
  fetchApplyDeletionsFlag,
  setApplyDeletionsFlag,
} from '../../services/operating-service';

export const ApplyDeletionsPanel: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  const queryClient = useQueryClient();
  // The Dutch warning lives beside its English source in @openmig/shared
  // (ADR-0026: one source of truth for destructive-path prose) — the panel
  // only PICKS, it never rephrases (workplan 0024 T1).
  const { locale } = useLocale();
  const applyFlagWarning = locale === 'nl' ? APPLY_FLAG_WARNING_NL : APPLY_FLAG_WARNING;
  const [changeError, setChangeError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const queryKey = ['apply-deletions-flag', mappingId];
  const { data, error } = useQuery({
    queryKey,
    queryFn: () => fetchApplyDeletionsFlag(mappingId),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const change = (allow: boolean) => {
    setChangeError(null);
    setPending(true);
    setApplyDeletionsFlag(mappingId, allow)
      .then(() => queryClient.invalidateQueries({ queryKey }))
      .catch((err: unknown) => {
        setChangeError(
          err instanceof DecisionRefusedError
            ? (err.refusal.reason ?? err.refusal.hint ?? err.refusal.error)
            : err instanceof Error
              ? err.message
              : 'The request did not complete.',
        );
      })
      .finally(() => setPending(false));
  };

  if (error) {
    // The flag gates the screen's one destructive button; not knowing its
    // state is worth saying, not hiding (hard rule 9).
    return (
      <p className="mb-4 text-sm text-amber-800">
        Could not read whether applying deletions is enabled:{' '}
        {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (!data) return null;

  return (
    <div className="mb-4 p-3 rounded-lg border border-gray-200 bg-gray-50 text-sm">
      <div className="flex items-center gap-2">
        {data.allowApplyDeletions ? (
          <ShieldOff className="w-4 h-4 text-red-600 flex-shrink-0" />
        ) : (
          <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
        )}
        <span className="font-medium text-gray-900">
          {data.allowApplyDeletions
            ? 'Applying deletions is ON for this mapping.'
            : 'Applying deletions is OFF for this mapping (the default).'}
        </span>
        {data.source === 'mapping' && data.allowApplyDeletions && (
          <ActionButton pending={pending} onClick={() => change(false)}>
            Turn off
          </ActionButton>
        )}
      </div>

      {!data.allowApplyDeletions && (
        <p className="mt-1 text-gray-600">
          The server refuses every delete button on this screen until it is turned on.
        </p>
      )}

      {data.source === 'config' ? (
        <p className="mt-2 text-gray-600">
          On this appliance the value lives in the mapping&apos;s config file
          (<code className="font-mono text-xs">allowApplyDeletions</code>); edit the file and
          restart to change it. No API changes it.
        </p>
      ) : (
        !data.allowApplyDeletions && (
          <div className="mt-2">
            {/* The warning comes BEFORE the switch, and the switch itself is
                two-step — same ceremony as the delete button it enables. */}
            <p className="flex items-start gap-2 text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {applyFlagWarning}
            </p>
            <div className="mt-2">
              <DestructiveButton
                pending={pending}
                label="Turn on applying deletions"
                armedLabel="Confirm: enable deletions"
                onClick={() => change(true)}
              />
            </div>
          </div>
        )
      )}

      {changeError && (
        <div className="mt-2">
          <Refused text={changeError} />
        </div>
      )}
    </div>
  );
};
