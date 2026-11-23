// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE NEW ADDRESS, ON A MIGRATION'S PAGE (workplan 0168 §6.3, D5).
 *
 * Under *From {source} to {target}*, read off each data type's last pass
 * (`lastPass`, which both editions record from the pass's metrics):
 *
 *  - *Your new address is used in contacts and calendars*, only where this
 *    migration's copies carry a change (`addressChangesCarried`), with how
 *    many the last pass changed (`addressChanged`). Not on every migration of
 *    an organisation that confirmed a row for somebody else (the screens'
 *    review S12).
 *  - The copies that keep the old address for want of a version to guard the
 *    write (`addressChangesUnguarded`, the data-path review's S1), and those
 *    changed in the old account after the switch (`addressChangesLeft`; the
 *    owner, 2026-11-23, option (b); ADR-0055 decision 6). The press reaches
 *    neither, so neither is in what it offers to apply.
 *  - PAST THE SWITCH, A PRESS (D5): *Apply the new addresses here too*,
 *    wherever copies wait for it (`addressChangesWaiting`), in both editions,
 *    and never once the migration is done, when no pass runs to apply it. On
 *    the edition's own path (`applyAddressChangesHere`). Shown when the last
 *    row is gone too, so copies that still carry a removed change can go back
 *    to what the source says. The press names the table this page read, by
 *    its press digest: one that moved since is refused, in the reader's
 *    language, and read again (the data-path review's S5).
 *
 * The addresses themselves are on the person's page and the team screen; a
 * pass reports a count, never an address (0168 §3.3).
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFormatters, useT } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';
import { applyAddressChangesHere, fetchAddressChanges, pressDigestOf } from '../services/address-change-service.ts';

/** A data type's pass row, as much of it as this reads. */
interface PassRow {
  readonly domain: string;
  readonly lastPass?: object | undefined;
}

/** The data types an address change reaches (ADR-0055): contacts, calendars and tasks. */
const REACHED: ReadonlySet<string> = new Set(['contact', 'calendar', 'task']);

/** One of the last passes' address counts, summed over the data types it reaches; undefined where no pass said it. */
function lastPassSum(rows: ReadonlyArray<PassRow>, field: string): number | undefined {
  const counts = rows
    .filter((d) => REACHED.has(d.domain))
    .map((d) => (d.lastPass as Readonly<Record<string, unknown>> | undefined)?.[field])
    .filter((n): n is number => typeof n === 'number');
  return counts.length === 0 ? undefined : counts.reduce((a, b) => a + b, 0);
}

export const MigrationAddresses: React.FC<{
  mappingId: string;
  /** The migration's lifecycle: once it is done, no pass runs to apply a press. */
  lifecycle: string | undefined;
  /** The data types it moves. */
  domains: ReadonlyArray<string>;
  /** Each data type's pass row, for its last pass's counts. */
  domainStatus: ReadonlyArray<PassRow> | undefined;
}> = ({ mappingId, lifecycle, domains, domainStatus }) => {
  const t = useT();
  const { number } = useFormatters();
  const table = useQuery({ queryKey: ['address-changes'], queryFn: fetchAddressChanges, retry: false });
  const [applying, setApplying] = React.useState(false);
  const [applied, setApplied] = React.useState(false);
  const [refused, setRefused] = React.useState<string | null>(null);
  if (!domains.some((d) => REACHED.has(d))) return null;
  const rows = domainStatus ?? [];
  const changedLastPass = lastPassSum(rows, 'addressChanged');
  const carried = lastPassSum(rows, 'addressChangesCarried') ?? 0;
  const waiting = lastPassSum(rows, 'addressChangesWaiting') ?? 0;
  const unguarded = lastPassSum(rows, 'addressChangesUnguarded') ?? 0;
  const left = lastPassSum(rows, 'addressChangesLeft') ?? 0;
  const used = carried > 0 || (changedLastPass ?? 0) > 0;
  // The press needs the table this page read: its digest is what it sends.
  const pressable = waiting > 0 && lifecycle !== 'done' && table.data !== undefined;
  if (!used && !pressable && unguarded === 0 && left === 0) return null;
  const apply = async () => {
    if (!table.data) return;
    setApplying(true);
    setRefused(null);
    try {
      await applyAddressChangesHere(mappingId, await pressDigestOf(table.data.rows));
      setApplied(true);
    } catch (error) {
      setRefused(serverMessage(error));
      // The table may have moved since this page read it: read it again, so a
      // second press names the table as it is.
      void table.refetch();
    } finally {
      setApplying(false);
    }
  };
  return (
    <div className="mt-1 text-sm text-gray-600" data-migration-addresses>
      {used && (
        <p>
          {t('addresses.mapping.used')}
          {changedLastPass !== undefined && <> · {t('addresses.mapping.lastPass', { count: number(changedLastPass) })}</>}
        </p>
      )}
      {unguarded > 0 && <p className="mt-1">{t('addresses.mapping.unguarded', { count: number(unguarded) })}</p>}
      {left > 0 && (
        <p className="mt-1" data-address-left>
          {t('addresses.mapping.left', { count: number(left) })}
        </p>
      )}
      {pressable && (
        <div className="mt-2">
          <p>{t('addresses.mapping.apply.line', { count: number(waiting) })}</p>
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
