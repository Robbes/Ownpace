// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130 T1): the form says what it will send
 * before it sends it, and sends exactly that.
 *
 * What arrives in the URL (the page, a reference, a category) is anybody's to
 * edit, so the form shows and sends the page as a report records it, without a
 * link secret or a query, and drops a reference or a category that is not one.
 * And a report that could not be delivered keeps what the person wrote, as
 * the refusal tells them it does.
 *
 * A report too large for a front on the way (the web image's nginx, a public
 * ingress, or the API's own check of the screenshot) is answered 413, in
 * HTML, plain text or JSON, and the form says what that means: the screenshot
 * is too large, send a smaller one. Before 2026-09-28 it printed "Request
 * failed with status code 413"
 * (`scripts/a-screenshot-the-front-door-lets-through.unit.test.ts`).
 *
 * And a report that got no answer in time says so in the reader's language:
 * whether it arrived is unknown. The form waits two minutes for it, not the
 * client's 30 seconds, because a report of about 7 MB is uploaded first
 * (review, 2026-09-28).
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '../stores/auth-store.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import { REPORT_TIMEOUT_MS, reportablePage, timedOut } from '../services/problem-report-service.ts';
import ReportProblem from './ReportProblem.tsx';

const EN = STRINGS.en;
const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../services/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api.ts')>();
  return {
    ...actual,
    default: {
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
    },
  };
});

/** An axios-shaped refusal, the way the real apiClient delivers one. */
const refusal = (status: number, data: unknown): AxiosError => {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, statusText: 'Bad Gateway', headers: {}, config: { headers: new AxiosHeaders() }, data };
  return err;
};

const renderPage = (path: string, locale: 'en' | 'nl' = 'en') => {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  return render(
    <LocaleProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <ReportProblem />
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
};

beforeEach(() => {
  globalThis.localStorage.clear();
  getMock.mockReset();
  postMock.mockReset();
  getMock.mockResolvedValue({ data: { available: true } });
  postMock.mockResolvedValue({ data: { ticket: '31001' } });
  useAuthStore.setState({
    user: { id: 'u1', email: 'someone@example.invalid', name: 'Someone', role: 'owner' },
  });
});

describe('the page a report records', () => {
  it('keeps no link secret and no query', () => {
    expect(reportablePage('/grant/abc.secret/google')).toBe('/grant/:link/google');
    expect(reportablePage('/view/abc.secret')).toBe('/view/:link');
    expect(reportablePage('/mappings/1/failures?code=x')).toBe('/mappings/1/failures?...');
    expect(reportablePage('/mappings/1/failures')).toBe('/mappings/1/failures');
  });
});

describe('Report a problem', () => {
  it('says what goes with the report, and where the reply goes, before it is sent', async () => {
    renderPage('/report?from=%2Fgrant%2Fabc.secret%2Fgoogle&reference=0a1b2c3d&category=unknown');

    // In the fold above Send (workplan 0130 T6); with no lines from the
    // service, what the form itself knows.
    await userEvent.click(await screen.findByText(EN['report.facts']));
    expect(screen.getByText(EN['report.page'].replace('{page}', '/grant/:link/google'))).toBeVisible();
    expect(screen.getByText(EN['report.reference'].replace('{reference}', '0a1b2c3d'))).toBeVisible();
    expect(screen.getByText(EN['report.category'].replace('{category}', 'unknown'))).toBeVisible();
    expect(screen.getByText(EN['report.replyTo'].replace('{email}', 'someone@example.invalid'))).toBeVisible();
    expect(document.body.textContent).not.toContain('abc.secret');
  });

  it('drops a reference or a category that is not one', async () => {
    renderPage('/report?from=%2F&reference=not-a-ref&category=it%20broke');

    await screen.findByText(EN['report.facts']);
    expect(document.body.textContent).not.toContain('not-a-ref');
    expect(document.body.textContent).not.toContain('it broke');
  });

  it('sends what it said, and answers with the ticket number', async () => {
    renderPage('/report?from=%2Fgrant%2Fabc.secret%2Fgoogle&reference=0a1b2c3d');
    await userEvent.type(await screen.findByLabelText(EN['report.description']), 'The Moves screen is empty');
    await userEvent.click(screen.getByRole('button', { name: EN['report.send'] }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith(
      '/problem-reports',
      {
        description: 'The Moves screen is empty',
        page: '/grant/:link/google',
        reference: '0a1b2c3d',
        // And what the browser says of itself (0130 T6, Part B), which
        // `a-report-that-carries-what-the-browser-knows` holds.
        browser: expect.objectContaining({ language: 'en' }) as unknown,
      },
      // Its own time, not the client's 30 seconds: a 7 MB report uploads first.
      { timeout: REPORT_TIMEOUT_MS },
    );
    expect(
      await screen.findByText(
        EN['report.sent'].replace('{ticket}', '31001').replace('{email}', 'someone@example.invalid'),
      ),
    ).toBeVisible();
  });

  it('keeps what the person wrote when the report could not be delivered, and sends it again', async () => {
    const said =
      'Your report could not be delivered just now. What you wrote is still in the form: ' +
      'try again in a moment. Reference 0a1b2c3d.';
    postMock.mockRejectedValueOnce(refusal(502, { error: 'report_not_delivered', reason: said }));
    renderPage('/report?from=%2F');
    const description = await screen.findByLabelText(EN['report.description']);
    await userEvent.type(description, 'The Moves screen is empty');
    await userEvent.click(screen.getByRole('button', { name: EN['report.send'] }));

    expect(await screen.findByText(said)).toBeVisible();
    expect(description).toHaveValue('The Moves screen is empty');

    await userEvent.click(screen.getByRole('button', { name: EN['report.send'] }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect(postMock).toHaveBeenLastCalledWith(
      '/problem-reports',
      { description: 'The Moves screen is empty', page: '/', browser: expect.objectContaining({ language: 'en' }) as unknown },
      { timeout: REPORT_TIMEOUT_MS },
    );
    expect(
      await screen.findByText(
        EN['report.sent'].replace('{ticket}', '31001').replace('{email}', 'someone@example.invalid'),
      ),
    ).toBeVisible();
  });

  it('refuses a screenshot that is not a PNG or a JPEG, before anything is sent', async () => {
    renderPage('/report?from=%2F');
    const input = (await screen.findByLabelText(EN['report.screenshot'])) as HTMLInputElement;
    await userEvent.upload(input, new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }), {
      applyAccept: false,
    });

    expect(await screen.findByText(EN['report.screenshotType'])).toBeVisible();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('says so when the service takes no reports', async () => {
    getMock.mockResolvedValue({ data: { available: false } });
    renderPage('/report?from=%2F');

    expect(await screen.findByText(EN['report.unavailable'])).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['report.send'] })).toBeNull();
  });
});

describe('a report too large for a front on the way', () => {
  /** A PNG by its first bytes, so the form takes it. */
  const png = () =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], 'screen.png', {
      type: 'image/png',
    });
  const NGINX_413 =
    '<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n' +
    '<center><h1>413 Request Entity Too Large</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';
  const API_413 = { error: 'invalid_report', field: 'screenshot', reason: 'A screenshot may be at most 5 MB.' };
  const fronts: ReadonlyArray<readonly [string, 'en' | 'nl', unknown]> = [
    ["the web image's nginx, in HTML", 'en', NGINX_413],
    ['a public ingress, in plain text', 'nl', 'Request Entity Too Large'],
    ['the API, in JSON', 'nl', API_413],
  ];

  it.each(fronts)(
    'says the screenshot is too large to send when %s answers 413 (%s)',
    async (_front, locale, body) => {
      const L = STRINGS[locale];
      postMock.mockRejectedValueOnce(refusal(413, body));
      renderPage('/report?from=%2F', locale);
      const description = await screen.findByLabelText(L['report.description']);
      await userEvent.type(description, 'The Moves screen is empty');
      await userEvent.upload(screen.getByLabelText(L['report.screenshot']), png());
      await userEvent.click(screen.getByRole('button', { name: L['report.send'] }));

      expect(await screen.findByRole('alert')).toHaveTextContent(L['report.tooLarge']);
      expect(postMock).toHaveBeenCalledWith(
        '/problem-reports',
        expect.objectContaining({ screenshot: { data: expect.any(String) as unknown } }),
        { timeout: REPORT_TIMEOUT_MS },
      );
      // Not the transport's words, and not the front's own page or sentence.
      expect(document.body.textContent).not.toContain('413');
      expect(document.body.textContent).not.toContain(API_413.reason);
      // What the person wrote stays, so they only choose a smaller picture.
      expect(description).toHaveValue('The Moves screen is empty');
    },
  );

  it('is a Dutch sentence in Dutch, not the English one again', () => {
    expect(STRINGS.nl['report.tooLarge']).not.toBe(STRINGS.en['report.tooLarge']);
    expect(STRINGS.nl['report.tooLarge']).toMatch(/^De schermafbeelding is te groot/);
  });
});

describe('a report that no answer came back for', () => {
  it('waits two minutes, long enough to upload the largest report on a slow line', () => {
    // About 7 MB at 0.6 Mbit/s is a minute and a half, and the API may spend
    // 20 seconds more handing it to the helpdesk.
    expect(REPORT_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
  });

  it.each(['en', 'nl'] as const)(
    'says whether it arrived is unknown, in the reader’s language, not in axios’s (%s)',
    async (locale) => {
      const L = STRINGS[locale];
      postMock.mockRejectedValueOnce(
        new AxiosError(`timeout of ${REPORT_TIMEOUT_MS}ms exceeded`, AxiosError.ECONNABORTED),
      );
      renderPage('/report?from=%2F', locale);
      const description = await screen.findByLabelText(L['report.description']);
      await userEvent.type(description, 'The Moves screen is empty');
      await userEvent.click(screen.getByRole('button', { name: L['report.send'] }));

      const said = L['report.timedOut'].replace('{minutes}', String(REPORT_TIMEOUT_MS / 60_000));
      expect(await screen.findByRole('alert')).toHaveTextContent(said);
      expect(document.body.textContent).not.toContain('exceeded');
      expect(description).toHaveValue('The Moves screen is empty');
    },
  );

  it('is a Dutch sentence in Dutch, not the English one again', () => {
    expect(STRINGS.nl['report.timedOut']).not.toBe(STRINGS.en['report.timedOut']);
    expect(STRINGS.nl['report.timedOut']).toMatch(/^Binnen \{minutes\} minuten kwam er geen antwoord/);
  });

  it('is a timeout only: a refusal, or a connection that dropped, is not one', () => {
    expect(timedOut(new AxiosError('timeout of 1ms exceeded', AxiosError.ETIMEDOUT))).toBe(true);
    expect(timedOut(new AxiosError('Network Error', AxiosError.ERR_NETWORK))).toBe(false);
    expect(timedOut(refusal(502, { error: 'report_not_delivered' }))).toBe(false);
    expect(timedOut(new Error('timeout'))).toBe(false);
  });
});
