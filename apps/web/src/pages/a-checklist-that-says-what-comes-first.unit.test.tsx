// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CHECKLIST SAYS WHAT MUST BE DONE FIRST, IN THE GUIDE'S WORDS (workplan
 * 0148 T5 (a)).
 *
 * The Apple, Nextcloud and Soverin checklists said *"Nothing to set up in
 * advance; go straight to the wizard"*. Each of them has a thing to do first,
 * and the card's own guide says what: Apple wants an app-specific password,
 * made at Apple; a Nextcloud wants an account that exists, an app password and
 * the address with `/remote.php/dav`; a Soverin account signs in with its
 * password, and carries mail only when the mail server is kept. `provider-setup.unit.test.ts`
 * holds that every card has a profile or a written reason; this file holds
 * what the profiles SAY:
 *
 *  - every step's title, how-to and yield resolve in both languages;
 *  - each new step names what the card's guide section names, in the same
 *    language: the provider's own screen words, the account form's labels, and the
 *    values the code pre-fills (Soverin's mail server is read from the
 *    provider directory, not written out here);
 *  - *Via the Graph API* and *Via IMAP* no longer share one text. The shared
 *    step said to add Microsoft Graph permissions "for mail, calendar,
 *    contacts or files", while both cards read one mailbox's mail and the
 *    IMAP card's token carries only what Office 365 Exchange Online gives.
 *    Each card's steps now name its recipe, as the Microsoft guide's
 *    `{#application-graph}` and `{#application-imap}` write it, and neither
 *    names the other's permission;
 *  - the page renders each new profile as steps, not as "nothing to set up",
 *    and links the card's own guide section, as the other profiles do;
 *  - it asks whether the reader administers the provider only where a step
 *    needs an administrator, which Apple's and Soverin's do not.
 *
 * Entra's screen words (*App registrations*, *Certificates & secrets*,
 * *Application permissions*, *Grant admin consent for*, *Enterprise
 * applications*) are held in English only. The Dutch guide names Entra's screens by their
 * English names until 0148 T0 reads Microsoft's Dutch screens against it, and
 * the correct change then must not turn this red; the permission, API and
 * cmdlet names are the same in every language and are held in both.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import {
  providerDirectoryEntry,
  providersWithSetup,
  setupStepsFor,
  summariseSetup,
  type SetupSide,
} from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS, LOCALES, type Locale } from '../i18n/strings.ts';
import { cardGuideHref } from '../components/front-door-cards.ts';
import type { SetupChecklist } from '../services/mapping-service.ts';

const { get, setStep } = vi.hoisted(() => ({ get: vi.fn(), setStep: vi.fn() }));

vi.mock('../services/mapping-service', () => ({
  setupApi: { get, setStep },
}));

import Setup from './Setup.tsx';

/** Every served guide, `<locale>/<slug>`, through the page's own build-time import. */
const GUIDES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../../../docs/guides/*/*.md', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).map(([path, body]) => [path.split('/').slice(-2).join('/').replace(/\.md$/, ''), body]),
);

/** A section: its `{#id}` heading, to the next heading at its depth or above, fences kept. */
function sectionOf(body: string, id: string): string | undefined {
  const lines = body.split('\n');
  let inFence = false;
  const headingAt = (line: string): number | undefined => {
    if (line.startsWith('```')) inFence = !inFence;
    if (inFence || line.startsWith('```')) return undefined;
    return /^(#{1,4}) /.exec(line)?.[1]?.length;
  };
  const depths = lines.map(headingAt);
  const start = lines.findIndex((line, i) => depths[i] !== undefined && line.endsWith(`{#${id}}`));
  if (start === -1) return undefined;
  const depth = depths[start]!;
  const end = depths.findIndex((d, i) => i > start && d !== undefined && d <= depth);
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** Guide prose as a reader sees it: bold, code and link markup dropped. */
const plain = (markdown: string): string =>
  markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|`/g, '');

/** The words of the named sections of a card's guide, in one language. */
function guideWords(locale: Locale, slug: string, sections: ReadonlyArray<string>): string {
  const body = GUIDES[`${locale}/${slug}`];
  expect(body, `${locale}/${slug}.md is served`).toBeDefined();
  return sections
    .map((id) => {
      const text = sectionOf(body!, id);
      expect(text, `${locale}/${slug}.md has a {#${id}} section`).toBeDefined();
      return plain(text!);
    })
    .join('\n');
}

const words = (locale: Locale, key: string): string => {
  const text = (STRINGS[locale] as Record<string, string>)[key];
  expect(text, `${key} (${locale})`).toBeDefined();
  return text!;
};

/** What a profile says on screen in one language: every title, how-to and yield. */
function profileText(locale: Locale, side: SetupSide, provider: string): string {
  return setupStepsFor(side, provider)
    .flatMap((step) => [step.titleKey, step.detailKey, step.yieldsKey])
    .filter((key): key is string => key !== undefined)
    .map((key) => words(locale, key))
    .join('\n');
}

describe('every step says something, in both languages', () => {
  it('every title, how-to and yield of every profile resolves in English and Dutch', () => {
    const missing: string[] = [];
    for (const side of ['source', 'target'] as const) {
      for (const provider of providersWithSetup(side)) {
        for (const step of setupStepsFor(side, provider)) {
          for (const key of [step.titleKey, step.detailKey, step.yieldsKey]) {
            if (key === undefined) continue;
            for (const locale of LOCALES) {
              if (!(key in STRINGS[locale])) missing.push(`${side}:${provider}.${step.key} → ${key} (${locale})`);
            }
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

/**
 * What each new profile names, found in its card's guide sections, in the
 * same language. A word the step names and the guide does not is a checklist
 * drifting from its guide; a word the guide names and the step does not is a
 * step that leaves out what the guide says to prepare.
 */
const NAMED: ReadonlyArray<{
  side: SetupSide;
  provider: string;
  slug: string;
  sections: ReadonlyArray<string>;
  words: Readonly<Record<Locale, ReadonlyArray<string>>>;
}> = [
  {
    side: 'source',
    provider: 'apple',
    slug: 'apple',
    sections: ['before', 'app-password', 'leaving'],
    words: {
      en: ['account.apple.com → Sign-In and Security → App-Specific Passwords', 'abcd-efgh-ijkl-mnop', 'once'],
      nl: ['account.apple.com → Aanmelden en beveiliging → App-specifieke wachtwoorden', 'abcd-efgh-ijkl-mnop', 'één keer'],
    },
  },
  {
    side: 'target',
    provider: 'nextcloud',
    slug: 'nextcloud',
    sections: ['before', 'app-password', 'nextcloud'],
    words: {
      en: [
        'Settings → Security → Devices & sessions',
        'App name',
        'Create new app password',
        '/remote.php/dav',
        '/remote.php/dav/files/',
        'https://cloud.example.com/remote.php/dav',
        'This service creates no accounts',
      ],
      nl: [
        'Instellingen → Beveiliging → Apparaten & sessies',
        'App naam',
        'Creëer een nieuw app wachtwoord',
        '/remote.php/dav',
        '/remote.php/dav/files/',
        'https://cloud.example.com/remote.php/dav',
        'Deze dienst maakt zelf geen accounts aan',
      ],
    },
  },
  {
    side: 'target',
    provider: 'soverin',
    slug: 'soverin',
    sections: ['before', 'soverin', 'when-test-says'],
    words: {
      en: ['app password', 'Password', 'Mail server', 'Mail port', 'imap.soverin.net', '993', 'carries no mail'],
      nl: [
        'app-wachtwoord',
        'Wachtwoord',
        'Mailserver',
        'Mailpoort',
        'imap.soverin.net',
        '993',
        // The guide leaves the app password to the reader, and names what an
        // account saved without is missing.
        'Biedt Soverin u een app-wachtwoord, dan kan dat in hetzelfde vak',
        'account dat zonder Mailserver is bewaard, omvat geen mail',
      ],
    },
  },
  {
    side: 'source',
    provider: 'graph',
    slug: 'microsoft',
    sections: ['application', 'application-graph'],
    words: {
      en: [
        'App registrations',
        'Accounts in this organizational directory only',
        'Certificates & secrets',
        'Microsoft Graph',
        'Application permissions',
        'Mail.Read',
        'Grant admin consent for',
      ],
      nl: ['Microsoft Graph', 'Mail.Read'],
    },
  },
  {
    side: 'source',
    provider: 'oauth2',
    slug: 'microsoft',
    sections: ['application', 'application-imap'],
    words: {
      en: [
        'App registrations',
        'Accounts in this organizational directory only',
        'Certificates & secrets',
        'APIs my organization uses',
        'Office 365 Exchange Online',
        'IMAP.AccessAsApp',
        'Grant admin consent for',
        'New-ServicePrincipal',
        'Enterprise applications',
        'Add-MailboxPermission',
        'FullAccess',
      ],
      nl: ['Office 365 Exchange Online', 'IMAP.AccessAsApp', 'New-ServicePrincipal', 'Add-MailboxPermission', 'FullAccess'],
    },
  },
];

describe("each new profile names what its card's guide names (0148 T5 (a))", () => {
  for (const entry of NAMED) {
    for (const locale of LOCALES) {
      it(`${locale}: ${entry.side} ${entry.provider}`, () => {
        const steps = profileText(locale, entry.side, entry.provider);
        const guide = guideWords(locale, entry.slug, entry.sections);
        for (const word of entry.words[locale]) {
          expect(guide, `${locale}/${entry.slug}.md's ${entry.sections.join(', ')} name "${word}"`).toContain(word);
          expect(steps, `the ${entry.provider} checklist (${locale}) names "${word}"`).toContain(word);
        }
      });
    }
  }

  it("the Soverin steps name the mail server the code pre-fills, from the provider directory", () => {
    const values = providerDirectoryEntry('target', 'soverin')?.values;
    expect(values?.mailHost).toBeDefined();
    for (const locale of LOCALES) {
      const steps = profileText(locale, 'target', 'soverin');
      expect(steps, locale).toContain(values!.mailHost!);
      expect(steps, locale).toContain(values!.mailPort!);
      // The wizard's own labels for the two boxes, as that language shows them.
      expect(steps, locale).toContain(words(locale, 'wizard.soverinMailHost'));
      expect(steps, locale).toContain(words(locale, 'wizard.soverinMailPort'));
    }
  });

  it("the Nextcloud steps name the wizard's DAV base URL box and its /remote.php/dav", () => {
    for (const locale of LOCALES) {
      const steps = profileText(locale, 'target', 'nextcloud');
      expect(steps, locale).toContain(words(locale, 'wizard.targetDavUrl'));
      expect(words(locale, 'wizard.nextcloudDavUrl.hint'), locale).toContain('/remote.php/dav');
    }
  });

  it("the Apple step uses the path the wizard's own line names", () => {
    const path: Readonly<Record<Locale, string>> = {
      en: 'account.apple.com → Sign-In and Security → App-Specific Passwords',
      nl: 'account.apple.com → Aanmelden en beveiliging → App-specifieke wachtwoorden',
    };
    for (const locale of LOCALES) {
      expect(words(locale, 'wizard.appleAppPassword.why'), locale).toContain(path[locale]);
      expect(profileText(locale, 'source', 'apple'), locale).toContain(path[locale]);
    }
  });
});

/**
 * The two registration cards, each with its own recipe. The data words are
 * what the shared step said and no longer may: both cards read one mailbox's
 * mail (the Microsoft guide's `{#graph}`).
 */
describe('Via the Graph API and Via IMAP each name their own permission (0148 T5 (a))', () => {
  const OTHER_FACES: Readonly<Record<Locale, RegExp>> = {
    en: /\b(?:calendars?|contacts|files|OneDrive)\b/i,
    nl: /\b(?:agenda'?s?|contacten|bestanden|OneDrive)\b/i,
  };

  for (const locale of LOCALES) {
    it(`${locale}: the Graph card asks for Mail.Read and nothing of Exchange's`, () => {
      const graph = profileText(locale, 'source', 'graph');
      expect(graph).toContain('Mail.Read');
      expect(graph).toContain('Microsoft Graph');
      expect(graph).not.toContain('IMAP.AccessAsApp');
      expect(graph).not.toContain('Office 365 Exchange Online');
      expect(graph).not.toMatch(OTHER_FACES[locale]);
    });

    it(`${locale}: the IMAP card asks Exchange Online, and for no Graph permission`, () => {
      const imap = profileText(locale, 'source', 'oauth2');
      expect(imap).toContain('IMAP.AccessAsApp');
      expect(imap).toContain('Office 365 Exchange Online');
      expect(imap).not.toContain('Mail.Read');
      expect(imap).not.toMatch(OTHER_FACES[locale]);
      // Microsoft's FullAccess can write; the step says so, and does not call the card read-only.
      expect(imap).not.toMatch(/read-only|alleen-lezen|alleen lezen/i);
    });
  }
});

function renderSetup(locale: Locale, side: SetupSide, provider: string) {
  window.localStorage.setItem('ownpace.locale', locale);
  const steps = setupStepsFor(side, provider).map((step) => ({ step, state: 'open' as const }));
  const checklist: SetupChecklist = { side, provider, steps, progress: summariseSetup(steps) };
  get.mockResolvedValue(checklist);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/setup/${side}/${provider}`]}>
          <Routes>
            <Route path="/setup/:side/:provider" element={<Setup />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  setStep.mockReset();
});

describe("the page shows each new profile's steps and links the card's guide section", () => {
  const CASES: ReadonlyArray<readonly [SetupSide, string]> = [
    ['source', 'apple'],
    ['target', 'nextcloud'],
    ['target', 'soverin'],
    ['source', 'oauth2'],
  ];

  for (const locale of LOCALES) {
    for (const [side, provider] of CASES) {
      it(`${locale}: ${side} ${provider}`, async () => {
        renderSetup(locale, side, provider);
        const first = setupStepsFor(side, provider)[0];
        expect(first, `${side}:${provider} has a first step`).toBeDefined();
        expect(await screen.findByText(words(locale, first!.titleKey))).toBeTruthy();
        expect(screen.queryByText(words(locale, 'setup.nothingToDo'))).toBeNull();

        const guide = screen.getByText(words(locale, 'setup.fullGuide'));
        expect(guide.getAttribute('href')).toBe(cardGuideHref(side, provider));
      });
    }
  }
});

/**
 * The narrowing question asks whether the reader administers the provider,
 * and only an administrator's step makes the answer change the list (workplan
 * 0068). Apple's one step and Soverin's three are the holder's own, so there
 * the question asked a person with a personal Apple account whether they
 * administer it for an organisation, and every answer showed the same list.
 * It is asked where a step needs somebody else. The answer is remembered on
 * the device per side and provider, so a stored "no" must not bring back the
 * heading it arranges the list under either.
 */
describe('the administrator question is asked only where a step needs one (0148 T5 (a))', () => {
  const HOLDERS_OWN: ReadonlyArray<readonly [SetupSide, string]> = [
    ['source', 'apple'],
    ['target', 'soverin'],
  ];

  // The answer is remembered on the device; no case inherits another's.
  afterEach(() => {
    for (const [side, provider] of [...HOLDERS_OWN, ['target', 'nextcloud'] as const]) {
      window.localStorage.removeItem(`setup.admin.${side}.${provider}`);
    }
  });

  for (const locale of LOCALES) {
    for (const [side, provider] of HOLDERS_OWN) {
      it(`${locale}: ${side} ${provider} asks nothing, and a stored "no" arranges nothing`, async () => {
        expect(setupStepsFor(side, provider).some((s) => s.needsAnotherPerson)).toBe(false);
        window.localStorage.setItem(`setup.admin.${side}.${provider}`, 'no');
        renderSetup(locale, side, provider);
        const first = setupStepsFor(side, provider)[0]!;
        expect(await screen.findByText(words(locale, first.titleKey))).toBeTruthy();
        expect(screen.queryByText(words(locale, 'setup.admin.question'), { exact: false })).toBeNull();
        expect(screen.queryByText(words(locale, 'setup.admin.no'))).toBeNull();
        expect(screen.queryByText(words(locale, 'setup.yours'))).toBeNull();
      });
    }

    it(`${locale}: target nextcloud, whose account an administrator makes, still asks`, async () => {
      expect(setupStepsFor('target', 'nextcloud').some((s) => s.needsAnotherPerson)).toBe(true);
      renderSetup(locale, 'target', 'nextcloud');
      expect(await screen.findByText(words(locale, 'setup.admin.question'), { exact: false })).toBeTruthy();
      fireEvent.click(screen.getByText(words(locale, 'setup.admin.no')));
      expect(screen.getByText(words(locale, 'setup.yours'))).toBeTruthy();
      expect(screen.getByText(words(locale, 'setup.forYourAdmin'))).toBeTruthy();
    });
  }
});
