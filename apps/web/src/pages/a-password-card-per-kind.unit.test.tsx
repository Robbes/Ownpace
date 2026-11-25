// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PASSWORD CARD PER KIND (workplan 0174 T4: §4.5, §5.2, §5.7, §5.8).
 *
 * A person's grant link asks for every account they own whose credential is a
 * password, sources and destinations. Each such account is a card on their
 * page, and the card is drawn from the one field table, so this page and the
 * owner's form cannot word one field two ways. The owner fixed the server and
 * the account (D2), and the card shows them as text, never as boxes; the
 * person gets a box only for what the API marks as theirs.
 *
 * The fields here are built from `credentialFieldsFor` by the rule the API's
 * `personFieldsFor` applies (`apps/api/src/routes/grant-providers.ts`): a
 * secret is the person's, a non-secret field with a value is the owner's,
 * Infomaniak's sync username is the person's only when the owner left it
 * empty, and a mailbox's own login is asked only where the owner gave a mail
 * server. Every password kind is drawn, in both roles it has.
 *
 * Pinned besides: the server line before any box, with its registrable domain
 * in bold; D3's warning on a mismatch, and none on a published server; the
 * line for a link from an organisation with no phone; the two groups in their
 * order; and what each answer of the route makes the card say (§5.7).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { credentialFieldsFor } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import { passwordAnswerOf, type PasswordAnswer, type PersonField } from '../services/grant-service.ts';

const { readMock, putMock } = vi.hoisted(() => ({ readMock: vi.fn(), putMock: vi.fn() }));

vi.mock('../services/grant-service.ts', async (importOriginal) => ({
  // The real reading of the route's bodies (`passwordAnswerOf`), the calls mocked.
  ...(await importOriginal<typeof import('../services/grant-service.ts')>()),
  grantApi: { read: readMock, authorize: vi.fn(), putPassword: putMock },
}));
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn().mockResolvedValue(false), send: vi.fn() },
}));

import Grant from './Grant.tsx';

type Locale = 'en' | 'nl';
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};
const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (w, n: string) => (n in vars ? String(vars[n]) : w));

/** The password kinds, by role, as the API's `PASSWORD_SOURCE_KINDS` and `PASSWORD_TARGET_KINDS` list them (0174 §5.1). */
const SOURCE_KINDS = ['imap', 'apple', 'caldav', 'carddav', 'webdav'] as const;
const TARGET_KINDS = ['jmap', 'imap', 'caldav', 'carddav', 'webdav', 'soverin', 'nextcloud', 'cirrux', 'infomaniak'] as const;

/** A value the owner saved for a field, plainly fake. */
const ownerValue = (key: string): string =>
  ({
    host: 'imap.example.com',
    port: '993',
    url: 'https://dav.example.com/remote.php/dav',
    username: 'anna@example.com',
    mailHost: 'mail.example.com',
    mailPort: '993',
    mailUsername: 'anna@example.com',
  })[key] ?? `${key}.example`;

/** The card's fields, by the API's rule (`personFieldsFor`), from the field table. */
function fieldsFor(role: 'source' | 'target', kind: string, opts: { leaveEmpty?: string[] } = {}): PersonField[] {
  const declared = credentialFieldsFor(role, kind);
  const hasMail = declared.some((f) => f.key === 'mailHost') && !(opts.leaveEmpty ?? []).includes('mailHost');
  const out: PersonField[] = [];
  for (const f of declared) {
    if (f.loginPairedWith !== undefined && !hasMail) continue;
    const common = {
      key: f.key,
      labelKey: f.labelKey,
      ...(f.hintKey === undefined ? {} : { hintKey: f.hintKey }),
      ...(f.placeholder === undefined ? {} : { placeholder: f.placeholder }),
      ...(f.autoComplete === undefined ? {} : { autoComplete: f.autoComplete }),
      ...(f.revealable === undefined ? {} : { revealable: f.revealable }),
    };
    if (f.secret === true) {
      out.push({ ...common, who: 'person', secret: true });
    } else if ((opts.leaveEmpty ?? []).includes(f.key)) {
      if (kind === 'infomaniak' && f.key === 'username') out.push({ ...common, who: 'person', secret: false });
    } else if (!f.perMapping) {
      out.push({ ...common, who: 'owner', secret: false, value: ownerValue(f.key) });
    }
  }
  return out;
}

function card(role: 'source' | 'target', kind: string, over: Record<string, unknown> = {}) {
  return {
    ref: `ref-${role}-${kind}`,
    role,
    way: 'password',
    provider: kind,
    account: `anna-${kind}@example.com`,
    server:
      kind === 'apple'
        ? { hosts: ['imap.mail.me.com', 'caldav.icloud.com'], published: true }
        : { hosts: ['imap.example.com'], published: false, domains: ['example.com'] },
    fields: fieldsFor(role, kind),
    tries: { left: 5, locked: false },
    granted: false,
    again: false,
    domains: ['email'],
    scope: null,
    readOnlyAtProvider: false,
    notReady: null,
    migrations: [
      role === 'source'
        ? { domains: ['email'], to: { provider: 'soverin', host: null, account: 'anna@soverin.example' }, granted: false }
        : {
            domains: ['email'],
            to: { provider: kind, host: null, account: `anna-${kind}@example.com` },
            from: { provider: 'gmail', account: 'anna@gmail.example' },
            granted: false,
          },
    ],
    ...over,
  };
}

function subject(accounts: unknown[], over: Record<string, unknown> = {}) {
  return {
    kind: 'person',
    organisation: 'Acme Families',
    checkedCompany: null,
    askedBy: 'owner@example.org',
    organisationPhone: '+31 20 000 0000',
    accounts,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    addressChanges: [],
    ...over,
  };
}

function renderPage(locale: Locale = 'en') {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/grant/p.abc.def']}>
          <Routes>
            <Route path="/grant/:link" element={<Grant />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

const cardOf = async (account: string): Promise<HTMLElement> => {
  const heading = await screen.findByRole('heading', { level: 3, name: account });
  return heading.closest('section') as HTMLElement;
};

describe('a password card per kind, drawn from the field table (0174 §5.2, D2)', () => {
  const cases = [
    ...SOURCE_KINDS.map((k) => ['source', k] as const),
    ...TARGET_KINDS.map((k) => ['target', k] as const),
  ];
  it.each(cases)('%s %s: the owner’s values shown and not editable, a box only for what the person fills', async (role, kind) => {
    const c = card(role, kind);
    readMock.mockResolvedValue(subject([c]));
    renderPage();
    const el = await cardOf(c.account);
    expect(el.dataset.cardWay).toBe('password');
    expect(el.dataset.cardRole).toBe(role);
    // In its group.
    const group = el.closest('[data-group]') as HTMLElement;
    expect(group.dataset.group).toBe(role);

    const persons = c.fields.filter((f) => f.who === 'person');
    const owners = c.fields.filter((f) => f.who === 'owner');
    expect(persons.length, `${kind} gives the person nothing to type`).toBeGreaterThan(0);
    expect(persons.every((f) => f.secret || (kind === 'infomaniak' && f.key === 'username'))).toBe(true);

    const inputs = [...el.querySelectorAll('input')];
    // One box per person field, none for the owner's.
    expect(inputs).toHaveLength(persons.length);
    for (const f of persons) {
      const box = within(el).getByLabelText(words('en', f.labelKey)) as HTMLInputElement;
      expect(box.type, `${kind}'s ${f.key}`).toBe(f.secret ? 'password' : 'text');
      // No name: nothing a browser could serialise into a URL.
      expect(box.getAttribute('name')).toBeNull();
      expect(box.required).toBe(true);
      expect(box.getAttribute('autocomplete')).toBe(f.autoComplete ?? 'off');
      if (f.hintKey) expect(within(el).getByText(words('en', f.hintKey))).toBeInTheDocument();
    }
    for (const f of owners) {
      const shown = el.querySelector(`[data-owner-field="${f.key}"]`);
      expect(shown?.textContent, `${kind}'s ${f.key} is not shown`).toBe(f.value);
      expect(inputs.some((i) => i.value === f.value)).toBe(false);
    }
    // The server line comes before the first box.
    const line = el.querySelector('[data-server-line]') as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.compareDocumentPosition(inputs[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(el).getByRole('button', { name: 'Check and connect' })).toBeInTheDocument();
  });

  it('asks Infomaniak’s sync username of the person only when the owner left it empty', async () => {
    const c = card('target', 'infomaniak', { fields: fieldsFor('target', 'infomaniak', { leaveEmpty: ['username'] }) });
    readMock.mockResolvedValue(subject([c]));
    renderPage();
    const el = await cardOf(c.account);
    expect((within(el).getByLabelText(words('en', 'account.targetUsername')) as HTMLInputElement).type).toBe('text');
  });

  it('says each kind’s own help: Apple’s and Nextcloud’s steps folded, Cirrux’s under the box, the app-password line otherwise', async () => {
    readMock.mockResolvedValue(
      subject([card('source', 'apple'), card('target', 'nextcloud'), card('target', 'cirrux'), card('source', 'imap')]),
    );
    renderPage();
    const apple = await cardOf('anna-apple@example.com');
    expect(within(apple).getByText('How do I make an app-specific password?')).toBeInTheDocument();
    expect(within(apple).getByText(words('en', 'account.appleAppPassword.hint'))).toBeInTheDocument();
    const nextcloud = await cardOf('anna-nextcloud@example.com');
    expect(within(nextcloud).getByText('How do I make an app password?')).toBeInTheDocument();
    const cirrux = await cardOf('anna-cirrux@example.com');
    expect(within(cirrux).getByText(words('en', 'account.cirruxAppPassword.hint'))).toBeInTheDocument();
    expect(within(cirrux).queryByText(words('en', 'grant.password.appPassword'))).not.toBeInTheDocument();
    const imap = await cardOf('anna-imap@example.com');
    expect(within(imap).getByText(words('en', 'grant.password.appPassword'))).toBeInTheDocument();
  });
});

describe('where the password goes, before any box (0174 §5.8, D3)', () => {
  it('names the server with its registrable domain in bold, and who will never see the password', async () => {
    readMock.mockResolvedValue(subject([card('source', 'imap')]));
    renderPage();
    const el = await cardOf('anna-imap@example.com');
    const line = el.querySelector('[data-server-line]') as HTMLElement;
    expect(line.textContent).toBe(
      'Your password is checked with imap.example.com. Type it only if this is your own provider’s server.',
    );
    expect(line.querySelector('strong')?.textContent).toBe('example.com');
    expect(within(el).getByText(fill(words('en', 'grant.password.nobody'), { askedBy: 'owner@example.org', organisation: 'Acme Families' }))).toBeInTheDocument();
    expect(within(el).getByText(words('en', 'grant.password.never'))).toBeInTheDocument();
    expect(el.querySelector('[data-not-the-address-mail]')).toBeNull();
  });

  it('bolds the whole host when the route named no registrable domain', async () => {
    readMock.mockResolvedValue(subject([card('source', 'imap', { server: { hosts: ['mail.example.net'], published: false } })]));
    renderPage();
    const el = await cardOf('anna-imap@example.com');
    expect(el.querySelector('[data-server-line] strong')?.textContent).toBe('mail.example.net');
  });

  it.each(['en', 'nl'] as const)('%s: warns, and does not refuse, when the server is not the address’s mail', async (locale) => {
    readMock.mockResolvedValue(
      subject([card('source', 'imap', { server: { hosts: ['imap.example.net'], published: false, domains: ['example.net'], notTheAddressMail: ['imap.example.net'] } })]),
    );
    renderPage(locale);
    const el = await cardOf('anna-imap@example.com');
    const warning = el.querySelector('[data-not-the-address-mail="imap.example.net"]');
    expect(warning?.textContent).toBe(words(locale, 'grant.password.notAddressMail'));
    // A warning only: the person can still type and send.
    expect(within(el).getByRole('button', { name: words(locale, 'grant.password.submit') })).toBeEnabled();
  });

  it('warns when one of two hosts is not the address’s mail, as the server answers it (T3’s shape)', async () => {
    readMock.mockResolvedValue(
      subject([
        card('target', 'soverin', {
          server: { hosts: ['imap.example.com', 'dav.example.net'], published: false, domains: ['example.com', 'example.net'], notTheAddressMail: ['dav.example.net'] },
        }),
      ]),
    );
    renderPage();
    const el = await cardOf('anna-soverin@example.com');
    expect(el.querySelector('[data-not-the-address-mail]')?.getAttribute('data-not-the-address-mail')).toBe('dav.example.net');
    expect([...el.querySelectorAll('[data-server-line] strong')].map((b) => b.textContent)).toEqual(['example.com', 'example.net']);
  });

  it('says nothing when the server matches the address’s mail', async () => {
    readMock.mockResolvedValue(
      subject([card('source', 'imap', { server: { hosts: ['imap.example.com'], published: false, domains: ['example.com'], notTheAddressMail: [] } })]),
    );
    renderPage();
    const el = await cardOf('anna-imap@example.com');
    expect(el.querySelector('[data-not-the-address-mail]')).toBeNull();
  });

  it('names Apple’s own server for Apple, with no warning', async () => {
    readMock.mockResolvedValue(subject([card('source', 'apple', { server: { hosts: ['imap.mail.me.com'], published: true, notTheAddressMail: ['imap.mail.me.com'] } })]));
    renderPage();
    const el = await cardOf('anna-apple@example.com');
    expect(el.querySelector('[data-server-line]')?.textContent).toBe(
      'Your password is checked with Apple’s own server, imap.mail.me.com.',
    );
    expect(el.querySelector('[data-not-the-address-mail]')).toBeNull();
  });

  it.each(['en', 'nl'] as const)('%s: says to ask some other way when the organisation gave no phone', async (locale) => {
    readMock.mockResolvedValue(subject([card('source', 'imap')], { organisationPhone: null }));
    renderPage(locale);
    await cardOf('anna-imap@example.com');
    expect(document.querySelector('[data-no-phone]')?.textContent).toBe(
      fill(words(locale, 'grant.password.noPhone'), { organisation: 'Acme Families', askedBy: 'owner@example.org' }),
    );
  });

  it('adds no such line for a link that asks no password', async () => {
    readMock.mockResolvedValue(
      subject(
        [
          {
            account: 'anna@gmail.example',
            provider: 'google',
            granted: true,
            again: false,
            domains: ['email'],
            scope: null,
            readOnlyAtProvider: false,
            notReady: null,
            migrations: [{ domains: ['email'], to: { provider: 'soverin', host: null, account: null }, granted: true }],
          },
        ],
        { organisationPhone: null },
      ),
    );
    renderPage();
    await cardOf('anna@gmail.example');
    expect(document.querySelector('[data-no-phone]')).toBeNull();
  });
});

describe('the two groups (0174 §4.5)', () => {
  it('puts the sources first, then the destinations, each card with its state, and names where a destination’s data comes from', async () => {
    readMock.mockResolvedValue(
      subject([
        card('target', 'soverin'),
        card('source', 'apple', { granted: true }),
        card('source', 'imap', { tries: { left: 0, locked: true } }),
      ]),
    );
    renderPage();
    await cardOf('anna-soverin@example.com');
    const groups = [...document.querySelectorAll<HTMLElement>('[data-group]')];
    expect(groups.map((g) => g.dataset.group)).toEqual(['source', 'target']);
    expect(within(groups[0]!).getByRole('heading', { level: 2 }).textContent).toBe('The accounts your data is copied from');
    expect(within(groups[1]!).getByRole('heading', { level: 2 }).textContent).toBe('The accounts your data is copied to');

    const apple = await cardOf('anna-apple@example.com');
    expect(apple.dataset.cardState).toBe('connected');
    expect(within(apple).getByText('Connected')).toBeInTheDocument();
    expect(apple.querySelector('input')).toBeNull();

    const imap = await cardOf('anna-imap@example.com');
    expect(imap.dataset.cardState).toBe('locked');
    expect(within(imap).getByText('Locked on this link')).toBeInTheDocument();
    expect(within(imap).getByText('Too many tries on this link. Ask owner@example.org for a new link.')).toBeInTheDocument();
    expect(imap.querySelector('form')).toBeNull();

    const soverin = await cardOf('anna-soverin@example.com');
    expect(soverin.dataset.cardState).toBe('waiting');
    expect(within(soverin).getByText('Waiting')).toBeInTheDocument();
    expect(within(soverin).getByText('From anna@gmail.example, Gmail: your email — messages, folders and labels.')).toBeInTheDocument();
  });
});

describe('what the card says after the route answers (0174 §5.7)', () => {
  const answer = async (got: PasswordAnswer, kind = 'imap', locale: Locale = 'en') => {
    putMock.mockResolvedValue(got);
    readMock.mockResolvedValue(subject([card('source', kind), card('target', 'soverin', { granted: true })]));
    renderPage(locale);
    const el = await cardOf(`anna-${kind}@example.com`);
    const box = el.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'placeholder-not-a-password' } });
    fireEvent.click(within(el).getByRole('button', { name: words(locale, 'grant.password.submit') }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    return el;
  };

  it('sends the card’s ref and the person’s values, in the page’s language, and empties the box', async () => {
    const el = await answer({ kind: 'refused_login', left: 3 });
    expect(putMock).toHaveBeenCalledWith('p.abc.def', 'ref-source-imap', { password: 'placeholder-not-a-password' }, 'en');
    await waitFor(() => expect((el.querySelector('input[type="password"]') as HTMLInputElement).value).toBe(''));
  });

  it('refused: the server did not accept it, with the tries left; the form stays', async () => {
    const el = await answer({ kind: 'refused_login', left: 3 });
    expect(await within(el).findByRole('alert')).toHaveTextContent(
      'imap.example.com did not accept this password. Check it and try again. Tries left: 3.',
    );
    expect(el.querySelector('form')).not.toBeNull();
  });

  it('refused, for Apple: says to use an app password', async () => {
    const el = await answer({ kind: 'refused_login', left: 4 }, 'apple');
    expect(await within(el).findByRole('alert')).toHaveTextContent(
      /Tries left: 4\. Make sure it is an app password, not the password you sign in with\.$/,
    );
  });

  it('unreachable: not the password, and whom to tell', async () => {
    const el = await answer({ kind: 'unreachable' });
    expect(await within(el).findByRole('alert')).toHaveTextContent(
      'imap.example.com could not be reached. This is not your password. Try again in a few minutes; if it keeps happening, tell owner@example.org.',
    );
  });

  it('face missing: the password works, and which face was refused', async () => {
    const el = await answer({ kind: 'face_missing', faces: ['calendar'] }, 'imap', 'nl');
    expect(await within(el).findByRole('alert')).toHaveTextContent('Uw wachtwoord werkt, maar imap.example.com weigerde agenda.');
  });

  it('locked: no form, and ask for a new link', async () => {
    const el = await answer({ kind: 'locked' });
    expect(await within(el).findByRole('alert')).toHaveTextContent('Too many tries on this link. Ask owner@example.org for a new link.');
    expect(el.querySelector('form')).toBeNull();
    expect(el.dataset.cardState).toBe('locked');
  });

  it('connected: the card says so, and the page says every account is connected', async () => {
    const el = await answer({ kind: 'connected', faces: ['email'] });
    expect(await within(el).findByText('Connected. Your password works and is stored encrypted.')).toBeInTheDocument();
    expect(el.dataset.cardState).toBe('connected');
    expect(el.querySelector('form')).toBeNull();
    expect(screen.getByText('Every account is connected. You can close this page.')).toBeInTheDocument();
  });

  // The route's other answers, read from its own bodies (0174 §5.3, T3), so
  // the card says something right for each and never a blank.
  it.each(['en', 'nl'] as const)('%s: a server named by a number: T3’s sentence, in the page’s language', async (locale) => {
    const en =
      'This link names its server by a number instead of a name, so your password is not sent to it. Tell the person who sent you the link.';
    const nl =
      'Deze link noemt de server met een nummer in plaats van een naam, dus uw wachtwoord wordt er niet naartoe gestuurd. Laat het de persoon weten die u de link stuurde.';
    const el = await answer(passwordAnswerOf(409, { error: 'server_not_a_name', reason: en, reasonNl: nl }), 'imap', locale);
    expect(await within(el).findByRole('alert')).toHaveTextContent(locale === 'nl' ? nl : en);
  });

  it('revoked while the test ran (401 `link_spent`): the server’s sentence that nothing was stored', async () => {
    const en = 'This link can no longer be used — it may have been used already, it may have expired, or the person who sent it may have withdrawn it. Nothing was stored.';
    const el = await answer(passwordAnswerOf(401, { error: 'link_spent', reason: en, reasonNl: 'Er is niets opgeslagen.' }));
    expect(await within(el).findByRole('alert')).toHaveTextContent(en);
  });

  it('refused at the door (401 `link_unusable`): the link’s own sentence', async () => {
    const el = await answer(passwordAnswerOf(401, { error: 'link_unusable', message: 'This link does not work.', messageNl: 'Deze link werkt niet.' }), 'imap', 'nl');
    expect(await within(el).findByRole('alert')).toHaveTextContent('Deze link werkt niet.');
  });

  it.each([
    [400, 'values_not_the_fields'],
    [413, 'body_too_large'],
    [415, 'json_only'],
  ] as const)('a body the route could not take (%s): the page’s own sentence, never a blank', async (status, error) => {
    const el = await answer(passwordAnswerOf(status, { error }));
    expect(await within(el).findByRole('alert')).toHaveTextContent(words('en', 'link.unreadable'));
    expect(el.querySelector('form')).not.toBeNull();
  });

  it('connected, with a progress page: hands it over to keep, as a sign-in’s ending does (§5.3 step 8)', async () => {
    await answer({ kind: 'connected', faces: ['email'], progressUrl: 'https://app.example.test/progress/p.abc.def' }, 'imap', 'nl');
    const block = (await screen.findByText(words('nl', 'grant.person.yourPage'))).closest('[data-progress-link]') as HTMLElement;
    expect(within(block).getByRole('link', { name: 'https://app.example.test/progress/p.abc.def' })).toHaveAttribute(
      'href',
      'https://app.example.test/progress/p.abc.def',
    );
    expect(within(block).getByText(words('nl', 'grant.person.keepIt'))).toBeInTheDocument();
  });

  it('no answer: the page’s own sentence', async () => {
    const el = await answer({ kind: 'no_answer' });
    expect(await within(el).findByRole('alert')).toHaveTextContent(words('en', 'link.unreachable'));
  });
});
