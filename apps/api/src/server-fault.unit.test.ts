// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A 500 must not answer with the bug (workplan 0079).
 *
 * Eleven routes answered `reason: String(error)`. The create route had already
 * stopped doing exactly that and written down why (workplan 0068): a driver
 * failure stringifies to something that can carry a connection string, a query
 * or a host — and a stringified error is not a sentence anyone can act on
 * either. It also gave the person no way to connect the red box in front of
 * them to the stack sitting in the log two metres away.
 *
 * So the two properties pinned here are: **nothing internal reaches the body**,
 * and **the body and the log share a reference**. The second is not decoration
 * — reference `e133a809` is the only reason the create-route 500 was ever
 * diagnosed rather than guessed at.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import { inspect } from 'node:util';
import { log } from '@openmig/shared';
import { serverFault } from './server-fault.ts';

/** Just enough Express Response to see what was sent. */
function fakeRes() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, sent };
}

beforeEach(() => vi.restoreAllMocks());

describe('serverFault', () => {
  it('never puts the error itself in the response body', () => {
    const { res, sent } = fakeRes();
    // The shape that actually bites: a driver error carrying a DSN.
    const err = new Error(
      'connect ECONNREFUSED postgres://openmigrate:hunter2@10.0.0.5:5432/openmigrate',
    );

    serverFault(res, 'list_failed', 'listing your connections', err);

    const body = JSON.stringify(sent.body);
    expect(sent.status).toBe(500);
    expect(body, 'the credential in the driver error reached the browser').not.toContain('hunter2');
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toContain('10.0.0.5');
  });

  it('shares one reference between the log line and the body', () => {
    // This is what makes a red box on a phone traceable to a stack in the log.
    const logged: string[] = [];
    vi.spyOn(log, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(String(args[0]));
    });
    const { res, sent } = fakeRes();

    serverFault(res, 'add_failed', 'adding this connection', new Error('boom'));

    const body = (sent.body as { reason: string }).reason;
    const ref = /Reference ([0-9a-f]{8})/.exec(body)?.[1];
    expect(ref, 'the response carries no reference to quote').toBeTruthy();
    expect(logged.join('\n'), 'the log line does not carry the same reference').toContain(
      `[ref ${ref}]`,
    );
  });

  it('keeps the machine-readable code, and says it is our fault', () => {
    const { res, sent } = fakeRes();
    serverFault(res, 'rotate_failed', 'replacing these credentials', new Error('boom'));

    const body = sent.body as { error: string; reason: string };
    expect(body.error).toBe('rotate_failed');
    // The person did nothing wrong, and the sentence says so — a 500 that
    // reads like a refusal sends somebody hunting through their own input.
    expect(body.reason).toContain('fault on our side');
    expect(body.reason).toContain('replacing these credentials');
  });

  it("never prints an error's body, and still prints its message and stack", () => {
    // A parser's error carries the raw request text as `body` (#1490's
    // review): a stranger's address and note, printed with the error. Any
    // other error that carries a body could do the same, in its cause or
    // among the errors it gathers.
    const printed: string[] = [];
    vi.spyOn(log, 'error').mockImplementation((...args: unknown[]) => {
      printed.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: Infinity }))).join(' '));
    });
    const inner = Object.assign(new Error('the inner one'), { body: 'BODY-IN-THE-CAUSE' });
    const gathered = Object.assign(new Error('one of several'), { body: 'BODY-IN-THE-LIST' });
    const err = Object.assign(new Error('the outer one', { cause: inner }), {
      status: 400,
      type: 'entity.parse.failed',
      body: '{"email":"body-s1@example.test","note":"BODY-S1",',
      errors: [gathered],
    });
    const { res } = fakeRes();

    serverFault(res, 'unhandled', 'handling this request', err);

    const line = printed.join('\n');
    for (const value of ['body-s1', 'BODY-S1', 'BODY-IN-THE-CAUSE', 'BODY-IN-THE-LIST']) {
      expect(line, `the log printed ${value}`).not.toContain(value);
    }
    // Everything else as it was: the message, the stack, the other fields.
    expect(line).toContain('the outer one');
    expect(line).toContain('server-fault.unit.test.ts');
    expect(line).toContain('the inner one');
    expect(line).toContain('one of several');
    expect(line).toContain("type: 'entity.parse.failed'");
    // And the caller's error is left as it was handed in.
    expect(err.body).toContain('BODY-S1');
    expect(inner.body).toBe('BODY-IN-THE-CAUSE');
  });

  it('prints an error with no body exactly as before', () => {
    const printed: unknown[][] = [];
    vi.spyOn(log, 'error').mockImplementation((...args: unknown[]) => {
      printed.push(args);
    });
    const err = Object.assign(new Error('boom', { cause: new Error('under it') }), { code: 'ECONNREFUSED' });
    const { res } = fakeRes();

    serverFault(res, 'list_failed', 'listing your connections', err);

    expect(inspect(printed[0]![1], { depth: Infinity })).toBe(inspect(err, { depth: Infinity }));
  });

  it('mints a different reference each time', () => {
    const refs = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { res, sent } = fakeRes();
      serverFault(res, 'probe_failed', 'testing this connection', new Error('boom'));
      refs.add(/Reference ([0-9a-f]{8})/.exec((sent.body as { reason: string }).reason)![1]!);
    }
    // A reference shared between two faults finds two stacks and settles nothing.
    expect(refs.size).toBe(5);
  });
});
