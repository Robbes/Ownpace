// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN EXPORT WE CANNOT READ YET (workplan 0148 T3, owner decisions D7 and D10).
 *
 * The export archive's form offers two exports, Google Takeout and Apple Data
 * & Privacy, and only Takeout has a reader. Apple's is absent on purpose
 * (`READERS` in `archive-source-factory.ts`): it waits on a second real export.
 * So Test refuses an Apple export as a wiring gap, and so does a pass. Nothing
 * on screen said so. The card promised *"A Google Takeout or Apple export you
 * downloaded"*, and the guide walks a request Apple says takes up to seven
 * days, so a tester could ask Apple, wait a week, and meet the refusal at the
 * end.
 *
 * The owner, D7: *"Leave the Apple-export option in but be clear about it
 * ('to be tested'-label)."* D10 keeps the card offered on managed too, so
 * this holds on a managed and an appliance build alike:
 *
 * - at both doors, the wizard and the Connections page, an option whose export
 *   has no reader carries the tag as text in its name. Google Takeout carries
 *   none, for as long as it is the only export with a reader;
 * - choosing that option shows D7's line under the field, as a status the
 *   select points at, and choosing Takeout shows none;
 * - the card's own hint carries the tag after Apple, in English and in Dutch.
 *
 * Which export is tagged is read from `ARCHIVE_PROVIDERS_WITH_READERS`, so
 * when a reader lands the tag and the line go and nothing else changes.
 * `packages/orchestration/src/the-form-and-the-readers-agree.unit.test.ts`
 * holds that list equal to `READERS`.
 *
 * The edition is mocked through `services/edition`, the sanctioned seam.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ARCHIVE_PROVIDERS,
  ARCHIVE_PROVIDERS_WITH_READERS,
  ARCHIVE_PROVIDER_NAMES,
  credentialFieldsFor,
  type ArchiveProvider,
} from '@openmig/shared';

const { editionFlag } = vi.hoisted(() => ({ editionFlag: { selfhost: false } }));

vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return {
    ...actual,
    isSelfHost: () => editionFlag.selfhost,
    edition: () => (editionFlag.selfhost ? 'selfhost' : 'managed'),
  };
});

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    create: vi.fn(),
    testConnection: vi.fn(),
    googleAuthorize: vi.fn(),
    dropboxAuthorize: vi.fn(),
    microsoftAuthorize: vi.fn(),
  },
  connectionsApi: {
    list: vi.fn().mockResolvedValue([]),
    test: vi.fn(),
    add: vi.fn(),
    rotate: vi.fn(),
    remove: vi.fn(),
  },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: {
    get: vi.fn().mockResolvedValue({ google: 'connection', dropbox: 'connection', microsoft: 'connection' }),
  },
}));

import CreateMapping from '../pages/CreateMapping.tsx';
import Connections from '../pages/Connections.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

/**
 * D7's words, as they must read on screen. The tag is the plan's; the line is
 * §2's, with one Dutch word changed so it fits the copy budget (0148 Status,
 * 2026-09-24).
 */
const SAID = {
  en: {
    tag: 'To be tested',
    line: 'We cannot read an Apple export yet. Request one only for your own records.',
  },
  nl: {
    tag: 'Nog te testen',
    line: 'Een Apple-export kunnen we nog niet lezen. Vraag die alleen aan voor uw eigen archief.',
  },
} as const;

type Locale = keyof typeof SAID;
const LOCALES = Object.keys(SAID) as Locale[];

const EDITIONS = [
  { edition: 'managed', selfhost: false },
  { edition: 'appliance', selfhost: true },
] as const;

const hasReader = (p: ArchiveProvider): boolean => ARCHIVE_PROVIDERS_WITH_READERS.includes(p);

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Each door as the app mounts it, in the reader's language. */
const DOORS = {
  wizard: async (locale: Locale) => {
    window.localStorage.setItem('ownpace.locale', locale);
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/mappings/new']}>
            <CreateMapping />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    );
  },
  connections: async (locale: Locale) => {
    window.localStorage.setItem('ownpace.locale', locale);
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter>
            <Connections />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText(STRINGS[locale]['connections.add']));
  },
} as const;

type Door = keyof typeof DOORS;
const DOOR_NAMES = Object.keys(DOORS) as Door[];

const archiveCard = (): HTMLElement => screen.getByRole('button', { name: /^Export archive/ });

/** The archive form's "Which export" choice, after picking the card. */
const whichExport = (locale: Locale): HTMLSelectElement => {
  fireEvent.click(archiveCard());
  const label = STRINGS[locale]['wizard.archiveProvider'];
  return screen.getByLabelText(new RegExp(`^${label}`)) as HTMLSelectElement;
};

const optionText = (select: HTMLSelectElement, value: string): string =>
  [...select.options].find((o) => o.value === value)?.textContent ?? '';

beforeEach(() => {
  // The wizard remembers its non-secret half across mounts (0069).
  globalThis.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  editionFlag.selfhost = false;
  window.localStorage.clear();
});

describe('today, Google Takeout is the only export with a reader', () => {
  it('so Apple Data & Privacy is the export the form tags', () => {
    // The premise of every concrete case below. When Apple's reader lands this
    // changes with the reader, and the cases below stop tagging Apple.
    expect([...ARCHIVE_PROVIDERS_WITH_READERS]).toEqual(['google-takeout']);
    expect(ARCHIVE_PROVIDERS.filter((p) => !hasReader(p))).toEqual(['apple-privacy']);
  });

  it('the descriptor carries the tag and the line on exactly the exports without a reader', () => {
    const provider = credentialFieldsFor('source', 'archive').find((f) => f.key === 'provider');
    for (const option of provider?.options ?? []) {
      const readable = hasReader(option.value as ArchiveProvider);
      expect(Boolean(option.tagKey), `${option.value}: tag`).toBe(!readable);
      expect(Boolean(option.hintKey), `${option.value}: line`).toBe(!readable);
    }
  });
});

describe.each(EDITIONS)('on the $edition build', ({ selfhost }) => {
  beforeEach(() => {
    editionFlag.selfhost = selfhost;
  });

  describe.each(DOOR_NAMES)('the %s door', (door) => {
    it.each(LOCALES)('%s: the Apple option carries the tag, Google Takeout none', async (locale) => {
      await DOORS[door](locale);
      const select = whichExport(locale);

      expect(optionText(select, 'apple-privacy')).toContain(ARCHIVE_PROVIDER_NAMES['apple-privacy']);
      expect(optionText(select, 'apple-privacy')).toContain(SAID[locale].tag);
      expect(optionText(select, 'google-takeout')).toBe(ARCHIVE_PROVIDER_NAMES['google-takeout']);
      // And by the list, so a third export is held to the same rule.
      for (const p of ARCHIVE_PROVIDERS) {
        expect(optionText(select, p).includes(SAID[locale].tag), p).toBe(!hasReader(p));
      }
    });

    it.each(LOCALES)('%s: choosing Apple shows the line, choosing Takeout does not', async (locale) => {
      await DOORS[door](locale);
      const select = whichExport(locale);
      expect(screen.queryByText(SAID[locale].line), 'before any choice').toBeNull();

      fireEvent.change(select, { target: { value: 'apple-privacy' } });
      expect(screen.getByText(SAID[locale].line)).toBeTruthy();

      fireEvent.change(select, { target: { value: 'google-takeout' } });
      expect(screen.queryByText(SAID[locale].line), 'with Takeout chosen').toBeNull();
    });

    // The line appears on a choice, after the eye has left for the next box:
    // a screen reader hears it only when it is a status, and meets it again
    // on the select only when the select points at it (review, 2026-09-24).
    it.each(LOCALES)('%s: the line is announced, and describes the select while Apple is chosen', async (locale) => {
      await DOORS[door](locale);
      const select = whichExport(locale);
      expect(select).not.toHaveAccessibleDescription(SAID[locale].line);

      fireEvent.change(select, { target: { value: 'apple-privacy' } });
      expect(screen.getByText(SAID[locale].line).closest('[role="status"]'), 'a status').not.toBeNull();
      expect(select).toHaveAccessibleDescription(SAID[locale].line);

      fireEvent.change(select, { target: { value: 'google-takeout' } });
      expect(select).not.toHaveAccessibleDescription(SAID[locale].line);
    });

    it.each(LOCALES)('%s: the card hint carries the tag after Apple, while Apple has no reader', async (locale) => {
      await DOORS[door](locale);
      const hint = STRINGS[locale]['wizard.proto.archive.hint'];
      // The tag reads in lower case inside a sentence.
      const tag = SAID[locale].tag.toLowerCase();
      expect(archiveCard().textContent).toContain(hint);
      // A static sentence, so the one place a landed reader must be answered by
      // hand: this fails until the tag leaves the hint as well.
      expect(hint.toLowerCase().includes(tag)).toBe(!hasReader('apple-privacy'));
      if (!hasReader('apple-privacy')) {
        expect(hint.toLowerCase().indexOf(tag)).toBeGreaterThan(hint.indexOf('Apple'));
        expect(hint.indexOf('Apple')).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
