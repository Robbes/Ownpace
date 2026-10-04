// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT MAIL THAT LINKS THE CONDITIONS (workplan 0139 T4, with 0131 T1).
 *
 * The access-granted mail is the first thing a tester reads from the service.
 * During the alpha it says so, opening with the note's welcome (0131 T1; the
 * owner's words since 2026-10-04), and 0131 T1 planned the link beside them:
 * *"the access-granted mail's sentence carries the same link"*, built through
 * 0139 T10's addresses once they existed. They do: the site renders the Alpha
 * conditions at `alpha.html` and `nl/alpha.html`, and the acceptance screen
 * links them (0139 T3).
 *
 * So, while the deployment runs the alpha, the alpha paragraph ends with the
 * conditions' address, in the language the mail is written in, on the site
 * `LEGAL_SITE_URL` names: the key `managed.yml` fills from the web build's
 * `VITE_LEGAL_SITE_URL`, empty being the production site, as for the privacy
 * line in the share mail. Outside the alpha the mail names no conditions at
 * all: there are none to accept.
 *
 * What is checked is what reaches the transport, through `tell` and
 * `accessGrantedEvent`, the two calls the grant route makes. The addresses
 * are written out here; `scripts/a-policy-link-that-answers.unit.test.ts`
 * holds the module that makes them to the web's and to the files the site
 * build writes.
 *
 * It failed before 0139 T4 built it: the mail named no conditions.
 *
 * AND THE TESTER GUIDE, AFTER THEM (0131 T1 (b), 0144 T1; 2026-10-04). The
 * guide tells a tester what to do before they start, so the paragraph's last
 * line is its address, in the mail's language, on the same site. The
 * paragraph is found by its address lines here, not by its first words, so
 * the words can change without this file changing. Those cases failed on
 * cd318823: the mail named no guide.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

const SENT: Array<{ to: readonly string[]; subject: string; body: string }> = [];
vi.mock('@openmig/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/connectors')>();
  return {
    ...actual,
    smtpTransport: () => async (message: { to: readonly string[]; subject: string; body: string }) => {
      SENT.push(message);
    },
  };
});

import { __setChannelForTests, accessGrantedEvent, tell } from './access-notify.ts';

const GRANTED = {
  organisation: 'Familie de Vries',
  appUrl: 'https://app.ownpace.eu',
  email: 'stranger@example.test',
} as const;

const OTA_SITE = 'https://www.ota.ownpace.eu';

/** Where the Alpha conditions are, per language, as the site build writes them. */
const CONDITIONS = {
  production: { en: 'https://www.ownpace.eu/alpha.html', nl: 'https://www.ownpace.eu/nl/alpha.html' },
  ota: { en: `${OTA_SITE}/alpha.html`, nl: `${OTA_SITE}/nl/alpha.html` },
} as const;

/** Where the tester guide is, per language, as an alpha build of the site writes it. */
const GUIDE = {
  production: { en: 'https://www.ownpace.eu/alpha-guide.html', nl: 'https://www.ownpace.eu/nl/alpha-handleiding.html' },
  ota: { en: `${OTA_SITE}/alpha-guide.html`, nl: `${OTA_SITE}/nl/alpha-handleiding.html` },
} as const;

/** The two lines, in the mail's language, that the addresses follow. */
const SAYS = {
  en: { conditions: 'Read the Alpha conditions here:', guide: 'Read the guide to the Alpha before you start:' },
  nl: {
    conditions: 'Lees hier de voorwaarden voor de Alpha:',
    guide: 'Lees de handleiding voor de Alpha voordat u begint:',
  },
} as const;

const channel = () =>
  ({
    notifier: { notify: async () => {} },
    locale: 'en',
    announcement: '',
    config: {
      enabled: true,
      smtp: { host: 'localhost', port: 587, secure: false, user: 'u', pass: 'p' },
      settings: { from: 'ownpace@example.test', to: ['ops@example.test'] },
    },
  }) as unknown as Parameters<typeof __setChannelForTests>[0];

/** The body that reached the transport for one grant mail. */
async function sent(locale: 'en' | 'nl', env: Record<string, string>): Promise<string> {
  __setChannelForTests(channel());
  SENT.length = 0;
  await expect(tell(GRANTED.email, locale, accessGrantedEvent(GRANTED, env))).resolves.toBe('sent');
  expect(SENT).toHaveLength(1);
  return SENT[0]!.body;
}

afterEach(() => {
  __setChannelForTests(null);
});

describe('during the alpha, the grant mail links the Alpha conditions', () => {
  it.each([
    ['unset, on the production site', {}, CONDITIONS.production],
    ['on the site LEGAL_SITE_URL names, with a trailing slash', { LEGAL_SITE_URL: `${OTA_SITE}/` }, CONDITIONS.ota],
  ] as const)('%s, in the mail’s own language', async (_name, site, where) => {
    for (const locale of ['en', 'nl'] as const) {
      const body = await sent(locale, { OWNPACE_STAGE: 'alpha', ...site });
      expect(body, `the ${locale} mail does not link the ${locale} conditions`).toContain(where[locale]);
      const other = locale === 'en' ? 'nl' : 'en';
      expect(body, `the ${locale} mail links the ${other} conditions`).not.toContain(where[other]);
    }
  });

  it.each(['en', 'nl'] as const)('in the alpha paragraph, after its words, in %s', async (locale) => {
    const body = await sent(locale, { OWNPACE_STAGE: 'alpha' });
    const paragraph = body.split('\n\n').find((p) => p.includes(CONDITIONS.production[locale]));
    expect(paragraph, 'the alpha paragraph is gone').toBeDefined();
    const lines = paragraph!.split('\n');
    // The paragraph's words, then the conditions, then the guide.
    expect(lines.length, 'the links are not in the paragraph with its words').toBeGreaterThan(2);
    expect(lines.at(-2)).toBe(`${SAYS[locale].conditions} ${CONDITIONS.production[locale]}`);
    expect(lines.at(-1)).toBe(`${SAYS[locale].guide} ${GUIDE.production[locale]}`);
  });
});

describe('during the alpha, the grant mail links the tester guide', () => {
  it.each([
    ['unset, on the production site', {}, GUIDE.production],
    ['on the site LEGAL_SITE_URL names, with a trailing slash', { LEGAL_SITE_URL: `${OTA_SITE}/` }, GUIDE.ota],
  ] as const)('%s, in the mail’s own language', async (_name, site, where) => {
    for (const locale of ['en', 'nl'] as const) {
      const body = await sent(locale, { OWNPACE_STAGE: 'alpha', ...site });
      expect(body, `the ${locale} mail does not link the ${locale} guide`).toContain(
        `${SAYS[locale].guide} ${where[locale]}`,
      );
      const other = locale === 'en' ? 'nl' : 'en';
      expect(body, `the ${locale} mail links the ${other} guide`).not.toContain(where[other]);
    }
  });

  it.each(['en', 'nl'] as const)('at the guide itself, never a section of it, in %s', async (locale) => {
    // The mail outside the alpha carries no fragment at all
    // (`notifications.unit.test.ts`); inside it, the guide's top is where a
    // tester starts.
    const body = await sent(locale, { OWNPACE_STAGE: 'alpha' });
    expect(body).not.toMatch(/handleiding\.html#|guide\.html#/);
  });
});

describe('outside the alpha, the mail names no conditions and no guide', () => {
  it.each(['en', 'nl'] as const)('in %s, whatever the site', async (locale) => {
    const settings: ReadonlyArray<Record<string, string>> = [{}, { OWNPACE_STAGE: '' }, { LEGAL_SITE_URL: OTA_SITE }];
    for (const env of settings) {
      const body = await sent(locale, env);
      expect(body).not.toMatch(/alpha\.html/);
      expect(body).not.toMatch(/alpha-guide\.html|alpha-handleiding\.html/);
    }
  });
});
