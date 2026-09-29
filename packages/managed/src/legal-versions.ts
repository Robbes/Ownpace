// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The versions of the texts a tester accepts, as the app asks for them
 * (workplan 0139 T3).
 *
 * When somebody creates their account, the app shows them the Alpha
 * conditions, the privacy policy and the terms, each with its version number,
 * and records which version of each they accepted, and when (terms §1, Alpha
 * conditions §2, privacy §4.4). These are those numbers.
 *
 * ## Why a constant, and what holds it to the texts
 *
 * The texts live in `site/legal/`, and nothing in `apps/` or `packages/` may
 * import them (`site/legal/README.md`): the site is built and published on its
 * own, and a text is not a module. So the number is written here as well, and
 * `scripts/a-version-the-tester-accepted.unit.test.ts` fails the moment it
 * differs from the *Version* line of `alpha.md`, `privacy.md` or `terms.md`,
 * or of their Dutch files. A text with a new number is a text every tester is
 * asked to accept again: change it here in the same commit.
 *
 * ## A draft is asked for by nobody
 *
 * `**Version:** 1.2 (draft — not yet published)` is version 1.2, and its
 * number is the one the final text will carry: the owner's final-text pull
 * request drops the draft words and keeps the number (`site/legal/README.md`,
 * *What a final Version line looks like*). The text can still change before
 * then. A tester who accepted the draft would be recorded as having accepted
 * the final text, which they never read, and never be asked again (review of
 * 2026-09-29). So `LEGAL_DRAFTS` says which texts are still drafts, and while
 * any is, the API asks nobody, no door refuses, and nothing is recorded
 * (`acceptanceAsked` in `apps/api/src/conditions-not-accepted.ts`). The site
 * build refuses to publish a draft on its own (`DRAFT_WORDS` in
 * `site/build.mjs`), and the guard holds `LEGAL_DRAFTS` to the same words.
 *
 * So a new version is drafted in its own pull request and merged once final:
 * a draft merged to `main` stops the asking for every text until it is final.
 * The API says so in its log when it starts (`acceptanceAtStart`).
 *
 * Once a text is final and asked for, its words are pinned to its number
 * (`ACCEPTED_WORDS` in the guard): a change after that gets a new number.
 *
 * ## Managed only, and alpha only
 *
 * The appliance has no terms and asks nobody to accept anything, so this
 * lives in `@openmig/managed`, which no appliance module may import
 * (`apps/selfhost/src/no-managed-leakage.unit.test.ts`). The Alpha conditions
 * are one of the three because the deployment that asks is the Alpha's
 * (`OWNPACE_STAGE=alpha`, 0131 T1). When the Alpha ends, the new conditions
 * replace them here, and whether the paid service asks at all is 0086's
 * question.
 *
 * Dependency-free on purpose: the guard at the repository's root imports this
 * file directly.
 */

/** The texts a tester accepts, in the order the screen lists them. */
export const LEGAL_DOCUMENTS = ['alpha', 'privacy', 'terms'] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

/** The languages the texts are published in: Dutch first, as testers read them. */
export const LEGAL_LANGUAGES = ['nl', 'en'] as const;
export type LegalLanguage = (typeof LEGAL_LANGUAGES)[number];

export type LegalVersions = Readonly<Record<LegalDocument, string>>;

/**
 * The current version of each text: the number on its *Version* line, without
 * any draft words.
 */
export const LEGAL_VERSIONS: LegalVersions = {
  alpha: '1.0',
  privacy: '1.2',
  terms: '1.3',
};

/**
 * Whether each text is still a draft: its *Version* line carries draft words
 * (`DRAFT_WORDS` in `site/build.mjs`), in both languages. Held to the texts by
 * `scripts/a-version-the-tester-accepted.unit.test.ts`. While any is `true`,
 * nobody is asked to accept anything (the header says why).
 */
export const LEGAL_DRAFTS: Readonly<Record<LegalDocument, boolean>> = {
  alpha: false,
  privacy: true,
  terms: true,
};

/** The texts that are still drafts, in the order the screen lists them; none once all are final. */
export function draftTexts(drafts: Readonly<Record<LegalDocument, boolean>> = LEGAL_DRAFTS): LegalDocument[] {
  return LEGAL_DOCUMENTS.filter((document) => drafts[document]);
}

/** A version number's shape, as the table's CHECK holds it (managed 0032). */
export const VERSION_SHAPE = /^[0-9]+(\.[0-9]+)*$/;

export function isLegalDocument(value: unknown): value is LegalDocument {
  return typeof value === 'string' && (LEGAL_DOCUMENTS as readonly string[]).includes(value);
}

export function isLegalLanguage(value: unknown): value is LegalLanguage {
  return typeof value === 'string' && (LEGAL_LANGUAGES as readonly string[]).includes(value);
}
