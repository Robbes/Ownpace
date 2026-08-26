// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The catch-all reader (0105 T2) — what must hold before a live nightly can
 * lean on it: the config discipline (honest-off / half-set-names-missing),
 * the widest-net search, and a positive-control wait that returns evidence
 * instead of throwing.
 */

import { describe, it, expect } from 'vitest';
import {
  catchallFromEnv,
  searchTag,
  waitForTag,
  assertableSilence,
  type CatchallClient,
  type CatchallConfig,
} from './live-catchall.ts';

const ON: Extract<CatchallConfig, { on: true }> = {
  on: true,
  host: 'imap.example.net',
  port: 993,
  user: 'catchall@ownpace.eu',
  password: 'pw',
  mailbox: 'INBOX',
  announcement: '',
};

/** A fake client that records the search and answers from a script. */
function fakeClient(answers: {
  seqs: number[];
  envelopes?: Record<number, { subject?: string; from?: { address: string }[]; to?: { address: string }[] }>;
}) {
  const calls: { searches: Record<string, unknown>[]; connected: number; loggedOut: number; released: number } = {
    searches: [],
    connected: 0,
    loggedOut: 0,
    released: 0,
  };
  const client: CatchallClient = {
    connect: async () => {
      calls.connected += 1;
    },
    getMailboxLock: async () => ({
      release: () => {
        calls.released += 1;
      },
    }),
    search: async (query) => {
      calls.searches.push(query);
      return answers.seqs;
    },
    fetchOne: async (seq) => ({ envelope: answers.envelopes?.[seq] }),
    logout: async () => {
      calls.loggedOut += 1;
    },
  };
  return { client, calls };
}

describe('catchallFromEnv: the notifierFromEnv discipline, copied deliberately', () => {
  it('nothing set is honestly OFF, naming every variable that would turn it on', () => {
    const config = catchallFromEnv({});
    expect(config.on).toBe(false);
    if (!config.on) {
      expect(config.misconfigured).toBe(false);
      expect(config.reason).toContain('LIVE_CATCHALL_HOST');
      expect(config.reason).toContain('LIVE_CATCHALL_USER');
      expect(config.reason).toContain('LIVE_CATCHALL_PASSWORD');
    }
  });

  it('half-set is OFF and MISCONFIGURED, naming exactly what is missing — the nightly reds on this', () => {
    const config = catchallFromEnv({ LIVE_CATCHALL_HOST: 'imap.example.net' });
    expect(config.on).toBe(false);
    if (!config.on) {
      expect(config.misconfigured).toBe(true);
      expect(config.reason).toContain('LIVE_CATCHALL_USER');
      expect(config.reason).toContain('LIVE_CATCHALL_PASSWORD');
      expect(config.reason).not.toContain('LIVE_CATCHALL_HOST,');
    }
  });

  it('fully set is ON, port defaulted to 993 and mailbox to INBOX, announced', () => {
    const config = catchallFromEnv({
      LIVE_CATCHALL_HOST: 'imap.example.net',
      LIVE_CATCHALL_USER: 'catchall@ownpace.eu',
      LIVE_CATCHALL_PASSWORD: 'pw',
    });
    expect(config.on).toBe(true);
    if (config.on) {
      expect(config.port).toBe(993);
      expect(config.mailbox).toBe('INBOX');
      expect(config.announcement).toContain('ON');
      expect(config.announcement).toContain('imap.example.net');
      // The password is the one thing the announcement must never carry.
      expect(config.announcement).not.toContain('pw');
    }
  });
});

describe('searchTag: the widest net a tag allows', () => {
  it('asks for the tag in To OR Subject OR body, since the window start', async () => {
    const { client, calls } = fakeClient({ seqs: [] });
    await searchTag(ON, 'openmig-r2d2', new Date('2026-08-26T00:00:00Z'), () => client);
    expect(calls.searches).toHaveLength(1);
    const query = calls.searches[0] as { since: Date; or: Record<string, string>[] };
    expect(query.since).toEqual(new Date('2026-08-26T00:00:00Z'));
    // A silence check that only watched To: would call a body-tagged fan-out
    // mail "silence". All three, pinned.
    expect(query.or).toEqual([
      { to: 'openmig-r2d2' },
      { subject: 'openmig-r2d2' },
      { body: 'openmig-r2d2' },
    ]);
  });

  it('maps envelopes into evidence a red run can print', async () => {
    const { client } = fakeClient({
      seqs: [7],
      envelopes: {
        7: {
          subject: 'Uitnodiging: Standup',
          from: [{ address: 'calendar@provider.example' }],
          to: [{ address: 'openmig-attendee-r2d2@ownpace.eu' }],
        },
      },
    });
    const caught = await searchTag(ON, 'r2d2', new Date(), () => client);
    expect(caught).toEqual([
      {
        subject: 'Uitnodiging: Standup',
        from: 'calendar@provider.example',
        to: ['openmig-attendee-r2d2@ownpace.eu'],
      },
    ]);
  });

  it('always releases the mailbox and logs out, found or not', async () => {
    const { client, calls } = fakeClient({ seqs: [] });
    await searchTag(ON, 't', new Date(), () => client);
    expect(calls.released).toBe(1);
    expect(calls.loggedOut).toBe(1);
  });

  it('the silence assertion IS the search — no second, narrower code path', () => {
    expect(assertableSilence).toBe(searchTag);
  });
});

describe('waitForTag: the positive control returns evidence, never throws for absence', () => {
  it('polls until the mail arrives', async () => {
    let round = 0;
    const client = (): CatchallClient => {
      round += 1;
      const { client: c } = fakeClient(
        round < 3 ? { seqs: [] } : { seqs: [1], envelopes: { 1: { subject: 'control' } } },
      );
      return c;
    };
    const caught = await waitForTag(ON, 'tag', {
      since: new Date(),
      timeoutMs: 100,
      everyMs: 10,
      clientFor: client,
      sleep: async () => {},
    });
    expect(caught).toHaveLength(1);
    expect(round).toBe(3);
  });

  it('a closed window returns what it saw (nothing) instead of throwing — the CALLER words the red', async () => {
    const { client } = fakeClient({ seqs: [] });
    const caught = await waitForTag(ON, 'tag', {
      since: new Date(),
      timeoutMs: 30,
      everyMs: 10,
      clientFor: () => client,
      sleep: async () => {},
    });
    expect(caught).toEqual([]);
  });
});
