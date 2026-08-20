// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `mailbox_mapping.pattern`'s first reader (workplan 0027 T3).
 *
 * The two refusals are what this module is for, and both describe a mapping
 * that would report a clean success while doing the wrong thing: a
 * distribution list copied as a mailbox (nothing to copy, "done"), and a
 * shared mailbox whose source still reads `/me` (the wrong mailbox copied
 * into the shared target, "done").
 */

import { describe, it, expect } from 'vitest';
import type { MappingConfig } from '@openmig/shared';
import {
  patternForSource,
  assertMappingPattern,
  resolveMappingPattern,
} from './mapping-pattern.ts';

const base = (overrides: Partial<MappingConfig> = {}): MappingConfig =>
  ({
    tenantId: '11111111-1111-4111-8111-111111111111',
    mappingId: 'acme-shared',
    source: { type: 'graph-mail', tenantId: 'graph-tenant' },
    target: {
      type: 'jmap',
      baseUrl: 'http://target',
      user: 'info@sovereign.nl',
      auth: { kind: 'basic', passwordFromEnv: 'X' },
    },
    ...overrides,
  }) as MappingConfig;

describe('what the source implies', () => {
  it('a Graph source naming a mailbox is Pattern S', () => {
    // `/users/{address}` is the only way to reach a store with no interactive
    // user to sign in as, which is what a shared mailbox is.
    expect(
      patternForSource({ type: 'graph-mail', tenantId: 't', mailbox: 'info@acme.nl' } as never),
    ).toBe('shared_s');
  });

  it('a Graph source WITHOUT one is not a pattern at all', () => {
    // `undefined` means "an ordinary personal mailbox", not "unknown".
    expect(patternForSource({ type: 'graph-mail', tenantId: 't' } as never)).toBeUndefined();
  });

  it('an empty mailbox string does not count', () => {
    expect(
      patternForSource({ type: 'graph-mail', tenantId: 't', mailbox: '   ' } as never),
    ).toBeUndefined();
  });

  it('an IMAP source is never Pattern S, whatever it carries', () => {
    // IMAP authenticates AS the account; there is no other-mailbox read.
    expect(
      patternForSource({
        type: 'imap-oauth2',
        host: 'h',
        port: 993,
        user: 'info@acme.nl',
        auth: { kind: 'login', passwordFromEnv: 'X' },
      } as never),
    ).toBeUndefined();
  });
});

describe('the refusals', () => {
  it('refuses a mapping declaring shared_s whose source reads /me', () => {
    const config = base({ pattern: 'shared_s' });

    // This is the dangerous one: it would connect, copy the credential
    // owner's OWN mailbox into the shared target, and report success.
    expect(() => assertMappingPattern(config)).toThrow(/does not name a mailbox/);
    expect(() => assertMappingPattern(config)).toThrow(/source\.mailbox/);
  });

  it('refuses distribution_d, and says what to do instead', () => {
    const config = base({ pattern: 'distribution_d' as never });

    expect(() => assertMappingPattern(config)).toThrow(/no message store to copy/);
    // Not only what is wrong: where the actual work is.
    expect(() => assertMappingPattern(config)).toThrow(/runbook/);
  });

  it('accepts a shared_s mapping whose source names the mailbox', () => {
    expect(() =>
      assertMappingPattern(
        base({
          pattern: 'shared_s',
          source: { type: 'graph-mail', tenantId: 't', mailbox: 'info@acme.nl' } as never,
        }),
      ),
    ).not.toThrow();
  });

  it('says nothing about an ordinary mapping', () => {
    // Almost every mapping is neither pattern, and must not have to say so.
    expect(() => assertMappingPattern(base())).not.toThrow();
  });
});

describe('what gets persisted', () => {
  it('is the declaration when there is one', () => {
    expect(
      resolveMappingPattern(
        base({
          pattern: 'shared_s',
          source: { type: 'graph-mail', tenantId: 't', mailbox: 'info@acme.nl' } as never,
        }),
      ),
    ).toBe('shared_s');
  });

  it('is inferred from the source when there is not', () => {
    // A mapping that names a shared mailbox IS Pattern S whether or not
    // somebody wrote the word down; the ledger should say so either way.
    expect(
      resolveMappingPattern(
        base({ source: { type: 'graph-mail', tenantId: 't', mailbox: 'info@acme.nl' } as never }),
      ),
    ).toBe('shared_s');
  });

  it('is nothing for an ordinary mapping', () => {
    expect(resolveMappingPattern(base())).toBeUndefined();
  });
});
