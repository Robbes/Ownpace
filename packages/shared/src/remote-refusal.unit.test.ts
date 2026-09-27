// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH WORDS OF A REFUSAL MAY BE REPEATED, AND WHAT A FAILURE COMES TO
 * (workplan 0136 T3).
 *
 * `providerErrorWords` is the whole of what the managed Test button may repeat
 * of a body a host a tester typed sent back: the words of an error document of
 * a kind we know, as the document itself, capped. Everything else is nothing.
 * `whatHappened` sorts a failure into the parts an answer is built from, and
 * never lets the message, the body or an address through.
 */

import { describe, it, expect } from 'vitest';
import {
  HOST_INSIDE_OUR_NETWORK,
  PROVIDER_WORDS_CAP,
  RemoteRefusal,
  davRefusalParts,
  imapRefusalWords,
  jmapRefusalBody,
  jmapRefusalParts,
  providerErrorWords,
  whatHappened,
} from './remote-refusal.ts';
import { HostInsideOurNetwork, reachableHost, refuseInternalAddresses, tenantFetch } from './reachable-host.ts';

const GDATA_403 =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<errors xmlns="http://schemas.google.com/g/2005"><error><domain>GData</domain>' +
  '<code>accessNotConfigured</code><internalReason>CalDAV API has not been used in project 1 ' +
  'before or it is disabled.</internalReason></error></errors>';

const SABRE_500 =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">\n' +
  '  <s:sabredav-version>4.6.0</s:sabredav-version>\n' +
  '  <s:exception>Sabre\\DAV\\Exception</s:exception>\n' +
  '  <s:message>An exception occurred while executing a query</s:message>\n' +
  '</d:error>';

const GOOGLE_JSON_400 = JSON.stringify({
  error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' },
});

describe('the words of an error document we know, and of nothing else', () => {
  it.each([
    ['a GData refusal: its code and its reason', GDATA_403, 'accessNotConfigured — CalDAV API has not been used in project 1 before or it is disabled.'],
    ["Sabre's: its exception and its message", SABRE_500, 'Sabre\\DAV\\Exception — An exception occurred while executing a query'],
    [
      'a plain WebDAV error: the conditions it names',
      '<?xml version="1.0"?><D:error xmlns:D="DAV:"><D:need-privileges><D:resource/></D:need-privileges></D:error>',
      'DAV:need-privileges, DAV:resource',
    ],
    ['a WebDAV error that names none', "<error xmlns='DAV:'/>", 'DAV:error'],
    ["Google's JSON error document", GOOGLE_JSON_400, 'INVALID_ARGUMENT — Request contains an invalid argument.'],
    [
      'a JMAP problem document',
      JSON.stringify({ type: 'urn:ietf:params:jmap:error:limit', status: 400, detail: 'Too many calls.' }),
      'urn:ietf:params:jmap:error:limit — Too many calls.',
    ],
  ])('%s', (_what, body, words) => {
    expect(providerErrorWords(body)).toBe(words);
  });

  it.each([
    ['an HTML error page', '<!doctype html><html><body><h1>500</h1><p>stack trace here</p></body></html>'],
    ['an HTML page that CARRIES a GData document inside it', `<html><body><pre>${GDATA_403}</pre></body></html>`],
    ['an HTML page that carries a Sabre document inside it', `<html><body>${SABRE_500}</body></html>`],
    ['an XML document whose root is not an error', '<?xml version="1.0"?><config><secret>x</secret></config>'],
    ['an `error` root that is not WebDAV\'s', '<error xmlns="urn:example:admin"><secret>x</secret></error>'],
    ['JSON of another shape', JSON.stringify({ service: 'admin', version: '9.1', token: 'x' })],
    ['an `error` object without Google\'s three fields', JSON.stringify({ error: { message: 'db password wrong' } })],
    ['Google\'s fields with a status in no canonical form', JSON.stringify({ error: { code: 500, message: 'x', status: 'internal' } })],
    ['Google\'s fields without the code', JSON.stringify({ error: { message: 'x', status: 'PERMISSION_DENIED' } })],
    ['a problem document outside JMAP', JSON.stringify({ type: 'about:blank', detail: 'x' })],
    ['plain text', 'Forbidden: you are not on the office network'],
    ['nothing', ''],
    ['JSON that does not parse', '{"error":'],
  ])('%s: nothing', (_what, body) => {
    expect(providerErrorWords(body)).toBeUndefined();
  });

  it(`caps the words at ${PROVIDER_WORDS_CAP} characters and flattens their white space`, () => {
    const long = JSON.stringify({ type: 'urn:ietf:params:jmap:error:limit', detail: `a\n\n  b ${'x'.repeat(1000)}` });
    const words = providerErrorWords(long) ?? '';
    expect(words).toHaveLength(PROVIDER_WORDS_CAP);
    expect(words.endsWith('…')).toBe(true);
    expect(words).toContain('— a b x');
  });
});

describe('the parts a refusal carries', () => {
  it('a DAV refusal: its status, and its words when it sent a document we know', () => {
    expect(davRefusalParts({ status: 403, body: GDATA_403 })).toEqual({
      protocol: 'dav',
      status: 403,
      providerWords: 'accessNotConfigured — CalDAV API has not been used in project 1 before or it is disabled.',
    });
    expect(davRefusalParts({ status: 500, body: '<html>secret</html>' })).toEqual({ protocol: 'dav', status: 500 });
  });

  it('a JMAP refusal the same way, and its message keeps the body as the operator read it', () => {
    const problem = JSON.stringify({ type: 'urn:ietf:params:jmap:error:limit', detail: 'Too many.' });
    expect(jmapRefusalParts({ status: 429, body: problem })).toEqual({
      protocol: 'jmap',
      status: 429,
      providerWords: 'urn:ietf:params:jmap:error:limit — Too many.',
    });
    expect(jmapRefusalParts({ status: 502, body: '<html>proxy</html>' })).toEqual({ protocol: 'jmap', status: 502 });
    expect(jmapRefusalBody(problem)).toBe('urn:ietf:params:jmap:error:limit — Too many.');
    const page = `<html>${'p'.repeat(400)}</html>`;
    expect(jmapRefusalBody(page)).toBe(page.slice(0, 300));
  });

  it("an IMAP refusal: the server's NO or BAD line, and nothing for any other status", () => {
    expect(imapRefusalWords('NO', '[AUTHENTICATIONFAILED] Invalid credentials (Failure)')).toBe(
      'NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)',
    );
    expect(imapRefusalWords('BAD', undefined)).toBe('BAD');
    expect(imapRefusalWords('OK', 'fine')).toBeUndefined();
    expect(imapRefusalWords(undefined, 'text')).toBeUndefined();
  });
});

/** An error with a code, as Node and undici give one. */
function coded(code: string, message = `connect ${code} 10.0.0.9:8080`): Error {
  return Object.assign(new Error(message), { code });
}

describe('what a failure comes to', () => {
  it('a refusal: its parts, and never its message', () => {
    const refusal = new RemoteRefusal('PROPFIND failed with status 500: <html>secret</html>', {
      protocol: 'dav',
      status: 500,
    });
    expect(whatHappened(refusal)).toEqual({ kind: 'answered', protocol: 'dav', status: 500 });
    expect(whatHappened(new Error('wrapped', { cause: new Error('again', { cause: refusal }) }))).toEqual({
      kind: 'answered',
      protocol: 'dav',
      status: 500,
    });
    const imap = new RemoteRefusal('The IMAP server refused: NO x (in answer to: 2 LOGIN)', {
      protocol: 'imap',
      providerWords: 'NO x',
    });
    expect(whatHappened(imap)).toEqual({ kind: 'answered', protocol: 'imap', providerWords: 'NO x' });
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT'])(
    '%s under fetch: unreachable, with no address',
    (code) => {
      const failed = new TypeError('fetch failed', { cause: coded(code) });
      expect(whatHappened(failed)).toEqual({ kind: 'unreachable' });
    },
  );

  it.each(['DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT'])(
    '%s: a certificate',
    (code) => {
      expect(whatHappened(new Error('wrapped for the operator', { cause: coded(code) }))).toEqual({
        kind: 'certificate',
      });
    },
  );

  it("the rule's refusal, by its code, before anything else in the chain", () => {
    const rule = coded('host_inside_our_network', 'db.internal is an address inside this service’s own network');
    expect(whatHappened(rule)).toEqual({ kind: 'insideOurNetwork' });
    expect(whatHappened(new TypeError('fetch failed', { cause: rule }))).toEqual({ kind: 'insideOurNetwork' });
  });

  it('a refusal comes before a socket code further down its causes', () => {
    const refusal = new RemoteRefusal('x', { protocol: 'dav', status: 502 }, { cause: coded('ECONNRESET') });
    expect(whatHappened(refusal)).toEqual({ kind: 'answered', protocol: 'dav', status: 502 });
  });

  it('anything else: unknown, whatever its message says', () => {
    expect(whatHappened(new SyntaxError('Unexpected token \'<\', "<html><bo"... is not valid JSON'))).toEqual({
      kind: 'unknown',
    });
    expect(whatHappened('a string')).toEqual({ kind: 'unknown' });
    expect(whatHappened(undefined)).toEqual({ kind: 'unknown' });
  });
});

describe("the rule's own refusal (0136 T1), as the rule throws it", () => {
  it('its code is the one this module reads', () => {
    expect(new HostInsideOurNetwork('db.internal.example').code).toBe(HOST_INSIDE_OUR_NETWORK);
  });

  it('with the rule on, what tenantFetch and reachableHost throw reads as insideOurNetwork', async () => {
    const off = refuseInternalAddresses();
    try {
      const fetched = await tenantFetch('http://127.0.0.1:8080/').catch((error: unknown) => error);
      const opened = await reachableHost('127.0.0.1').catch((error: unknown) => error);
      for (const refused of [fetched, opened]) {
        expect(refused).toBeInstanceOf(HostInsideOurNetwork);
        expect(whatHappened(refused)).toEqual({ kind: 'insideOurNetwork' });
      }
    } finally {
      off();
    }
  });
});
