// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MAIL SERVER'S REFUSAL, LOGGED WITHOUT THE ADDRESS IT REFUSED (workplan
 * 0168).
 *
 * When a mail server refuses a recipient, nodemailer's error names them: in
 * the server's reply, which it keeps as `response` and appends to its own
 * message (`550 5.1.1 <…>: Recipient address rejected`), and in `rejected`
 * and `rejectedErrors`, each of those with its `recipient`. The mail channel
 * logs that error beside its own line (`access-notify.ts`), so a refused
 * grant, refusal or invitation put the person's address in the log.
 *
 * The error here is nodemailer's own, made by this package's `smtpTransport`
 * against a mail server in this process that refuses every recipient.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { formatWithOptions, inspect } from 'node:util';
import { log, loggableError } from '@openmig/shared';
import { smtpTransport } from './smtp-transport.ts';

const ADDRESS = 'someone-s1@example.com';

/** A mail server that greets, takes the sender, and refuses every recipient. */
function refusingEveryRecipient(): Server {
  return createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 mail.example.com ESMTP\r\n');
    let pending = '';
    socket.on('data', (chunk: string) => {
      pending += chunk;
      for (let end = pending.indexOf('\r\n'); end !== -1; end = pending.indexOf('\r\n')) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250 mail.example.com\r\n');
        else if (verb === 'MAIL' || verb === 'RSET') socket.write('250 2.1.0 Ok\r\n');
        else if (verb === 'RCPT') {
          socket.write(`550 5.1.1 ${line.slice(line.indexOf('<'))}: Recipient address rejected: User unknown\r\n`);
        } else if (verb === 'QUIT') socket.end('221 2.0.0 Bye\r\n');
        else socket.write('502 5.5.2 Error: command not recognized\r\n');
      }
    });
  });
}

let server: Server;
let refusal: unknown;

beforeAll(async () => {
  server = refusingEveryRecipient();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  const send = smtpTransport({ host: 'localhost', port, secure: false });
  try {
    await send({ from: 'ownpace@example.com', to: [ADDRESS], subject: 'Your access', body: 'Welcome.' });
  } catch (error) {
    refusal = error;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("a mail server's refusal", () => {
  it('names the address in nodemailer’s own error', () => {
    // What the log printed, before: the address four times over.
    const error = refusal as Error & Record<string, unknown>;
    expect(error.code).toBe('EENVELOPE');
    expect(error.message).toContain(`<${ADDRESS}>`);
    expect(error.response).toContain(ADDRESS);
    expect(error.rejected).toEqual([ADDRESS]);
    expect((error.rejectedErrors as Array<{ recipient?: string }>)[0]?.recipient).toBe(ADDRESS);
  });

  it('is printed without the address, and with what diagnoses it', () => {
    const printed = inspect(loggableError(refusal), { depth: Infinity });

    expect(printed, 'the log named the address').not.toContain('someone-s1');
    expect(printed).toContain("Can't send mail - all recipients were rejected: 550 5.1.1 <[redacted]>");
    expect(printed).toContain("code: 'EENVELOPE'");
    expect(printed).toContain('responseCode: 550');
    expect(printed).toContain("command: 'RCPT TO'");
  });

  it('is logged by the mail channel’s line without the address', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(formatWithOptions({ depth: Infinity }, ...args));
    });
    try {
      log.error('[access-notify] could not send the mail about access request 01980000-e29b-41d4-a716-446655440001:', refusal);
    } finally {
      vi.restoreAllMocks();
    }

    expect(lines.join('\n'), 'the log named the address').not.toContain('someone-s1');
    expect(lines.join('\n')).toContain('550 5.1.1 <[redacted]>: Recipient address rejected');
  });
});
