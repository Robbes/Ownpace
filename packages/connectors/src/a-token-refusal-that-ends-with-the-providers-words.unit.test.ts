// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TOKEN ENDPOINT'S REFUSAL ENDS WITH THE PROVIDER'S WORDS (workplan 0136 T3,
 * `token-refusal.ts`).
 *
 * Google's, Box's and Dropbox's token providers name what their provider's
 * refusal leaves out. That hint comes BEFORE the provider's body, so the body
 * is the last thing in the message, after the status, where the managed API
 * looks for a server's words. Written after it, the hint made Google's
 * `invalid_grant` unreadable to that rule, and both were lost on the managed
 * service (2026-11-15). The API's half of this is
 * `apps/api/src/a-token-refusal-said-in-its-own-words.unit.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { BoxTokenProvider } from './box-token-provider.ts';
import { DropboxTokenProvider } from './dropbox-token-provider.ts';
import { GoogleTokenProvider } from './google-token-provider.ts';
import type { TokenFetch } from './google-token-provider.ts';
import { tokenRefusalMessage } from './token-refusal.ts';

const refusing =
  (status: number, body: string): TokenFetch =>
  async () => ({ ok: false, status, text: async () => body });

/** What each provider throws when its token endpoint answers `status` with `body`. */
const refusal = {
  Google: (status: number, body: string) =>
    new GoogleTokenProvider(
      { clientId: 'id', clientSecret: 'secret', refreshToken: 'rt' },
      { fetchImpl: refusing(status, body) },
    ).getToken(),
  Box: (status: number, body: string) =>
    new BoxTokenProvider(
      { clientId: 'id', clientSecret: 'secret', subjectUserId: '12345' },
      { fetchImpl: refusing(status, body) },
    ).getToken(),
  Dropbox: (status: number, body: string) =>
    new DropboxTokenProvider(
      { appKey: 'key', appSecret: 'secret', refreshToken: 'rt' },
      { fetchImpl: refusing(status, body) },
    ).getToken(),
} as const;

async function messageOf(pending: Promise<unknown>): Promise<string> {
  const thrown = await pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(Error);
  return (thrown as Error).message;
}

// Google answers pretty-printed; the others on one line. Every refusal a
// provider's hint names, so each hint is read in the place it now stands.
const HINTED = [
  ['Google', '{\n  "error": "invalid_grant",\n  "error_description": "Token has been expired or revoked."\n}', 'seven days'],
  ['Box', '{"error":"unauthorized_client","error_description":"The grant type is unauthorized for this client_id"}', 'Admin Console'],
  ['Box', '{"error":"invalid_client","error_description":"The client credentials are invalid"}', 'client secret is wrong'],
  ['Box', '{"error":"invalid_grant","error_description":"Grant credentials are invalid"}', 'box_subject_id'],
  ['Dropbox', '{"error": "invalid_grant", "error_description": "refresh token is invalid or revoked"}', 'unlinked'],
] as const;

describe("a token endpoint's refusal: our hint first, the provider's words last", () => {
  it.each(HINTED)('%s, %#', async (provider, body, hintWords) => {
    const message = await messageOf(refusal[provider](400, body));
    // The provider's body, verbatim and last, straight after the status.
    expect(message.endsWith(`${provider} answered (400): ${body}`)).toBe(true);
    // The hint stands before the status, so nothing of ours follows the body.
    const hintAt = message.indexOf(hintWords);
    expect(hintAt).toBeGreaterThan(-1);
    expect(hintAt).toBeLessThan(message.indexOf('(400)'));
    expect(message.startsWith(`${provider} refused the token request: `)).toBe(true);
  });

  it.each(['Google', 'Box', 'Dropbox'] as const)(
    '%s, a refusal no hint names, reads as it always did',
    async (provider) => {
      const body = '{"error":"invalid_request","error_description":"Missing parameter"}';
      expect(await messageOf(refusal[provider](400, body))).toBe(
        `${provider} refused the token request (400): ${body}`,
      );
    },
  );

  it('the one sentence both shapes come from', () => {
    expect(tokenRefusalMessage('Google', 401, 'Unauthorized', '')).toBe(
      'Google refused the token request (401): Unauthorized',
    );
    expect(tokenRefusalMessage('Google', 400, '{"error":"invalid_grant"}', 'A hint.')).toBe(
      'Google refused the token request: A hint. Google answered (400): {"error":"invalid_grant"}',
    );
  });
});
