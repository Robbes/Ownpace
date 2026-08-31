// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Wrong-edition routes answer honestly (0034 T5).
 *
 * Every screen module is mocked to a marker, so what these tests pin is the
 * ROUTE TABLE itself: a typed URL for a screen the edition does not have
 * lands on that edition's home, and the wrong screen never mounts (its
 * marker must be absent — mounting is when queries fire). The worst offender
 * pinned explicitly: /mappings/new on the appliance used to mount the
 * managed creation wizard on the edition whose config is read-only BY DESIGN
 * (standing decision 6). Per-mapping routes stay shared — real in both.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { editionFlag, authFlag, whoFlag } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  // Signed-out is a state the route table behaves DIFFERENTLY in, and until
  // 2026-08-25 nothing here exercised it. That is how a catch-all route inside
  // ProtectedRoute shipped: every case in this file was signed in, so the
  // redirect it caused for everybody else was invisible.
  authFlag: { authenticated: true },
  // Who is signing in, which `/` now routes on. Defaults are an ordinary member
  // of one organisation — the case every test in this file assumed without
  // saying so, and the case the index redirect has always been right for.
  whoFlag: { operator: false, tenantCount: 1 },
}));

// VITE_EDITION is baked by vite `define`; component tests mock the module
// (the 0034 guardrail's sanctioned seam — see MappingDetail.unit.test.tsx).
vi.mock('./services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
  // Layout renders BuildStamp, which asks the server what IT is running.
  // A partial mock of a module the component tree imports from fails at
  // render with "No export is defined on the mock", so the mock has to
  // grow whenever the tree reaches for something new.
  operatingBaseUrl: () => '',
}));

vi.mock('./stores/auth-store', () => {
  const state = {
    isAuthenticated: true,
    user: null,
    logout: () => {},
    operator: false,
    tenantCount: 1,
  };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => {
      state.isAuthenticated = authFlag.authenticated;
      state.operator = whoFlag.operator;
      state.tenantCount = whoFlag.tenantCount;
      return selector ? selector(state) : state;
    },
  };
});

// Markers, not screens: mounting is the thing under test.
vi.mock('./pages/Dashboard', () => ({ default: () => <div>screen:dashboard</div> }));
vi.mock('./pages/AccessRequests', () => ({ default: () => <div>screen:access-requests</div> }));
vi.mock('./pages/Mappings', () => ({ default: () => <div>screen:mappings</div> }));
vi.mock('./pages/MappingDetail', () => ({ default: () => <div>screen:mapping-detail</div> }));
vi.mock('./pages/CreateMapping', () => ({ default: () => <div>screen:create-mapping</div> }));
vi.mock('./pages/ConfirmMapping', () => ({ default: () => <div>screen:confirm-mapping</div> }));
vi.mock('./pages/Tenants', () => ({ default: () => <div>screen:tenants</div> }));
vi.mock('./pages/Billing', () => ({ default: () => <div>screen:billing</div> }));
vi.mock('./pages/Login', () => ({ default: () => <div>screen:login</div> }));
vi.mock('./pages/Decisions', () => ({ default: () => <div>screen:decisions</div> }));
vi.mock('./pages/Deletions', () => ({ default: () => <div>screen:deletions</div> }));
vi.mock('./pages/Moves', () => ({ default: () => <div>screen:moves</div> }));
vi.mock('./pages/Failures', () => ({ default: () => <div>screen:failures</div> }));
vi.mock('./pages/Sharing', () => ({ default: () => <div>screen:sharing</div> }));
vi.mock('./pages/Setup', () => ({ default: () => <div>screen:setup</div> }));
vi.mock('./pages/Connections', () => ({ default: () => <div>screen:connections</div> }));
vi.mock('./pages/Docs', () => ({ default: () => <div>screen:docs</div> }));
vi.mock('./pages/Verify', () => ({ default: () => <div>screen:verify</div> }));
vi.mock('./pages/Finish', () => ({ default: () => <div>screen:finish</div> }));
vi.mock('./pages/Confirm', () => ({ default: () => <div>screen:confirm</div> }));
vi.mock('./pages/NotFound', () => ({ default: () => <div>screen:not-found</div> }));

import AppRoutes from './AppRoutes.tsx';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );

beforeEach(() => {
  editionFlag.selfhost = false;
  authFlag.authenticated = true;
  whoFlag.operator = false;
  whoFlag.tenantCount = 1;
});

describe('appliance builds redirect managed-only URLs to /confirm', () => {
  const managedOnly: Record<string, string> = {
    '/dashboard': 'screen:dashboard',
    '/mappings': 'screen:mappings',
    '/mappings/new': 'screen:create-mapping',
    // The green light drives the managed discover/start API; the appliance's
    // own /confirm is that edition's equivalent — exactly where this lands.
    '/mappings/acme/confirm': 'screen:confirm-mapping',
    '/tenants': 'screen:tenants',
    '/billing': 'screen:billing',
    '/login': 'screen:login',
  };

  for (const [path, marker] of Object.entries(managedOnly)) {
    it(`${path} lands on Review & confirm, and ${marker} never mounts`, async () => {
      editionFlag.selfhost = true;
      renderAt(path);

      expect(await screen.findByText('screen:confirm')).toBeInTheDocument();
      expect(screen.queryByText(marker)).not.toBeInTheDocument();
    });
  }
});

describe('the managed-only screens still mount on managed', () => {
  // The redirect suite above proves /billing does NOT mount on the appliance,
  // and passes just as well if the route is broken on BOTH editions. That
  // stopped being a theoretical gap when Billing became a lazily-loaded chunk
  // (ADR-0036): a route whose element never resolves fails silently, under a
  // Suspense fallback, on the only edition that has the screen.
  it('/billing mounts the billing screen', async () => {
    renderAt('/billing');

    expect(await screen.findByText('screen:billing')).toBeInTheDocument();
  });

  it('/tenants mounts the tenants screen', async () => {
    renderAt('/tenants');

    expect(await screen.findByText('screen:tenants')).toBeInTheDocument();
  });
});

describe('managed builds redirect appliance-only URLs to /dashboard', () => {
  const selfhostOnly: Record<string, string> = {
    '/confirm': 'screen:confirm',
    '/deletions': 'screen:deletions',
    '/moves': 'screen:moves',
    '/failures': 'screen:failures',
    '/verify': 'screen:verify',
    '/finish': 'screen:finish',
  };

  for (const [path, marker] of Object.entries(selfhostOnly)) {
    it(`${path} lands on the Dashboard, and ${marker} never mounts`, async () => {
      renderAt(path);

      expect(await screen.findByText('screen:dashboard')).toBeInTheDocument();
      expect(screen.queryByText(marker)).not.toBeInTheDocument();
    });
  }
});

describe('per-mapping routes stay shared — real in both editions', () => {
  for (const selfhost of [false, true]) {
    const name = selfhost ? 'selfhost' : 'managed';
    it(`/mappings/acme/deletions mounts the queue screen on ${name}`, async () => {
      editionFlag.selfhost = selfhost;
      renderAt('/mappings/acme/deletions');

      expect(await screen.findByText('screen:deletions')).toBeInTheDocument();
    });

    it(`/mappings/acme (the hub) mounts on ${name}`, async () => {
      editionFlag.selfhost = selfhost;
      renderAt('/mappings/acme');

      expect(await screen.findByText('screen:mapping-detail')).toBeInTheDocument();
    });
  }
});

describe('the confirm route is real on managed (0037 T2)', () => {
  it('/mappings/acme/confirm mounts the green-light screen, not the hub', async () => {
    renderAt('/mappings/acme/confirm');

    expect(await screen.findByText('screen:confirm-mapping')).toBeInTheDocument();
    expect(screen.queryByText('screen:mapping-detail')).not.toBeInTheDocument();
  });
});

/**
 * AN ADDRESS THAT IS NOT A SCREEN, ANSWERED THE SAME WAY TO EVERYBODY.
 *
 * The catch-all lived inside the `/` subtree for one day, which is wrapped in
 * ProtectedRoute. A signed-in visitor saw NotFound; a signed-OUT one was sent
 * to /login before it could render, so a wrong address was indistinguishable
 * from an expired session. Reported from the live test host: `/blabla` came
 * back as `/login`.
 *
 * Both states are pinned, because the bug was that only one of them was.
 */
describe('a wrong address is a 404, signed in or not', () => {
  it('shows the not-found screen when signed in', async () => {
    renderAt('/blabla');
    expect(await screen.findByText('screen:not-found')).toBeInTheDocument();
  });

  it('shows it when signed out too, rather than the login form', async () => {
    authFlag.authenticated = false;
    renderAt('/blabla');
    expect(await screen.findByText('screen:not-found')).toBeInTheDocument();
    expect(
      screen.queryByText('screen:login'),
      'a wrong address redirected to the login form, which reads as an expired session',
    ).not.toBeInTheDocument();
  });

  it('still sends a signed-out visitor to /login for a REAL protected screen', () => {
    // The redirect is correct where it belongs. Removing it for /dashboard
    // would be a security change dressed as a 404 fix.
    authFlag.authenticated = false;
    renderAt('/dashboard');
    expect(screen.getByText('screen:login')).toBeInTheDocument();
    expect(screen.queryByText('screen:dashboard')).not.toBeInTheDocument();
  });
});

/**
 * WHERE `/` GOES, and the door the first fix missed.
 *
 * The index redirect sent every signed-in managed session to `/dashboard`.
 * `AuthCallback` and `Login` were taught to land a platform operator on the
 * queue instead — they belong to no organisation by design (0093 T6/T7), so
 * the dashboard's first request is refused — and this route was not. Those two
 * only run at the MOMENT OF SIGNING IN; this one runs every time somebody opens
 * the bare host, returns to a live session, or clicks the product's own logo.
 * Reported the day the first fix shipped: "I need to manually go to the access
 * requests url."
 */
describe('where the bare host lands you', () => {
  it('takes an operator with no organisation to the queue', async () => {
    whoFlag.operator = true;
    whoFlag.tenantCount = 0;
    renderAt('/');
    expect(
      await screen.findByText('screen:access-requests'),
      'the bare host still sends an operator to a dashboard whose first request\n' +
        'is refused. They belong to no organisation by design, so this is not a\n' +
        'screen they can be given — and since the membership 403 no longer ends\n' +
        'their session, they now SIT on the broken one rather than bouncing.',
    ).toBeInTheDocument();
    expect(screen.queryByText('screen:dashboard')).not.toBeInTheDocument();
  });

  it('still takes an ordinary member to the dashboard', async () => {
    // The other half: the axis is "no organisation", never "is an operator".
    renderAt('/');
    expect(await screen.findByText('screen:dashboard')).toBeInTheDocument();
  });

  it('takes an operator who DOES belong somewhere to the dashboard', async () => {
    whoFlag.operator = true;
    whoFlag.tenantCount = 1;
    renderAt('/');
    expect(await screen.findByText('screen:dashboard')).toBeInTheDocument();
  });
});
