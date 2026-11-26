// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CONSENT ENDING IN THE READER'S LANGUAGE (workplan 0145 T6).
 *
 * Every tester who connects a Google, Dropbox or Microsoft account ends on a
 * page the API renders, and so does everybody who grants access on a link.
 * Both endings were English only, with `<html lang="en">`, whatever language
 * the page before them was in. A Dutch reader pressed *Verbinden met Google*,
 * or *Doorgaan met Google*, and came back to *"Consent received"* or *"Thank
 * you — that is done"*.
 *
 * The page before the provider knows the reader's language; the ending does
 * not, and cannot be told by the browser: everything in a redirect is the
 * browser's to change. So the authorize call names the language, the server
 * records it on the pending consent beside the link, and the callback reads it
 * from there. Anything else, or nothing, means English.
 *
 * What is held here:
 *
 * - both endings rendered with `nl` are Dutch, with `<html lang="nl">`: every
 *   sentence of the frame, and the new *"Keep this link"* sentence;
 * - the callback renders the language the authorize call recorded, for each
 *   of the three providers and for a grant link, and the language never
 *   travels through the redirect;
 * - an unknown language, or none, renders English.
 *
 * The owner's exchange refusals name the client and quote the provider, and
 * render verbatim inside the frame; they are not under this guard (0145's
 * Status says so).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// The organisation is open here. Whether a closed one is refused is
// `an-organisation-closed-at-every-door.unit.test.ts`'s subject, and this file
// has no organisation to read (workplan 0085 T2).
vi.mock('../../closed-organisation.ts', () => ({
  refusedAsClosed: async () => false,
  closedOrganisation: async () => null,
}));

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 'a-tenant', userId: 'a-user', userRole: 'owner' });
      next();
    },
  };
});

const { default: googleOauthRoutes } = await import('./google-oauth-routes.ts');
const { default: dropboxOauthRoutes } = await import('./dropbox-oauth-routes.ts');
const { default: microsoftOauthRoutes } = await import('./microsoft-oauth-routes.ts');
const { consentFlows } = await import('./consent-flows.ts');
const { GOOGLE_SOURCE_SCOPES, consentResultPage, grantResultPage } = await import('./google-consent.ts');
const { progressPageUrl } = await import('./progress-page-url.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', googleOauthRoutes);
app.use('/api/migrations', dropboxOauthRoutes);
app.use('/api/migrations', microsoftOauthRoutes);

const ORIGIN = 'https://app.example.test';
const SCOPE = GOOGLE_SOURCE_SCOPES['google-contacts'];
const PAIR = { clientId: 'a-client-id', clientSecret: 'a-client-secret' };
const LINK = {
  linkId: '5f500000-e29b-41d4-a716-446655449901',
  mappingId: '5f500000-e29b-41d4-a716-446655449902',
  tenantId: '5f500000-e29b-41d4-a716-446655449903',
};

/**
 * The words an English sentence cannot do without, and a Dutch one never
 * uses. `is`, `was` and `in` are Dutch too, so they are not here.
 */
const ENGLISH =
  /\b(?:the|and|your|you|this|not|with|from|have|has|that|it|been|can|could|will|would|please|nothing|was not)\b/i;

/** What a reader meets: the visible text and the sentence the script writes, without addresses. */
function words(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<script>([\s\S]*?)<\/script>/g, (_, js: string) => ` ${js.replace(/JSON\.parse\(|\\"|["'`;{}()]/g, ' ')} `)
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The text a Dutch ending may not contain, with the findings a test passed in taken out. */
function englishIn(html: string, findings: ReadonlyArray<string> = []): string | undefined {
  const text = findings.reduce((acc, f) => acc.split(f).join(' '), words(html));
  // Script mechanics are not prose.
  const prose = text.replace(/\b(?:const|payload|target|window\.\w+|document\.\w+|if|else|opener|postMessage|close|querySelector|textContent)\b/g, ' ');
  return ENGLISH.exec(prose)?.[0];
}

const lang = (html: string) => /<html lang="([^"]+)"/.exec(html)?.[1];

const WATCHED = ['API_URL', 'WEB_URL', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'] as const;
const before = Object.fromEntries(WATCHED.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of WATCHED) delete process.env[k];
  process.env.API_URL = ORIGIN;
  process.env.WEB_URL = ORIGIN;
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of WATCHED) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

const KEEP_NL =
  'Bewaar deze link: zet hem bij uw favorieten of kopieer hem naar een veilige plek. Is deze ' +
  'pagina in een andere app geopend, dan bewaart die app hem misschien niet.';
const KEEP_EN =
  'Keep this link: bookmark it or copy it somewhere safe. If this page opened inside another ' +
  'app, that app may not keep it for you.';

describe('the grant ending, in Dutch', () => {
  const progressUrl = progressPageUrl(ORIGIN, 'a-view-token');

  for (const permission of ['read-only', 'allows-changes', 'widened'] as const) {
    it(`a grant that landed (${permission}) is Dutch, with lang="nl" and the sentence to keep the link`, () => {
      const html = grantResultPage({ ok: true, provider: 'google', progressUrl, permission }, 'nl');
      expect(lang(html)).toBe('nl');
      expect(html).toContain(KEEP_NL);
      expect(englishIn(html)).toBeUndefined();
    });
  }

  it('a grant that landed with no progress page is Dutch too', () => {
    const html = grantResultPage({ ok: true, provider: 'google', permission: 'allows-changes' }, 'nl');
    expect(lang(html)).toBe('nl');
    expect(englishIn(html)).toBeUndefined();
  });

  for (const link of ['works', 'unused', undefined] as const) {
    it(`a refused grant (link ${link ?? 'spent'}) frames its reason in Dutch`, () => {
      const reason = 'REASON_AS_GIVEN';
      const html = grantResultPage({ ok: false, reason, ...(link ? { link } : {}) }, 'nl');
      expect(lang(html)).toBe('nl');
      expect(html).toContain(reason);
      expect(englishIn(html, [reason])).toBeUndefined();
    });
  }

  // The owner's decisions of 2026-11-26: a person's link with a second account
  // to connect said *this link will not work again*.
  describe('a person’s link with accounts left to connect', () => {
    const back = `${ORIGIN}/grant/p.an-id.a-secret`;
    it.each([
      ['en', 1, 'Thank you, this account is connected.', 'There is one more.', 'Back to the link'],
      ['nl', 1, 'Dank u, dit account is verbonden.', 'Er is nog één account.', 'Terug naar de link'],
      ['en', 3, 'Thank you, this account is connected.', 'There are 3 more.', 'Back to the link'],
      ['nl', 3, 'Dank u, dit account is verbonden.', 'Er zijn nog 3 accounts.', 'Terug naar de link'],
    ] as const)('%s, %i left: says so, goes back to the link, and not that the link is done', (locale, left, title, more, button) => {
      const html = grantResultPage({ ok: true, provider: 'google', progressUrl, permission: 'read-only', more: { left, backUrl: back } }, locale);
      expect(lang(html)).toBe(locale);
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html).toContain(`<p>${more}</p>`);
      expect(html).toMatch(new RegExp(`<a href="${back.replace(/\./g, '\\.')}" style="[^"]+">${button}</a>`));
      expect(html).not.toMatch(/will not work again|werkt niet meer|that is done|het is gelukt/);
      // Their progress page is still handed over.
      expect(html).toContain(locale === 'nl' ? KEEP_NL : KEEP_EN);
      if (locale === 'nl') expect(englishIn(html)).toBeUndefined();
    });

    it('none left: the ending it always was', () => {
      const html = grantResultPage({ ok: true, provider: 'google', progressUrl, permission: 'read-only', more: { left: 0, backUrl: back } }, 'en');
      expect(html).toContain('this link will not work again');
      expect(html).not.toContain('Back to the link');
    });
  });

  it('says the new "keep this link" sentence in English when the page was English', () => {
    const html = grantResultPage({ ok: true, provider: 'google', progressUrl, permission: 'read-only' }, 'en');
    expect(lang(html)).toBe('en');
    expect(html).toContain(KEEP_EN);
    expect(html).not.toContain('<p>Bookmark it.');
  });

  it('is English when no language, or an unknown one, is given', () => {
    for (const html of [
      grantResultPage({ ok: true, provider: 'google', permission: 'read-only' }),
      grantResultPage({ ok: true, provider: 'google', permission: 'read-only' }, 'de' as never),
    ]) {
      expect(lang(html)).toBe('en');
      expect(html).toContain('Thank you');
    }
  });
});

/**
 * ONE ENDING SERVES EVERY PROVIDER (workplan 0176 T2.4, D1, §5.5). It is drawn
 * after a Microsoft and a Dropbox sign-in too, and its last sentence sent each
 * of them to *your Google account's security settings*. It names the provider
 * that was signed in to now, and first the person's own page, where a stop is
 * easiest. And its Dutch says *kopiëren*, as a person's two pages do: it said
 * *migratie* four times, in three sentences.
 */
describe('the grant ending names the provider that was signed in to, and says kopiëren (0176)', () => {
  const progressUrl = progressPageUrl(ORIGIN, 'a-view-token');
  /** The page's last paragraph, as text. */
  const lastSentence = (html: string): string => {
    const paragraphs = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ''));
    return paragraphs[paragraphs.length - 1] ?? '';
  };

  it.each([
    ['microsoft', 'Microsoft'],
    ['dropbox', 'Dropbox'],
    ['google', 'Google'],
  ] as const)('after a %s sign-in, the last sentence names %s, and first the person’s own page', (provider, name) => {
    const html = grantResultPage({ ok: true, progressUrl, permission: 'read-only', provider }, 'en');
    const last = lastSentence(html);
    expect(last).toBe(
      `You can stop this at any time on your own page, above. Or at ${name}, in the list of apps that have access to your account.`,
    );
    for (const other of ['Google', 'Microsoft', 'Dropbox'].filter((n) => n !== name)) expect(html).not.toContain(other);
  });

  it('in Dutch too', () => {
    const html = grantResultPage({ ok: true, progressUrl, permission: 'read-only', provider: 'microsoft' }, 'nl');
    expect(lastSentence(html)).toBe(
      'U kunt dit altijd weer stoppen op uw eigen pagina, hierboven. Of bij Microsoft, in de lijst van apps die toegang hebben tot uw account.',
    );
  });

  it('with no page of its own to point at, the provider alone', () => {
    const html = grantResultPage({ ok: true, permission: 'read-only', provider: 'dropbox' }, 'en');
    expect(lastSentence(html)).toBe('You can stop this at any time at Dropbox, in the list of apps that have access to your account.');
  });

  it('says kopiëren in Dutch, and no form of migreren, whatever it ends on', () => {
    const back = `${ORIGIN}/grant/p.an-id.a-secret`;
    for (const html of [
      grantResultPage({ ok: true, progressUrl, permission: 'read-only', provider: 'google' }, 'nl'),
      grantResultPage({ ok: true, progressUrl, permission: 'allows-changes', provider: 'google', more: { left: 1, backUrl: back } }, 'nl'),
      grantResultPage({ ok: true, permission: 'widened', provider: 'google' }, 'nl'),
    ]) {
      expect(words(html)).not.toMatch(/migr/i);
    }
    const html = grantResultPage({ ok: true, progressUrl, permission: 'read-only', provider: 'google' }, 'nl');
    expect(words(html)).toContain('Uw account is nu verbonden, en Ownpace kan eruit lezen. U hoeft verder niets te doen, en deze link werkt niet meer.');
    expect(words(html)).toContain('Hier is uw eigen pagina. Bewaar deze. Die laat zien hoe ver het kopiëren is, en niets uit uw account:');
    expect(words(html)).toContain('Hij werkt de komende 90 dagen, en wie u de link stuurde, kan hem op elk moment uitzetten.');
  });

  it('and English follows its Dutch: no migration in it either', () => {
    const html = grantResultPage({ ok: true, progressUrl, permission: 'read-only', provider: 'google' }, 'en');
    expect(words(html)).not.toMatch(/migrat/i);
    expect(words(html)).toContain('Here is your own page. Keep this one. It shows how far the copying is, and nothing from inside your account:');
    expect(words(html)).toContain('It works for the next 90 days, and whoever sent you the link can turn it off at any time.');
  });
});

/**
 * THE ENDING, AS LARGE AS A PERSON'S PAGES (workplan 0176 T9, §5.5). Its sizes
 * are its own, an inline style under the policy it is served with: there was
 * no size for its text, and *Back to the link* was 44 pixels high. The smoke
 * has no API behind it, so the sizes are held here, on its HTML.
 */
describe('the ending is as large as a person’s pages (0176 T9)', () => {
  const progressUrl = progressPageUrl(ORIGIN, 'a-view-token');
  const back = `${ORIGIN}/grant/p.an-id.a-secret`;
  const html = grantResultPage({ ok: true, progressUrl, permission: 'read-only', provider: 'google', more: { left: 1, backUrl: back } }, 'en');
  const styleOf = (re: RegExp): string => re.exec(html)?.[1] ?? '';

  it('sets its sentences at 18 pixels', () => {
    expect(styleOf(/<main style="([^"]*)"/)).toMatch(/font-size:\s*(1\.125rem|18px)/);
  });

  it('draws Back to the link as a main button: 60 pixels high at least, as wide as the column, its words 18 pixels', () => {
    const style = styleOf(/<a href="[^"]+" style="([^"]*)">Back to the link<\/a>/);
    expect(style).toMatch(/min-height:\s*60px/);
    expect(style).toMatch(/width:\s*100%/);
    expect(style).toMatch(/font-size:\s*(1\.125rem|18px)/);
  });

  it('draws Copy link at least 44 pixels high and wide, its words at 18 pixels', () => {
    const style = styleOf(/<button type="button" id="copy-link"[^>]*style="([^"]*)"/);
    expect(style).toMatch(/min-height:\s*(4[4-9]|[5-9]\d)px/);
    expect(style).toMatch(/min-width:\s*(4[4-9]|[5-9]\d)px/);
    expect(style).toMatch(/font-size:\s*(1\.125rem|18px)/);
  });
});

describe("the owner's ending, in Dutch", () => {
  it('a refusal frames its reason in Dutch', () => {
    const reason = 'REASON_AS_GIVEN';
    const html = consentResultPage({ outcome: { ok: false, reason }, locale: 'nl' });
    expect(lang(html)).toBe('nl');
    expect(englishIn(html, [reason])).toBeUndefined();
  });

  for (const provider of ['google', 'dropbox', 'microsoft'] as const) {
    it(`a ${provider} consent that landed is Dutch, the script's no-opener sentence included, and names ${provider}'s own button`, () => {
      const html = consentResultPage({
        webOrigin: ORIGIN,
        outcome: { ok: true, refreshToken: 'rt', grantedScopes: [] },
        provider,
        locale: 'nl',
      });
      expect(lang(html)).toBe('nl');
      expect(englishIn(html)).toBeUndefined();
      const name = { google: 'Google', dropbox: 'Dropbox', microsoft: 'Microsoft' }[provider];
      expect(html).toContain(`Verbinden met ${name}`);
    });
  }

  it('the copy-it-yourself ending, with no web address configured, is Dutch', () => {
    const html = consentResultPage({
      outcome: { ok: true, refreshToken: 'TOKEN_AS_GIVEN', grantedScopes: [] },
      locale: 'nl',
    });
    expect(lang(html)).toBe('nl');
    expect(englishIn(html, ['TOKEN_AS_GIVEN'])).toBeUndefined();
  });

  it('is English when no language, or an unknown one, is given', () => {
    const outcome = { ok: false as const, reason: 'r' };
    for (const html of [consentResultPage({ outcome }), consentResultPage({ outcome, locale: 'de' as never })]) {
      expect(lang(html)).toBe('en');
      expect(html).toContain('Consent did not complete');
    }
  });
});

/** Begin at a door, then come back from the provider with `back`. */
async function roundTrip(
  door: 'google' | 'dropbox' | 'microsoft',
  body: Record<string, unknown>,
  back: Record<string, string>,
): Promise<{ url: URL; page: string }> {
  const started = await request(app).post(`/api/migrations/${door}/authorize`).send(body);
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const url = new URL(started.body.url as string);
  const state = url.searchParams.get('state') ?? '';
  const page = await request(app).get(`/api/migrations/${door}/callback`).query({ state, ...back });
  return { url, page: page.text };
}

const ASK: Record<'google' | 'dropbox' | 'microsoft', Record<string, unknown>> = {
  google: { sourceType: 'google-contacts', ...PAIR },
  dropbox: { ...PAIR },
  microsoft: { domains: ['calendar'], ...PAIR },
};

describe('the callback renders the language the authorize call recorded', () => {
  for (const door of ['google', 'dropbox', 'microsoft'] as const) {
    it(`${door}: a consent begun in Dutch ends in Dutch, and the provider's word stays as it said it`, async () => {
      const { page } = await roundTrip(door, { ...ASK[door], locale: 'nl' }, { error: 'access_denied' });
      expect(lang(page)).toBe('nl');
      expect(page).toContain('access_denied');
      expect(englishIn(page, ['access_denied'])).toBeUndefined();
    });

    it(`${door}: no code back is said in Dutch`, async () => {
      const { page } = await roundTrip(door, { ...ASK[door], locale: 'nl' }, {});
      expect(lang(page)).toBe('nl');
      expect(englishIn(page)).toBeUndefined();
    });

    it(`${door}: the language never travels through the redirect`, async () => {
      const { url } = await roundTrip(door, { ...ASK[door], locale: 'nl' }, { error: 'access_denied' });
      expect(url.searchParams.has('locale')).toBe(false);
      expect(url.toString()).not.toMatch(/[?&](?:locale|lang|hl)=nl\b/);
    });

    it(`${door}: an unknown language, or none, ends in English`, async () => {
      for (const locale of ['de', undefined]) {
        const body = locale === undefined ? ASK[door] : { ...ASK[door], locale };
        const { page } = await roundTrip(door, body, { error: 'access_denied' });
        expect(lang(page)).toBe('en');
        expect(page).toContain('reported: access_denied');
      }
    });
  }

  it("the browser's query cannot choose the ending's language", async () => {
    const started = await request(app).post('/api/migrations/google/authorize').send(ASK.google);
    const state = new URL(started.body.url as string).searchParams.get('state') ?? '';
    const page = await request(app)
      .get('/api/migrations/google/callback')
      .query({ state, error: 'access_denied', locale: 'nl' });
    expect(lang(page.text)).toBe('en');
  });

  describe("a grant link's ending, from the language recorded beside the link", () => {
    const begin = (locale?: 'nl' | 'en') =>
      consentFlows.begin({
        ...PAIR,
        scope: SCOPE,
        redirectUri: `${ORIGIN}/api/migrations/google/callback`,
        link: LINK,
        ...(locale ? { locale } : {}),
      });
    const back = (state: string, q: Record<string, string>) =>
      request(app).get('/api/migrations/google/callback').query({ state, ...q });

    it('permission not given at Google is said in Dutch, with what is true of the link', async () => {
      const page = (await back(begin('nl'), { error: 'access_denied' })).text;
      expect(lang(page)).toBe('nl');
      expect(englishIn(page)).toBeUndefined();
    });

    it("Google's own word stays verbatim inside the Dutch sentence", async () => {
      const page = (await back(begin('nl'), { error: 'server_error' })).text;
      expect(lang(page)).toBe('nl');
      expect(page).toContain('server_error');
      expect(englishIn(page, ['server_error'])).toBeUndefined();
    });

    it('nothing back is said in Dutch', async () => {
      const page = (await back(begin('nl'), {})).text;
      expect(lang(page)).toBe('nl');
      expect(englishIn(page)).toBeUndefined();
    });

    it('a refused exchange is said in Dutch', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 })),
      );
      const page = (await back(begin('nl'), { code: 'a-code' })).text;
      expect(lang(page)).toBe('nl');
      expect(englishIn(page)).toBeUndefined();
    });

    it('a link begun with no language ends in English', async () => {
      const page = (await back(begin(), { error: 'access_denied' })).text;
      expect(lang(page)).toBe('en');
      expect(page).toContain('Permission was not given at Google.');
    });
  });
});
