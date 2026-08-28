// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The route table, extracted from App.tsx so tests can mount it in a
 * MemoryRouter (0034 T5) — App.tsx keeps the providers and BrowserRouter.
 *
 * Wrong-edition URLs redirect to the edition's home instead of mounting
 * screens that error against APIs that are not there. Before this, a typed
 * `/mappings/new` on the appliance mounted the managed creation wizard on the
 * edition whose config is read-only BY DESIGN (standing decision 6), and a
 * typed `/deletions` on managed mounted its query with no mappingId and
 * rendered an internal exception ("The managed edition needs a mappingId…")
 * as if it were an operator-facing error. Per-mapping routes stay shared —
 * they are real in both editions.
 */
import React from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { useAuthStore } from './stores/auth-store.ts';
import Layout from './components/Layout.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Mappings from './pages/Mappings.tsx';
import MappingDetail from './pages/MappingDetail.tsx';
import CreateMapping from './pages/CreateMapping.tsx';
import ConfirmMapping from './pages/ConfirmMapping.tsx';
import Tenants from './pages/Tenants.tsx';
import Login from './pages/Login.tsx';
import RequestAccess from './pages/RequestAccess.tsx';
import Grant from './pages/Grant.tsx';
import AuthCallback from './pages/AuthCallback.tsx';
import AccessRequests from './pages/AccessRequests.tsx';
import {
  SupportTenants,
  SupportTenantDetail,
  SupportMigrationDetail,
} from './pages/Support.tsx';
import Invitations from './pages/Invitations.tsx';
import Decisions from './pages/Decisions.tsx';
import Deletions from './pages/Deletions.tsx';
import Moves from './pages/Moves.tsx';
import Connections from './pages/Connections.tsx';
import Docs from './pages/Docs.tsx';
import Setup from './pages/Setup.tsx';
import Sharing from './pages/Sharing.tsx';
import Failures from './pages/Failures.tsx';
import Verify from './pages/Verify.tsx';
import Finish from './pages/Finish.tsx';
import Confirm from './pages/Confirm.tsx';
import { isSelfHost } from './services/edition.ts';
import NotFound from './pages/NotFound.tsx';

/**
 * The billing screen, and only on the edition that bills (ADR-0036).
 *
 * `ManagedOnly` below already refuses to RENDER it on the appliance, which is
 * the correct behaviour and was never the problem. A static import is a
 * build-time fact, not a runtime one: the screen and its Mollie-shaped API
 * client went into the appliance's bundle either way, and shipping the payment
 * UI of a service the appliance's owner is not a customer of is exactly the
 * contamination this boundary exists to stop.
 *
 * The comparison is against a literal — Vite's `define` substitutes
 * `import.meta.env.VITE_EDITION` at build time (see vite.config.ts), so on the
 * self-host build this whole expression folds to `null`, the dynamic import
 * becomes unreachable, and Rollup emits no chunk for it at all. Using
 * `isSelfHost()` here instead would read the same flag and be correct at
 * runtime, but a function call is opaque to the bundler and the chunk would
 * ship regardless — which is the entire difference this is written for.
 */
const Billing =
  import.meta.env.VITE_EDITION === 'selfhost'
    ? null
    : React.lazy(() => import('./pages/Billing.tsx'));

// Protected route component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // The self-host appliance has no accounts to authenticate against: it is
  // single-user, bound to localhost, and its HTTP surface has been
  // unauthenticated since workplan 0010. Sending its operator to a login form
  // that nothing can satisfy would make the UI unusable there. See
  // `services/edition.ts` — the flag defaults to `managed`, so a misconfigured
  // build keeps the login rather than losing it.
  if (!isAuthenticated && !isSelfHost()) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

/** A managed-only screen; the appliance lands on its own home instead. */
const ManagedOnly: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  isSelfHost() ? <Navigate to="/confirm" replace /> : <>{children}</>;

/** An appliance-only screen; managed lands on its own home instead. */
const SelfhostOnly: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  isSelfHost() ? <>{children}</> : <Navigate to="/dashboard" replace />;

const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <ManagedOnly>
            <Login />
          </ManagedOnly>
        }
      />
      {/* Where the identity provider sends the browser back (ADR-0042). Public
          by necessity: the whole point is that the session does not exist yet.
          The path must match the redirect URI `setup-zitadel.sh` registers. */}
      <Route
        path="/auth/callback"
        element={
          <ManagedOnly>
            <AuthCallback />
          </ManagedOnly>
        }
      />
      {/* Public, and the only other route outside ProtectedRoute: somebody
          asking for an account has no account to authenticate with. The
          website's call to action links here (workplan 0093 T3). */}
      <Route
        path="/request-access"
        element={
          <ManagedOnly>
            <RequestAccess />
          </ManagedOnly>
        }
      />
      {/* Public by design, and outside the chrome (workplan 0108 T4, ADR-0035).
          The person here is being MIGRATED, not signed up: they will never have
          an Ownpace account, so authenticating them is not something that could
          be arranged — the link in the path is the whole credential, verified
          server-side. `:link` is one segment carrying `<id>.<secret>`; a dot is
          an ordinary path character, so it needs no escaping in the pattern. */}
      <Route
        path="/grant/:link"
        element={
          <ManagedOnly>
            <Grant />
          </ManagedOnly>
        }
      />
      {/* Outside Layout on purpose (workplan 0099). Somebody answering an
          invitation belongs to no organisation yet, so the sidebar's every link
          would 403 — and the nav would be inviting them into a product they
          have not agreed to join. It is inside ProtectedRoute because answering
          needs a subject and a verified email. */}
      <Route
        path="/invitations"
        element={
          <ManagedOnly>
            <ProtectedRoute>
              <Invitations />
            </ProtectedRoute>
          </ManagedOnly>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={<Navigate to={isSelfHost() ? '/confirm' : '/dashboard'} replace />}
        />
        {/*
          Review & confirm. The appliance's landing screen (ADR-0026): it
          replaced the hand-rolled HTML page that used to be its only UI, so
          the appliance now runs one UI technology instead of two. Managed
          reaches the same idea through the create-mapping wizard, which is
          a different flow over the same presentational pieces.
        */}
        <Route
          path="confirm"
          element={
            <SelfhostOnly>
              <Confirm />
            </SelfhostOnly>
          }
        />
        <Route
          path="dashboard"
          element={
            <ManagedOnly>
              <Dashboard />
            </ManagedOnly>
          }
        />
        <Route
          path="mappings"
          element={
            <ManagedOnly>
              <Mappings />
            </ManagedOnly>
          }
        />
        {/* The creation wizard is managed-only twice over: it posts to the
            managed /api, and the appliance's config comes from its config
            DIRECTORY by design (standing decision 6) — a UI that pretended
            to create mappings there would contradict the design, not just
            error. */}
        <Route
          path="mappings/new"
          element={
            <ManagedOnly>
              <CreateMapping />
            </ManagedOnly>
          }
        />
        {/* The green light at a real URL (0037 T2): managed-only like the
            wizard that leads here — it drives the managed discover/start
            API — and the appliance's own /confirm is that edition's
            equivalent, which is exactly where ManagedOnly redirects it. */}
        <Route
          path="mappings/:mappingId/confirm"
          element={
            <ManagedOnly>
              <ConfirmMapping />
            </ManagedOnly>
          }
        />
        <Route path="mappings/:id" element={<MappingDetail />} />
        {/*
          The §11.2 decision queues — the operating surface (ADR-0026).

          Two mount points on purpose, because the two editions scope them
          differently (see `queuePath()`). The appliance answers for every
          configured mapping, so its screens live at the top level. A managed
          tenant reaches the same screens per-mapping. The SCREENS are
          identical — only the URL they read from differs, which is exactly
          why the FLAT forms are appliance-only: on managed they would mount
          queries that cannot name a mapping.
        */}
        {/* The §11.1 drift decision queue (0028 T1) — TENANT-level, one
            mount in both editions: a new mailbox belongs to no mapping. */}
        <Route path="decisions" element={<Decisions />} />
        <Route
          path="deletions"
          element={
            <SelfhostOnly>
              <Deletions />
            </SelfhostOnly>
          }
        />
        <Route
          path="moves"
          element={
            <SelfhostOnly>
              <Moves />
            </SelfhostOnly>
          }
        />
        <Route
          path="failures"
          element={
            <SelfhostOnly>
              <Failures />
            </SelfhostOnly>
          }
        />
        <Route path="mappings/:mappingId/deletions" element={<Deletions />} />
        <Route path="mappings/:mappingId/moves" element={<Moves />} />
        <Route path="mappings/:mappingId/failures" element={<Failures />} />
        {/* The sharing checklist (ADR-0032): per-mapping in BOTH editions —
            the queue's rows live in the ledger either way. */}
        <Route path="mappings/:mappingId/sharing" element={<Sharing />} />
        {/* The platform-side prerequisites, per provider (workplan 0061). */}
        {/* Without a provider the page ASKS which one (workplan 0068); the
            nav used to link straight to Box for everybody. */}
        <Route path="setup" element={<Setup />} />
        <Route path="setup/:side/:provider" element={<Setup />} />
        {/* Connections as first-class, testable things (workplan 0062). */}
        <Route path="connections" element={<Connections />} />
        {/* The repo's setup guides, in the app — the references in
            wizard panels and refusals are links here (workplan 0063). */}
        <Route path="docs" element={<Docs />} />
        <Route path="docs/:slug" element={<Docs />} />
        {/* The §20 gate and the end of the shadow sync. Verify has the
            same two mount points as the queues and for the same reason:
            the appliance scans every configured mapping in one run, a
            managed run is per-mapping (workplan 0017 T3). */}
        <Route
          path="verify"
          element={
            <SelfhostOnly>
              <Verify />
            </SelfhostOnly>
          }
        />
        <Route path="mappings/:mappingId/verify" element={<Verify />} />
        <Route
          path="finish"
          element={
            <SelfhostOnly>
              <Finish />
            </SelfhostOnly>
          }
        />
        <Route path="mappings/:mappingId/finish" element={<Finish />} />
        <Route
          path="tenants"
          element={
            <ManagedOnly>
              <Tenants />
            </ManagedOnly>
          }
        />
        {/* The access queue (workplan 0093 T7). Managed only — the appliance
            has one owner and nobody to let in — and deliberately NOT gated on
            being an operator: the nav hides it from everybody else, and a typed
            URL reaches it and shows an empty queue, because the rows are
            invisible to anybody migration 0005's policies do not name. Gating
            it here would be a second, weaker copy of a rule the database
            already enforces, and the weaker copy is the one that rots. */}
        <Route
          path="access-requests"
          element={
            <ManagedOnly>
              <AccessRequests />
            </ManagedOnly>
          }
        />
        {/* The operator's support surface (workplan 0110 T4). Managed only —
            the appliance has one owner, who is the person these screens would
            be about — and, like the access queue, deliberately NOT gated on
            being an operator here: the nav hides it from everybody else, and a
            typed URL reaches it and shows nothing, because to the database
            that is what the rows are. Gating it here would be a second, weaker
            copy of a rule the database already enforces. */}
        <Route
          path="support"
          element={
            <ManagedOnly>
              <SupportTenants />
            </ManagedOnly>
          }
        />
        <Route
          path="support/tenants/:tenantId"
          element={
            <ManagedOnly>
              <SupportTenantDetail />
            </ManagedOnly>
          }
        />
        <Route
          path="support/migrations/:mappingId"
          element={
            <ManagedOnly>
              <SupportMigrationDetail />
            </ManagedOnly>
          }
        />
        <Route
          path="billing"
          element={
            <ManagedOnly>
              {Billing ? (
                <React.Suspense fallback={null}>
                  <Billing />
                </React.Suspense>
              ) : null}
            </ManagedOnly>
          }
        />
      </Route>
      {/*
        THE LAST ROUTE, AND IT MUST STAY LAST — and OUTSIDE ProtectedRoute.
        Without it, react-router matched nothing for an unknown path and
        rendered NOTHING: nginx's SPA fallback had already answered HTTP 200, so
        `/blabla` was a blank white page that every monitor read as success.

        It lived INSIDE the layout for exactly one day, on the reasoning that a
        person who mistyped a path is still signed in and should keep their
        navigation. That was wrong in the case that actually happens: the
        subtree is wrapped in ProtectedRoute, so a signed-OUT visitor was sent
        to /login before NotFound could render, and a wrong address looked like
        an expired session. Reported from the live test host — `/blabla` came
        back as `/login`.

        Out here it answers everybody, signed in or not. The cost is that a
        signed-in visitor sees it without the nav chrome, which is a fair trade
        for a page whose whole job is to say "this address is not a page" and
        offer one link back.
      */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default AppRoutes;
