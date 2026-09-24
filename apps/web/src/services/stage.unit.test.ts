// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The alpha note's rule (workplan 0131 T1), as a pure function: on only for
 * `alpha`, never on the appliance. The same rule the API applies to the grant
 * mail (`alphaFrom` in apps/api/src/access-notify.ts). The pages themselves are
 * `components/an-alpha-said-out-loud.unit.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { alphaFrom } from './stage.ts';

describe('alphaFrom', () => {
  it('is on for alpha, trimmed and in any case, because a typo must not switch it off quietly', () => {
    expect(alphaFrom('alpha', false)).toBe(true);
    expect(alphaFrom(' Alpha ', false)).toBe(true);
  });

  it('is off when unset, empty, or anything else', () => {
    for (const stage of [undefined, '', ' ', 'beta', 'alpha1', true, 1]) {
      expect(alphaFrom(stage, false)).toBe(false);
    }
  });

  it('is never on for the appliance, whatever its bundle was built with', () => {
    expect(alphaFrom('alpha', true)).toBe(false);
  });
});
