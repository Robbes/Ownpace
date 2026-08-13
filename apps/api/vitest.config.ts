// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import { defineConfig } from 'vitest/config';
import { aliases } from '../../vitest.aliases.ts';

// API unit tests run in a plain Node env with NO Testcontainers global setup.
// (Integration tests — *.integration.test.ts — run via the root vitest project
// which brings up Postgres.)
//
// The alias map is imported, not restated. This file used to carry its own
// three-entry copy with no subpath pins, which broke `pnpm --filter @openmig/api
// test` with ENOTDIR while the root suite stayed green. See vitest.aliases.ts.
export default defineConfig({
  resolve: { alias: aliases },
  test: {
    environment: 'node',
    include: ['src/**/*.unit.test.ts'],
  },
});
