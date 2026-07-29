import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const rootDir = resolve(__dirname);

export default defineConfig({
  resolve: {
    alias: {
      // Subpath exports, listed FIRST because a bare '@openmig/core' alias is a
      // prefix match and would otherwise rewrite '@openmig/core/cutover-state'
      // to '<root>/packages/core/src/index.ts/cutover-state'.
      //
      // Without these, whether CutoverStore.transitionState's dynamic import of
      // '@openmig/core/cutover-state' resolves depends on the Node version
      // running vitest: it works on CI's Node 24 and throws "Cannot find
      // package '@openmig/core/cutover-state'" on Node 22. Pinning every
      // subpath makes the suite resolve the same way everywhere instead of
      // leaning on the runtime's resolver.
      '@openmig/core/cutover-state': resolve(rootDir, 'packages/core/src/cutover-state.ts'),
      '@openmig/core/secret-store': resolve(rootDir, 'packages/core/src/secret-store.ts'),
      '@openmig/core/secrets': resolve(rootDir, 'packages/core/src/secrets.ts'),
      '@openmig/ledger/schema-pg': resolve(rootDir, 'packages/ledger/src/schema-pg.ts'),
      '@openmig/scheduler/in-process': resolve(rootDir, 'packages/scheduler/src/scheduler.ts'),
      '@openmig/shared': resolve(rootDir, 'packages/shared/src/index.ts'),
      '@openmig/ledger': resolve(rootDir, 'packages/ledger/src/index.ts'),
      '@openmig/core': resolve(rootDir, 'packages/core/src/index.ts'),
      '@openmig/connectors': resolve(rootDir, 'packages/connectors/src/index.ts'),
      '@openmig/scheduler': resolve(rootDir, 'packages/scheduler/src/index.ts'),
      '@openmig/engines': resolve(rootDir, 'packages/engines/src/index.ts'),
    },
  },
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
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['**/*.e2e.test.ts'],
        },
      },
    ],
  },
});
