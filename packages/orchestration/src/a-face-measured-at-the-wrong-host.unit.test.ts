// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FACE MEASURED AT THE WRONG HOST.
 *
 * `qualifyAccount`'s DAV branch resolved ONE endpoint and measured calendars,
 * task lists and address books through it. Every DAV provider this product had
 * put all three under one root — Soverin, Nextcloud, and the bare protocol
 * kinds where the person types the root themselves — so a single resolution
 * served all of them and nothing anywhere said it was an assumption.
 *
 * Apple is the provider it is not true for. `caldav.icloud.com` carries
 * calendars and reminders; `contacts.icloud.com` carries contacts. Measured
 * through one endpoint, the contact face asks the CALENDAR service for address
 * books, is refused, and — correctly, under the three-state rule — records
 * `unknown`. So the card would show Contacts `?` on an account that carries
 * them perfectly well, and because an unknown never constrains (0106 T3a) the
 * wizard would offer the tick anyway and the migration would find out later.
 *
 * The #597 family: a two-way assumption meeting a third provider. The same
 * shape as every defect workplan 0113 turned up, and the reason this file
 * tests WHERE each question was asked rather than what came back.
 *
 * ## Why it asserts on the URLs and not on the answers
 *
 * A stub that answers everything makes all three faces `yes` whichever host
 * they were asked at, which is exactly how this survived. The addresses are
 * the evidence: a contact probe that never touches `contacts.icloud.com` is
 * wrong even when the fixture lets it succeed.
 */

import { describe, it, expect, vi } from 'vitest';
import { qualifyAccount, isQualifiableKind } from './account-qualification.ts';
import { PROVIDER_ENDPOINTS } from '@openmig/shared';

const CREDS = { username: 'someone@icloud.com', password: 'abcd-efgh-ijkl-mnop' };

/** What an Apple connection stores: no address at all — the hosts are ours. */
const APPLE_CONFIG = { user: 'someone@icloud.com' };

const MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/1234567890/x/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal><d:href>/1234567890/principal/</d:href></d:current-user-principal>
        <card:addressbook-home-set><d:href>/1234567890/carddavhome/</d:href></card:addressbook-home-set>
        <cal:calendar-home-set><d:href>/1234567890/calendars/</d:href></cal:calendar-home-set>
        <d:resourcetype><d:collection/><card:addressbook/><cal:calendar/></d:resourcetype>
        <d:displayname>x</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

/**
 * The mail seam, always injected. Apple's mail face is now MEASURED (it has a
 * published host), so a test that leaves this out opens a real socket to
 * `imap.mail.me.com` and hangs until the timeout — which is the seam doing its
 * job, not a defect.
 */
const noMail = { imapListable: () => ({ listFolders: async () => [] }) };

/** Answers everything, and remembers every host it was asked. */
function recordingFetch() {
  const urls: string[] = [];
  const fn = vi.fn(async (url: string, init?: { method?: string }) => {
    urls.push(String(url));
    if (init?.method === 'OPTIONS') {
      return new Response('', { status: 200, headers: { DAV: '1, 2, calendar-access' } });
    }
    return new Response(MULTISTATUS, {
      status: 207,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
    });
  });
  return { fn, urls, hosts: () => [...new Set(urls.map((u) => new URL(u).host))] };
}

describe('each DAV face is asked at the host that face lives on', () => {
  it('apple is qualifiable at all — without this every face reads `?`', () => {
    // The first half of the defect, and the cheapest to state: an Apple
    // connection that is not a qualifiable kind gets no record written, so
    // every face is unknown, and an unknown never constrains a tick.
    expect(isQualifiableKind('apple')).toBe(true);
  });

  it('contacts are asked at Apple\'s contacts host, not its calendar host', async () => {
    const { fn, hosts } = recordingFetch();
    vi.stubGlobal('fetch', fn);
    try {
      const q = await qualifyAccount('apple', APPLE_CONFIG, CREDS, noMail);

      expect(
        hosts(),
        'the contact face was never asked at contacts.icloud.com. Measured through the ' +
          'calendar endpoint it is refused, recorded `unknown`, shown as `?` on an account ' +
          'that carries contacts — and an unknown does not constrain the wizard, so the tick ' +
          'is offered anyway',
      ).toContain(PROVIDER_ENDPOINTS.apple!.contact!.host);
      expect(hosts()).toContain(PROVIDER_ENDPOINTS.apple!.calendar!.host);
      expect(q?.domains.contact.answer).toBe('yes');
      expect(q?.domains.calendar.answer).toBe('yes');
      expect(q?.domains.task.answer).toBe('yes');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the two hosts are genuinely different, or this file proves nothing', () => {
    // The control on the fixture itself. If Apple ever served both from one
    // root, every assertion above would pass vacuously and this guard would
    // quietly stop guarding — so it says so instead.
    expect(PROVIDER_ENDPOINTS.apple!.calendar!.host).not.toBe(
      PROVIDER_ENDPOINTS.apple!.contact!.host,
    );
  });

  it('a kind whose faces DO share a root is asked there, exactly as before', async () => {
    // The regression this change could most easily cause. `davUrl` returns the
    // stored url whenever the config has one, so per-face resolution must give
    // these kinds the same answer three times and touch nothing new.
    const { fn, hosts } = recordingFetch();
    vi.stubGlobal('fetch', fn);
    try {
      await qualifyAccount('caldav', { url: 'https://dav.example.net/dav/' }, CREDS, noMail);
      expect(hosts()).toEqual(['dav.example.net']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the file face Apple has not got says why', () => {
  it('answers a measured no naming the missing API and the export', async () => {
    const { fn } = recordingFetch();
    vi.stubGlobal('fetch', fn);
    try {
      const q = await qualifyAccount('apple', APPLE_CONFIG, CREDS, noMail);

      // A measured `no`, not an unknown: the product KNOWS, so the domain step
      // refuses the tick rather than offering it on no evidence (0106 T3a).
      expect(q?.domains.file.answer).toBe('no');
      // And the reason, because "not a face of this connection" reads as if we
      // had not bothered — the person has an iCloud Drive, very likely a large
      // one, and what is actually true is narrower than that.
      expect(q?.domains.file.detail).toContain('iCloud Drive');
      expect(
        q?.domains.file.detail,
        'the file face does not name the only route to those bytes',
      ).toContain('privacy.apple.com');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a kind with no reason of its own keeps the general sentence', async () => {
    // The control: `reasonedNo` is a list of exceptions, not a second
    // vocabulary. Soverin has no file store either, and nothing more to say.
    const { fn } = recordingFetch();
    vi.stubGlobal('fetch', fn);
    try {
      const q = await qualifyAccount('soverin', { url: 'https://dav.soverin.net/' }, CREDS, noMail);
      expect(q?.domains.file.answer).toBe('no');
      expect(q?.domains.file.detail).not.toContain('iCloud');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('mail is measured where a named account publishes it', () => {
  it('apple needs no typed host — the address is not a customer choice', async () => {
    const seen: string[] = [];
    const { fn } = recordingFetch();
    vi.stubGlobal('fetch', fn);
    try {
      const q = await qualifyAccount('apple', APPLE_CONFIG, CREDS, {
        imapListable: (config) => {
          seen.push(String((config as { host?: unknown }).host ?? ''));
          return { listFolders: async () => [{}, {}] };
        },
      });
      expect(seen).toEqual([PROVIDER_ENDPOINTS.apple!.email!.host]);
      expect(q?.domains.mail.answer).toBe('yes');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a soverin account with no mailHost is still UNMEASURED, not measured at its DAV host', async () => {
    // The trap this change had to avoid. `accountMailEndpoint` — the rule the
    // PASSES use — ends `?? stored.host`, and a soverin connection stores
    // `host: caldav.soverin.net`. Borrowing that here would point an IMAP
    // probe at a calendar server and turn a sentence that names the remedy
    // into a connection error. #133's mistake in a new place.
    const asked: string[] = [];
    const { fn } = recordingFetch();
    vi.stubGlobal('fetch', fn);
    try {
      const q = await qualifyAccount(
        'soverin',
        { url: 'https://dav.soverin.net/', host: 'caldav.soverin.net' },
        CREDS,
        {
          imapListable: (config) => {
            asked.push(String((config as { host?: unknown }).host ?? ''));
            return { listFolders: async () => [] };
          },
        },
      );
      expect(asked, 'an IMAP probe was pointed at a DAV host').toEqual([]);
      expect(q?.domains.mail.answer).toBe('unknown');
      expect(q?.domains.mail.detail).toContain('mailHost');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
