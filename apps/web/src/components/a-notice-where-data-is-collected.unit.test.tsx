// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A NOTICE WHEREVER A TESTER'S DATA IS COLLECTED (workplan 0139 T4).
 *
 * The readiness review of 2026-09-23 found that a tester could hand us data
 * on three screens and be shown no privacy policy on any of them. The grant
 * page linked both texts (#1137) and nothing else did:
 *
 *  - **the request form** (`RequestAccess.tsx`) keeps an address, a name, an
 *    organisation and a note in the person's own words, and said one line
 *    about why, with no link and no word on how long (privacy §4.4 and §9
 *    say both);
 *  - **the Connect buttons** (`ProviderConsentPanel` and the wizard's own
 *    button, which share `ConsentLines`) hand us the keys to a whole
 *    mailbox, and `docs/google-oauth-verification.md` §5 requires *"Links to
 *    the privacy policy and terms sit beside the button, not in a footer."*;
 *  - **the report form** (`ReportProblem.tsx`) sends a description, a
 *    screenshot and a list of facts to the support mailbox, and said what it
 *    sends without saying under what policy.
 *
 * So each of them links the policy, in the reader's language, at the address
 * `services/legal-links.ts` makes, beside what it collects: the request form
 * under the form, with the Alpha conditions too where the alpha runs; the
 * Connect panel beside its button, with the terms; the report form in the box
 * that lists what goes with the report. Each opens in a new tab, so what was
 * typed into the form is still there when the reader comes back.
 *
 * THE ADDRESS IS THE MODULE'S, AND THE MODULE IS PROVED TO BE READ. The
 * module is wrapped here so its default is the OTA test site rather than the
 * production one: a page that wrote the production address itself would show
 * a link this file does not find. `scripts/a-policy-link-that-answers` holds
 * the module to the files the site build writes.
 *
 * The appliance shows none of the Connect links: its owner runs it, and this
 * policy is not theirs (the share mail's rule, `privacy-policy-link.ts`). The
 * request and report forms are managed-only routes already.
 *
 * It failed on the code before 0139 T4's notices were built: none of the three
 * linked anything, and `access.privacy` named no period.
 */
import React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { credentialFieldsFor } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS, type Locale } from '../i18n/strings.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import type * as LegalLinks from '../services/legal-links.ts';

const { OTA, editionFlag, clients, getMock } = vi.hoisted(() => ({
  /** The OTA stack's test site: the module's default for every page under test. */
  OTA: { VITE_LEGAL_SITE_URL: 'https://www.ota.ownpace.eu' },
  editionFlag: { selfhost: false },
  clients: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock('../services/legal-links.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof LegalLinks>();
  return {
    ...actual,
    legalUrl: (page: LegalLinks.LegalPage, locale: Locale, source: LegalLinks.LegalSiteEnv = OTA) =>
      actual.legalUrl(page, locale, source),
    legalLinks: (locale: Locale, source: LegalLinks.LegalSiteEnv = OTA) => actual.legalLinks(locale, source),
  };
});

vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => editionFlag.selfhost };
});

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    create: vi.fn(),
    googleAuthorize: vi.fn(),
    dropboxAuthorize: vi.fn(),
    microsoftAuthorize: vi.fn(),
    listSharedDrives: vi.fn(),
    listSharedFolders: vi.fn(),
    listDropboxSharedFolders: vi.fn(),
  },
  connectionsApi: {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue({ ok: false, reason: 'not in this test' }),
    rotate: vi.fn(),
    test: vi.fn(),
  },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: { get: clients },
  setupApi: { get: vi.fn(), setStep: vi.fn() },
}));

vi.mock('../services/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api.ts')>();
  return {
    ...actual,
    default: { get: (...args: unknown[]) => getMock(...args), post: vi.fn() },
  };
});

import RequestAccess from '../pages/RequestAccess.tsx';
import ReportProblem from '../pages/ReportProblem.tsx';
import CreateMapping from '../pages/CreateMapping.tsx';
import { ProviderConsentPanel, useProviderConsent } from './ProviderConsent.tsx';

const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** The address the module makes for a text, in a language, on the site the pages were given. */
async function address(page: LegalLinks.LegalPage, locale: Locale): Promise<string> {
  const actual = await vi.importActual<typeof LegalLinks>('../services/legal-links.ts');
  return actual.legalUrl(page, locale, OTA);
}

/** Every link on the page to that address; one is expected where a notice belongs. */
const linksTo = (href: string): HTMLAnchorElement[] =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((a) => a.href === href);

/** The one link to a text, opened in a new tab, so a half-typed form is still there afterwards. */
async function theLink(page: LegalLinks.LegalPage, locale: Locale): Promise<HTMLAnchorElement> {
  const href = await address(page, locale);
  const found = linksTo(href);
  expect(found, `no link to the ${page} text at ${href}, the address legal-links.ts makes, in ${locale}`).toHaveLength(1);
  const link = found[0]!;
  expect(link.target, `the ${page} link replaces the page it was opened from`).toBe('_blank');
  expect(link.rel).toMatch(/\bnoopener\b/);
  return link;
}

function wrap(locale: Locale, node: React.ReactNode, path: string, route: string) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  editionFlag.selfhost = false;
  clients.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  globalThis.localStorage.clear();
});

describe('the request form', () => {
  /** The form's last line before it ends: the submit button, which the notice follows. */
  const submit = (locale: Locale) => screen.getByRole('button', { name: STRINGS[locale]['access.submit'] });

  for (const locale of LOCALES) {
    it(`${locale}: links the privacy policy under the form`, async () => {
      wrap(locale, <RequestAccess />, '/request-access', '/request-access');
      const link = await theLink('privacy', locale);
      const button = submit(locale);
      expect(button.closest('form'), 'the link is not with the form it is about').toContainElement(link);
      expect(
        button.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
        'the link is not under the form',
      ).toBeTruthy();
    });

    it(`${locale}: during the alpha, the Alpha conditions beside it`, async () => {
      vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
      wrap(locale, <RequestAccess />, '/request-access', '/request-access');
      const privacy = await theLink('privacy', locale);
      const alpha = await theLink('alpha', locale);
      expect(privacy.parentElement, 'the conditions are not beside the policy').toContainElement(alpha);
    });

    it(`${locale}: outside the alpha, the policy and no conditions`, async () => {
      wrap(locale, <RequestAccess />, '/request-access', '/request-access');
      await theLink('privacy', locale);
      expect(linksTo(await address('alpha', locale))).toHaveLength(0);
    });

    it(`${locale}: says how long a request is kept, as privacy §9 does`, () => {
      // Privacy §9's row: "While it is open. Declined: deleted 30 days after
      // our decision. Granted: kept with your account, and erased with it."
      const SAYS = {
        en: [/while your request is open/, /decline/, /30 days after our decision/, /grant/, /with your account/, /erased/],
        nl: [/zolang uw aanvraag openstaat/, /wijzen we die af/i, /30 dagen na ons besluit/, /kennen we die toe/i, /bij uw account/, /gewist/],
      } as const;
      const line = STRINGS[locale]['access.privacy'];
      for (const says of SAYS[locale]) expect(line, `access.privacy in ${locale}`).toMatch(says);
      wrap(locale, <RequestAccess />, '/request-access', '/request-access');
      expect(screen.getByText(line)).toBeInTheDocument();
    });
  }
});

/** The Connections page's consent, without the page around it. */
const Panel: React.FC<{ type: string }> = ({ type }) => {
  const consent = useProviderConsent({
    role: 'source',
    type,
    fields: credentialFieldsFor('source', type),
    values: { username: 'owner@example.invalid' },
    onToken: () => {},
    refusalText: (e) => String(e),
  });
  return <ProviderConsentPanel consent={consent} />;
};

describe('the Connect buttons', () => {
  /** Both texts, beside the button: in the block the button sits in, not a footer. */
  async function bothBeside(button: HTMLElement, locale: Locale): Promise<void> {
    for (const page of ['privacy', 'terms'] as const) {
      const link = await theLink(page, locale);
      expect(button.parentElement, `the ${page} link is not beside the button`).toContainElement(link);
    }
  }

  for (const locale of LOCALES) {
    for (const type of ['google', 'microsoft', 'dropbox'] as const) {
      it(`${locale}: the consent panel links the privacy policy and the terms beside Connect with ${type}`, async () => {
        wrap(locale, <Panel type={type} />, '/connections', '/connections');
        const button = await screen.findByRole('button', {
          name: (STRINGS[locale] as Record<string, string>)[`wizard.${type}.connect`],
        });
        await bothBeside(button, locale);
      });
    }

    it(`${locale}: the wizard's Google account says the same beside its own button`, async () => {
      wrap(locale, <CreateMapping />, '/mappings/new', '/mappings/new');
      fireEvent.click(screen.getByRole('button', { name: /^Google account/ }));
      const name = STRINGS[locale]['wizard.google.connect'];
      await waitFor(() => expect(screen.getByRole('button', { name })).toBeTruthy());
      await bothBeside(screen.getByRole('button', { name }), locale);
    });

    it(`${locale}: an appliance links neither, because this policy is not its owner's`, async () => {
      editionFlag.selfhost = true;
      wrap(locale, <Panel type="google" />, '/connections', '/connections');
      expect(await screen.findByRole('button', { name: STRINGS[locale]['wizard.google.connect'] })).toBeTruthy();
      expect(linksTo(await address('privacy', locale))).toHaveLength(0);
      expect(linksTo(await address('terms', locale))).toHaveLength(0);
    });
  }
});

describe('the report form', () => {
  beforeEach(() => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/problem-reports/available') return { data: { available: true } };
      if (url === '/problem-reports/preview') {
        return { data: { to: { kind: 'mail', addresses: ['support@ownpace.eu'] }, lines: ['Page: /mappings'] } };
      }
      throw new Error(`an unexpected GET ${url}`);
    });
    useAuthStore.setState({
      user: { id: 'u1', email: 'someone@example.invalid', name: 'Someone', role: 'owner' },
    });
  });

  for (const locale of LOCALES) {
    it(`${locale}: links the privacy policy beside what it says it sends`, async () => {
      wrap(locale, <ReportProblem />, '/report?from=%2Fmappings', '/report');
      const facts = await screen.findByText(STRINGS[locale]['report.facts']);
      const box = facts.closest('details')?.parentElement;
      expect(box, 'the box that says what is sent was not found').toBeTruthy();
      const link = await theLink('privacy', locale);
      expect(box, 'the policy is not beside what the form says it sends').toContainElement(link);
    });
  }
});
