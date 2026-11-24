// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The operator's gifts (workplan 0172 §3.5), in English only (ADR-0013 as
 * amended 2026-10-11: `operator-strings.ts`, inside `EnglishOnly`).
 *
 * Three things the owner asked to see and do without a deploy:
 *
 *  - **How many people the Alpha has let in**, beside the requests waiting and
 *    the gifts not yet used, because the owner keeps the Alpha to their own
 *    number by hand: *"We start with Max 50 allowed users by myself."* Nothing
 *    refuses a grant past a number, and the screen says so rather than
 *    implying a cap.
 *  - **The limit**: gifts per person for everyone, and a number for one
 *    person by the address they sign in with.
 *  - **Every gift**, whose it is, what became of it, and *Revoke* on an
 *    unused one.
 *
 * Like the access queue, nothing here authorises anything: managed migration
 * 0064's policies are the rule, so a typed URL by somebody else shows nothing
 * and changes nothing.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift as GiftIcon } from 'lucide-react';
import { useOperatorT, useFormatters } from '../i18n/index.tsx';
import type { OperatorKey } from '../i18n/operator-strings.ts';
import { serverMessage } from '../services/api.ts';
import {
  listAllGifts,
  revokeAnyGift,
  setGiftAllowance,
  setGiftsPerPerson,
  type GiftState,
} from '../services/gifts.ts';

const STATE_KEY = {
  unused: 'gifts.state.unused',
  redeemed: 'gifts.state.redeemed',
  revoked: 'gifts.state.revoked',
  expired: 'gifts.state.expired',
} as const satisfies Record<GiftState, OperatorKey>;

const Gifts: React.FC = () => {
  const t = useOperatorT();
  const { dateTime } = useFormatters();
  const queryClient = useQueryClient();
  const all = useQuery({ queryKey: ['gifts', 'operator'], queryFn: listAllGifts });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['gifts', 'operator'] });

  const [perPerson, setPerPerson] = useState<string>('');
  const [email, setEmail] = useState('');
  const [gifts, setGifts] = useState('');
  const [note, setNote] = useState('');

  const rule = useMutation({
    mutationFn: () => setGiftsPerPerson(Number(perPerson)),
    onSuccess: () => {
      setPerPerson('');
      refresh();
    },
  });
  const allowance = useMutation({
    mutationFn: () => setGiftAllowance(email.trim(), gifts.trim() === '' ? null : Number(gifts), note.trim() || undefined),
    onSuccess: () => {
      setEmail('');
      setGifts('');
      setNote('');
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => revokeAnyGift(id), onSuccess: refresh });

  const field = 'rounded-md border border-gray-300 px-3 py-2 text-sm';
  const button =
    'rounded-md bg-site-teal px-3 py-2 text-sm font-medium text-white hover:bg-site-teal/90 disabled:opacity-50';
  const data = all.data;

  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <GiftIcon className="h-6 w-6" aria-hidden="true" />
          {t('gifts.title')}
        </h1>
        <p className="text-sm text-gray-600">{t('gifts.subtitle')}</p>
      </header>

      {all.isError && (
        <p role="alert" className="text-sm text-red-600">
          {serverMessage(all.error)}
        </p>
      )}

      {data && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">{t('gifts.count.title')}</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                ['gifts.count.granted', data.alpha.granted],
                ['gifts.count.open', data.alpha.open],
                ['gifts.count.openFromGifts', data.alpha.openFromGifts],
                ['gifts.count.unused', data.alpha.unusedGifts],
              ] as const
            ).map(([key, n]) => (
              <div key={key} className="rounded-lg border border-gray-200 bg-white p-4">
                <dt className="text-xs text-gray-600">{t(key)}</dt>
                <dd className="text-2xl font-bold text-gray-900">{n}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-gray-500">{t('gifts.count.noCap')}</p>
        </section>
      )}

      {data && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('gifts.rule.title')}</h2>
          <p className="text-sm text-gray-600">{t('gifts.rule.help')}</p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              rule.mutate();
            }}
          >
            <label htmlFor="gifts-per-person" className="sr-only">
              {t('gifts.rule.title')}
            </label>
            <input
              id="gifts-per-person"
              type="number"
              min={0}
              max={20}
              placeholder={String(data.giftsPerPerson)}
              value={perPerson}
              onChange={(e) => setPerPerson(e.target.value)}
              className={`${field} w-24`}
            />
            <button type="submit" disabled={rule.isPending || perPerson === ''} className={button}>
              {t('gifts.rule.save')}
            </button>
            {rule.isSuccess && <span className="text-sm text-gray-600">{t('gifts.saved')}</span>}
            {rule.isError && (
              <span role="alert" className="text-sm text-red-600">
                {serverMessage(rule.error)}
              </span>
            )}
          </form>

          <h3 className="pt-2 font-semibold text-gray-900">{t('gifts.allowance.title')}</h3>
          <p className="text-sm text-gray-600">{t('gifts.allowance.help')}</p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              allowance.mutate();
            }}
          >
            <div>
              <label htmlFor="allowance-email" className="block text-xs text-gray-600">
                {t('gifts.allowance.email')}
              </label>
              <input
                id="allowance-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="allowance-gifts" className="block text-xs text-gray-600">
                {t('gifts.allowance.gifts')}
              </label>
              <input
                id="allowance-gifts"
                type="number"
                min={0}
                max={20}
                value={gifts}
                onChange={(e) => setGifts(e.target.value)}
                className={`${field} w-24`}
              />
            </div>
            <div className="grow">
              <label htmlFor="allowance-note" className="block text-xs text-gray-600">
                {t('gifts.allowance.note')}
              </label>
              <input id="allowance-note" value={note} onChange={(e) => setNote(e.target.value)} className={`${field} w-full`} />
            </div>
            <button type="submit" disabled={allowance.isPending || email.trim() === ''} className={button}>
              {t('gifts.allowance.save')}
            </button>
          </form>
          {allowance.isError && (
            <p role="alert" className="text-sm text-red-600">
              {serverMessage(allowance.error)}
            </p>
          )}
          {data.allowances.length === 0 ? (
            <p className="text-sm text-gray-500">{t('gifts.allowance.none')}</p>
          ) : (
            <ul className="text-sm text-gray-800">
              {data.allowances.map((a) => (
                <li key={a.userId}>
                  {a.email ?? a.userId}: {a.gifts}
                  {a.note ? ` · ${a.note}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">{t('gifts.list.title')}</h2>
          {data.gifts.length === 0 && <p className="text-sm text-gray-500">{t('gifts.list.empty')}</p>}
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {data.gifts.map((g) => (
              <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-gray-900">
                    {t(STATE_KEY[g.state])} ·{' '}
                    {g.giverEmail
                      ? t('gifts.list.from', { giver: g.giverEmail })
                      : t('gifts.list.fromNobody')}
                    {g.organisation ? ` (${g.organisation})` : ''} · {g.locale}
                  </p>
                  <p className="text-xs text-gray-600">
                    {t('gifts.list.made', { date: dateTime(g.createdAt), until: dateTime(g.expiresAt) })}
                  </p>
                  {g.request && (
                    <p className="text-xs text-gray-600">
                      {g.request.email
                        ? t('gifts.list.request', { email: g.request.email, state: g.request.state ?? '' })
                        : t('gifts.list.requestGone')}
                    </p>
                  )}
                </div>
                {g.state === 'unused' && (
                  <button
                    type="button"
                    onClick={() => revoke.mutate(g.id)}
                    disabled={revoke.isPending}
                    className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {t('gifts.list.revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {revoke.isError && (
            <p role="alert" className="text-sm text-red-600">
              {serverMessage(revoke.error)}
            </p>
          )}
        </section>
      )}
    </div>
  );
};

export default Gifts;
