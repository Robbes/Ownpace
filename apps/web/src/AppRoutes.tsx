// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import { useAuthStore } from './stores/auth-store';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Mappings from './pages/Mappings';
import MappingDetail from './pages/MappingDetail';
import CreateMapping from './pages/CreateMapping';
import ConfirmMapping from './pages/ConfirmMapping';
import Tenants from './pages/Tenants';
import Billing from './pages/Billing';
import Login from './pages/Login';
import Decisions from './pages/Decisions';
import Deletions from './pages/Deletions';
import Moves from './pages/Moves';
import Setup from './pages/Setup';
import Sharing from './pages/Sharing';
import Failures from './pages/Failures';
import Verify from './pages/Verify';
import Finish from './pages/Finish';
import Confirm from './pages/Confirm';
import { isSelfHost } from './services/edition';

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
        <Route path="setup/:side/:provider" element={<Setup />} />
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
        <Route
          path="billing"
          element={
            <ManagedOnly>
              <Billing />
            </ManagedOnly>
          }
        />
      </Route>
    </Routes>
  );
};

export default AppRoutes;
