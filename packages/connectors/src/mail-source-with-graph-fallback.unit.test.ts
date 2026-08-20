// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The runtime IMAP→Graph fallback (workplan 0023 T3, ADR-0006).
 *
 * The property under test is the DECISION, not the transports: an auth-class
 * IMAP failure triggers exactly one lazily-built Graph probe and flips the
 * run; anything else propagates untouched; and when both transports fail the
 * error carries both messages.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SourceConnector, MailFolder } from '@openmig/shared';
import {
  MailSourceWithGraphFallback,
  isImapAuthFailure,
} from './mail-source-with-graph-fallback.ts';

const IMAP_FOLDERS: MailFolder[] = [{ path: 'INBOX', specialUse: 'inbox' }];
const GRAPH_FOLDERS: MailFolder[] = [{ path: 'Inbox', specialUse: 'inbox' }];

function fakeSource(overrides: Partial<SourceConnector>): SourceConnector {
  return {
    listFolders: vi.fn().mockResolvedValue(IMAP_FOLDERS),
    listSince: vi.fn().mockResolvedValue({ items: [], nextCursor: { value: 'c' } }),
    fetch: vi.fn().mockResolvedValue({ item: {}, rfc822: new Uint8Array() }),
    ...overrides,
  } as SourceConnector;
}

describe('isImapAuthFailure', () => {
  it.each([
    'AUTHENTICATE failed.',
    'LOGIN failed.',
    'Authentication failed',
    'No supported authentication method(s)',
    'invalid token',
    'Request failed: 401',
  ])('classifies %j as an auth failure', (msg) => {
    expect(isImapAuthFailure(new Error(msg))).toBe(true);
  });

  it.each(['read ECONNRESET', 'connect ETIMEDOUT 1.2.3.4:993', 'certificate has expired'])(
    'does NOT classify %j as an auth failure',
    (msg) => {
      expect(isImapAuthFailure(new Error(msg))).toBe(false);
    },
  );

  it('does not classify a non-Error', () => {
    expect(isImapAuthFailure('AUTHENTICATE failed')).toBe(false);
  });
});

describe('MailSourceWithGraphFallback', () => {
  it('delegates to IMAP when it works — the Graph source is never even built', async () => {
    const imap = fakeSource({});
    const buildGraph = vi.fn();
    const source = new MailSourceWithGraphFallback(imap, buildGraph);

    expect(await source.listFolders()).toEqual(IMAP_FOLDERS);
    await source.listSince(IMAP_FOLDERS[0]!);
    expect(buildGraph).not.toHaveBeenCalled();
    expect(source.usingGraphFallback).toBe(false);
  });

  it('flips to Graph on an auth-class IMAP failure and stays there', async () => {
    const imap = fakeSource({
      listFolders: vi.fn().mockRejectedValue(new Error('AUTHENTICATE failed.')),
    });
    const graph = fakeSource({ listFolders: vi.fn().mockResolvedValue(GRAPH_FOLDERS) });
    const buildGraph = vi.fn().mockReturnValue(graph);
    const source = new MailSourceWithGraphFallback(imap, buildGraph);

    expect(await source.listFolders()).toEqual(GRAPH_FOLDERS);
    expect(source.usingGraphFallback).toBe(true);

    // Subsequent calls all run on the Graph transport…
    await source.listSince(GRAPH_FOLDERS[0]!);
    await source.fetch({ messageId: '<a@x>', folder: GRAPH_FOLDERS[0]!, keywords: [], receivedAt: '', sourceRef: 'g1' });
    expect(graph.listSince).toHaveBeenCalledTimes(1);
    expect(graph.fetch).toHaveBeenCalledTimes(1);
    // …and IMAP is not retried, nor Graph rebuilt.
    expect(imap.listSince).not.toHaveBeenCalled();
    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(await source.listFolders()).toEqual(GRAPH_FOLDERS);
    expect(imap.listFolders).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-auth failure untouched — no probe', async () => {
    const imap = fakeSource({
      listFolders: vi.fn().mockRejectedValue(new Error('connect ETIMEDOUT 1.2.3.4:993')),
    });
    const buildGraph = vi.fn();
    const source = new MailSourceWithGraphFallback(imap, buildGraph);

    await expect(source.listFolders()).rejects.toThrow('ETIMEDOUT');
    expect(buildGraph).not.toHaveBeenCalled();
    expect(source.usingGraphFallback).toBe(false);
  });

  it('reports BOTH failures when the Graph probe also fails', async () => {
    const imap = fakeSource({
      listFolders: vi.fn().mockRejectedValue(new Error('AUTHENTICATE failed.')),
    });
    const graph = fakeSource({
      listFolders: vi.fn().mockRejectedValue(new Error('InvalidAuthenticationToken')),
    });
    const source = new MailSourceWithGraphFallback(imap, () => graph);

    await expect(source.listFolders()).rejects.toThrow(
      /AUTHENTICATE failed.*InvalidAuthenticationToken/s,
    );
    expect(source.usingGraphFallback).toBe(false);
  });

  it('reports both failures when even CONSTRUCTING the Graph source fails', async () => {
    const imap = fakeSource({
      listFolders: vi.fn().mockRejectedValue(new Error('LOGIN failed.')),
    });
    const source = new MailSourceWithGraphFallback(imap, () => {
      throw new Error('graph-mail source: OAUTH2_CLIENT_ID is not set');
    });

    await expect(source.listFolders()).rejects.toThrow(/LOGIN failed.*OAUTH2_CLIENT_ID/s);
  });

  it('delegates listSince/fetch to IMAP before any fallback happened', async () => {
    const imap = fakeSource({});
    const source = new MailSourceWithGraphFallback(imap, vi.fn());

    await source.listSince(IMAP_FOLDERS[0]!);
    await source.fetch({ messageId: '<a@x>', folder: IMAP_FOLDERS[0]!, keywords: [], receivedAt: '', sourceRef: 'INBOX:1' });
    expect(imap.listSince).toHaveBeenCalledTimes(1);
    expect(imap.fetch).toHaveBeenCalledTimes(1);
  });
});
