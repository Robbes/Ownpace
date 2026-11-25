// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `verifyMX`'s answers mapped to Finish's four lines (workplan 0171 T10,
 * §7.3; the owner's D8 (a)), and the two outcomes beside them said as they
 * are. The answers are `resolverResults` as `verifyMX` builds them from
 * DNS-over-HTTPS JSON (`"10 mx.example.net."`). No real MX change is proved
 * here; that needs a domain somebody moves.
 */

import { describe, expect, it } from 'vitest';
import {
  destinationMx,
  hostUnder,
  MxCheckPace,
  mxHostOf,
  mxReadingOf,
  OLD_PROVIDER_MX,
  type MxResolverAnswer,
} from './finish-mx.ts';

const answered = (...records: string[]): MxResolverAnswer => ({ success: true, records });
const empty: MxResolverAnswer = { success: false, records: [] };
const failed = (error: string): MxResolverAnswer => ({ success: false, records: [], error });

const three = (a: MxResolverAnswer, b: MxResolverAnswer, c: MxResolverAnswer) => ({
  Cloudflare: a,
  Google: b,
  Quad9: c,
});

const SELF_RUN = destinationMx('jmap', 'mail.example.net');
const MICROSOFT = OLD_PROVIDER_MX.microsoft;

describe('the four lines', () => {
  it('ok: every resolver answers the destination\'s hosts', () => {
    const r = three(answered('10 mx1.example.net.'), answered('10 mx1.example.net.'), answered('10 mx1.example.net.'));
    expect(mxReadingOf(r, SELF_RUN, MICROSOFT)).toEqual({
      line: 'ok',
      hosts: ['mx1.example.net'],
      destination: 'mail.example.net',
    });
  });

  it('old: still at Microsoft', () => {
    const at = '0 example-com.mail.protection.outlook.com.';
    expect(mxReadingOf(three(answered(at), answered(at), answered(at)), SELF_RUN, MICROSOFT)).toEqual({
      line: 'old',
      hosts: ['example-com.mail.protection.outlook.com'],
      provider: 'Microsoft',
    });
  });

  it('other: neither the destination nor the old provider, shown to be judged', () => {
    const at = '10 mx.example.org.';
    expect(mxReadingOf(three(answered(at), answered(at), failed('timeout')), SELF_RUN, MICROSOFT)).toEqual({
      line: 'other',
      hosts: ['mx.example.org'],
    });
  });

  it('other: a destination with no known hosts is never called right', () => {
    const at = '10 mx1.example.net.';
    expect(mxReadingOf(three(answered(at), answered(at), answered(at)), undefined, MICROSOFT).line).toBe('other');
  });

  it('other: half moved is not ok', () => {
    const r = ['10 mx1.example.net.', '20 example-com.mail.protection.outlook.com.'];
    expect(mxReadingOf(three(answered(...r), answered(...r), answered(...r)), SELF_RUN, MICROSOFT).line).toBe('other');
  });

  it('disagree: two resolvers answer different hosts', () => {
    const got = mxReadingOf(
      three(
        answered('10 mx1.example.net.'),
        answered('0 example-com.mail.protection.outlook.com.'),
        answered('10 mx1.example.net.'),
      ),
      SELF_RUN,
      MICROSOFT,
    );
    expect(got).toEqual({
      line: 'disagree',
      hosts: ['example-com.mail.protection.outlook.com', 'mx1.example.net'],
    });
  });

  it('disagree: only one resolver answered', () => {
    expect(
      mxReadingOf(three(answered('10 mx1.example.net.'), failed('HTTP 503'), failed('timeout')), SELF_RUN, MICROSOFT)
        .line,
    ).toBe('disagree');
  });

  it('the order of the records does not make a disagreement', () => {
    const r = three(
      answered('10 mx1.example.net.', '20 mx2.example.net.'),
      answered('20 mx2.example.net', '10 mx1.example.net'),
      answered('10 MX1.example.net.', '20 mx2.example.net.'),
    );
    expect(mxReadingOf(r, SELF_RUN, MICROSOFT).line).toBe('ok');
  });
});

describe('the two outcomes beside the lines', () => {
  it('unreadable: no resolver could be asked, with their words', () => {
    expect(mxReadingOf(three(failed('fetch failed'), failed('fetch failed'), failed('HTTP 403')), SELF_RUN, MICROSOFT)).toEqual(
      { line: 'unreadable', reasons: ['fetch failed', 'fetch failed', 'HTTP 403'] },
    );
  });

  it('none: the resolvers agree there is no MX record', () => {
    expect(mxReadingOf(three(empty, empty, empty), SELF_RUN, MICROSOFT)).toEqual({ line: 'none' });
  });
});

describe('the known hosts', () => {
  it('matches on whole labels', () => {
    expect(hostUnder('example-com.mail.protection.outlook.com', 'mail.protection.outlook.com')).toBe(true);
    expect(hostUnder('mail.protection.outlook.com.example.org', 'mail.protection.outlook.com')).toBe(false);
    expect(hostUnder('notexample.net', 'example.net')).toBe(false);
  });

  it('reads the host out of a DoH record', () => {
    expect(mxHostOf('10 MX1.Example.NET.')).toBe('mx1.example.net');
    expect(mxHostOf('mx1.example.net')).toBe('mx1.example.net');
  });

  it('knows Cirrux by its kind and by its mail host', () => {
    expect(destinationMx('cirrux', undefined)?.mx).toContain('smtp.cirrux.co');
    expect(destinationMx('imap', 'imap.cirrux.co')?.name).toBe('Cirrux');
  });

  it('knows a server the person runs by its own domain, and nothing by an IP address', () => {
    expect(destinationMx('jmap', 'mail.example.net')).toEqual({ name: 'mail.example.net', mx: ['example.net'] });
    expect(destinationMx('imap', 'example.net')).toEqual({ name: 'example.net', mx: ['example.net'] });
    expect(destinationMx('imap', '192.0.2.1')).toBeUndefined();
    expect(destinationMx('imap', undefined)).toBeUndefined();
  });
});

describe('one check per ten seconds per migration', () => {
  it('counts the first, refuses the next until ten seconds pass', () => {
    const pace = new MxCheckPace();
    expect(pace.take('m1', 1_000)).toBe(0);
    expect(pace.take('m1', 4_000)).toBe(7_000);
    expect(pace.take('m2', 4_000)).toBe(0);
    expect(pace.take('m1', 11_000)).toBe(0);
  });
});
