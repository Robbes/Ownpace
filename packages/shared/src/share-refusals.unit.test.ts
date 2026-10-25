// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARE REFUSED, SAID IN OUR WORDS (workplan 0136 T3, a share's refusal on
 * apply). What the tester reads when the new system will not create a share:
 * our sentence, chosen by what failed, in English and in Dutch. Never the
 * server's words.
 */

import { describe, it, expect } from 'vitest';
import {
  NO_GRANTEE_TO_SHARE_WITH,
  SHARE_REFUSAL,
  retryAfterSecondsOf,
  shareLimitOf,
  shareRefusalKind,
  shareRefusalSaid,
  type ShareRefused,
} from './share-refusals.ts';

const answered = (status: number, ocsStatus?: number, ocs = true): ShareRefused => ({
  kind: 'answered',
  status,
  ocs,
  ...(ocsStatus === undefined ? {} : { ocsStatus }),
});

describe('which sentence a refusal gets', () => {
  it.each<[string, ShareRefused, keyof typeof SHARE_REFUSAL]>([
    ['a sign-in refused', answered(401, 997), 'signIn'],
    ['a sign-in refused by a proxy, not OCS', answered(401, undefined, false), 'signIn'],
    ['OCS 997 inside a 200', answered(200, 997), 'signIn'],
    ['the server’s own error', answered(500, 996), 'serverError'],
    ['a gateway’s page', answered(502, undefined, false), 'serverError'],
    ['something that is not Nextcloud', answered(404, undefined, false), 'notNextcloud'],
    ['an item or person not found', answered(404, 404), 'notFound'],
    ['a share refused', answered(403, 403), 'forbidden'],
    ['a request not accepted', answered(400, 400), 'badRequest'],
    ['any other status', answered(409, 409), 'other'],
    ['the target’s limit on new shares', answered(429, 429), 'limited'],
    ['a limit from a proxy, not OCS', answered(429, undefined, false), 'limited'],
    ['OCS 429 inside a 200', answered(200, 429), 'limited'],
    ['no account, and mail met the limit', { kind: 'notAnAccount', byMail: { status: 429, ocsStatus: 429, ocs: true } }, 'limited'],
    ['no account, and mail found nothing', { kind: 'notAnAccount', byMail: { status: 404, ocsStatus: 404, ocs: true } }, 'notFound'],
    ['no account, and mail refused', { kind: 'notAnAccount', byMail: { status: 403, ocsStatus: 403, ocs: true } }, 'noAccountNoMail'],
    ['no account, and mail had an error', { kind: 'notAnAccount', byMail: { status: 500, ocsStatus: 996, ocs: true } }, 'serverError'],
    ['nothing answered', { kind: 'unreachable' }, 'unreachable'],
    ['a certificate', { kind: 'certificate' }, 'certificate'],
    ['inside our network', { kind: 'insideOurNetwork' }, 'insideOurNetwork'],
    ['an address it cannot read', { kind: 'noOrigin' }, 'noOrigin'],
    ['anything else', { kind: 'unknown' }, 'unknown'],
  ])('%s', (_name, said, kind) => {
    expect(shareRefusalKind(said)).toBe(kind);
  });
});

describe('the sentences', () => {
  it('say the status, and OCS’s code when it differs', () => {
    expect(shareRefusalSaid(answered(403, 403)).en).toContain('(status 403)');
    expect(shareRefusalSaid(answered(403, 403)).nl).toContain('(status 403)');
    expect(shareRefusalSaid(answered(200, 997)).en).toContain('(status 200, OCS 997)');
  });

  const ALL: ShareRefused[] = [
    answered(401, 997),
    answered(500, 996),
    answered(404, undefined, false),
    answered(404, 404),
    answered(403, 403),
    answered(400, 400),
    answered(409, 409),
    answered(429, 429),
    { kind: 'notAnAccount', byMail: { status: 403, ocsStatus: 403, ocs: true } },
    { kind: 'unreachable' },
    { kind: 'certificate' },
    { kind: 'insideOurNetwork' },
    { kind: 'noOrigin' },
    { kind: 'unknown' },
  ];

  it.each(ALL.map((s) => [shareRefusalKind(s), s] as const))('%s: both halves, different, and the Dutch is Dutch', (_k, said) => {
    const { en, nl } = shareRefusalSaid(said);
    expect(en.length).toBeGreaterThan(20);
    expect(nl.length).toBeGreaterThan(20);
    expect(nl).not.toBe(en);
    expect(nl).toMatch(/\b(het|de|niet|niets|een|van)\b/);
    // The u-form, and the owner's word for a migration.
    expect(nl).not.toMatch(/\b(je|jij|jou|jouw|jullie)\b/i);
    expect(nl).not.toMatch(/verhui[sz]/i);
    expect(en).toMatch(/[.]$/);
    expect(nl).toMatch(/[.]$/);
  });

  it('no grantee is ours, in both languages', () => {
    expect(NO_GRANTEE_TO_SHARE_WITH.en).toContain('nobody to share with');
    expect(NO_GRANTEE_TO_SHARE_WITH.nl).not.toBe(NO_GRANTEE_TO_SHARE_WITH.en);
    expect(NO_GRANTEE_TO_SHARE_WITH.nl).not.toMatch(/\b(je|jij|jouw)\b/i);
  });
});

/**
 * THE TARGET'S LIMIT ON NEW SHARES (workplan 0104, Status of 2026-10-25).
 *
 * Nextcloud 31 to 35 let one account create 20 shares in 10 minutes and
 * answer the next one 429: an empty OCS reply, no `Retry-After`. That is not
 * a refusal of the share, and the press that met it said it under the
 * generic sentence, with nothing to say that waiting is the remedy.
 */
describe("the target's limit on new shares", () => {
  const limit = (retryAfterSeconds?: number): ShareRefused => ({
    kind: 'answered',
    status: 429,
    ocsStatus: 429,
    ocs: true,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });

  it('is told apart from a refusal, and carries what the server asked', () => {
    expect(shareLimitOf(limit())).toEqual({});
    expect(shareLimitOf(limit(90))).toEqual({ retryAfterSeconds: 90 });
    expect(
      shareLimitOf({ kind: 'notAnAccount', byMail: { status: 429, ocsStatus: 429, ocs: true, retryAfterSeconds: 30 } }),
    ).toEqual({ retryAfterSeconds: 30 });
    for (const other of [
      answered(403, 403),
      answered(404, 404),
      answered(409, 409),
      answered(503, undefined, false),
      { kind: 'notAnAccount', byMail: { status: 403, ocsStatus: 403, ocs: true } },
      { kind: 'unreachable' },
      { kind: 'unknown' },
    ] satisfies ShareRefused[]) {
      expect(shareLimitOf(other), JSON.stringify(other)).toBeUndefined();
    }
  });

  it('says the target limits new shares, that nothing was refused, and when to apply again', () => {
    const { en, nl } = shareRefusalSaid(limit());
    expect(en).toContain('limits how many shares one account may create in a short time');
    expect(en).toContain('(status 429)');
    expect(en).toContain('Nothing was refused');
    expect(en).toContain('apply again in ten minutes');
    // Nobody asked for a wait, so the sentence says where its ten minutes come from.
    expect(en).toContain('Nextcloud counts the shares an account created in the last ten minutes');
    expect(nl).toContain('beperkt hoeveel deelrechten één account in korte tijd mag aanmaken');
    expect(nl).toContain('Er is niets geweigerd');
    expect(nl).toContain('u kunt het over tien minuten opnieuw toepassen');
    expect(en).not.toBe(SHARE_REFUSAL.other.en.replace('{status}', 'status 429'));
  });

  it.each<[number, string, string]>([
    [0, 'apply again in a minute, as the new system asked', 'over een minuut opnieuw toepassen, zoals het nieuwe systeem vroeg'],
    [60, 'apply again in a minute', 'over een minuut'],
    [61, 'apply again in about 2 minutes', 'over ongeveer 2 minuten'],
    [240, 'apply again in about 4 minutes', 'over ongeveer 4 minuten'],
    [7140, 'apply again in about 119 minutes', 'over ongeveer 119 minuten'],
    [7200, 'apply again in about 2 hours', 'over ongeveer 2 uur'],
  ])('a Retry-After of %ss is said as the server asked it', (seconds, en, nl) => {
    const said = shareRefusalSaid(limit(seconds));
    expect(said.en).toContain(en);
    expect(said.nl).toContain(nl);
    expect(said.en).not.toContain('ten minutes');
    expect(said.en).toMatch(/[.]$/);
    expect(said.nl).toMatch(/[.]$/);
    expect(said.nl).toMatch(/\bu\b/);
  });

  it('a limit met by the share by mail is said as the limit, not as mail refused', () => {
    const said = shareRefusalSaid({ kind: 'notAnAccount', byMail: { status: 429, ocsStatus: 429, ocs: true } });
    expect(said.en).toContain('apply again in ten minutes');
    expect(said.en).not.toContain('refused to share this item by mail');
  });
});

describe('retryAfterSecondsOf', () => {
  const NOW = new Date('2026-10-25T10:00:00Z');

  it('reads seconds, and an HTTP date counted from now', () => {
    expect(retryAfterSecondsOf('120', NOW)).toBe(120);
    expect(retryAfterSecondsOf(' 5 ', NOW)).toBe(5);
    expect(retryAfterSecondsOf('Sun, 25 Oct 2026 10:03:00 GMT', NOW)).toBe(180);
    // A date already past asks for no wait at all.
    expect(retryAfterSecondsOf('Sun, 25 Oct 2026 09:00:00 GMT', NOW)).toBe(0);
  });

  it('says nothing for no header or one it cannot read, never a wait nobody asked for', () => {
    expect(retryAfterSecondsOf(undefined, NOW)).toBeUndefined();
    expect(retryAfterSecondsOf('', NOW)).toBeUndefined();
    expect(retryAfterSecondsOf('soon', NOW)).toBeUndefined();
    expect(retryAfterSecondsOf('-5', NOW)).toBeUndefined();
    expect(retryAfterSecondsOf('1.5', NOW)).toBeUndefined();
  });
});
