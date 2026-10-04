// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT THE APP SAYS, HELD TO WHAT THE PRIVACY POLICY SAYS (workplan 0139 T4;
 * the owner's ops-app-sentences (a), 2026-09-28; `site/legal/README.md`, *To
 * build or to do*).
 *
 * Two sentences on the pages said less than the policy a tester accepts:
 *
 *  - The alpha note said "nothing is backed up". Since 0139 T6 one copy is
 *    made right before each update and kept up to 7 days (privacy §9, Alpha
 *    conditions §6). The note then named that copy, in the README's words:
 *    *"no backups, apart from one copy before each update, kept up to 7
 *    days"*. Since 2026-10-04 the note is the owner's welcome and its two
 *    links, and says nothing about backups (0131 D4's amendment: *"Welcome
 *    only"*). The sentence moved, word for word, to both Alpha mails, where
 *    the case below finds it; `what-the-mails-say.unit.test.ts` pins it too.
 *    And no line in either language says "nothing is backed up" again.
 *  - The request form said "We keep what you type only to answer you". The
 *    policy keeps it to decide on the request and to answer (privacy §4.4),
 *    so the form now says both: *"We keep what you type to decide on your
 *    request and to answer you; asking creates no account."*
 *
 * The request form carries the note and the privacy sentence during the
 * alpha, so it is rendered here, in each language, the way a person meets it
 * before any session. Each case pins the substance rather than every word.
 * The mails' half is `packages/shared/src/what-the-mails-say.unit.test.ts`.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RequestAccess from './RequestAccess.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import { renderEvent } from '@openmig/shared';

const LOCALES = ['en', 'nl'] as const;
type Locale = (typeof LOCALES)[number];

/** The request form as the app mounts it, in a language, with the alpha setting on. */
function requestForm(locale: Locale): void {
  window.localStorage.setItem('ownpace.locale', locale);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/request-access']}>
          <RequestAccess />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('the request form says why it keeps what is typed', () => {
  const WHY = {
    en: [/to decide on your request/, /to answer you/, /creates no account/],
    nl: [/over uw aanvraag te beslissen/, /u te antwoorden/, /maakt geen account aan/],
  } as const;

  it.each(LOCALES)('to decide on the request and to answer, and that asking creates no account, in %s', (locale) => {
    for (const part of WHY[locale]) expect(STRINGS[locale]['access.privacy']).toMatch(part);
    requestForm(locale);
    expect(screen.getByText(STRINGS[locale]['access.privacy'])).toBeInTheDocument();
  });

  it.each(LOCALES)('no longer says it is kept only to answer, in %s', (locale) => {
    // "Only to answer" leaves out the decision the policy names first.
    expect(STRINGS[locale]['access.privacy']).not.toMatch(/only to answer|alleen om te antwoorden/i);
  });
});

describe('the one copy before each update, said in the mails and not in the note', () => {
  const COPY = {
    en: /no backups, apart from one copy before each update, kept up to 7 days/,
    nl: /geen back-ups gemaakt, op één kopie vlak voor elke update na, die hoogstens 7 dagen wordt bewaard/,
  } as const;

  /** The two mails with an Alpha paragraph, as the API builds them during the Alpha. */
  const MAILS = [
    { kind: 'access_granted', organisation: 'De Vries', appUrl: 'https://app.example.test', email: 'a@example.test', alpha: true },
    {
      kind: 'member_invited',
      organisation: 'De Vries',
      appUrl: 'https://app.example.test',
      email: 'b@example.test',
      privacyPolicy: 'https://site.example.test/privacy.html',
      alpha: true,
    },
  ] as const;

  it.each(LOCALES)('the request form\'s note says nothing about backups; both mails name the one copy, in %s', (locale) => {
    requestForm(locale);
    const note = document.querySelector('[role="note"]');
    expect(note, 'the request form shows no alpha note with the setting on').not.toBeNull();
    // The owner's welcome and its links, nothing more (0131 D4's amendment).
    expect((note!.textContent ?? '').replace(/\s+/g, ' ')).not.toMatch(/back-?ups?|\bkopie\b|\bcopy\b/i);
    for (const mail of MAILS) expect(renderEvent(mail, locale).body.replace(/\s+/g, ' ')).toMatch(COPY[locale]);
  });

  it.each(LOCALES)('no line says that nothing at all is backed up, in %s', (locale) => {
    const wrong = Object.entries(STRINGS[locale]).filter(([, value]) =>
      /nothing is backed up|er worden geen back-ups gemaakt en/i.test(value),
    );
    expect(wrong).toEqual([]);
  });
});
