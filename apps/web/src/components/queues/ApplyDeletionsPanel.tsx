// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The one switch left on the destructive path, visible and — on managed, for
 * an owner — switchable (workplan 0019 T3; ADR-0031): removing moved files'
 * old copies unattended. Off by default; two presses to turn on, one to turn
 * off — reducing capability never needs a ceremony.
 *
 * DELETING BY HAND HAS NO SWITCH (alpha.21; ADR-0024's amendment of
 * 2026-11-25, workplan 0173). Until then this panel opened with *Turn on
 * deleting by hand*, ADR-0024's gate 1, and the automatic removal showed only
 * once that was on. The owner removed it: every delete is two presses on the
 * page already. What the warning in front of that switch said is now
 * `WhatADeleteDoes`, shown above the rows that offer a delete.
 *
 * On the appliance the value is config-file-owned (`source: 'config'`) and the
 * panel is read-only, naming the file instead of offering a switch that would
 * 405.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot } from 'lucide-react';
import { DELETE_BY_HAND_WARNING, DELETE_BY_HAND_WARNING_NL } from '@openmig/shared';
import { useLocale, useT } from '../../i18n/index.tsx';
import { Hint } from '../Hint.tsx';
import { ActionButton, ConfirmButton, Refused } from './primitives.tsx';
import {
  DecisionRefusedError,
  fetchApplyDeletionsFlag,
  setApplyDeletionsFlag,
} from '../../services/operating-service.ts';
import { serverMessage } from '../../services/api.ts';

/**
 * What a delete by hand does, above the rows that offer one (workplan 0173
 * T3). The Dutch lives beside its English source in @openmig/shared (ADR-0026:
 * one source of truth for destructive-path prose) — this only PICKS, it never
 * rephrases (workplan 0024 T1).
 */
export const WhatADeleteDoes: React.FC = () => {
  const { locale } = useLocale();
  return (
    <p className="mb-4 flex items-start gap-2 text-sm text-amber-800">
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      {locale === 'nl' ? DELETE_BY_HAND_WARNING_NL : DELETE_BY_HAND_WARNING}
    </p>
  );
};

export const ApplyDeletionsPanel: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  const queryClient = useQueryClient();
  const t = useT();
  const [changeError, setChangeError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const queryKey = ['apply-deletions-flag', mappingId];
  const { data, error } = useQuery({
    queryKey,
    queryFn: () => fetchApplyDeletionsFlag(mappingId),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const change = (autoApplyRelocations: boolean) => {
    setChangeError(null);
    setPending(true);
    setApplyDeletionsFlag(mappingId, { autoApplyRelocations })
      .then(() => queryClient.invalidateQueries({ queryKey }))
      .catch((err: unknown) => {
        setChangeError(
          err instanceof DecisionRefusedError
            ? (err.refusal.reason ?? err.refusal.hint ?? err.refusal.error)
            : err instanceof Error
              ? serverMessage(err)
              : t('common.requestFailed'),
        );
      })
      .finally(() => setPending(false));
  };

  if (error) {
    // Not knowing whether something removes copies unattended is worth
    // saying, not hiding (hard rule 9).
    return (
      <p className="mb-4 text-sm text-amber-800">
        {t('applyFlag.readFailed')}{' '}
        {serverMessage(error)}
      </p>
    );
  }
  if (!data) return null;

  return (
    <div className="mb-4 p-3 rounded-lg border border-gray-200 bg-gray-50 text-sm">
      {/* ADR-0031 (accepted 2026-08-16): unattended relocation apply. Its own
          switch since 2026-11-25. Two-step on, one-click off; read-only on the
          appliance, where the flag is config-file-owned. */}
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-900">
          {data.autoApplyRelocations ? t('autoApply.on') : t('autoApply.off')}
        </span>
        {data.source === 'mapping' && data.autoApplyRelocations && (
          <ActionButton pending={pending} onClick={() => change(false)}>
            {t('autoApply.turnOff')}
          </ActionButton>
        )}
      </div>
      <Hint text={t('autoApply.hint')} why={t('autoApply.why')} />
      {data.source === 'config' ? (
        <p className="mt-1 text-gray-600">
          {t('applyFlag.config.pre')}{' '}
          (<code className="font-mono text-xs">autoApplyRelocations</code>)
          {t('applyFlag.config.post')}
        </p>
      ) : (
        !data.autoApplyRelocations && (
          <div className="mt-2">
            {/* Two presses and red, because it acts unattended; no bin,
                because pressing it removes nothing (0156 T6). */}
            <ConfirmButton
              pending={pending}
              tone="destructive"
              icon={<Bot className="w-3 h-3" />}
              label={t('autoApply.turnOn')}
              armedLabel={t('autoApply.turnOnArmed')}
              onClick={() => change(true)}
            />
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
