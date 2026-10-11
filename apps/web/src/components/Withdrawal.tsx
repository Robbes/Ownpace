// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE WITHDRAWAL FUNCTION (workplan 0111 T7, slice 7c; 0152 T6 (f); terms §7).
 *
 * A contract made online has needed a clearly labelled function to withdraw
 * during the withdrawal period since 19 June 2026 (article 11a of the Consumer
 * Rights Directive, as Directive (EU) 2023/2673 inserted it): a button in the
 * directive's own words, *Withdraw from contract here*, then a second step
 * where the consumer gives or confirms their name, the contract, and where
 * the confirmation goes, and a button *Confirm withdrawal*. The owner chose
 * those words on 2026-10-05 (*"Ok. As you would suggest."*); the Dutch are
 * *Hier de overeenkomst herroepen* and *Herroeping bevestigen*.
 *
 * Shown while the server says the window is open (`GET /billing/withdrawal`):
 * on Free, for a business, and after the fourteen days, there is nothing to
 * withdraw from, and the card is not there. The second step takes the focus
 * when it opens, so a keyboard or a screen reader is where the question is.
 * Once confirmed, the card says when, that the organisation is on Free, and
 * where the confirmation went; what the Billing page shows of the tier, the
 * pace and the invoices is read again.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { billingApi, type WithdrawalState, type Withdrawn } from '../services/billing-service.ts';
import { serverMessage } from '../services/api.ts';
import { useLocale, useT } from '../i18n/index.tsx';
import { formatDateTime } from '../i18n/datetime.ts';

const QUERY_KEY = ['billing-withdrawal'] as const;

/** A UTC day, long, in the page's language: the server's days are UTC days. */
function useDay(): (iso: string) => string {
  const { locale } = useLocale();
  return (iso) => formatDateTime(iso, locale, { dateStyle: 'long', timeStyle: undefined, timeZone: 'UTC' });
}

const Withdrawal: React.FC = () => {
  const t = useT();
  const day = useDay();
  const queryClient = useQueryClient();
  const [asking, setAsking] = React.useState(false);
  const [done, setDone] = React.useState<{ withdrawn: Withdrawn; email: string } | null>(null);
  const { data: state } = useQuery({ queryKey: QUERY_KEY, queryFn: () => billingApi.getWithdrawal() });

  const withdraw = useMutation({
    mutationFn: (statement: { name: string; confirmTo: string }) => billingApi.withdraw(statement),
    onSuccess: (withdrawn, statement) => {
      setAsking(false);
      setDone({ withdrawn, email: statement.confirmTo });
      // Free from this moment: the tier, the pace, the data ceiling, the picks
      // and the invoices (a credit note for each) all read again.
      for (const key of ['billing-usage', 'billing-ceiling', 'billing-pick', 'billing-invoices']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  if (done) {
    const said = { date: day(done.withdrawn.withdrawnAt), email: done.email };
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6" role="status">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('billing.withdrawal.title')}</h2>
        <p className="text-gray-900">
          {done.withdrawn.confirmation === 'sent'
            ? t('billing.withdrawal.done', said)
            : t('billing.withdrawal.doneNotSent', said)}
        </p>
      </div>
    );
  }
  if (!state?.open || !state.tier || !state.since || !state.until) return null;

  // `until` is the first moment it is too late: the last day is the one before.
  const lastDay = day(new Date(Date.parse(state.until) - 1).toISOString());
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('billing.withdrawal.title')}</h2>
      <p className="text-gray-700">{t('billing.withdrawal.lead', { tier: state.tier.name, lastDay })}</p>
      {asking ? (
        <Statement
          state={state}
          since={day(state.since)}
          pending={withdraw.isPending}
          onConfirm={(statement) => withdraw.mutate(statement)}
          onNotNow={() => {
            withdraw.reset();
            setAsking(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="mt-4 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium text-gray-900"
        >
          {t('billing.withdrawal.button')}
        </button>
      )}
      {withdraw.isError && (
        <div className="mt-4 flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>
            <span className="font-medium">{t('billing.withdrawal.failed')}</span> {serverMessage(withdraw.error)}
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * The second step: what the consumer gives or confirms (article 11a(2)), the
 * name and the address filled in from what the app knows, and the contract
 * said, not asked. It takes the focus when it opens.
 */
const Statement: React.FC<{
  state: WithdrawalState;
  since: string;
  pending: boolean;
  onConfirm: (statement: { name: string; confirmTo: string }) => void;
  onNotNow: () => void;
}> = ({ state, since, pending, onConfirm, onNotNow }) => {
  const t = useT();
  const box = React.useRef<HTMLFormElement>(null);
  const [name, setName] = React.useState(state.name ?? '');
  const [confirmTo, setConfirmTo] = React.useState(state.confirmTo ?? '');
  React.useEffect(() => box.current?.focus(), []);
  return (
    <form
      ref={box}
      tabIndex={-1}
      aria-label={t('billing.withdrawal.title')}
      className="mt-4 p-4 rounded-lg bg-blue-50 space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm({ name: name.trim(), confirmTo: confirmTo.trim() });
      }}
    >
      <p className="text-gray-900">{t('billing.withdrawal.check')}</p>
      <label className="block">
        <span className="block text-sm font-medium text-gray-700">{t('billing.withdrawal.name')}</span>
        <input
          type="text"
          required
          maxLength={200}
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
        />
      </label>
      <div>
        <span className="block text-sm font-medium text-gray-700">{t('billing.withdrawal.contract')}</span>
        <p className="mt-1 text-gray-900">{t('billing.withdrawal.contractValue', { tier: state.tier?.name ?? '', since })}</p>
      </div>
      <label className="block">
        <span className="block text-sm font-medium text-gray-700">{t('billing.withdrawal.confirmTo')}</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={confirmTo}
          onChange={(event) => setConfirmTo(event.target.value)}
          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {pending && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('billing.withdrawal.confirm')}
        </button>
        <button
          type="button"
          onClick={onNotNow}
          disabled={pending}
          className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {t('billing.withdrawal.notNow')}
        </button>
      </div>
    </form>
  );
};

export default Withdrawal;
