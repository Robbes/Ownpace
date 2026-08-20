// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The banner that tells an owner their notifications are off (0043 T3).
 *
 * The state it reports used to live in one `log.info` at boot. The failure it
 * prevents is not a crash: it is an owner reading silence as "nothing needs me"
 * when it means "nothing can reach me". Those look identical without this.
 */

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchStatusMock } = vi.hoisted(() => ({ fetchStatusMock: vi.fn() }));
vi.mock('../services/operating-service', () => ({ fetchStatus: fetchStatusMock }));

import { NotificationChannelBanner } from './NotificationChannelBanner.tsx';
import { LocaleProvider } from '../i18n/index.tsx';

function renderBanner() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <NotificationChannelBanner />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchStatusMock.mockReset();
});

describe('NotificationChannelBanner', () => {
  it('warns when the channel is OFF, and shows the reason VERBATIM', async () => {
    // The reason is the only actionable part: readNotifierConfig names the
    // variable somebody missed. Paraphrasing it would throw that away (rule 9).
    const reason = 'SMTP_HOST is set but NOTIFY_FROM is missing';
    fetchStatusMock.mockResolvedValue({
      status: 'ok',
      mappings: [],
      notifications: { enabled: false, reason },
    });

    renderBanner();

    expect(await screen.findByText(/notifications are off/i)).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('renders NOTHING when the channel is on', async () => {
    // "Notifications are working" is not worth a banner; only the state
    // somebody has to act on is.
    fetchStatusMock.mockResolvedValue({
      status: 'ok',
      mappings: [],
      notifications: { enabled: true },
    });

    const { container } = renderBanner();
    await vi.waitFor(() => expect(fetchStatusMock).toHaveBeenCalled());

    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING when the payload says nothing about notifications', async () => {
    // Absent is deliberately not the same as off — a banner for "nobody asked"
    // would send an owner hunting for a setting that was never in question.
    fetchStatusMock.mockResolvedValue({ status: 'ok', mappings: [] });

    const { container } = renderBanner();
    await vi.waitFor(() => expect(fetchStatusMock).toHaveBeenCalled());

    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING when the status read FAILS', async () => {
    // "We could not ask" is not "they are off". This component must not become
    // a second way to be wrong about the same question.
    fetchStatusMock.mockRejectedValue(new Error('connection refused'));

    const { container } = renderBanner();
    await vi.waitFor(() => expect(fetchStatusMock).toHaveBeenCalled());

    expect(container).toBeEmptyDOMElement();
  });
});
