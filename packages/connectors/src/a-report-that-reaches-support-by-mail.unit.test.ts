// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REPORT THAT REACHES SUPPORT BY MAIL, on the wire (workplan 0130; the owner,
 * for the alpha, 2026-09-28).
 *
 * A problem report goes to the support mailbox through `smtpTransport`, the
 * one binding every mail the product sends goes through. The API's guard of
 * the same name proves what the report hands this transport; this proves what
 * nodemailer makes of it: a Reply-To header naming the reporter, and the
 * screenshot as an attachment of its own type. And that the relay's rules did
 * not loosen on the way: with a login and no implicit TLS, the connection must
 * upgrade or nothing is sent (workplan 0133 T2, item 5).
 *
 * And that a report is given up on in time. Somebody pressed Send and their
 * browser stops waiting at thirty seconds; nodemailer's own waits are two
 * minutes to connect, thirty seconds for the greeting and ten minutes of
 * silence. The timeouts the report hands the transport reach nodemailer as its
 * three options, and a mail that nobody waits on keeps nodemailer's defaults.
 *
 * nodemailer is replaced by itself with a stream transport, so the message is
 * rendered exactly as it would be sent, and no server is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SmtpSettings } from '@openmig/shared';

const seen = vi.hoisted(() => ({ options: [] as unknown[], raw: [] as string[] }));

vi.mock('nodemailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nodemailer')>();
  const createTransport = (options: unknown) => {
    seen.options.push(options);
    const render = actual.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    return {
      sendMail: async (mail: Parameters<typeof render.sendMail>[0]) => {
        const info = await render.sendMail(mail);
        seen.raw.push(String(info.message));
        return info;
      },
    };
  };
  return { ...actual, default: { ...actual.default, createTransport }, createTransport };
});

const { smtpTransport } = await import('./smtp-transport.ts');

const RELAY: SmtpSettings = {
  host: 'smtp.example.invalid',
  port: 587,
  secure: false,
  user: 'relay-user@example.invalid',
  password: 'test-password-not-real',
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeEach(() => {
  seen.options.length = 0;
  seen.raw.length = 0;
});

describe('a report mail on the wire', () => {
  it('names the reporter as Reply-To and carries the screenshot as an attachment of its own type', async () => {
    await smtpTransport(RELAY)({
      from: 'ownpace@example.invalid',
      to: ['support@example.invalid'],
      subject: 'Ownpace: It stopped',
      body: 'It stopped\n\n---\nPage: /moves\nReport: 9f8e7d6c',
      replyTo: 'someone@example.invalid',
      attachments: [{ filename: 'screenshot.png', contentType: 'image/png', base64: PNG.toString('base64') }],
    });

    const raw = seen.raw[0]!;
    expect(raw).toMatch(/^From: ownpace@example\.invalid$/m);
    expect(raw).toMatch(/^To: support@example\.invalid$/m);
    expect(raw).toMatch(/^Reply-To: someone@example\.invalid$/m);
    expect(raw).toMatch(/^Subject: Ownpace: It stopped$/m);
    expect(raw).toMatch(/^Content-Type: multipart\/mixed;/m);
    expect(raw).toMatch(/^Content-Type: text\/plain; charset=utf-8$/m);
    expect(raw).toMatch(/^Content-Type: image\/png; name=screenshot\.png$/m);
    expect(raw).toMatch(/^Content-Disposition: attachment; filename=screenshot\.png$/m);
    expect(raw).toContain(PNG.toString('base64'));
    expect(raw).toContain('Report: 9f8e7d6c');
  });

  it('adds neither when the message has neither, as every other mail does', async () => {
    await smtpTransport(RELAY)({ from: 'ownpace@example.invalid', to: ['operator@example.invalid'], subject: 's', body: 'b' });
    const raw = seen.raw[0]!;
    expect(raw).not.toMatch(/^Reply-To:/im);
    expect(raw).not.toMatch(/^Content-Disposition: attachment/im);
  });

  it('still never logs in over cleartext: with a login and no implicit TLS, it must upgrade', async () => {
    await smtpTransport(RELAY)({ from: 'a@example.invalid', to: ['b@example.invalid'], subject: 's', body: 'b', replyTo: 'c@example.invalid' });
    expect(seen.options[0]).toMatchObject({ host: 'smtp.example.invalid', port: 587, secure: false, requireTLS: true });
    expect(seen.options[0]).not.toHaveProperty('tls');
  });

  it('hands nodemailer the waits a report was given, and still upgrades', async () => {
    await smtpTransport(RELAY, { connectionMs: 10_000, greetingMs: 11_000, socketMs: 20_000 })({
      from: 'a@example.invalid',
      to: ['b@example.invalid'],
      subject: 's',
      body: 'b',
    });
    expect(seen.options[0]).toMatchObject({
      connectionTimeout: 10_000,
      greetingTimeout: 11_000,
      socketTimeout: 20_000,
      requireTLS: true,
    });
  });

  it("keeps nodemailer's own waits for a mail nobody is waiting on", async () => {
    await smtpTransport(RELAY)({ from: 'a@example.invalid', to: ['b@example.invalid'], subject: 's', body: 'b' });
    expect(seen.options[0]).not.toHaveProperty('connectionTimeout');
    expect(seen.options[0]).not.toHaveProperty('greetingTimeout');
    expect(seen.options[0]).not.toHaveProperty('socketTimeout');
  });
});
