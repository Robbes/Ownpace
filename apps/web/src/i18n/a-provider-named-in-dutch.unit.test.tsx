// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROVIDER NAMED IN DUTCH, ON A DUTCH SCREEN (the owner, 2026-10-05: *"Write
 * provider names the Dutch way in the Dutch app"*).
 *
 * The Dutch app named the account a person leaves *Google account*, in the
 * tile on a person's page, the row on Accounts and the card that adds one,
 * beside its own sentences' *Google-account*. A provider's name is now read in
 * the reader's language (`providerDisplayName`'s second argument): Dutch
 * writes a compound with a name with a hyphen, and Google names two of its
 * products in Dutch itself. English is as it was.
 *
 * This renders the places a person reads the name: a tile, as on a person's
 * page, and the cards that add an account, in both languages.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { LocaleProvider } from './index.tsx';
import ProviderTile from '../components/ProviderTile.tsx';
import { FrontDoorChooser } from '../components/FrontDoorChooser.tsx';
import { SOURCE_CARDS } from '../components/front-door-cards.ts';

const inLocale = (locale: 'en' | 'nl') => globalThis.localStorage.setItem('ownpace.locale', locale);

beforeEach(() => globalThis.localStorage.clear());

describe('a provider named in the reader\'s language', () => {
  it.each([
    ['nl', 'Google-account'],
    ['en', 'Google account'],
  ] as const)('a tile names a Google account in %s "%s"', (locale, name) => {
    inLocale(locale);
    render(
      <LocaleProvider>
        <ProviderTile type="google" role="source" />
      </LocaleProvider>,
    );
    expect(screen.getByText(name)).toBeInTheDocument();
  });

  it('the cards that add an account name them the Dutch way in Dutch, and a brand as it is', () => {
    inLocale('nl');
    render(
      <LocaleProvider>
        <FrontDoorChooser cards={SOURCE_CARDS} role="source" selectedId="" onPick={() => undefined} gridClass="" />
      </LocaleProvider>,
    );
    for (const name of ['Google-account', 'Microsoft 365-account', 'Apple-account (iCloud)', 'Google Agenda', 'Google Contacten']) {
      expect(screen.getByText(name), name).toBeInTheDocument();
    }
    for (const english of ['Google account', 'Microsoft 365 account', 'Google Calendar', 'Google Contacts']) {
      expect(screen.queryByText(english), english).toBeNull();
    }
    expect(screen.getByText('Gmail')).toBeInTheDocument();
    expect(screen.getByText('Dropbox')).toBeInTheDocument();
  });

  it('the same cards keep their English names in English', () => {
    inLocale('en');
    render(
      <LocaleProvider>
        <FrontDoorChooser cards={SOURCE_CARDS} role="source" selectedId="" onPick={() => undefined} gridClass="" />
      </LocaleProvider>,
    );
    for (const name of ['Google account', 'Microsoft 365 account', 'Apple account (iCloud)']) {
      expect(screen.getByText(name), name).toBeInTheDocument();
    }
  });
});
