// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Telling one person (workplan 0095 T2/T3).
 *
 * The property worth the file: **the three outcomes stay three.** `sent`,
 * `off` and `failed` mean different things to the operator looking at the
 * grant screen — they know / nobody will ever tell them / something is broken —
 * and each implies a different next action. Collapsing `off` and `failed` into
 * "not sent", or either into a thrown error, is the change this guards against.
 *
 * And it must never throw. The caller has already committed a grant; an
 * exception here would report a completed provisioning as a failure, which is
 * the 0030 T4 rollback rule in the same shape.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
/**
 * Every message the transport was handed. The alternative — asserting on the
 * fixture we built ourselves — is a test of the fixture.
 *
 * The stub still THROWS on a channel with no usable host, so the `failed`
 * cases below keep meaning what they meant, and stop depending on a real
 * connection attempt failing fast.
 */
const SENT: Array<{ to: readonly string[]; subject: string; body: string }> = [];
vi.mock('@openmig/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/connectors')>();
  return {
    ...actual,
    smtpTransport: (smtp: { host?: string } | null) => async (message: {
      to: readonly string[];
      subject: string;
      body: string;
    }) => {
      if (!smtp || !smtp.host) throw new Error('no SMTP host');
      SENT.push(message);
    },
  };
});

import { __setChannelForTests, tell, tellOperator } from './access-notify.ts';

const EVENT = {
  kind: 'access_granted',
  organisation: 'Familie de Vries',
  appUrl: 'https://app.ownpace.eu',
  email: 'stranger@example.test',
} as const;

/** A channel shaped like `notifierFromEnv`'s return, with the SMTP we control. */
const channel = (overrides: Record<string, unknown> = {}) =>
  ({
    notifier: { notify: async () => {} },
    locale: 'en',
    announcement: '',
    config: {
      enabled: true,
      smtp: { host: 'localhost', port: 587, secure: false, user: 'u', pass: 'p' },
      settings: { from: 'ownpace@example.test', to: ['ops@example.test'] },
      ...overrides,
    },
  }) as unknown as Parameters<typeof __setChannelForTests>[0];

afterEach(() => {
  __setChannelForTests(null);
  vi.restoreAllMocks();
});

describe('the three outcomes', () => {
  it('answers OFF when no channel is configured, without pretending', () => {
    // The ordinary default. `off` has to reach the operator: it means the
    // manual step is back and they are the only one who can take it.
    __setChannelForTests(
      channel({ enabled: false, reason: 'SMTP_HOST is not set' }) as never,
    );
    return expect(tell('a@b.test', 'en', EVENT)).resolves.toBe('off');
  });

  it('answers FAILED when the mail server refuses, and does not throw', () => {
    // Distinct from `off`: we tried, and something is broken. Also the case
    // that must not become an exception — the grant already happened.
    __setChannelForTests(channel({ smtp: { host: '', port: 0 } }) as never);
    return expect(tell('a@b.test', 'en', EVENT)).resolves.toBe('failed');
  });
});

describe('what it does not do', () => {
  it('never rejects, whatever the channel does', async () => {
    // Belt and braces on the property the grant route depends on. A rejected
    // promise here turns a 201 into a 500 about a tenant that exists.
    __setChannelForTests(channel({ smtp: null }) as never);
    await expect(tell('a@b.test', 'nl', EVENT)).resolves.toMatch(/sent|off|failed/);
  });
});

/**
 * The other direction: the operator, at the fixed list, about somebody who is
 * not a member and is not being written to.
 */
describe('telling the operator that somebody knocked (0093 T3)', () => {
  const KNOCK = {
    kind: 'access_requested',
    email: 'stranger@example.test',
    organisation: 'Familie de Vries',
  } as const;

  it('answers OFF when no channel is configured', () => {
    // Which is the state the product shipped in: SMTP_HOST empty, so a request
    // arrived, a row was written, and nobody was told anything.
    __setChannelForTests(channel({ enabled: false, reason: 'SMTP_HOST is not set' }) as never);
    return expect(tellOperator(KNOCK)).resolves.toBe('off');
  });

  it('answers FAILED when the mail server refuses, and does not throw', () => {
    // The row is already committed. An exception here would turn a recorded
    // request into a 500 telling the asker to try again — and they would, and
    // there would be two rows.
    __setChannelForTests(channel({ smtp: { host: '', port: 0 } }) as never);
    return expect(tellOperator(KNOCK)).resolves.toBe('failed');
  });

  it('never rejects, whatever the channel does', async () => {
    __setChannelForTests(channel({ smtp: null }) as never);
    await expect(tellOperator(KNOCK)).resolves.toMatch(/sent|off|failed/);
  });

  it('sends to NOTIFY_TO, not to the person who asked', async () => {
    // The distinction between this and `tell`. Mailing the applicant "somebody
    // asked for access" would be absurd and would leak the operator's own
    // channel; the point is that a request reaches whoever answers it.
    //
    // Observed at the TRANSPORT. The first version of this case asserted on
    // the `channel()` fixture — which is a test of the fixture, and would have
    // passed with tellOperator sending to anybody at all.
    SENT.length = 0;
    __setChannelForTests(
      channel({
        settings: { from: 'ownpace@example.test', to: ['ops@example.test'], locale: 'en' },
      }) as never,
    );

    await expect(tellOperator(KNOCK)).resolves.toBe('sent');
    expect(SENT).toHaveLength(1);
    expect(SENT[0]?.to).toEqual(['ops@example.test']);
    expect(SENT[0]?.to, 'the applicant was mailed their own request').not.toContain(
      'stranger@example.test',
    );
    // Their address is in the BODY — that is what the operator replies to.
    expect(SENT[0]?.body).toContain('stranger@example.test');
  });

  it('renders in NOTIFY_LOCALE, and falls back to en when it is unset', async () => {
    SENT.length = 0;
    __setChannelForTests(
      channel({
        settings: { from: 'o@example.test', to: ['ops@example.test'], locale: 'nl' },
      }) as never,
    );
    await tellOperator(KNOCK);
    expect(SENT[0]?.subject).toContain('iemand vraagt toegang');

    SENT.length = 0;
    // No locale at all: NOTIFY_LOCALE is optional and `en` is what the rest of
    // the product settles on.
    __setChannelForTests(
      channel({ settings: { from: 'o@example.test', to: ['ops@example.test'] } }) as never,
    );
    await tellOperator(KNOCK);
    expect(SENT[0]?.subject).toContain('somebody asked for access');
  });
});
