// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MENU THAT GIVES FOCUS BACK (workplan 0145 T1).
 *
 * Below 1024 px the navigation is a drawer, and a closed drawer was only moved
 * off screen with `-translate-x-full`. Nothing marked it `inert`, `hidden` or
 * `aria-hidden`, and it comes before the page in the document. So a keyboard
 * tabbed through every link and button of a menu nobody could see before it
 * reached the page, and a screen reader's swipe order did the same. Opening
 * the drawer left focus on the menu button behind the backdrop, Escape did
 * nothing, and closing it left focus wherever it happened to be. Found by the
 * readiness review of 2026-09-23 (`a11ym-mobile-drawer-focus`); checked again
 * in 0145 §1.
 *
 * What now holds, with a narrow screen (a stubbed `matchMedia`):
 *
 * - closed, the drawer is `inert`, so its links leave the tab order and the
 *   screen reader's swipe order;
 * - opening it puts focus on its close button, and the page behind it is
 *   `inert`, so focus cannot wander behind the backdrop;
 * - Escape, the close button and the backdrop each close it and give focus
 *   back to the menu button that opened it;
 * - the menu button says which element it opens (`aria-controls`) and whether
 *   it is open (`aria-expanded`).
 *
 * With a wide screen the drawer is the sidebar, always on screen, and nothing
 * about it is `inert`. Which screen is narrow is decided by the same media
 * condition Tailwind puts `lg:` behind, and the last case asks the installed
 * Tailwind for it: a `(min-width: 1024px)` would disagree with the stylesheet
 * for anyone whose browser font is larger than 16 px, which is exactly the
 * reader this is for.
 *
 * jsdom implements neither `matchMedia` nor what `inert` does, so this asks
 * for the attribute and for `document.activeElement`. The real browser's half
 * is 0145 T8 (a) and the walk in T10.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { compile } from 'tailwindcss';

const { editionFlag, authState } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  authState: {
    isAuthenticated: true,
    user: { name: 'Someone', email: 'someone@example.invalid', role: 'owner' },
    logout: () => {},
    operator: false,
    tenantCount: 1,
    token: null,
  },
}));

vi.mock('../services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
  operatingBaseUrl: () => '',
}));
vi.mock('../stores/auth-store', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));
vi.mock('../services/mapping-service', () => ({
  mappingApi: { get: vi.fn(() => new Promise<never>(() => {})) },
}));

import Layout from './Layout.tsx';

/**
 * A `matchMedia` whose answer the test sets, and which tells its listeners
 * when the answer changes, as a browser does when the window is resized.
 */
const media = {
  wide: false,
  queries: [] as string[],
  listeners: new Set<() => void>(),
  resize(wide: boolean) {
    media.wide = wide;
    act(() => {
      for (const listener of media.listeners) listener();
    });
  },
};

beforeEach(() => {
  editionFlag.selfhost = false;
  media.wide = false;
  media.queries = [];
  media.listeners.clear();
  vi.stubGlobal('matchMedia', (query: string) => {
    media.queries.push(query);
    return {
      get matches() {
        return media.wide;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => media.listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        media.listeners.delete(listener),
      addListener: (listener: () => void) => media.listeners.add(listener),
      removeListener: (listener: () => void) => media.listeners.delete(listener),
      dispatchEvent: () => false,
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderLayout = (path = '/dashboard') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route path="*" element={<div>page-body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The drawer, the page behind it, and the two buttons that open and close it. */
function parts() {
  const drawer = document.querySelector('aside');
  if (!drawer) throw new Error('the layout rendered no <aside>');
  const page = screen.getByRole('main').parentElement;
  if (!page) throw new Error('<main> has no parent');
  return {
    drawer,
    page,
    menu: screen.getByRole('button', { name: 'Menu' }),
    close: screen.getByRole('button', { name: 'Close' }),
  };
}

describe('a narrow screen', () => {
  it('keeps a closed drawer out of the tab order, and the page behind it in', () => {
    renderLayout();
    const { drawer, page, menu } = parts();

    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveAttribute('inert');
    expect(page).not.toHaveAttribute('inert');
  });

  it('names the drawer the menu button opens', () => {
    renderLayout();
    const { drawer, menu } = parts();

    const id = drawer.getAttribute('id');
    expect(id).toBeTruthy();
    expect(menu).toHaveAttribute('aria-controls', id);
  });

  it('moves focus into the drawer when it opens, and makes the page behind it inert', () => {
    renderLayout();
    const { drawer, page, menu, close } = parts();

    menu.focus();
    fireEvent.click(menu);

    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(close);
    expect(drawer).not.toHaveAttribute('inert');
    expect(page).toHaveAttribute('inert');
  });

  it('closes on Escape and gives focus back to the menu button', () => {
    renderLayout();
    const { drawer, page, menu, close } = parts();

    menu.focus();
    fireEvent.click(menu);
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Escape' });

    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveAttribute('inert');
    expect(page).not.toHaveAttribute('inert');
    expect(document.activeElement).toBe(menu);
  });

  it('gives focus back to the menu button when the close button closes it', () => {
    renderLayout();
    const { drawer, menu, close } = parts();

    fireEvent.click(menu);
    fireEvent.click(close);

    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveAttribute('inert');
    expect(document.activeElement).toBe(menu);
  });

  it('gives focus back to the menu button when the backdrop closes it', () => {
    renderLayout();
    const { drawer, menu } = parts();

    fireEvent.click(menu);
    const backdrop = drawer.previousElementSibling;
    if (!backdrop) throw new Error('an open drawer rendered no backdrop');
    expect(backdrop.className).toContain('fixed inset-0');
    fireEvent.click(backdrop);

    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(menu);
  });

  it('ignores keys other than Escape', () => {
    renderLayout();
    const { menu, close } = parts();

    fireEvent.click(menu);
    fireEvent.keyDown(close, { key: 'Enter' });

    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(close);
  });

  it('closes when a link in it is followed', () => {
    renderLayout();
    const { drawer, menu } = parts();

    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('link', { name: 'Migrations' }));

    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveAttribute('inert');
  });
});

describe('a wide screen', () => {
  it('never makes the sidebar or the page inert', () => {
    media.wide = true;
    renderLayout();
    const { drawer, page, menu } = parts();

    expect(drawer).not.toHaveAttribute('inert');
    expect(page).not.toHaveAttribute('inert');

    // The menu button is hidden from 1024 px up, but it is still in the
    // document; pressing it there must not take the page away.
    fireEvent.click(menu);
    expect(drawer).not.toHaveAttribute('inert');
    expect(page).not.toHaveAttribute('inert');
  });

  it('follows the window across the breakpoint', () => {
    renderLayout();
    const { drawer, page, menu } = parts();
    expect(drawer).toHaveAttribute('inert');

    media.resize(true);
    expect(drawer).not.toHaveAttribute('inert');

    // An open drawer widened into a sidebar gives the page back, and does not
    // come back over the page when the window is narrowed again.
    media.resize(false);
    fireEvent.click(menu);
    expect(page).toHaveAttribute('inert');
    media.resize(true);
    expect(page).not.toHaveAttribute('inert');
    expect(drawer).not.toHaveAttribute('inert');
    media.resize(false);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(page).not.toHaveAttribute('inert');
    expect(drawer).toHaveAttribute('inert');
  });

  it('is decided by the media condition Tailwind puts `lg:` behind', async () => {
    renderLayout();
    const asked = new Set(media.queries);
    expect(asked.size, 'the layout asked matchMedia nothing').toBe(1);
    const [query] = [...asked];

    // Read from disk, not imported with `?raw`: vitest stubs every .css
    // import to an empty string (see a-class-tailwind-draws-nothing-for).
    const indexCss = createRequire(import.meta.url).resolve('tailwindcss/index.css');
    const content = readFileSync(indexCss, 'utf8');
    const compiler = await compile('@import "tailwindcss";', {
      loadStylesheet: async () => ({ path: indexCss, base: dirname(indexCss), content }),
    });
    const css = compiler.build(['lg:translate-x-0']);
    const lg = /@media\s+([^{]+?)\s*\{\s*\.lg\\:translate-x-0/.exec(css);
    expect(lg, 'Tailwind emitted no rule for lg:translate-x-0').not.toBeNull();

    expect(query).toBe(lg![1]);
  });
});
