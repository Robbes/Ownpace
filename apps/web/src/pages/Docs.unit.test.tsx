// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The in-app setup guides (workplan 0063).
 *
 * The point is that a reference like "docs/box-setup.md" becomes something a
 * managed customer in a browser can actually open, and that the text they read
 * is the repository's own — shipped with the code that implements it, so it
 * cannot drift from the connector. These tests read the REAL guides through
 * the same build-time import the page uses, so a renamed or deleted document
 * fails here rather than 404ing for a customer.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import Docs from './Docs';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/:slug" element={<Docs />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the in-app setup guides', () => {
  it('renders the repository\'s own Box guide, not a copy of it', () => {
    renderAt('/docs/box-setup');

    // A sentence that exists only in docs/box-setup.md, and which is the whole
    // reason a Box setup stalls (workplan 0056).
    expect(screen.getByText(/Custom Apps Manager/)).toBeTruthy();
  });

  it('ships a guide for each provider that has one', () => {
    renderAt('/docs');

    for (const slug of ['box-setup', 'dropbox-setup', 'google-workspace-setup', 'o365-setup']) {
      expect(screen.getByText(slug), `${slug} is referenced by the UI`).toBeTruthy();
    }
  });

  it('names what DOES exist when a reference is stale, rather than a bare 404', () => {
    renderAt('/docs/no-such-guide');

    expect(screen.getByText(/no guide by that name/)).toBeTruthy();
    expect(screen.getByText('box-setup')).toBeTruthy();
  });
});
