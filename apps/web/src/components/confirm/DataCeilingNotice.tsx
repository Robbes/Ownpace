// Copyright 2026 The Ownpace authors (Apache-2.0)

import React from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { fetchStartForecast } from '../../services/start-forecast.ts';
import { serverMessage } from '../../services/api.ts';
import { isSelfHost } from '../../services/edition.ts';
import { useFormatters, useT } from '../../i18n/index.tsx';

/** Decimal, as the price list writes it (1 TB = 1,000 GB, ADR-0014). */
function sizeOf(gb: number): string {
  if (gb >= 1000) return `${Math.round(gb / 100) / 10} TB`;
  return `${Math.round(gb)} GB`;
}

/**
 * THE PREFLIGHT SAYS IT FIRST (ADR-0014, *Amendment 2026-10-03*; workplan
 * 0109 T6). At the data ceiling new first copies hold until the customer
 * chooses between moving up and a one-off top-up. Start adds what has already
 * been moved to what the count above measured, and when that passes the
 * ceiling it names both ways on, here, beside the button.
 *
 * NEVER A BLOCK: the forecast is an estimate, so this is a note and Start
 * stays as it was. Managed only, because the self-hosted edition has no
 * tiers. Asked once every count it adds up has landed, since an earlier answer
 * would add up a table that is still filling.
 *
 * A 403 is somebody who may not read the organisation's billing, and for them
 * there is nothing to say; any other failure says so, with the server's words
 * (hard rule 9), rather than leaving the note out as if the data fitted.
 */
export const DataCeilingNotice: React.FC<{
  readonly mappingIds: ReadonlyArray<string>;
  /** Every count these migrations wait for has landed. */
  readonly ready: boolean;
}> = ({ mappingIds, ready }) => {
  const t = useT();
  const { currency } = useFormatters();
  const managed = !isSelfHost();
  const forecast = useQuery({
    queryKey: ['start-forecast', [...mappingIds].sort()],
    queryFn: () => fetchStartForecast(mappingIds),
    enabled: managed && ready && mappingIds.length > 0,
    retry: false,
  });
  if (!managed || !ready) return null;
  if (forecast.isError) {
    if (axios.isAxiosError(forecast.error) && forecast.error.response?.status === 403) return null;
    return (
      <p className="text-sm text-amber-700">
        {t('startForecast.failed')} {serverMessage(forecast.error)}
      </p>
    );
  }
  const f = forecast.data;
  if (!f) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="note">
      <p className="font-medium">{t('startForecast.title', { tier: f.tier.name })}</p>
      <p className="mt-1">
        {t('startForecast.body', {
          forecast: sizeOf(f.forecastGb),
          tier: f.tier.name,
          ceiling: sizeOf(f.ceilingGb),
        })}
      </p>
      <ul className="mt-2 list-disc pl-5">
        {f.next && (
          <li>
            {t('startForecast.moveUp', { next: f.next.name, price: currency(f.next.monthlyCents, 'EUR') })}
          </li>
        )}
        {f.topUpCents !== null && (
          <li>
            {t('startForecast.topUp', {
              ceiling: sizeOf(f.ceilingGb),
              tier: f.tier.name,
              price: currency(f.topUpCents, 'EUR'),
            })}
          </li>
        )}
      </ul>
      <p className="mt-2">{t('startForecast.anyway')}</p>
    </div>
  );
};

export default DataCeilingNotice;
