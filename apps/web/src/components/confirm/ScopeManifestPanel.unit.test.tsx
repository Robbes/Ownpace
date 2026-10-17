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
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { LocaleProvider } from '../../i18n/index.tsx';
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
    // In a router, as on every screen that shows it: a row may link its guide
    // (0148 T7).
    render(
      <MemoryRouter>
        <ScopeManifestPanel manifest={SCOPE_MANIFEST} />
      </MemoryRouter>,
    );
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
    // The shared-mailbox row's guide, under its column rather than a file
    // name in the row (0148 T7), and Google Photos' Takeout route (2026-10-14).
    const guides = screen.getAllByRole('link', { name: /^Guide: / }).map((a) => a.getAttribute('href'));
    expect(guides).toContain('/docs/microsoft#application');
    expect(guides).toContain('/docs/google#photos');
  });
});

describe('in the reader\'s language (2026-10-14)', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem('ownpace.locale');
  });

  const inLocale = (locale: 'en' | 'nl', panel: ScopeManifest) => {
    window.localStorage.setItem('ownpace.locale', locale);
    return render(
      <MemoryRouter>
        <LocaleProvider>
          <ScopeManifestPanel manifest={panel} />
        </LocaleProvider>
      </MemoryRouter>,
    );
  };

  it('shows each row of the real manifest in Dutch under nl, its fold included', () => {
    inLocale('nl', SCOPE_MANIFEST);
    for (const column of ['migrates', 'partial', 'doesNotMigrate'] as const) {
      for (const entry of SCOPE_MANIFEST[column]) {
        expect(entry.nl, `"${entry.item}" has no Dutch`).toBeDefined();
        expect(screen.getAllByText(entry.nl!.detail, { exact: false }).length).toBeGreaterThan(0);
        if (entry.nl!.more !== undefined) {
          expect(screen.getAllByText(entry.nl!.more).length).toBeGreaterThan(0);
        }
      }
    }
    // The column titles and the fold are the dictionary's, in Dutch too.
    expect(screen.getAllByText('Meer').length).toBeGreaterThan(0);
    // And no English line is left on the Dutch screen.
    expect(screen.queryByText('Address books and contacts.', { exact: false })).toBeNull();
  });

  it('shows the English as served, said as English, for a row with no Dutch', () => {
    inLocale(
      'nl',
      manifest({ migrates: [{ item: 'Email', detail: 'Only in English.' }] }),
    );
    const row = screen.getByText(/Only in English/);
    expect(row.closest('li')).toHaveAttribute('lang', 'en');
  });

  it('shows the English under en, whatever Dutch the row carries', () => {
    inLocale(
      'en',
      manifest({
        migrates: [{ item: 'Email', detail: 'In English.', nl: { item: 'E-mail', detail: 'In het Nederlands.' } }],
      }),
    );
    expect(screen.getByText(/In English/)).toBeVisible();
    expect(screen.queryByText(/In het Nederlands/)).toBeNull();
  });
});

describe('a column with nothing in it (UX sweep, 2026-10-17)', () => {
  /**
   * The shared mailbox's Review screen showed *Does not migrate* with nothing
   * under it, which reads as unfinished. An empty list says only that it is
   * empty for this source: not that nothing at all is left behind, which the
   * list cannot prove.
   */
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem('ownpace.locale');
  });

  it('says nothing is listed under an empty column, and only there', () => {
    render(
      <ScopeManifestPanel
        manifest={manifest({
          migrates: [{ item: 'Email', detail: 'Every folder.' }],
          partial: [{ item: 'Rules', detail: 'Some.' }],
        })}
      />,
    );
    const said = screen.getAllByText('Nothing listed for this source.');
    expect(said).toHaveLength(1);
    // Under the column it belongs to, beside its title.
    expect(said[0]!.parentElement).toHaveTextContent(/^Does not migrate/);
  });

  it('says it in Dutch under nl', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    render(
      <LocaleProvider>
        <ScopeManifestPanel manifest={manifest({ migrates: [{ item: 'Email', detail: 'Every folder.' }] })} />
      </LocaleProvider>,
    );
    // Partial and Does not migrate are both empty here.
    expect(screen.getAllByText('Voor deze bron is hier niets vermeld.')).toHaveLength(2);
  });
});

describe('a column’s guide, after its rows (the UX sweep’s follow-ups)', () => {
  /**
   * On step 6 of Start a migration, *Does not migrate* for Google showed
   * Google Photos' guide link between its *More* and the next row, *Google
   * Sites and Forms*, which then read as if it belonged under the link. The
   * guide is the column's to offer: after every row, once.
   */
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem('ownpace.locale');
  });

  const google = manifest({
    doesNotMigrate: SCOPE_MANIFEST.doesNotMigrate.filter((e) => e.appliesTo?.includes('google')),
  });

  for (const locale of ['en', 'nl'] as const) {
    it(`${locale}: renders Google's Does not migrate rows first, then the guide`, () => {
      window.localStorage.setItem('ownpace.locale', locale);
      render(
        <MemoryRouter>
          <LocaleProvider>
            <ScopeManifestPanel manifest={google} />
          </LocaleProvider>
        </MemoryRouter>,
      );
      const guide = screen.getByRole('link', { name: locale === 'en' ? /^Guide: Google/ : /^Handleiding: Google/ });
      expect(guide.getAttribute('href')).toBe('/docs/google#photos');
      expect(guide.closest('li'), 'the guide sits inside a row').toBeNull();
      const rows = screen.getAllByRole('listitem');
      // Google Keep, Google Photos and Google Sites and Forms at least, the
      // last of them before the link.
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const row of rows) {
        expect(
          row.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING,
          `"${row.textContent}" comes after the guide`,
        ).toBeTruthy();
      }
    });
  }

  it('offers a guide two rows share once, and only in their column', () => {
    render(
      <MemoryRouter>
        <ScopeManifestPanel
          manifest={manifest({
            migrates: [{ item: 'Email', detail: 'Every folder.' }],
            doesNotMigrate: [
              { item: 'Google Photos', detail: 'Not with a sign-in.', guide: 'google#photos' },
              { item: 'Google Keep', detail: 'Not migrated.' },
              { item: 'Photos again', detail: 'Same guide.', guide: 'google#photos' },
            ],
          })}
        />
      </MemoryRouter>,
    );
    const guides = screen.getAllByRole('link', { name: /^Guide: / });
    expect(guides).toHaveLength(1);
    expect(guides[0]!.closest('div')).toHaveTextContent(/^Does not migrate/);
  });
});
