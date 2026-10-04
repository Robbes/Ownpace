// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * CLAIMS YOU CAN CHECK (workplan 0152 T8).
 *
 * The site says the software is open source, that it has no way to delete from
 * a source, and that whatever cannot be moved is reported. Each of those is a
 * claim a stranger is asked to believe; each is held by something in the
 * repository, which is public. So the claim links what holds it: the
 * repository, the guard, the table. A link to a file that has gone is a claim
 * that outlived its proof, and `scripts/claims-you-can-check.unit.test.ts`
 * fails on it.
 *
 * The files are named here once, by their path in the tree, and linked on the
 * `main` branch, which is what the site describes.
 */

/** The public repository. */
export const REPOSITORY_URL = 'https://github.com/Robbes/Ownpace';

/** What holds each claim, by its path in the repository. */
export const PROOF = {
  // "The software has no way to delete from a source": every source connector's
  // methods, counted by a test (workplan 0149 T5).
  readsOnly: 'scripts/a-source-that-only-reads.unit.test.ts',
  // "Whatever cannot be moved is reported": the scope manifest, the app's list
  // of what migrates, what partly does, and what does not.
  cannotMove: 'packages/shared/src/scope-manifest.ts',
  // "Run it yourself": the self-hosting quickstart.
  selfHost: 'docs/selfhost-quickstart.md',
};

/** A file in the repository, as a link a visitor can open. */
export const proofUrl = (path) => `${REPOSITORY_URL}/blob/main/${path}`;

/** Every claim's link, by its name in PROOF, plus the repository's own. */
export const PROOF_LINKS = {
  repository: REPOSITORY_URL,
  ...Object.fromEntries(Object.entries(PROOF).map(([name, path]) => [name, proofUrl(path)])),
};
