// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A CODE WITH A DOOR OF ITS OWN (workplan 0177 T1, §5; §21.2's points 1 to 10).
 *
 * The code on a card was typed into the request form: six things to fill in,
 * the code checked last, and its refusal four fields below it. No simulated
 * recipient of the desk review got past that form (§3.5). And since the
 * owner's D6 a recommendation lets its person in at once, so the door does
 * what is needed to let them in, and nothing else:
 *
 * 1. the code, alone, checked on its own (`POST /api/gifts/check`), and
 *    mended where it was typed;
 * 2. what this is, and one question: did the person you got it from tell you
 *    themselves? *No, not yet* and *No, I do not want this* end calmly;
 * 3. the address, a name that may be left empty, and one question about
 *    Google (D14); then the person is in (`POST /api/gifts/redeem`).
 *
 * The answers it builds against are §19's contracts. Each step is a place in
 * the page, as a person's link page has them (0176 §5.6): one `h1` with the
 * focus, the tab named after it, *Step n of 3* in words, and the browser's
 * Back one step back. One case, or a few, for each of §21.2's points 1 to 10.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';

const { postMock, STAMP } = vi.hoisted(() => ({
  postMock: vi.fn(),
  STAMP: 'v0.2.0-alpha.21 · 0177aaa',
}));

vi.mock('../services/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api.ts')>()),
  default: {
    post: (...args: unknown[]) => postMock(...args),
    get: () => new Promise<never>(() => {}),
    put: () => new Promise<never>(() => {}),
  },
}));
vi.mock('../services/edition.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/edition.ts')>()),
  isSelfHost: () => false,
}));
// The pages outside the layout carry the build stamp, which asks the server what it runs.
vi.mock('../services/build-identity.ts', () => ({
  uiBuild: () => ({ version: '0.2.0-alpha.21', commit: '0177aaa' }),
  fetchServerBuild: () => Promise.resolve(null),
  describeBuild: () => STAMP,
  shortCommit: (c: string) => c.slice(0, 7),
}));

import AppRoutes from '../AppRoutes.tsx';
import { LocaleProvider } from '../i18n/index.tsx';

/** A code as the card prints it: 80 bits in four groups (0172). */
const CODE = 'K7QM-3XR2-PA9D-W4HN';
/** The code's last day, as the check answers it. */
const UNTIL = '2028-12-24T18:00:00.000Z';
const dayIn = (locale: 'en' | 'nl') => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(UNTIL));

/** §19's contracts: what the server answers. Its sentences are §7's. */
const CHECKED = { ok: true, until: UNTIL, answersFrom: 'answers@example.test' };
const REFUSED = {
  error: 'gift_refused',
  reason:
    'This code cannot be used. It may have been typed wrong, used already, withdrawn, or it may have expired. ' +
    'Check it against the card, or ask the person who gave it to you.',
  reasonNl:
    'Deze code kan niet worden gebruikt. Misschien is hij verkeerd getypt, al gebruikt, ingetrokken of verlopen. ' +
    'Vergelijk hem met de kaart, of vraag het aan degene die u de kaart gaf.',
};
const FULL = {
  error: 'full',
  reason: 'Nobody can be let in with a code right now. Your code is not used.',
  reasonNl: 'Met een code kan nu niemand worden toegelaten. Uw code is niet gebruikt.',
  until: UNTIL,
};
const ALREADY_IN = {
  error: 'already_in',
  reason: 'This email address already has access to Ownpace. Your code is not used. Sign in with that email address.',
  reasonNl: 'Dit e-mailadres heeft al toegang tot Ownpace. Uw code is niet gebruikt. Meld u aan met dat e-mailadres.',
};
const TOO_MANY = {
  error: 'Too many requests',
  message: 'That is more tries than we expected from one place. Try again later. Nothing is lost.',
  reason: 'That is more tries than we expected from one place. Try again later. Nothing is lost.',
  reasonNl: 'Dat waren meer pogingen dan wij van één plek verwachten. Probeer het later opnieuw. Er gaat niets verloren.',
};

/** A refusal as axios hands it to the page. */
const answer = (status: number, data: unknown) =>
  new AxiosError(`Request failed with status code ${status}`, String(status), undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });

/** The page's own words, to find things by, in each language. */
const SAID = {
  en: {
    step1: 'Type your code',
    field: 'The code',
    next: 'Next',
    step2: 'Answer one question',
    yes: 'Yes',
    step3: 'Fill in your email address',
    email: 'Your email address',
    google: 'Is this the email address of a Google account that you want to move?',
    no: 'No',
    use: 'Use my code',
  },
  nl: {
    step1: 'Typ uw code',
    field: 'De code',
    next: 'Verder',
    step2: 'Beantwoord één vraag',
    yes: 'Ja',
    step3: 'Vul uw e-mailadres in',
    email: 'Uw e-mailadres',
    google: 'Is dit het e-mailadres van een Google-account waar u weg wilt?',
    no: 'Nee',
    use: 'Gebruik mijn code',
  },
} as const;
type Locale = keyof typeof SAID;

let router: ReturnType<typeof createMemoryRouter>;

/** The real route table, at an address, in a language this browser chose. */
function renderAt(path: string | { pathname: string; state: unknown }, locale: Locale = 'en') {
  window.localStorage.setItem('ownpace.locale', locale);
  router = createMemoryRouter([{ path: '*', element: <AppRoutes /> }], { initialEntries: [path] });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LocaleProvider>
        <RouterProvider router={router} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const press = async (name: string) => userEvent.click(await screen.findByRole('button', { name }));
/** The buttons of the page, without the language switch's two. */
const pageButtons = () => screen.getAllByRole('button').filter((b) => b.closest('[role="group"][aria-label]') === null);
const googleGroup = (locale: Locale = 'en') => screen.getByRole('group', { name: SAID[locale].google });

/** Step 1, with a code the server takes. */
async function throughTheCode(locale: Locale = 'en', code = CODE) {
  await userEvent.type(await screen.findByLabelText(SAID[locale].field), code);
  await press(SAID[locale].next);
  await h1(SAID[locale].step2);
}

/** Steps 1 and 2, to the address. */
async function toTheAddress(locale: Locale = 'en') {
  await throughTheCode(locale);
  await press(SAID[locale].yes);
  await h1(SAID[locale].step3);
}

/** Step 3, filled in and sent. */
async function useTheCode(opts: { locale?: Locale; google: boolean; name?: string }) {
  const locale = opts.locale ?? 'en';
  await toTheAddress(locale);
  await userEvent.type(screen.getByLabelText(SAID[locale].email), 'cato@example.test');
  if (opts.name) await userEvent.type(screen.getByLabelText(/^(Your name|Uw naam)/), opts.name);
  await userEvent.click(within(googleGroup(locale)).getByLabelText(opts.google ? SAID[locale].yes : SAID[locale].no));
  await press(SAID[locale].use);
}

let scrolls: MockInstance<typeof window.scrollTo>;

beforeEach(() => {
  postMock.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  // A reader who asked for less motion: a new step is at its top at once.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  scrolls = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('1. the door’s addresses', () => {
  it.each(['/code', '/redeem', '/redeem?locale=en', '/request-access?gift=1'])('%s opens the door at its first step', async (path) => {
    renderAt(path);
    expect(await h1('Type your code')).toBeInTheDocument();
  });

  it('on the plain form, *I have a code* is a link to the door, and the form holds no field for one', async () => {
    renderAt('/request-access');
    const link = await screen.findByRole('link', { name: 'I have a code' });
    expect(link).toHaveAttribute('href', '/code');
    expect(screen.queryByLabelText(/code/i)).toBeNull();
    await userEvent.click(link);
    expect(await h1('Type your code')).toBeInTheDocument();
  });

  it('a code after a # fills the field, and nothing is sent until the reader presses the button', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED });
    renderAt(`/code#${CODE}`);
    expect(await screen.findByLabelText('The code')).toHaveValue(CODE);
    expect(postMock).not.toHaveBeenCalled();
    await press('Next');
    expect(postMock).toHaveBeenCalledWith('/gifts/check', { code: CODE });
  });
});

describe('2. the first step: the code, alone', () => {
  it('holds one h1, one field, one button, one line of help and a link for a reader with no code; it sends the code and nothing else', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED });
    renderAt('/code');
    const title = await h1('Type your code');
    expect(screen.getAllByRole('heading', { level: 1 })).toEqual([title]);
    expect(screen.getAllByRole('textbox')).toEqual([screen.getByLabelText('The code')]);
    expect(pageButtons().map((b) => b.textContent)).toEqual(['Next']);
    expect(screen.getByText('As on the card. Capitals and dashes do not matter.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'No code? Ask for access without one.' })).toHaveAttribute('href', '/request-access');
    // No address is asked yet: a mistyped code sends nothing about the person.
    expect(document.querySelector('input[type="email"]')).toBeNull();
    await userEvent.type(screen.getByLabelText('The code'), ' k7qm 3xr2 pa9d w4hn ');
    await press('Next');
    expect(postMock.mock.calls).toEqual([['/gifts/check', { code: 'k7qm 3xr2 pa9d w4hn' }]]);
  });
});

describe('3. a refused code is mended where it was typed', () => {
  it('stays in its field, under a heading tied to the field and announced, with the server’s sentence in the page’s language and the page’s own line', async () => {
    postMock.mockRejectedValueOnce(answer(410, REFUSED));
    renderAt('/code', 'nl');
    const field = await screen.findByLabelText('De code');
    await userEvent.type(field, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    await press('Verder');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Deze code werkt niet' })).toBeInTheDocument();
    expect(within(alert).getByText(REFUSED.reasonNl)).toBeInTheDocument();
    expect(within(alert).getByText('U kunt de code hieronder verbeteren. Er is niets over u verstuurd.')).toBeInTheDocument();
    expect(screen.getByLabelText('De code')).toHaveValue('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    // Above the field it is about, and still the first step: nothing else was asked.
    expect(alert.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Typ uw code' })).toBeInTheDocument();
  });

  it('says too many tries in the page’s language', async () => {
    postMock.mockRejectedValueOnce(answer(429, TOO_MANY));
    renderAt('/code', 'nl');
    await userEvent.type(await screen.findByLabelText('De code'), CODE);
    await press('Verder');
    expect(await screen.findByRole('alert')).toHaveTextContent(TOO_MANY.reasonNl);
    expect(screen.getByLabelText('De code')).toHaveValue(CODE);
  });
});

describe('4. the second step: what this is, and one question', () => {
  it('says what Ownpace does, the Alpha, that the code lets the reader in, what it costs, and what the giver sees; then asks, with three answers of one size', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED });
    renderAt('/code');
    await throughTheCode();
    for (const line of [
      'Ownpace copies your mail, calendars, contacts and files to a European provider.',
      'Ownpace is still a trial. It is called the Alpha.',
      'With this code you are let in at once.',
      'Ownpace charges nothing during the Alpha. Your new mailbox is at a European provider. You pay that provider for it, not Ownpace.',
      'After the Alpha there are paid packages and a free one. You pay nothing before you have accepted the new conditions.',
      'The person you got the code from will see that the code was used.',
    ]) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    const question = 'Did the person you got the code from tell you about this themselves: by phone, or when you saw each other?';
    const answers = within(screen.getByRole('group', { name: question })).getAllByRole('button');
    expect(answers.map((b) => b.textContent)).toEqual(['Yes', 'No, not yet', 'No, I do not want this']);
    expect(new Set(answers.map((b) => b.className)).size).toBe(1);
  });

  it.each([
    ['No, not yet', 'Then ask them first', [`You can use the code later, until ${dayIn('en')}.`, 'Nothing has been sent.']],
    ['No, I do not want this', 'That is fine', ['Nothing has been sent.', 'Tell the person you got the code from: they can then recommend someone else.']],
  ] as const)('*%s* ends calmly and sends nothing; the answer is neither sent nor stored', async (choice, title, lines) => {
    postMock.mockResolvedValueOnce({ data: CHECKED });
    renderAt('/code');
    await throughTheCode();
    const stored = [window.localStorage.length, window.sessionStorage.length];
    await press(choice);
    expect(await h1(title)).toBeInTheDocument();
    for (const line of lines) expect(screen.getByText(line)).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
    expect([window.localStorage.length, window.sessionStorage.length]).toEqual(stored);
  });
});

describe('5. the third step: the address, a name, and one question about Google', () => {
  it('draws no organisation, note or package; asks Google with two answers of one size; shows the address back before the button', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED }).mockResolvedValueOnce({ data: { letIn: true, mailed: true } });
    renderAt('/code');
    await toTheAddress();
    const email = screen.getByLabelText('Your email address');
    expect(email).toHaveAttribute('type', 'email');
    expect(screen.getByText('You sign in with it. It may be the email address you use today.')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name (you may leave this empty)')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(document.querySelector('select, textarea')).toBeNull();
    const google = googleGroup();
    const radios = within(google).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual(['Yes', 'No']);
    expect(new Set(radios.map((r) => r.closest('label')!.className)).size).toBe(1);
    expect(within(google).getByText('Gmail is a Google account.')).toBeInTheDocument();

    await userEvent.type(email, 'cato@example.test');
    const shownBack = screen.getByText('We send an email to cato@example.test. The code works once: after this step it is used.');
    const use = screen.getByRole('button', { name: 'Use my code' });
    expect(shownBack.compareDocumentPosition(use) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(within(google).getByLabelText('Yes'));
    await userEvent.click(use);
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect(postMock.mock.calls[1]).toEqual(['/gifts/redeem', { code: CODE, email: 'cato@example.test', google: true, locale: 'en' }]);
  });

  it('sends a typed name, a no about Google as false, and the page’s language', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED }).mockResolvedValueOnce({ data: { letIn: true, mailed: false } });
    renderAt('/code', 'nl');
    await useTheCode({ locale: 'nl', google: false, name: 'Cato' });
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect(postMock.mock.calls[1]).toEqual([
      '/gifts/redeem',
      { code: CODE, email: 'cato@example.test', name: 'Cato', google: false, locale: 'nl' },
    ]);
  });

  it('sends nothing without the address and an answer about Google', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED });
    renderAt('/code');
    await toTheAddress();
    await press('Use my code');
    await userEvent.type(screen.getByLabelText('Your email address'), 'cato@example.test');
    await press('Use my code');
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});

describe('6. a full Alpha is a calm screen', () => {
  const calm = async (locale: Locale) => {
    expect(await h1(locale === 'en' ? 'The Alpha is full for now' : 'De Alpha is nu vol')).toBeInTheDocument();
    expect(screen.getByText(locale === 'en' ? FULL.reason : FULL.reasonNl)).toBeInTheDocument();
    expect(
      screen.getByText(
        locale === 'en'
          ? `Keep your code. You can try again later, until ${dayIn('en')}. Nothing about you has been kept.`
          : `Bewaar uw code. U kunt het later opnieuw proberen, tot ${dayIn('nl')}. Er is niets over u bewaard.`,
      ),
    ).toBeInTheDocument();
    // Not an error on a field: no alert and no field, and its one button goes back.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(pageButtons().map((b) => b.textContent)).toEqual([locale === 'en' ? 'Back' : 'Terug']);
  };

  it('at the first step', async () => {
    postMock.mockRejectedValueOnce(answer(409, FULL));
    renderAt('/code');
    await userEvent.type(await screen.findByLabelText('The code'), CODE);
    await press('Next');
    await calm('en');
  });

  it('at the third step, in Dutch', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED }).mockRejectedValueOnce(answer(409, FULL));
    renderAt('/code', 'nl');
    await useTheCode({ locale: 'nl', google: false });
    await calm('nl');
  });
});

describe('7. an address that already has access keeps its code', () => {
  it('says so in the server’s words and offers to sign in; the step and what was typed stay', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED }).mockRejectedValueOnce(answer(409, ALREADY_IN));
    renderAt('/code', 'nl');
    await useTheCode({ locale: 'nl', google: true });
    expect(await screen.findByText(ALREADY_IN.reasonNl)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Heeft u al een account? Aanmelden' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('heading', { level: 1, name: 'Vul uw e-mailadres in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Uw e-mailadres')).toHaveValue('cato@example.test');
  });
});

describe('8. let in', () => {
  it('one h1; Create your account opens the sign-in page with the address filled in; the mail’s line; then the safety sentence and where to write', async () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'support@example.test');
    postMock.mockResolvedValueOnce({ data: CHECKED }).mockResolvedValueOnce({ data: { letIn: true, mailed: true } });
    renderAt('/code');
    await useTheCode({ google: false });
    const title = await h1('You are in');
    expect(screen.getAllByRole('heading', { level: 1 })).toEqual([title]);
    expect(
      screen.getByText(
        'One thing is left: make your account. The sign-in service mails a code to cato@example.test. With it you confirm that the address is yours.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your account' })).toHaveAttribute(
      'href',
      '/login?locale=en#register=cato%40example.test',
    );
    expect(screen.getByText('We also sent you an email, from answers@example.test. It says the same.')).toBeInTheDocument();
    expect(screen.queryByText(/to a list at Google by hand/)).toBeNull();
    expect(screen.getByText('Ownpace never asks for your password by email or phone.')).toBeInTheDocument();
    const support = screen.getByRole('link', { name: 'support@example.test' });
    expect(support).toHaveAttribute('href', 'mailto:support@example.test');
    expect(support.closest('p')).toHaveTextContent('Is cato@example.test not right? Write to support@example.test.');
  });

  it('says the Google lines only after a yes, and the mail’s line only when a mail was sent', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED }).mockResolvedValueOnce({ data: { letIn: true, mailed: false } });
    renderAt('/code', 'nl');
    await useTheCode({ locale: 'nl', google: true });
    expect(await h1('U bent toegelaten')).toBeInTheDocument();
    expect(
      screen.getByText(
        'U wilt weg bij Google. Wij zetten cato@example.test met de hand op een lijst bij Google, en schrijven u als dat is gebeurd. Tot dan laat Google de koppeling niet toe.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Wij hebben u ook een e-mail gestuurd/)).toBeNull();
    expect(screen.getByText('Ownpace vraagt nooit per e-mail of telefoon om uw wachtwoord.')).toBeInTheDocument();
    // No support address set: no line that names one.
    expect(screen.queryByText(/Klopt cato@example\.test niet\?/)).toBeNull();
  });
});

describe('9. the steps, as a browser and a screen reader meet them', () => {
  it('a history entry each, one h1 that takes the focus, the tab named after the step, and Step n of 3 in words', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED });
    renderAt('/code');
    await h1('Type your code');
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(document.title).toBe('Type your code — Ownpace');
    // The first render moves nothing.
    expect(scrolls).not.toHaveBeenCalled();
    await throughTheCode();
    const second = screen.getByRole('heading', { level: 1, name: 'Answer one question' });
    expect(document.activeElement).toBe(second);
    expect(scrolls).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(document.title).toBe('Answer one question — Ownpace');
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    await press('Yes');
    expect(await h1('Fill in your email address')).toBe(document.activeElement);
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(await h1('Answer one question')).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(await h1('Type your code')).toBeInTheDocument();
    expect(screen.getByLabelText('The code')).toHaveValue(CODE);
  });

  it('a step opened by itself, with no code checked on this visit, is the first', async () => {
    renderAt({ pathname: '/code', state: { codeStep: 'address' } });
    expect(await h1('Type your code')).toBeInTheDocument();
  });

  it('Back after the person is let in does not use the code twice', async () => {
    postMock.mockResolvedValueOnce({ data: CHECKED }).mockResolvedValueOnce({ data: { letIn: true, mailed: true } });
    renderAt('/code');
    await useTheCode({ google: false });
    await h1('You are in');
    await act(() => router.navigate(-1));
    expect(await h1('You are in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use my code' })).toBeNull();
    expect(postMock).toHaveBeenCalledTimes(2);
  });
});

describe('10. what the door does not show, and what stands at its foot', () => {
  it('no welcome of the Alpha, no link to sign in before the person is in, no sentence that says whose page it is; the stamp and the accessibility statement at the foot', async () => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
    postMock.mockResolvedValueOnce({ data: CHECKED });
    renderAt('/code');
    const each = async (title: string) => {
      await h1(title);
      expect(screen.queryByText(/Welcome to the Alpha/)).toBeNull();
      expect(screen.queryByText(/This page is from Ownpace/)).toBeNull();
      const signIn = screen.queryAllByRole('link').filter((a) => (a.getAttribute('href') ?? '').startsWith('/login'));
      expect(signIn).toEqual([]);
      expect(screen.getByText(STAMP)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Accessibility' })).toBeInTheDocument();
    };
    await each('Type your code');
    await throughTheCode();
    await each('Answer one question');
    await press('Yes');
    await each('Fill in your email address');
  });
});
