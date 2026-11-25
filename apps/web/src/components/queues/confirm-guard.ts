// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * How long a confirming click is ignored after a two-press button arms
 * (ADR-0024, 2026-11-21 for *Delete N*; workplan 0173 T0 for the single
 * press): a click this soon is the end of a double click, not a decision.
 *
 * `confirmGuard.ms` is the value `ConfirmButton` reads, and the one test
 * seam: `apps/web/src/test-setup.ts` sets it to 0, because the component
 * tests press arm and confirm in the same tick to test what the press does,
 * and `primitives.unit.test.tsx` sets it back to `CONFIRM_GUARD_MS` to test
 * the guard itself. Nothing in the app changes it.
 */
export const CONFIRM_GUARD_MS = 800;

export const confirmGuard: { ms: number } = { ms: CONFIRM_GUARD_MS };
