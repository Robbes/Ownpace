// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REPORT THAT SAYS WHAT IT SENDS (workplan 0130 T6, Part A; the owner's
 * "Both parts", 2026-09-28).
 *
 * The form said it sent the page, the reference and the category, and that
 * replies went to the person's address. The mail also carried the
 * organisation's id and the build, and said nothing of where it went but
 * "us". Now the server adds the facts it holds, and the form shows every line
 * the report will carry before it is sent: under *What we send with this* /
 * *Wat we meesturen*, a fold above Send, the lines exactly as the support team
 * reads them, from the same function that writes them into the mail
 * (`apps/api/src/a-report-that-says-what-it-sends.unit.test.ts` holds the two
 * to one another). And above Send, where the report goes: the support team,
 * by email to the address the service is set up with, or its helpdesk.
 *
 * When the lines cannot be had, the fold still lists what the form itself
 * knows, and says the rest is read on sending and goes with the report.
 *
 * The link form, for somebody without an account, now says what it already
 * sends: the organisation, the migration, the two accounts and who made the
 * link. Nothing new goes with it.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '../stores/auth-store.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import ReportProblem from './ReportProblem.tsx';

const EN = STRINGS.en;
const NL = STRINGS.nl;
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

const MAPPING = '0130fac7-e29b-41d4-a716-446655440015';
/** What the service answers for the lines: the mail's facts, as the API writes them. */
const LINES = [
  `Page: /mappings/${MAPPING}/failures`,
  'Reference: a1b2c3d4',
  'Category: auth_expired',
  'Organisation: 0130fac7-e29b-41d4-a716-446655440001',
  'Build: v0.1.0 · a1b2c3d',
  'Role: admin',
  'Organisation status: active',
  `Migration: ${MAPPING}, active`,
  'Grant: given',
  'Grant link: live',
  'Data type email: failed, auth_expired, source side, reference a1b2c3d4',
  'Source account: gmail, connected',
  'Destination account: nextcloud, error',
  `Reference match: the current failure of email on migration ${MAPPING}`,
  'Service hold: off',
  'Scheduler: running',
  'Browser: Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
];
const BY_MAIL = { to: { kind: 'mail', addresses: ['support@ownpace.eu'] }, lines: LINES };
const ON_HELPDESK = { to: { kind: 'helpdesk' }, lines: LINES };

/** The API, as the form asks it: whether it takes reports, and the lines a report would carry. */
function answers(preview: unknown | Error) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/problem-reports/available') return { data: { available: true } };
    if (url === '/problem-reports/preview') {
      if (preview instanceof Error) throw preview;
      return { data: preview };
    }
    throw new Error(`an unexpected GET ${url}`);
  });
}

const FROM = `/report?from=${encodeURIComponent(`/mappings/${MAPPING}/failures`)}&reference=a1b2c3d4&category=auth_expired`;

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

/** The fold, found by its summary, and opened. */
async function openFold(L: typeof EN) {
  const summary = await screen.findByText(L['report.facts']);
  const fold = summary.closest('details')!;
  expect(fold, 'what is sent is not a fold').not.toBeNull();
  expect(fold.open, 'the fold is open before anybody opened it').toBe(false);
  await userEvent.click(summary);
  expect(fold.open).toBe(true);
  return fold;
}

beforeEach(() => {
  globalThis.localStorage.clear();
  getMock.mockReset();
  postMock.mockReset();
  postMock.mockResolvedValue({ data: { reference: '9f8e7d6c' } });
  useAuthStore.setState({
    user: { id: 'u1', email: 'someone@example.invalid', name: 'Someone', role: 'owner' },
  });
});

describe('what we send with this', () => {
  it.each([
    ['en', EN],
    ['nl', NL],
  ] as const)('lists every line the report will carry, exactly as the service will send it (%s)', async (locale, L) => {
    answers(BY_MAIL);
    renderPage(FROM, locale);
    const fold = await openFold(L);
    const items = await within(fold).findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(LINES);
    for (const item of items) expect(item).toBeVisible();
    // What the person adds is named too: their words and a screenshot.
    expect(within(fold).getByText(L['report.facts.more'])).toBeVisible();
  });

  it('asks the service for the lines of the page it came from, with its reference and category', async () => {
    answers(BY_MAIL);
    renderPage(FROM);
    await screen.findByText(EN['report.facts']);
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith('/problem-reports/preview', {
        params: { page: `/mappings/${MAPPING}/failures`, reference: 'a1b2c3d4', category: 'auth_expired' },
      }),
    );
  });

  it('sits above Send, closed until it is opened', async () => {
    answers(BY_MAIL);
    renderPage(FROM);
    const summary = await screen.findByText(EN['report.facts']);
    const send = screen.getByRole('button', { name: EN['report.send'] });
    expect(summary.closest('details')!.open).toBe(false);
    expect(summary.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('still lists what the form itself knows when the lines could not be had, and says the rest goes with it', async () => {
    answers(new Error('Network Error'));
    renderPage(FROM);
    const fold = await openFold(EN);
    expect(await within(fold).findByText(EN['report.facts.unshown'])).toBeVisible();
    expect(within(fold).getByText(EN['report.page'].replace('{page}', `/mappings/${MAPPING}/failures`))).toBeVisible();
    expect(within(fold).getByText(EN['report.reference'].replace('{reference}', 'a1b2c3d4'))).toBeVisible();
    expect(within(fold).getByText(EN['report.category'].replace('{category}', 'auth_expired'))).toBeVisible();
  });

  it('reads an answer it does not understand as no answer', async () => {
    answers({ lines: 'Role: owner' });
    renderPage(FROM);
    const fold = await openFold(EN);
    expect(await within(fold).findByText(EN['report.facts.unshown'])).toBeVisible();
    expect(within(fold).queryByText('Role: owner')).toBeNull();
  });
});

describe('where it goes, said above Send', () => {
  it.each([
    ['en', EN],
    ['nl', NL],
  ] as const)('the support team, by email to the address the service sends to (%s)', async (locale, L) => {
    answers(BY_MAIL);
    renderPage(FROM, locale);
    expect(await screen.findByText(L['report.goesTo.mail'].replace('{address}', 'support@ownpace.eu'))).toBeVisible();
    expect(screen.getByText(L['report.replyTo'].replace('{email}', 'someone@example.invalid'))).toBeVisible();
  });

  it('every address, when it sends to several', async () => {
    answers({ ...BY_MAIL, to: { kind: 'mail', addresses: ['support@example.invalid', 'owner@example.invalid'] } });
    renderPage(FROM);
    expect(
      await screen.findByText(
        EN['report.goesTo.mail'].replace('{address}', 'support@example.invalid, owner@example.invalid'),
      ),
    ).toBeVisible();
  });

  it.each([
    ['en', EN],
    ['nl', NL],
  ] as const)('the helpdesk, when the service has one (%s)', async (locale, L) => {
    answers(ON_HELPDESK);
    renderPage(FROM, locale);
    expect(await screen.findByText(L['report.goesTo.helpdesk'])).toBeVisible();
    expect(screen.queryByText(/support@/)).toBeNull();
  });

  it('the support team, without an address, when the service did not say', async () => {
    answers(new Error('Network Error'));
    renderPage(FROM);
    expect(await screen.findByText(EN['report.goesTo'])).toBeVisible();
  });

  it('never an address it made up', () => {
    for (const L of [EN, NL]) {
      expect(L['report.goesTo']).not.toContain('@');
      expect(L['report.goesTo.helpdesk']).not.toContain('@');
      expect(L['report.goesTo.mail']).toContain('{address}');
      expect(L['report.goesTo.mail']).not.toContain('@');
    }
  });

  it('sends what it sent before, and nothing the fold showed', async () => {
    answers(BY_MAIL);
    renderPage(FROM);
    await userEvent.type(await screen.findByLabelText(EN['report.description']), 'It stopped');
    await screen.findAllByText(LINES[0]!);
    await userEvent.click(screen.getByRole('button', { name: EN['report.send'] }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![1]).toEqual({
      description: 'It stopped',
      page: `/mappings/${MAPPING}/failures`,
      reference: 'a1b2c3d4',
      category: 'auth_expired',
    });
  });
});

describe('the link form says what it already sends', () => {
  it.each([
    ['en', EN, ['organisation', 'migration', 'account', 'made the link', 'access']],
    ['nl', NL, ['organisatie', 'migratie', 'account', 'link heeft gemaakt', 'toegang']],
  ] as const)('the organisation, the migration, the two accounts and who made the link (%s)', (_locale, L, words) => {
    for (const word of words) expect(L['linkReport.sentWith']).toContain(word);
  });
});
