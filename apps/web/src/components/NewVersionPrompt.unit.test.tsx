// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A NEWER PAGE, OFFERED (workplan 0145; the owner's "build the deploy check
 * and the reload prompt", 2026-09-29).
 *
 * A tab left open across a deploy runs its old code against the new server.
 * What must hold: nothing is said while the site serves the page on screen;
 * when it serves another build, a sentence and one button say so, in the
 * reader's language; the page reloads only when the button is pressed; and the
 * site is asked again when the person comes back to the tab, every five
 * minutes, and at once after an answer the page could not read.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import NewVersionPrompt, { ASK_EVERY_MS } from './NewVersionPrompt.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import type { Locale } from '../i18n/strings.ts';
import { askServedBuild } from '../services/served-build.ts';

const PAGE = { version: '0.3.1', commit: 'aaaaaaa1111111' };

vi.mock('../services/build-identity.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/build-identity.ts')>()),
  uiBuild: () => PAGE,
}));

const EN = {
  said: 'A newer version of this page is available. Reload the page to use it; anything you have not saved yet is lost.',
  button: 'Reload the page',
};
const NL = {
  said: 'Er is een nieuwere versie van deze pagina. Laad de pagina opnieuw om die te gebruiken; wat u nog niet hebt opgeslagen, gaat daarbij verloren.',
  button: 'Pagina opnieuw laden',
};

let served: { version: string; commit: string };
const asked = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(served), { status: 200 }));

beforeEach(() => {
  served = { ...PAGE };
  asked.mockClear();
  asked.mockImplementation(async () => new Response(JSON.stringify(served), { status: 200 }));
  vi.stubGlobal('fetch', asked);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function open(locale: Locale = 'en') {
  const reload = vi.fn();
  window.localStorage.setItem('ownpace.locale', locale);
  render(
    <LocaleProvider>
      <NewVersionPrompt reload={reload} />
    </LocaleProvider>,
  );
  return reload;
}

/** A deploy happens while the tab is open. */
const deploy = () => {
  served = { version: '0.3.2', commit: 'bbbbbbb2222222' };
};

describe('a page left open across a deploy', () => {
  it('says nothing while the site serves the page on screen', async () => {
    open();
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    expect(asked).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers a reload in English, and reloads only when it is pressed', async () => {
    deploy();
    const reload = open('en');

    expect(await screen.findByText(EN.said)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: EN.button }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('offers it in Dutch', async () => {
    deploy();
    open('nl');

    expect(await screen.findByText(NL.said)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: NL.button })).toBeInTheDocument();
  });

  it('asks again when the person comes back to the tab', async () => {
    open();
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    deploy();

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText(EN.said)).toBeInTheDocument();
  });

  it('asks at once after an answer the page could not read', async () => {
    open();
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    deploy();

    act(() => askServedBuild());
    expect(await screen.findByText(EN.said)).toBeInTheDocument();
  });

  it('asks every five minutes while the tab is in front', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open();
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    deploy();

    await act(async () => {
      vi.advanceTimersByTime(ASK_EVERY_MS);
    });
    expect(await screen.findByText(EN.said)).toBeInTheDocument();
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('asks once more when told to while it is still asking, since that answer may predate the deploy', async () => {
    let release: () => void = () => {};
    asked.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response(JSON.stringify(PAGE), { status: 200 }));
        }),
    );
    open();
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    deploy();

    // The person comes back while the first question is still out.
    act(() => askServedBuild());
    await act(async () => {
      release();
    });
    expect(await screen.findByText(EN.said)).toBeInTheDocument();
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('says nothing when the site cannot say which build it serves', async () => {
    asked.mockImplementation(async () => new Response('Not found', { status: 404 }));
    open();

    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    act(() => askServedBuild());
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
