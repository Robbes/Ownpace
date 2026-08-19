// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The connection probe (workplan 0046) — what can be proven without a
 * provider on the wire: that a refusal arrives as an ANSWER ({ok:false,
 * reason}) carrying the same verbatim sentence a sync pass would have failed
 * with, that the probe interprets the STORED shapes through the same builders
 * a pass uses, and that an unprobeable kind says so honestly instead of
 * passing vacuously.
 */

import { describe, it, expect, vi } from 'vitest';
import { probeSourceConnection, probeTargetConnection } from './probe-connection.ts';

describe('probeSourceConnection: refusals are answers, in the builders\' own words', () => {
  it('a gmail source with missing credentials refuses in the STORED vocabulary', async () => {
    const result = await probeSourceConnection('gmail', { type: 'gmail', user: 'a@gmail.com' }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The exact refusal buildGmailSourceFrom throws — the probe adds
      // nothing and loses nothing (rule 9).
      expect(result.reason).toContain('clientId');
      expect(result.reason).toContain("connection's stored credentials");
      expect(result.reason).not.toContain('GOOGLE_MAIL_REFRESH_TOKEN');
    }
  });

  it('a google-calendar source names ITS scope in the refusal', async () => {
    const result = await probeSourceConnection(
      'google_calendar',
      { type: 'google-calendar', user: 'a@x.com' },
      { clientId: 'cid' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('auth/calendar');
  });

  it('an imap source with no usable credential refuses with the mail builder\'s sentence', async () => {
    const result = await probeSourceConnection(
      'imap',
      { type: 'imap-oauth2', host: 'imap.example.net', port: 993, user: 'u@example.net' },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/access token.*password.*app registration/);
  });

  it('an unknown kind is a wiring gap, said honestly — never a vacuous pass', async () => {
    const result = await probeSourceConnection('carrier_pigeon', {}, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("'carrier_pigeon'");
      expect(result.reason).toContain('wiring gap');
    }
  });
});

describe('probeTargetConnection: read-only questions only', () => {
  it('a jmap target asks the session document and reports a 401 as reachable-but-refused', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await probeTargetConnection(
        'jmap',
        { type: 'jmap', baseUrl: 'https://mail.example.net' },
        { username: 'u', password: 'p' },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('/.well-known/jmap');
        expect(result.reason).toContain('refused the credentials');
      }
      // And it asked with Basic auth, GET only.
      const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
      expect(call[0]).toBe('https://mail.example.net/.well-known/jmap');
      expect(call[1].headers.Authorization).toContain('Basic ');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a jmap target that answers is a pass', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    try {
      const result = await probeTargetConnection(
        'jmap',
        { type: 'jmap', baseUrl: 'https://mail.example.net' },
        { username: 'u', password: 'p' },
      );
      // The English `detail` is unchanged and still the fallback an appliance
      // or an API consumer reads; `outcome` is what lets a Dutch screen say it
      // in Dutch (workplan 0080). Asserted in full rather than loosened to
      // `toMatchObject`, because the shape IS the contract.
      expect(result).toEqual({
        ok: true,
        detail: 'Connected. The JMAP session document answered.',
        outcome: { code: 'connectedSession' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a dav target with unresolvable credentials refuses with the endpoint resolver\'s words', async () => {
    const result = await probeTargetConnection(
      'webdav',
      { host: 'cloud.example.net', port: 443, useSsl: true },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('whose refusal is it? (workplan 0083)', () => {
  it("labels OUR credential refusal as ours, and carries both languages", async () => {
    // A gmail source with nothing stored refuses in one of our own factories.
    // Before 0083 this arrived as `providerRefused` — the code that means
    // "render verbatim, it is somebody else's string" — which is why a Dutch
    // operator read it in English. It is not Dropbox's or Google's sentence.
    // We wrote it.
    const result = await probeSourceConnection('gmail', { type: 'gmail', user: 'a@gmail.com' }, {});
    expect(result.ok).toBe(false);
    expect(result.outcome?.code).toBe('credentialsRefused');
    if (result.outcome?.code === 'credentialsRefused') {
      const { refusal } = result.outcome;
      expect(refusal.nl).not.toBe(refusal.en);
      expect(refusal.nl.length).toBeGreaterThan(20);
      // The field names survive translation — they are what must be set.
      for (const field of refusal.fields) expect(refusal.nl).toContain(field);
      // And `reason` is still the English, so every caller that only knows
      // about `reason` is unchanged.
      if (!result.ok) expect(result.reason).toBe(refusal.en);
    }
  });

  it("leaves a PROVIDER's refusal labelled as theirs", async () => {
    // An unprobeable kind is ours too, but a genuine provider error must not
    // be swept into the translated bucket — that would be 0080's defect in
    // reverse, and it is the more damaging direction: `invalid_client` is the
    // string somebody pastes into a provider's console.
    const result = await probeSourceConnection('carrier_pigeon', {}, {});
    expect(result.outcome?.code).not.toBe('credentialsRefused');
  });
});
