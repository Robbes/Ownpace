// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What a provider answered, read from each shape the connectors put a status
 * into a message (2026-11-25). Graph's `what: 403 - words` lost its words on
 * the first build of this module, and only a face test noticed; each shape is
 * pinned here instead.
 */

import { describe, expect, it } from 'vitest';
import { RemoteRefusal } from './remote-refusal.ts';
import {
  isTemporaryFailure,
  plainFailureText,
  providerAnswerFromError,
  providerAnswerFromResponse,
  withoutABody,
  type NoAnswerCause,
} from './provider-answer.ts';

/** undici's shape: a `TypeError` *fetch failed*, with the network's code on its cause. */
function fetchFailed(code?: string): TypeError {
  const err = new TypeError('fetch failed');
  return code === undefined ? err : Object.assign(err, { cause: Object.assign(new Error(`connect ${code}`), { code }) });
}

describe('providerAnswerFromError, by the connectors’ shapes', () => {
  it.each([
    ['DAV', 'PROPFIND failed with status 403: accessNotConfigured — CalDAV API off', 403, 'accessNotConfigured — CalDAV API off'],
    ['Drive', 'Drive API 403 for https://www.googleapis.com/drive/v3/files: insufficientPermissions — no', 403, 'insufficientPermissions — no'],
    ['Tasks', 'Google Tasks: listing task lists (404): notFound — gone', 404, 'notFound — gone'],
    ['Graph', 'listing calendars: 403 - ErrorAccessDenied — Access is denied.', 403, 'ErrorAccessDenied — Access is denied.'],
    ['Dropbox', 'Dropbox answered 409 on /x: path/not_found/', 409, 'path/not_found/'],
  ])('%s', (_who, message, status, words) => {
    expect(providerAnswerFromError(new Error(message), 'P')).toEqual({ kind: 'answered', provider: 'P', status, words });
  });

  it('never carries a body as words', () => {
    expect(providerAnswerFromError(new Error('PROPFIND failed with status 404: <html><body>x</body></html>'), 'P')).toEqual({
      kind: 'answered',
      provider: 'P',
      status: 404,
    });
    expect(providerAnswerFromError(new Error('listing: 400 - {"weird":1}'), 'P')).toEqual({ kind: 'answered', provider: 'P', status: 400 });
  });

  it('reads a RemoteRefusal’s parts, and a status on the error', () => {
    const refusal = new RemoteRefusal('whole text', { protocol: 'dav', status: 502 });
    expect(providerAnswerFromError(refusal, 'Google')).toEqual({ kind: 'answered', provider: 'Google', status: 502 });
    expect(providerAnswerFromError(Object.assign(new Error('x'), { status: 429 }), 'Box')).toEqual({ kind: 'answered', provider: 'Box', status: 429 });
  });

  it('is undefined for a failure with no status', () => {
    expect(providerAnswerFromError(new Error('connect ECONNREFUSED'), 'P')).toBeUndefined();
  });
});

describe('nothing answered at all: the network (the managed test environment, 2026-11-25)', () => {
  it.each([
    ['ECONNRESET', 'cut'],
    ['UND_ERR_SOCKET', 'cut'],
    ['ECONNREFUSED', 'refused'],
    ['ETIMEDOUT', 'timedOut'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timedOut'],
    ['UND_ERR_HEADERS_TIMEOUT', 'timedOut'],
    ['ENOTFOUND', 'notFound'],
    ['EAI_AGAIN', 'notFound'],
    ['ENETUNREACH', 'noRoute'],
  ])('fetch failed with %s under it', (code, cause) => {
    expect(providerAnswerFromError(fetchFailed(code), 'Google')).toEqual({ kind: 'unreachable', provider: 'Google', cause });
  });

  it('reads a code on the error itself, and AbortSignal.timeout’s TimeoutError', () => {
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(providerAnswerFromError(reset, 'Microsoft')).toEqual({ kind: 'unreachable', provider: 'Microsoft', cause: 'cut' });
    const late = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(providerAnswerFromError(late, 'Dropbox')).toEqual({ kind: 'unreachable', provider: 'Dropbox', cause: 'timedOut' });
  });

  it('a bare fetch failed, with nothing under it, is the network with no cause', () => {
    expect(providerAnswerFromError(fetchFailed(), 'Google')).toEqual({ kind: 'unreachable', provider: 'Google' });
  });

  it('a certificate or a refusal of ours under fetch failed is not the network', () => {
    expect(providerAnswerFromError(fetchFailed('CERT_HAS_EXPIRED'), 'Google')).toBeUndefined();
    expect(providerAnswerFromError(fetchFailed('host_inside_our_network'), 'Google')).toBeUndefined();
  });

  it('is temporary, as a 5xx is', () => {
    expect(isTemporaryFailure({ kind: 'unreachable', provider: 'Google' })).toBe(true);
    expect(isTemporaryFailure({ kind: 'answered', provider: 'Google', status: 403 })).toBe(false);
  });
});

describe('the sentences, both languages', () => {
  it('a 5xx or 429 is temporary, with no words', () => {
    expect(plainFailureText(providerAnswerFromResponse('Google', 503, '<html>x</html>'))).toEqual({
      en: 'Google had a temporary error (503). Test again in a minute.',
      nl: 'Google had een tijdelijke fout (503). Test over een minuut opnieuw.',
    });
  });

  it('a status with nothing readable says a plain reason', () => {
    expect(plainFailureText(providerAnswerFromResponse('Dropbox', 401, '<html>x</html>'))).toEqual({
      en: 'Dropbox answered 401: the sign-in was not accepted.',
      nl: 'Dropbox antwoordde 401: de aanmelding is niet aanvaard.',
    });
  });

  it('nothing answered says why in plain words, and to test again', () => {
    expect(plainFailureText({ kind: 'unreachable', provider: 'Google', cause: 'cut' })).toEqual({
      en: 'Google could not be reached just now (the connection was cut off). Test again in a minute.',
      nl: 'Google was zojuist niet bereikbaar (de verbinding werd verbroken). Test over een minuut opnieuw.',
    });
    expect(plainFailureText({ kind: 'unreachable', provider: 'Google' })).toEqual({
      en: 'Google could not be reached just now. Test again in a minute.',
      nl: 'Google was zojuist niet bereikbaar. Test over een minuut opnieuw.',
    });
  });

  it('every reason nothing answered has words in both languages, never the code', () => {
    const causes: NoAnswerCause[] = ['cut', 'refused', 'timedOut', 'notFound', 'noRoute'];
    for (const cause of causes) {
      const text = plainFailureText({ kind: 'unreachable', provider: 'P', cause });
      expect(text.en).toMatch(/^P could not be reached just now \([a-z][a-z ]+\)\. Test again in a minute\.$/);
      expect(text.nl).toMatch(/^P was zojuist niet bereikbaar \([a-z][a-z ]+\)\. Test over een minuut opnieuw\.$/);
    }
  });

  it('caps a body that is not one', () => {
    const text = plainFailureText(providerAnswerFromResponse('Google', 400, 'x'.repeat(5000))).en;
    expect(text.length).toBeLessThan(340);
  });

  it('withoutABody cuts where markup or JSON begins', () => {
    expect(withoutABody('boom: <!DOCTYPE html><html>')).toBe('boom');
    expect(withoutABody('<html>')).toBe('no reason was given');
  });
});
