// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A year paid ahead, on the Billing page (workplan 0111 T11, slice Y2; ADR-0014,
 * *Amendment 2026-10-04*; terms §8; the owner's four answers of 2026-10-12).
 *
 * A year is credit at six months' price: each month of it takes its own tier at
 * half its monthly price, and what is left after its twelve months pays the
 * months after them at the monthly price. It is not refunded and does not renew.
 * The card says the credit left and the year's months, when there is a year;
 * then the tiers a year may be bought for (the tier the month bills or a higher
 * one), each with the year's price, and when it would start.
 *
 * A year costs money, so a press is not yet the order: it asks once more with
 * the money said, as a pick does, and only the order button sends it, with the
 * words terms §6 promises. A year above the tier the month bills is a pick of
 * that tier too, and the question says so. The page sends the tier, the price
 * it showed and the years it saw; when any changed in between, the server
 * refuses and serves the year as it is now, which the card then shows.
 *
 * During the alpha nothing is charged: the card lists the years and their prices
 * and says so, with no button.
 */
import React from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { billingApi, YearSchema, type YearOffer, type YearOfferTier } from '../services/billing-service.ts';
import { serverMessage } from '../services/api.ts';
import InvoiceDetailsFirst from './InvoiceDetailsFirst.tsx';
import { BeginNow, useYesAsksToBegin } from './BeginNow.tsx';
import { useFormatters, useT } from '../i18n/index.tsx';

const QUERY_KEY = ['billing-year'] as const;

/** What the server answered when it did not take the order: its code, and the year as it is now. */
function refusalOf(error: unknown): { code: string | null; year: YearOffer | null } {
  if (!axios.isAxiosError(error)) return { code: null, year: null };
  const data: unknown = error.response?.data;
  if (!data || typeof data !== 'object') return { code: null, year: null };
  const d = data as { error?: unknown; year?: unknown };
  const parsed = YearSchema.safeParse(d.year);
  return { code: typeof d.error === 'string' ? d.error : null, year: parsed.success ? parsed.data : null };
}

const place = (id: string) => ['free', 'small', 'medium', 'large', 'xl'].indexOf(id);

const YearAhead: React.FC = () => {
  const t = useT();
  const queryClient = useQueryClient();
  const [asking, setAsking] = React.useState<YearOfferTier | null>(null);
  const [done, setDone] = React.useState<{ tier: string; from: string } | null>(null);
  // `2026-11` as the month in the page's language, `November 2026`; months are UTC, as the bill's are.
  const { month: monthWords } = useFormatters();

  const { data: offer, isLoading, error } = useQuery({ queryKey: QUERY_KEY, queryFn: () => billingApi.getYear() });
  const asksToBegin = useYesAsksToBegin();

  const order = useMutation({
    // `beginNow` only when the order button said so (0111 slice 7e).
    mutationFn: ({ tier, years, beginNow }: { tier: YearOfferTier; years: number; beginNow: boolean }) =>
      billingApi.orderYear({
        tierId: tier.id,
        yearCents: tier.yearCents,
        yearsBefore: years,
        ...(beginNow ? { beginNow: true } : {}),
      }),
    onSuccess: (fresh, { tier }) => {
      const { ordered, ...now } = fresh;
      queryClient.setQueryData(QUERY_KEY, now);
      // The year's invoice, and a pick it carried, show elsewhere on the page.
      void queryClient.invalidateQueries({ queryKey: ['billing-invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-usage'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-pick'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-withdrawal'] });
      setAsking(null);
      setDone({ tier: tier.name, from: monthWords(ordered.creditFrom) });
    },
    onError: (err) => {
      const { year: now } = refusalOf(err);
      if (now) queryClient.setQueryData(QUERY_KEY, now);
      setAsking(null);
    },
  });

  if (isLoading) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('billing.year.title')}</h2>
      {error != null || !offer ? (
        <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t('billing.year.loadFailed')}</p>
            <p className="mt-1">{serverMessage(error)}</p>
          </div>
        </div>
      ) : (
        <YearBody
          offer={offer}
          asking={asking}
          setAsking={(next) => {
            order.reset();
            setDone(null);
            setAsking(next);
          }}
          pending={order.isPending}
          asksToBegin={asksToBegin}
          onOrder={(tier, beginNow) => order.mutate({ tier, years: offer.yearsBefore, beginNow })}
          done={done}
          refusal={order.isError ? order.error : null}
        />
      )}
    </div>
  );
};

const YearBody: React.FC<{
  offer: YearOffer;
  asking: YearOfferTier | null;
  setAsking: (asking: YearOfferTier | null) => void;
  pending: boolean;
  asksToBegin: boolean;
  onOrder: (tier: YearOfferTier, beginNow: boolean) => void;
  done: { tier: string; from: string } | null;
  refusal: unknown;
}> = ({ offer, asking, setAsking, pending, asksToBegin, onOrder, done, refusal }) => {
  const t = useT();
  const { currency, month: monthWords } = useFormatters();
  const { holds, placement, credit, heldCents, years } = offer;
  const refusedCode = refusal ? refusalOf(refusal).code : null;
  // The latest year's months at half price, and where any year bought now would fall.
  const latest = years.length > 0 ? years[years.length - 1] : undefined;
  const appended = placement.halfFrom !== placement.creditFrom;

  return (
    <div className="space-y-3 text-sm">
      {years.length > 0 && (
        <div className="space-y-1">
          <p className="text-gray-900 font-medium">{t('billing.year.credit', { left: currency(heldCents, 'EUR') })}</p>
          {latest && (
            <p className="text-gray-700">
              {t('billing.year.halfMonths', { from: monthWords(years[0]!.halfFrom), to: monthWords(latest.halfTo) })}
            </p>
          )}
          {credit.yearMonth && credit.leftCents > 0 && <p className="text-gray-700">{t('billing.year.thisMonthHalf')}</p>}
        </div>
      )}
      <p className="text-gray-600">{t('billing.year.lead')}</p>
      {!holds && <p className="text-gray-600">{t('billing.year.alpha')}</p>}

      {done && (
        <p className="text-green-800" role="status">
          {t('billing.year.done', { tier: done.tier, from: done.from })}
        </p>
      )}
      {refusal != null &&
        (refusedCode === 'invoice_details_first' ? (
          <InvoiceDetailsFirst />
        ) : (
          <p className="text-red-800">
            {refusedCode === 'offer_changed' ? (
              t('billing.year.offerChanged')
            ) : (
              <>
                <span className="font-medium">{t('billing.year.failed')}</span> {serverMessage(refusal)}
              </>
            )}
          </p>
        ))}

      <p className="text-gray-600">
        {appended
          ? t('billing.year.startsAfter', {
              credit: monthWords(placement.creditFrom),
              from: monthWords(placement.halfFrom),
              to: monthWords(placement.halfTo),
            })
          : t('billing.year.starts', { from: monthWords(placement.creditFrom), to: monthWords(placement.halfTo) })}
      </p>
      <ul className="divide-y divide-gray-200 border-t border-gray-200">
        {offer.tiers.map((tier) => {
          const picks = place(tier.id) > place(offer.billed.id);
          const year = currency(tier.yearCents, 'EUR');
          return (
            <li key={tier.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <p className="flex-1 min-w-[16rem] text-gray-900">
                <span className="font-semibold">{tier.name}</span>
                {' · '}
                {t('billing.year.price', { year, half: currency(Math.floor(tier.monthlyCents / 2), 'EUR') })}
              </p>
              {holds && (
                <button
                  type="button"
                  onClick={() => setAsking(tier)}
                  disabled={pending}
                  aria-expanded={asking?.id === tier.id}
                  className="px-3 py-1.5 border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 font-medium"
                >
                  {t('billing.year.button', { tier: tier.name })}
                </button>
              )}
              {/* The question opens under the tier pressed, where the eye is. */}
              {holds && asking?.id === tier.id && (
                <Question
                  sentence={[
                    t('billing.year.confirm', { tier: tier.name, year }),
                    ...(picks ? [t('billing.year.confirm.pick', { tier: tier.name })] : []),
                  ].join(' ')}
                  note={asksToBegin ? <BeginNow /> : null}
                  onYes={() => onOrder(tier, asksToBegin)}
                  onNo={() => setAsking(null)}
                  pending={pending}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/**
 * The question a press opens, as a pick's: the sentence that says what it costs,
 * the request to begin when there is one, and the order button. It takes the
 * focus when it opens, so the answer is a deliberate second press.
 */
const Question: React.FC<{
  sentence: string;
  note: React.ReactNode;
  onYes: () => void;
  onNo: () => void;
  pending: boolean;
}> = ({ sentence, note, onYes, onNo, pending }) => {
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
      {note && <div className="text-gray-700">{note}</div>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onYes}
          disabled={pending}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {pending && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('billing.order.button')}
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

export default YearAhead;
