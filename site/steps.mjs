// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FIVE STEPS' PICTURES (2026-11-19).
 *
 * How it works has five steps. The home page showed three of its own until
 * 2026-11-19, so a reader who followed them found a different list. It shows
 * the same five now, each with the picture its heading carries on the page
 * itself, so a step is found by its picture as well as its number. The home
 * page's words for the steps are `strip` in copy.mjs, and
 * `scripts/the-hero-is-the-drawing.unit.test.ts` holds them to the page's
 * headings.
 *
 * Drawn for the site, in the data-type icons' manner (icons.mjs): a 24-pixel
 * square, a 2-pixel stroke in the text's colour, round ends. They are the
 * site's alone, so they live here and not in the design folder's icons.svg,
 * which the app shares. Each is hidden from a screen reader: the step's words
 * say everything the picture does.
 */

/** In the steps' order: see what you have, connect, copy and keep copying, check, switch. */
export const STEP_DRAWINGS = [
  // 1. See what you have: the estimate, a calculator.
  '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7.5h7"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/>',
  // 2. Connect the account you are leaving: a link.
  '<g transform="rotate(-45 12 12)"><rect x="2.5" y="8.5" width="11" height="7" rx="3.5"/><rect x="10.5" y="8.5" width="11" height="7" rx="3.5"/></g>',
  // 3. We copy, and then we keep copying: two arrows, going round.
  '<path d="M4 12a8 8 0 0 1 13.66-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.66 5.66L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
  // 4. Check everything at your own pace: a magnifier over a tick.
  '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/><path d="M7.75 10.75l2 2 3.5-3.75"/>',
  // 5. Switch when you are ready: the new home.
  '<path d="M3.5 11.5L12 4.5l8.5 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
];

/** Step `n`'s picture (1 to 5), in its round frame. */
export const stepIcon = (n) => {
  const drawing = STEP_DRAWINGS[n - 1];
  if (!drawing) throw new Error(`There is no step ${n}: How it works has ${STEP_DRAWINGS.length}.`);
  return (
    '<span class="step-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${drawing}</svg></span>`
  );
};
