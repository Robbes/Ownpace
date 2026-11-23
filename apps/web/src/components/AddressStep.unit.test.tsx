// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT *YOUR NEW ADDRESS* ASKS ABOUT, AND WHY (workplan 0168 §6.1, §6.2;
 * ADR-0055).
 *
 * `addressProposals` reads the accounts chosen and answers which old
 * addresses the step asks about, for one of three reasons:
 *
 * - **the list**: a provider keeps the address (`cannotTakeAlong`), a
 *   Microsoft 365 tenant's `.onmicrosoft.com` domain among them (the owner,
 *   2026-11-23: *"Yes, any .onmicrosoft.com"*);
 * - **the tick**: the person said *I am also changing my address*, as before;
 * - **by itself**, the new account's login on another domain (the owner,
 *   2026-11-23, decision (b): *"Ask by itself when the new account's login is
 *   on another domain than the old address; never for a .onmicrosoft.com
 *   login; no default answer; hint: 'Choose No if ‹new› is only temporary,
 *   until your own domain moves.'"*).
 *
 * A question asked for the domain says so, with the owner's hint, in English
 * and Dutch, and is described by it; nothing is answered for the person.
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../i18n/index.tsx';
import type { AddressChange } from '../services/address-change-service.ts';
import { AddressStep, addressProposals, type AddressProposals } from './AddressStep.tsx';

const propose = (sources: string[], newLogin: string, declared = false, table: AddressChange[] = []) =>
  addressProposals({ sources, newLogin, declared, table, personId: null });

const ROW: AddressChange = {
  oldAddress: 'name@example.org',
  oldKey: 'name@example.org',
  newAddress: 'first@example.net',
  state: 'confirmed',
  setBy: 'admin@example.org',
  setByYou: false,
  confirmedBy: 'admin@example.org',
  confirmedByYou: false,
  confirmedByThePerson: false,
  createdAt: '2026-11-22T10:00:00.000Z',
  confirmedAt: '2026-11-22T10:00:00.000Z',
  person: null,
};

describe('what the step asks about (addressProposals)', () => {
  it('asks by itself about an own-domain address when the new login is on another domain', () => {
    expect(propose(['name@example.org'], 'first@example.net').asked).toEqual([
      { old: 'name@example.org', provider: null, why: 'otherDomain' },
    ]);
  });

  // The domain comes along, so its addresses do too.
  it.each(['first@example.org', 'First@EXAMPLE.org'])(
    'asks nothing new when the new login, %s, is on the same domain',
    (login) => {
      expect(propose(['name@example.org'], login).asked).toEqual([]);
    },
  );

  it.each(['first@contoso.onmicrosoft.com', 'first@contoso.mail.onmicrosoft.com', 'first@onmicrosoft.com'])(
    'never asks for the domain when the new login, %s, is at or under onmicrosoft.com',
    (login) => {
      expect(propose(['name@example.org'], login).asked).toEqual([]);
    },
  );

  // Matched on whole labels: a lookalike is another domain like any other.
  it.each(['first@notonmicrosoft.com', 'first@onmicrosoft.com.example.com'])(
    'asks for a login, %s, that only looks like one under onmicrosoft.com',
    (login) => {
      expect(propose(['name@example.org'], login).asked).toEqual([
        { old: 'name@example.org', provider: null, why: 'otherDomain' },
      ]);
    },
  );

  it('asks nothing for the domain where the new login is not an address', () => {
    expect(propose(['name@example.org'], 'first').asked).toEqual([]);
  });

  it('asks about an address under onmicrosoft.com by itself, as one Microsoft keeps, whatever the login', () => {
    for (const login of ['first@example.org', 'first']) {
      expect(propose(['name@contoso.onmicrosoft.com'], login).asked, login).toEqual([
        { old: 'name@contoso.onmicrosoft.com', provider: 'Microsoft', why: 'list' },
      ]);
    }
  });

  it('gives the list’s reason, not the domain’s, for an address a provider keeps', () => {
    expect(propose(['name@gmail.com'], 'first@example.org').asked).toEqual([
      { old: 'name@gmail.com', provider: 'Google', why: 'list' },
    ]);
  });

  // The tick keeps working as before: every address, asked as declared.
  it('asks as before once the person ticks the box, on the same domain or another', () => {
    for (const login of ['first@example.org', 'first@example.net', 'first@contoso.onmicrosoft.com']) {
      expect(propose(['name@example.org'], login, true).asked, login).toEqual([
        { old: 'name@example.org', provider: null, why: 'declared' },
      ]);
    }
  });

  it('asks nothing again about an address the table already holds', () => {
    const proposals = propose(['name@example.org'], 'first@example.net', false, [ROW]);
    expect(proposals.asked).toEqual([]);
    expect(proposals.existing).toEqual([ROW]);
  });
});

const renderStep = (proposals: AddressProposals, newLogin: string) =>
  render(
    <LocaleProvider>
      <AddressStep
        proposals={proposals}
        newLogin={newLogin}
        answers={{}}
        onAnswer={() => undefined}
        others={[]}
        onOthers={() => undefined}
        failures={[]}
      />
    </LocaleProvider>,
  );

afterEach(() => {
  globalThis.localStorage.clear();
});

describe.each([
  {
    locale: 'en',
    line: 'first@example.net is on another domain than name@example.org. Choose No if first@example.net is only temporary, until your own domain moves.',
    question: 'Use first@example.net in place of name@example.org?',
  },
  {
    locale: 'nl',
    line: 'first@example.net staat op een ander domein dan name@example.org. Kies Nee als first@example.net maar tijdelijk is, tot uw eigen domein meekomt.',
    question: 'first@example.net gebruiken in plaats van name@example.org?',
  },
] as const)('a question asked for the domain ($locale)', ({ locale, line, question }) => {
  it('says the new address is on another domain, with the hint, describes the question by it, and answers nothing', () => {
    globalThis.localStorage.setItem('ownpace.locale', locale);
    renderStep(propose(['name@example.org'], 'first@example.net'), 'first@example.net');
    expect(screen.getByText(line)).toBeInTheDocument();
    const group = screen.getByRole('group', { name: question });
    expect(group).toHaveAccessibleDescription(line);
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    for (const radio of radios) expect(radio).not.toBeChecked();
  });
});

it('says no such line where the list or the tick asks', () => {
  renderStep(propose(['name@gmail.com', 'other@example.org'], 'first@example.net', true), 'first@example.net');
  expect(screen.getAllByRole('group')).toHaveLength(2);
  expect(screen.queryByText(/on another domain/)).not.toBeInTheDocument();
  expect(screen.queryByText(/only temporary/)).not.toBeInTheDocument();
  for (const group of screen.getAllByRole('group')) expect(group).not.toHaveAttribute('aria-describedby');
});
