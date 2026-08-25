// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PLACEHOLDER WITH NO WAY TO FILL IT.
 *
 * `docs/managed-bring-up.md` §8c is the recipe for appointing the first
 * operator, and until 2026-08-25 it read, in full:
 *
 *     curl -fsS -H "Authorization: Bearer <token>" http://localhost:3001/api/me
 *
 * Every other step in that section is complete. This one asks for a credential
 * and the document never says, anywhere, how to obtain one — `<token>` appears
 * twice and is explained neither time.
 *
 * IT IS THE STEP NOBODY CAN SKIP. Without an operator the access queue is
 * readable by nobody, so a deployment with a working sign-in still cannot let
 * anybody in; and the subject that has to be appointed is only knowable by
 * asking the API, which needs the token. The whole bring-up funnels through
 * this one unexplained angle bracket.
 *
 * AND THE OBVIOUS GUESS IS WRONG, which is what turns a pause into a wrong
 * turn. "Get a token from the identity provider" produces an ACCESS token;
 * the app sends the **ID** token (`completeSignIn` returns `id_token`) and the
 * API validates that one. The access token is refused — and the refusal reads
 * as a botched appointment rather than as the wrong kind of credential, so the
 * reader goes back and redoes the step that was never the problem.
 *
 * WHY THIS RULE IS SCOPED TO ONE FILE, unlike `pasteable-hints`. Two other
 * documents contain `Bearer <token>`: a workplan describing what the DAV
 * connectors mint, which is prose about code and not an instruction, and
 * `operator-runbook.md`, whose sentence is "use each PRINTED token" — a token
 * whose origin is the line above it. Widening this to every occurrence would
 * mean matching a vocabulary of ways to say "where it came from" rather than
 * a property, and a rule that guesses at phrasing fails on correct documents.
 * The property here is exact: this recipe asks for a token, so this recipe
 * says where the token is.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bringUp = readFileSync(join(ROOT, 'docs/managed-bring-up.md'), 'utf8');

describe('the first-operator recipe says where its credential comes from', () => {
  const FIRST_ASK = bringUp.indexOf('Bearer <token>');

  it('still asks for a token, or this rule has lost its subject', () => {
    expect(
      FIRST_ASK,
      'docs/managed-bring-up.md no longer contains `Bearer <token>`. If the\n' +
        'recipe changed shape, rewrite this rule for the new one rather than\n' +
        'deleting it — the gap it was written for is a step nobody can skip.',
    ).toBeGreaterThan(-1);
  });

  /**
   * NEAR IT, NOT MERELY PRESENT. `a-refusal-that-named-no-remedy` is about the
   * same failure in the other direction: the remedy for that seed refusal DID
   * exist in this very document, in a troubleshooting table, findable only by
   * somebody who already suspected the cause. An answer that far from the
   * question is an answer nobody reaches, so the window is deliberately small.
   */
  const WINDOW = 1500;

  it('explains the token where it asks for it', () => {
    const nearby = bringUp.slice(0, FIRST_ASK) + bringUp.slice(FIRST_ASK, FIRST_ASK + WINDOW);
    expect(
      nearby,
      'the appointment recipe asks for `Bearer <token>` and does not say where\n' +
        `to get one within ${WINDOW} characters of asking.\n\n` +
        'This is the step that gates every other one: no operator means the\n' +
        'access queue is readable by nobody, and the subject to appoint can\n' +
        'only be learnt by making this very call.\n\n' +
        'Name the storage key. The web app keeps it in localStorage under\n' +
        '`auth_token` after signing in.',
    ).toContain('auth_token');
  });

  it('says which of the two tokens it means', () => {
    const nearby = bringUp.slice(FIRST_ASK, FIRST_ASK + WINDOW);
    expect(
      nearby,
      'the recipe names `auth_token` but not what kind of token it is.\n\n' +
        'The app sends the OIDC ID token — `completeSignIn` returns `id_token`\n' +
        '— and the API validates that one. Somebody who reasonably reaches for\n' +
        'an ACCESS token from the same provider and the same account gets a\n' +
        'refusal that reads as a failed appointment, and goes back to redo the\n' +
        'step that was never wrong. Say which token, so the wrong one is not\n' +
        'the obvious guess.',
    ).toMatch(/ID token|id_token/);
  });
});
