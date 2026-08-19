// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The confirm/green-light screen at a real URL (0037 T2).
 *
 * What this pins: the route param reaches ConfirmMigration as its mappingId,
 * and starting navigates back to the list. The screen's own behaviour
 * (discovery kick-off, counts, the explicit start) lives in
 * ConfirmMigration.unit.test.tsx — here the component is a marker, because
 * the thing under test is that a PAUSED mapping's green light now survives a
 * refresh: create → refresh → this URL still renders the confirm screen.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { describe, it, expect, vi } from 'vitest';
import ConfirmMapping from './ConfirmMapping.tsx';

vi.mock('../components/ConfirmMigration', () => ({
  ConfirmMigration: ({ mappingId, onStarted }: { mappingId: string; onStarted: () => void }) => (
    <div>
      <span>confirm-screen-for:{mappingId}</span>
      <button onClick={onStarted}>fake-start</button>
    </div>
  ),
}));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/mappings/:mappingId/confirm" element={<ConfirmMapping />} />
        <Route path="/mappings" element={<div>mappings-list</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('ConfirmMapping — the green light has an address', () => {
  it('renders ConfirmMigration for the mapping in the URL (a paused mapping is startable after refresh)', () => {
    renderAt('/mappings/paused-one/confirm');

    expect(screen.getByText('confirm-screen-for:paused-one')).toBeInTheDocument();
  });

  it('returns to the list once the migration is started', () => {
    renderAt('/mappings/paused-one/confirm');

    fireEvent.click(screen.getByText('fake-start'));
    expect(screen.getByText('mappings-list')).toBeInTheDocument();
  });
});
