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
 * ## A draft line is its number
 *
 * `**Version:** 1.2 (draft — not yet published)` is version 1.2. The draft
 * words say whether the site may publish the text, which the site build
 * refuses on its own (`DRAFT_WORDS` in `site/build.mjs`); they are not part of
 * the version, and never appear here.
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

/** A version number's shape, as the table's CHECK holds it (managed 0032). */
export const VERSION_SHAPE = /^[0-9]+(\.[0-9]+)*$/;

export function isLegalDocument(value: unknown): value is LegalDocument {
  return typeof value === 'string' && (LEGAL_DOCUMENTS as readonly string[]).includes(value);
}

export function isLegalLanguage(value: unknown): value is LegalLanguage {
  return typeof value === 'string' && (LEGAL_LANGUAGES as readonly string[]).includes(value);
}
