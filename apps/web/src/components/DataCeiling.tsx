// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The data ceiling on the Billing page (workplan 0109 T6, ADR-0014's
 * amendment of 2026-10-03).
 *
 * Where the organisation's data stands against its ceiling and, from 80%,
 * both ways on side by side with their prices and the break-even: move up a
 * tier, or buy another band once (*tiers buy lanes; top-ups buy room*). Every
 * step up is consented and paid for, so a press is not yet the yes: it asks
 * once more with the money said, and only "Yes, I agree" sends it. What it
 * sends is the tier and the price the card showed; when the offer changed in
 * between (the meter moved, or a yes in another tab), the server refuses and
 * serves the offer as it is now, which the card then shows, so nobody agrees
 * to a price they did not see.
 *
 * During the alpha the ceiling warns and holds nothing, and no yes is taken
 * (the owner, 2026-10-03: *"A"*): the card says where the data stands and what
 * the ways on will cost, and offers no button. What the alpha moves never
 * counts (the owner, 2026-10-04): it is said on a line of its own, beside
 * what does.
 */
import React from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { billingApi, CeilingSchema, type Ceiling, type CeilingYes } from '../services/billing-service.ts';
import { serverMessage } from '../services/api.ts';
import { useT, useFormatters } from '../i18n/index.tsx';

const QUERY_KEY = ['billing-ceiling'] as const;

/** What the server answered when it did not take the yes: its code, and the offer now. */
function refusalOf(error: unknown): { code: string | null; ceiling: Ceiling | null } {
  if (!axios.isAxiosError(error)) return { code: null, ceiling: null };
  const data: unknown = error.response?.data;
  if (!data || typeof data !== 'object') return { code: null, ceiling: null };
  const d = data as { error?: unknown; ceiling?: unknown };
  const parsed = CeilingSchema.safeParse(d.ceiling);
  return { code: typeof d.error === 'string' ? d.error : null, ceiling: parsed.success ? parsed.data : null };
}

const DataCeiling: React.FC = () => {
  const t = useT();
  const { currency, number } = useFormatters();
  const queryClient = useQueryClient();
  const [asking, setAsking] = React.useState<CeilingYes['choice'] | null>(null);
  const [done, setDone] = React.useState(false);

  const { data: ceiling, isLoading, error } = useQuery({ queryKey: QUERY_KEY, queryFn: () => billingApi.getCeiling() });

  const yes = useMutation({
    mutationFn: (body: CeilingYes) => billingApi.sayYesToCeiling(body),
    onSuccess: (fresh) => {
      queryClient.setQueryData(QUERY_KEY, fresh);
      setAsking(null);
      setDone(true);
    },
    onError: (err) => {
      // A refusal that carries the offer as it is now replaces what the card
      // shows, and the question closes: the customer reads the new offer.
      const { ceiling: now } = refusalOf(err);
      if (now) queryClient.setQueryData(QUERY_KEY, now);
      setAsking(null);
    },
  });

  // Decimal, like the published table: 1 TB = 1000 GB.
  const size = (gb: number): string =>
    gb >= 1000 ? `${number(Math.round(gb / 100) / 10)} TB` : `${number(Math.round(gb * 10) / 10)} GB`;
  // The table is in whole euros; `currency` takes cents.
  const eur = (whole: number): string => currency(whole * 100, 'EUR');

  if (isLoading) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('billing.ceiling.title')}</h2>
      {error != null || !ceiling ? (
        <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t('billing.ceiling.loadFailed')}</p>
            <p className="mt-1">{serverMessage(error)}</p>
          </div>
        </div>
      ) : (
        <CeilingBody
          ceiling={ceiling}
          size={size}
          eur={eur}
          asking={asking}
          setAsking={(choice) => {
            yes.reset();
            setDone(false);
            setAsking(choice);
          }}
          pending={yes.isPending}
          onYes={(body) => yes.mutate(body)}
          done={done}
          refusal={yes.isError ? yes.error : null}
        />
      )}
    </div>
  );
};

const CeilingBody: React.FC<{
  ceiling: Ceiling;
  size: (gb: number) => string;
  eur: (whole: number) => string;
  asking: CeilingYes['choice'] | null;
  setAsking: (choice: CeilingYes['choice'] | null) => void;
  pending: boolean;
  onYes: (yes: CeilingYes) => void;
  done: boolean;
  refusal: unknown;
}> = ({ ceiling, size, eur, asking, setAsking, pending, onYes, done, refusal }) => {
  const t = useT();
  const { moveUp, topUp, breakEven, tier, state, holds } = ceiling;
  const percent = Math.round(Math.min(ceiling.share, 1) * 100);
  const bar = state === 'reached' ? 'bg-red-500' : state === 'near' ? 'bg-amber-500' : 'bg-blue-500';
  const offered = state !== 'under';
  const refusedCode = refusal ? refusalOf(refusal).code : null;

  const pendingYes: CeilingYes | null =
    asking === 'move_up' && moveUp
      ? { choice: 'move_up', tierId: moveUp.tierId, priceEur: moveUp.monthlyEur }
      : asking === 'top_up' && topUp
        ? { choice: 'top_up', tierId: topUp.tierId, priceEur: topUp.priceEur }
        : null;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-900">
        {t('billing.ceiling.moved', { moved: size(ceiling.gbMoved), ceiling: size(ceiling.ceilingGb), tier: tier.name })}
        {ceiling.topUps > 0 && <> {t('billing.ceiling.bands', { count: ceiling.topUps })}</>}
      </p>
      {/* What the alpha moved never counts (the owner, 2026-10-04), and is
          said, so the number above is not read as everything moved. */}
      {ceiling.gbMovedInTheAlpha > 0 && (
        <p className="text-gray-600">{t('billing.ceiling.alphaMoved', { moved: size(ceiling.gbMovedInTheAlpha) })}</p>
      )}
      <div
        className="h-2 w-full rounded-full bg-gray-100 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t('billing.ceiling.title')}
      >
        <div className={`h-2 ${bar}`} style={{ width: `${percent}%` }} />
      </div>

      {state === 'under' && <p className="text-gray-600">{t('billing.ceiling.under')}</p>}
      {state !== 'under' && holds && (
        <p className={state === 'reached' ? 'text-red-800' : 'text-amber-800'}>
          {state === 'reached'
            ? t('billing.ceiling.reached')
            : t('billing.ceiling.near', { share: `${percent}%` })}
        </p>
      )}
      {offered && !holds && <p className="text-gray-600">{t('billing.ceiling.alpha')}</p>}

      {done && <p className="text-green-800">{t('billing.ceiling.done', { ceiling: size(ceiling.ceilingGb) })}</p>}
      {refusal != null && (
        <p className="text-red-800">
          {refusedCode === 'offer_changed' ? (
            t('billing.ceiling.offerChanged')
          ) : (
            <>
              <span className="font-medium">{t('billing.ceiling.yesFailed')}</span> {serverMessage(refusal)}
            </>
          )}
        </p>
      )}

      {offered && (
        <div className="space-y-3 pt-2 border-t">
          {moveUp ? (
            <Offer
              sentence={t('billing.ceiling.moveUp', {
                tier: moveUp.name,
                monthly: eur(moveUp.monthlyEur),
                ceiling: size(moveUp.ceilingGb),
                paths: moveUp.paths,
              })}
              button={holds ? t('billing.ceiling.moveUp.button', { tier: moveUp.name }) : null}
              onPress={() => setAsking('move_up')}
              disabled={pending}
            />
          ) : (
            <p className="text-gray-600">{t('billing.ceiling.talkToUs', { tier: tier.name })}</p>
          )}
          {topUp ? (
            <Offer
              sentence={t('billing.ceiling.topUp', {
                band: size(topUp.bandGb),
                price: eur(topUp.priceEur),
                ceiling: size(topUp.ceilingGb),
              })}
              button={holds ? t('billing.ceiling.topUp.button', { band: size(topUp.bandGb) }) : null}
              onPress={() => setAsking('top_up')}
              disabled={pending}
            />
          ) : (
            <p className="text-gray-600">{t('billing.ceiling.noTopUp', { tier: tier.name })}</p>
          )}
          {breakEven && moveUp && (
            <p className="text-gray-600">
              {breakEven.extraOnceEur > 0
                ? t('billing.ceiling.breakEven', {
                    extra: eur(breakEven.extraOnceEur),
                    saved: eur(breakEven.savedMonthlyEur),
                    days: breakEven.paysBackInDays,
                  })
                : t('billing.ceiling.breakEven.cheaper', { saved: eur(breakEven.savedMonthlyEur) })}{' '}
              {t('billing.ceiling.betterBuy', {
                next: moveUp.name,
                nextPaths: moveUp.paths,
                tier: tier.name,
                paths: tier.paths,
              })}
            </p>
          )}
        </div>
      )}

      {holds && pendingYes && (
        <div className="p-4 rounded-lg bg-blue-50 space-y-3" role="alertdialog" aria-live="polite">
          <p className="text-gray-900">
            {pendingYes.choice === 'move_up' && moveUp
              ? t('billing.ceiling.confirm.moveUp', { monthly: eur(moveUp.monthlyEur), tier: moveUp.name })
              : topUp
                ? t('billing.ceiling.confirm.topUp', { price: eur(topUp.priceEur), band: size(topUp.bandGb) })
                : null}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onYes(pendingYes)}
              disabled={pending}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {pending && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('billing.ceiling.confirm.yes')}
            </button>
            <button
              type="button"
              onClick={() => setAsking(null)}
              disabled={pending}
              className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {t('billing.ceiling.confirm.no')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/** One way on: its sentence, and the button that asks for the yes (none during the alpha). */
const Offer: React.FC<{ sentence: string; button: string | null; onPress: () => void; disabled: boolean }> = ({
  sentence,
  button,
  onPress,
  disabled,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <p className="text-gray-900 flex-1 min-w-[16rem]">{sentence}</p>
    {button && (
      <button
        type="button"
        onClick={onPress}
        disabled={disabled}
        className="px-3 py-1.5 border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 font-medium"
      >
        {button}
      </button>
    )}
  </div>
);

export default DataCeiling;
