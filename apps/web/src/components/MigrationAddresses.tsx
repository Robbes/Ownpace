// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE NEW ADDRESS, ON A MIGRATION'S PAGE (workplan 0168 §6.3, D5).
 *
 * Under *From {source} to {target}*: where the organisation's table holds a
 * confirmed row and this migration moves contacts or calendars, the line
 * *Your new address is used in contacts and calendars*, and how many items the
 * last pass changed, where the pass said (`lastPass.addressChanged`). The
 * addresses themselves are on the person's page and the team screen; a pass
 * reports a count, never an address (0168 §3.3).
 *
 * PAST THE CUTOVER, A PRESS (D5): once the migration is past its switch, the
 * target is the person's live system, and a change to the table reaches it
 * only through *Apply the new addresses here too*
 * (`POST /api/migrations/{id}/address-changes/apply`). Managed only: the
 * appliance's doors are its page and its file (ADR-0034).
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAfterCutover } from '@openmig/shared';
import { useFormatters, useT } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';
import { isSelfHost } from '../services/edition.ts';
import { applyAddressChangesHere, fetchAddressChanges } from '../services/address-change-service.ts';

/** A data type's pass row, as much of it as this reads. */
interface PassRow {
  readonly domain: string;
  readonly lastPass?: object | undefined;
}

/** How many items a data type's last pass changed by the table, where the pass said. */
function changedLastPass(domain: PassRow): number | undefined {
  const n = (domain.lastPass as { readonly addressChanged?: unknown } | undefined)?.addressChanged;
  return typeof n === 'number' ? n : undefined;
}

export const MigrationAddresses: React.FC<{
  mappingId: string;
  /** The migration's lifecycle, for whether it is past its switch. */
  lifecycle: string | undefined;
  /** The data types it moves. */
  domains: ReadonlyArray<string>;
  /** Each data type's pass row, for the last pass's count. */
  domainStatus: ReadonlyArray<PassRow> | undefined;
}> = ({ mappingId, lifecycle, domains, domainStatus }) => {
  const t = useT();
  const { number } = useFormatters();
  const table = useQuery({ queryKey: ['address-changes'], queryFn: fetchAddressChanges, retry: false });
  const [applying, setApplying] = React.useState(false);
  const [applied, setApplied] = React.useState(false);
  const [refused, setRefused] = React.useState<string | null>(null);
  const reaches = domains.includes('contact') || domains.includes('calendar');
  const confirmed = (table.data?.rows ?? []).some((r) => r.state === 'confirmed');
  if (!reaches || !confirmed) return null;
  const counts = (domainStatus ?? [])
    .filter((d) => d.domain === 'contact' || d.domain === 'calendar')
    .map(changedLastPass)
    .filter((n): n is number => n !== undefined);
  const changed = counts.length === 0 ? undefined : counts.reduce((a, b) => a + b, 0);
  const pastSwitch = lifecycle !== undefined && isAfterCutover(lifecycle) && !isSelfHost();
  const apply = async () => {
    setApplying(true);
    setRefused(null);
    try {
      await applyAddressChangesHere(mappingId);
      setApplied(true);
    } catch (error) {
      setRefused(serverMessage(error));
    } finally {
      setApplying(false);
    }
  };
  return (
    <div className="mt-1 text-sm text-gray-600" data-migration-addresses>
      <p>
        {t('addresses.mapping.used')}
        {changed !== undefined && <> · {t('addresses.mapping.lastPass', { count: number(changed) })}</>}
      </p>
      {pastSwitch && (
        <div className="mt-2">
          <p>{t('addresses.mapping.apply.line')}</p>
          {applied ? (
            <p role="status" className="mt-1 text-green-800">
              {t('addresses.mapping.applied')}
            </p>
          ) : (
            <button
              type="button"
              disabled={applying}
              onClick={() => void apply()}
              className="mt-2 min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              {applying ? t('addresses.mapping.applying') : t('addresses.mapping.apply')}
            </button>
          )}
          {refused !== null && (
            <p role="alert" className="mt-1 text-red-800 break-words">
              <span className="font-medium">{t('addresses.notSaved')}</span> {refused}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
