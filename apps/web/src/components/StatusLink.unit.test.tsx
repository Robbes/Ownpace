// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The status link derives its address from the one in the browser's bar, so
 * this pins the derivation AND the refusal — the refusal being the half that
 * matters, because a link to a status page that does not exist answers
 * "is it down" with a browser error.
 */

import { describe, it, expect } from 'vitest';
import { statusUrlFor } from './StatusLink.tsx';

describe('the status link derives its host from this one', () => {
  it.each([
    ['app.ota.ownpace.eu', 'https:', 'https://status.ota.ownpace.eu'],
    ['app.ownpace.eu', 'https:', 'https://status.ownpace.eu'],
    // The scheme comes along: a stack served over http gets an http sibling
    // rather than a certificate error.
    ['app.internal.example', 'http:', 'http://status.internal.example'],
  ])('%s → %s', (host, protocol, expected) => {
    expect(statusUrlFor(host, protocol)).toBe(expected);
  });

  it.each([
    // Every one of these is a host somebody really runs the app on, and every
    // one of them would get a dead link if this guessed.
    ['localhost'],
    ['127.0.0.1'],
    ['ownpace.eu'],
    ['ota.ownpace.eu'],
    // `app.` with nothing after it has no sibling to point at.
    ['app.localhost'],
    ['app.'],
  ])('renders nothing for %s', (host) => {
    expect(
      statusUrlFor(host, 'https:'),
      `${host} produced a link; a status page that does not exist is worse than no link`,
    ).toBeNull();
  });
});
