// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

import { describe, it, expect } from 'vitest';
import type { ScopeManifest } from '@openmig/shared';
import { renderConfirmPage, type MappingConfirmView } from './confirm-page';

const MANIFEST: ScopeManifest = {
  version: '2026-07-21',
  migrates: [{ item: 'Files', detail: 'OneDrive / SharePoint document libraries.' }],
  partial: [{ item: 'Permissions', detail: 'Best-effort.' }],
  doesNotMigrate: [{ item: 'Teams chat', detail: 'Not migrated.' }],
};

describe('renderConfirmPage', () => {
  it('shows a scanning placeholder for a mapping with no discovery yet', () => {
    const view: MappingConfirmView = { mappingId: 'm1', status: 'paused', domains: [] };
    const html = renderConfirmPage({ mappings: [view], manifest: MANIFEST });
    expect(html).toContain('Scanning your source');
    expect(html).toContain('m1');
  });

  it('renders discovery counts and a Start migration form for a paused mapping', () => {
    const view: MappingConfirmView = {
      mappingId: 'm1',
      status: 'paused',
      domains: [
        { domain: 'email', collections: 4, items: 1200, bytes: 5_000_000, discoveredAt: '2026-07-21T00:00:00Z' },
      ],
    };
    const html = renderConfirmPage({ mappings: [view], manifest: MANIFEST });
    expect(html).toContain('1200');
    expect(html).toContain('<form method="POST" action="/mappings/m1/start">');
    expect(html).toContain('Start migration');
  });

  it('shows status instead of a Start form once a mapping is already active', () => {
    const view: MappingConfirmView = { mappingId: 'm1', status: 'active', domains: [] };
    const html = renderConfirmPage({ mappings: [view], manifest: MANIFEST });
    expect(html).not.toContain('Start migration');
    expect(html).toContain('active');
  });

  it('surfaces a domain discovery error', () => {
    const view: MappingConfirmView = {
      mappingId: 'm1',
      status: 'paused',
      domains: [
        { domain: 'file', collections: 0, items: 0, discoveredAt: '2026-07-21T00:00:00Z', lastError: 'auth failed' },
      ],
    };
    const html = renderConfirmPage({ mappings: [view], manifest: MANIFEST });
    expect(html).toContain('auth failed');
  });

  it('renders the scope manifest columns', () => {
    const html = renderConfirmPage({ mappings: [], manifest: MANIFEST });
    expect(html).toContain('Files');
    expect(html).toContain('Permissions');
    expect(html).toContain('Teams chat');
    expect(html).toContain('No mappings configured.');
  });

  it('offers the way through to the operating UI once something has started', () => {
    // Before this, the confirm page was where an operator landed AND where they
    // stopped: everything after "Start migration" was reachable only by knowing
    // to curl an endpoint (ADR-0026).
    const view: MappingConfirmView = {
      mappingId: 'acme',
      status: 'active',
      domains: [{ domain: 'email', collections: 1, items: 1, discoveredAt: '2026-07-21T00:00:00Z' }],
    };
    const html = renderConfirmPage({ mappings: [view], manifest: MANIFEST });
    expect(html).toContain('href="/ui/deletions"');
    expect(html).toContain('Open the migration console');
  });

  it('does not offer it while every mapping is still paused', () => {
    // A paused mapping has copied nothing, so it cannot have diverged: the link
    // would lead to three empty lists and teach the operator the queues are
    // useless.
    const view: MappingConfirmView = {
      mappingId: 'acme',
      status: 'paused',
      domains: [{ domain: 'email', collections: 1, items: 1, discoveredAt: '2026-07-21T00:00:00Z' }],
    };
    const html = renderConfirmPage({ mappings: [view], manifest: MANIFEST });
    expect(html).not.toContain('Open the migration console');
  });

  it('escapes untrusted mapping ids / error text', () => {
    const view: MappingConfirmView = {
      mappingId: '<script>alert(1)</script>',
      status: 'paused',
      domains: [
        { domain: 'email', collections: 0, items: 0, discoveredAt: '2026-07-21T00:00:00Z', lastError: '<b>bad</b>' },
      ],
    };
    const html = renderConfirmPage({ mappings: [view], manifest: MANIFEST });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>bad</b>');
  });
});
