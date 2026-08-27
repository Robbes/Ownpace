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
  it('is exactly the six the owner accepted', () => {
    // Adding a seventh is a product decision, not a refactor: the test the
    // owner set was "does it change what you do next".
    expect([...FAILURE_CATEGORIES]).toEqual([
      'auth_expired',
      'rate_limited',
      'quota_exceeded',
      'target_refused',
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
    const reached = new Set(
      [
        'invalid_grant',
        '429 too many requests',
        'daily limit exceeded',
        '403 Forbidden',
        'ECONNREFUSED',
      ].map(classifyFailure),
    );
    for (const c of FAILURE_CATEGORIES) {
      if (c === 'unknown') continue;
      expect(reached, `${c} is not reachable from any message`).toContain(c);
    }
  });
});
