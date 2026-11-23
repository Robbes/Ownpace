// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE ADDRESS CHANGES, AFTERWARDS (workplan 0168 §6.3, D6; ADR-0055).
 *
 * One component, three places:
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
 *   *Add*, under the screen's owner-or-admin rule. *Add* and each row's
 *   *Change* choose whose address it is, from the organisation's people, so a
 *   row reaches that person's page (the review's S6);
 * - **the appliance** (`Confirm.tsx`, and its one person's page): the whole
 *   table. There is no person to choose there, and a row made on its page is
 *   confirmed by its owner, so neither the Person column nor *Not right?*
 *   (which the appliance refuses) is offered (S7).
 *
 * All read the one table (`['address-changes']`), so a change on one is the
 * others' too. On the appliance's Organisation door the rows are
 * `address-changes.json`'s, and the list is read-only and names the file
 * (ADR-0034). A failed read says so, never an empty table (hard rule 9).
 *
 * Each row's buttons say which row they are for, a form opened takes the
 * focus and gives it back, a button that cannot be pressed says why, and a
 * refusal is tied to the box it is about (the review's N10).
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAddress } from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';
import { fetchPeople } from '../services/operating-service.ts';
import {
  createAddressChange,
  deleteAddressChange,
  fetchAddressChanges,
  updateAddressChange,
  type AddressChange,
} from '../services/address-change-service.ts';

/** Who the rows are shown for: one person, the whole organisation, or the appliance's one person, who holds them all. */
export type AddressChangesScope =
  | { readonly kind: 'person'; readonly personId: string; readonly personName: string; readonly you: boolean }
  | { readonly kind: 'organisation' }
  | { readonly kind: 'implicit' };

const BUTTON =
  'min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50';

/**
 * A row's state in words: confirmed, and by whom; or whom it waits for.
 * `viewerIsPerson` says whether the reader is the row's own person, where it
 * is known: a row the reader confirmed for somebody else says so (D6), and
 * one they confirmed for themselves is just *Confirmed*.
 */
export function useStateWords(): (row: AddressChange, viewerIsPerson?: boolean) => string {
  const t = useT();
  return (row, viewerIsPerson) => {
    const person = row.person?.displayName;
    if (row.state === 'proposed') {
      return person === undefined ? t('addresses.waiting') : t('addresses.waitingFor', { person });
    }
    const who = row.confirmedBy;
    if (who === null) return t('addresses.confirmed');
    if (row.confirmedByYou) {
      return person !== undefined && viewerIsPerson === false
        ? t('addresses.confirmedByYouFor', { person })
        : t('addresses.confirmed');
    }
    // The row's own person confirmed it, through their link: the server says
    // it as their name (`person:<id>`, 0168 §4.4), so it reads *Confirmed by
    // ‹person›*, never *by ‹person› for ‹person›*.
    return person === undefined || who === person
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

/** One of the organisation's people, as the picker offers them. */
interface Pickable {
  readonly id: string;
  readonly displayName: string;
}

/**
 * WHOSE ADDRESS IT IS (S6): *Nobody*, or one of the organisation's people.
 * Absent where there is nobody to choose (the appliance, a person's page).
 */
const PersonPicker: React.FC<{
  people: ReadonlyArray<Pickable>;
  value: string | null;
  onChange: (personId: string | null) => void;
}> = ({ people, value, onChange }) => {
  const t = useT();
  const id = React.useId();
  return (
    <div className="min-w-0 basis-48">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {t('addresses.table.person')}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base"
      >
        <option value="">{t('addresses.table.nobody')}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </select>
    </div>
  );
};

/** A button's word, and, for a screen reader, the row it is for (N10). */
const ForRow: React.FC<{ word: string; old: string }> = ({ word, old }) => (
  <>
    {word} <span className="sr-only">{old}</span>
  </>
);

const Row: React.FC<{
  row: AddressChange;
  showPerson: boolean;
  showSetBy: boolean;
  canWrite: boolean;
  /** Whether *Not right?* is offered: not on the appliance, which refuses it (S7). */
  canSendBack: boolean;
  /** Whether a change typed here is the confirming person's own (their page). */
  confirmsOwn: boolean;
  /** The people a row can be given to, where a person can be chosen (S6). */
  people: ReadonlyArray<Pickable> | undefined;
  /** Whether the reader is this row's person, where it is known. */
  viewerIsPerson: boolean | undefined;
  /** Where the focus goes once this row is deleted. */
  onDeleted: () => void;
  actions: ReturnType<typeof useRowActions>;
}> = ({ row, showPerson, showSetBy, canWrite, canSendBack, confirmsOwn, people, viewerIsPerson, onDeleted, actions }) => {
  const t = useT();
  const stateWords = useStateWords();
  const [editing, setEditing] = React.useState(false);
  const [typed, setTyped] = React.useState(row.newAddress);
  const [personId, setPersonId] = React.useState<string | null>(row.person?.id ?? null);
  const inputId = React.useId();
  const refusedId = React.useId();
  const whyId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const changeRef = React.useRef<HTMLButtonElement>(null);
  // Where the focus goes after a press: into the form it opened, or back to
  // *Change* once the form closes or the pressed button has gone (N10).
  const [focusTo, setFocusTo] = React.useState<'input' | 'change' | null>(null);
  React.useEffect(() => {
    if (focusTo === null) return;
    (focusTo === 'input' ? inputRef : changeRef).current?.focus();
    setFocusTo(null);
  }, [focusTo, editing]);
  const key = row.oldKey;
  const busy = actions.busy === key;
  const refused = actions.refused[key];
  const typedWrong = !isAddress(typed);
  const pressed = (press: () => Promise<unknown>) =>
    void actions.run(key, press).then((done) => {
      if (done) setFocusTo('change');
    });
  return (
    <li className="border-b border-gray-100 py-3" data-address-change={row.oldKey}>
      <p className="break-words text-gray-900">{t('addresses.change', { old: row.oldAddress, new: row.newAddress })}</p>
      <p className="mt-1 text-sm text-gray-600 break-words">
        {stateWords(row, viewerIsPerson)}
        {showPerson && (
          <>
            {' · '}
            {t('addresses.table.person')}: {row.person?.displayName ?? t('addresses.table.nobody')}
          </>
        )}
        {showSetBy && row.setBy !== null && (
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
              onClick={() => pressed(() => updateAddressChange(key, { state: 'confirmed' }))}
            >
              <ForRow word={t('addresses.confirm')} old={row.oldAddress} />
            </button>
          )}
          <button
            ref={changeRef}
            type="button"
            disabled={busy}
            className={BUTTON}
            onClick={() => {
              setTyped(row.newAddress);
              setPersonId(row.person?.id ?? null);
              setEditing(true);
              setFocusTo('input');
            }}
          >
            <ForRow word={t('addresses.edit')} old={row.oldAddress} />
          </button>
          <button
            type="button"
            disabled={busy}
            className={BUTTON}
            onClick={() =>
              void actions.run(key, () => deleteAddressChange(key)).then((done) => {
                if (done) onDeleted();
              })
            }
          >
            <ForRow word={t('addresses.delete')} old={row.oldAddress} />
          </button>
          {canSendBack && row.state === 'confirmed' && (
            <button
              type="button"
              disabled={busy}
              className={BUTTON}
              onClick={() => pressed(() => updateAddressChange(key, { state: 'proposed' }))}
            >
              <ForRow word={t('addresses.notRight')} old={row.oldAddress} />
            </button>
          )}
        </div>
      )}
      {canWrite && editing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const before = row.person?.id ?? null;
            void actions
              .run(key, () =>
                updateAddressChange(key, {
                  newAddress: typed.trim(),
                  ...(confirmsOwn ? { state: 'confirmed' as const } : {}),
                  // Whose it is, where the picker was there and was changed (S6).
                  ...(people !== undefined && personId !== before ? { personId } : {}),
                }),
              )
              .then((saved) => {
                if (!saved) return;
                setEditing(false);
                setFocusTo('change');
              });
          }}
        >
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
              {t('addresses.table.new')}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="email"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
              {...(refused === undefined ? {} : { 'aria-invalid': true as const, 'aria-describedby': refusedId })}
            />
          </div>
          {people !== undefined && <PersonPicker people={people} value={personId} onChange={setPersonId} />}
          <div>
            <button
              type="submit"
              disabled={busy || typedWrong}
              aria-describedby={typedWrong ? whyId : undefined}
              className={BUTTON}
            >
              <ForRow word={t('addresses.save')} old={row.oldAddress} />
            </button>
            {typedWrong && (
              <p id={whyId} className="mt-1 text-sm text-gray-600">
                {t('addresses.save.reason')}
              </p>
            )}
          </div>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              setTyped(row.newAddress);
              setEditing(false);
              setFocusTo('change');
            }}
          >
            <ForRow word={t('addresses.cancel')} old={row.oldAddress} />
          </button>
        </form>
      )}
      {refused !== undefined && (
        <p id={refusedId} role="alert" className="mt-2 text-sm text-red-800 break-words">
          <span className="font-medium">{t('addresses.notSaved')}</span> {refused}
        </p>
      )}
    </li>
  );
};

/** *Add*: an old address and its new one, and on the team screen whose it is. */
const AddChange: React.FC<{
  scope: AddressChangesScope;
  people: ReadonlyArray<Pickable> | undefined;
  actions: ReturnType<typeof useRowActions>;
}> = ({ scope, people, actions }) => {
  const t = useT();
  const [old, setOld] = React.useState('');
  const [next, setNext] = React.useState('');
  const [personId, setPersonId] = React.useState<string | null>(null);
  const oldId = React.useId();
  const newId = React.useId();
  const refusedId = React.useId();
  const whyId = React.useId();
  const busy = actions.busy === 'add';
  const refused = actions.refused.add;
  const typedWrong = !isAddress(old) || !isAddress(next);
  const invalid = refused === undefined ? {} : { 'aria-invalid': true as const, 'aria-describedby': refusedId };
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
              ...(scope.kind === 'organisation' && personId !== null ? { personId } : {}),
            }),
          )
          .then((saved) => {
            if (saved) {
              setOld('');
              setNext('');
              setPersonId(null);
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
          {...invalid}
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
          {...invalid}
        />
      </div>
      {people !== undefined && <PersonPicker people={people} value={personId} onChange={setPersonId} />}
      <div>
        <button
          type="submit"
          disabled={busy || typedWrong}
          aria-describedby={typedWrong ? whyId : undefined}
          className={BUTTON}
        >
          {t('addresses.add')}
        </button>
        {typedWrong && (
          <p id={whyId} className="mt-1 text-sm text-gray-600">
            {t('addresses.add.reason')}
          </p>
        )}
      </div>
      {refused !== undefined && (
        <p id={refusedId} role="alert" className="w-full text-sm text-red-800 break-words">
          <span className="font-medium">{t('addresses.notSaved')}</span> {refused}
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
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const fromFile = table.data?.door === 'file';
  // A person to choose, a Person column and *Not right?* exist on the
  // managed service only: the appliance has one implicit person, and
  // confirms every row its page makes (S7).
  const managed = table.data?.door === 'api';
  const rows = (table.data?.rows ?? []).filter((r) => scope.kind !== 'person' || r.person?.id === scope.personId);
  const writable = canWrite && !fromFile && table.isSuccess;
  const picks = scope.kind === 'organisation' && managed;
  // Read only where a person can be chosen: the appliance's pages never ask.
  const people = useQuery({ queryKey: ['people'], queryFn: () => fetchPeople(), enabled: picks });
  const pickable: ReadonlyArray<Pickable> | undefined =
    picks && writable && people.isSuccess
      ? people.data.people.flatMap((p) => (p.implicit || p.displayName === null ? [] : [{ id: p.id, displayName: p.displayName }]))
      : undefined;
  const yours = people.data?.people.find((p) => p.you)?.id;
  const viewerIsPerson = (row: AddressChange): boolean | undefined => {
    if (scope.kind === 'person') return scope.you;
    if (row.person === null || people.data === undefined) return undefined;
    return row.person.id === yours;
  };
  return (
    <section aria-labelledby={headingId} className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-gray-900 focus:outline-none">
        {t(scope.kind === 'organisation' ? 'addresses.table.heading' : 'addresses.heading')}
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
              showPerson={scope.kind === 'organisation' && managed}
              showSetBy={scope.kind === 'organisation'}
              canWrite={writable}
              canSendBack={managed}
              confirmsOwn={scope.kind === 'person' && scope.you}
              people={pickable}
              viewerIsPerson={viewerIsPerson(row)}
              onDeleted={() => headingRef.current?.focus()}
              actions={actions}
            />
          ))}
        </ul>
      )}
      {/* The people could not be read: a row can still be added, for nobody, and the screen says why it cannot be given to anyone. */}
      {picks && writable && people.isError && (
        <p className="mt-3 text-sm text-amber-700">
          {t('addresses.peopleFailed')} {serverMessage(people.error)}
        </p>
      )}
      {writable && <AddChange scope={scope} people={pickable} actions={actions} />}
    </section>
  );
};
