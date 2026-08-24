// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE BUILD STAMP WAS ON EVERY PAGE EXCEPT THE ONES YOU CAN SEE.
 *
 * `BuildStamp` renders in `Layout`'s sidebar, and `Layout` mounts only under
 * `ProtectedRoute` at `/`. So the answer to "what build is this?" was visible
 * exactly where you had already signed in — and absent from the sign-in page,
 * which is the one screen an operator, a person answering an invitation, or
 * anyone asking for access can actually reach.
 *
 * Reported from the Spark on 2026-08-24, looking at *Aanmelden bij Ownpace*:
 * "I don't see a version on the front app page?" The API answered
 * `GET /version` correctly the whole time, and the bundle was stamped — the
 * one place nobody could look was the page everybody looks at first.
 *
 * So: every route rendered OUTSIDE `Layout` carries its own stamp.
 *
 * HOW THE SPLIT IS DRAWN, and its limit. `AppRoutes.tsx` puts every public
 * route before the `/` route that renders `<Layout />`, and everything nested
 * under that one inherits the sidebar's stamp. This reads the source and
 * treats "appears before the single `<Layout />`" as "outside it" — which is
 * why it also asserts there is exactly one, so a second Layout cannot move the
 * boundary without saying so.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SRC = join(REPO_ROOT, 'apps/web/src');
const routes = readFileSync(join(WEB_SRC, 'AppRoutes.tsx'), 'utf8');

/**
 * Pages that are deliberately stampless, each with the reason it is not a
 * hole. An exemption list is a promise that somebody looked — an empty rule
 * with a growing list is not.
 */
const EXEMPT: Record<string, string> = {
  // A redirect target that renders for the length of one token exchange and
  // then navigates away. A version line nobody can finish reading is noise.
  AuthCallback: 'transient — exchanges the code and immediately navigates',
};

/** Wrappers and router primitives, which are not pages. */
const NOT_A_PAGE = new Set(['ManagedOnly', 'SelfhostOnly', 'ProtectedRoute', 'Navigate', 'Layout']);

export function pagesOutsideLayout(source: string): string[] {
  const boundary = source.indexOf('<Layout />');
  const before = boundary < 0 ? source : source.slice(0, boundary);
  const found = new Set<string>();
  for (const match of before.matchAll(/<([A-Z][A-Za-z0-9]*)\s*\/>/g)) {
    // A capture group is `string | undefined` to the compiler even when the
    // pattern cannot match without it. Read it, then decide.
    const name = match[1];
    if (name && !NOT_A_PAGE.has(name)) found.add(name);
  }
  return [...found].sort();
}

describe('every screen you can reach outside the app shell says what build it is', () => {
  it('there is exactly one <Layout />, which is what makes the split meaningful', () => {
    expect(routes.match(/<Layout \/>/g) ?? []).toHaveLength(1);
  });

  it('finds the public routes, so the rule is not passing on an empty list', () => {
    const pages = pagesOutsideLayout(routes);
    expect(pages.length).toBeGreaterThan(0);
    // Named rather than merely counted: the sign-in page is the whole reason
    // this file exists, and a refactor that moved it under Layout would
    // otherwise satisfy the rule by removing the case.
    expect(pages).toContain('Login');
  });

  it.each(pagesOutsideLayout(routes))('%s renders a BuildStamp', (page) => {
    if (EXEMPT[page]) return;
    const file = join(WEB_SRC, 'pages', `${page}.tsx`);
    expect(existsSync(file), `${file} does not exist`).toBe(true);
    const source = readFileSync(file, 'utf8');
    expect(
      source,
      `${page} is rendered outside Layout, so it gets no stamp from the sidebar,\n` +
        'and it does not render one of its own. Either add <BuildStamp /> or add\n' +
        'the page to EXEMPT with the reason it does not need one.',
    ).toContain('<BuildStamp />');
  });

  it('every exemption names a page that is actually outside Layout', () => {
    // An exemption for a page that moved is a comment claiming a decision
    // nobody is making any more.
    const outside = pagesOutsideLayout(routes);
    for (const page of Object.keys(EXEMPT)) expect(outside).toContain(page);
  });
});

describe('the rule itself', () => {
  it('reads a page name out of a route element', () => {
    expect(pagesOutsideLayout('<Route element={<Login />} /><Layout />')).toEqual(['Login']);
  });

  it('ignores the wrappers routes are built from', () => {
    expect(
      pagesOutsideLayout('<ManagedOnly><ProtectedRoute><Navigate /></ProtectedRoute></ManagedOnly><Layout />'),
    ).toEqual([]);
  });

  it('does not reach past <Layout /> into the shell it already covers', () => {
    expect(pagesOutsideLayout('<Login /><Layout /><Dashboard />')).toEqual(['Login']);
  });
});
