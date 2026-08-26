// Copyright 2026 The Ownpace authors (Apache-2.0)

/** The one question a migration can ask a target with no side effects (0103 T3). */

import { describe, it, expect } from 'vitest';
import { detectCaldavScheduling } from './caldav-scheduling-probe.ts';
import type { HttpClient } from './dav-http.types.ts';

const answering = (headers: Record<string, string>, status = 200): HttpClient =>
  ({
    request: async () => ({ status, headers, body: '' }),
  }) as unknown as HttpClient;

describe('detectCaldavScheduling', () => {
  it('reads calendar-auto-schedule out of the DAV compliance list', async () => {
    const client = answering({ DAV: '1, 3, calendar-access, calendar-auto-schedule' });
    expect(await detectCaldavScheduling('https://t/cal/', 'Basic x', client)).toBe('auto-schedule');
  });

  it('answers none for a server that advertises calendar-access only', async () => {
    const client = answering({ dav: '1, 2, calendar-access' });
    expect(await detectCaldavScheduling('https://t/cal/', 'Basic x', client)).toBe('none');
  });

  it('does not mistake calendar-auto-schedule as a substring of another token', async () => {
    const client = answering({ DAV: 'calendar-auto-schedule-extended-x' });
    expect(await detectCaldavScheduling('https://t/cal/', 'Basic x', client)).toBe('none');
  });

  it('is case-insensitive about the header name — transports differ', async () => {
    const client = answering({ Dav: 'calendar-auto-schedule' });
    expect(await detectCaldavScheduling('https://t/cal/', 'Basic x', client)).toBe('auto-schedule');
  });

  it('answers unknown, never none, when OPTIONS fails — unmeasured is not safe', async () => {
    const failing = { request: async () => ({ status: 500, headers: {}, body: '' }) } as unknown as HttpClient;
    expect(await detectCaldavScheduling('https://t/cal/', 'Basic x', failing)).toBe('unknown');
    const throwing = {
      request: async () => {
        throw new Error('unreachable');
      },
    } as unknown as HttpClient;
    expect(await detectCaldavScheduling('https://t/cal/', 'Basic x', throwing)).toBe('unknown');
  });

  it('answers unknown when the DAV header is simply absent', async () => {
    expect(await detectCaldavScheduling('https://t/cal/', 'Basic x', answering({}))).toBe('unknown');
  });
});
