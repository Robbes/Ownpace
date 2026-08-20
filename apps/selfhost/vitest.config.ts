// Copyright 2026 The Ownpace authors (Apache-2.0)
import { defineConfig } from 'vitest/config';
import { aliases } from '../../vitest.aliases.ts';

// Self-host unit tests run in a plain Node env with NO Testcontainers global
// setup — config-dir loading + status formatting are pure and need no database.
//
// TWO defects fixed here on 2026-08-13, both invisible to CI because CI runs
// only the root scripts:
//
// 1. This file carried its own alias map with no subpath pins, including a bare
//    '@openmig/scheduler' → the package INDEX. That is the one module self-host
//    must never load (it re-exports the Trigger.dev client — AGENTS.md hard rule
//    5), and as a prefix match it also broke the legitimate
//    '@openmig/scheduler/in-process' import with ENOTDIR. Nine of seventeen
//    files failed. The shared map pins the subpath ahead of the bare entry.
//
// 2. The include glob was `src/**/*.{test,unit.test}.ts`, whose leading `*` is
//    greedy: it matched `selfhost-queues.integration.test.ts` and dragged an
//    integration test into a project declared to need no containers, against
//    this file's own comment. Narrowed to the `.unit.test.ts` infix the rest of
//    the repository uses.
export default defineConfig({
  resolve: { alias: aliases },
  test: {
    environment: 'node',
    include: ['src/**/*.unit.test.ts'],
  },
});
