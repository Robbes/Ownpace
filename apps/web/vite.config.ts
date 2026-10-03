// Copyright 2026 The Ownpace authors (Apache-2.0)
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';
import { legalSiteFrom } from './src/services/legal-links';

// WHAT BUILD IS THIS — stamped in, because a bundle cannot ask at runtime what
// it was built from.
//
// The version comes from the MONOREPO ROOT package.json, which is the same
// source `buildIdentity()` falls back to on the server side (`@openmig/core`).
// One number in one file: a second copy here is how `apps/web` would come to
// claim a version the API had moved past, and this repository has now spent
// two separate days on values kept in more than one place.
//
// The commit comes from the environment, because git is not present in the
// image build and the SHA has to be handed in — `GIT_SHA` is the argument the
// api and selfhost images already take, so the web image takes the same one.
// Absent, it stays EMPTY rather than becoming `unknown` or `0.0.0`: the stamp
// renders nothing at all when it was not stamped, which prompts the question
// instead of answering it wrongly.
const rootPkg = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'),
) as { version?: string };

// THE BUILD, WHERE A SCRIPT AND AN OPEN PAGE CAN READ IT (workplan 0145; the
// owner's "build the deploy check and the reload prompt", 2026-09-29). The
// stamp's two values (`define`, below) are baked into the JavaScript, where
// nothing outside the page can read them, so the build also writes them beside
// the page, as
// `version.json`. `deploy-live.sh` asks it at the app's address and refuses a
// web app that is not the release's, and an open page asks it to learn that
// the site now serves a newer one (`services/served-build.ts`). Read from the
// stamp's own `define` once the config is resolved, so the file and the page
// cannot disagree.
const versionJson = (): Plugin => {
  let stamp = { version: '', commit: '' };
  return {
    name: 'ownpace:version-json',
    apply: 'build',
    configResolved(config) {
      const stamped = (key: string): string => {
        const value: unknown = config.define?.[key];
        return typeof value === 'string' ? String(JSON.parse(value)) : '';
      };
      stamp = {
        version: stamped('import.meta.env.VITE_VERSION'),
        commit: stamped('import.meta.env.VITE_COMMIT'),
      };
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(stamp)}\n` });
    },
  };
};

// A LEGAL SITE THE LINKS CANNOT USE STOPS THE BUILD (workplan 0139 T10). The
// grant page reads `VITE_LEGAL_SITE_URL` through `services/legal-links.ts`
// while it renders, and that module throws on a value that is not an http(s)
// origin. The web app has no error boundary, so such a bundle would load the
// grant and then show a blank page to every recipient. The same check runs
// here, on the env the bundle will carry, so the owner meets it instead.
const legalSiteChecked = (): Plugin => ({
  name: 'ownpace:legal-site-url',
  configResolved(config) {
    legalSiteFrom(config.env);
  },
});

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
    'import.meta.env.VITE_VERSION': JSON.stringify(rootPkg.version ?? ''),
    'import.meta.env.VITE_COMMIT': JSON.stringify(
      process.env.GIT_SHA ?? process.env.VITE_COMMIT ?? '',
    ),
  },
  // Tailwind runs as a Vite plugin (v4's supported route). WITHOUT IT THE
  // STYLESHEET SHIPS UNCOMPILED: `src/index.css` is passed through verbatim,
  // the browser ignores `@import "tailwindcss"`, and every screen renders with
  // no utilities at all — which is exactly what shipped until 2026-08-06, in
  // both editions, because nothing asserted the CSS had been built.
  plugins: [react(), tailwindcss(), legalSiteChecked(), versionJson()],
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
