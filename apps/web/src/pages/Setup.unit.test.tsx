// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The provider setup checklist screen (workplan 0061).
 *
 * What these hold is what makes the page worth building over the amber
 * paragraph it replaces: a step says what VALUE it yields, the steps needing
 * an administrator are called out (that being the usual reason a setup
 * stalls), ticking persists through the API rather than living in component
 * state, and "nothing to set up" renders as an answer instead of an empty page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { providerDisplayName, setupStepsFor, summariseSetup, type SetupSide } from '@openmig/shared';
import type { SetupChecklist } from '../services/mapping-service.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS, type Locale } from '../i18n/strings.ts';
import { useAuthStore } from '../stores/auth-store.ts';

const { get, setStep } = vi.hoisted(() => ({ get: vi.fn(), setStep: vi.fn() }));
/** The edition the chooser and Help's tabs read: managed unless a case says the appliance. */
const { edition } = vi.hoisted(() => ({ edition: { selfhost: false } }));

vi.mock('../services/mapping-service', () => ({
  setupApi: { get, setStep },
}));

vi.mock('../services/edition.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/edition.ts')>()),
  isSelfHost: () => edition.selfhost,
}));

import Setup from './Setup.tsx';

const checklist = (over: Partial<SetupChecklist> = {}): SetupChecklist => ({
  side: 'source',
  provider: 'box',
  steps: [
    {
      step: {
        key: 'create_app',
        titleKey: 'setup.box.create_app.title',
        detailKey: 'setup.box.create_app.detail',
        yieldsKey: 'setup.box.create_app.yields',
      },
      state: 'open',
    },
    {
      step: {
        key: 'admin_authorize',
        titleKey: 'setup.box.admin_authorize.title',
        detailKey: 'setup.box.admin_authorize.detail',
        needsAnotherPerson: true,
      },
      state: 'open',
    },
  ],
  progress: { total: 2, done: 0, skipped: 0, open: 2, blockedOnOthers: 1, complete: false },
  ...over,
});

function renderPage(entry: string | { pathname: string; state?: unknown } = '/setup/source/box') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry as never]}>
        <Routes>
          <Route path="/setup/:side/:provider" element={<Setup />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  setStep.mockReset();
});

describe('the setup checklist screen', () => {
  it('says what each step YIELDS — the value you come back with', async () => {
    get.mockResolvedValue(checklist());
    renderPage();

    // "You get: a Client ID and a Client Secret."
    expect(await screen.findByText(/Client ID and a Client Secret/)).toBeTruthy();
  });

  it('calls out the steps that need an administrator, and counts them', async () => {
    get.mockResolvedValue(checklist());
    renderPage();

    expect(await screen.findByText(/needs an administrator/)).toBeTruthy();
    // The header explains WHY it is stuck, not just how many are left.
    expect(screen.getByText(/waiting on an administrator/)).toBeTruthy();
  });

  it('ticking a step persists it through the API, not just in the component', async () => {
    get.mockResolvedValue(checklist());
    setStep.mockResolvedValue(
      checklist({
        steps: [
          {
            step: {
              key: 'create_app',
              titleKey: 'setup.box.create_app.title',
              detailKey: 'setup.box.create_app.detail',
            },
            state: 'done',
            decidedBy: 'someone@example.nl',
            decidedAt: '2026-08-17T10:00:00Z',
          },
        ],
        progress: { total: 1, done: 1, skipped: 0, open: 0, blockedOnOthers: 0, complete: true },
      }),
    );
    renderPage();

    fireEvent.click((await screen.findAllByLabelText(/Mark this step done/))[0]!);

    await waitFor(() =>
      expect(setStep).toHaveBeenCalledWith('source', 'box', 'create_app', 'done'),
    );
    // ...and the refreshed answer is what gets rendered.
    expect(await screen.findByText(/you can connect the account now/)).toBeTruthy();
  });

  it('skipping is a first-class answer, recorded rather than hidden', async () => {
    get.mockResolvedValue(checklist());
    setStep.mockResolvedValue(checklist());
    renderPage();

    fireEvent.click((await screen.findAllByText('Skip'))[0]!);

    await waitFor(() =>
      expect(setStep).toHaveBeenCalledWith('source', 'box', 'create_app', 'skipped'),
    );
  });

  it('"nothing to set up" is an answer, not an empty page', async () => {
    get.mockResolvedValue(
      checklist({
        steps: [],
        progress: { total: 0, done: 0, skipped: 0, open: 0, blockedOnOthers: 0, complete: false },
      }),
    );
    renderPage();

    expect(await screen.findByText(/Nothing to set up in advance/)).toBeTruthy();
  });

  it('opens the step you are on and folds the rest — the how-to waits under "How?" (0118 T1)', async () => {
    get.mockResolvedValue(checklist());
    renderPage();
    await screen.findByText(/Client ID and a Client Secret/);

    const folds = document.querySelectorAll('details');
    expect(folds).toHaveLength(2);
    // The first step still open is the one somebody is on: open. The next waits.
    expect(folds[0]!.open).toBe(true);
    expect(folds[1]!.open).toBe(false);
    // The words are all there for whoever opens them — folded, not cut.
    expect(screen.getByText(/Custom Apps Manager/)).toBeTruthy();
    expect(screen.getAllByText('How?')).toHaveLength(2);
  });
});


/**
 * A checklist that says WHOSE it is, and gets you back where you were
 * (workplan 0074).
 *
 * Two things the owner reported in the same breath. The heading rendered the
 * wizard type — an operator was told to configure `oauth2`, and asked the
 * question that makes it obvious: *how should a user guess that is for Entra
 * ID?* And the back link was a hardcoded *← Back to the migration wizard*, so
 * reaching this page from Connections — which links here by design since 0065
 * — sent you somewhere you had never been.
 */
describe('Setup — names the provider, and goes back where you came from (0074)', () => {
  beforeEach(() => {
    get.mockReset();
    setStep.mockReset();
  });

  it('heads the page with the provider NAME, not the wizard type', async () => {
    get.mockResolvedValue(checklist({ provider: 'oauth2' }));
    renderPage({ pathname: '/setup/source/oauth2' });

    // BOTH places that name the provider — the heading and the admin
    // question. The second one is why this assertion is `getAllByText`: it
    // was missed on the first pass and this test is what found it.
    expect((await screen.findAllByText(/Microsoft 365/)).length).toBeGreaterThanOrEqual(2);
    // The raw type must not be what an operator is asked to go and configure.
    expect(screen.queryByText(/— oauth2/)).toBeNull();
  });

  it('returns to Accounts, wherever it was opened from, since the wizard it led back to retired', async () => {
    // Start a migration opens it in a tab of its own, so its screens stay
    // where they were (0153 D5).
    get.mockResolvedValue(checklist());
    renderPage();

    const back = await screen.findByText(/Back to accounts/);
    expect(back.getAttribute('href')).toBe('/connections');
    expect(screen.queryByText(/Back to the wizard/)).toBeNull();
  });
});


/**
 * A checklist that asks for what the product actually uses.
 *
 * The Google checklist said to enable "Drive, Gmail, Calendar, People or
 * Tasks", while the calendar and contacts faces read Google's CalDAV and
 * CardDAV endpoints — which are separate APIs, and the owner was refused at
 * Test for want of the CalDAV one. It offered a Desktop client, which has no
 * redirect for Connect. And the JMAP checklist asked for an "API token" the
 * connector cannot send: it signs in with HTTP Basic username:password, in a
 * field labelled Password. These render the real steps, not a fixture.
 */
describe('Setup — asks for what the product uses', () => {
  const real = (side: SetupSide, provider: string): SetupChecklist => {
    const steps = setupStepsFor(side, provider).map((step) => ({ step, state: 'open' as const }));
    return { side, provider, steps, progress: summariseSetup(steps) };
  };

  it('names the Google APIs the source calls, and a Web client', async () => {
    get.mockResolvedValue(real('source', 'google-calendar'));
    renderPage('/setup/source/google-calendar');

    expect(await screen.findByText(/CalDAV API, Google Contacts CardDAV API/)).toBeTruthy();
    expect(screen.getByText(/OAuth client ID, as a Web application\./)).toBeTruthy();
    expect(screen.queryByText(/Desktop/)).toBeNull();
  });

  it('asks a JMAP target for the password it signs in with, not a token', async () => {
    get.mockResolvedValue(real('target', 'jmap'));
    renderPage('/setup/target/jmap');

    expect(await screen.findByText('Create an app password for it')).toBeTruthy();
    expect(screen.getByText(/a username and an app password/)).toBeTruthy();
    expect(screen.queryByText(/API token/)).toBeNull();
  });
});


/**
 * "Read the full setup guide" opened the not-found page for every target and
 * for the IMAP source: the link was `/docs/${provider}-setup` whether or not
 * that guide exists, and no target had one. It showed only when it went
 * somewhere. Since workplan 0148 T4 every card has a guide, and the link opens
 * the card's own section: the card's `guide` field, `<slug>#<section>`, read
 * for the side the checklist is for (`a-guide-for-every-card.unit.test.tsx`
 * checks every card).
 */
describe('Setup — links the card\'s own guide section', () => {
  it('links the section of the card the checklist is for', async () => {
    get.mockResolvedValue(checklist());
    renderPage();

    const guide = await screen.findByText('Read the full setup guide');
    expect(guide.getAttribute('href')).toBe('/docs/box#box');
  });

  // One guide per family of cards (workplan 0148 T4): the Google products
  // share `google`, the Microsoft cards `microsoft`, each with its own section.
  it.each([
    ['source', 'gmail', '/docs/google#gmail'],
    ['source', 'graph', '/docs/microsoft#graph'],
    ['source', 'imap', '/docs/imap#imap-source'],
    ['target', 'imap', '/docs/imap#imap-target'],
    ['target', 'webdav', '/docs/dav#webdav'],
  ] as const)('links the family guide for the %s card %s', async (side, provider, href) => {
    get.mockResolvedValue(checklist({ side, provider }));
    renderPage(`/setup/${side}/${provider}`);

    const guide = await screen.findByText('Read the full setup guide');
    expect(guide.getAttribute('href')).toBe(href);
  });

  it('offers no link for a provider with no card on that side', async () => {
    // Box is a source card and not a target, so a target checklist for it
    // names no guide section, and a link would open the wrong door's guide.
    get.mockResolvedValue(checklist({ side: 'target', provider: 'box' }));
    renderPage('/setup/target/box');

    await screen.findAllByText(/Client ID and a Client Secret/);
    expect(screen.queryByText('Read the full setup guide')).toBeNull();
  });
});

describe('Help draws its content in white cards, as the other pages do (2026-10-05)', () => {
  it('the chooser: each side a white card, its tiles inside it', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/setup']}>
          <Routes>
            <Route path="/setup" element={<Setup />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const tile = screen.getByRole('link', { name: 'Dropbox' });
    expect(tile.closest('section')?.className).toContain('bg-white');
  });

  it('the checklist: each step a row of one white card, and no list item inside a list item', async () => {
    get.mockResolvedValue(checklist());
    const { container } = renderPage();

    const step = await screen.findByText('Create a Box platform app');
    expect(step.closest('section')?.className).toContain('bg-white');
    // Each step was a `<li>` drawn inside the list's own `<li>`.
    expect(container.querySelectorAll('li li')).toHaveLength(0);
  });
});


/**
 * HELP'S CHECKLIST, AS THE UX SWEEP FOUND IT (2026-10-17).
 *
 * - The Dutch intro said *uw oude aanbieder* on a destination's checklist,
 *   Nextcloud's and Soverin's included: one sentence served both sides. The
 *   owner's sentence stays for a source (text review decision 25); a
 *   destination says *new provider*.
 * - *Do you manage this system?* marked the chosen answer by its colour only,
 *   so a screen reader could not tell which was in force.
 * - Opening a checklist dropped Help's two tabs, and the checklist had a
 *   second `<h1>` beside the frame's and a wider column than the guides.
 * - The chooser had no entry for the Microsoft 365 account, the usual card,
 *   listed the two Google cards retired for new migrations, and kept the
 *   profiles' key order, so IMAP sat between the two Microsoft entries.
 * - On a phone the Skip button was a third column, squeezing each step's
 *   words into the middle; a skipped step's title was gray-400 (2.5:1).
 */
describe('the checklist matches the forms, and Help stays one page (UX sweep)', () => {
  const realChecklist = (side: SetupSide, provider: string): SetupChecklist => {
    const steps = setupStepsFor(side, provider).map((step) => ({ step, state: 'open' as const }));
    return { side, provider, steps, progress: summariseSetup(steps) };
  };

  /** A route of Help, as the app mounts it: the real locale provider, a router. */
  function renderIn(locale: Locale, path: string) {
    window.localStorage.setItem('ownpace.locale', locale);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <LocaleProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/setup" element={<Setup />} />
              <Route path="/setup/:side/:provider" element={<Setup />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  beforeEach(() => {
    edition.selfhost = false;
    useAuthStore.setState({ tenantCount: 0 });
  });

  afterEach(() => {
    window.localStorage.removeItem('ownpace.locale');
    window.localStorage.removeItem('setup.admin.source.box');
  });

  it.each(['en', 'nl'] as const)(
    '%s: a destination’s checklist says new provider; a source’s keeps the owner’s sentence',
    async (locale) => {
      get.mockResolvedValue(realChecklist('target', 'nextcloud'));
      const target = renderIn(locale, '/setup/target/nextcloud');
      expect(await screen.findByText(STRINGS[locale]['setup.target.intro'])).toBeTruthy();
      expect(screen.queryByText(STRINGS[locale]['setup.intro'])).toBeNull();
      target.unmount();

      get.mockResolvedValue(realChecklist('source', 'google'));
      renderIn(locale, '/setup/source/google');
      expect(await screen.findByText(STRINGS[locale]['setup.intro'])).toBeTruthy();
      expect(screen.queryByText(STRINGS[locale]['setup.target.intro'])).toBeNull();
    },
  );

  it('words the destination’s intro as the sweep gives it, and leaves the owner’s as it was', () => {
    expect(STRINGS.en['setup.target.intro']).toBe(
      'Steps to take at your new provider; ticks are saved for your whole organisation.',
    );
    expect(STRINGS.nl['setup.target.intro']).toBe(
      'Stappen om door te lopen bij uw nieuwe aanbieder; vinkjes worden voor uw hele organisatie bewaard.',
    );
    expect(STRINGS.nl['setup.intro']).toBe(
      'Stappen om door te lopen bij uw oude aanbieder; vinkjes worden voor uw hele organisatie bewaard.',
    );
  });

  // *Aanbieder instellen — Nextcloud* read as an order about the provider
  // being left. A checklist is headed with its tab's own name, which the
  // glossary keeps (the owner, 2026-10-18); and the English source intro says
  // *your old provider*, as the owner's Dutch does.
  it.each([
    ['en', 'Setup checklist — Nextcloud'],
    ['nl', 'Instelchecklist — Nextcloud'],
  ] as const)('%s: heads a checklist with the tab’s own name', async (locale, heading) => {
    get.mockResolvedValue(realChecklist('target', 'nextcloud'));
    renderIn(locale, '/setup/target/nextcloud');
    expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeTruthy();
    // The tab's name, word for word.
    expect(STRINGS[locale]['setup.title']).toBe(STRINGS[locale]['nav.setup']);
  });

  it('says in English, as in Dutch, that a source’s steps are taken at the old provider', () => {
    expect(STRINGS.en['setup.intro']).toBe(
      'Steps to take at your old provider; ticks are saved for your whole organisation.',
    );
  });

  it('tells a screen reader which answer to the administrator question is chosen', async () => {
    get.mockResolvedValue(checklist());
    renderIn('en', '/setup/source/box');

    const group = await screen.findByRole('group', { name: `${STRINGS.en['setup.admin.question']} — Box` });
    const pressed = () => within(group).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'));
    // Nobody has answered: "Show me everything" is in force.
    expect(pressed()).toEqual(['false', 'false', 'true']);

    fireEvent.click(within(group).getByRole('button', { name: STRINGS.en['setup.admin.no'] }));
    expect(pressed()).toEqual(['false', 'true', 'false']);
  });

  it('keeps Help’s tabs on a checklist, the checklist tab current, above the way back to Accounts', async () => {
    useAuthStore.setState({ tenantCount: 1 });
    get.mockResolvedValue(checklist());
    renderIn('en', '/setup/source/box');

    const back = await screen.findByRole('link', { name: STRINGS.en['setup.backToConnections'] });
    const tabs = screen.getByRole('navigation', { name: STRINGS.en['nav.help'] });
    expect(within(tabs).getByRole('link', { name: STRINGS.en['nav.setup'] })).toHaveAttribute('aria-current', 'page');
    expect(tabs.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(back).toHaveAttribute('href', '/connections');
  });

  it('heads a checklist with an h2 under the frame’s h1, its two lists with h3s, in the guides’ width', async () => {
    window.localStorage.setItem('setup.admin.source.box', 'no');
    get.mockResolvedValue(checklist());
    const { container } = renderIn('en', '/setup/source/box');

    expect(await screen.findByRole('heading', { level: 2, name: 'Setup checklist — Box' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: STRINGS.en['setup.yours'] })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: STRINGS.en['setup.forYourAdmin'] })).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).className.split(/\s+/)).toContain('max-w-3xl');
  });

  it.each(['en', 'nl'] as const)(
    '%s: the chooser offers the Microsoft 365 account and not the retired Google cards, by name, as an h2 over two h3s',
    (locale) => {
      renderIn(locale, '/setup');

      expect(screen.getByRole('heading', { level: 2, name: STRINGS[locale]['setup.choose.title'] })).toBeTruthy();
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();

      const from = screen.getByRole('region', { name: STRINGS[locale]['setup.choose.sources'] });
      const sources = within(from).getAllByRole('link').map((a) => a.textContent!);
      expect(within(from).getByRole('link', { name: providerDisplayName('microsoft', locale) })).toHaveAttribute(
        'href',
        '/setup/source/microsoft',
      );
      expect(sources).not.toContain(providerDisplayName('google-calendar', locale));
      expect(sources).not.toContain(providerDisplayName('google-contacts', locale));
      expect(sources).toEqual([...sources].sort((a, b) => a.localeCompare(b, locale)));

      const to = screen.getByRole('region', { name: STRINGS[locale]['setup.choose.targets'] });
      const targets = within(to).getAllByRole('link').map((a) => a.textContent!);
      expect(targets).toEqual([...targets].sort((a, b) => a.localeCompare(b, locale)));
      expect(targets).toContain('Nextcloud');
    },
  );

  it('the appliance offers no Microsoft 365 account tile: it carries no Microsoft app', () => {
    edition.selfhost = true;
    renderIn('en', '/setup');

    const from = screen.getByRole('region', { name: STRINGS.en['setup.choose.sources'] });
    expect(within(from).queryByRole('link', { name: providerDisplayName('microsoft', 'en') })).toBeNull();
    expect(within(from).getByRole('link', { name: 'Box' })).toBeTruthy();
  });

  it('puts Skip in a step’s title row, a finger high, so the step’s words take the card’s width', async () => {
    get.mockResolvedValue(checklist());
    renderIn('en', '/setup/source/box');

    const title = await screen.findByText('Create a Box platform app');
    const skip = screen.getAllByRole('button', { name: STRINGS.en['setup.skip'] })[0]!;
    expect(skip.parentElement).toBe(title.parentElement);
    // A finger high, without making the row taller than its title (the tick box stays level).
    expect(skip.className.split(/\s+/)).toEqual(expect.arrayContaining(['ml-auto', 'min-h-[44px]', '-my-2.5']));
  });

  it('a skipped step’s title stays readable: struck through in gray-500, not gray-400', async () => {
    const open = checklist();
    get.mockResolvedValue(
      checklist({
        steps: [{ ...open.steps[0]!, state: 'skipped' }, open.steps[1]!],
        progress: { total: 2, done: 0, skipped: 1, open: 1, blockedOnOthers: 1, complete: false },
      }),
    );
    renderIn('en', '/setup/source/box');

    const title = await screen.findByText('Create a Box platform app');
    expect(title.className.split(/\s+/)).toEqual(expect.arrayContaining(['line-through', 'text-gray-500']));
    expect(title.className).not.toContain('text-gray-400');
  });
});
