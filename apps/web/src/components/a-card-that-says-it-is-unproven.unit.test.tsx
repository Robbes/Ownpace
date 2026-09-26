// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CARD THAT SAYS IT IS UNPROVEN (workplan 0131 T2 (a); the owner's D6,
 * *"Label"*; 0141 T1).
 *
 * Both doors offered every source card the same way. A card whose connector
 * had run against the owner's own Google account for weeks looked exactly like
 * one that had never met a real account at all: Dropbox, Box, the Apple
 * account, every face of the Microsoft 365 account, Google Tasks and
 * whole-domain delegation. Whether a source had met a real account was written
 * down in `docs/feature-matrix.md` and in CI's coverage table, and the screen
 * read neither. A tester choosing a card had no way to know which kind they
 * were choosing.
 *
 * The owner chose to label them, not to hide them and not to prove them first.
 * So one table in shared (`SOURCE_PROOFS`, beside `FRONT_DOOR_FAMILIES`) holds a
 * verdict for each source kind and, for the account kinds, one for each face:
 * *proven*, naming where its run is recorded, or *experimental*. Both doors and
 * the wizard's data-type step read it.
 *
 * What is pinned here:
 *
 * - every `SOURCE_CARDS` id has a verdict, on both editions, and every proven
 *   verdict names where its run is recorded (the other half, that the place
 *   exists, is `scripts/a-proof-that-was-written-down.unit.test.ts`);
 * - both doors tag exactly the experimental cards, and no proven one, in
 *   English and in Dutch, and no target card (0131 open question 5 is open);
 * - the words are *Experimental* and *Experimenteel*, as 0131 T2 and the
 *   glossary fix them;
 * - the tag is text inside the card's `<button>` and part of the card's
 *   accessible name, which is what a screen reader reads (0145 T2): both are
 *   asserted, because a word hidden from the name still sits in the text; and
 *   the fold with its why sits beside the card, not inside it;
 * - the appliance shows it too: a fact about a connector is not a fact about
 *   an edition;
 * - nothing is hidden on managed: the export archive card is offered there at
 *   both doors and carries the tag (0148 D10), and so does *Via IMAP* (0148
 *   D5), looked up by name on the screen so a card dropped from a list cannot
 *   pass unseen;
 * - the data-type step tags an experimental face of the chosen account and
 *   not a proven one;
 * - the whole-domain option on the Google cards carries the tag in the box's
 *   name, and its why in a fold, at both doors.
 *
 * The expected sets are read from the table rather than typed out here, so a
 * face that is proven later changes one table and one matrix row (0141 T1),
 * not this file. The two non-empty checks keep that from passing on nothing.
 *
 * Not pinned here: the why's link to the known-limitations page (0131 T2 (b),
 * after 0144 T2).
 */

import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import {
  PROVIDER_ACCOUNT_KINDS,
  SOURCE_PROOFS,
  isProviderAccountKind,
  sourceCardIsExperimental,
  sourceFaceIsExperimental,
  type SourceProof,
} from '@openmig/shared';

const edition = vi.hoisted(() => ({ selfhost: false }));
vi.mock('../services/edition.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/edition.ts')>()),
  isSelfHost: () => edition.selfhost,
}));

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    create: vi.fn(),
    testConnection: vi.fn(),
    googleAuthorize: vi.fn(),
    dropboxAuthorize: vi.fn(),
    microsoftAuthorize: vi.fn(),
  },
  connectionsApi: { list, test: vi.fn(), add: vi.fn(), rotate: vi.fn(), remove: vi.fn() },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: {
    get: vi.fn().mockResolvedValue({ google: 'connection', dropbox: 'connection', microsoft: 'connection' }),
  },
  setupApi: { get: vi.fn(), setStep: vi.fn() },
}));

import { SOURCE_CARDS, frontDoorCards, migratableSourceCards, type FrontDoorCard } from './front-door-cards.ts';
import CreateMapping from '../pages/CreateMapping.tsx';
import Connections from '../pages/Connections.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS, type Locale } from '../i18n/strings.ts';

function renderAt(path: string, element: ReactElement, locale: Locale = 'en') {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

const renderWizard = (locale: Locale = 'en') => renderAt('/mappings/new', <CreateMapping />, locale);

/** The Connections page's add-form, opened, on the side asked for. */
async function renderAddForm(locale: Locale = 'en', side: 'source' | 'target' = 'source') {
  renderAt('/connections', <Connections />, locale);
  fireEvent.click(await screen.findByText(STRINGS[locale]['connections.add']));
  if (side === 'target') fireEvent.click(screen.getByRole('radio', { name: STRINGS[locale]['connections.targets'] }));
}

/** The name a card shows, in a language. */
const shown = (card: FrontDoorCard, locale: Locale): string =>
  card.name ?? STRINGS[locale][card.nameKey as keyof (typeof STRINGS)['en']];

/** The card's button, found the way a person finds it: by the name it starts with. */
const cardButton = (card: FrontDoorCard, locale: Locale): HTMLElement => {
  const name = shown(card, locale).replace(/[()]/g, '\\$&');
  return screen.getByRole('button', { name: new RegExp(`^${name}`) });
};

/** The tag's word as a pattern for an accessible name, whole words only. */
const tagIn = (tag: string): RegExp => new RegExp(`\\b${tag}\\b`);

/** Every verdict in the table, with where it sits, for the checks that walk them all. */
function everyVerdict(): Array<{ where: string; proof: SourceProof }> {
  const out: Array<{ where: string; proof: SourceProof }> = [];
  for (const [kind, proof] of Object.entries(SOURCE_PROOFS.kinds)) out.push({ where: kind, proof });
  for (const [kind, faces] of Object.entries(SOURCE_PROOFS.faces)) {
    for (const [face, proof] of Object.entries(faces)) {
      if (proof) out.push({ where: `${kind} ${face}`, proof });
    }
  }
  out.push({ where: 'whole-domain delegation', proof: SOURCE_PROOFS.wholeDomain });
  // Not a card: the scope manifest's "Shared mailboxes" row follows it (0141 T10).
  out.push({ where: 'shared mailboxes', proof: SOURCE_PROOFS.sharedMailbox });
  return out;
}

beforeEach(() => {
  globalThis.sessionStorage.clear();
  globalThis.localStorage.clear();
  list.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  edition.selfhost = false;
  globalThis.localStorage.clear();
});

describe('one table says which sources have met a real account', () => {
  it('every source card has a verdict: its own, or one for each face of its account', () => {
    expect(SOURCE_PROOFS, 'there is no verdict table in shared').toBeDefined();
    for (const card of SOURCE_CARDS) {
      if (isProviderAccountKind(card.id)) {
        const faces = Object.keys(SOURCE_PROOFS.faces[card.id] ?? {});
        expect(faces.length, `the ${card.id} account has no face verdicts`).toBeGreaterThan(0);
      } else {
        expect(SOURCE_PROOFS.kinds[card.id], `${card.id} has no verdict`).toBeDefined();
      }
    }
    for (const kind of PROVIDER_ACCOUNT_KINDS) {
      expect(SOURCE_PROOFS.faces[kind], `the ${kind} account kind has no row of face verdicts`).toBeDefined();
    }
  });

  it('every proven verdict names where its run is recorded', () => {
    const all = everyVerdict();
    expect(all.some((v) => v.proof.verdict === 'proven'), 'nothing is proven: the check below would pass on nothing').toBe(true);
    expect(all.some((v) => v.proof.verdict === 'experimental'), 'nothing is experimental').toBe(true);
    for (const { where, proof } of all) {
      expect(['proven', 'experimental'], `${where}: an unknown verdict`).toContain(proof.verdict);
      if (proof.verdict === 'proven') {
        expect(proof.recorded.trim(), `${where} is proven and names no record`).toBeTruthy();
      }
    }
  });

  it('the tag says Experimental in English and Experimenteel in Dutch (0131 T2, the glossary)', () => {
    // Read from the plan, not from the dictionary: every other case reads the
    // word from STRINGS, so a Dutch door showing the English word would pass them.
    expect(STRINGS.en['frontDoor.experimental']).toBe('Experimental');
    expect(STRINGS.nl['frontDoor.experimental']).toBe('Experimenteel');
    expect(STRINGS.en['frontDoor.experimental.why']).toBe(
      'Built, not yet run against a real account of this kind. Keep your old account and check what arrives.',
    );
  });

  it('an account card is experimental when every face it has is, and not when one is proven', () => {
    for (const kind of PROVIDER_ACCOUNT_KINDS) {
      const faces = Object.values(SOURCE_PROOFS.faces[kind]);
      const allExperimental = faces.every((p) => p?.verdict === 'experimental');
      expect(sourceCardIsExperimental(kind), kind).toBe(allExperimental);
    }
  });
});

describe.each(['en', 'nl'] as const)('both doors tag exactly the experimental cards (%s)', (locale) => {
  const tag = STRINGS[locale]['frontDoor.experimental'];

  for (const selfhost of [false, true]) {
    const build = selfhost ? 'appliance' : 'managed';

    it(`the wizard, on a ${build} build`, () => {
      edition.selfhost = selfhost;
      renderWizard(locale);
      const cards = migratableSourceCards() as ReadonlyArray<FrontDoorCard>;
      expect(cards.some((c) => sourceCardIsExperimental(c.id)), 'no experimental card is offered').toBe(true);
      expect(cards.some((c) => !sourceCardIsExperimental(c.id)), 'no proven card is offered').toBe(true);
      for (const card of cards) {
        const button = cardButton(card, locale);
        if (sourceCardIsExperimental(card.id)) {
          // Text inside the button, so it is part of the card's accessible
          // name (0145 T2), never an icon alone.
          expect(button.textContent, `${card.id} is experimental and the wizard does not say so`).toContain(tag);
          expect(button, `${card.id}: the tag is not part of the card's name`).toHaveAccessibleName(tagIn(tag));
        } else {
          expect(button.textContent, `${card.id} is proven and the wizard calls it experimental`).not.toContain(tag);
          expect(button, `${card.id} is proven and its name says experimental`).not.toHaveAccessibleName(tagIn(tag));
        }
      }
    });

    it(`the Connections page, on a ${build} build`, async () => {
      edition.selfhost = selfhost;
      await renderAddForm(locale);
      const cards = frontDoorCards('source');
      for (const card of cards) {
        const button = cardButton(card, locale);
        expect(button.textContent?.includes(tag), `${card.id} on the Connections page`).toBe(
          sourceCardIsExperimental(card.id),
        );
        if (sourceCardIsExperimental(card.id)) {
          expect(button, `${card.id}: the tag is not part of the card's name`).toHaveAccessibleName(tagIn(tag));
        } else {
          expect(button, `${card.id}: a proven card's name says experimental`).not.toHaveAccessibleName(tagIn(tag));
        }
      }
    });
  }

  it('no target card carries the tag: whether targets get one is still open (0131 open question 5)', async () => {
    await renderAddForm(locale, 'target');
    for (const card of frontDoorCards('target')) {
      expect(cardButton(card, locale).textContent, card.id).not.toContain(tag);
    }
  });
});

/**
 * Nothing is hidden on managed (0148 D10). The owner: *"Hide the archive card
 * on manage: I don't want them hidden. I want labelled as 'expirimental'."*
 *
 * The walks above iterate the lists the doors read, so a card dropped from a
 * list on one edition would leave them green: they would simply never look
 * for it. These look for the cards by name on the screen, on a MANAGED build
 * as well as the appliance, and ask that each is there and says it is
 * experimental. The export archive is the card the owner named; *Via IMAP*
 * stays on managed and stays tagged until the owner's run is recorded (0148
 * D5).
 */
describe.each(['en', 'nl'] as const)('the cards the owner kept are offered and tagged on both editions (%s)', (locale) => {
  const tag = STRINGS[locale]['frontDoor.experimental'];
  const kept = SOURCE_CARDS.filter((c) => c.id === 'archive' || c.id === 'oauth2');

  it('the table calls the export archive and Via IMAP experimental', () => {
    expect(kept.map((c) => c.id).sort()).toEqual(['archive', 'oauth2']);
    expect(SOURCE_PROOFS.kinds.archive?.verdict, 'the export archive (0148 D10)').toBe('experimental');
    expect(SOURCE_PROOFS.kinds.oauth2?.verdict, 'Via IMAP (0148 D5)').toBe('experimental');
  });

  for (const selfhost of [false, true]) {
    const build = selfhost ? 'appliance' : 'managed';

    it(`in the wizard, on a ${build} build`, () => {
      edition.selfhost = selfhost;
      renderWizard(locale);
      for (const card of kept) {
        // By name on the screen, not through the card list: getByRole throws
        // when the card is not offered here.
        const button = cardButton(card, locale);
        expect(button.textContent, `${card.id} is offered in the wizard and not tagged`).toContain(tag);
        expect(button, `${card.id}: the tag is not part of the card's name`).toHaveAccessibleName(tagIn(tag));
        expect(within(button.parentElement!).getByText(STRINGS[locale]['frontDoor.experimental.why'])).toBeTruthy();
      }
    });

    it(`on the Connections page, on a ${build} build`, async () => {
      edition.selfhost = selfhost;
      await renderAddForm(locale);
      for (const card of kept) {
        const button = cardButton(card, locale);
        expect(button.textContent, `${card.id} is offered on the Connections page and not tagged`).toContain(tag);
        expect(button, `${card.id}: the tag is not part of the card's name`).toHaveAccessibleName(tagIn(tag));
      }
    });
  }
});

describe('the why folds beside the card, never inside it (0145 T2)', () => {
  it('each experimental card has its fold as a sibling, closed, saying why', () => {
    renderWizard();
    const experimental = (migratableSourceCards() as ReadonlyArray<FrontDoorCard>).filter((c) =>
      sourceCardIsExperimental(c.id),
    );
    expect(experimental.length).toBeGreaterThan(0);
    for (const card of experimental) {
      const button = cardButton(card, 'en');
      // A fold inside a <button> could not be opened on its own.
      expect(button.querySelector('details'), `${card.id}: the fold is inside the button`).toBeNull();
      const beside = button.parentElement!;
      const fold = within(beside).getByText(STRINGS.en['frontDoor.experimental.why']);
      expect(fold.closest('details'), `${card.id}: the why is not behind a fold`).not.toBeNull();
      expect(fold).not.toBeVisible();
    }
  });

  it('a proven card has no fold beside it', () => {
    renderWizard();
    const proven = (migratableSourceCards() as ReadonlyArray<FrontDoorCard>).filter(
      (c) => !sourceCardIsExperimental(c.id),
    );
    expect(proven.length).toBeGreaterThan(0);
    for (const card of proven) {
      const beside = cardButton(card, 'en').parentElement!;
      expect(within(beside).queryByText(STRINGS.en['frontDoor.experimental.why']), card.id).toBeNull();
    }
  });
});

describe('the data-type step tags an experimental face of the chosen account', () => {
  const nextButton = () => screen.getByRole('button', { name: /^(Next|Create Migration)$/ });
  const storedTarget = {
    id: 'c0000000-0000-4000-8000-0000000000e2',
    role: 'target' as const,
    kind: 'nextcloud',
    displayName: 'The stored Nextcloud',
    status: 'connected' as const,
    createdAt: '2026-09-01T00:00:00.000Z',
    usedByMigrations: 0,
  };

  /** The box beside a label, as the reachability walk finds it. */
  const fill = (label: RegExp, value: string) => {
    const control = screen.getByText(label, { selector: 'label' }).parentElement?.querySelector('input, textarea');
    if (!control) throw new Error(`no control beside ${label}`);
    fireEvent.change(control, { target: { value } });
  };

  /**
   * Walk to the data-type step: the account card with its four boxes typed,
   * then a stored Nextcloud, which takes every face but mail.
   */
  async function walkToDataTypes(sourceCard: RegExp): Promise<void> {
    list.mockResolvedValue([storedTarget]);
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: sourceCard }));
    fill(/^Username/, 'anna@acme.example');
    fill(/^Client ID/, 'client-id');
    fill(/^Client secret/, 'shh-secret');
    fill(/^Refresh token/, 'refresh-token');
    await waitFor(() => expect(nextButton()).toBeEnabled());
    fireEvent.click(nextButton());
    fireEvent.click(await screen.findByRole('button', { name: /^Nextcloud/ }));
    await waitFor(() => expect(nextButton()).toBeEnabled());
    fireEvent.click(nextButton());
    await screen.findByText(STRINGS.en['wizard.selectDataTypes']);
  }

  const domainButton = (face: 'calendar' | 'contact' | 'file' | 'task') =>
    screen.getByRole('button', { name: new RegExp(`^${STRINGS.en[`domain.${face}`]}`) });

  it('the Microsoft 365 account: every face Nextcloud can take is tagged', async () => {
    await walkToDataTypes(/^Microsoft 365 account/);
    for (const face of ['calendar', 'contact', 'file', 'task'] as const) {
      expect(sourceFaceIsExperimental('microsoft', face), face).toBe(true);
      const button = domainButton(face);
      expect(button.textContent, `the Microsoft 365 account's ${face}`).toContain(STRINGS.en['frontDoor.experimental']);
      expect(button, `${face}: the tag is not part of the face's name`).toHaveAccessibleName(
        tagIn(STRINGS.en['frontDoor.experimental']),
      );
      expect(button.querySelector('details'), `${face}: the fold is inside the button`).toBeNull();
      expect(within(button.parentElement!).getByText(STRINGS.en['frontDoor.experimental.why'])).toBeTruthy();
    }
  });

  it('the Google account: a proven face is plain, and Tasks is tagged', async () => {
    await walkToDataTypes(/^Google account/);
    expect(sourceFaceIsExperimental('google', 'calendar')).toBe(false);
    expect(sourceFaceIsExperimental('google', 'task')).toBe(true);
    expect(domainButton('calendar').textContent).not.toContain(STRINGS.en['frontDoor.experimental']);
    expect(domainButton('contact').textContent).not.toContain(STRINGS.en['frontDoor.experimental']);
    expect(domainButton('task').textContent).toContain(STRINGS.en['frontDoor.experimental']);
    expect(domainButton('task')).toHaveAccessibleName(tagIn(STRINGS.en['frontDoor.experimental']));
    expect(domainButton('calendar')).not.toHaveAccessibleName(tagIn(STRINGS.en['frontDoor.experimental']));
  });
});

describe('the whole-domain option on the Google cards carries the tag', () => {
  /** The service-account key's box, found by the name a screen reader gives it. */
  const keyBox = (label: RegExp) => screen.getByRole('textbox', { name: label });

  it('beside the service-account key, in the name of its box, with the why in its fold, in the wizard', () => {
    expect(SOURCE_PROOFS.wholeDomain.verdict).toBe('experimental');
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /^Google account/ }));
    const label = screen.getByText(/^Service account key/, { selector: 'label' });
    expect(label.textContent).toContain(STRINGS.en['frontDoor.experimental']);
    expect(keyBox(/^Service account key/)).toHaveAccessibleName(tagIn(STRINGS.en['frontDoor.experimental']));
    const why = screen.getByText(new RegExp(STRINGS.en['frontDoor.experimental.wholeDomain.why']));
    expect(why.closest('details'), 'the why is not behind a fold').not.toBeNull();
  });

  it('in Dutch too', () => {
    renderWizard('nl');
    fireEvent.click(screen.getByRole('button', { name: /^Google account/ }));
    const label = screen.getByText(/^Serviceaccount-sleutel/, { selector: 'label' });
    expect(label.textContent).toContain(STRINGS.nl['frontDoor.experimental']);
    expect(keyBox(/^Serviceaccount-sleutel/)).toHaveAccessibleName(tagIn(STRINGS.nl['frontDoor.experimental']));
  });

  it('on the Connections page, with the same why in a fold beside the box', async () => {
    await renderAddForm();
    fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
    const label = screen.getByText(/^Service account key/);
    expect(label.textContent).toContain(STRINGS.en['frontDoor.experimental']);
    const box = keyBox(/^Service account key/);
    expect(box).toHaveAccessibleName(tagIn(STRINGS.en['frontDoor.experimental']));
    // The two doors say the same thing about the same option.
    const why = screen.getByText(STRINGS.en['frontDoor.experimental.wholeDomain.why']);
    expect(why.closest('details'), 'the why is not behind a fold').not.toBeNull();
    // Beside the box, not inside its label: a fold inside the label would be
    // read as part of the box's name.
    expect(box.closest('label')?.contains(why), 'the fold is inside the label').toBe(false);
    expect(box.closest('label')?.parentElement?.contains(why), 'the fold is not beside the box').toBe(true);
  });
});
