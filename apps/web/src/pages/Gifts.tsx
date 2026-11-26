// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The operator's gifts (workplans 0172 §3.5 and 0177 T16, §20), in English
 * only (ADR-0013 as amended 2026-10-11: `operator-strings.ts`, inside
 * `EnglishOnly`). The screen keeps the name *Gifts*: a paid code joins it
 * after the Alpha (0177 §13). What is on it today is the free kind, a
 * recommendation, which lets its person in at once (0177 D6).
 *
 * What the owner asked to see and set without a deploy:
 *
 *  - **The Alpha's two ceilings** (D16): *"alpha limited to 50 people I let
 *    in, en 50 max someone invites (each let in user 1 invite)."* Two counts,
 *    each with its number (§20.1): the people the owner let in, and the
 *    people let in by a recommendation; and the cards not used yet, which
 *    are places promised. A count at its number or past it stands out, in
 *    words too. Two fields set the numbers (§20.2). Under them, what each
 *    number does, and that both count people while Google's list of test
 *    users counts addresses (§20.5).
 *  - **The number each person may recommend**, for everyone and for one
 *    person by the address they sign in with.
 *  - **Every card**, whose it is, what became of it, and *Revoke* on an
 *    unused one.
 *
 * Whether the owner's own number refuses a grant is the owner's D17, still
 * open; until it is answered it is only shown, and the sentence under the
 * counts says so. That choice is `OWNERS_CEILING_REFUSES`, below, and the
 * server's own is the back's (0177 §19). Nothing here authorises anything:
 * managed migration 0065's policies are the rule, so a typed URL by somebody
 * else shows nothing and changes nothing.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift as GiftIcon } from 'lucide-react';
import { useOperatorT, useFormatters } from '../i18n/index.tsx';
import type { OperatorKey } from '../i18n/operator-strings.ts';
import { serverMessage } from '../services/api.ts';
import { CeilingLine } from '../components/CeilingLine.tsx';
import {
  listAllGifts,
  revokeAnyGift,
  setGiftAllowance,
  setRuleNumber,
  type GiftState,
  type RuleNumber,
} from '../services/gifts.ts';

/**
 * THE OWNER'S D17, UNTIL IT IS ANSWERED (0177 §15.3): does the owner's own
 * number refuse a 51st yes, or is it only shown? Until the owner answers, it
 * is only shown, which both answers need anyway. An answer of (a) turns this
 * to `true`, with the server's refusal of a grant (§19): then the sentence
 * under the counts says that a grant is refused until the number is raised.
 */
const OWNERS_CEILING_REFUSES = false;


const STATE_KEY = {
  unused: 'gifts.state.unused',
  redeemed: 'gifts.state.redeemed',
  revoked: 'gifts.state.revoked',
  expired: 'gifts.state.expired',
} as const satisfies Record<GiftState, OperatorKey>;

/**
 * One number of the rule's row (0177 §20.2): a whole number, nought or more,
 * set through `PUT /api/gifts/operator/rule`, one field at a time. The
 * current number is the field's placeholder; nothing is sent until Save.
 */
const RuleField: React.FC<{
  readonly which: RuleNumber;
  readonly label: string;
  readonly current: number;
  readonly onSaved: () => void;
  readonly hiddenLabel?: boolean;
}> = ({ which, label, current, onSaved, hiddenLabel = false }) => {
  const t = useOperatorT();
  const [value, setValue] = useState('');
  const id = React.useId();
  const save = useMutation({
    mutationFn: () => setRuleNumber(which, Number(value)),
    onSuccess: () => {
      setValue('');
      onSaved();
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <label htmlFor={id} className={hiddenLabel ? 'sr-only' : 'block text-xs text-gray-700'}>
          {label}
        </label>
        <input
          id={id}
          type="number"
          min={0}
          step={1}
          placeholder={String(current)}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24 rounded-md border border-gray-500 px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={save.isPending || !/^\d+$/.test(value)}
        className="rounded-md bg-site-teal px-3 py-2 text-sm font-medium text-white hover:bg-site-teal/90 disabled:opacity-50"
      >
        {t('gifts.rule.save')}
      </button>
      {save.isSuccess && <span className="text-sm text-gray-600">{t('gifts.saved')}</span>}
      {save.isError && (
        <span role="alert" className="text-sm text-red-600">
          {serverMessage(save.error)}
        </span>
      )}
    </form>
  );
};

const Gifts: React.FC = () => {
  const t = useOperatorT();
  const { dateTime } = useFormatters();
  const queryClient = useQueryClient();
  const all = useQuery({ queryKey: ['gifts', 'operator'], queryFn: listAllGifts });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['gifts', 'operator'] });

  const [email, setEmail] = useState('');
  const [gifts, setGifts] = useState('');
  const [note, setNote] = useState('');

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
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('gifts.count.title')}</h2>
          <div className="space-y-2 text-sm">
            <CeilingLine words={t('gifts.count.byOwner', { n: data.alpha.byOwner, max: data.alpha.ownerCeiling })} n={data.alpha.byOwner} max={data.alpha.ownerCeiling} />
            <CeilingLine
              words={t('gifts.count.byRecommendation', { n: data.alpha.byRecommendation, max: data.alpha.recommendationCeiling })}
              n={data.alpha.byRecommendation}
              max={data.alpha.recommendationCeiling}
            />
            <p className="text-gray-900">{t('gifts.count.unused', { n: data.alpha.unusedGifts })}</p>
          </div>
          <p className="text-sm text-gray-700">{t(OWNERS_CEILING_REFUSES ? 'gifts.count.ruleRefused' : 'gifts.count.rule')}</p>
          <p className="text-sm text-gray-700">{t('gifts.count.google')}</p>
          <div className="flex flex-wrap gap-6 pt-1">
            <RuleField which="ownerCeiling" label={t('gifts.ceiling.owner')} current={data.alpha.ownerCeiling} onSaved={refresh} />
            <RuleField
              which="recommendationCeiling"
              label={t('gifts.ceiling.recommendation')}
              current={data.alpha.recommendationCeiling}
              onSaved={refresh}
            />
          </div>
        </section>
      )}

      {data && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('gifts.rule.title')}</h2>
          <p className="text-sm text-gray-600">{t('gifts.rule.help')}</p>
          <RuleField which="giftsPerPerson" label={t('gifts.rule.title')} hiddenLabel current={data.giftsPerPerson} onSaved={refresh} />

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
