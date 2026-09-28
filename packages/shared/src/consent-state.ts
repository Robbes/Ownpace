// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * HOW LONG A CONSENT THE SERVER BEGAN WAITS FOR ITS ENDING: ten minutes.
 *
 * The API forgets the consent's `state` after this long (`ConsentFlowStore`,
 * `apps/api/src/routes/migrations/google-consent.ts`), and a callback that
 * brings it later ends on the English *"expired"* refusal. The web app takes a
 * blocked window's link away at the same age and asks for a new press instead
 * (`ConsentWindowLink`, workplan 0145 T5), so both read this one number.
 */
export const CONSENT_STATE_TTL_MS = 10 * 60_000;
