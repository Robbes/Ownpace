// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOGIN SENT IN THE CLEAR (workplan 0133 T2, item 5).
 *
 * The mail transport let nodemailer decide. On 587 it upgrades to STARTTLS
 * when the relay offers it, and when the relay does not, it sends the login
 * over plain SMTP. The identity provider's half of the same rule is that a
 * login is never sent without TLS; this is the API's and the appliance's.
 *
 * Read from the options the transport creates nodemailer with. A text guard
 * cannot show that a relay accepts the login; 0133 T4's test send does.
 *
 * - a login without implicit TLS insists on STARTTLS (`requireTLS`);
 * - a login on implicit TLS (465) is already encrypted, and needs nothing more;
 * - the catcher, with no login, is untouched.
 *
 * It fails today: nothing sets `requireTLS`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const created: Array<Record<string, unknown>> = [];
vi.mock('nodemailer', () => ({
  createTransport: (options: Record<string, unknown>) => {
    created.push(options);
    return { sendMail: async () => ({}) };
  },
}));

const { smtpTransport } = await import('./smtp-transport.ts');

const MESSAGE = { from: 'noreply@ownpace.test', to: ['owner@ownpace.test'], subject: 's', body: 'b' };

/** The options the transport is created with, on its first send. */
async function optionsFor(smtp: Parameters<typeof smtpTransport>[0]): Promise<Record<string, unknown>> {
  await smtpTransport(smtp)(MESSAGE);
  expect(created).toHaveLength(1);
  return created[0]!;
}

beforeEach(() => {
  created.length = 0;
});

describe('a login is never sent in the clear', () => {
  it('insists on STARTTLS for a login without implicit TLS', async () => {
    const options = await optionsFor({
      host: 'relay.ownpace.test',
      port: 587,
      secure: false,
      user: 'mailer',
      password: 'not-a-real-password',
    });
    expect(options.requireTLS).toBe(true);
    expect(options.secure).toBe(false);
    expect(options.auth).toEqual({ user: 'mailer', pass: 'not-a-real-password' });
  });

  it('insists on it for a user name alone, too', async () => {
    const options = await optionsFor({ host: 'relay.ownpace.test', port: 587, secure: false, user: 'mailer' });
    expect(options.requireTLS).toBe(true);
  });

  it('needs nothing more on implicit TLS', async () => {
    const options = await optionsFor({
      host: 'relay.ownpace.test',
      port: 465,
      secure: true,
      user: 'mailer',
      password: 'not-a-real-password',
    });
    expect(options.secure).toBe(true);
    expect(options).not.toHaveProperty('requireTLS');
  });

  it('leaves the catcher, with no login, as it was', async () => {
    const options = await optionsFor({ host: 'mailpit', port: 1025, secure: false });
    expect(options).not.toHaveProperty('requireTLS');
    expect(options).not.toHaveProperty('auth');
  });
});
