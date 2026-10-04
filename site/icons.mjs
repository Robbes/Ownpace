// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE DATA-TYPE ICONS, as one inline sprite (workplan 0152 T3, T4; 0153 §5).
 *
 * Drawn once, in `docs/design/0152-0154/icons.svg`, and used twice: here, and
 * in the app (`apps/web/src/components/icons/data-type-icons.tsx`). The site
 * cannot read the design folder at build time, since it builds on its own, so
 * these are the drawing's `<symbol>`s copied verbatim, and
 * `scripts/where-to-is-the-apps-own-list.unit.test.ts` fails when they differ
 * from it by a character. A page that uses one inlines `SPRITE` once and draws
 * `icon(name)`: 24 px, a 2 px stroke in the text's colour, hidden from a screen
 * reader, with the data type's name always written beside it.
 */

/** The six symbols, exactly as the drawing has them. */
export const SYMBOLS = `
<symbol id="i-mail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<rect x="3" y="5" width="18" height="14" rx="2"/>
<path d="M3 7l9 6 9-6"/>
</symbol>
<symbol id="i-calendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<rect x="3" y="5" width="18" height="16" rx="2"/>
<path d="M3 10h18M8 3v4M16 3v4"/>
</symbol>
<symbol id="i-contacts" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<circle cx="12" cy="8" r="4"/>
<path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>
</symbol>
<symbol id="i-files" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
</symbol>
<symbol id="i-photos" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<rect x="3" y="4" width="18" height="16" rx="2"/>
<circle cx="9" cy="10" r="2"/>
<path d="M21 16l-5-5-9 9"/>
</symbol>
<symbol id="i-tasks" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17M10 6h11M10 12h11M10 18h11"/>
</symbol>
`;

/** The sprite a page inlines once, before any icon it draws. */
export const SPRITE = `<svg class="sprite" aria-hidden="true" focusable="false"><defs>${SYMBOLS}</defs></svg>`;

/** One icon, by the drawing's name: `mail`, `calendar`, `contacts`, `files`, `photos` or `tasks`. */
export const icon = (name) =>
  `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
