// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import React from 'react';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import AppRoutes from './AppRoutes';
import { uiBasename } from './services/edition';
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

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
      {/* Mounted wherever this bundle was built for — see `uiBasename()`.
          The route table lives in AppRoutes.tsx so tests can mount it in a
          MemoryRouter (0034 T5). */}
      <BrowserRouter basename={uiBasename()}>
        <AppRoutes />
      </BrowserRouter>
      </LocaleProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
};

export default App;
