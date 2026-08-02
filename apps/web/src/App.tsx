import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useAuthStore } from './stores/auth-store';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Mappings from './pages/Mappings';
import MappingDetail from './pages/MappingDetail';
import CreateMapping from './pages/CreateMapping';
import Tenants from './pages/Tenants';
import Billing from './pages/Billing';
import OperatorDashboard from './pages/OperatorDashboard';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Deletions from './pages/Deletions';
import Moves from './pages/Moves';
import Failures from './pages/Failures';
import Verify from './pages/Verify';
import Finish from './pages/Finish';
import Confirm from './pages/Confirm';
import { isSelfHost, uiBasename } from './services/edition';
import { LocaleProvider } from './i18n';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

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

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
      {/* Mounted wherever this bundle was built for — see `uiBasename()`. */}
      <BrowserRouter basename={uiBasename()}>
        <Routes>
          <Route path="/login" element={<Login />} />
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
            <Route path="confirm" element={<Confirm />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="mappings" element={<Mappings />} />
            <Route path="mappings/new" element={<CreateMapping />} />
            <Route path="mappings/:id" element={<MappingDetail />} />
            {/*
              The §11.2 decision queues — the operating surface (ADR-0026).

              Two mount points on purpose, because the two editions scope them
              differently (see `queuePath()`). The appliance answers for every
              configured mapping, so its screens live at the top level. A managed
              tenant can have many mappings, so its queues are per-mapping and
              hang off the mapping they belong to. The SCREENS are identical —
              only the URL they read from differs.
            */}
            <Route path="deletions" element={<Deletions />} />
            <Route path="moves" element={<Moves />} />
            <Route path="failures" element={<Failures />} />
            <Route path="mappings/:mappingId/deletions" element={<Deletions />} />
            <Route path="mappings/:mappingId/moves" element={<Moves />} />
            <Route path="mappings/:mappingId/failures" element={<Failures />} />
            {/* The §20 gate and the end of the shadow sync. Verify has the
                same two mount points as the queues and for the same reason:
                the appliance scans every configured mapping in one run, a
                managed run is per-mapping (workplan 0017 T3). */}
            <Route path="verify" element={<Verify />} />
            <Route path="mappings/:mappingId/verify" element={<Verify />} />
            <Route path="finish" element={<Finish />} />
            <Route path="mappings/:mappingId/finish" element={<Finish />} />
            <Route path="tenants" element={<Tenants />} />
            <Route path="billing" element={<Billing />} />
            <Route path="operator" element={<OperatorDashboard />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </LocaleProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
};

export default App;
