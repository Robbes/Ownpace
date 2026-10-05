// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A STORED FAILURE, IN OUR WORDS (workplan 0136 T3, the second step).
 *
 * `failureInOurWords` is the rule of T3's first step, read off a failure's
 * stored text instead of off the error that made it: the error is gone by the
 * time a route answers, and the ledger keeps only its message. Each case below
 * is a message in the shape a real throw site writes it. The routes' own guard
 * is `routes/migrations/a-failure-said-in-our-words.unit.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { DiscoveryRecord, ItemFailure, MigrationStatus, RunEventReport } from '@openmig/shared';
import { failureAnswers, failureInOurWords, sourceNamesItsHost } from './failure-answer.ts';

const MARKER = 'an-internal-admin-page-7f3a';
const HTML = `<html><head><title>${MARKER}</title></head><body>${MARKER}</body></html>`;
const NOT_A_DOCUMENT = 'the server answered with something that is not a DAV, JMAP or IMAP error.';

describe('a body that is no error document we know', () => {
  it.each([
    [
      'a writer that could not make the folder',
      `Could not create the target folder /in (targetFolderPrefix): MKCOL answered 403: ${HTML}`,
      `Could not create the target folder /in (targetFolderPrefix): MKCOL answered 403: ${NOT_A_DOCUMENT}`,
    ],
    [
      'a writer that would not call an answer "not present"',
      'PROPFIND on /x.ics failed; refusing to treat this as "not present", because a write or an ' +
        `adoption would then rest on an answer the server never gave. Cause: status 500: ${HTML}`,
      'PROPFIND on /x.ics failed; refusing to treat this as "not present", because a write or an ' +
        `adoption would then rest on an answer the server never gave. Cause: status 500: ${NOT_A_DOCUMENT}`,
    ],
    [
      'a piece of a chunked upload',
      `PUT failed for /f.bin (piece 2 of 3, 10 bytes, Nextcloud chunked upload) with status 507: ${HTML}`,
      `PUT failed for /f.bin (piece 2 of 3, 10 bytes, Nextcloud chunked upload) with status 507: ${NOT_A_DOCUMENT}`,
    ],
    [
      'a JMAP upload',
      `vCard blob upload failed: HTTP 500 - ${HTML}`,
      `vCard blob upload failed: HTTP 500 - ${NOT_A_DOCUMENT}`,
    ],
    [
      'a JMAP call answered with JSON of another kind',
      'JMAP Email/set failed: HTTP 500 - unknown - no description',
      `JMAP Email/set failed: HTTP 500 - ${NOT_A_DOCUMENT}`,
    ],
    [
      'a byte-range read of an archive',
      `https://dav.example.invalid/t.zip answered 206 to a byte-range request: ${MARKER}`,
      `https://dav.example.invalid/t.zip answered 206 to a byte-range request: ${NOT_A_DOCUMENT}`,
    ],
    [
      'a status in a file name before the real one',
      `PUT failed for /a/report (500).pdf with status 403: ${HTML}`,
      `PUT failed for /a/report (500).pdf with status 403: ${NOT_A_DOCUMENT}`,
    ],
    [
      'a status with no answer on its line, and one after it',
      `MKCOL answered 405 (it is there)\nPUT failed for /x with status 500: ${HTML}`,
      `MKCOL answered 405 (it is there)\nPUT failed for /x with status 500: ${NOT_A_DOCUMENT}`,
    ],
    [
      'a pass that stopped on it',
      `contact: 25 items failed in a row. Last error: DELETE https://dav.example.invalid/x failed with status 500: ${MARKER}`,
      `contact: 25 items failed in a row. Last error: DELETE https://dav.example.invalid/x failed with status 500: ${NOT_A_DOCUMENT}`,
    ],
  ])('%s', (_what, stored, answered) => {
    expect(failureInOurWords(stored)).toBe(answered);
  });
});

describe('a status a server chose outside 1xx to 5xx (review of the second step)', () => {
  // Node's fetch passes any three-digit status through, and the server picks it.
  it.each(['600', '999'])('%s', (status) => {
    expect(failureInOurWords(`PUT failed for /a.pdf with status ${status}: ${HTML}`)).toBe(
      `PUT failed for /a.pdf with status ${status}: ${NOT_A_DOCUMENT}`,
    );
  });
});

describe('a body that only starts like a stored form (review of the second step)', () => {
  it.each([
    ['a GData code, then a page', `error — ${HTML}`],
    ['a Sabre class, then a page', `Foo\\Bar — ${HTML}`],
    ['a JMAP type, then a page', `urn:ietf:params:jmap:error:x ${HTML}`],
    ['a JMAP type, a separator, then a page', `urn:ietf:params:jmap:error:x - ${HTML}`],
    ['a Sabre class, then words with no separator', `Foo\\Bar ${MARKER}`],
    ['a JMAP type, then words with no separator', `urn:ietf:params:jmap:error:x ${MARKER}`],
    ['a word, then words with no separator', `healthy ${MARKER}`],
    ['one word that is no GData code', 'healthy'],
    ['another', 'ok'],
  ])('%s', (_what, body) => {
    expect(failureInOurWords(`PUT failed for /x with status 500: ${body}`)).toBe(
      `PUT failed for /x with status 500: ${NOT_A_DOCUMENT}`,
    );
  });
});

describe('an error document of a kind we know keeps its words', () => {
  it('a GData refusal, as davRefusalBody leaves it', () => {
    const stored = 'PROPFIND failed with status 403: accessNotConfigured — CalDAV API has not been used in project 123.';
    expect(failureInOurWords(stored)).toBe(stored);
  });

  it('a GData code alone', () => {
    expect(failureInOurWords('PROPFIND failed with status 403: forbidden')).toBe('PROPFIND failed with status 403: forbidden');
  });

  it("a Sabre refusal, as davRefusalBody leaves it, and Nextcloud's own exception", () => {
    const sabre = 'PUT failed for /x.vcf with status 500: Sabre\\DAV\\Exception\\BadRequest — Invalid vCard';
    expect(failureInOurWords(sabre)).toBe(sabre);
    const nextcloud = 'MOVE failed for /f with status 423: OCA\\DAV\\Connector\\Sabre\\Exception\\FileLocked — locked';
    expect(failureInOurWords(nextcloud)).toBe(nextcloud);
  });

  it("Google's JSON error document, read for its status and message", () => {
    expect(
      failureInOurWords(
        'addressbook-query REPORT failed with status 400: { "error": { "code": 400, "message": ' +
          '"Request contains an invalid argument.", "status": "INVALID_ARGUMENT" } }',
      ),
    ).toBe('addressbook-query REPORT failed with status 400: INVALID_ARGUMENT — Request contains an invalid argument.');
  });

  it('a WebDAV error document, read for its conditions', () => {
    expect(
      failureInOurWords(
        'PUT failed for /x with status 403: <?xml version="1.0"?><d:error xmlns:d="DAV:"><d:need-privileges/></d:error>',
      ),
    ).toBe('PUT failed for /x with status 403: DAV:need-privileges');
  });

  it('a JMAP problem document, as both JMAP readers leave it', () => {
    const target = 'JMAP Email/set failed: HTTP 400 - urn:ietf:params:jmap:error:limit - too many objects';
    expect(failureInOurWords(target)).toBe(target);
    const session =
      'Unauthorized: JMAP session request to https://mail.example.invalid/.well-known/jmap returned HTTP 401 - ' +
      'urn:ietf:params:jmap:error:notRequest — bad request';
    expect(failureInOurWords(session)).toBe(session);
  });

  it('capped, as the Test button caps them', () => {
    const long = `Sabre\\DAV\\Exception — ${'word '.repeat(100)}`;
    const said = failureInOurWords(`PUT failed for /x with status 500: ${long}`);
    expect(said.length).toBeLessThan(360);
    expect(said.endsWith('…')).toBe(true);
  });
});

describe('what nothing answered, a certificate and the rule', () => {
  it('a socket error, without the name or the address it tried', () => {
    for (const stored of [`getaddrinfo ENOTFOUND ${MARKER}`, `connect ETIMEDOUT ${MARKER}:993`, `read ECONNRESET at ${MARKER}`]) {
      const said = failureInOurWords(stored);
      expect(said).toMatch(/^Nothing answered at that address/);
      expect(said).not.toContain(MARKER);
    }
  });

  it("a certificate, without the names it carries", () => {
    const said = failureInOurWords(
      `Hostname/IP does not match certificate's altnames: Host: mail.example.invalid. is not in the cert's altnames: DNS:${MARKER}`,
    );
    expect(said).toMatch(/^The server's certificate did not verify/);
    expect(said).not.toContain(MARKER);
  });

  it('the rule for a host a tenant gives us, without the host', () => {
    const said = failureInOurWords(
      `${MARKER}.example is an address inside this service's own network, so we do not connect to it. ` +
        'Give the address the server has on the internet.',
    );
    expect(said).toMatch(/^That address is inside this service's own network/);
    expect(said).not.toContain(MARKER);
  });

  it("a parser's quote of what it could not read", () => {
    const said = failureInOurWords(`Unexpected token '<', "<html><he"... is not valid JSON`);
    expect(said).toBe("Unexpected token '<' in an answer that is not valid JSON");
  });
});

describe("an IMAP server's line, capped (review of the second step)", () => {
  it('alone', () => {
    const said = failureInOurWords(`NO ${'x'.repeat(5000)}`);
    expect(said.startsWith('NO xxx')).toBe(true);
    expect(said.length).toBe(300);
    expect(said.endsWith('…')).toBe(true);
  });

  it('after our prose, which stays', () => {
    const said = failureInOurWords(`The IMAP server refused: NO ${'y'.repeat(5000)} (in answer to: SELECT INBOX)`);
    expect(said.startsWith('The IMAP server refused: NO yyy')).toBe(true);
    expect(said.length).toBe('The IMAP server refused: '.length + 300);
  });
});

describe('what reads as it was stored', () => {
  it.each([
    ['an IMAP NO', 'NO [OVERQUOTA] Mailbox is full'],
    ['a status with no body', 'PROPFIND answered 404'],
    ['our own refusal', 'The file is larger than one pass here may carry. Copy it by hand.'],
    ['the queue placeholder', '(no error recorded)'],
  ])('%s', (_what, stored) => {
    expect(failureInOurWords(stored)).toBe(stored);
  });
});

describe('whose host a source reaches', () => {
  it('a host somebody typed', () => {
    expect(sourceNamesItsHost('imap', { host: 'mail.example.invalid' })).toBe(true);
    expect(sourceNamesItsHost('o365', { host: 'outlook.example.invalid' })).toBe(true);
    expect(sourceNamesItsHost('caldav', { url: 'https://dav.example.invalid/' })).toBe(true);
    expect(sourceNamesItsHost('jmap', { baseUrl: 'https://mail.example.invalid' })).toBe(true);
    expect(sourceNamesItsHost('soverin', { mailHost: 'imap.example.invalid' })).toBe(true);
    expect(sourceNamesItsHost('archive', { where: 'target', path: '/t' })).toBe(true);
  });

  it("a provider's fixed host", () => {
    for (const kind of ['gmail', 'google', 'google_drive', 'microsoft', 'dropbox', 'box', 'apple']) {
      expect(sourceNamesItsHost(kind, {}), kind).toBe(false);
    }
    expect(sourceNamesItsHost('o365', { host: '' })).toBe(false);
  });

  it('a source nobody could read is taken as typed', () => {
    expect(sourceNamesItsHost(undefined, {})).toBe(true);
  });
});

describe('which failures the rule reaches', () => {
  const stored = `PUT failed for /x with status 500: ${HTML}`;
  const item = (category?: ItemFailure['category']): ItemFailure => ({
    domain: 'contact',
    naturalKeyHash: 'h',
    attempts: 5,
    lastError: stored,
    needsDecision: true,
    ...(category ? { category } : {}),
  });
  const status = (failedSide?: 'source' | 'target', category?: MigrationStatus['lastErrorCategory']): MigrationStatus =>
    ({
      id: 's',
      tenantId: 't',
      mappingId: 'm',
      domain: 'contact',
      state: 'failed',
      itemsSynced: 0,
      itemsFailed: 1,
      bytesTransferred: 0,
      startedAt: '',
      updatedAt: '',
      lastError: stored,
      ...(failedSide ? { failedSide } : {}),
      ...(category ? { lastErrorCategory: category } : {}),
    }) as MigrationStatus;
  const discovery: DiscoveryRecord = {
    domain: 'email',
    collections: 0,
    items: 0,
    bytes: 0,
    discoveredAt: '',
    lastError: stored,
  } as DiscoveryRecord;
  const event: RunEventReport = { level: 'error', message: `contact sync failed: ${stored}`, at: '' };

  it('everything, when both hosts were typed', () => {
    const said = failureAnswers({ sourceTyped: true });
    for (const c of ['target_refused', 'source_refused', 'network', 'unknown', undefined] as const) {
      expect(said.item(item(c)).lastError, String(c)).toContain(NOT_A_DOCUMENT);
    }
    expect(said.status(status('source')).lastError).toContain(NOT_A_DOCUMENT);
    expect(said.status(status()).lastError).toContain(NOT_A_DOCUMENT);
    expect(said.discovery(discovery).lastError).toContain(NOT_A_DOCUMENT);
    expect(said.event(event).message).toContain(NOT_A_DOCUMENT);
  });

  it("not a source's own refusal when the source is a provider's fixed host", () => {
    const said = failureAnswers({ sourceTyped: false });
    expect(said.item(item('source_refused')).lastError).toBe(stored);
    expect(said.status(status('source')).lastError).toBe(stored);
    expect(said.discovery(discovery).lastError).toBe(stored);
    // The target's host was typed, and a failure of either side may be its.
    expect(said.item(item('target_refused')).lastError).toContain(NOT_A_DOCUMENT);
    expect(said.item(item('network')).lastError).toContain(NOT_A_DOCUMENT);
    expect(said.status(status('target')).lastError).toContain(NOT_A_DOCUMENT);
    expect(said.status(status()).lastError).toContain(NOT_A_DOCUMENT);
    expect(said.event(event).message).toContain(NOT_A_DOCUMENT);
  });

  it('not a refusal of our own, whatever the hosts', () => {
    const said = failureAnswers({ sourceTyped: true });
    expect(said.item(item('policy_refused')).lastError).toBe(stored);
    expect(said.item(item('too_large')).lastError).toBe(stored);
    expect(said.status(status(undefined, 'policy_refused')).lastError).toBe(stored);
  });

  it('nothing but the text, and nothing on a row without one', () => {
    const said = failureAnswers({ sourceTyped: true });
    const { lastError: _a, ...rest } = said.item(item('target_refused'));
    const { lastError: _b, ...was } = item('target_refused');
    expect(rest).toEqual(was);
    const quiet = { ...status('target') };
    delete (quiet as { lastError?: string }).lastError;
    expect(said.status(quiet)).toEqual(quiet);
  });
});
