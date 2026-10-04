// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The data ceiling, said at *Start* (workplan 0109 T6; the owner, 2026-10-03:
 * *"ok, you have a go"*).
 *
 * The data already moved and what the preflight measured for the migrations
 * being started are added up; when the total passes the organisation's data
 * ceiling, the step says so, with both ways on and their prices, before the
 * press rather than at the hold. The customer may choose then, on the Billing
 * page, or start anyway and choose when new items wait.
 *
 * **It never blocks *Start*.** The hold is the safety net, and this is an
 * estimate: a data type without sizes counts as nothing, and items the
 * destination already holds count although the meter will not. So it is a
 * note beside the button, and says *about*.
 *
 * Managed only, and for owners and admins, who are the ones the ceiling is
 * read for and who can say yes (`/billing/ceiling` is theirs, like the rest of
 * billing). Anyone else, and a read that fails, sees the step as it was: the
 * hold still says it at the ceiling. During the alpha it warns all the same,
 * and says nothing waits. Rendered through `CeilingAtStartNote`, which keeps
 * it out of the appliance's bundle.
 */
import React from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '../services/billing-service.ts';
import { isSelfHost } from '../services/edition.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { useT, useFormatters } from '../i18n/index.tsx';

/** Decimal, like the published table: the meter counts bytes, the table GB. */
const BYTES_PER_GB = 1_000_000_000;

export const CeilingAtStart: React.FC<{ bytes: number }> = ({ bytes }) => {
  const t = useT();
  const { number } = useFormatters();
  const { user } = useAuthStore();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const ceiling = useQuery({
    queryKey: ['billing-ceiling'],
    queryFn: () => billingApi.getCeiling(),
    enabled: canManage && !isSelfHost(),
    retry: false,
  });
  const c = ceiling.data;
  if (!c || bytes <= 0) return null;
  const startingGb = bytes / BYTES_PER_GB;
  if (c.gbMoved + startingGb <= c.ceilingGb) return null;

  const size = (gb: number): string =>
    gb >= 1000 ? `${number(Math.round(gb / 100) / 10)} TB` : `${number(Math.round(gb * 10) / 10)} GB`;

  return (
    <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
      <p>
        {t('ceiling.atStart', { size: size(startingGb), moved: size(c.gbMoved), ceiling: size(c.ceilingGb) })}
      </p>
      {c.holds ? (
        <p>
          {t('ceiling.atStart.holds')}{' '}
          {c.moveUp &&
            t('pause.dataCeiling.moveUp', {
              tier: c.moveUp.name,
              setup: number(c.moveUp.setupEur),
              monthly: number(c.moveUp.monthlyEur),
            })}{' '}
          {c.topUp && t('pause.dataCeiling.topUp', { band: size(c.topUp.bandGb), price: number(c.topUp.priceEur) })}{' '}
          {t('ceiling.atStart.choose')}{' '}
          <Link to="/billing" className="underline font-medium">
            {t('ceiling.atStart.billing')}
          </Link>
        </p>
      ) : (
        <p>{t('ceiling.atStart.alpha')}</p>
      )}
    </div>
  );
};

export default CeilingAtStart;
