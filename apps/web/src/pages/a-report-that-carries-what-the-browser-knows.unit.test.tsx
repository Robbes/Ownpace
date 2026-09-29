// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REPORT THAT CARRIES WHAT THE BROWSER KNOWS (workplan 0130 T6, Part B; the
 * owner's "Both parts", 2026-09-28).
 *
 * A "Something went wrong" answers with a reference, inside its sentence, and
 * the person had to copy it into the report by hand. The web app now keeps the
 * reference and the code of each fault it meets, the newest three, in memory,
 * and the report form offers those from the five minutes before it was
 * opened. Kept is ONLY those two words: the request that met the fault carries
 * the sign-in token in its headers, and its address can carry a query, and
 * axios hands both over with the error. So a canary token planted in a failed
 * request's headers, address, parameters and body, and in the answer's other
 * fields and headers, must reach neither what the form sends, nor its fold.
 * Signing out forgets them all.
 *
 * With them the form sends, as one small object the server checks again
 * (`apps/api/src/a-report-that-carries-what-the-browser-knows.unit.test.ts`):
 * the screen's language, the time zone, the window's width, this page's build,
 * and the data type, side and migration of the failure line the form was
 * opened from, which that line now passes in the address: on the progress
 * strip, on Connections, and on the failure queue's items and groups, each
 * rendered here as its screen draws it. The fold shows them
 * among the service's lines, and when those cannot be had, in the reader's
 * own language.
 *
 * Every request goes through the app's real axios clients and interceptors,
 * answered by a stand-in for the network.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { FailuresResponse, ItemFailure } from '@openmig/shared';
import { useAuthStore } from '../stores/auth-store.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import apiClient from '../services/api.ts';
import { fetchAttention } from '../services/operating-service.ts';
import type { ConnectionSummary } from '../services/mapping-service.ts';
import { RECENT_ERROR_MS, RECENT_ERRORS_KEPT, __keptForTests, recentErrors } from '../services/recent-errors.ts';
import LiveProgress, { type LiveProgressRow } from '../components/LiveProgress.tsx';
import { SendItToUs } from '../components/SendItToUs.tsx';
import Connections from './Connections.tsx';
import Failures from './Failures.tsx';
import ReportProblem from './ReportProblem.tsx';

const EN = STRINGS.en;
const NL = STRINGS.nl;

/** The network, as this file answers it; every axios client the app makes uses it. */
const network = vi.hoisted(() => ({
  handle: (_config: unknown): Promise<unknown> => Promise.reject(new Error('no network in this test')),
}));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  actual.default.defaults.adapter = (config) => network.handle(config) as never;
  return actual;
});

/** What must never reach a report: a sign-in token, where a failed request carries one. */
const CANARY = 'canary-token-5b9e31';
const MIGRATION = '0130b0b0-e29b-41d4-a716-446655440015';
/** The sentence `serverFault` answers with, in the API. */
const faultSaying = (reference: string, doing = 'listing your migrations') =>
  `Something went wrong ${doing} — this is a fault on our side, not something your input caused. ` +
  `Reference ${reference}; quoting it finds the detail in the server log.`;

interface Fault {
  readonly status: number;
  readonly data?: unknown;
}

let fault: Fault | 'network' = { status: 500, data: { error: 'list_failed', reason: faultSaying('1a2b3c4d') } };
let previewFails = false;
const previews: Array<Record<string, string>> = [];
const reports: Array<Record<string, unknown>> = [];
/** What a screen reads to draw its failure lines, by address, as the server would answer it. */
const pages = new Map<string, unknown>();

/** An answer as axios's own adapters give it: a rejection with the response from 400 up. */
function answer(config: InternalAxiosRequestConfig, status: number, data: unknown, headers: Record<string, string> = {}) {
  const response = { data, status, statusText: String(status), headers, config, request: {} };
  if (status < 400) return response;
  throw new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    {},
    response as never,
  );
}

network.handle = async (raw) => {
  const config = raw as InternalAxiosRequestConfig;
  const url = config.url ?? '';
  if (url === '/problem-reports/available') return answer(config, 200, { available: true });
  if (url === '/problem-reports/preview') {
    const params = config.params as Record<string, string>;
    previews.push(params);
    if (previewFails) throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {});
    // What the service would write of what it was asked, word for word.
    return answer(config, 200, {
      to: { kind: 'mail' },
      lines: [`Page: ${params.page}`, `Asked with: ${params.browser ?? 'nothing'}`],
    });
  }
  if (url === '/problem-reports' && config.method === 'post') {
    reports.push(JSON.parse(String(config.data)) as Record<string, unknown>);
    return answer(config, 201, { reference: '9f8e7d6c' });
  }
  if (url.startsWith('/mappings') || url.startsWith('/attention')) {
    if (fault === 'network') throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {});
    return answer(config, fault.status, fault.data, { 'x-canary': CANARY });
  }
  if ((config.method ?? 'get') === 'get' && pages.has(url)) return answer(config, 200, pages.get(url));
  throw new Error(`an unexpected ${config.method ?? 'get'} ${url}`);
};

/**
 * A request that fails as a screen's would, with the canary everywhere a
 * request and its answer can hold it: the sign-in token the interceptor adds,
 * a header, the address's query, the parameters, the body, and the answer's
 * other fields and headers.
 */
async function meetAFault(reference = '1a2b3c4d', code = 'list_failed', status = 500): Promise<void> {
  globalThis.localStorage.setItem('auth_token', CANARY);
  fault = { status, data: { error: code, reason: faultSaying(reference), detail: `Bearer ${CANARY}` } };
  await expect(
    apiClient.post(`/mappings?token=${CANARY}`, { secret: CANARY }, { params: { token: CANARY }, headers: { 'X-Canary': CANARY } }),
  ).rejects.toBeInstanceOf(AxiosError);
}

const renderForm = (path = '/report?from=%2Fmoves', locale: 'en' | 'nl' = 'en') => {
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

/** Write, send, and answer the body the report went with. */
async function send(L: typeof EN = EN): Promise<Record<string, unknown>> {
  await userEvent.type(await screen.findByLabelText(L['report.description']), 'It stopped');
  await userEvent.click(screen.getByRole('button', { name: L['report.send'] }));
  await waitFor(() => expect(reports).toHaveLength(1));
  return reports[0]!;
}

/** The facts the preview was asked with, as the object they were written from. */
async function askedWith(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(previews.length).toBeGreaterThan(0));
  return JSON.parse(previews[0]!.browser!) as Record<string, unknown>;
}

async function openFold(L: typeof EN) {
  const summary = await screen.findByText(L['report.facts']);
  await userEvent.click(summary);
  return summary.closest('details')!;
}

beforeEach(() => {
  globalThis.localStorage.clear();
  previews.length = 0;
  reports.length = 0;
  pages.clear();
  previewFails = false;
  fault = { status: 500, data: { error: 'list_failed', reason: faultSaying('1a2b3c4d') } };
  // A new session each time: signing in forgets the last one's errors.
  useAuthStore.getState().login('token', { id: 'u1', email: 'someone@example.invalid', name: 'Someone', role: 'owner' }, 't1');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the errors this browser remembers', () => {
  it('keeps the reference and the code of a fault, and nothing of the request that met it', async () => {
    await meetAFault();
    expect(recentErrors()).toEqual([{ reference: '1a2b3c4d', code: 'list_failed' }]);
    expect(JSON.stringify(recentErrors())).not.toContain(CANARY);
    // And what the ring itself holds, not only what it hands out: the two
    // words and when, and nothing that could carry the token.
    const held = __keptForTests();
    expect(held.map((entry) => Object.keys(entry).sort())).toEqual([['at', 'code', 'reference']]);
    expect(JSON.stringify(held)).not.toContain(CANARY);
  });

  it('keeps a fault the operating screens met too', async () => {
    fault = { status: 500, data: { error: 'attention_failed', reason: faultSaying('0d0e0f0a', 'reading what waits') } };
    await expect(fetchAttention()).rejects.toBeInstanceOf(AxiosError);
    expect(recentErrors()).toEqual([{ reference: '0d0e0f0a', code: 'attention_failed' }]);
  });

  it('keeps nothing of a refusal, a fault without a reference, or a request that got no answer', async () => {
    await meetAFault('1a2b3c4d', 'invalid_input', 400);
    fault = { status: 500, data: { error: 'list_failed', reason: 'Internal Server Error' } };
    await expect(apiClient.get('/mappings')).rejects.toBeInstanceOf(AxiosError);
    fault = { status: 502, data: '<html>Bad Gateway, Reference 2b2b2b2b</html>' };
    await expect(apiClient.get('/mappings')).rejects.toBeInstanceOf(AxiosError);
    fault = 'network';
    await expect(apiClient.get('/mappings')).rejects.toBeInstanceOf(AxiosError);
    expect(recentErrors()).toEqual([]);
  });

  it('keeps a code it cannot read as unknown, and never the words in its place', async () => {
    await meetAFault('3c3c3c3c', `Bearer ${CANARY}`);
    expect(recentErrors()).toEqual([{ reference: '3c3c3c3c', code: 'unknown' }]);
  });

  it('keeps the newest three, newest first, each once', async () => {
    for (const reference of ['11111111', '22222222', '33333333', '33333333', '44444444']) await meetAFault(reference);
    expect(RECENT_ERRORS_KEPT).toBe(3);
    expect(recentErrors().map((e) => e.reference)).toEqual(['44444444', '33333333', '22222222']);
  });

  it('forgets them all when the person signs out, or somebody signs in', async () => {
    await meetAFault();
    useAuthStore.getState().logout();
    expect(recentErrors()).toEqual([]);
    await meetAFault();
    useAuthStore.getState().login('other', { id: 'u2', email: 'other@example.invalid', name: 'Other', role: 'owner' }, 't2');
    expect(recentErrors()).toEqual([]);
  });
});

describe("a fault's reference, offered for five minutes", () => {
  const T0 = new Date('2026-09-28T14:02:00Z').getTime();

  it('goes with a report opened within five minutes, in the preview and with the report', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await meetAFault();
    expect(RECENT_ERROR_MS).toBe(5 * 60_000);
    vi.setSystemTime(T0 + RECENT_ERROR_MS - 1_000);
    renderForm();
    expect((await askedWith()).recentErrors).toEqual([{ reference: '1a2b3c4d', code: 'list_failed' }]);
    const body = await send();
    expect((body.browser as Record<string, unknown>).recentErrors).toEqual([{ reference: '1a2b3c4d', code: 'list_failed' }]);
  });

  it('does not go with a report opened after that', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await meetAFault();
    vi.setSystemTime(T0 + RECENT_ERROR_MS + 1_000);
    renderForm();
    expect(await askedWith()).not.toHaveProperty('recentErrors');
    expect(await send()).not.toHaveProperty('browser.recentErrors');
  });
});

describe('a canary token in a failed request', () => {
  it('reaches neither the preview, nor the report, nor the fold', async () => {
    await meetAFault();
    renderForm(`/report?from=${encodeURIComponent(`/mappings/${MIGRATION}?token=${CANARY}`)}&category=unknown`);
    const fold = await openFold(EN);
    await within(fold).findByText((text) => text.startsWith('Asked with: '));
    expect(fold.textContent).toContain('1a2b3c4d');
    const body = await send();
    expect(JSON.stringify(previews)).not.toContain(CANARY);
    expect(JSON.stringify(body)).not.toContain(CANARY);
    expect(document.body.textContent).not.toContain(CANARY);
    // The reference did go, which is the point of keeping it.
    expect(JSON.stringify(body)).toContain('1a2b3c4d');
  });

  it('reaches no fold listed by the form itself, when the lines could not be had', async () => {
    await meetAFault();
    previewFails = true;
    renderForm();
    const fold = await openFold(EN);
    expect(await within(fold).findByText(EN['report.facts.unshown'])).toBeVisible();
    expect(
      within(fold).getByText(EN['report.browser.recentError'].replace('{minutes}', '5').replace('{reference}', '1a2b3c4d').replace('{code}', 'list_failed')),
    ).toBeVisible();
    expect(document.body.textContent).not.toContain(CANARY);
  });
});

describe('what the form sends of the browser', () => {
  const FROM_FAILURE =
    `/report?from=%2Fconnections&category=unknown&dataType=email&side=target&migration=${MIGRATION}`;

  it('sends the language, time zone, width and failure line, the same in the preview and the report', async () => {
    renderForm(FROM_FAILURE, 'nl');
    const asked = await askedWith();
    expect(asked).toMatchObject({
      language: 'nl',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      windowWidth: window.innerWidth,
      dataType: 'email',
      side: 'target',
      migrationId: MIGRATION,
    });
    const body = await send(NL);
    expect(body.browser).toEqual(asked);
    expect(Object.keys(asked).every((key) =>
      ['language', 'timeZone', 'windowWidth', 'appVersion', 'appCommit', 'dataType', 'side', 'migrationId', 'recentErrors'].includes(key),
    )).toBe(true);
  });

  it('drops a data type, a side or a migration in the address that is not one', async () => {
    renderForm(`/report?from=%2Fconnections&category=unknown&dataType=${CANARY}&side=left&migration=${CANARY}`);
    const asked = await askedWith();
    expect(asked).not.toHaveProperty('dataType');
    expect(asked).not.toHaveProperty('side');
    expect(asked).not.toHaveProperty('migrationId');
    expect(JSON.stringify(await send())).not.toContain(CANARY);
  });

  it.each([
    ['en', EN, 'Email', 'report.browser.side.target'],
    ['nl', NL, 'E-mail', 'report.browser.side.target'],
  ] as const)(
    'lists them in the fold in the reader\'s language, when the lines could not be had (%s)',
    async (locale, L, dataType, side) => {
      await meetAFault();
      previewFails = true;
      renderForm(FROM_FAILURE, locale);
      const fold = await openFold(L);
      await within(fold).findByText(L['report.facts.unshown']);
      const shown = [
        L['report.browser.language'],
        L['report.browser.timeZone'].replace('{timeZone}', Intl.DateTimeFormat().resolvedOptions().timeZone),
        L['report.browser.width'].replace('{width}', String(window.innerWidth)),
        L['report.browser.dataType'].replace('{dataType}', dataType),
        L[side],
        L['report.browser.migration'].replace('{migration}', MIGRATION),
        L['report.browser.recentError'].replace('{minutes}', '5').replace('{reference}', '1a2b3c4d').replace('{code}', 'list_failed'),
      ];
      for (const line of shown) expect(within(fold).getByText(line), line).toBeVisible();
    },
  );

  it('says the same things in English and Dutch', () => {
    const keys = Object.keys(EN).filter((key) => key.startsWith('report.browser.')) as Array<keyof typeof EN>;
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const key of keys) {
      const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(NL[key], key).toBeTruthy();
      expect(NL[key], key).not.toBe(EN[key]);
      expect(vars(NL[key]), key).toEqual(vars(EN[key]));
    }
    expect(EN['report.browser.language']).toMatch(/English/);
    expect(NL['report.browser.language']).toMatch(/Nederlands/);
  });
});

describe('the failure line passes what it knows', () => {
  const at = (path: string, element: React.ReactNode, route = '*') =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  const sendItToUs = () => screen.findAllByRole('link', { name: EN['failure.sendItToUs'] });
  /** Another migration, whose failure names two data types and no side. */
  const OTHER_MIGRATION = '0130b0b0-e29b-41d4-a716-446655440016';

  it('links with the data type, the side and the migration it has', async () => {
    at('/connections', <SendItToUs category="unknown" dataType="file" side="source" migrationId={MIGRATION} />);
    expect(await screen.findByRole('link', { name: EN['failure.sendItToUs'] })).toHaveAttribute(
      'href',
      `/report?from=%2Fconnections&category=unknown&dataType=file&side=source&migration=${MIGRATION}`,
    );
  });

  it("on the progress strip, the line's data type and side", async () => {
    const failed: LiveProgressRow = {
      domain: 'calendar',
      state: 'failed',
      itemsSynced: 0,
      itemsFailed: 0,
      itemsRetrying: 0,
      lastErrorCategory: 'unknown',
      failedSide: 'target',
      lastErrorReference: '0a1b2c3d',
    };
    at(`/mappings/${MIGRATION}`, <LiveProgress domains={[failed]} />);
    expect(await screen.findByRole('link', { name: EN['failure.sendItToUs'] })).toHaveAttribute(
      'href',
      `/report?from=${encodeURIComponent(`/mappings/${MIGRATION}`)}&category=unknown&reference=0a1b2c3d&dataType=calendar&side=target`,
    );
  });

  it("on Connections, a standing failure's migration, its side, and its data type when it names one", async () => {
    // The page the proposal began from: its address is `/connections`, which
    // names no migration, so without these a report said only that.
    const asOf = new Date(Date.now() - 2 * 3600_000).toISOString();
    const connection = {
      id: 'c1',
      role: 'target',
      kind: 'imap',
      displayName: 'Acme mail (target)',
      status: 'connected',
      createdAt: '2026-08-01T10:00:00Z',
      usedByMigrations: 2,
      standingFailures: [
        { mappingId: MIGRATION, mappingName: 'Acme mail', category: 'unknown', domains: ['email'], asOf, side: 'target' },
        { mappingId: OTHER_MIGRATION, mappingName: 'Acme agenda', category: 'unknown', domains: ['calendar', 'contact'], asOf, side: null },
      ],
    } satisfies ConnectionSummary;
    pages.set('/connections', { connections: [connection] });
    pages.set('/provider-clients', { google: 'connection', dropbox: 'connection', microsoft: 'connection' });
    at('/connections', <Connections />);
    expect((await sendItToUs()).map((link) => link.getAttribute('href'))).toEqual([
      `/report?from=%2Fconnections&category=unknown&dataType=email&side=target&migration=${MIGRATION}`,
      // Two data types are not one, and a side the pass did not name is not sent.
      `/report?from=%2Fconnections&category=unknown&migration=${OTHER_MIGRATION}`,
    ]);
  });

  it('on the failure queue, an item its data type, and a group its data type and migration', async () => {
    const item = (naturalKeyHash: string): ItemFailure => ({
      naturalKeyHash,
      domain: 'contact',
      collection: 'Contacts',
      lastError: 'PUT failed with status 502',
      attempts: 1,
      needsDecision: true,
      category: 'unknown',
    });
    const queue = {
      [MIGRATION]: {
        migrationStatus: 'active',
        needsDecision: [item('h1'), item('h2')],
        retrying: [],
        howToResolve: { retry: 'Try again.', accept: 'Migrate without it.', doNothing: 'It stays here.' },
      },
    } satisfies FailuresResponse;
    pages.set(`/migrations/${MIGRATION}/failures`, queue);
    const path = `/mappings/${MIGRATION}/failures`;
    at(path, <Failures />, '/mappings/:mappingId/failures');
    const links = await sendItToUs();
    const from = `/report?from=${encodeURIComponent(path)}&category=unknown`;
    const group = screen.getByText(EN['failures.group.title']).parentElement!;
    expect(within(group).getByRole('link', { name: EN['failure.sendItToUs'] })).toHaveAttribute(
      'href',
      `${from}&dataType=contact&migration=${MIGRATION}`,
    );
    const items = links.filter((link) => !group.contains(link));
    expect(items.map((link) => link.getAttribute('href'))).toEqual([`${from}&dataType=contact`, `${from}&dataType=contact`]);
  });
});
