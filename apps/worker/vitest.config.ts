// Copyright 2026 The Ownpace authors (Apache-2.0)
import { defineConfig } from 'vitest/config';
import { aliases } from '../../vitest.aliases.ts';

// Worker unit tests run in a plain Node env with NO Testcontainers global setup.
// These cover pure wiring (e.g. deps-lifecycle close semantics) that needs no DB.
//
// The alias map is imported, not restated — this file's own six-entry copy had
// no subpath pins and failed with ENOTDIR. See vitest.aliases.ts.
export default defineConfig({
  resolve: { alias: aliases },
  test: {
    environment: 'node',
    include: ['src/**/*.unit.test.ts'],
  },
});
