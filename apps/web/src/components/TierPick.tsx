// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Picking a tier on the Billing page (workplan 0157 T6; ADR-0014, *Amendment
 * 2026-10-04, evening*; the owner: *"yes someone may pick a tier. So Free can
 * pick higher if they see fit."*).
 *
 * A tier follows what is used, and falls by itself when less is used. A person
 * may pick a higher one, for its pace or its room: each month then bills at
 * least that tier, until they lower it. The card lists every tier above the one
 * this month bills, each with its monthly price, its room and its pace, and
 * says the pick that stands.
 *
 * A pick costs money, so a press is not yet the pick: it asks once more with
 * the money said, under the tier pressed and with the focus on the question,
 * and only the order button sends it, labelled with the words the law gives it
 * (terms §6: *"a button that says plainly that you are ordering with an
 * obligation to pay"*). What it sends is the tier and the price the card
 * showed; when what may be picked changed in between, the server refuses and
 * serves what is offered now, which the card then shows.
 *
 * Every paid tier runs at the same pace, so the pace is said once, above the
 * list, and each tier says only its price and its room.
 *
 * Lowering is the person's own action and counts from the next month. It
 * orders nothing, so its confirmation is plain. While a lower pick waits, the
 * tier picked now is offered again, to keep it.
 *
 * During the alpha every tier's pace and room are a tester's for nothing, so
 * no pick is taken: the card lists the tiers and their prices, and says so,
 * with no button, as the data ceiling's card does.
 */
import React from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { billingApi, PickSchema, type PickOffer, type PickTier } from '../services/billing-service.ts';
import { serverMessage } from '../services/api.ts';
import { useFormatters, useLocale, useT } from '../i18n/index.tsx';
import { formatDateTime } from '../i18n/datetime.ts';

const QUERY_KEY = ['billing-pick'] as const;

/** What the server answered when it did not take the pick: its code, and what is offered now. */
function refusalOf(error: unknown): { code: string | null; pick: PickOffer | null } {
  if (!axios.isAxiosError(error)) return { code: null, pick: null };
  const data: unknown = error.response?.data;
  if (!data || typeof data !== 'object') return { code: null, pick: null };
  const d = data as { error?: unknown; pick?: unknown };
  const parsed = PickSchema.safeParse(d.pick);
  return { code: typeof d.error === 'string' ? d.error : null, pick: parsed.success ? parsed.data : null };
}

/** A pick being asked about: which tier, and whether it raises or lowers. */
type Asking = { readonly tier: PickTier; readonly lower: boolean };

/** What the card says once a pick is taken. */
type Done = { readonly tier: PickTier; readonly lower: boolean };

const TierPick: React.FC = () => {
  const t = useT();
  const queryClient = useQueryClient();
  const [asking, setAsking] = React.useState<Asking | null>(null);
  const [done, setDone] = React.useState<Done | null>(null);

  const { data: offer, isLoading, error } = useQuery({ queryKey: QUERY_KEY, queryFn: () => billingApi.getPick() });

  const pick = useMutation({
    mutationFn: (tier: PickTier) => billingApi.pickTier({ tierId: tier.id, priceEur: tier.monthlyEur }),
    onSuccess: (fresh, tier) => {
      const { from: when, ...now } = fresh;
      queryClient.setQueryData(QUERY_KEY, now);
      // What this month bills, the data ceiling and the pace follow the pick.
      void queryClient.invalidateQueries({ queryKey: ['billing-usage'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-ceiling'] });
      setAsking(null);
      setDone({ tier, lower: when === 'next_month' });
    },
    onError: (err) => {
      // A refusal that carries what is offered now replaces what the card
      // shows, and the question closes: the person reads the tiers again.
      const { pick: now } = refusalOf(err);
      if (now) queryClient.setQueryData(QUERY_KEY, now);
      setAsking(null);
    },
  });

  if (isLoading) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('billing.pick.title')}</h2>
      {error != null || !offer ? (
        <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t('billing.pick.loadFailed')}</p>
            <p className="mt-1">{serverMessage(error)}</p>
          </div>
        </div>
      ) : (
        <PickBody
          offer={offer}
          asking={asking}
          setAsking={(next) => {
            pick.reset();
            setDone(null);
            setAsking(next);
          }}
          pending={pick.isPending}
          onPick={(tier) => pick.mutate(tier)}
          done={done}
          refusal={pick.isError ? pick.error : null}
        />
      )}
    </div>
  );
};

const PickBody: React.FC<{
  offer: PickOffer;
  asking: Asking | null;
  setAsking: (asking: Asking | null) => void;
  pending: boolean;
  onPick: (tier: PickTier) => void;
  done: Done | null;
  refusal: unknown;
}> = ({ offer, asking, setAsking, pending, onPick, done, refusal }) => {
  const t = useT();
  const { locale } = useLocale();
  const { currency, number } = useFormatters();
  const { holds, picked, raise, lower } = offer;
  // The table is in whole euros; `currency` takes cents.
  const eur = (whole: number): string => currency(whole * 100, 'EUR');
  // Decimal, like the published table: 1 TB = 1000 GB.
  const size = (gb: number): string => (gb >= 1000 ? `${number(gb / 1000)} TB` : `${number(gb)} GB`);
  // The month a lower pick counts from begins at midnight UTC, as the bill's
  // months do: said as that day, wherever the reader is.
  const nextFrom = formatDateTime(picked.nextFrom, locale, { dateStyle: 'long', timeStyle: undefined, timeZone: 'UTC' });
  // A lower pick waits for the next month: the tier picked now may be kept.
  const lowering = picked.now != null && picked.now.id !== picked.next?.id;
  const keeps = (tier: PickTier) => lowering && tier.id === picked.now?.id;
  const refusedCode = refusal ? refusalOf(refusal).code : null;

  return (
    <div className="space-y-3 text-sm">
      {picked.now ? (
        <p className="text-gray-900">{t('billing.pick.standing', { tier: picked.now.name })}</p>
      ) : (
        <p className="text-gray-600">{t('billing.pick.lead')}</p>
      )}
      {lowering && (
        <p className="text-gray-900">
          {picked.next
            ? t('billing.pick.lowered', { date: nextFrom, tier: picked.next.name })
            : t('billing.pick.loweredToNone', { date: nextFrom })}
        </p>
      )}
      {!holds && <p className="text-gray-600">{t('billing.pick.alpha')}</p>}

      {done && (
        <p className="text-green-800" role="status">
          {done.lower
            ? t('billing.pick.lowerDone', { date: nextFrom })
            : t('billing.pick.done', { tier: done.tier.name })}
        </p>
      )}
      {refusal != null && (
        <p className="text-red-800">
          {refusedCode === 'offer_changed' ? (
            t('billing.pick.offerChanged')
          ) : (
            <>
              <span className="font-medium">{t('billing.pick.failed')}</span> {serverMessage(refusal)}
            </>
          )}
        </p>
      )}

      {raise.length > 0 ? (
        <>
          <p className="text-gray-600">{t('billing.pick.pace')}</p>
          <ul className="divide-y divide-gray-200 border-t border-gray-200">
            {raise.map((tier) => (
              <li key={tier.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="flex-1 min-w-[16rem] space-y-1">
                  <p className="text-gray-900">
                    <span className="font-semibold">{tier.name}</span>
                    {' · '}
                    {t('billing.pick.monthly', { monthly: eur(tier.monthlyEur) })}
                  </p>
                  <p className="text-gray-600">{t('billing.pick.room', { paths: tier.paths, data: size(tier.dataGb) })}</p>
                </div>
                {holds && (
                  <button
                    type="button"
                    onClick={() => setAsking({ tier, lower: false })}
                    disabled={pending}
                    aria-expanded={asking?.tier.id === tier.id && !asking.lower}
                    className="px-3 py-1.5 border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 font-medium"
                  >
                    {keeps(tier) ? t('billing.pick.keep', { tier: tier.name }) : t('billing.pick.button', { tier: tier.name })}
                  </button>
                )}
                {/* The question opens under the tier pressed, where the eye is. */}
                {holds && asking && !asking.lower && asking.tier.id === tier.id && (
                  <Question
                    sentence={
                      keeps(tier)
                        ? t('billing.pick.confirm.keep', { tier: tier.name, monthly: eur(tier.monthlyEur) })
                        : t('billing.pick.confirm', { tier: tier.name, monthly: eur(tier.monthlyEur) })
                    }
                    yes={t('billing.pick.order')}
                    onYes={() => onPick(tier)}
                    onNo={() => setAsking(null)}
                    pending={pending}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-gray-600">{t('billing.pick.top', { tier: offer.billed.name })}</p>
      )}

      {holds && lower.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-200">
          {[...lower].reverse().map((tier) => (
            <button
              key={tier.id}
              type="button"
              onClick={() => setAsking({ tier, lower: true })}
              disabled={pending}
              aria-expanded={asking?.tier.id === tier.id && asking.lower}
              className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {tier.id === 'free' ? t('billing.pick.drop') : t('billing.pick.lowerTo', { tier: tier.name })}
            </button>
          ))}
          {asking?.lower && (
            <Question
              sentence={
                asking.tier.id === 'free'
                  ? t('billing.pick.lower.confirmNone', { date: nextFrom, now: picked.now?.name ?? '' })
                  : t('billing.pick.lower.confirm', { date: nextFrom, tier: asking.tier.name, now: picked.now?.name ?? '' })
              }
              yes={t('billing.pick.lower.yes')}
              onYes={() => onPick(asking.tier)}
              onNo={() => setAsking(null)}
              pending={pending}
            />
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The question a press opens: the sentence that says what it costs or changes,
 * and the two buttons. It takes the focus when it opens, so a keyboard or a
 * screen reader is where the question is, and the answer is a deliberate
 * second press: the focus is on the question, never on the order button.
 */
const Question: React.FC<{
  sentence: string;
  yes: string;
  onYes: () => void;
  onNo: () => void;
  pending: boolean;
}> = ({ sentence, yes, onYes, onNo, pending }) => {
  const t = useT();
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => box.current?.focus(), []);
  return (
    <div
      ref={box}
      tabIndex={-1}
      className="basis-full p-4 rounded-lg bg-blue-50 space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      role="alertdialog"
      aria-live="polite"
      aria-label={sentence}
    >
      <p className="text-gray-900">{sentence}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onYes}
          disabled={pending}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {pending && <Loader2 className="w-4 h-4 animate-spin" />}
          {yes}
        </button>
        <button
          type="button"
          onClick={onNo}
          disabled={pending}
          className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {t('billing.pick.notNow')}
        </button>
      </div>
    </div>
  );
};

export default TierPick;
