// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The failure a customer can act on (workplan 0110 T3).
 *
 * The owner's reframing made the CUSTOMER the primary reader — *"most of it
 * must be self-service. I'm to be contacted in rare / edge cases."* So the
 * property under test is not "a category is stored" but **"a person reading
 * this screen is told what to do"**, and the two are not the same: a label
 * rendered where a sentence belongs is exactly the failure this task exists
 * to avoid.
 *
 * The provider's own words stay on the screen beside it. That is the older
 * rule (the prose boundary) and it still holds — precision for whoever needs
 * it, the way out for whoever does not.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LiveProgress from './LiveProgress.tsx';
import type { LiveProgressRow } from './LiveProgress.tsx';
import { STRINGS, LOCALES } from '../i18n/strings.ts';
import { FAILURE_CATEGORIES } from '@openmig/shared';

const row = (over: Partial<LiveProgressRow> = {}): LiveProgressRow => ({
  domain: 'email',
  state: 'failed',
  itemsSynced: 12,
  itemsFailed: 1,
  itemsRetrying: 0,
  ...over,
});

describe('a failed domain says what to do about it', () => {
  it('renders the remedy sentence, not the category name', () => {
    render(
      <LiveProgress
        domains={[row({ lastErrorCategory: 'auth_expired', lastError: 'invalid_grant' })]}
      />,
    );
    // The word a customer cannot act on must not be what they are shown.
    expect(screen.queryByText('auth_expired')).toBeNull();
    expect(screen.getByText(/Reconnect it on the Connections page/i)).toBeTruthy();
  });

  it('keeps the provider prose VERBATIM beside it — both, not one', () => {
    const raw = '{"error":"invalid_grant","error_description":"Token has been expired."}';
    render(<LiveProgress domains={[row({ lastErrorCategory: 'auth_expired', lastError: raw })]} />);
    expect(screen.getByText(raw)).toBeTruthy();
    expect(screen.getByText(/Reconnect it on the Connections page/i)).toBeTruthy();
  });

  it('renders the prose alone when nothing was classified', () => {
    // Rows written before this shipped have no category. They must not lose
    // the error they always showed.
    render(<LiveProgress domains={[row({ lastError: 'something went wrong' })]} />);
    expect(screen.getByText('something went wrong')).toBeTruthy();
  });

  it("unknown carries the way OUT of self-service, not a shrug", () => {
    // The one category whose whole job is to end the self-service attempt
    // honestly rather than leave somebody staring at a blank.
    render(<LiveProgress domains={[row({ lastErrorCategory: 'unknown', lastError: 'x' })]} />);
    expect(screen.getByText(/send it to us/i)).toBeTruthy();
  });
});

describe('every category can be said, in both languages', () => {
  it('has a non-empty sentence for all six in en and nl', () => {
    // A category with no sentence reaches a screen with nothing to say. The
    // Record<FailureCategory, StringKey> in the component makes a MISSING key
    // a typecheck failure; this makes an EMPTY one a test failure.
    const keys = {
      auth_expired: 'failure.authExpired',
      rate_limited: 'failure.rateLimited',
      quota_exceeded: 'failure.quotaExceeded',
      target_refused: 'failure.targetRefused',
      network: 'failure.network',
      unknown: 'failure.unknown',
    } as const;
    for (const category of FAILURE_CATEGORIES) {
      for (const locale of LOCALES) {
        const sentence = STRINGS[locale][keys[category]];
        expect(sentence, `${category} in ${locale}`).toBeTruthy();
        // A sentence, not a label: the remedy is the product.
        expect(sentence.length, `${category} in ${locale} is too short to be a remedy`)
          .toBeGreaterThan(30);
      }
    }
  });

  it('never shows a raw category token in either language', () => {
    for (const locale of LOCALES) {
      for (const category of FAILURE_CATEGORIES) {
        for (const [, sentence] of Object.entries(STRINGS[locale])) {
          expect(sentence).not.toBe(category);
        }
      }
    }
  });
});
