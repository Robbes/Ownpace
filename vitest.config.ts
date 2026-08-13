import { defineConfig } from 'vitest/config';
import { aliases } from './vitest.aliases.ts';

export default defineConfig({
  // Declared once in vitest.aliases.ts and shared with every per-app config —
  // see that file for why the ordering matters and what four divergent copies
  // of this block cost.
  resolve: { alias: aliases },
  test: {
    exclude: ['node_modules', 'dist'],
    globalSetup: './vitest.global-setup.ts',
    testTimeout: 360000, // 6 minutes for integration tests with Nextcloud
    // Individual projects can't have their own resolve config, so the aliases
    // above are declared once at the root.
    //
    // They are NOT a substitute for a real dependency, and a test file at the
    // REPO ROOT cannot lean on them: `test/e2e/*.e2e.test.ts` importing
    // '@openmig/shared' failed on the runner with ERR_MODULE_NOT_FOUND. Files
    // under `packages/*` and `apps/*` resolve workspace imports through pnpm's
    // own node_modules links because their package.json declares the
    // dependency — which is why this never came up before. Keep root-level
    // test files to vitest and node builtins.
    projects: [
      {
        test: {
          // Real-browser smoke over the MANAGED bundle (test/ui/). Its own
          // project because it needs two things the unit gate must not
          // require: a Chromium binary, and a production `pnpm build` of the
          // web app. Kept out of `pnpm test` for that reason and run as its
          // own CI job — but on every PR, not nightly, because the defects it
          // exists for (an uncompiled stylesheet, a bundle calling the wrong
          // origin) ship silently and are cheap to catch before merge.
          name: 'ui',
          include: ['test/ui/**/*.ui.test.ts'],
          // One browser, one build: parallel files would rebuild and relaunch.
          fileParallelism: false,
          testTimeout: 120000,
          hookTimeout: 300000,
        },
      },
      {
        test: {
          name: 'unit-browser',
          // Include .tsx so web component tests (jsdom + testing-library) run in CI too.
          include: ['apps/web/**/*.unit.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./apps/web/src/test-setup.ts'],
        },
      },
      {
        test: {
          name: 'unit',
          include: ['**/*.unit.test.ts', '!apps/web/**/*.unit.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['**/*.integration.test.ts'],
          // Inline `projects` entries do NOT inherit the root `test.testTimeout`
          // above — each project only gets what it declares itself (globalSetup
          // and other non-`test.*` config still cascade; per-test runtime options
          // apparently do not). dav-sync.integration.test.ts's calendar/file cases
          // have no explicit per-`it` timeout and silently fell back to vitest's
          // own built-in 5000ms default, timing out in CI once enough other
          // integration files were running real DAV I/O against the same shared
          // Testcontainers Nextcloud to push them past it. Repeated here rather
          // than trusting inheritance a second time.
          testTimeout: 360000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['**/*.e2e.test.ts'],
          // Same inheritance gap as 'integration' above. Every current e2e `it`
          // already passes its own explicit millisecond timeout (some waiting on
          // real cron-driven appliance passes — see PASS_WAIT_MS in
          // test/e2e/apply-deletion-lib.ts, up to 200s), so nothing here is
          // known to rely on this fallback today; set for the same reason as
          // 'integration' so a future e2e test that omits one fails loud with
          // minutes of real headroom rather than vitest's built-in 5s default.
          testTimeout: 360000,
        },
      },
    ],
  },
});
