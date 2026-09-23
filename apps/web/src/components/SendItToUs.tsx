// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The way out of a failure nobody could classify (workplan 0130 T3; the
 * owner's D2: *"The 'send it to us' failure line would then link to it."*).
 *
 * The `unknown` remedy ends *"send it to us and we will look"*, and until
 * this it did not say how. This link opens the report form with the page the
 * person is on, the category, and the failure's reference when the screen has
 * one (0130 T3's first half put it on the progress strip). The form checks all
 * three again, since an address is something anybody can edit.
 *
 * Offered only where a report can reach somebody: on the managed service, when
 * it takes reports (the same question, and the same cached answer, as the
 * link beside Sign out). The appliance has no report form.
 *
 * Nothing at all outside a router and a query client, which is only ever a
 * component rendered bare in a test. The screen it sits in is complete
 * without it.
 */

import React from 'react';
import { Link, useInRouterContext, useLocation } from 'react-router';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import type { FailureCategory } from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import { isSelfHost } from '../services/edition.ts';
import { fetchReportingAvailable } from '../services/problem-report-service.ts';
import { useAuthStore } from '../stores/auth-store.ts';

interface Props {
  readonly category: FailureCategory;
  /** The reference the failure was recorded under, when this screen has it. */
  readonly reference?: string;
}

/** The report form's address, with what the failure line knows. */
export function reportHref(from: string, category: FailureCategory, reference?: string): string {
  const query = new URLSearchParams({ from, category, ...(reference ? { reference } : {}) });
  return `/report?${query.toString()}`;
}

const Offered: React.FC<Props> = ({ category, reference }) => {
  const t = useT();
  const { pathname } = useLocation();
  const token = useAuthStore((s) => s.token);
  const available =
    useQuery({
      queryKey: ['problem-reports', 'available'],
      queryFn: fetchReportingAvailable,
      enabled: token != null,
      staleTime: 5 * 60_000,
    }).data === true;
  if (!available) return null;
  return (
    <Link to={reportHref(pathname, category, reference)} className="underline">
      {t('failure.sendItToUs')}
    </Link>
  );
};

export const SendItToUs: React.FC<Props> = (props) => {
  const inRouter = useInRouterContext();
  const queries = React.useContext(QueryClientContext);
  if (props.category !== 'unknown' || isSelfHost() || !inRouter || !queries) return null;
  return <Offered {...props} />;
};
