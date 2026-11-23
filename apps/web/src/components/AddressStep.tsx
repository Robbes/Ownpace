// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * YOUR NEW ADDRESS: the step of *Start a migration* between *Where does it
 * go?* and *Check, then start* (workplan 0168 §6.2, D9; ADR-0055).
 *
 * Shown only where an address changes or the person says it does, and drawn
 * from what `addressProposals` read off the accounts chosen: each old address
 * asked about, the new account's address where its login is one, and the
 * rows the organisation's table already holds for this person. Where the new
 * account's login is not an address, nothing is proposed: the step asks, and
 * its box to type the address in is there from the start.
 *
 * It says where the new address goes and where it does not, in 0168 §6.2's
 * words, because the change is declared, never silent. The machine proposes;
 * the answer is the person's, and *Start a migration* writes it when the
 * person presses Start, never before: Back and Next change nothing on the
 * server, so *"You can change this until you press Start"* stays true.
 */
import React from 'react';
import { addressKey, cannotTakeAlong, isAddress } from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import type { AddressChange } from '../services/address-change-service.ts';
import { useStateWords } from './AddressChanges.tsx';

/** One old address the step asks about, and whose domain it is (null where the person declared it). */
export interface AskedAddress {
  readonly old: string;
  readonly provider: string | null;
}

export interface AddressProposals {
  readonly asked: ReadonlyArray<AskedAddress>;
  /** The new account's address, or undefined where its login is not an address. */
  readonly newAddress: string | undefined;
  /** This person's rows already in the table, and rows for an address being left. */
  readonly existing: ReadonlyArray<AddressChange>;
}

/** The person's answer to *Use ‹new› in place of ‹old›?*. */
export interface AddressAnswer {
  readonly choice: 'yes' | 'no' | 'another';
  /** What was typed under *Another address…*. */
  readonly typed: string;
}

/** A change for somebody moving with them, as typed. */
export interface OtherChange {
  readonly id: number;
  readonly old: string;
  readonly new: string;
}

/** A row Start could not write, and the server's words for why. */
export interface AddressFailure {
  readonly old: string;
  readonly why: string;
}

/**
 * WHAT THE STEP ASKS (0168 §6.1): every address being left that is on the
 * list, or every one when the person said their address changes too, unless
 * it is the new address in another spelling or the table already holds it.
 *
 * A row this flow added itself, at a Start that went no further, is not one
 * the table "already holds" (`addedHere`, B1): its question stays, with the
 * person's answer, and it is not listed again as already in the table. So a
 * Back and another Start change that row rather than add a second one, and
 * only a No to it deletes it.
 */
export function addressProposals(input: {
  readonly sources: ReadonlyArray<string>;
  readonly newLogin: string;
  readonly declared: boolean;
  readonly table: ReadonlyArray<AddressChange>;
  readonly personId: string | null;
  /** The old keys of the rows this flow added (`StartMigration`'s `writtenHere`). */
  readonly addedHere?: ReadonlySet<string>;
}): AddressProposals {
  const addedHere = input.addedHere ?? new Set<string>();
  const newAddress = isAddress(input.newLogin) ? input.newLogin.trim() : undefined;
  const newKey = newAddress === undefined ? undefined : addressKey(newAddress);
  const inTable = new Set(input.table.map((r) => r.oldKey).filter((key) => !addedHere.has(key)));
  const seen = new Set<string>();
  const asked: AskedAddress[] = [];
  for (const source of input.sources) {
    const old = source.trim();
    if (!isAddress(old)) continue;
    const key = addressKey(old);
    if (seen.has(key) || key === newKey || inTable.has(key)) continue;
    seen.add(key);
    const leaving = cannotTakeAlong(old);
    if (leaving !== null || input.declared) asked.push({ old, provider: leaving?.provider ?? null });
  }
  const sourceKeys = new Set(input.sources.filter(isAddress).map(addressKey));
  const existing = input.table.filter(
    (r) =>
      !addedHere.has(r.oldKey) &&
      ((input.personId !== null && r.person?.id === input.personId) || sourceKeys.has(r.oldKey)),
  );
  return { asked, newAddress, existing };
}

const Item: React.FC<{ label: string; text: string }> = ({ label, text }) => (
  <li>
    <span className="font-medium">{label}</span> {text}
  </li>
);

/** A row Start could not write, said under it and tied to its boxes (N10). */
const FailureLine: React.FC<{ id: string; failure: AddressFailure }> = ({ id, failure }) => {
  const t = useT();
  return (
    <p id={id} role="alert" className="mt-2 text-sm text-red-800 break-words">
      <span className="font-medium">{t('start.address.saveFailed', { old: failure.old })}</span> {failure.why}
    </p>
  );
};

/** What a box says to a screen reader about the line that refused it. */
const invalidWith = (errorId: string | undefined) =>
  errorId === undefined ? {} : { 'aria-invalid': true as const, 'aria-describedby': errorId };

/**
 * The question for one old address: Yes, No, or another address. Where the
 * new account's login is not an address there is nothing to say Yes to, so
 * the question asks which address takes the old one's place, and the box to
 * type it in is there from the start (N11).
 */
const Question: React.FC<{
  asked: AskedAddress;
  newAddress: string | undefined;
  newLogin: string;
  answer: AddressAnswer | undefined;
  onAnswer: (answer: AddressAnswer) => void;
  failure: AddressFailure | undefined;
}> = ({ asked, newAddress, newLogin, answer, onAnswer, failure }) => {
  const t = useT();
  const name = React.useId();
  const typedId = React.useId();
  const failureId = React.useId();
  const typed = answer?.typed ?? '';
  const choose = (choice: AddressAnswer['choice']) => onAnswer({ choice, typed });
  const proposed = newAddress !== undefined;
  const choices = proposed ? (['yes', 'no', 'another'] as const) : (['another', 'no'] as const);
  const label = (c: AddressAnswer['choice']) =>
    c === 'yes'
      ? t('start.address.yes')
      : c === 'no'
        ? t('start.address.no')
        : proposed
          ? t('start.address.another')
          : t('start.address.this');
  const typedShown = !proposed || answer?.choice === 'another';
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">
        {asked.provider === null
          ? t('start.address.leavingDeclared', { old: asked.old })
          : t('start.address.leaving', { old: asked.old, provider: asked.provider })}{' '}
        {proposed ? t('start.address.newIs', { new: newAddress }) : t('start.address.newNotAnAddress', { login: newLogin })}
      </p>
      <fieldset>
        <legend className="text-base font-semibold text-gray-900">
          {proposed
            ? t('start.address.use', { new: newAddress, old: asked.old })
            : t('start.address.which', { old: asked.old })}
        </legend>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {choices.map((c) => (
            <label key={c} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800">
              <input type="radio" name={name} checked={answer?.choice === c} onChange={() => choose(c)} />
              {label(c)}
            </label>
          ))}
        </div>
      </fieldset>
      {typedShown && (
        <div>
          <label htmlFor={typedId} className="block text-sm font-medium text-gray-700">
            {t('start.address.newLabel')}
          </label>
          <input
            id={typedId}
            type="email"
            autoComplete="off"
            value={typed}
            // Typing is the answer *another address*: where nothing is
            // proposed, the box is the question's answer.
            onChange={(e) => onAnswer({ choice: 'another', typed: e.target.value })}
            className="mt-1 w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-base"
            {...invalidWith(failure === undefined || answer?.choice !== 'another' ? undefined : failureId)}
          />
        </div>
      )}
      {failure !== undefined && <FailureLine id={failureId} failure={failure} />}
    </div>
  );
};

/**
 * WHERE A NEW ADDRESS GOES, AND WHERE IT DOES NOT (0168 §6.2), in the words
 * of the step: on *Start a migration*, and on the appliance's confirm page.
 * A pass changes tasks as it changes events (0168 T4), so they are named. An
 * event that is already over, and a task that is done, keep the old address
 * (the owner, 2026-11-23; ADR-0055), and the step says so.
 */
export const WhereItGoes: React.FC<{ oldAddress: string; newAddress: string }> = ({ oldAddress, newAddress }) => {
  const t = useT();
  const shownOld = oldAddress;
  const shownNew = newAddress;
  return (
    <>
      <div>
        <h3 className="text-base font-semibold text-gray-900">{t('start.address.goes')}</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-gray-700 break-words">
          <Item
            label={t('start.address.goes.contacts.label')}
            text={t('start.address.goes.contacts', { old: shownOld, new: shownNew })}
          />
          <Item
            label={t('start.address.goes.calendars.label')}
            text={t('start.address.goes.calendars', { new: shownNew })}
          />
          <Item label={t('start.address.goes.tasks.label')} text={t('start.address.goes.tasks', { new: shownNew })} />
          <Item label={t('start.address.goes.shares.label')} text={t('start.address.goes.shares', { new: shownNew })} />
        </ul>
      </div>
      <div>
        <h3 className="text-base font-semibold text-gray-900">{t('start.address.not')}</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-gray-700 break-words">
          <Item label={t('start.address.not.mail.label')} text={t('start.address.not.mail', { new: shownNew })} />
          <Item label={t('start.address.not.invitations.label')} text={t('start.address.not.invitations')} />
          <Item label={t('start.address.not.past.label')} text={t('start.address.not.past')} />
          <Item label={t('start.address.not.text.label')} text={t('start.address.not.text')} />
        </ul>
      </div>
    </>
  );
};

/**
 * A ROW THE TABLE ALREADY HOLDS (N12). One that waits for a confirmation can
 * be confirmed here by whoever signs in to the accounts, for themselves or
 * for the person (D6, attributed): ticked, Start confirms it. Unticked, it
 * stays as it is; the step never deletes a row it did not add.
 */
const ExistingRow: React.FC<{
  row: AddressChange;
  confirmable: boolean;
  confirmed: boolean;
  onConfirmed: (on: boolean) => void;
  failure: AddressFailure | undefined;
}> = ({ row, confirmable, confirmed, onConfirmed, failure }) => {
  const t = useT();
  const stateWords = useStateWords();
  const boxId = React.useId();
  const failureId = React.useId();
  return (
    <li className="break-words">
      {confirmable ? (
        <>
          <label htmlFor={boxId} className="flex min-h-[44px] items-center gap-2 text-gray-800">
            <input
              id={boxId}
              type="checkbox"
              checked={confirmed}
              onChange={(e) => onConfirmed(e.target.checked)}
              {...invalidWith(failure === undefined ? undefined : failureId)}
            />
            {t('start.address.confirmAtStart', { old: row.oldAddress, new: row.newAddress })}
          </label>
          <span className="block pl-6 text-gray-600">{stateWords(row)}</span>
        </>
      ) : (
        <>
          {t('addresses.change', { old: row.oldAddress, new: row.newAddress })} · {stateWords(row)}
        </>
      )}
      {failure !== undefined && <FailureLine id={failureId} failure={failure} />}
    </li>
  );
};

export const AddressStep: React.FC<{
  proposals: AddressProposals;
  newLogin: string;
  answers: Readonly<Record<string, AddressAnswer>>;
  onAnswer: (key: string, answer: AddressAnswer) => void;
  others: ReadonlyArray<OtherChange>;
  onOthers: (others: ReadonlyArray<OtherChange>) => void;
  /** Whether a row of the table that waits can be confirmed here (N12). */
  confirmable?: (row: AddressChange) => boolean;
  /** The rows of the table ticked to be confirmed at Start, by old key. */
  confirmExisting?: Readonly<Record<string, boolean>>;
  onConfirmExisting?: (key: string, on: boolean) => void;
  /** What the last Start could not write, each under its own row. */
  failures: ReadonlyArray<AddressFailure>;
}> = ({
  proposals,
  newLogin,
  answers,
  onAnswer,
  others,
  onOthers,
  confirmable = () => false,
  confirmExisting = {},
  onConfirmExisting = () => undefined,
  failures,
}) => {
  const t = useT();
  const nextId = React.useRef(others.reduce((max, o) => Math.max(max, o.id), 0) + 1);
  const addRef = React.useRef<HTMLButtonElement>(null);
  // A new *Others* row takes the focus, in its first box (N10).
  const [focusRow, setFocusRow] = React.useState<number | null>(null);
  const { asked, existing } = proposals;
  const failureFor = (old: string) => {
    const key = isAddress(old) ? addressKey(old) : old.trim();
    return failures.find((f) => (isAddress(f.old) ? addressKey(f.old) : f.old.trim()) === key);
  };
  // A failure no row on this step names (a row since removed) is still said.
  const named = new Set([
    ...asked.map((a) => a.old),
    ...existing.map((r) => r.oldAddress),
    ...others.map((o) => o.old),
  ]);
  const unplaced = failures.filter((f) => ![...named].some((old) => failureFor(old) === f));
  // The words of *Where it goes* name the addresses of the first change.
  const first = asked[0];
  const firstAnswer = first === undefined ? undefined : answers[addressKey(first.old)];
  const shownNew =
    firstAnswer?.choice === 'another' && firstAnswer.typed.trim() !== ''
      ? firstAnswer.typed.trim()
      : (proposals.newAddress ?? existing[0]?.newAddress ?? '…');
  const shownOld = first?.old ?? existing[0]?.oldAddress ?? '…';
  const setOther = (id: number, patch: Partial<OtherChange>) =>
    onOthers(others.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-6">
      {asked.map((a) => (
        <Question
          key={a.old}
          asked={a}
          newAddress={proposals.newAddress}
          newLogin={newLogin}
          answer={answers[addressKey(a.old)]}
          onAnswer={(answer) => onAnswer(addressKey(a.old), answer)}
          failure={failureFor(a.old)}
        />
      ))}
      {existing.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-gray-900">{t('start.address.already')}</h3>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {existing.map((r) => (
              <ExistingRow
                key={r.oldKey}
                row={r}
                confirmable={confirmable(r)}
                confirmed={confirmExisting[r.oldKey] === true}
                onConfirmed={(on) => onConfirmExisting(r.oldKey, on)}
                failure={failureFor(r.oldAddress)}
              />
            ))}
          </ul>
        </div>
      )}
      <WhereItGoes oldAddress={shownOld} newAddress={shownNew} />
      <div>
        <h3 className="text-base font-semibold text-gray-900">{t('start.address.others')}</h3>
        <p className="mt-1 text-sm text-gray-700">{t('start.address.others.line')}</p>
        <ul className="mt-3 space-y-4">
          {others.map((o) => (
            <OtherRow
              key={o.id}
              other={o}
              focus={focusRow === o.id}
              onFocused={() => setFocusRow(null)}
              onChange={(patch) => setOther(o.id, patch)}
              onRemove={() => {
                onOthers(others.filter((x) => x.id !== o.id));
                // The pressed button goes with its row: the focus goes to *Add*.
                addRef.current?.focus();
              }}
              failure={o.old.trim() === '' ? undefined : failureFor(o.old)}
            />
          ))}
        </ul>
        <button
          ref={addRef}
          type="button"
          onClick={() => {
            const id = nextId.current++;
            onOthers([...others, { id, old: '', new: '' }]);
            setFocusRow(id);
          }}
          className="mt-3 min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800 hover:bg-gray-50"
        >
          {t('start.address.others.add')}
        </button>
      </div>
      {unplaced.map((f) => (
        <p key={f.old} role="alert" className="text-sm text-red-800 break-words">
          <span className="font-medium">{t('start.address.saveFailed', { old: f.old })}</span> {f.why}
        </p>
      ))}
      <p className="text-sm text-gray-600">{t('start.address.nothingYet')}</p>
    </div>
  );
};

const OtherRow: React.FC<{
  other: OtherChange;
  /** Take the focus, once: the row was just added. */
  focus: boolean;
  onFocused: () => void;
  onChange: (patch: Partial<OtherChange>) => void;
  onRemove: () => void;
  failure: AddressFailure | undefined;
}> = ({ other, focus, onFocused, onChange, onRemove, failure }) => {
  const t = useT();
  const oldId = React.useId();
  const newId = React.useId();
  const failureId = React.useId();
  const oldRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!focus) return;
    oldRef.current?.focus();
    onFocused();
  }, [focus, onFocused]);
  const invalid = invalidWith(failure === undefined ? undefined : failureId);
  return (
    <li>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor={oldId} className="block text-sm font-medium text-gray-700">
            {t('start.address.oldLabel')}
          </label>
          <input
            ref={oldRef}
            id={oldId}
            type="email"
            autoComplete="off"
            value={other.old}
            onChange={(e) => onChange({ old: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
            {...invalid}
          />
        </div>
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor={newId} className="block text-sm font-medium text-gray-700">
            {t('start.address.newLabel')}
          </label>
          <input
            id={newId}
            type="email"
            autoComplete="off"
            value={other.new}
            onChange={(e) => onChange({ new: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
            {...invalid}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800 hover:bg-gray-50"
        >
          {t('start.address.others.remove')}
          {/* Which row it removes, for a screen reader (N10). */}
          {other.old.trim() !== '' && (
            <>
              {' '}
              <span className="sr-only">{other.old.trim()}</span>
            </>
          )}
        </button>
      </div>
      {failure !== undefined && <FailureLine id={failureId} failure={failure} />}
    </li>
  );
};
