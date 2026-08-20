// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What a tenant's mappings already cover (workplan 0028 T2).
 *
 * The asymmetry these tests exist to protect: being too generous makes the
 * detector miss a genuinely unmigrated mailbox; being too confident makes it
 * announce one the owner is already migrating. The second is worse — it
 * teaches the owner the queue is wrong, and a queue believed to be wrong is
 * worse than no queue at all. So an address we cannot resolve is reported as
 * UNSTATED, never assumed either way.
 */

import { describe, it, expect } from 'vitest';
import { resolveCoverage, coverageIncompleteReason } from './mapping-coverage.ts';
import type { MappingConfig } from '@openmig/shared';

const imap = (user: string): MappingConfig['source'] => ({
  type: 'imap-oauth2',
  host: 'outlook.office365.com',
  port: 993,
  user,
  auth: { kind: 'login', passwordFromEnv: 'NOPE' },
});

const graph = (mailbox?: string): MappingConfig['source'] =>
  ({ type: 'graph-mail', tenantId: 'contoso.example', ...(mailbox ? { mailbox } : {}) }) as
    MappingConfig['source'];

describe('mappings that state their mailbox', () => {
  it('takes the IMAP user, which IS the address', () => {
    const coverage = resolveCoverage([{ mappingId: 'm-1', source: imap('anna@acme.nl') }]);
    expect(coverage).toEqual({ addresses: ['anna@acme.nl'], unstated: [] });
  });

  it('takes a named Graph mailbox', () => {
    const coverage = resolveCoverage([{ mappingId: 'm-1', source: graph('gedeeld@acme.nl') }]);
    expect(coverage).toEqual({ addresses: ['gedeeld@acme.nl'], unstated: [] });
  });

  it('lower-cases, so coverage matches the directory case-insensitively', () => {
    const coverage = resolveCoverage([{ mappingId: 'm-1', source: imap('Anna@Acme.NL') }]);
    expect(coverage.addresses).toEqual(['anna@acme.nl']);
  });

  it('de-duplicates two mappings on the same mailbox', () => {
    // Mail and calendar for one person are two mappings, one mailbox.
    const coverage = resolveCoverage([
      { mappingId: 'm-1', source: imap('anna@acme.nl') },
      { mappingId: 'm-2', source: graph('anna@acme.nl') },
    ]);
    expect(coverage.addresses).toEqual(['anna@acme.nl']);
  });
});

describe('a mapping that does NOT state its mailbox', () => {
  it('is reported as unstated rather than guessed at', () => {
    // Delegated /me: resolvable only by asking Graph who the token belongs
    // to. A guess here produces a decision about a mailbox already being
    // migrated.
    const coverage = resolveCoverage([{ mappingId: 'm-1', source: graph() }]);
    expect(coverage).toEqual({ addresses: [], unstated: ['m-1'] });
  });

  it('does not suppress the addresses that COULD be resolved', () => {
    const coverage = resolveCoverage([
      { mappingId: 'm-1', source: imap('anna@acme.nl') },
      { mappingId: 'm-2', source: graph() },
    ]);
    expect(coverage.addresses).toEqual(['anna@acme.nl']);
    expect(coverage.unstated).toEqual(['m-2']);
  });
});

describe('sources that are not mailboxes', () => {
  it('neither cover an address nor leave one unstated', () => {
    // A WebDAV file source cannot be "a new mailbox", so it is not a gap in
    // coverage — counting it as unstated would disable detection for every
    // tenant that migrates files.
    const webdav = {
      type: 'webdav',
      url: 'https://cloud.acme.nl/remote.php/dav',
      user: 'anna',
      auth: { kind: 'login', passwordFromEnv: 'NOPE' },
    } as unknown as MappingConfig['source'];
    expect(resolveCoverage([{ mappingId: 'm-1', source: webdav }])).toEqual({
      addresses: [],
      unstated: [],
    });
  });
});

describe('the reason given when coverage is incomplete', () => {
  it('names the mappings and the one-line fix', () => {
    const reason = coverageIncompleteReason(['m-2', 'm-7']);
    expect(reason).toContain('m-2, m-7');
    // "Detection is degraded" without a remedy is a message an operator can
    // only file away.
    expect(reason).toContain('mailbox');
    expect(reason).toContain('NOT being reported');
  });

  it('says WHY silence was chosen over a possibly-wrong decision', () => {
    expect(coverageIncompleteReason(['m-2'])).toContain('already migrates');
  });
});
