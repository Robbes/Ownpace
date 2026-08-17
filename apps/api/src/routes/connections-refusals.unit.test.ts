// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The two connections refusals a person actually meets (workplan 0071).
 *
 * Both were authored as finished English sentences on the route, and both
 * reached the owner's Dutch phone untranslated. That is not a translation bug
 * to fix in the client — `docs/i18n-prose-boundary.md` draws the line: a
 * FINDING renders verbatim, a FRAME the client authors and localizes. What
 * these routes were serving was a frame wrapped around a finding, welded
 * shut, so the client could render all of it or none of it.
 *
 * So the contract is what is pinned here: the machine-readable half must
 * survive, because that half is the only thing a Dutch screen can build a
 * Dutch sentence out of. `reason` stays English on purpose — an API consumer
 * with no dictionary is the one audience the old string genuinely served —
 * and these tests deliberately do NOT pin its wording, which is the client's
 * to stop depending on.
 */

import { describe, it, expect } from 'vitest';
import { credentialFieldsFor } from '@openmig/shared';
import { missingFieldsRefusal } from './connections';

describe('the missing-fields refusal', () => {
  it('carries the field KEYS as data, not only inside a sentence', () => {
    const refusal = missingFieldsRefusal(['clientId', 'clientSecret']);

    expect(refusal.error).toBe('missing_fields');
    // The half that matters: a client can look each of these up in the same
    // descriptor the route validated against and render its own label.
    expect(refusal.fields).toEqual(['clientId', 'clientSecret']);
  });

  it('keeps an English sentence for callers with no dictionary', () => {
    expect(missingFieldsRefusal(['clientId']).reason).toContain('clientId');
  });

  /**
   * The keys are only useful if the descriptor can name them. This is the
   * join the whole contract rests on: the route derives `missing` from
   * `credentialFieldsFor`, so every key it can emit is one the client can
   * resolve to a label — and `descriptor-labels-resolve.unit.test.ts` then
   * proves every one of those labels exists in BOTH locales.
   */
  it('can only ever name keys the shared descriptor also names', () => {
    const dropbox = credentialFieldsFor('source', 'dropbox');
    const emitted = dropbox.filter((f) => f.required).map((f) => f.key);

    expect(emitted).toContain('clientId');
    for (const key of missingFieldsRefusal(emitted).fields) {
      expect(
        dropbox.find((f) => f.key === key),
        `the refusal can name '${key}', which the descriptor cannot label`,
      ).toBeDefined();
    }
  });
});
