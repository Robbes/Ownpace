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
