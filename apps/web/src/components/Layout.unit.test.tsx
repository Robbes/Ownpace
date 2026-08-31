// Copyright 2026 The Ownpace authors (Apache-2.0)
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
    user: null as null | { name: string; email: string; role?: string },
    logout: () => {},
    operator: false,
    // ONE ORGANISATION IS THE ORDINARY CASE, and it has to be stated rather
    // than defaulted, because the state this file used to render was somebody
    // in NO organisation being shown every tenant-scoped screen — which is the
    // defect the `inOrganisation` axis exists to fix. Leaving it at nought here
    // would have hidden the nav from every test below and read as a bug in the
    // component.
    tenantCount: 1,
  },
}));

// VITE_EDITION is baked by vite `define`; component tests mock the module
// (the 0034 guardrail's sanctioned seam).
vi.mock('../services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
  // Layout renders BuildStamp, which asks the server what IT is running.
  // A partial mock of a module the component tree imports from fails at
  // render with "No export is defined on the mock", so the mock has to
  // grow whenever the tree reaches for something new.
  operatingBaseUrl: () => '',
}));

vi.mock('../stores/auth-store', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

import Layout from './Layout.tsx';

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
  authState.operator = false;
  authState.tenantCount = 1;
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

describe('the Billing nav entry follows the billing-read guard (owner decision 2026-08-10)', () => {
  it('managed admin sees Billing; viewer and member do not', () => {
    authState.user = { name: 'A', email: 'a@acme.test', role: 'admin' };
    const { unmount } = renderLayout('/dashboard');
    expect(screen.getAllByRole('link', { name: /Billing/ }).length).toBeGreaterThan(0);
    unmount();

    for (const role of ['viewer', 'member']) {
      authState.user = { name: 'V', email: 'v@acme.test', role };
      const view = renderLayout('/dashboard');
      // The server 403s a lesser role's billing reads — a nav entry that can
      // only lead to a refusal is hidden, like the appliance hides Billing.
      expect(screen.queryByRole('link', { name: /Billing/ })).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

/**
 * THE NAV STOPPED OFFERING SCREENS THE SIGNED-IN PERSON CANNOT OPEN.
 *
 * A platform operator belongs to no organisation by design (0093 T6/T7). The
 * nav was built on two axes — edition, and operator/role — and had no axis for
 * "is this person in an organisation at all", so it offered them Dashboard,
 * Migrations, Connections, Setup guides, Decisions and Team. Each one's first
 * request answers
 *
 *     403 { message: 'No active membership for this tenant' }
 *
 * which `api.ts` reads as a dead session and signs them out. Reported from the
 * OTA instance on 2026-08-31: "I see the full menu, and if I click on any menu
 * items, I switch back to login." Six dead ends beside two working screens,
 * with nothing on screen to tell them apart.
 */
describe('somebody who is in no organisation (the operator)', () => {
  const nav = () => screen.getByRole('navigation');
  const linkNames = () =>
    within(nav())
      .getAllByRole('link')
      .map((a) => a.textContent?.trim() ?? '');

  const asOperatorWithNoOrganisation = () => {
    authState.user = { name: 'Rob', email: 'rob@example.test', role: 'member' };
    authState.operator = true;
    authState.tenantCount = 0;
  };

  /**
   * THE LABELS, EXACTLY, because two of them differ by one word.
   *
   * `nav.setup` is "Setup checklist" and `nav.docs` is "Setup guides" — a
   * substring match on "Setup" cannot tell them apart, and the first version
   * of these tests failed on precisely that: it asserted the checklist was
   * hidden and matched the guides entry, which stays. Adjacency again, the
   * mistake this repository keeps writing down.
   */
  const KEPT = ['Access requests', 'Support', 'Setup guides'] as const;
  const HIDDEN = [
    'Dashboard',
    'Migrations',
    'Connections',
    'Setup checklist',
    'Attention',
    'Tenants',
  ] as const;

  it.each(KEPT)('still offers %s — it works without an organisation', (label) => {
    // The queue they came for, the support surface, and the guides — which
    // call no API at all, so they work for anybody signed in.
    asOperatorWithNoOrganisation();
    renderLayout('/access-requests');
    expect(linkNames()).toContain(label);
  });

  it.each(HIDDEN)('does not offer %s, which would 403 and sign them out', (label) => {
    asOperatorWithNoOrganisation();
    renderLayout('/access-requests');
    expect(
      linkNames().filter((n) => n === label),
      'the nav offers a tenant-scoped screen to somebody with no organisation.\n' +
        'Its first request answers 403 "No active membership for this tenant",\n' +
        'which api.ts reads as a dead session — so the entry is not merely a\n' +
        'dead end, it signs the operator out.',
    ).toEqual([]);
  });

  it('gives them back the moment they belong somewhere', () => {
    // The other half, and the reason the test above is not vacuous: the axis
    // is "no organisation", never "is an operator". An operator who is also a
    // member of an organisation gets the whole nav.
    asOperatorWithNoOrganisation();
    authState.tenantCount = 1;
    renderLayout('/dashboard');

    const names = linkNames();
    for (const label of HIDDEN) expect(names).toContain(label);
    expect(names).toContain('Access requests');
  });

  it('leaves the appliance exactly as it was', () => {
    // Self-host has no tenancy to belong to and its screens answer for the
    // mappings it is configured with, so the count is meaningless there.
    // Hiding the nav on an edition that never had this problem would be a
    // second bug introduced by the fix for the first.
    editionFlag.selfhost = true;
    authState.tenantCount = 0;
    renderLayout('/confirm');

    const names = linkNames();
    expect(names).toContain('Setup checklist');
    expect(names).toContain('Attention');
  });
});
