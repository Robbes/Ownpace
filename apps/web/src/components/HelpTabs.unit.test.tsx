// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HELP'S TWO TABS (workplan 0153 T3 (c)): the setup checklist and the setup
 * guides, for a member, whose menu says *Help* once. Neither on the appliance,
 * whose menu keeps both entries, nor for an operator in no organisation, whom
 * the checklist would refuse.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { editionFlag, authState } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  authState: { tenantCount: 1 },
}));
vi.mock('../services/edition', () => ({ isSelfHost: () => editionFlag.selfhost }));
vi.mock('../stores/auth-store', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

import { HelpTabs } from './HelpTabs.tsx';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <HelpTabs />
    </MemoryRouter>,
  );

beforeEach(() => {
  editionFlag.selfhost = false;
  authState.tenantCount = 1;
});

describe('Help, one entry with two tabs (0153 T3 (c))', () => {
  it('offers the checklist and the guides, and says which is open', () => {
    renderAt('/docs');
    const tabs = screen.getByRole('navigation', { name: 'Help' });
    const checklist = screen.getByRole('link', { name: 'Setup checklist' });
    const guides = screen.getByRole('link', { name: 'Setup guides' });
    expect(tabs).toContainElement(checklist);
    expect(checklist).toHaveAttribute('href', '/setup');
    expect(guides).toHaveAttribute('href', '/docs');
    expect(guides).toHaveAttribute('aria-current', 'page');
    expect(checklist).not.toHaveAttribute('aria-current');
  });

  it('marks the checklist open on the checklist', () => {
    renderAt('/setup');
    expect(screen.getByRole('link', { name: 'Setup checklist' })).toHaveAttribute('aria-current', 'page');
  });

  it('is not on the appliance, whose menu keeps both entries', () => {
    editionFlag.selfhost = true;
    const { container } = renderAt('/setup');
    expect(container).toBeEmptyDOMElement();
  });

  it('is not there for somebody in no organisation, whom the checklist would refuse', () => {
    authState.tenantCount = 0;
    const { container } = renderAt('/docs');
    expect(container).toBeEmptyDOMElement();
  });
});
