// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import DiscoveryCounts, { formatBytes } from './DiscoveryCounts.tsx';

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
    render(<DiscoveryCounts domains={[]} expected={['email', 'calendar']} />);
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
    expect(note).toHaveTextContent(/migrate with the rest/);
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

/**
 * A TABLE THAT IS STILL FILLING IN MUST NOT READ AS FINISHED (2026-09-07).
 *
 * Discovery lands one domain at a time. The old `scanning` boolean went false
 * at the FIRST one, so from then on this table presented whatever had arrived
 * as the whole answer: the owner's four-domain migration settled on three
 * rows, with nothing on the page saying a fourth was coming, and he found it
 * by reloading the browser himself.
 *
 * Three rows and a sentence is an honest partial answer. Three rows alone is a
 * wrong complete one.
 */
describe('the rows that have not landed yet', () => {
  it('names the domains still being counted, beside the ones that have', () => {
    render(
      <DiscoveryCounts
        domains={[record({ domain: 'calendar' }), record({ domain: 'contact' })]}
        expected={['calendar', 'contact', 'file', 'task']}
      />,
    );

    // The counts that arrived are shown — waiting is not a reason to hide them.
    expect(screen.getByText('Calendar')).toBeInTheDocument();
    // And the two that have not are named, not merely counted: "2 to go" does
    // not tell somebody whether the number they came for is in yet.
    expect(screen.getByRole('status')).toHaveTextContent(/Still counting: Files, Tasks/);
  });

  it('says nothing once every expected domain has answered', () => {
    render(
      <DiscoveryCounts
        domains={[record({ domain: 'calendar' }), record({ domain: 'file' })]}
        expected={['calendar', 'file']}
      />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('treats a domain that answered with an error as landed', () => {
    // `lastError` is a final answer and its row already carries it verbatim.
    // Waiting on it for ever would be the same silence in a new place.
    render(
      <DiscoveryCounts
        domains={[record({ domain: 'calendar' }), record({ domain: 'file', lastError: '401' })]}
        expected={['calendar', 'file']}
      />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('401')).toBeInTheDocument();
  });

  it('waits only for what this migration carries, never for all five', () => {
    // The screen-side twin of the preflight's own defect: a mapping carrying
    // no mail must not sit under a permanent "still counting: Email".
    render(
      <DiscoveryCounts
        domains={[record({ domain: 'calendar' }), record({ domain: 'file' })]}
        expected={['calendar', 'file']}
      />,
    );
    expect(screen.queryByText(/Email/)).not.toBeInTheDocument();
  });

  it('says nothing about waiting when the caller cannot say what to expect', () => {
    // The historical-snapshot case: a domain absent from an old record is
    // missing from the record, not in flight.
    render(<DiscoveryCounts domains={[record({ domain: 'calendar' })]} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says the longer sentence once the caller has stopped waiting', () => {
    render(
      <DiscoveryCounts
        domains={[record({ domain: 'calendar' })]}
        expected={['calendar', 'file']}
        slow
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/Still counting: Files/);
    expect(status).toHaveTextContent(/Taking longer than usual/);
    // Never an error: nothing is known to have gone wrong (hard rule 9).
    expect(status).not.toHaveTextContent(/failed|error|wrong/i);
  });
});


/**
 * A COUNT AND AN ERROR IN ONE ROW (2026-09-08).
 *
 * `recordDiscoveryError` keeps whatever counts a prior successful pass
 * recorded — the right call, since throwing a good number away because the
 * next attempt could not be made loses more than it saves. But the row that
 * comes back then carries both, and the table alone gives the reader no way to
 * tell which of the two is current. The owner's Microsoft preflight showed him
 * `3430 / 95,734 / 21.6 GB` beside a red rate-budget error on 2026-09-08, with
 * nothing to say the count was a week old and the failure was minutes old.
 */
describe('the numbers that came from an earlier check', () => {
  it('names the domain whose count predates the error beside it', () => {
    render(
      <DiscoveryCounts
        domains={[
          record({ domain: 'calendar', collections: 2, items: 30 }),
          record({
            domain: 'file',
            collections: 3430,
            items: 95_734,
            bytes: 23_193_571_328,
            lastError: 'relation "rate_budget" does not exist',
          }),
        ]}
      />,
    );

    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/Numbers for Files are from an earlier check/);
    expect(note).toHaveTextContent(/the latest one failed/);
    // Named, not blanket: the calendar row's count IS this attempt's, and
    // casting doubt on it would be the same dishonesty pointing the other way.
    expect(note).not.toHaveTextContent(/Calendar/);
    // The count itself stays on screen — it is real, just older.
    expect(screen.getByText('95734')).toBeInTheDocument();
    // …and so does the error, verbatim.
    expect(screen.getByText('relation "rate_budget" does not exist')).toBeInTheDocument();
  });

  it('says nothing when a failed domain had no earlier count to keep', () => {
    // `recordDiscoveryError` writes zeroes when no pass ever succeeded. That
    // row's error is its whole answer, and "from an earlier check" would
    // invent an earlier check.
    render(
      <DiscoveryCounts
        domains={[record({ domain: 'task', collections: 0, items: 0, lastError: 'Tasks.Read not granted' })]}
      />,
    );
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByText('Tasks.Read not granted')).toBeInTheDocument();
  });

  it('says nothing when every domain answered this time', () => {
    render(<DiscoveryCounts domains={[record({ domain: 'file' })]} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
