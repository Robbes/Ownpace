// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Whether a test run starts containers, and — much more importantly — when it
 * refuses to decide that it does not need to.
 *
 * A unit-only run used to start Postgres regardless, so every unit CI run pulled
 * `testcontainers/ryuk` and `postgres` from Docker Hub before executing a single
 * assertion, and failed outright when the registry had a bad minute. That happened
 * twice on runs whose tests were all passing, and the reported symptom was
 * misleading both times: a global-setup failure makes Vitest print "No test files
 * found, exiting with code 1", which blames the file selection for a registry
 * timeout further down.
 *
 * The gate has to fail in ONE direction. Skipping containers when they were needed
 * breaks integration tests in a way that reads like a product bug — an empty
 * database, or a connection refused, hundreds of lines from the cause. Starting
 * them when they were not needed merely wastes a minute. So anything this cannot
 * confidently identify as container-free keeps the old behaviour, and every test
 * below that passes an unusual filter is asserting exactly that.
 *
 * No workspace imports: this file sits at the repo root, where `@openmig/*`
 * resolution does not work (see the note in `vitest.config.ts`).
 */

import { describe, it, expect } from 'vitest';
import { runNeedsContainers } from './vitest.global-setup';

const withProjects = (project: unknown) => ({ config: { project } });

describe('runNeedsContainers', () => {
  it('skips containers for the unit projects CI actually runs', () => {
    // `pnpm test` is `vitest run --project unit --project unit-browser`.
    expect(runNeedsContainers(withProjects(['unit', 'unit-browser']))).toBe(false);
    expect(runNeedsContainers(withProjects(['unit']))).toBe(false);
    expect(runNeedsContainers(withProjects(['unit-browser']))).toBe(false);
  });

  it('starts them for anything that talks to a real server', () => {
    expect(runNeedsContainers(withProjects(['integration']))).toBe(true);
    expect(runNeedsContainers(withProjects(['e2e']))).toBe(true);
    // A mixed selection needs them: one project that does is enough.
    expect(runNeedsContainers(withProjects(['unit', 'integration']))).toBe(true);
  });

  it('starts them when no project was selected at all', () => {
    // A bare `vitest run` runs everything, integration included.
    expect(runNeedsContainers(withProjects([]))).toBe(true);
    expect(runNeedsContainers(withProjects(undefined))).toBe(true);
    expect(runNeedsContainers({})).toBe(true);
    expect(runNeedsContainers(undefined)).toBe(true);
  });

  it('starts them for a filter it cannot read literally', () => {
    // `--project` takes globs and negation. `!e2e` selects integration among
    // others, and a naive "is it in the container-free list?" test would answer
    // no and skip the database out from under it. Unrecognised means "start them".
    expect(runNeedsContainers(withProjects(['!e2e']))).toBe(true);
    expect(runNeedsContainers(withProjects(['unit*']))).toBe(true);
    expect(runNeedsContainers(withProjects(['!unit']))).toBe(true);
    // A project added later that nobody thought to classify here.
    expect(runNeedsContainers(withProjects(['unit', 'contract']))).toBe(true);
  });

  it('starts them when the filter is not a list of strings', () => {
    // Defensive rather than speculative: this reads a field out of Vitest's
    // resolved config, and the safe answer to a shape we did not expect is the
    // one that cannot break a test run.
    expect(runNeedsContainers(withProjects('unit'))).toBe(true);
    expect(runNeedsContainers(withProjects([123]))).toBe(true);
    expect(runNeedsContainers(withProjects([null]))).toBe(true);
  });
});
