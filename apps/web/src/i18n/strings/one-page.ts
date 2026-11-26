// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Where the service runs (workplan 0176 D16 (a); the owner, 2026-11-26:
 * *"P16: a"*).
 *
 * The sentence that says where the service runs, under the first line of
 * a person's link page (`components/WhereItRuns.tsx`): the owner chose it
 * with D16 (a). The country is never written here: it is the
 * deployment's setting, and unset nothing is said (`services/where-it-runs.ts`).
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one file,
 * the Dutch in the English order. `nl` is typed against `en`. Dutch with *u*,
 * as a person's pages are until T7 gives them their *je*; a sentence that
 * needs no *u* has none.
 */

export const en = {
  // Under the first line of a person's link page (D16 (a)).
  'grant.person.runsIn': 'Ownpace runs in {country}.',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'grant.person.runsIn': 'Ownpace draait in {country}.',
};
