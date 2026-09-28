// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REPORT THAT REACHES SUPPORT BY MAIL (workplan 0130; the owner, for the
 * alpha, 2026-09-28): what the person is told once it is sent.
 *
 * A service with no Zammad sends a report as one mail to its support mailbox.
 * There is then no ticket, so no ticket number: the answer is the report's own
 * reference, which its mail carries too, and a sentence that it went to
 * support and that the reply comes by email. In English and in Dutch, and with
 * no word for a ticket where there is none. Where a Zammad answers, its
 * sentence and number stay as they were.
 *
 * Named a REPORT reference (*meldingskenmerk*), never a bare reference: the
 * form already listed the error's reference, an app event's that the Log page
 * finds, in the same eight-character shape, and this one the Log page does
 * not find. A tester quoting "reference 9f8e7d6c" must not send the owner to
 * the wrong place.
 *
 * Both forms: "Report a problem", and "Report this link" on a page a link
 * opens, with and without the address the reporter may leave. Each through its
 * real service, with only the HTTP client replaced, so the answer is read the
 * way the server sends it.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import ReportProblem from './ReportProblem.tsx';
import ReportThisLink from '../components/ReportThisLink.tsx';

const { getMock, postMock, linkGetMock, linkPostMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  linkGetMock: vi.fn(),
  linkPostMock: vi.fn(),
}));

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
vi.mock('../services/link-client.ts', () => ({ linkClient: { get: linkGetMock, post: linkPostMock } }));

const REFERENCE = '9f8e7d6c';

/** What the mail path answers, and what a Zammad answers. */
const BY_MAIL = { data: { reference: REFERENCE } };
const BY_TICKET = { data: { ticket: '31001' } };

const withProviders = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <LocaleProvider>
        <MemoryRouter initialEntries={['/report?from=%2Fmoves']}>{ui}</MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('ownpace.locale', 'en');
  getMock.mockResolvedValue({ data: { available: true } });
  linkGetMock.mockResolvedValue({ data: { available: true } });
  useAuthStore.setState({
    user: { id: 'u1', email: 'someone@example.invalid', name: 'Someone', role: 'owner' },
  });
});

/** Send "Report a problem" and answer with `answer`; the sentence the page then says. */
async function sendReport(answer: unknown): Promise<string> {
  postMock.mockResolvedValue(answer);
  withProviders(<ReportProblem />);
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox'), 'The Moves screen is empty');
  await user.click(screen.getByRole('button', { name: /Send the report|Melding versturen/ }));
  await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
  return (await screen.findByRole('status')).textContent ?? '';
}

describe('Report a problem, sent by mail', () => {
  it('answers with the reference, says it went to support and that the reply comes by email', async () => {
    const said = await sendReport(BY_MAIL);
    expect(said).toBe(
      fill(STRINGS.en['report.sent.mail'], { reference: REFERENCE, email: 'someone@example.invalid' }),
    );
    expect(said).toBe(
      `Sent to our support team, with report reference ${REFERENCE}. We will reply by email to someone@example.invalid.`,
    );
    expect(said).not.toMatch(/ticket|number/i);
    // Not a bare "reference", which the form's own list uses for the error's.
    expect(said).not.toMatch(/with reference/i);
  });

  it('says the same in Dutch, in the u-form', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    const said = await sendReport(BY_MAIL);
    expect(said).toBe(
      `Verstuurd naar ons supportteam, met meldingskenmerk ${REFERENCE}. We antwoorden per e-mail naar someone@example.invalid.`,
    );
    expect(said).toBe(
      fill(STRINGS.nl['report.sent.mail'], { reference: REFERENCE, email: 'someone@example.invalid' }),
    );
    expect(said).not.toMatch(/ticket|nummer|referentie|\bje\b|\bjouw\b/i);
  });

  it("keeps Zammad's sentence and number when a Zammad answered", async () => {
    const said = await sendReport(BY_TICKET);
    expect(said).toBe(fill(STRINGS.en['report.sent'], { ticket: '31001', email: 'someone@example.invalid' }));
    expect(said).not.toContain('support team');
  });
});

/** Send "Report this link", with an address or without, and answer with `answer`. */
async function sendLinkReport(answer: unknown, replyTo: string): Promise<string> {
  linkPostMock.mockResolvedValue(answer);
  withProviders(<ReportThisLink kind="grant" link="abc.def" organisation="Acme Legal" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Report this link|Deze link melden/ }));
  const [description, address] = screen.getAllByRole('textbox');
  await user.type(description!, 'I do not know them.');
  if (replyTo !== '') await user.type(address!, replyTo);
  await user.click(screen.getByRole('button', { name: /Send the report|Melding versturen/ }));
  await waitFor(() => expect(linkPostMock).toHaveBeenCalledTimes(1));
  return (await screen.findByRole('status')).textContent ?? '';
}

describe('Report this link, sent by mail', () => {
  it('answers with the reference, and the reply by email to the address left', async () => {
    const said = await sendLinkReport(BY_MAIL, 'reporter@example.invalid');
    expect(said).toBe(
      `Sent to our support team, with report reference ${REFERENCE}. We will reply by email to reporter@example.invalid.`,
    );
    expect(said).not.toMatch(/ticket|number/i);
  });

  it('says nobody can answer when no address was left', async () => {
    const said = await sendLinkReport(BY_MAIL, '');
    expect(said).toBe(
      `Sent to our support team, with report reference ${REFERENCE}. Without an address, we cannot answer you.`,
    );
  });

  it('says both in Dutch', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    expect(await sendLinkReport(BY_MAIL, 'reporter@example.invalid')).toBe(
      `Verstuurd naar ons supportteam, met meldingskenmerk ${REFERENCE}. We antwoorden per e-mail naar reporter@example.invalid.`,
    );
  });

  it('says nobody can answer in Dutch too, with no word for a ticket', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    const said = await sendLinkReport(BY_MAIL, '');
    expect(said).toBe(
      `Verstuurd naar ons supportteam, met meldingskenmerk ${REFERENCE}. Zonder adres kunnen we u niet antwoorden.`,
    );
    expect(said).not.toMatch(/ticket|nummer|referentie/i);
  });

  it("keeps Zammad's sentence and number when a Zammad answered", async () => {
    expect(await sendLinkReport({ data: { ticket: '41001' } }, 'reporter@example.invalid')).toBe(
      'Sent. Your report is number 41001, and we will reply to reporter@example.invalid.',
    );
  });
});
