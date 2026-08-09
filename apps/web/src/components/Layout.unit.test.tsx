// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The sidebar stops impersonating a login, and the header says where you are
 * (0034 T2 + T3).
 *
 * Before these tests: the appliance rendered an avatar "U", "User",
 * "user@example.com" and a Sign out button — on an edition with no accounts,
 * where sign-out could only clear a store nothing reads. And per-mapping
 * routes titled themselves with the brand (selfhost) or a bare "Mappings"
 * (managed), naming no mapping.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { editionFlag, authState } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  authState: {
    isAuthenticated: true,
    user: null as null | { name: string; email: string },
    logout: () => {},
  },
}));

// VITE_EDITION is baked by vite `define`; component tests mock the module
// (the 0034 guardrail's sanctioned seam).
vi.mock('../services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
}));

vi.mock('../stores/auth-store', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

import Layout from './Layout';

const renderLayout = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route path="*" element={<div>page-body</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  editionFlag.selfhost = false;
  authState.user = null;
});

describe('the sidebar identity block (T2)', () => {
  it('selfhost: no Sign out, no placeholder identity — the language switcher stays', () => {
    editionFlag.selfhost = true;
    renderLayout('/confirm');

    expect(screen.queryByText('Sign out')).not.toBeInTheDocument();
    expect(screen.queryByText('User')).not.toBeInTheDocument();
    expect(screen.queryByText('user@example.com')).not.toBeInTheDocument();
    // The switcher is real on both editions.
    expect(screen.getByRole('button', { name: 'NL' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument();
  });

  it('managed: the signed-in claims render — never the dead fallbacks', () => {
    authState.user = { name: 'Robbe', email: 'rberentsen@snpbv.nl' };
    renderLayout('/dashboard');

    expect(screen.getByText('Robbe')).toBeInTheDocument();
    expect(screen.getByText('rberentsen@snpbv.nl')).toBeInTheDocument();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
    expect(screen.queryByText('user@example.com')).not.toBeInTheDocument();
  });

  it('managed with no claims: an absent block, not a fake identity', () => {
    renderLayout('/dashboard');

    expect(screen.queryByText('User')).not.toBeInTheDocument();
    expect(screen.queryByText('user@example.com')).not.toBeInTheDocument();
    // Sign out is still real on managed.
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });
});

describe('the header on per-mapping routes (T3)', () => {
  it('selfhost: names the screen and the mapping, links the id to the hub, lights the flat nav entry', () => {
    editionFlag.selfhost = true;
    renderLayout('/mappings/acme-mail/deletions');

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('Deletions');
    expect(heading.textContent).toContain('acme-mail');
    expect(within(heading).getByRole('link', { name: 'acme-mail' }).getAttribute('href')).toBe(
      '/mappings/acme-mail',
    );

    const nav = screen.getByRole('navigation');
    const deletionsEntry = within(nav).getByRole('link', { name: /Deletions/ });
    expect(deletionsEntry.className).toContain('bg-blue-50');
  });

  it('managed: same header, and the Mappings entry stays lit', () => {
    authState.user = { name: 'Robbe', email: 'rberentsen@snpbv.nl' };
    renderLayout('/mappings/acme-mail/deletions');

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('Deletions');
    expect(heading.textContent).toContain('acme-mail');

    const nav = screen.getByRole('navigation');
    // The nav says "Migrations" since the 0035 T3 glossary rename.
    const mappingsEntry = within(nav).getByRole('link', { name: /Migrations/ });
    expect(mappingsEntry.className).toContain('bg-blue-50');
  });

  it('ordinary routes keep their nav title', () => {
    editionFlag.selfhost = true;
    renderLayout('/deletions');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Deletions');
  });
});
