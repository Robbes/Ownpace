// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Naming a shared mailbox in a mapping (workplan 0027 T0 → T3).
 *
 * T0 gave the Graph connectors a `mailbox` option, and for a day nothing
 * could SET it: the option existed in code and no mapping file could reach
 * it, which is a capability that may as well not exist. This pins the config
 * surface that closes that gap — the one a Pattern S mapping will use to say
 * "migrate the shared store at this address" (SAD §14.1).
 *
 * Unset stays the default everywhere. Every mapping written before today
 * omits it and must keep meaning exactly what it meant: read `/me`.
 */

import { describe, it, expect } from 'vitest';
import { parseMappingConfigJson } from './config';

const base = (source: Record<string, unknown>) =>
  JSON.stringify({
    tenantId: '00000000-0000-4000-8000-000000000001',
    mappingId: '11111111-1111-4111-8111-111111111111',
    source,
    target: {
      type: 'jmap',
      baseUrl: 'http://127.0.0.1:1',
      user: 'nobody@invalid',
      auth: { kind: 'basic', passwordFromEnv: 'NOPE' },
    },
    domains: {},
  });

const GRAPH_TENANT = 'contoso.onmicrosoft.com';

describe('a Graph source without a mailbox', () => {
  it('parses, and carries no mailbox — the delegated default', () => {
    const config = parseMappingConfigJson(
      base({ type: 'graph-mail', tenantId: GRAPH_TENANT })
    );
    expect(config.source.type).toBe('graph-mail');
    // Absent, not empty-string: the connector treats undefined as /me and
    // refuses '' precisely because they are different intentions.
    expect((config.source as { mailbox?: string }).mailbox).toBeUndefined();
  });
});

describe('a Graph source naming a shared mailbox', () => {
  it('carries the address through for mail', () => {
    const config = parseMappingConfigJson(
      base({ type: 'graph-mail', tenantId: GRAPH_TENANT, mailbox: 'gedeeld@contoso.nl' })
    );
    expect((config.source as { mailbox?: string }).mailbox).toBe('gedeeld@contoso.nl');
  });

  it('does the same for calendar and contacts', () => {
    for (const type of ['graph-calendar', 'graph-contacts'] as const) {
      const config = parseMappingConfigJson(
        base({ type, tenantId: GRAPH_TENANT, mailbox: 'gedeeld@contoso.nl' }),
      );
      expect((config.source as { mailbox?: string }).mailbox, type).toBe('gedeeld@contoso.nl');
    }
  });

  it('survives a round trip through JSON', () => {
    // A mapping file is read, held, and written back by the appliance's config
    // tooling; a field that parses but does not survive re-serialisation would
    // silently revert a shared mailbox to /me on the next write.
    const first = parseMappingConfigJson(
      base({ type: 'graph-mail', tenantId: GRAPH_TENANT, mailbox: 'gedeeld@contoso.nl' })
    );
    const second = parseMappingConfigJson(JSON.stringify(first));
    expect((second.source as { mailbox?: string }).mailbox).toBe('gedeeld@contoso.nl');
  });
});
