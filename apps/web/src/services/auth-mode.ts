// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * What this deployment will accept as a credential (workplan 0102 T1).
 *
 * **The sign-in page used to guess.** It read `VITE_OIDC_ISSUER` — a value
 * baked into the bundle at BUILD time — and rendered the paste box whenever
 * that was absent. The authority is the API, at REQUEST time:
 * `selectAuthMode(JWT_ISSUER, JWT_SECRET)` returns `managed` the moment an
 * issuer is configured, and managed mode verifies against the provider's JWKS
 * and never falls back to `JWT_SECRET`. A seed token is signed with that
 * secret, so on such a stack it is well-formed, unexpired and refused.
 *
 * The two agreed only because one script writes both. They were still two
 * values in two processes, and #562 is what that costs: the issuer was
 * configured on the stack and missing from the bundle, so the page offered the
 * box, took a token, and bounced.
 *
 * THE PAGE ASKS FOR THE ANSWER, NOT THE INPUTS. `acceptsSeedToken` is decided
 * in the API beside `selectAuthMode`; re-deriving "managed means no" here would
 * put the same rule in a second process again, which is the whole bug.
 */

import { signInClient } from './api.ts';

export interface AuthMode {
  /** Why the answer is what it is — for an operator, not for the flow. */
  readonly mode: 'managed' | 'local' | 'dev';
  /** Whether a token from `seed-managed.sh` can be used here at all. */
  readonly acceptsSeedToken: boolean;
}

/**
 * `signInClient`, NOT `apiClient` — the same reason `fetchMe` uses it. This runs
 * on the sign-in page with no session, and `apiClient`'s response interceptor
 * redirects to that very page on a refusal, which would swallow the failure
 * this call has to be able to report.
 */
export async function fetchAuthMode(): Promise<AuthMode> {
  const response = await signInClient.get<AuthMode>('/auth/mode');
  return response.data;
}
