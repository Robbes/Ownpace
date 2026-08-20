// Copyright 2026 The Ownpace authors (Apache-2.0)
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
import { useLocale, useT } from '../../i18n/index.tsx';
import { ActionButton, DestructiveButton, Refused } from './primitives.tsx';
import {
  DecisionRefusedError,
  fetchApplyDeletionsFlag,
  setApplyDeletionsFlag,
} from '../../services/operating-service.ts';

export const ApplyDeletionsPanel: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  const queryClient = useQueryClient();
  const t = useT();
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

  const change = (flags: { allowApplyDeletions?: boolean; autoApplyRelocations?: boolean }) => {
    setChangeError(null);
    setPending(true);
    setApplyDeletionsFlag(mappingId, flags)
      .then(() => queryClient.invalidateQueries({ queryKey }))
      .catch((err: unknown) => {
        setChangeError(
          err instanceof DecisionRefusedError
            ? (err.refusal.reason ?? err.refusal.hint ?? err.refusal.error)
            : err instanceof Error
              ? err.message
              : t('common.requestFailed'),
        );
      })
      .finally(() => setPending(false));
  };

  if (error) {
    // The flag gates the screen's one destructive button; not knowing its
    // state is worth saying, not hiding (hard rule 9).
    return (
      <p className="mb-4 text-sm text-amber-800">
        {t('applyFlag.readFailed')}{' '}
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
          {data.allowApplyDeletions ? t('applyFlag.on') : t('applyFlag.off')}
        </span>
        {data.source === 'mapping' && data.allowApplyDeletions && (
          <ActionButton pending={pending} onClick={() => change({ allowApplyDeletions: false })}>
            {t('applyFlag.turnOff')}
          </ActionButton>
        )}
      </div>

      {!data.allowApplyDeletions && (
        <p className="mt-1 text-gray-600">{t('applyFlag.refusesUntilOn')}</p>
      )}

      {data.source === 'config' ? (
        <p className="mt-2 text-gray-600">
          {t('applyFlag.config.pre')}{' '}
          (<code className="font-mono text-xs">allowApplyDeletions</code>)
          {t('applyFlag.config.post')}
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
                label={t('applyFlag.turnOn')}
                armedLabel={t('applyFlag.turnOnArmed')}
                onClick={() => change({ allowApplyDeletions: true })}
              />
            </div>
          </div>
        )
      )}

      {/* ADR-0031 (accepted 2026-08-16): unattended relocation apply. Only
          meaningful once gate 1 is on — the engine refuses every item without
          it — so the section renders only then, beside the switch it extends.
          Same ceremony: two-step on, one-click off; read-only on the
          appliance, where both flags are config-file-owned. */}
      {data.allowApplyDeletions && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">
              {data.autoApplyRelocations ? t('autoApply.on') : t('autoApply.off')}
            </span>
            {data.source === 'mapping' && data.autoApplyRelocations && (
              <ActionButton
                pending={pending}
                onClick={() => change({ autoApplyRelocations: false })}
              >
                {t('applyFlag.turnOff')}
              </ActionButton>
            )}
          </div>
          <p className="mt-1 text-gray-600">{t('autoApply.hint')}</p>
          {data.source === 'config' ? (
            <p className="mt-1 text-gray-600">
              {t('applyFlag.config.pre')}{' '}
              (<code className="font-mono text-xs">autoApplyRelocations</code>)
              {t('applyFlag.config.post')}
            </p>
          ) : (
            !data.autoApplyRelocations && (
              <div className="mt-2">
                <DestructiveButton
                  pending={pending}
                  label={t('autoApply.turnOn')}
                  armedLabel={t('autoApply.turnOnArmed')}
                  onClick={() => change({ autoApplyRelocations: true })}
                />
              </div>
            )
          )}
        </div>
      )}

      {changeError && (
        <div className="mt-2">
          <Refused text={changeError} />
        </div>
      )}
    </div>
  );
};
