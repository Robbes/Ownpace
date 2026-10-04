// Copyright 2026 The Ownpace authors (Apache-2.0)

import { z } from 'zod';
import apiClient from './api.ts';

/*
 * ITS OWN MODULE, NOT `billing-service.ts`: the Start screens that ask it are
 * in the appliance's bundle too, and `billing-service.ts` would carry the
 * billing screen's routes into it (`appliance-bundle.unit.test.ts`, ADR-0036).
 * The appliance never asks (`DataCeilingNotice` checks the edition first).
 */

/**
 * POST /billing/start-forecast (ADR-0014, *Amendment 2026-10-03*): whether a
 * start passes the data ceiling of the tier it lands on. `forecast: null` is
 * "it fits", or past the table, where there is no published price to name.
 */
export const StartForecastSchema = z.object({
  forecast: z
    .object({
      tier: z.object({ id: z.string(), name: z.string(), dataGb: z.number() }),
      forecastGb: z.number(),
      ceilingGb: z.number(),
      next: z.object({ id: z.string(), name: z.string(), monthlyCents: z.number().int() }).nullable(),
      /** The one-off top-up for another band, in cents; null on Free, which has none. */
      topUpCents: z.number().int().nullable(),
    })
    .nullable(),
});
export type StartForecast = z.infer<typeof StartForecastSchema>['forecast'];

/** What Start says first: the data against the ceiling (ADR-0014, 2026-10-03). */
export async function fetchStartForecast(mappingIds: ReadonlyArray<string>): Promise<StartForecast> {
  const response = await apiClient.post('/billing/start-forecast', { mappingIds });
  return StartForecastSchema.parse(response.data).forecast;
}
