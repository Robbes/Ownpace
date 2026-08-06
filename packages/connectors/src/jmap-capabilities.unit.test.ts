// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The JMAP capability probe (workplan 0031 T4).
 *
 * Aimed at the three conflations the probe exists to prevent, because each of
 * them is a plausible one-liner that would produce a confident wrong answer:
 *
 *   1. An advertised capability with **no account behind it** read as support.
 *      Every JMAP writer here resolves its account from `primaryAccounts[urn]`
 *      and refuses rather than guessing, so that URN cannot be written to.
 *   2. **The server speaking a domain** read as **this product carrying it**.
 *      Stalwart advertises JMAP calendars and there is no calendar target —
 *      T1 is parked because that server refuses `recurrenceRules`, so offering
 *      it would be offering a silent data-loss bug.
 *   3. **A failed probe** read as a definitive "speaks nothing". Hard rule 9.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: unknown;
let loadError: Error | null;

vi.mock('jmap-jam', () => ({
  default: {
    loadSession: async () => {
      if (loadError) throw loadError;
      return session;
    },
  },
}));

const { probeJmapCapabilities, usableJmapDomains } = await import('./jmap-capabilities');

const MAIL = 'urn:ietf:params:jmap:mail';
const CONTACTS = 'urn:ietf:params:jmap:contacts';
const PARSE = 'urn:ietf:params:jmap:contacts:parse';
const FILES = 'urn:ietf:params:jmap:filenode';
const CALENDARS = 'urn:ietf:params:jmap:calendars';

/** A session advertising `urns`, with an account for each unless excluded. */
function sessionWith(urns: string[], withoutAccounts: string[] = []) {
  const capabilities: Record<string, unknown> = {};
  const primaryAccounts: Record<string, string> = {};
  for (const urn of urns) {
    capabilities[urn] = {};
    if (!withoutAccounts.includes(urn)) primaryAccounts[urn] = 'acct';
  }
  return { capabilities, primaryAccounts };
}

function probe() {
  return probeJmapCapabilities({
    baseUrl: 'http://jmap.test',
    username: 'target@dev.local',
    password: 'pw',
  });
}

function forDomain(report: Awaited<ReturnType<typeof probe>>, domain: string) {
  return report.domains.find((d) => d.domain === domain)!;
}

beforeEach(() => {
  loadError = null;
  session = sessionWith([MAIL, CONTACTS, PARSE, FILES, CALENDARS]);
});

describe('what a fully-capable server yields', () => {
  it('offers mail, contacts and files — and NOT calendars', async () => {
    const report = await probe();
    // Calendars are advertised by this session and still not offered. That is
    // the point of splitting `serverSpeaks` from `supportedByThisProduct`: the
    // server is ready and this product is not, and a picker that gated on the
    // URN alone would offer a connector that does not exist.
    expect([...usableJmapDomains(report)].sort()).toEqual(['contact', 'file', 'mail']);
  });

  it('says the server DOES speak calendars, while refusing to offer them', async () => {
    const calendar = forDomain(await probe(), 'calendar');
    expect(calendar.serverSpeaks).toBe(true);
    expect(calendar.supportedByThisProduct).toBe(false);
    expect(calendar.usable).toBe(false);
    // And says why, in terms an operator can act on — waiting for the server
    // will not help here, which is exactly what the reason has to convey.
    expect(calendar.reason).toMatch(/0031 T1 is parked/);
    expect(calendar.reason).toMatch(/recurrenceRules/);
  });

  it('reports every advertised URN, for the record', async () => {
    const report = await probe();
    expect(report.advertised).toContain(FILES);
    expect(report.advertised).toHaveLength(5);
  });
});

describe('an advertised capability is not enough', () => {
  it('refuses a domain whose capability has NO primaryAccounts entry', async () => {
    session = sessionWith([MAIL, CONTACTS, PARSE, FILES], [FILES]);
    const file = forDomain(await probe(), 'file');
    // Advertised, so it LOOKS supported. Every writer here resolves its account
    // from primaryAccounts and refuses rather than guessing — because guessing
    // risks writing a customer's data into somebody else's account — so this is
    // a URN this product cannot write to.
    expect(file.serverSpeaks).toBe(false);
    expect(file.usable).toBe(false);
    expect(file.reason).toMatch(/no primaryAccounts entry/);
    expect(file.reason).toMatch(/somebody else's account/);
  });

  it('refuses contacts when the server has no `parse`, which route (2) requires', async () => {
    session = sessionWith([MAIL, CONTACTS, FILES]); // no :contacts:parse
    const contact = forDomain(await probe(), 'contact');
    // `JmapContactTarget` uploads the vCard and lets the SERVER convert it via
    // `ContactCard/parse` — the whole fidelity argument for that connector.
    // Without parse it cannot work as built, and finding that out on the first
    // card would be a mid-migration method error instead of an answer.
    expect(contact.serverSpeaks).toBe(false);
    expect(contact.reason).toMatch(/contacts:parse/);
    expect(usableJmapDomains(await probe())).not.toContain('contact');
  });

  it('names the missing URN when a capability is absent entirely', async () => {
    session = sessionWith([MAIL]);
    const file = forDomain(await probe(), 'file');
    expect(file.reason).toMatch(/does not advertise urn:ietf:params:jmap:filenode/);
  });

  it('reports BOTH halves when the server and the product are each missing something', async () => {
    session = sessionWith([MAIL]); // no calendars either
    const calendar = forDomain(await probe(), 'calendar');
    // An operator choosing a target needs to know whether waiting for the
    // server would help. Here it would not, and both facts are stated.
    expect(calendar.reason).toMatch(/does not advertise/);
    expect(calendar.reason).toMatch(/0031 T1 is parked/);
  });
});

describe('a failed probe is never a negative answer', () => {
  it('THROWS when the session cannot be read, rather than reporting nothing usable', async () => {
    loadError = new Error('ECONNREFUSED 127.0.0.1:443');
    // A report full of `false` is indistinguishable from a server that really
    // speaks nothing, and a picker would then quietly hide every JMAP option
    // because a password was wrong. Hard rule 9.
    await expect(probe()).rejects.toThrow(/UNKNOWN — not "none"/);
    await expect(probe()).rejects.toThrow(/ECONNREFUSED/);
  });

  it('treats a session with no capabilities at all as a real negative', async () => {
    // This IS a definitive answer: the server responded and advertised nothing.
    session = { capabilities: {}, primaryAccounts: {} };
    const report = await probe();
    expect(usableJmapDomains(report)).toEqual([]);
    expect(report.advertised).toEqual([]);
    expect(forDomain(report, 'mail').reason).toMatch(/does not advertise/);
  });

  it('survives a session missing the fields entirely', async () => {
    session = {};
    const report = await probe();
    expect(usableJmapDomains(report)).toEqual([]);
  });
});
