// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILURE WITH ITS REFERENCE (workplan 0129 T1): the progress strip shows
 * the reference a failed data type's failure was recorded under, the thing a
 * person quotes, which finds the operator's log row and the server's line
 * with the whole message. A reference of the wrong shape never reaches it.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LiveProgress, { type LiveProgressRow } from './LiveProgress.tsx';
import { STRINGS } from '../i18n/strings.ts';
import { MappingDomainStatusSchema } from '../services/mapping-service.ts';

const row = (over: Partial<LiveProgressRow> = {}): LiveProgressRow => ({
  domain: 'calendar',
  state: 'failed',
  itemsSynced: 12,
  itemsFailed: 0,
  itemsRetrying: 0,
  lastErrorCategory: 'unknown',
  lastError: 'PROPFIND answered 500',
  ...over,
});

describe('the progress strip', () => {
  it("shows a failure's reference under its message", () => {
    render(<LiveProgress domains={[row({ lastErrorReference: '0a1b2c3d' })]} />);

    expect(
      screen.getByText(STRINGS.en['failure.reference'].replace('{reference}', '0a1b2c3d')),
    ).toBeVisible();
  });

  it('shows no reference line for a failure that has none', () => {
    render(<LiveProgress domains={[row()]} />);

    expect(screen.queryByText(/Reference:/)).toBeNull();
  });
});

describe('what the page accepts as a reference', () => {
  const payload = (lastErrorReference: string) => ({
    domain: 'calendar',
    state: 'failed',
    itemsSynced: 0,
    itemsFailed: 0,
    bytesTransferred: 0,
    itemsRetrying: 0,
    itemsNeedingDecision: 0,
    lastErrorReference,
  });

  it('keeps eight hex characters: the schema lists its keys, and one it did not list would be dropped', () => {
    expect(MappingDomainStatusSchema.parse(payload('0a1b2c3d')).lastErrorReference).toBe('0a1b2c3d');
  });

  it('drops one of any other shape, and keeps the failure', () => {
    const parsed = MappingDomainStatusSchema.parse(payload('see the log'));

    expect(parsed.state).toBe('failed');
    expect(parsed.lastErrorReference).toBeUndefined();
  });
});
