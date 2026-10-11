// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE REQUEST TO BEGIN, AT THE ORDER BUTTON (workplan 0111 T7, slice 7e;
 * terms §7, 1.5).
 *
 * A consumer who withdraws within the fourteen days pays for what was already
 * provided only if they asked us to begin before the fourteen days were over;
 * without that request, they pay nothing for it (article 14(4)(a)(ii) of the
 * Consumer Rights Directive). The owner wants no tick box (2026-10-11:
 * *"everyone who agrees with the terms would normally start within 14
 * days"*), so the request is one sentence beside each order button: at the
 * data ceiling, at *Start*, and at a pick above the agreed tier. Pressing the
 * button orders, and asks.
 *
 * The sentence is there when the server says a yes given now begins within a
 * withdrawal window (`yesAsksToBegin` on `GET /billing/withdrawal`): for a
 * consumer, on Free or within the fourteen days. Not for a business, which
 * has no right of withdrawal, nor after the fourteen days. The yes sends
 * `beginNow` only when the sentence was shown, so a page that did not say it
 * asks nothing, and the days used are then not billed.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '../services/billing-service.ts';
import { useT } from '../i18n/index.tsx';

/**
 * Whether the order buttons say the sentence now: the Withdrawal card's own
 * read, shared. `enabled` false where no order is asked for (the appliance's
 * *Start* has no billing to read); until the read answers, nothing is said and
 * nothing is asked.
 */
export function useYesAsksToBegin(enabled = true): boolean {
  const { data } = useQuery({ queryKey: ['billing-withdrawal'], queryFn: () => billingApi.getWithdrawal(), enabled });
  return enabled && data?.yesAsksToBegin === true;
}

/** The sentence, beside an order button. */
export const BeginNow: React.FC = () => {
  const t = useT();
  return <p data-begin-now>{t('billing.order.beginNow')}</p>;
};
