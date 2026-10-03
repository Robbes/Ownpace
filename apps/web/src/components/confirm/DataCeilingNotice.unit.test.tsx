// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What Start says first (ADR-0014, *Amendment 2026-10-03*; workplan 0109 T6):
 * past the ceiling of the tier a start lands on, both ways on, priced, beside
 * the button, and never a block. Nothing when it fits, nothing on the
 * appliance (no tiers), and nothing for a member who may not read billing; a
 * check that failed says so rather than reading as "it fits".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import DataCeilingNotice from './DataCeilingNotice.tsx';
import { fetchStartForecast } from '../../services/start-forecast.ts';
import * as edition from '../../services/edition.ts';

vi.mock('../../services/start-forecast.ts', () => ({ fetchStartForecast: vi.fn() }));

const SMALL_PAST = {
  tier: { id: 'small', name: 'Small', dataGb: 750 },
  forecastGb: 900,
  ceilingGb: 750,
  next: { id: 'medium', name: 'Medium', monthlyCents: 1200 },
  topUpCents: 500,
};

function show(ready = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DataCeilingNotice mappingIds={['m1', 'm2']} ready={ready} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchStartForecast).mockReset();
  vi.spyOn(edition, 'isSelfHost').mockReturnValue(false);
});

describe('the data ceiling, said before Start', () => {
  it('names both ways on, priced, when the start passes a paid tier’s ceiling', async () => {
    vi.mocked(fetchStartForecast).mockResolvedValue(SMALL_PAST);
    show();
    expect(await screen.findByText('This start may pass Small’s data ceiling')).toBeInTheDocument();
    expect(screen.getByText(/comes to about 900 GB, past Small’s 750 GB/)).toBeInTheDocument();
    expect(screen.getByText(/Move up to Medium: €12\.00 a month\./)).toBeInTheDocument();
    expect(screen.getByText(/Buy another 750 GB on Small: €5\.00 once\./)).toBeInTheDocument();
    expect(fetchStartForecast).toHaveBeenCalledWith(['m1', 'm2']);
  });

  it('offers Free only the move up, since Free has no top-up', async () => {
    vi.mocked(fetchStartForecast).mockResolvedValue({
      ...SMALL_PAST,
      tier: { id: 'free', name: 'Free', dataGb: 250 },
      ceilingGb: 250,
      forecastGb: 300,
      next: { id: 'small', name: 'Small', monthlyCents: 500 },
      topUpCents: null,
    });
    show();
    expect(await screen.findByText(/Move up to Small: €5\.00 a month\./)).toBeInTheDocument();
    expect(screen.queryByText(/Buy another/)).not.toBeInTheDocument();
  });

  it('says nothing when the start fits', async () => {
    vi.mocked(fetchStartForecast).mockResolvedValue(null);
    const { container } = show();
    await waitFor(() => expect(fetchStartForecast).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('waits for the counts it adds up, and asks nothing on the appliance', () => {
    show(false);
    expect(fetchStartForecast).not.toHaveBeenCalled();
    vi.spyOn(edition, 'isSelfHost').mockReturnValue(true);
    show(true);
    expect(fetchStartForecast).not.toHaveBeenCalled();
  });

  it('says nothing to a member who may not read billing, and says a failed check out loud', async () => {
    const refusal = (status: number, message: string) =>
      new AxiosError(message, String(status), undefined, undefined, {
        status,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { error: 'x', message },
      });
    vi.mocked(fetchStartForecast).mockRejectedValueOnce(refusal(403, 'Forbidden'));
    const first = show();
    await waitFor(() => expect(fetchStartForecast).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(first.container).toBeEmptyDOMElement());
    first.unmount();

    vi.mocked(fetchStartForecast).mockRejectedValueOnce(refusal(500, 'the meter could not be read'));
    show();
    expect(await screen.findByText(/Whether this start fits your tier could not be checked: the meter could not be read/)).toBeInTheDocument();
  });
});
