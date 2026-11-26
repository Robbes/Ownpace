// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Everything on one page, and where the service runs (workplan 0176 D15 (a),
 * D16 (a); the owner, 2026-11-26: *"D15: a"*, *"P16: a"*).
 *
 * *Everything on one page* (`pages/PersonGrantOnePage.tsx`) says what the
 * steps of a person's link say, all at once and for print, and almost every
 * sentence on it is a step's own, from `grant.ts`: the same sentences, written
 * once. These are the few it adds, its title, its two controls and the link to
 * it, and the one step sentence that would not be true there. *The next screen
 * shows from where and to where* has no next screen on one page, so it says
 * *further down this page* instead (R3).
 *
 * And the sentence that says where the service runs, under the first line of
 * a person's link page and of this page (`components/WhereItRuns.tsx`): the
 * owner chose it with D16 (a). The country is never written here: it is the
 * deployment's setting, and unset nothing is said (`services/where-it-runs.ts`).
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one file,
 * the Dutch in the English order. `nl` is typed against `en`. Dutch with *u*,
 * as a person's pages are until T7 gives them their *je*; a sentence that
 * needs no *u* has none.
 */

export const en = {
  // Under the first line of a person's link page (D16 (a)), and of the one page.
  'grant.person.runsIn': 'Ownpace runs in {country}.',
  // The link to it, on a person's link page (D15 (a)).
  'grant.onePage.link': 'Read everything on one page',
  'grant.onePage.title': 'Everything on one page',
  'grant.onePage.print': 'Print this page',
  'grant.onePage.back': 'Back to the steps',
  // `grant.person.whatMany`, where there is no next screen.
  'grant.onePage.whatMany': '{who} wants to copy your {what}. Further down this page it says from where and to where.',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'grant.person.runsIn': 'Ownpace draait in {country}.',
  'grant.onePage.link': 'Alles op één pagina lezen',
  'grant.onePage.title': 'Alles op één pagina',
  'grant.onePage.print': 'Deze pagina afdrukken',
  'grant.onePage.back': 'Terug naar de stappen',
  'grant.onePage.whatMany': '{who} wil uw {what} kopiëren. Verderop op deze pagina staat waarvandaan en waarnaartoe.',
};
