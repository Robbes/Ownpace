// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOGIN THE SERVER REFUSED, TOLD FROM EVERY OTHER FAILURE (workplan 0174
 * §5.4, the owner's D4 of 2026-11-25, T3).
 *
 * A person's grant link counts a try only when the server refused the
 * credentials; a down server, a certificate, a 404 at the owner's DAV
 * address or a timeout must never count, or the person is locked out for
 * somebody else's fault. The probe marks the one case (`refusedLogin`), read
 * from the error itself, never from a message's words.
 */

import { describe, it, expect } from 'vitest';
import { RemoteRefusal } from '@openmig/shared';
import { loginWasRefused } from './probe-connection.ts';

/** imapflow's LOGIN refusal, as `commands/login.js` sets it, wrapped as the IMAP source wraps it. */
function imapLoginRefused(): Error {
  const raw = Object.assign(new Error('Command failed'), {
    responseStatus: 'NO',
    responseText: 'Invalid credentials',
    serverResponseCode: 'AUTHENTICATIONFAILED',
    authenticationFailed: true,
  });
  return new RemoteRefusal('The IMAP server refused: NO Invalid credentials', { protocol: 'imap' }, { cause: raw });
}

describe('loginWasRefused', () => {
  it('is yes for an IMAP NO to LOGIN, and for a 401 from a DAV or JMAP server', () => {
    expect(loginWasRefused(imapLoginRefused())).toBe(true);
    expect(loginWasRefused(new RemoteRefusal('PROPFIND failed with status 401', { protocol: 'dav', status: 401 }))).toBe(true);
    expect(loginWasRefused(new RemoteRefusal('session 401', { protocol: 'jmap', status: 401 }))).toBe(true);
    // The response code alone, as an older imapflow sets it.
    expect(loginWasRefused(Object.assign(new Error('Command failed'), { serverResponseCode: 'AUTHENTICATIONFAILED' }))).toBe(true);
  });

  it('is no for everything that is not the server judging the credentials', () => {
    expect(loginWasRefused(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toBe(false);
    expect(loginWasRefused(Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }))).toBe(false);
    expect(loginWasRefused(new RemoteRefusal('PROPFIND failed with status 404', { protocol: 'dav', status: 404 }))).toBe(false);
    expect(loginWasRefused(new RemoteRefusal('PROPFIND failed with status 403', { protocol: 'dav', status: 403 }))).toBe(false);
    // A server that says the words, without the code: not judged from words.
    expect(loginWasRefused(new Error('authentication failed somewhere in a page'))).toBe(false);
    // A NO to some other command than LOGIN carries no such mark.
    const select = Object.assign(new Error('Command failed'), { responseStatus: 'NO', responseText: '[NONEXISTENT] Unknown Mailbox' });
    expect(loginWasRefused(new RemoteRefusal('The IMAP server refused', { protocol: 'imap' }, { cause: select }))).toBe(false);
    expect(loginWasRefused(undefined)).toBe(false);
    expect(loginWasRefused('401')).toBe(false);
  });
});
