// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE ADDRESS CHANGES, AFTERWARDS (workplan 0168 §6.3, D6; ADR-0055).
 *
 * One component, two places:
 *
 * - **the person's page** (`Person.tsx`), *Addresses*: their rows, each
 *   *Confirmed* (and by whom, *for* them where somebody else confirmed it) or
 *   *Waiting for ‹person›*, with *Change*, *Delete*, and *Not right?*, which
 *   sends a confirmed row back to proposed. A proposed row can be confirmed
 *   here: on the member's own page that is them, and on somebody else's it is
 *   an owner or admin confirming for a person with no page of their own,
 *   which the server attributes;
 * - **the team screen** (`Tenants.tsx`), *Address changes*: every row of the
 *   organisation's one table, its person, its state and who set it, with
 *   *Add*, under the screen's owner-or-admin rule.
 *
 * Both read the one table (`['address-changes']`), so a change on either is
 * the other's too. On the appliance's Organisation door the rows are
 * `address-changes.json`'s, and the list is read-only and names the file
 * (ADR-0034). A failed read says so, never an empty table (hard rule 9).
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAddress } from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';
import {
  createAddressChange,
  deleteAddressChange,
  fetchAddressChanges,
  updateAddressChange,
  type AddressChange,
} from '../services/address-change-service.ts';

/** Who the rows are shown for: one person, or the whole organisation. */
export type AddressChangesScope =
  | { readonly kind: 'person'; readonly personId: string; readonly personName: string; readonly you: boolean }
  | { readonly kind: 'organisation' };

const BUTTON =
  'min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50';

/** A row's state in words: confirmed, and by whom; or whom it waits for. */
export function useStateWords(): (row: AddressChange) => string {
  const t = useT();
  return (row) => {
    const person = row.person?.displayName;
    if (row.state === 'proposed') {
      return person === undefined ? t('addresses.waiting') : t('addresses.waitingFor', { person });
    }
    const who = row.confirmedBy;
    if (who === null || row.confirmedByYou) return t('addresses.confirmed');
    return person === undefined
      ? t('addresses.confirmedBy', { who })
      : t('addresses.confirmedByFor', { who, person });
  };
}

/** The press on one row: what it does, and the server's words where it was refused. */
function useRowActions() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [refused, setRefused] = React.useState<Readonly<Record<string, string>>>({});
  const run = async (key: string, press: () => Promise<unknown>): Promise<boolean> => {
    setBusy(key);
    try {
      await press();
      setRefused((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return true;
    } catch (error) {
      setRefused((prev) => ({ ...prev, [key]: serverMessage(error) }));
      return false;
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: ['address-changes'] });
    }
  };
  return { busy, refused, run };
}

const Row: React.FC<{
  row: AddressChange;
  showPerson: boolean;
  canWrite: boolean;
  /** Whether a change typed here is the confirming person's own (their page). */
  confirmsOwn: boolean;
  actions: ReturnType<typeof useRowActions>;
}> = ({ row, showPerson, canWrite, confirmsOwn, actions }) => {
  const t = useT();
  const stateWords = useStateWords();
  const [editing, setEditing] = React.useState(false);
  const [typed, setTyped] = React.useState(row.newAddress);
  const inputId = React.useId();
  const key = row.oldKey;
  const busy = actions.busy === key;
  return (
    <li className="border-b border-gray-100 py-3" data-address-change={row.oldKey}>
      <p className="break-words text-gray-900">{t('addresses.change', { old: row.oldAddress, new: row.newAddress })}</p>
      <p className="mt-1 text-sm text-gray-600 break-words">
        {stateWords(row)}
        {showPerson && (
          <>
            {' · '}
            {t('addresses.table.person')}: {row.person?.displayName ?? t('addresses.table.nobody')}
          </>
        )}
        {showPerson && row.setBy !== null && (
          <>
            {' · '}
            {t('addresses.table.setBy')}: {row.setBy}
          </>
        )}
      </p>
      {canWrite && !editing && (
        <div className="mt-2 flex flex-wrap gap-2">
          {row.state === 'proposed' && (
            <button
              type="button"
              disabled={busy}
              className={BUTTON}
              onClick={() => void actions.run(key, () => updateAddressChange(key, { state: 'confirmed' }))}
            >
              {t('addresses.confirm')}
            </button>
          )}
          <button type="button" disabled={busy} className={BUTTON} onClick={() => setEditing(true)}>
            {t('addresses.edit')}
          </button>
          <button
            type="button"
            disabled={busy}
            className={BUTTON}
            onClick={() => void actions.run(key, () => deleteAddressChange(key))}
          >
            {t('addresses.delete')}
          </button>
          {row.state === 'confirmed' && (
            <button
              type="button"
              disabled={busy}
              className={BUTTON}
              onClick={() => void actions.run(key, () => updateAddressChange(key, { state: 'proposed' }))}
            >
              {t('addresses.notRight')}
            </button>
          )}
        </div>
      )}
      {canWrite && editing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void actions
              .run(key, () =>
                updateAddressChange(key, {
                  newAddress: typed.trim(),
                  ...(confirmsOwn ? { state: 'confirmed' as const } : {}),
                }),
              )
              .then((saved) => {
                if (saved) setEditing(false);
              });
          }}
        >
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
              {t('addresses.table.new')}
            </label>
            <input
              id={inputId}
              type="email"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
            />
          </div>
          <button type="submit" disabled={busy || !isAddress(typed)} className={BUTTON}>
            {t('addresses.save')}
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              setTyped(row.newAddress);
              setEditing(false);
            }}
          >
            {t('addresses.cancel')}
          </button>
        </form>
      )}
      {actions.refused[key] !== undefined && (
        <p role="alert" className="mt-2 text-sm text-red-800 break-words">
          <span className="font-medium">{t('addresses.notSaved')}</span> {actions.refused[key]}
        </p>
      )}
    </li>
  );
};

/** *Add*: an old address and its new one. */
const AddChange: React.FC<{ scope: AddressChangesScope; actions: ReturnType<typeof useRowActions> }> = ({
  scope,
  actions,
}) => {
  const t = useT();
  const [old, setOld] = React.useState('');
  const [next, setNext] = React.useState('');
  const oldId = React.useId();
  const newId = React.useId();
  const busy = actions.busy === 'add';
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void actions
          .run('add', () =>
            createAddressChange({
              oldAddress: old.trim(),
              newAddress: next.trim(),
              ...(scope.kind === 'person' ? { personId: scope.personId, ...(scope.you ? { confirm: true } : {}) } : {}),
            }),
          )
          .then((saved) => {
            if (saved) {
              setOld('');
              setNext('');
            }
          });
      }}
    >
      <div className="min-w-0 flex-1 basis-56">
        <label htmlFor={oldId} className="block text-sm font-medium text-gray-700">
          {t('addresses.table.old')}
        </label>
        <input
          id={oldId}
          type="email"
          value={old}
          onChange={(e) => setOld(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
        />
      </div>
      <div className="min-w-0 flex-1 basis-56">
        <label htmlFor={newId} className="block text-sm font-medium text-gray-700">
          {t('addresses.table.new')}
        </label>
        <input
          id={newId}
          type="email"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
        />
      </div>
      <button type="submit" disabled={busy || !isAddress(old) || !isAddress(next)} className={BUTTON}>
        {t('addresses.add')}
      </button>
      {actions.refused.add !== undefined && (
        <p role="alert" className="w-full text-sm text-red-800 break-words">
          <span className="font-medium">{t('addresses.notSaved')}</span> {actions.refused.add}
        </p>
      )}
    </form>
  );
};

export const AddressChanges: React.FC<{
  scope: AddressChangesScope;
  /** Whether the reader may write: the team screen's owner-or-admin rule; every member on a person's page. */
  canWrite: boolean;
  headingId: string;
}> = ({ scope, canWrite, headingId }) => {
  const t = useT();
  const table = useQuery({ queryKey: ['address-changes'], queryFn: fetchAddressChanges });
  const actions = useRowActions();
  const fromFile = table.data?.door === 'file';
  const rows = (table.data?.rows ?? []).filter(
    (r) => scope.kind === 'organisation' || r.person?.id === scope.personId,
  );
  const writable = canWrite && !fromFile && table.isSuccess;
  return (
    <section aria-labelledby={headingId} className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h2 id={headingId} className="text-lg font-semibold text-gray-900">
        {t(scope.kind === 'person' ? 'addresses.heading' : 'addresses.table.heading')}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t('addresses.where')}</p>
      {fromFile && table.data?.file != null && (
        <p className="mt-1 text-sm text-gray-600 break-words">{t('addresses.fromFile', { file: table.data.file })}</p>
      )}
      {table.isError ? (
        <p role="alert" className="mt-3 text-sm text-amber-700">
          {t('addresses.failed')} {serverMessage(table.error)}
        </p>
      ) : table.isPending ? (
        <p className="mt-3 text-sm text-gray-500">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{t('addresses.none')}</p>
      ) : (
        <ul className="mt-2">
          {rows.map((row) => (
            <Row
              key={row.oldKey}
              row={row}
              showPerson={scope.kind === 'organisation'}
              canWrite={writable}
              confirmsOwn={scope.kind === 'person' && scope.you}
              actions={actions}
            />
          ))}
        </ul>
      )}
      {writable && <AddChange scope={scope} actions={actions} />}
    </section>
  );
};
