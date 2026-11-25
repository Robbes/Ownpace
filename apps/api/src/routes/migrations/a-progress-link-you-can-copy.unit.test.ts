// Copyright 2026 The Ownpace authors (Apache-2.0)
// @vitest-environment jsdom
/**
 * A PROGRESS LINK YOU CAN COPY (the owner's hand test, 2026-11-24).
 *
 * The page after Google hands the person their progress link and tells them
 * to keep it. In a private window on a phone the owner could not copy it out
 * by hand. So a Copy link button sits beside it, in English and in Dutch.
 *
 * What is pinned: the button is there only with a progress link, and starts
 * hidden so a page whose script does not run offers nothing that does nothing;
 * the page's script is the one constant `COPY_LINK_SCRIPT`, and the headers
 * permit exactly it; pressing copies the link and says *Copied.*; where the
 * clipboard refuses or is missing, the link's text is selected and the page
 * says so. The script runs here in jsdom, over the page's own body.
 *
 * This project has no DOM library (`lib`) and no jsdom types, so the few DOM
 * members the test touches are typed here, narrowly.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { COPY_LINK_SCRIPT, callbackPageHeaders, grantResultPage } from './google-consent.ts';
import { progressPageUrl } from './progress-page-url.ts';

const URL_ = progressPageUrl('https://app.example.com', 'a-view-token');

const WORDS = {
  en: {
    copy: 'Copy link',
    copied: 'Copied.',
    refused: 'This browser did not allow copying. The link is selected: copy it from there.',
  },
  nl: {
    copy: 'Link kopiëren',
    copied: 'Gekopieerd.',
    refused: 'Deze browser stond kopiëren niet toe. De link is geselecteerd: kopieer hem vanaf daar.',
  },
} as const;

type Clipboard = 'works' | 'refuses' | 'missing';

interface El {
  readonly textContent: string | null;
  readonly hidden: boolean;
  getAttribute(name: string): string | null;
  click(): void;
}
interface Dom {
  readonly document: { readonly body: { innerHTML: string }; getElementById(id: string): El | null };
  readonly navigator: object;
  getSelection(): { toString(): string } | null;
}
const dom = globalThis as unknown as Dom;

/** The page's body as a browser lays it out, its script run, with the clipboard behaving as asked. */
function open(locale: 'en' | 'nl', clipboard: Clipboard) {
  const written: string[] = [];
  const html = grantResultPage({ ok: true, progressUrl: URL_, permission: 'read-only' }, locale);
  // innerHTML does not run a script, so the page's own one is run after it.
  dom.document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  const value =
    clipboard === 'missing'
      ? undefined
      : {
          writeText: (text: string): Promise<void> => {
            if (clipboard === 'refuses') return Promise.reject(new Error('NotAllowedError'));
            written.push(text);
            return Promise.resolve();
          },
        };
  Object.defineProperty(dom.navigator, 'clipboard', { configurable: true, value });
  new Function(COPY_LINK_SCRIPT)();
  const el = (id: string): El => {
    const found = dom.document.getElementById(id);
    if (!found) throw new Error(`no #${id} on the page`);
    return found;
  };
  return { written, button: el('copy-link'), status: el('copy-status'), link: el('progress-link') };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the page after Google offers to copy the progress link', () => {
  for (const locale of ['en', 'nl'] as const) {
    it(`${locale}: a button named in the page's language, beside the link, shown by the script`, () => {
      const html = grantResultPage({ ok: true, progressUrl: URL_, permission: 'read-only' }, locale);
      expect(html).toMatch(/<button type="button" id="copy-link" hidden /);
      const { button, status, link } = open(locale, 'works');
      expect(button.textContent).toBe(WORDS[locale].copy);
      expect(button.hidden, 'the script shows the button').toBe(false);
      expect(status.getAttribute('role')).toBe('status');
      expect(link.getAttribute('href')).toBe(URL_);
    });

    it(`${locale}: pressing copies the link and says so`, async () => {
      const { button, status, written } = open(locale, 'works');
      button.click();
      await settle();
      expect(written).toEqual([URL_]);
      expect(status.textContent).toBe(WORDS[locale].copied);
    });

    for (const clipboard of ['refuses', 'missing'] as const) {
      it(`${locale}: where the clipboard ${clipboard === 'refuses' ? 'is refused' : 'is missing'}, the link is selected and the page says so`, async () => {
        const { button, status, written } = open(locale, clipboard);
        button.click();
        await settle();
        expect(written).toEqual([]);
        expect(dom.getSelection()?.toString()).toBe(URL_);
        expect(status.textContent).toBe(WORDS[locale].refused);
      });
    }
  }

  it('offers no button, and runs no script, when there is no progress link to keep', () => {
    const html = grantResultPage({ ok: true, permission: 'read-only' });
    expect(html).not.toContain('copy-link');
    expect(html).not.toContain('<script>');
  });

  it('is served permitting exactly its one script, by hash', () => {
    const html = grantResultPage({ ok: true, progressUrl: URL_, permission: 'read-only' }, 'nl');
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain(`<script>${COPY_LINK_SCRIPT}</script>`);
    const hash = createHash('sha256').update(COPY_LINK_SCRIPT, 'utf8').digest('base64');
    expect(callbackPageHeaders(html)['Content-Security-Policy']).toContain(`script-src 'sha256-${hash}';`);
  });
});
