// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Ending the service says what it will not touch (workplan 0085 T6).
 *
 * Somebody calling `DELETE /api/tenants/:id` is trying to end the
 * relationship. The refusal already tells them where to go instead; what it did
 * not tell them is what closing does to the two mailboxes they actually care
 * about — and "delete my data" is the one phrase a person could reasonably read
 * as meaning we take the migrated mail back out of their new account.
 *
 * Tested through the exported builder rather than over HTTP because the body is
 * a pure value and standing up Postgres to read one JSON object proves nothing
 * extra. The close response carries the same text and is asserted in
 * `tenants.integration.test.ts`, where a database is actually needed.
 */

import { describe, it, expect } from 'vitest';
import { deleteTenantRefusal } from './index.ts';
import { erasureScopeText, erasureNeverTouches } from '@openmig/shared';

describe('the refusal that redirects to close', () => {
  const body = deleteTenantRefusal();

  it('still says where to go instead (rule 9)', () => {
    expect(body.error).toBe('use_close');
    expect(body.reason).toContain('/close');
  });

  it('also says what erasure will never touch', () => {
    expect(body.neverTouched).toBe(erasureScopeText('en'));
  });

  it('and that text covers both the source and the target', () => {
    for (const boundary of erasureNeverTouches('en')) {
      expect(body.neverTouched).toContain(boundary.heading);
    }
  });

  it('names the ambiguity rather than leaving the reader to resolve it', () => {
    expect(body.neverTouched).toMatch(/Delete my data/i);
    expect(body.neverTouched).toMatch(/our data about you/i);
  });
});
