// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import { parseMappingConfigJson } from './config.ts';

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

describe('declaring the §14.1 pattern (workplan 0027 T3)', () => {
  const parse = (pattern: unknown, source: Record<string, unknown>) =>
    parseMappingConfigJson(
      JSON.stringify({ ...(JSON.parse(base(source)) as Record<string, unknown>), pattern }),
    );

  it('accepts shared_s', () => {
    const config = parse('shared_s', {
      type: 'graph-mail',
      tenantId: GRAPH_TENANT,
      mailbox: 'gedeeld@contoso.nl',
    });
    expect(config.pattern).toBe('shared_s');
  });

  it('REFUSES distribution_d, and names the work it actually needs', () => {
    // A distribution list has no store, so a mapping for one would connect,
    // find nothing, and report a successful empty migration — after which
    // the owner cuts over to an address that reaches nobody.
    expect(() => parse('distribution_d', { type: 'graph-mail', tenantId: GRAPH_TENANT })).toThrow(
      /no message store to copy/,
    );
    expect(() => parse('distribution_d', { type: 'graph-mail', tenantId: GRAPH_TENANT })).toThrow(
      /runbook/,
    );
  });

  it('refuses a value that is neither', () => {
    expect(() => parse('shared', { type: 'graph-mail', tenantId: GRAPH_TENANT })).toThrow(
      /expected 'shared_s'/,
    );
  });

  it('leaves an ordinary mapping without one', () => {
    const config = parseMappingConfigJson(base({ type: 'graph-mail', tenantId: GRAPH_TENANT }));
    // Almost every mapping is neither pattern and must not have to say so.
    expect(config.pattern).toBeUndefined();
  });

  it('survives a round trip through JSON', () => {
    const first = parse('shared_s', {
      type: 'graph-mail',
      tenantId: GRAPH_TENANT,
      mailbox: 'gedeeld@contoso.nl',
    });
    expect(parseMappingConfigJson(JSON.stringify(first)).pattern).toBe('shared_s');
  });
});
