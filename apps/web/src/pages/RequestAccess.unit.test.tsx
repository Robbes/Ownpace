// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The request-access form (workplan 0093 T3).
 *
 * The property worth pinning is not that the form renders — it is WHAT IT
 * SENDS. A blank optional field must not travel as an empty string: the columns
 * are nullable precisely so "left blank" and "typed nothing" stay different,
 * and a row full of `''` is one a human then has to squint at.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RequestAccess from './RequestAccess.tsx';

const postMock = vi.fn();
vi.mock('../services/api.ts', () => ({
  default: { post: (...args: unknown[]) => postMock(...args) },
}));

const renderPage = (path = '/request-access') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <RequestAccess />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue({ data: { received: true } });
});

describe('RequestAccess', () => {
  it('will not send without an email', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: /send request/i })).toBeDisabled();
  });

  it('sends only the fields that were filled in', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email address/i), 'someone@example.test');
    await user.type(screen.getByLabelText(/what are you moving/i), 'two mailboxes off Google');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [path, body] = postMock.mock.calls[0]!;
    expect(path).toBe('/access-requests');
    // The two untouched fields are ABSENT, not ''.
    expect(body).toEqual({
      email: 'someone@example.test',
      note: 'two mailboxes off Google',
      locale: 'en',
    });
  });

  it('trims what a person typed, so a stray space is not a different address', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email address/i), '  spaced@example.test  ');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![1]).toMatchObject({ email: 'spaced@example.test' });
  });

  it('carries the tier as a guess when one is picked', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email address/i), 'someone@example.test');
    await user.selectOptions(screen.getByLabelText(/which package/i), 'Medium');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![1]).toMatchObject({ tier: 'Medium' });
  });

  it("says thank you, and does NOT say whether the address was already known", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email address/i), 'someone@example.test');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    // The server answers the same way for a new address, a known one and an
    // already-granted one — any other answer is an account-enumeration oracle,
    // and that is pinned where it is decided, in the route's integration test.
    // What this screen must not do is echo the address back: a page that
    // renders "someone@example.test" is a page that confirms the address
    // reached us, which is the same signal in a friendlier font.
    await screen.findByText(/thank you/i);
    expect(document.body.textContent).not.toContain('someone@example.test');
  });

  it('arrives with the tier the pricing page linked with, already chosen', async () => {
    // The site links "Start with Medium" here. Asking the same question again
    // is how a form loses somebody.
    const user = userEvent.setup();
    renderPage('/request-access?locale=en&tier=Extra+large');

    await user.type(screen.getByLabelText(/email address/i), 'someone@example.test');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![1]).toMatchObject({ tier: 'Extra large' });
  });

  it('ignores a tier nobody offers, rather than putting a stranger text in a select', async () => {
    // The value comes out of a URL anybody can edit.
    const user = userEvent.setup();
    renderPage('/request-access?tier=<script>');

    await user.type(screen.getByLabelText(/email address/i), 'someone@example.test');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![1]).not.toHaveProperty('tier');
  });

  it("shows the server's own sentence when it refuses", async () => {
    // A 429 says how long to wait; paraphrasing it would lose that.
    postMock.mockRejectedValue(new Error('Request failed with status code 429'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email address/i), 'someone@example.test');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('429');
  });
});
