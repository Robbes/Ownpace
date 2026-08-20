// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The operating UI is BUILT, and what comes out of the build is a styled page.
 *
 * On 2026-08-06 the appliance shipped with uncompiled CSS in both editions —
 * `src/index.css` carried Tailwind v3's `@tailwind base/components/utilities`
 * triple while v4 was installed, with nothing configured to process either.
 * Vite copied the file through verbatim: 3.08 KB of `:root { --background: … }`
 * and not one utility. Every screen rendered unstyled and every gate was green.
 *
 * The fix landed with three tests asserting the WIRING — the v4 entry, the Vite
 * plugin, the declared dependency — and they say so in their own docblock:
 *
 *     These assert the WIRING rather than the output, because this suite stages
 *     a stub UI on purpose (a Vite build per unit run would be minutes).
 *
 * **A Vite build per unit run is 8.6 seconds**, `tsc` included, measured on the
 * dev box. The assumption that made "assert the output" look unaffordable was
 * wrong by two orders of magnitude, and it is the only reason the symptom still
 * had no test. Three named causes are pinned; the class of causes is open, and
 * Tailwind v4 detects its own content — a future upgrade that stops finding
 * `src/**` emits a valid, tiny, useless stylesheet with every wiring assertion
 * still true.
 *
 * There is also no CI job that builds this at all. `ci.yml` runs lint, typecheck
 * and tests; `images.yml` builds the appliance image — which is the only thing
 * that compiles the UI — on **push to main** and on PRs only when a Dockerfile
 * or `deploy/**` changes. A PR touching `index.css` or `vite.config.ts` does not
 * trigger it, so a UI that cannot build merges green and breaks main. Living in
 * the unit suite, this runs on every PR.
 *
 * It runs the REAL `build:selfhost` script rather than invoking Vite directly,
 * so `--base=/ui/` and `--mode selfhost` are covered too: the bundle's base is
 * what made bare `/ui` a white page, and the edition flag is baked at build time.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(REPO, 'apps', 'web');
const OUT = join(WEB, 'dist-selfhost');

/**
 * Utilities the app is actually written against, checked BOTH ways.
 *
 * Each has to appear in the source (or this test is asserting something the app
 * does not need, and would keep passing after the class was removed) and in the
 * emitted CSS (or the build produced a stylesheet that cannot style the app).
 * Deliberately stock palette classes rather than the shadcn `bg-background`
 * tokens: a search of every `.tsx` finds ZERO uses of those, which is what made
 * `tailwind.config.js` unprocessed AND irrelevant at the same time.
 */
const UTILITIES = [
  'flex',
  'items-center',
  'rounded-lg',
  'font-medium',
  'text-gray-900',
  'border-gray-200',
  'bg-white',
];

let css = '';
let html = '';

beforeAll(() => {
  // The real script, from the repo root, exactly as `package:appliance` runs it.
  //
  // The output is re-thrown rather than dropped. `execFileSync`'s own error says
  // only "Command failed: pnpm --filter @openmig/web build:selfhost", and this
  // build is the one that runs `tsc` over the whole app — so the difference
  // between a type error, a missing dependency and a Tailwind failure is
  // entirely in the text this used to discard (hard rule 9).
  try {
    execFileSync('pnpm', ['--filter', '@openmig/web', 'build:selfhost'], {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `the operating UI failed to build:\n${err.stdout ?? ''}${err.stderr ?? ''}`.trim(),
      { cause: e },
    );
  }

  html = readFileSync(join(OUT, 'index.html'), 'utf-8');
  const assets = readdirSync(join(OUT, 'assets'));
  const cssFile = assets.find((f) => f.endsWith('.css'));
  if (cssFile === undefined) throw new Error(`no stylesheet in ${join(OUT, 'assets')}`);
  css = readFileSync(join(OUT, 'assets', cssFile), 'utf-8');
}, 300_000);

describe('the built operating UI', () => {
  it('emits a stylesheet carrying the utilities the app is written against', () => {
    const source = readAllTsx(join(WEB, 'src'));
    const missingFromSource: string[] = [];
    const missingFromCss: string[] = [];

    for (const u of UTILITIES) {
      // The premise: this class is one the app really uses. Without it the
      // assertion below would keep passing while asserting nothing anyone needs.
      if (!new RegExp(`className="[^"]*\\b${u}\\b`).test(source)) missingFromSource.push(u);
      // The property: Tailwind emitted a rule for it.
      if (!new RegExp(`\\.${u.replace(/-/g, '-')}[,{ :]`).test(css)) missingFromCss.push(u);
    }

    expect(
      missingFromSource,
      'these classes are no longer used by any screen, so asserting them proves nothing — ' +
        'replace them with classes the app does use',
    ).toEqual([]);
    expect(
      missingFromCss,
      'the stylesheet built without these utilities. Every screen renders unstyled, ' +
        'exactly as it shipped on 2026-08-06. Check that @tailwindcss/vite is in ' +
        "vite.config.ts's plugins[] and that index.css still starts with @import \"tailwindcss\"",
    ).toEqual([]);
  });

  it('is a compiled stylesheet, not the entry file copied through', () => {
    // The 2026-08-06 artefact was 3.08 KB and ~20 rules — the `:root` custom
    // properties and nothing else. A count rather than a byte size, because
    // minification and gzip make bytes a poor proxy for "did anything compile".
    const rules = (css.match(/\{/g) ?? []).length;
    expect(rules, 'far too few rules to be a compiled Tailwind build').toBeGreaterThan(200);
    // The v3 directives, if they ever come back, arrive VERBATIM in the output —
    // that is the whole signature of the bug: nothing processed them.
    expect(css, 'unprocessed v3 directives are in the shipped CSS').not.toMatch(
      /@tailwind\s+(base|components|utilities)/,
    );
  });

  it('references its assets under the /ui/ base it is served from', () => {
    // `--base=/ui/` is what makes `import.meta.env.BASE_URL` — and so React
    // Router's basename — carry the mount. Built at the default base, the
    // bundle asks for /assets/… and the appliance answers 404 for every one.
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? '');
    const local = refs.filter((r) => r.startsWith('/'));
    expect(local.length, 'index.html references no local assets at all').toBeGreaterThan(0);
    for (const r of local) expect(r, 'asset is not under the /ui/ base').toMatch(/^\/ui\//);

    // …and every one of them is really there. A fingerprinted name that does
    // not exist is a white page with a 200 on the HTML.
    for (const r of local) {
      expect(existsSync(join(OUT, r.slice('/ui/'.length))), `${r} is referenced but missing`).toBe(
        true,
      );
    }
  });
});

/** Every `.tsx` under `dir`, concatenated. */
function readAllTsx(dir: string): string {
  let out = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out += readAllTsx(full);
      continue;
    }
    if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      out += readFileSync(full, 'utf-8');
    }
  }
  return out;
}
