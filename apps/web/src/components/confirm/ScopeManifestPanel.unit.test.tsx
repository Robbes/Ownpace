// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE SCOPE MANIFEST, READ AT A GLANCE (owner, 2026-09-17).
 *
 * *"the explaining tekst about 'Migrates' in green, 'Partial' in orange and
 * 'Does not migrate' in grey contain alot of tekst. Please compres/rewrite to
 * contain the Essentials."*
 *
 * Four rows had grown to five and six lines each, so the screen where somebody
 * decides whether to start met them with three columns of paragraphs — and the
 * longest rows were the ones carrying the caveats most worth reading, which is
 * the worst way round.
 *
 * The answer is 0118 T1's rule rather than the delete key: one line on screen,
 * the rest behind a native fold. So what this file pins is both halves — the
 * line is short AND the rest is still reachable, because a disclosure
 * compressed out of existence is what §11.2 forbids.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SCOPE_MANIFEST, type ScopeManifest } from '@openmig/shared';
import ScopeManifestPanel from './ScopeManifestPanel.tsx';

const manifest = (over: Partial<ScopeManifest> = {}): ScopeManifest => ({
  version: 'test',
  migrates: [],
  partial: [],
  doesNotMigrate: [],
  ...over,
});

describe('one line per row, the rest folded', () => {
  it('shows the essential and hides the rest until it is asked for', () => {
    render(
      <ScopeManifestPanel
        manifest={manifest({
          migrates: [
            { item: 'Contacts', detail: 'Address books and contacts.', more: 'The long tail.' },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Address books and contacts/)).toBeVisible();
    // Present and NOT visible: a native `<details>`, so it is one click away
    // and nothing was deleted to make the column readable.
    expect(screen.getByText('The long tail.')).not.toBeVisible();
    expect(screen.getByText('More')).toBeVisible();
  });

  it('offers no fold on a row that has nothing folded', () => {
    render(
      <ScopeManifestPanel
        manifest={manifest({ doesNotMigrate: [{ item: 'Planner', detail: 'Not migrated.' }] })}
      />,
    );
    expect(screen.getByText(/Not migrated/)).toBeVisible();
    expect(screen.queryByText('More')).toBeNull();
  });

  it('renders the REAL manifest with every long row folded', () => {
    // The fixtures above prove the component; this proves the content it is
    // given. A row that grows back to six lines on screen is the owner's
    // complaint returning, and it would return in `detail`.
    render(<ScopeManifestPanel manifest={SCOPE_MANIFEST} />);
    for (const column of ['migrates', 'partial', 'doesNotMigrate'] as const) {
      for (const entry of SCOPE_MANIFEST[column]) {
        expect(
          entry.detail.length,
          `"${entry.item}" is ${entry.detail.length} characters on screen; ` +
            'the essential belongs in `detail` and the rest in `more`',
        ).toBeLessThanOrEqual(90);
      }
    }
    // And the folds are there, unopened.
    const folds = screen.getAllByText('More');
    expect(folds.length).toBeGreaterThan(0);
    for (const fold of folds) expect(fold).toBeVisible();
  });
});
