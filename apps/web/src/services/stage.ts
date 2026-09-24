// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Whether this deployment runs the alpha (workplan 0131 T1): the rule.
 *
 * One setting in the deployment's `.env`, `OWNPACE_STAGE=alpha`, read in two
 * places: the API, which says so in the access-granted mail (`alphaFrom` in
 * `apps/api/src/access-notify.ts`, the same rule), and this bundle, which shows
 * the note (`isAlpha` in `components/AlphaNote.tsx`). `managed.yml` hands it to
 * the web build as the build arg `VITE_OWNPACE_STAGE`, because Vite exposes
 * only `VITE_` names; `scripts/an-alpha-both-halves-know-about.unit.test.ts`
 * holds both halves to it.
 *
 * ## Why a build arg and not a question to the API
 *
 * `/login` and `/request-access` have no session to ask with, and they are
 * where a tester stands first. A note fetched at runtime would also vanish
 * whenever the read failed, going quiet exactly when something is wrong. So
 * the answer is baked in, like the issuer (`oidc.ts`).
 *
 * ## Off unless the deployment says so, and never on the appliance
 *
 * Unset or empty is off: the OTA stack, a developer's stack, every other
 * deployment. The only value that turns it on is `alpha`, trimmed and in any
 * case, because a typo that switched the note off would do it silently. An
 * APPLIANCE never shows it, whatever its bundle was built with: it lets nobody
 * in, so there is no alpha to be in, and the edition decides that here rather
 * than trusting every appliance build to leave the variable alone.
 */

/** The one value that means "this is the alpha". */
export const ALPHA_STAGE = 'alpha';

/** The note's rule, as a pure function of the setting and the edition. */
export function alphaFrom(stage: unknown, selfhost: boolean): boolean {
  if (selfhost) return false;
  return typeof stage === 'string' && stage.trim().toLowerCase() === ALPHA_STAGE;
}
