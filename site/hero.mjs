// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE HERO'S PICTURE: the move, drawn (workplan 0152 T3 (a), D8 *"Drawing now,
 * app screen later"*).
 *
 * Drawn once, in `docs/design/0152-0154/hero-move.svg`, and inlined here,
 * because the site builds on its own and cannot read the design folder (as
 * `icons.mjs` says). It is the drawing's markup, line for line, with three
 * differences, and `scripts/the-hero-is-the-drawing.unit.test.ts` fails on any
 * other:
 *
 * - **the words are the page's language:** the data types as the app names
 *   them (`dataTypes` in `copy.mjs`), and the rest from `hero` in `copy.mjs`;
 * - **the icons come from the page's sprite** (`icons.mjs`), drawn once per
 *   page, so the drawing's own `<symbol>`s are left out rather than repeated
 *   under the same ids;
 * - **it scales with its column:** no width or height, its title and
 *   description under ids of their own.
 *
 * The palette is the site's, through the page's own custom properties, so the
 * drawing is drawn in the page's warm paper and teal. The site has no dark
 * version since the owner chose warm paper, always light (2026-10-05), and
 * neither has the drawing.
 */

/**
 * @param {{ title: string, desc: string, old: string, new: string, copies: string,
 *   keeps: [string, string], types: Record<'email' | 'calendar' | 'contact' | 'file' | 'photos', string> }} w
 */
export function heroMove(w) {
  return `<svg class="hero-move" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 356" role="img" aria-labelledby="hero-move-t hero-move-d" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">
<title id="hero-move-t">${w.title}</title>
<desc id="hero-move-d">${w.desc}</desc>
<defs>
<marker id="hm-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path class="hm-head" d="M0 0L10 5L0 10z"/>
</marker>
</defs>
<style>.hm-ink{fill:var(--ink,#1D2421)} .hm-muted{fill:var(--muted,#5D6763)}.hm-card{fill:var(--panel,#F2F0E8);stroke:var(--line,#E5E1D6)}.hm-accent{color:var(--teal,#0E4F4A);fill:var(--teal,#0E4F4A)} .hm-arrow{stroke:var(--teal,#0E4F4A)}.hm-head{fill:var(--teal,#0E4F4A)} .hm-ring{fill:var(--bg,#FAF9F5);stroke:var(--teal,#0E4F4A)}.hm-ok{fill:var(--mint,#7FD4C1)} .hm-tick{stroke:#0E4F4A}</style>
<rect class="hm-card" x="8" y="40" width="190" height="306" rx="16" stroke-width="1.5"/>
<text class="hm-muted" x="103" y="30" font-size="13" font-weight="600" text-anchor="middle">${w.old}</text>
<use href="#i-mail" x="28" y="62" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="62" y="78" font-size="14" font-weight="500">${w.types.email}</text>
<use href="#i-calendar" x="28" y="108" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="62" y="124" font-size="14" font-weight="500">${w.types.calendar}</text>
<use href="#i-contacts" x="28" y="154" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="62" y="170" font-size="14" font-weight="500">${w.types.contact}</text>
<use href="#i-tasks" x="28" y="200" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="62" y="216" font-size="14" font-weight="500">${w.types.task}</text>
<use href="#i-files" x="28" y="246" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="62" y="262" font-size="14" font-weight="500">${w.types.file}</text>
<use href="#i-photos" x="28" y="292" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="62" y="308" font-size="14" font-weight="500">${w.types.photos}</text>
<rect class="hm-card" x="362" y="40" width="190" height="306" rx="16" stroke-width="1.5"/>
<text class="hm-muted" x="457" y="30" font-size="13" font-weight="600" text-anchor="middle">${w.new}</text>
<use href="#i-mail" x="382" y="62" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="416" y="78" font-size="14" font-weight="500">${w.types.email}</text>
<circle class="hm-ok" cx="526" cy="73" r="8"/>
<path class="hm-tick" d="M522 73l3 3 5-6" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<use href="#i-calendar" x="382" y="108" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="416" y="124" font-size="14" font-weight="500">${w.types.calendar}</text>
<circle class="hm-ok" cx="526" cy="119" r="8"/>
<path class="hm-tick" d="M522 119l3 3 5-6" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<use href="#i-contacts" x="382" y="154" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="416" y="170" font-size="14" font-weight="500">${w.types.contact}</text>
<circle class="hm-ok" cx="526" cy="165" r="8"/>
<path class="hm-tick" d="M522 165l3 3 5-6" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<use href="#i-tasks" x="382" y="200" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="416" y="216" font-size="14" font-weight="500">${w.types.task}</text>
<circle class="hm-ok" cx="526" cy="211" r="8"/>
<path class="hm-tick" d="M522 211l3 3 5-6" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<use href="#i-files" x="382" y="246" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="416" y="262" font-size="14" font-weight="500">${w.types.file}</text>
<circle class="hm-ok" cx="526" cy="257" r="8"/>
<path class="hm-tick" d="M522 257l3 3 5-6" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<use href="#i-photos" x="382" y="292" width="22" height="22" class="hm-accent"/>
<text class="hm-ink" x="416" y="308" font-size="14" font-weight="500">${w.types.photos}</text>
<circle class="hm-ok" cx="526" cy="303" r="8"/>
<path class="hm-tick" d="M522 303l3 3 5-6" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<circle class="hm-ring" cx="280" cy="163" r="46" stroke-width="3"/>
<text class="hm-accent" x="280" y="168" font-size="15" font-weight="700" text-anchor="middle">Ownpace</text>
<text class="hm-muted" x="280" y="101" font-size="13" font-weight="600" text-anchor="middle">${w.copies}</text>
<path class="hm-arrow" d="M200 163 H 226" fill="none" stroke-width="3" marker-end="url(#hm-ah)"/>
<path class="hm-arrow" d="M328 163 H 358" fill="none" stroke-width="3" marker-end="url(#hm-ah)"/>
<path class="hm-arrow" d="M200 229 C 236 263, 324 263, 356 229" fill="none" stroke-width="2.5" stroke-dasharray="6 5" marker-end="url(#hm-ah)"/>
<text class="hm-muted" x="280" y="285" font-size="13" font-weight="600" text-anchor="middle">${w.keeps[0]}</text>
<text class="hm-muted" x="280" y="303" font-size="13" font-weight="600" text-anchor="middle">${w.keeps[1]}</text>
</svg>`;
}
