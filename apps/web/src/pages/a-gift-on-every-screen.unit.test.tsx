// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RECOMMENDATION ON EVERY SCREEN (workplans 0172 and 0177).
 *
 *  - **The plain request form.** It keeps its questions, and its request
 *    still waits for the owner (0177 §17). A code has a door of its own,
 *    `/code` (`a-code-with-a-door-of-its-own.unit.test.tsx`).
 *  - **The giver's page** (0177 T5, T10, §9; §21.2's points 11 to 15). It
 *    says first what a recommendation does, then how many, that whoever has
 *    the code is let in, and what the giver will see. Making one sends the
 *    card's language and nothing else; the code is shown on the card with
 *    the names and message typed on the page, which are never sent. A link
 *    stands beside the card. When no card can be made it says *none for now*.
 *    A refusal it knows, it says in its own words and the page's language.
 *  - **The operator's Gifts** (0177 T16, §20; §21.2's point 17). Both counts
 *    with their ceilings, the two fields that set them, the cards not used
 *    yet, and the sentence about Google's list.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RequestAccess from './RequestAccess.tsx';
import Give from './Give.tsx';
import Gifts from './Gifts.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { en as giftsEn, nl as giftsNl } from '../i18n/strings/gifts.ts';

const postMock = vi.fn();
const getMock = vi.fn();
const putMock = vi.fn();
vi.mock('../services/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api.ts')>()),
  default: {
    post: (...args: unknown[]) => postMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
  },
}));

const wrap = (ui: React.ReactElement, path = '/') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );

const day = (when: string, locale: 'en' | 'nl') => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(when));

/** A refusal as axios hands it to the page. */
const answer = (status: number, data: unknown) =>
  new AxiosError(`Request failed with status code ${status}`, String(status), undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });

beforeEach(() => {
  postMock.mockReset();
  getMock.mockReset();
  putMock.mockReset();
  window.localStorage.clear();
});

describe('the plain request form', () => {
  it('without a code, asks as it always did', async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValue({ data: { received: true } });
    wrap(<RequestAccess />, '/request-access?locale=en');
    await user.type(screen.getByLabelText(/email address/i), 'dirk@example.test');
    await user.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![0]).toBe('/access-requests');
  });
});

describe('the giver’s page', () => {
  const MINE = { gifts: [], limit: 1, held: 0, room: true, redeemAt: 'https://app.example.test/code' };
  const MADE = { id: 'g-1', code: 'K7QM-3XR2-PA9D-W4HN', expiresAt: '2028-12-24T18:00:00.000Z', redeemAt: MINE.redeemAt };

  it('11. says first, at reading size, what a recommendation does; then how many; that whoever has the code is let in; and what the giver will see', async () => {
    getMock.mockResolvedValue({ data: MINE });
    wrap(<Give />);
    const does = await screen.findByText('You tell us that you know this person. That is enough: they are let in at once.');
    const howMany = await screen.findByText('People you may recommend: 1. Recommended: 0.');
    const handOver = screen.getByText('Give the card yourself. Whoever has the code is let in.');
    const willSee = screen.getByText('You will see here when it is used. The person is then in.');
    const order = [does, howMany, handOver, willSee];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `${order[i]!.textContent}`).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Recommend someone' })).toBeInTheDocument();
    expect(screen.getByText('Recommend someone dear to you for the Alpha, on a card.')).toBeInTheDocument();
    // At reading size: 18 pixels (§10).
    for (const line of order) expect(line.className).toMatch(/\btext-lg\b/);
    expect(screen.getByText('They get an account of their own. You do not see what is in it.')).toBeInTheDocument();
    expect(screen.getByText('Tell them first: by phone, or when you hand it over.')).toBeInTheDocument();
    expect(screen.getByText(/^We never receive the name or the message on the card\. We keep that you recommended someone/)).toBeInTheDocument();
  });

  it('sends only the card’s language, and shows the code on the card with what was typed on the page', async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: MINE });
    postMock.mockResolvedValue({ data: MADE });
    wrap(<Give />);
    await user.selectOptions(await screen.findByLabelText(/language of the card/i), 'nl');
    await user.click(screen.getByRole('button', { name: 'Make a recommendation' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]).toEqual(['/gifts', { locale: 'nl' }]);

    expect(await screen.findByTestId('gift-code')).toHaveTextContent('K7QM-3XR2-PA9D-W4HN');
    await user.clear(screen.getByLabelText(/your name on the card/i));
    await user.type(screen.getByLabelText(/your name on the card/i), 'Anna');
    await user.type(screen.getByLabelText(/the recipient’s first name/i), 'Cato');
    await user.type(screen.getByLabelText(/a message/i), 'Fijne feestdagen');
    const card = within(screen.getByTestId('gift-code').closest('section')!);
    expect(card.getByRole('heading', { name: 'Voor Cato: een aanbeveling van Anna' })).toBeInTheDocument();
    expect(card.getByText('Fijne feestdagen')).toBeInTheDocument();
    expect(card.getByText('Ga naar app.example.test/code. Typ dit bovenaan in de adresbalk, niet in een zoekvak.')).toBeInTheDocument();
    expect(card.getByText('Hulp nodig? Vraag het Anna.')).toBeInTheDocument();
    expect(card.getByText(`De code werkt één keer, tot ${day(MADE.expiresAt, 'nl')}.`)).toBeInTheDocument();
    // Still the one call: typing on the card sends nothing.
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('16. the card on the screen is in §6’s order, with the door’s three steps, and no square to scan', async () => {
    getMock.mockResolvedValue({ data: MINE });
    postMock.mockResolvedValue({ data: MADE });
    wrap(<Give />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make a recommendation' }));
    const section = (await screen.findByTestId('gift-code')).closest('section')!;
    const text = section.textContent ?? '';
    const said = [
      'A recommendation',
      'Ownpace copies your mail, calendars, contacts and files to a European provider.',
      'Ownpace is in a free Alpha. With this card you are let in at once.',
      'Ownpace charges nothing during the Alpha.',
      'After the Alpha there are paid packages and a free one.',
      'Go to app.example.test/code.',
      'Type the code from this card.',
      'Answer one question.',
      'Fill in your email address.',
      'K7QM-3XR2-PA9D-W4HN',
      'Need help?',
      'Who Ownpace is:',
      'The code works once, until',
    ];
    const at = said.map((words) => text.indexOf(words));
    expect(at.filter((i) => i < 0), `missing from the card: ${said.filter((_, i) => at[i]! < 0).join(' | ')}`).toEqual([]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The three steps are numbered, as the door counts them.
    expect(within(section).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Type the code from this card.',
      'Answer one question.',
      'Fill in your email address.',
    ]);
    // A link in another form is not on it: no image, no canvas, no svg but the icon's.
    expect(section.querySelector('img, canvas')).toBeNull();
    // The code on one line at every width.
    expect(screen.getByTestId('gift-code').className).toMatch(/\bwhitespace-nowrap\b/);
  });

  it('12. the list says each card’s state in words, with the day it was used and let in', async () => {
    const card = { locale: 'en', createdAt: '2026-12-01T10:00:00Z', expiresAt: '2028-12-01T10:00:00Z', redeemedAt: null, revokedAt: null };
    getMock.mockResolvedValue({
      data: {
        ...MINE,
        limit: 4,
        held: 1,
        gifts: [
          { ...card, id: 'g-1', state: 'unused' },
          { ...card, id: 'g-2', state: 'redeemed', redeemedAt: '2026-12-25T10:00:00Z' },
          { ...card, id: 'g-3', state: 'revoked', revokedAt: '2026-12-02T10:00:00Z' },
          { ...card, id: 'g-4', state: 'expired' },
        ],
      },
    });
    wrap(<Give />);
    expect(await screen.findByText('Not used yet')).toBeInTheDocument();
    expect(screen.getByText(`Used on ${day('2026-12-25T10:00:00Z', 'en')}: let in`)).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    // Withdraw stands on the unused one only.
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1);
  });

  it('13. a link stands beside the card, with one line and no written message; the code stands after a #', async () => {
    getMock.mockResolvedValue({ data: MINE });
    postMock.mockResolvedValue({ data: MADE });
    wrap(<Give />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make a recommendation' }));
    const link = await screen.findByLabelText('Or send a link. Say in your own words what it is.');
    expect(link).toHaveValue('https://app.example.test/code#K7QM-3XR2-PA9D-W4HN');
    expect(link).toHaveAttribute('readonly');
    // The page writes no message for the giver to send.
    const block = link.closest('[data-link]')!;
    expect(block.querySelectorAll('textarea')).toHaveLength(0);
    expect(within(block as HTMLElement).queryByText(/\b(hi|hello|dear|hallo|beste)\b/i)).toBeNull();
  });

  it('14. one fold, What they will see; no tick box; nothing about what the giver gets', async () => {
    getMock.mockResolvedValue({ data: MINE });
    wrap(<Give />);
    await screen.findByText('People you may recommend: 1. Recommended: 0.');
    const folds = document.querySelectorAll('details');
    expect(folds).toHaveLength(1);
    expect(within(folds[0] as HTMLElement).getByText('What they will see')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(document.body.textContent).not.toMatch(/you get|you will get|reward|in return/i);
  });

  it.each([
    ['the limit is nought', { limit: 0, held: 0, room: true }, 'No new recommendation can be made for now.'],
    ['the Alpha has no place for a new card', { limit: 1, held: 0, room: false }, 'The Alpha is full for now. No new recommendation can be made.'],
  ])('15. says none for now, and offers no button, when %s; never already given', async (_, rule, words) => {
    getMock.mockResolvedValue({ data: { ...MINE, ...rule } });
    wrap(<Give />);
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make a recommendation' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/already/i);
  });

  it('15. during the Alpha, a member let in by a recommendation reads §20.7’s sentences where none for now would stand, and no button (D18)', async () => {
    getMock.mockResolvedValue({ data: { ...MINE, limit: 0, held: 0, room: true, onlyAfterAlpha: true } });
    wrap(<Give />);
    expect(
      await screen.findByText(
        'During the Alpha, only the people Ownpace let in itself can recommend someone. After the Alpha, you can too.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('No new recommendation can be made for now.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make a recommendation' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/already/i);
  });

  it('at the limit, says so, with Withdraw on the unused card', async () => {
    getMock.mockResolvedValue({
      data: {
        ...MINE,
        held: 1,
        gifts: [
          { id: 'g-1', locale: 'en', createdAt: '2026-12-01T10:00:00Z', expiresAt: '2028-12-01T10:00:00Z', redeemedAt: null, revokedAt: null, state: 'unused' },
        ],
      },
    });
    wrap(<Give />);
    // The server's own sentence for the same refusal, word for word (0177 §19, the back's 409 `gift_limit`).
    expect(await screen.findByText('You have recommended someone already. Withdraw an unused card to make another.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make a recommendation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  // The page loaded with room for a card, and the answer changed before the
  // press: a second tab, or the Alpha filling up. The server's two sentences
  // are English only (0177 §19, as built); the page has its own for both.
  it.each([
    [
      'the number each person may recommend is reached',
      { error: 'gift_limit', message: 'You have recommended 2 people already. Withdraw an unused card to make another.', limit: 2 },
      'U hebt al iemand aanbevolen. Trek een ongebruikte kaart in om een nieuwe te maken.',
    ],
    [
      'the Alpha has no place for a new card',
      { error: 'no_room', message: 'The Alpha is full for now. No new recommendation can be made.' },
      'De Alpha is nu vol. U kunt nu geen aanbeveling maken.',
    ],
  ])('a card the server refuses because %s is refused in the page’s own words, in Dutch on a Dutch page', async (_, body, words) => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    getMock.mockResolvedValue({ data: { ...MINE, limit: 2 } });
    postMock.mockRejectedValue(answer(409, body));
    wrap(<Give />);
    await userEvent.click(await screen.findByRole('button', { name: 'Maak een aanbeveling' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`De aanbeveling kon niet worden gemaakt. ${words}`);
    expect(document.body.textContent).not.toContain(body.message);
  });

  it('a withdrawal the server refuses says so in the page’s words, never the old name, and the list then shows the card as it is', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    const card = { id: 'g-1', locale: 'nl', createdAt: '2026-12-01T10:00:00Z', expiresAt: '2028-12-01T10:00:00Z', revokedAt: null };
    getMock
      .mockResolvedValueOnce({ data: { ...MINE, limit: 2, held: 1, gifts: [{ ...card, redeemedAt: null, state: 'unused' }] } })
      .mockResolvedValue({ data: { ...MINE, limit: 2, held: 1, gifts: [{ ...card, redeemedAt: '2026-12-25T10:00:00Z', state: 'redeemed' }] } });
    // Used at the door while the page stood open: the server's 409, as built.
    postMock.mockRejectedValue(answer(409, { error: 'Conflict', message: 'Only an unused gift can be revoked.' }));
    wrap(<Give />);
    await userEvent.click(await screen.findByRole('button', { name: 'Intrekken' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^De aanbeveling kon niet worden ingetrokken\.$/);
    expect(await screen.findByText(`Gebruikt op ${day('2026-12-25T10:00:00Z', 'nl')}: toegelaten`)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bgifts?\b|\bunused\b|\brevoked\b/i);
  });
});

describe('the operator’s Gifts', () => {
  const ANSWER = {
    gifts: [
      {
        id: 'g-1',
        locale: 'nl',
        createdAt: '2026-12-01T10:00:00Z',
        expiresAt: '2028-12-01T10:00:00Z',
        redeemedAt: '2026-12-25T10:00:00Z',
        revokedAt: null,
        state: 'redeemed',
        giverEmail: 'anna@example.test',
        organisation: 'De Vries',
        request: { id: 'r-1', state: 'granted', email: 'cato@example.test' },
      },
    ],
    giftsPerPerson: 1,
    allowances: [],
    alpha: { byOwner: 12, ownerCeiling: 50, byRecommendation: 7, recommendationCeiling: 50, unusedGifts: 4 },
  };

  it('17. shows both counts with their ceilings and the cards not used yet, the two fields, and the sentence about Google; nothing says no grant is refused', async () => {
    getMock.mockResolvedValue({ data: ANSWER });
    wrap(<Gifts />);
    expect(await screen.findByText('People you let in: 12 of 50')).toBeInTheDocument();
    expect(screen.getByText('People let in by a recommendation: 7 of 50')).toBeInTheDocument();
    expect(screen.getByText('Cards not used yet: 4')).toBeInTheDocument();
    expect(
      screen.getByText('At its number a recommendation lets nobody in, and no new card is made. Nothing refuses your own yes past yours.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'These count people. Google’s list of test users counts addresses, and ends at 100: the Google address of each member and of each person they help, family or acquaintance, takes a place, and so do your own test addresses.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('The most people you let in')).toBeInTheDocument();
    expect(screen.getByLabelText('The most people let in by a recommendation')).toBeInTheDocument();
    expect(screen.queryByText(/nothing refuses a grant past a number/i)).toBeNull();
    expect(screen.getByText(/From anna@example\.test/)).toBeInTheDocument();
    expect(screen.getByText('Became the request from cato@example.test: granted')).toBeInTheDocument();
  });

  it('17. during the Alpha, says beside the number per person that only the people the owner let in have these (D18)', async () => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
    getMock.mockResolvedValue({ data: ANSWER });
    wrap(<Gifts />);
    expect(
      await screen.findByText(
        'During the Alpha only the people you let in have these. A person let in by a recommendation has none until the Alpha ends.',
      ),
    ).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('after the Alpha, says nothing of the kind', async () => {
    getMock.mockResolvedValue({ data: ANSWER });
    wrap(<Gifts />);
    await screen.findByText('People you let in: 12 of 50');
    expect(screen.queryByText(/During the Alpha only the people you let in have these/)).toBeNull();
  });

  it('sets either ceiling, a whole number, through the rule’s route', async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: ANSWER });
    putMock.mockResolvedValue({ data: {} });
    wrap(<Gifts />);
    const ceiling = await screen.findByLabelText('The most people let in by a recommendation');
    await user.type(ceiling, '40');
    await user.click(within(ceiling.closest('form')!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock.mock.calls[0]).toEqual(['/gifts/operator/rule', { recommendationCeiling: 40 }]);
    const mine = screen.getByLabelText('The most people you let in');
    await user.type(mine, '45');
    await user.click(within(mine.closest('form')!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(2));
    expect(putMock.mock.calls[1]).toEqual(['/gifts/operator/rule', { ownerCeiling: 45 }]);
  });
});

describe("the owner's words (2026-11-25, 0172 T8; and 2026-11-26, the Dutch D6 changed, 0177)", () => {
  it('are the ones on the giver’s page, the card and the door, Dutch first', () => {
    // Read by the owner on 2026-11-26: *"The G6 Dutch: all ok"*.
    expect(giftsNl['give.does']).toBe('U zegt ons dat u deze persoon kent. Dat is genoeg: die persoon wordt meteen toegelaten.');
    expect(giftsNl['give.handOver']).toBe('Geef de kaart zelf. Wie de code heeft, wordt toegelaten.');
    expect(giftsNl['card.alpha']).toBe('Ownpace zit in een gratis Alpha. Met deze kaart wordt u meteen toegelaten.');
    expect(giftsNl['code.in.title']).toBe('U bent toegelaten');
    expect(giftsNl['code.in.left']).toMatch(/^Er is nog één ding te doen: maak uw account aan\. /);
    // What the drafts keep of the owner's words of 2026-11-25 (§7).
    expect(giftsNl['give.intro']).toContain('iemand die u dierbaar is');
    expect(giftsNl['give.intro']).toMatch(/op een kaart\.$/);
    expect(giftsNl['give.recipient']).toBe('Voornaam van de ontvanger');
    expect(giftsEn['give.recipient']).toBe('The recipient’s first name');
    expect(giftsNl['card.alpha']).toMatch(/^Ownpace zit in een gratis Alpha\./);
    for (const words of [...Object.values(giftsNl), ...Object.values(giftsEn)]) {
      expect(words).not.toMatch(/geen sleutel|rather than a key|not a key|we laten mensen zelf toe|vraagt u ons om u toe te laten/);
      expect(words).not.toMatch(/om wie u geeft|warme introductie|warm introduction|Hun voornaam|Ownpace is in een gratis/);
    }
  });
});
