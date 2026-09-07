// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect } from 'vitest';
import { graphFailure, graphRefusalBody, graphRefusalHint } from './graph-refusal.ts';

const GRAPH_403 = JSON.stringify({
  error: {
    code: 'Authorization_RequestDenied',
    message: 'Insufficient privileges to complete the operation.',
    innerError: {
      date: '2026-09-05T09:40:11',
      'request-id': '5d8a0d3e-0000-4000-8000-000000000000',
      'client-request-id': '5d8a0d3e-0000-4000-8000-000000000000',
    },
  },
});

describe("Graph's refusal, read without its envelope (0114 T6)", () => {
  it("keeps Graph's code and message, in Graph's words, and drops the envelope and the request ids", () => {
    const out = graphRefusalBody(GRAPH_403);
    expect(out).toBe('Authorization_RequestDenied — Insufficient privileges to complete the operation.');
    expect(out).not.toContain('{');
    expect(out).not.toContain('request-id');
  });

  it('passes any other body through untouched — a Nextcloud or a Stalwart refusal is not ours to reshape', () => {
    const dav = '<?xml version="1.0"?><d:error xmlns:d="DAV:"><s:exception>NotAuthenticated</s:exception></d:error>';
    expect(graphRefusalBody(dav)).toBe(dav);
    expect(graphRefusalBody('Forbidden')).toBe('Forbidden');
    expect(graphRefusalBody('')).toBe('');
    // JSON that is not a Graph error document is somebody else's JSON.
    expect(graphRefusalBody('{"value":[]}')).toBe('{"value":[]}');
    expect(graphRefusalBody('{"error":"nope"}')).toBe('{"error":"nope"}');
  });

  it('a Graph error with only one half keeps that half', () => {
    expect(graphRefusalBody('{"error":{"code":"InvalidAuthenticationToken"}}')).toBe('InvalidAuthenticationToken');
    expect(graphRefusalBody('{"error":{"message":"Access token has expired."}}')).toBe('Access token has expired.');
  });
});

describe('the way forward, when a face was not granted', () => {
  it('names the scope and the tick on a 403 that says the consent did not include the face', () => {
    const hint = graphRefusalHint(403, GRAPH_403, 'Mail', 'Mail.Read');
    expect(hint).toContain('does not include Mail.Read');
    expect(hint).toContain('reconnect the account with Mail ticked');
    // The tenant-policy case, so the sentence still has a way forward when
    // reconnecting alone cannot help.
    expect(hint).toContain('AADSTS65001');
    expect(hint).toContain('AADSTS90094');
  });

  it('says the same for a token Graph will not take (401), and for a bare 403', () => {
    expect(graphRefusalHint(401, '{"error":{"code":"InvalidAuthenticationToken","message":"x"}}', 'Files', 'Files.Read')).toContain('Files.Read');
    expect(graphRefusalHint(403, 'Forbidden', 'Contacts', 'Contacts.Read')).toContain('Contacts.Read');
  });

  it('says nothing about consent for a refusal that is about something else', () => {
    // A mailbox that is not there is a licence, not a tick.
    const noMailbox = JSON.stringify({
      error: { code: 'MailboxNotEnabledForRESTAPI', message: 'The mailbox is either inactive, soft-deleted, or is hosted on-premise.' },
    });
    expect(graphRefusalHint(404, noMailbox, 'Mail', 'Mail.Read')).toBe('');
    expect(graphRefusalHint(429, '{"error":{"code":"TooManyRequests","message":"slow down"}}', 'Mail', 'Mail.Read')).toBe('');
    expect(graphRefusalHint(500, '', 'Mail', 'Mail.Read')).toBe('');
  });
});

describe('graphFailure — the one line a Graph face reports', () => {
  it('is the status, the words without the envelope, and the way forward where there is one', () => {
    const line = graphFailure('Failed to list calendars', { status: 403, body: GRAPH_403 }, { face: 'Calendar', scope: 'Calendars.Read' });
    expect(line).toBe(
      'Failed to list calendars: 403 - Authorization_RequestDenied — Insufficient privileges to complete the operation.' +
        ' (a 403 here usually means the consent this connection carries does not include Calendars.Read — reconnect the ' +
        'account with Calendar ticked; if the organisation has turned off "Users can consent to applications", an ' +
        'administrator has to grant it once — Entra says AADSTS65001 or AADSTS90094 at the consent screen when that is the case)',
    );
  });

  it('carries no way forward when the caller names no face, and none when the refusal is not about a face', () => {
    expect(graphFailure('Graph answered', { status: 403, body: GRAPH_403 })).toBe(
      'Graph answered: 403 - Authorization_RequestDenied — Insufficient privileges to complete the operation.',
    );
    expect(graphFailure('Failed to download file', { status: 404, body: '{"error":{"code":"itemNotFound","message":"The resource could not be found."}}' }, { face: 'Files', scope: 'Files.Read' })).toBe(
      'Failed to download file: 404 - itemNotFound — The resource could not be found.',
    );
  });
});
