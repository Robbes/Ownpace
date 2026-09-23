// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ERROR THE OPERATOR CAN FIND (workplan 0129 T1): every 500 the API answers
 * is recorded for the operator's log page, under the reference the person was
 * given.
 *
 * `serverFault` has answered every failed request with a reference since
 * workplan 0079, and the reference found the stack in the server's log, which
 * only somebody on the host could read. The same reference is now an event
 * the page can search: the route's code as the event, the organisation when
 * the request had one, and never the error's text.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Response } from 'express';
import { setAppEventSink, type AppEvent } from '@openmig/shared';
import { serverFault } from './server-fault.ts';

function fakeRes(locals?: Record<string, unknown>) {
  const sent: { status?: number; body?: { error?: string; reason?: string } } = {};
  const res = {
    ...(locals ? { locals } : {}),
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: { error?: string; reason?: string }) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, sent };
}

function recorded(): AppEvent[] {
  const events: AppEvent[] = [];
  setAppEventSink({ record: async (e) => void events.push(e) });
  return events;
}

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

describe('a request that answered 500', () => {
  it('is recorded under the reference the person was given', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = recorded();
    const tenantId = '0e240000-e29b-41d4-a716-446655440001';
    const { res, sent } = fakeRes({ tenantId });

    serverFault(res, 'list_failed', 'listing your connections', new Error('boom'));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      level: 'error',
      event: 'api.list_failed',
      reference: events[0]!.reference,
      tenantId,
    });
    expect(sent.body?.reason).toContain(`Reference ${events[0]!.reference}`);
  });

  it('keeps the error text out of the event, where the log line has it', () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = recorded();
    const { res } = fakeRes();

    serverFault(
      res,
      'unhandled',
      'handling this request',
      new Error('connect ECONNREFUSED postgres://owner:secret@db.internal:5432/app'),
    );

    expect(JSON.stringify(events)).not.toMatch(/ECONNREFUSED|secret|db\.internal/);
    const line = said.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(line).toContain(`[ref ${events[0]!.reference}]`);
  });

  it('belongs to no organisation when the request had none', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = recorded();
    const { res } = fakeRes();

    serverFault(res, 'unhandled', 'handling this request', new Error('boom'));

    expect(events[0]).not.toHaveProperty('tenantId');
  });
});
