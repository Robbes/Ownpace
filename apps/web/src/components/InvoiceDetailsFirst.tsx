// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * INVOICE DETAILS COME FIRST (workplan 0111, decision 14: "a yes or a pick
 * that leaves Free asks for them first").
 *
 * The API refuses a yes or a pick of a paid tier with 409
 * `invoice_details_first` while the organisation has given no invoice
 * details: an invoice is made out to somebody. Where a yes or a pick can be
 * refused for that (the data ceiling, *Pick a tier*, and the question at
 * *Start*), this line says why in the page's language, and links to the card
 * that asks for them, `/billing#invoice-details`. The card brings itself into
 * view (`useBroughtIntoView`), from another page and from the Billing page
 * alike.
 */
import React from 'react';
import axios from 'axios';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { useT } from '../i18n/index.tsx';

/** Where the Invoice details card is: its anchor on the Billing page. */
export const INVOICE_DETAILS_ANCHOR = 'invoice-details';

/** Whether a refused yes or pick was refused for want of invoice details. */
export function isInvoiceDetailsFirst(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const data: unknown = error.response?.data;
  return !!data && typeof data === 'object' && (data as { error?: unknown }).error === 'invoice_details_first';
}

const InvoiceDetailsFirst: React.FC = () => {
  const t = useT();
  return (
    <p className="text-red-800" role="alert">
      {t('billing.detailsFirst')}{' '}
      <Link to={`/billing#${INVOICE_DETAILS_ANCHOR}`} className="font-medium underline">
        {t('billing.detailsFirst.link')}
      </Link>
    </p>
  );
};

/**
 * The Invoice details card, brought into view when the address names it: the
 * card scrolled to the top, and focus on its heading, so a keyboard and a
 * screen reader arrive where the eye does.
 *
 * Once per arrival, keyed on the location: following the link again, on the
 * Billing page itself, is a new arrival, since the path does not change and
 * nothing remounts; scrolling away afterwards is the person's own. And only
 * once every read has settled: the cards above this one load after it is
 * drawn, and would push it back down past the place it was scrolled to.
 */
export function useBroughtIntoView(
  card: React.RefObject<HTMLElement | null>,
  heading: React.RefObject<HTMLElement | null>,
): void {
  const { hash, key } = useLocation();
  const queryClient = useQueryClient();
  const fetching = useIsFetching();
  const arrived = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (hash !== `#${INVOICE_DETAILS_ANCHOR}` || arrived.current === key) return;
    // The live count as well as the drawn one: the cards drawn with this one
    // start their reads in their own effects, after this render counted.
    if (fetching > 0 || queryClient.isFetching() > 0) return;
    arrived.current = key;
    card.current?.scrollIntoView({ block: 'start' });
    heading.current?.focus({ preventScroll: true });
  }, [hash, key, fetching, queryClient, card, heading]);
}

export default InvoiceDetailsFirst;
