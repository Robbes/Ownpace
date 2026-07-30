// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The discovery counts table (ADR-0026).
 *
 * This component replaced two implementations of the same table — one in
 * hand-rolled HTML in the appliance, one in JSX for managed — so these tests
 * inherit the job both of them had: making sure the customer is told the two
 * things that change what they end up with, BEFORE they press start.
 *
 * They are not cosmetic warnings. One says we will write a Message-ID onto
 * their copy; the other says the destination already has items we will adopt
 * rather than overwrite. The confirm screen is the last moment either can be
 * objected to.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DiscoveryRecord } from '@openmig/shared';
import DiscoveryCounts, { formatBytes } from './DiscoveryCounts';

function record(over: Partial<DiscoveryRecord> = {}): DiscoveryRecord {
  return {
    domain: 'email',
    collections: 3,
    items: 120,
    discoveredAt: '2026-07-30T00:00:00Z',
    ...over,
  };
}

describe('the counts', () => {
  it('shows a scanning message rather than an empty table before the first pass', () => {
    render(<DiscoveryCounts domains={[]} scanning />);
    expect(screen.getByRole('status')).toHaveTextContent(/Scanning your source/);
  });

  it('renders each domain', () => {
    render(<DiscoveryCounts domains={[record(), record({ domain: 'file', items: 7 })]} />);
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
  });

  it('shows an em dash, never 0, when the destination could not be enumerated', () => {
    // "0" would tell the customer their destination is empty when we simply did
    // not look. Absent is not zero (hard rule 9).
    //
    // `bytes` is set so the Size column is not ALSO an em dash — the point is
    // that the destination column specifically declines to invent a number.
    render(<DiscoveryCounts domains={[record({ bytes: 2048, targetExisting: undefined })]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0 B')).not.toBeInTheDocument();
  });

  it('shows the adoption count when the destination already holds matching items', () => {
    render(<DiscoveryCounts domains={[record({ targetExisting: 40, targetColliding: 12 })]} />);
    expect(screen.getByText('40 (12 kept as-is)')).toBeInTheDocument();
  });

  it('surfaces a domain error verbatim rather than summarising it', () => {
    render(<DiscoveryCounts domains={[record({ lastError: 'connector auth failed: 401' })]} />);
    expect(screen.getByText('connector auth failed: 401')).toBeInTheDocument();
  });
});

describe('the two things the customer has to be told', () => {
  it('warns that generated Message-IDs are written to THEIR COPY, not the original', () => {
    render(<DiscoveryCounts domains={[record({ generatedIdItems: 4 })]} />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/4 messages arrived without a Message-ID/);
    // The distinction that stops this reading as "we modify your old server".
    expect(note).toHaveTextContent(/the copy on your new server/);
    expect(note).toHaveTextContent(/original on your old server is not changed/);
    // And that they are still migrated — otherwise it reads as items being lost.
    expect(note).toHaveTextContent(/are.*included in the counts above/);
  });

  it('warns that matching items on the destination are KEPT, not overwritten', () => {
    render(<DiscoveryCounts domains={[record({ targetExisting: 9, targetColliding: 9 })]} />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/keep the destination.s copy/);
    expect(note).toHaveTextContent(/not overwrite it/);
  });

  it('says neither when neither applies', () => {
    render(<DiscoveryCounts domains={[record()]} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('counts across every domain, not just the first', () => {
    render(
      <DiscoveryCounts
        domains={[record({ generatedIdItems: 2 }), record({ domain: 'file', generatedIdItems: 3 })]}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(/5 messages/);
  });
});

describe('formatBytes', () => {
  it('says em dash for unknown rather than 0 B', () => {
    expect(formatBytes(undefined)).toBe('—');
  });

  it('scales', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
});
