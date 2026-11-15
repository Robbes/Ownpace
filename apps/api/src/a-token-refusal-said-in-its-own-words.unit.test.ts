// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TOKEN ENDPOINT'S REFUSAL KEEPS ITS WORDS ON THE MANAGED SERVICE (workplan
 * 0136 T3).
 *
 * Seen on the OTA stack on 2026-11-15: a Google account's refresh token had
 * expired, and the run's log read *"contact sync failed: Google refused the
 * token request (400): the server answered with something that is not a DAV,
 * JMAP or IMAP error."* Google had said `invalid_grant`, and the provider had
 * added the likely cause; the rule kept neither. Two reasons, both closed
 * now: an OAuth 2.0 token endpoint's error response was no document the rule
 * knew (`providerErrorWords` reads it since), and the provider wrote its hint
 * after Google's body, so the body was no document at all
 * (`packages/connectors/src/token-refusal.ts` writes it first since).
 *
 * The messages here are the ones the real providers throw, through the real
 * rule, so a change on either side that brings the old answer back fails
 * here.
 */

import { describe, it, expect } from 'vitest';
import {
  BoxTokenProvider,
  DropboxTokenProvider,
  GoogleTokenProvider,
  type TokenFetch,
} from '@openmig/connectors';
import { NOT_AN_ERROR_DOCUMENT, failureAnswers, failureInOurWords } from './failure-answer.ts';

const refusing =
  (status: number, body: string): TokenFetch =>
  async () => ({ ok: false, status, text: async () => body });

async function messageOf(pending: Promise<unknown>): Promise<string> {
  const thrown = await pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(Error);
  return (thrown as Error).message;
}

/** Google's answer to a refresh token it no longer honours, as it sends it. */
const GOOGLE_EXPIRED = '{\n  "error": "invalid_grant",\n  "error_description": "Token has been expired or revoked."\n}';

const google = (body: string) =>
  new GoogleTokenProvider(
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'rt' },
    { fetchImpl: refusing(400, body) },
  ).getToken();

describe("a token endpoint's refusal, in the rule's words", () => {
  it("Google's invalid_grant: our hint and Google's own words, in a run's log line", async () => {
    const message = await messageOf(google(GOOGLE_EXPIRED));
    // The worker's line for a data type that failed (`run-delta-sync.ts`).
    const said = failureInOurWords(`contacts sync failed: ${message}`);
    expect(said).not.toContain(NOT_AN_ERROR_DOCUMENT);
    expect(said).toContain('seven days');
    expect(said.endsWith('Google answered (400): invalid_grant — Token has been expired or revoked.')).toBe(true);
  });

  it('the same line on a run, which carries no side and is always said by the rule', async () => {
    const message = await messageOf(google(GOOGLE_EXPIRED));
    const answers = failureAnswers({ sourceTyped: false });
    const event = answers.event({ level: 'error', message: `contacts sync failed: ${message}`, at: '2026-11-15T12:54:00Z' });
    expect(event.message).toContain('invalid_grant — Token has been expired or revoked.');
    expect(event.message).not.toContain(NOT_AN_ERROR_DOCUMENT);
  });

  it.each([
    [
      'Box',
      () =>
        new BoxTokenProvider(
          { clientId: 'id', clientSecret: 'secret', subjectUserId: '12345' },
          { fetchImpl: refusing(400, '{"error":"unauthorized_client","error_description":"Unauthorized"}') },
        ).getToken(),
      'Admin Console',
      'Box answered (400): unauthorized_client — Unauthorized',
    ],
    [
      'Dropbox',
      () =>
        new DropboxTokenProvider(
          { appKey: 'key', appSecret: 'secret', refreshToken: 'rt' },
          { fetchImpl: refusing(400, '{"error": "invalid_grant", "error_description": "refresh token is invalid or revoked"}') },
        ).getToken(),
      'unlinked',
      'Dropbox answered (400): invalid_grant — refresh token is invalid or revoked',
    ],
  ])('%s: its hint and its words', async (_provider, refuse, hint, ending) => {
    const said = failureInOurWords(await messageOf(refuse()));
    expect(said).toContain(hint);
    expect(said.endsWith(ending)).toBe(true);
  });

  it("an answer that is no document is still said by the rule, after the provider's hint", async () => {
    // A proxy's HTML page where the token endpoint should be: our hint names
    // no cause for it, and the page itself is not repeated.
    const message = await messageOf(google('<html><body>an-internal-admin-page-7f3a invalid_grant</body></html>'));
    const said = failureInOurWords(message);
    expect(said).not.toContain('an-internal-admin-page-7f3a');
    expect(said.endsWith(`Google answered (400): ${NOT_AN_ERROR_DOCUMENT}`)).toBe(true);
  });

  it('a line stored before the hint moved keeps the old answer: the body was not the last thing in it', () => {
    // What the OTA stack's rows hold until the next pass fails with the new
    // order. Nothing rewrites them, and the rule reads them as it did.
    const before =
      'contacts sync failed: Google refused the token request (400): {"error":"invalid_grant"} — "invalid_grant" from Google means the refresh token is no longer usable.';
    expect(failureInOurWords(before)).toBe(
      `contacts sync failed: Google refused the token request (400): ${NOT_AN_ERROR_DOCUMENT}`,
    );
  });
});
