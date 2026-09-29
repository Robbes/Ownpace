// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * An answer a page could not read, as the log keeps it (workplan 0145, the
 * owner's "Log it", 2026-09-29): what a page may say about it, and the one
 * line a server writes from that. Anybody signed in can write the body, so
 * what matters most here is what is DROPPED.
 */

import { describe, it, expect } from 'vitest';
import {
  UNREADABLE_ANSWER_EVENT,
  issuePathForLog,
  pageForLog,
  parseUnreadableAnswer,
  unreadableAnswerLogLine,
} from './unreadable-answer.ts';
import { APP_EVENT_NAME } from './app-event.ts';

describe('where in the answer, as the log keeps it', () => {
  it('keeps positions and field names from code', () => {
    expect(issuePathForLog([2, 'domains', 2])).toBe('2.domains.2');
    expect(issuePathForLog(['people', 0, 'counts', 'continuous'])).toBe('people.0.counts.continuous');
  });

  it('writes * for a key taken from data, which could be an address or a name', () => {
    expect(issuePathForLog(['byAddress', 'anna@example.nl', 'state'])).toBe('byAddress.*.state');
    expect(issuePathForLog(['0e320000-e29b-41d4-a716-446655440001', 'items'])).toBe('*.items');
    expect(issuePathForLog([Symbol('s'), 'x'])).toBe('*.x');
  });

  it('is empty for the whole answer, and stops at twelve steps', () => {
    expect(issuePathForLog([])).toBe('');
    expect(issuePathForLog(Array.from({ length: 20 }, (_, i) => i)).split('.')).toHaveLength(12);
  });
});

describe('the page, as the log keeps it', () => {
  it('keeps the words of the address, and writes :id for the rest', () => {
    expect(pageForLog('/mappings')).toBe('/mappings');
    expect(pageForLog('/people/0e320000-e29b-41d4-a716-446655440001')).toBe('/people/:id');
    // A link's page carries its token in its address.
    expect(pageForLog('/view/Zk3pQ9xT2mLw')).toBe('/view/:id');
    expect(pageForLog('/')).toBe('/');
    expect(pageForLog('/ui/mappings/acme-mail/deletions')).toBe('/ui/mappings/acme-mail/deletions');
  });
});

describe('a report, as the server takes it', () => {
  const body = {
    reference: '1a2b3c4d',
    code: 'invalid_value',
    path: '2.domains.2',
    page: '/mappings',
    build: { version: '0.3.1', commit: 'abc1234def5678abc1234def5678abc1234def56' },
  };

  it('keeps every field in its own shape', () => {
    expect(parseUnreadableAnswer(body)).toEqual({
      reference: '1a2b3c4d',
      code: 'invalid_value',
      path: '2.domains.2',
      page: '/mappings',
      pageVersion: '0.3.1',
      pageCommit: 'abc1234def5678abc1234def5678abc1234def56',
    });
  });

  it('keeps an empty path: the whole answer was refused', () => {
    expect(parseUnreadableAnswer({ ...body, path: '' })?.path).toBe('');
  });

  it('takes nothing without a reference to keep it under', () => {
    expect(parseUnreadableAnswer({ ...body, reference: undefined })).toBeUndefined();
    expect(parseUnreadableAnswer({ ...body, reference: 'not-hex!' })).toBeUndefined();
    expect(parseUnreadableAnswer({ ...body, reference: '1A2B3C4D' })).toBeUndefined();
    expect(parseUnreadableAnswer(null)).toBeUndefined();
    expect(parseUnreadableAnswer('1a2b3c4d')).toBeUndefined();
    expect(parseUnreadableAnswer([body])).toBeUndefined();
  });

  it('drops, and does not refuse, a field of another shape', () => {
    const said = parseUnreadableAnswer({
      reference: '1a2b3c4d',
      code: 'Invalid value, said by somebody',
      path: 'people.0.anna@example.nl',
      page: '/view/Zk3pQ9xT2mLw',
      build: { version: 'v1 with spaces', commit: 'not a commit' },
    });
    expect(said).toEqual({ reference: '1a2b3c4d' });
  });

  it('never lets a line break through, which would forge a line of the log', () => {
    const said = parseUnreadableAnswer({
      reference: '1a2b3c4d',
      code: 'invalid_value\n[api] something else',
      path: '2.domains\n.2',
      page: '/mappings\n',
      build: { version: '0.3.1\n', commit: 'abc1234\n' },
    });
    expect(said).toEqual({ reference: '1a2b3c4d' });
  });
});

describe('the line the server writes', () => {
  const report = {
    reference: '1a2b3c4d',
    code: 'invalid_value',
    path: '2.domains.2',
    page: '/mappings',
    pageVersion: '0.3.1',
    pageCommit: 'abc1234def5678',
  };

  it('names the reference, the issue, the page and both builds', () => {
    expect(unreadableAnswerLogLine(report, { version: '0.3.1', commit: 'abc1234def5678' })).toBe(
      '[web] a page could not read an answer [ref 1a2b3c4d]: invalid_value at 2.domains.2, on /mappings; ' +
        'page build 0.3.1 abc1234, server build 0.3.1 abc1234',
    );
  });

  it('says so when the builds differ: the likeliest cause', () => {
    expect(unreadableAnswerLogLine(report, { version: '0.3.2', commit: 'def5678abc1234' })).toBe(
      '[web] a page could not read an answer [ref 1a2b3c4d]: invalid_value at 2.domains.2, on /mappings; ' +
        'page build 0.3.1 abc1234, server build 0.3.2 def5678 (they differ)',
    );
  });

  it('does not call a commit it does not know a different one', () => {
    // `buildIdentity()` answers `unknown` on a server built by hand.
    expect(unreadableAnswerLogLine(report, { version: '0.3.1', commit: 'unknown' })).toBe(
      '[web] a page could not read an answer [ref 1a2b3c4d]: invalid_value at 2.domains.2, on /mappings; ' +
        'page build 0.3.1 abc1234, server build 0.3.1',
    );
  });

  it('says the whole answer, and what it does not know', () => {
    expect(unreadableAnswerLogLine({ reference: '1a2b3c4d', path: '' }, {})).toBe(
      '[web] a page could not read an answer [ref 1a2b3c4d]: an issue of an unknown kind in the whole answer; ' +
        'page build unknown, server build unknown',
    );
  });

  it('records under a name the log page takes', () => {
    expect(APP_EVENT_NAME.test(UNREADABLE_ANSWER_EVENT)).toBe(true);
  });
});
