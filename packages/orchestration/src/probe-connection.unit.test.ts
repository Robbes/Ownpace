// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The connection probe (workplan 0046) — what can be proven without a
 * provider on the wire: that a refusal arrives as an ANSWER ({ok:false,
 * reason}) carrying the same verbatim sentence a sync pass would have failed
 * with, that the probe interprets the STORED shapes through the same builders
 * a pass uses, and that an unprobeable kind says so honestly instead of
 * passing vacuously.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  measureTargetScheduling,
  probeSourceConnection,
  probeTargetConnection,
} from './probe-connection.ts';

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

describe('the scheduling verdict: measured at test time, never assumed (0105 T0)', () => {
  const verdictFor = (dav: string | undefined, status = 200) =>
    measureTargetScheduling('https://dav.example.net/dav/', 'probe', 'pw', {
      request: async ({ method, headers }) => {
        // One OPTIONS, authenticated the same way the writes would be —
        // an anonymous answer could describe a different server face.
        expect(method).toBe('OPTIONS');
        expect(headers?.Authorization).toBe(`Basic ${Buffer.from('probe:pw').toString('base64')}`);
        const responseHeaders: Record<string, string> = dav === undefined ? {} : { DAV: dav };
        return { status, body: '', headers: responseHeaders };
      },
    });

  it('calendar-auto-schedule advertised: fan-out is REAL here, and the sentence says the neutralising is load-bearing', async () => {
    const verdict = await verdictFor('1, 2, calendar-access, calendar-auto-schedule');
    expect(verdict.capability).toBe('auto-schedule');
    expect(verdict.sentence).toContain('neutralises');
    expect(verdict.sentence).toContain('measured on this target, not assumed');
  });

  it('a DAV header without the class: RFC 6638 fan-out cannot happen on this target', async () => {
    const verdict = await verdictFor('1, 2, calendar-access');
    expect(verdict.capability).toBe('none');
    expect(verdict.sentence).toContain('cannot happen here');
  });

  it('no DAV header at all is UNMEASURED — reported as unmeasured, never as safe (the run-#6 lesson)', async () => {
    const verdict = await verdictFor(undefined);
    expect(verdict.capability).toBe('unknown');
    expect(verdict.sentence).toContain('UNMEASURED');
    expect(verdict.sentence).toContain('not safe');
  });

  // The wiring: the verdict rides the SAME probe result the test-connection
  // button already renders, so no consumer has to know it exists to show it.
  const COLLECTION_MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/dav/addressbooks/probe/contacts/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal><d:href>/dav/principals/probe/</d:href></d:current-user-principal>
        <card:addressbook-home-set><d:href>/dav/addressbooks/probe/</d:href></card:addressbook-home-set>
        <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
        <d:displayname>contacts</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

  const davAnsweringFetch = (dav: string) =>
    vi.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === 'OPTIONS'
        ? new Response('', { status: 200, headers: { DAV: dav } })
        : new Response(COLLECTION_MULTISTATUS, {
            status: 207,
            headers: { 'content-type': 'application/xml; charset=utf-8' },
          }),
    );

  it('a webdav target probe carries the verdict, appended to the detail every consumer already shows', async () => {
    const fetchMock = davAnsweringFetch('1, 2, calendar-access, calendar-auto-schedule');
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await probeTargetConnection(
        'webdav',
        { url: 'https://dav.example.net/dav/files/probe/' },
        { username: 'probe', password: 'pw' },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.scheduling?.capability).toBe('auto-schedule');
        // Appended, not replacing: the count sentence still leads.
        expect(result.detail).toMatch(
          /^Connected\. \d+ collections? visible\. This target runs calendar auto-scheduling/,
        );
      }
      // Measured on the exact endpoint the listing proved — not some other URL.
      const options = fetchMock.mock.calls.find(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'OPTIONS',
      );
      expect(options?.[0]).toBe('https://dav.example.net/dav/files/probe/');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a carddav target has no scheduling to measure: no verdict, and no OPTIONS ever sent', async () => {
    const fetchMock = davAnsweringFetch('1, 2, calendar-access, calendar-auto-schedule');
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await probeTargetConnection(
        'carddav',
        { url: 'https://dav.example.net/dav/' },
        { username: 'probe', password: 'pw' },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.scheduling).toBeUndefined();
        expect(result.detail).not.toContain('auto-schedul');
      }
      const methods = fetchMock.mock.calls.map((c) => (c[1] as { method?: string } | undefined)?.method);
      expect(methods).not.toContain('OPTIONS');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
