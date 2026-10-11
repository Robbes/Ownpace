// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE OPERATOR'S SCREENS ARE IN ENGLISH (ADR-0013, amended 2026-10-11).
 *
 * The owner, who is the operator: *"for me as operator English would suffice;
 * multi language is only important for end users."* So the support screens,
 * the access queue and the redirect URIs keep their words in
 * `operator-strings.ts`, English only, and the bilingual dictionary holds none
 * of them. What can go wrong is a key in both tables, which would say two
 * things, or a screen that turns Dutch inside an English page because a shared
 * button on it follows the app's language. Both are pinned here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { STRINGS } from './strings.ts';
import { OPERATOR_STRINGS } from './operator-strings.ts';
import { EnglishOnly, LocaleProvider, useLocale, useOperatorT, useT } from './index.tsx';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('one table or the other, never both', () => {
  it('has no operator key in the bilingual dictionary', () => {
    const both = Object.keys(OPERATOR_STRINGS).filter((k) => k in STRINGS.en || k in STRINGS.nl);
    expect(both).toEqual([]);
  });

  it('holds the three screens and their menu entries', () => {
    const keys = Object.keys(OPERATOR_STRINGS);
    expect(keys.filter((k) => k.startsWith('support.')).length).toBeGreaterThan(100);
    expect(keys.filter((k) => k.startsWith('accessQueue.')).length).toBeGreaterThan(20);
    expect(keys.filter((k) => k.startsWith('redirects.')).length).toBeGreaterThan(5);
    expect(keys).toEqual(expect.arrayContaining(['nav.accessRequests', 'nav.support', 'nav.redirectUris']));
  });

  it('keeps the public request page bilingual: it is a customer’s', () => {
    expect(Object.keys(STRINGS.nl).filter((k) => k.startsWith('access.')).length).toBeGreaterThan(10);
  });
});

/** Says one operator word, one shared word, and the locale it renders in. */
function Probe() {
  const ot = useOperatorT();
  const t = useT();
  const { locale } = useLocale();
  return (
    <p>
      <span>{ot('support.noOrganisations')}</span> <span>{ot('common.cancel')}</span> <span>{t('common.cancel')}</span>{' '}
      <span>{locale}</span>
    </p>
  );
}

describe('an operator screen in a Dutch app', () => {
  it('says its own words and the shared ones in English, under lang="en"', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    const { container } = render(
      <LocaleProvider>
        <EnglishOnly>
          <Probe />
        </EnglishOnly>
      </LocaleProvider>,
    );
    expect(screen.getByText(OPERATOR_STRINGS['support.noOrganisations'])).toBeInTheDocument();
    expect(screen.getAllByText(STRINGS.en['common.cancel'])).toHaveLength(2);
    expect(screen.queryByText(STRINGS.nl['common.cancel'])).not.toBeInTheDocument();
    expect(screen.getByText('en')).toBeInTheDocument();
    expect(container.querySelector('[lang="en"]')).not.toBeNull();
    // The app around it is still Dutch: the document's language is the menu's.
    expect(document.documentElement.lang).toBe('nl');
  });

  it('says its own words in English even outside the wrapper', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText(OPERATOR_STRINGS['support.noOrganisations'])).toBeInTheDocument();
    // A shared word through the app's own `t` follows the app, which is why
    // the routes wrap these screens in EnglishOnly.
    expect(screen.getByText(STRINGS.nl['common.cancel'])).toBeInTheDocument();
  });
});
