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
import { __setChannelForTests, tell } from './access-notify.ts';

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
