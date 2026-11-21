// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE BANNER AND THE BADGE OF A TEST MIGRATION (workplan 0162 T1), in the
 * reader's language. Where the banner is drawn, on every page of a test
 * migration, is `every-page-of-a-test-migration.unit.test.tsx`'s subject.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import { TestBadge, TestMigrationBanner } from './TestMigration.tsx';

const inLocale = (locale: 'en' | 'nl', ui: React.ReactNode) => {
  window.localStorage.setItem('ownpace.locale', locale);
  return render(<LocaleProvider>{ui}</LocaleProvider>);
};

beforeEach(() => window.localStorage.clear());

describe('the banner', () => {
  it('says the marker, drawn as code, and that the migration cannot be finished, in English', () => {
    inLocale('en', <TestMigrationBanner marker="[Ownpace-test]" />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(
      'Test: only items whose title contains [Ownpace-test] are copied. This migration cannot be finished.',
    );
    expect(note.querySelector('code')).toHaveTextContent(/^\[Ownpace-test\]$/);
  });

  it('and in Dutch, with the migration’s own marker, whatever it is', () => {
    inLocale('nl', <TestMigrationBanner marker="TEST-ONLY" />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Test: alleen items waarvan de titel TEST-ONLY bevat, worden gemigreerd. Deze migratie kan niet worden afgerond.',
    );
  });

  it('is nothing for a migration that is not a test', () => {
    const { container } = inLocale('en', <TestMigrationBanner marker={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has the marker in one place in each language’s sentence', () => {
    for (const locale of ['en', 'nl'] as const) {
      expect(STRINGS[locale]['testMigration.banner'].split('{marker}')).toHaveLength(2);
    }
  });
});

describe('the badge', () => {
  it('says Test in either language, with the marker as its title', () => {
    for (const locale of ['en', 'nl'] as const) {
      const { unmount } = inLocale(locale, <TestBadge marker="[Ownpace-test]" />);
      const badge = document.querySelector('[data-test-badge]');
      expect(badge).toHaveTextContent(STRINGS[locale]['testMigration.badge']);
      expect(badge).toHaveAttribute('title', '[Ownpace-test]');
      unmount();
    }
  });

  it('is nothing for a migration that is not a test', () => {
    const { container } = inLocale('en', <TestBadge marker={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
