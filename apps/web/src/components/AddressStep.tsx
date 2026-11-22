// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * YOUR NEW ADDRESS: the step of *Start a migration* between *Where does it
 * go?* and *Check, then start* (workplan 0168 §6.2, D9; ADR-0055).
 *
 * Shown only where an address changes or the person says it does, and drawn
 * from what `addressProposals` read off the accounts chosen: each old address
 * asked about, the new account's address where its login is one, and the
 * rows the organisation's table already holds for this person. Where the new
 * account's login is not an address, nothing is proposed: the step asks.
 *
 * It says where the new address goes and where it does not, in 0168 §6.2's
 * words, because the change is declared, never silent. The machine proposes;
 * the answer is the person's, and *Start a migration* writes it on Next.
 */
import React from 'react';
import { addressKey, cannotTakeAlong, isAddress } from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import type { AddressChange } from '../services/address-change-service.ts';

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

/**
 * WHAT THE STEP ASKS (0168 §6.1): every address being left that is on the
 * list, or every one when the person said their address changes too, unless
 * it is the new address in another spelling or the table already holds it.
 */
export function addressProposals(input: {
  readonly sources: ReadonlyArray<string>;
  readonly newLogin: string;
  readonly declared: boolean;
  readonly table: ReadonlyArray<AddressChange>;
  readonly personId: string | null;
}): AddressProposals {
  const newAddress = isAddress(input.newLogin) ? input.newLogin.trim() : undefined;
  const newKey = newAddress === undefined ? undefined : addressKey(newAddress);
  const inTable = new Set(input.table.map((r) => r.oldKey));
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
    (r) => (input.personId !== null && r.person?.id === input.personId) || sourceKeys.has(r.oldKey),
  );
  return { asked, newAddress, existing };
}

const Item: React.FC<{ label: string; text: string }> = ({ label, text }) => (
  <li>
    <span className="font-medium">{label}</span> {text}
  </li>
);

/** The question for one old address: Yes, No, or another address. */
const Question: React.FC<{
  asked: AskedAddress;
  newAddress: string | undefined;
  newLogin: string;
  answer: AddressAnswer | undefined;
  onAnswer: (answer: AddressAnswer) => void;
}> = ({ asked, newAddress, newLogin, answer, onAnswer }) => {
  const t = useT();
  const name = React.useId();
  const typedId = React.useId();
  const typed = answer?.typed ?? '';
  const choose = (choice: AddressAnswer['choice']) => onAnswer({ choice, typed });
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">
        {asked.provider === null
          ? t('start.address.leavingDeclared', { old: asked.old })
          : t('start.address.leaving', { old: asked.old, provider: asked.provider })}{' '}
        {newAddress === undefined
          ? t('start.address.newNotAnAddress', { login: newLogin })
          : t('start.address.newIs', { new: newAddress })}
      </p>
      <fieldset>
        <legend className="text-base font-semibold text-gray-900">
          {t('start.address.use', { new: newAddress ?? '…', old: asked.old })}
        </legend>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {(['yes', 'no', 'another'] as const)
            .filter((c) => c !== 'yes' || newAddress !== undefined)
            .map((c) => (
              <label key={c} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800">
                <input type="radio" name={name} checked={answer?.choice === c} onChange={() => choose(c)} />
                {t(c === 'yes' ? 'start.address.yes' : c === 'no' ? 'start.address.no' : 'start.address.another')}
              </label>
            ))}
        </div>
      </fieldset>
      {answer?.choice === 'another' && (
        <div>
          <label htmlFor={typedId} className="block text-sm font-medium text-gray-700">
            {t('start.address.newLabel')}
          </label>
          <input
            id={typedId}
            type="email"
            autoComplete="off"
            value={typed}
            onChange={(e) => onAnswer({ choice: 'another', typed: e.target.value })}
            className="mt-1 w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-base"
          />
        </div>
      )}
    </div>
  );
};

export const AddressStep: React.FC<{
  proposals: AddressProposals;
  newLogin: string;
  answers: Readonly<Record<string, AddressAnswer>>;
  onAnswer: (key: string, answer: AddressAnswer) => void;
  others: ReadonlyArray<OtherChange>;
  onOthers: (others: ReadonlyArray<OtherChange>) => void;
  failures: ReadonlyArray<{ readonly old: string; readonly why: string }>;
}> = ({ proposals, newLogin, answers, onAnswer, others, onOthers, failures }) => {
  const t = useT();
  const nextId = React.useRef(others.reduce((max, o) => Math.max(max, o.id), 0) + 1);
  const { asked, existing } = proposals;
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
        />
      ))}
      {existing.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-gray-900">{t('start.address.already')}</h3>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {existing.map((r) => (
              <li key={r.oldKey} className="break-words">
                {t('addresses.change', { old: r.oldAddress, new: r.newAddress })} ·{' '}
                {r.state === 'confirmed' ? t('addresses.confirmed') : t('addresses.waiting')}
              </li>
            ))}
          </ul>
        </div>
      )}
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
          <Item label={t('start.address.goes.shares.label')} text={t('start.address.goes.shares', { new: shownNew })} />
        </ul>
      </div>
      <div>
        <h3 className="text-base font-semibold text-gray-900">{t('start.address.not')}</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-gray-700 break-words">
          <Item label={t('start.address.not.mail.label')} text={t('start.address.not.mail', { new: shownNew })} />
          <Item label={t('start.address.not.invitations.label')} text={t('start.address.not.invitations')} />
          <Item label={t('start.address.not.text.label')} text={t('start.address.not.text')} />
        </ul>
      </div>
      <div>
        <h3 className="text-base font-semibold text-gray-900">{t('start.address.others')}</h3>
        <p className="mt-1 text-sm text-gray-700">{t('start.address.others.line')}</p>
        <ul className="mt-3 space-y-4">
          {others.map((o) => (
            <OtherRow key={o.id} other={o} onChange={(patch) => setOther(o.id, patch)} onRemove={() => onOthers(others.filter((x) => x.id !== o.id))} />
          ))}
        </ul>
        <button
          type="button"
          onClick={() => onOthers([...others, { id: nextId.current++, old: '', new: '' }])}
          className="mt-3 min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800 hover:bg-gray-50"
        >
          {t('start.address.others.add')}
        </button>
      </div>
      {failures.map((f) => (
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
  onChange: (patch: Partial<OtherChange>) => void;
  onRemove: () => void;
}> = ({ other, onChange, onRemove }) => {
  const t = useT();
  const oldId = React.useId();
  const newId = React.useId();
  return (
    <li className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-56">
        <label htmlFor={oldId} className="block text-sm font-medium text-gray-700">
          {t('start.address.oldLabel')}
        </label>
        <input
          id={oldId}
          type="email"
          autoComplete="off"
          value={other.old}
          onChange={(e) => onChange({ old: e.target.value })}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
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
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800 hover:bg-gray-50"
      >
        {t('start.address.others.remove')}
      </button>
    </li>
  );
};
