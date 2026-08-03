// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Which edition this bundle is for (ADR-0026). Set from the build mode rather
  // than a .env file so there is nothing gitignore-shaped in the way of a
  // reproducible build, and nothing to forget to ship. `services/edition.ts`
  // defaults to 'managed' if this is somehow absent, which is the safe way for
  // a flag that gates authentication to fail.
  define: {
    'import.meta.env.VITE_EDITION': JSON.stringify(
      mode === 'selfhost' ? 'selfhost' : 'managed',
    ),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3123,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Component tests are self-contained (jsdom, mocked API) — no Testcontainers,
    // so they run without Docker, unlike the root integration suite.
    include: ['src/**/*.{test,unit.test}.{ts,tsx}'],
  },
}));
