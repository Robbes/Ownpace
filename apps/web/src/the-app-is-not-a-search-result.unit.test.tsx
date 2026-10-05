// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE APP IS NOT A SEARCH RESULT (workplan 0152, 2026-10-05).
 *
 * The guides opened to everybody on 2026-10-04 (`pages/PublicDocs.tsx`), and
 * the site's *Leaving…* pages link them. A search engine that follows such a
 * link could list `/docs/google` on the app's host, and the app sent no word
 * against it. The app is a tool behind sign-in. A stranger can open three
 * kinds of page there: the request form, the sign-in page and the guides. The
 * guides' home to be indexed is meant to be the site's help section (workplan
 * 0151), so the same text is not listed on two hosts.
 *
 * Every address answers with `index.html`: nginx's `try_files` fallback in
 * `nginx.conf.template`, and the appliance's `static-ui.ts`. So one tag there
 * covers every route, in both editions, since `build` and `build:selfhost`
 * both start from that file. On the appliance it is harmless.
 *
 * This reads the file and fails when the tag goes, or says anything but
 * noindex. It reads it as a browser does, with `DOMParser`; so it is a `.tsx`
 * file though it draws nothing, because the root typecheck compiles every
 * `.ts` under `apps/` without the DOM library, and this app's own program has
 * it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/** The page Vite builds from, for both editions. */
const INDEX = join(import.meta.dirname, '..', 'index.html');

describe('the app asks search engines not to list it', () => {
  const page = new DOMParser().parseFromString(readFileSync(INDEX, 'utf8'), 'text/html');

  it('reads the page every route is answered with, so the check below is not vacuous', () => {
    expect(page.getElementById('root'), 'not the app’s page: it has no #root').not.toBeNull();
    expect(page.querySelector('script[type="module"]')?.getAttribute('src')).toBe('/src/index.tsx');
  });

  it('carries one robots tag, in its head, and it says noindex', () => {
    const robots = Array.from(page.querySelectorAll('meta[name="robots"]'));
    expect(
      robots,
      'index.html sends no robots tag, so a search engine may list the app’s pages: the\n' +
        'public guides among them, whose home to be indexed is the site (0151)',
    ).toHaveLength(1);
    expect(robots[0]!.parentElement?.tagName, 'a robots tag outside <head> is not read').toBe('HEAD');
    const said = (robots[0]!.getAttribute('content') ?? '').split(',').map((d) => d.trim().toLowerCase());
    expect(said).toContain('noindex');
    expect(said, 'the tag also says index, which contradicts it').not.toContain('index');
  });
});
