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
  limitAfterRefusals,
  retryAfterSecondsOf,
  shareLimitOf,
  shareRefusalKind,
  shareRefusalSaid,
  spentTheLimit,
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

  it('says the target limits new shares, that this share was not refused, and when to apply again', () => {
    const { en, nl } = shareRefusalSaid(limit());
    expect(en).toContain('limits how many shares one account may create in a short time');
    expect(en).toContain('(status 429)');
    expect(en).toContain('This share was not refused');
    expect(en).toContain('apply again in ten minutes');
    // Nobody asked for a wait, so the sentence says where its ten minutes
    // come from, and that a share that failed counts: with outsiders at two
    // calls apiece, the limit comes after ten shares made, not twenty.
    expect(en).toContain(
      'Nextcloud counts every share an account asked for in the last ten minutes, those that failed included',
    );
    expect(en).not.toMatch(/shares an account created/);
    expect(nl).toContain('beperkt hoeveel deelrechten één account in korte tijd mag aanmaken');
    expect(nl).toContain('Dit deelrecht is niet geweigerd');
    expect(nl).toContain('u kunt het over tien minuten opnieuw toepassen');
    expect(nl).toContain('Nextcloud telt elk deelrecht dat een account in de laatste tien minuten aanvroeg, ook de mislukte');
    expect(en).not.toBe(SHARE_REFUSAL.other.en.replace('{status}', 'status 429'));
  });

  it('says limiet in Dutch, the word the product uses for a limit, never grens', () => {
    const { nl } = shareRefusalSaid(limit());
    expect(nl).toContain('heeft die limiet bereikt');
    expect(nl).not.toMatch(/\bgrens\b/);
  });

  it('a wait the server asked for and is not believed is said as later, never as ten minutes', () => {
    const said = shareRefusalSaid({ kind: 'answered', status: 429, ocsStatus: 429, ocs: true, retryAfterNotBelieved: true });
    expect(said.en).toContain('apply again later, as the new system asked.');
    expect(said.nl).toContain('u kunt het later opnieuw toepassen, zoals het nieuwe systeem vroeg.');
    expect(said.en).not.toContain('ten minutes');
    expect(said.en).not.toContain('Nextcloud counts');
  });

  it('a 429 without OCS and without a wait says later, and nothing of Nextcloud', () => {
    const said = shareRefusalSaid(answered(429, undefined, false));
    expect(said.en).toContain('apply again later; the new system did not say when.');
    expect(said.nl).toContain('u kunt het later opnieuw toepassen; het nieuwe systeem zei niet wanneer.');
    expect(said.en).not.toMatch(/Nextcloud|ten minutes/);
    expect(said.nl).not.toMatch(/Nextcloud|tien minuten/);
    // A wait it did name is still said, OCS or not.
    expect(shareRefusalSaid({ kind: 'answered', status: 429, ocs: false, retryAfterSeconds: 240 }).en).toContain(
      'apply again in about 4 minutes',
    );
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

  it.each(['x 5', 'May 5', 'foo 2026', 'soon 1', '2026-10-25T10:03:00Z', 'Sun, 25 Oct 2026 10:03:00 +0000'])(
    '%j is none of the three forms of an HTTP date, though Date.parse reads it as one',
    (header) => {
      expect(retryAfterSecondsOf(header, NOW)).toBeUndefined();
    },
  );

  it('a date that does not exist is no date', () => {
    expect(retryAfterSecondsOf('Sun, 31 Feb 2026 10:03:00 GMT', NOW)).toBeUndefined();
    expect(retryAfterSecondsOf('Sun, 25 Oct 2026 25:03:00 GMT', NOW)).toBeUndefined();
  });

  it("reads RFC 850's form and asctime's, the two obsolete ones a recipient still accepts", () => {
    expect(retryAfterSecondsOf('Sunday, 25-Oct-26 10:03:00 GMT', NOW)).toBe(180);
    expect(retryAfterSecondsOf('Sun Oct 25 10:03:00 2026', NOW)).toBe(180);
    // A single-digit day, padded with a space, as asctime writes it.
    expect(retryAfterSecondsOf('Mon Nov  2 10:00:00 2026', new Date('2026-11-02T09:59:00Z'))).toBe(60);
  });

  it('reads asctime, which names no zone, as GMT whatever zone the process runs in', () => {
    const zone = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/New_York', 'Europe/Amsterdam']) {
        process.env.TZ = tz;
        expect(retryAfterSecondsOf('Sun Oct 25 10:03:00 2026', NOW), tz).toBe(180);
      }
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it('believes a wait of up to one day, and no longer one, so the sentence falls back to ten minutes', () => {
    expect(retryAfterSecondsOf('86400', NOW)).toBe(86400);
    expect(retryAfterSecondsOf('86401', NOW)).toBeUndefined();
    expect(retryAfterSecondsOf('1000000000000', NOW)).toBeUndefined();
    // Past what a double holds exactly, and past what it holds at all.
    expect(retryAfterSecondsOf('9007199254740993', NOW)).toBeUndefined();
    expect(retryAfterSecondsOf('9'.repeat(400), NOW)).toBeUndefined();
    expect(retryAfterSecondsOf('Mon, 26 Oct 2026 10:00:00 GMT', NOW)).toBe(86400);
    expect(retryAfterSecondsOf('Fri, 01 Jan 2100 00:00:00 GMT', NOW)).toBeUndefined();

    // What a connector carries from such a header: no wait at all.
    const retryAfterSeconds = retryAfterSecondsOf('9'.repeat(400), NOW);
    const said = shareRefusalSaid({
      kind: 'answered',
      status: 429,
      ocs: true,
      ocsStatus: 429,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
    expect(said.en).toContain('apply again in ten minutes');
    expect(said.en).not.toMatch(/Infinity|NaN/);
    expect(said.nl).not.toMatch(/Infinity|NaN/);
  });
});

/**
 * WHAT A PRESS ADDS WHEN IT MEETS THE LIMIT AFTER REFUSALS (workplan 0104 T5,
 * after review). A refused row stays open and unchanged, and the next press
 * asks for it again before the rows that waited, at the same cost: fifteen
 * outsiders, the first ten refused, and every press spent the twenty calls on
 * those ten and said the last five would go through after ten minutes.
 */
describe('the limit after refusals', () => {
  it('says nothing when nothing was refused before the limit', () => {
    expect(limitAfterRefusals({ refused: 0, signIn: false })).toBeUndefined();
  });

  it('says the refused rows are asked for again first and count, and to settle them before applying again', () => {
    const one = limitAfterRefusals({ refused: 1, signIn: false })!;
    expect(one.en).toContain('refused 1 share this press asked for');
    expect(one.en).toContain('counts toward the same limit');
    expect(one.en).toContain('before the rows that wait');
    expect(one.en).toContain('correct that row, skip it or mark it done before applying again');
    expect(one.nl).toContain('1 deelrecht');
    expect(one.nl).toContain('telt mee voor dezelfde limiet');
    expect(one.nl).toContain('sla hem over of vink hem af');

    const ten = limitAfterRefusals({ refused: 10, signIn: false })!;
    expect(ten.en).toContain('refused 10 shares this press asked for, and those attempts count toward the same limit');
    expect(ten.en).toContain('correct those rows, skip them or mark them done before applying again');
    expect(ten.nl).toContain('10 deelrechten');
    expect(ten.nl).toContain('sla ze over of vink ze af');
    for (const said of [one, ten]) {
      expect(said.en).not.toContain('password');
      expect(said.nl).not.toMatch(/\b(je|jij|jou|jouw|jullie)\b/i);
      expect(said.en).toMatch(/[.]$/);
      expect(said.nl).toMatch(/[.]$/);
    }
  });

  it('a sign-in refused before the limit says to check the password first, and that the wait may be half an hour', () => {
    const said = limitAfterRefusals({ refused: 0, signIn: true })!;
    expect(said.en).toContain('also refused the sign-in');
    expect(said.en).toContain('check the password of the destination account on the Accounts page first');
    expect(said.en).toContain('half an hour');
    expect(said.nl).toContain('controleer eerst het wachtwoord van het doelaccount op de pagina Accounts');
    expect(said.nl).toContain('half uur');
    expect(said.nl).toMatch(/\bu\b/);

    const both = limitAfterRefusals({ refused: 2, signIn: true })!;
    expect(both.en).toContain('refused 2 shares');
    expect(both.en).toContain('check the password');
  });

  it('counts a refusal toward the limit only when the target answered the share call', () => {
    for (const kind of ['forbidden', 'notFound', 'noAccountNoMail', 'badRequest', 'serverError', 'notNextcloud', 'other'] as const) {
      expect(spentTheLimit(kind), kind).toBe(true);
    }
    for (const kind of ['signIn', 'unreachable', 'certificate', 'insideOurNetwork', 'noOrigin', 'unknown'] as const) {
      expect(spentTheLimit(kind), kind).toBe(false);
    }
    // A refusal the edition made before asking the target anything.
    expect(spentTheLimit(undefined)).toBe(false);
  });
});
