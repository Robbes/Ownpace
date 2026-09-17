// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The classifier, against messages the product has actually produced
 * (workplan 0110 T3).
 *
 * The fixtures below are real shapes, not invented ones: Google's
 * `invalid_grant` body, the IMAP `AUTHENTICATIONFAILED` response code, Node's
 * socket errors, and this product's own budget refusal. A classifier tested
 * only against strings written by its author classifies its author's
 * imagination.
 */

import { describe, it, expect } from 'vitest';
import {
  FAILURE_CATEGORIES,
  classifyFailure,
  isFailureCategory,
  type FailureSide,
} from './failure-category.ts';

describe('the credential no longer works', () => {
  it("recognises Google's invalid_grant, the seven-day trap's own words", () => {
    expect(
      classifyFailure(
        'Google refused the token request (400): {"error":"invalid_grant",' +
          '"error_description":"Token has been expired or revoked."}',
      ),
    ).toBe('auth_expired');
  });

  it('recognises the IMAP response code (RFC 5530), not just HTTP', () => {
    expect(classifyFailure('[AUTHENTICATIONFAILED] Invalid credentials (Failure)')).toBe(
      'auth_expired',
    );
  });

  it('recognises a bare 401 from a DAV target', () => {
    expect(classifyFailure('PROPFIND https://dav.example/cal/ failed: 401 Unauthorized')).toBe(
      'auth_expired',
    );
  });
});

describe('the provider asked us to slow down', () => {
  it('recognises a 429', () => {
    expect(classifyFailure('GET /messages failed: 429 Too Many Requests')).toBe('rate_limited');
  });

  it('BEATS auth when a message carries both — waiting is the right remedy', () => {
    // The case the ordering exists for: a 429 while refreshing a token
    // mentions both. Telling somebody to reconnect a working credential
    // sends them to do damage; telling them to wait costs a minute.
    expect(classifyFailure('429 rate limit refreshing token: invalid_grant retry later')).toBe(
      'rate_limited',
    );
  });
});

describe('a daily ceiling is spent', () => {
  it("recognises Gmail's daily limit", () => {
    expect(
      classifyFailure('Gmail IMAP: daily limit exceeded for this account, try again tomorrow'),
    ).toBe('quota_exceeded');
  });

  it("BEATS rate limiting — 'until tomorrow' and 'in a minute' are different instructions", () => {
    expect(classifyFailure('429: user rate limit exceeded — daily limit for this account')).toBe(
      'quota_exceeded',
    );
  });

  it("recognises this product's OWN refusal before the provider locks out (0090 T4)", () => {
    expect(
      classifyFailure(
        'refusing to start: this pass would exceed the 2500 MB bytes per day ceiling',
      ),
    ).toBe('quota_exceeded');
  });
});

describe('the network did not reach', () => {
  it.each([
    'connect ECONNREFUSED 10.0.0.4:993',
    'getaddrinfo ENOTFOUND imap.example.invalid',
    'socket hang up',
    'read ECONNRESET',
  ])('recognises %s', (message) => {
    expect(classifyFailure(message)).toBe('network');
  });
});

describe('the target refused the write', () => {
  it('recognises a 403 from a target', () => {
    expect(classifyFailure('PUT /remote.php/dav/ failed: 403 Forbidden')).toBe('target_refused');
  });

  it('recognises a full mailbox and insufficient storage', () => {
    expect(classifyFailure('APPEND failed: mailbox full')).toBe('target_refused');
    expect(classifyFailure('507 Insufficient Storage')).toBe('target_refused');
  });

  it('does NOT swallow an auth failure, being the broadest matcher', () => {
    // It sits last on purpose: anything above it is a better answer when both
    // fit. A 401 mentioning "rejected" must still read as auth.
    expect(classifyFailure('401 Unauthorized — the server rejected the credentials')).toBe(
      'auth_expired',
    );
  });
});

describe('unknown is an answer, not a gap', () => {
  it('returns unknown for prose nothing matches', () => {
    expect(classifyFailure('the frobnicator declined to frobnicate')).toBe('unknown');
  });

  it('never throws, whatever it is handed', () => {
    // This runs where a failure is ALREADY being recorded. A classifier that
    // threw would replace a useful error with a useless one.
    for (const input of [undefined, null, 42, {}, [], '', '   ', Symbol('x')]) {
      expect(() => classifyFailure(input)).not.toThrow();
      expect(classifyFailure(input)).toBe('unknown');
    }
  });
});

describe('the vocabulary itself', () => {
  it('is exactly the eight the owner accepted', () => {
    // Adding one is a product decision, not a refactor: the test the owner set
    // was "does it change what you do next". This pin is how that stays true —
    // it went red when the two refusals below were added, which is the point.
    //
    // The six became eight on 2026-09-17, on the owner's go-ahead, after a
    // live Drive refusal was shown to a customer as a target problem:
    // "yes, it also makes sense a target might refuse certain fileformats/
    // types and we need to be transparrant about that."
    //
    //   source_refused  the source would not hand it over, so the destination
    //                   is not the account to go and check
    //   format_refused  the destination will not take this KIND of file, which
    //                   is not the same instruction as "free up space"
    //
    // ORDER IS PART OF THE PIN. The two refusals sit together and in the
    // order a reader meets them — source first, because the question is always
    // "did it even get sent" before "was it accepted".
    expect([...FAILURE_CATEGORIES]).toEqual([
      'auth_expired',
      'rate_limited',
      'quota_exceeded',
      'source_refused',
      'target_refused',
      'format_refused',
      'network',
      'unknown',
    ]);
  });

  it('recognises its own members and nothing else', () => {
    for (const c of FAILURE_CATEGORIES) expect(isFailureCategory(c)).toBe(true);
    for (const junk of ['', 'AUTH_EXPIRED', 'provider_error', null, 7]) {
      expect(isFailureCategory(junk)).toBe(false);
    }
  });

  it('every category except unknown is reachable from some message', () => {
    // A category nothing can produce is a category that lies on the screen.
    //
    // Each case is (message, side) since 2026-09-17, because two of the eight
    // are only reachable WITH a side: the same 403 is a source refusal or a
    // target one depending on which closure threw it, and no wording tells
    // them apart. Written as an explicit arrow rather than `.map(classifyFailure)`
    // — which is how it read until the compiler refused it — because `.map`
    // passes the ARRAY INDEX as the second argument, so element 1 of any such
    // list would be classified with a side of `1`.
    const reached = new Set(
      (
        [
          ['invalid_grant', undefined],
          ['429 too many requests', undefined],
          ['daily limit exceeded', undefined],
          ['403 Forbidden', 'target'],
          ['403 Forbidden', 'source'],
          ['415 unsupported media type', 'target'],
          ['ECONNREFUSED', undefined],
        ] as ReadonlyArray<readonly [string, FailureSide | undefined]>
      ).map(([message, side]) => classifyFailure(message, side)),
    );
    for (const c of FAILURE_CATEGORIES) {
      if (c === 'unknown') continue;
      expect(reached, `${c} is not reachable from any message`).toContain(c);
    }
  });

  it('a bare `.map(classifyFailure)` cannot compile, and that is load-bearing', () => {
    // The hazard is quiet: `Array.prototype.map` calls back with
    // (value, index, array), so a bare reference would hand the classifier an
    // INDEX where the side goes. Element 0 would be classified unsided and
    // element 1 with side `1` — neither 'source' nor 'target', so every rule
    // would fall through to its target reading and nothing would look wrong.
    //
    // TypeScript refuses it because `number` is not assignable to
    // `FailureSide | undefined`, which is why the signature takes the union
    // and not a `string`. This test states the guarantee; the compiler holds
    // it, and `@ts-expect-error` fails the build if it ever stops holding.
    const messages = ['403 Forbidden', '403 Forbidden'];
    // @ts-expect-error — index is not a FailureSide, and must never become one
    const wrong = messages.map(classifyFailure);
    expect(wrong).toHaveLength(2);
  });
});
