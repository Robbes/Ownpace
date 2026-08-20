// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The shared mail target construction, tested directly (workplan 0041 T3).
 *
 * Both editions reach these through their own resolvers, so a behaviour proven
 * twice through callers looks like two implementations agreeing rather than one
 * used twice. These pin the shared functions themselves.
 *
 * The TLS default is the assertion that earns its keep. It was written twice for
 * the target and twice for the source, and it encodes an asymmetry: being wrong
 * one way costs a connection error, being wrong the other way puts a password on
 * the wire. A silent flip to `false` is the kind of change that passes review.
 */

import { describe, it, expect } from 'vitest';
import { JmapTargetWriter, ImapFlowDavMailTarget } from '@openmig/connectors';
import { buildJmapTargetFrom, buildImapDavTargetFrom } from './mail-target-factory.ts';

const IMAP_DAV = { host: 'mail.example', port: 993, user: 'target@example' };

describe('buildJmapTargetFrom', () => {
  it('builds a JmapTargetWriter', () => {
    const target = buildJmapTargetFrom(
      { baseUrl: 'https://jmap.example', user: 'target@example' },
      'pw',
    );
    expect(target).toBeInstanceOf(JmapTargetWriter);
  });
});

describe('buildImapDavTargetFrom', () => {
  it('builds an ImapFlowDavMailTarget', () => {
    // PINS THE CUTOVER (workplan 0032 T3, 2026-08-06) — the WRITE path.
    expect(buildImapDavTargetFrom(IMAP_DAV, 'pw')).toBeInstanceOf(ImapFlowDavMailTarget);
  });

  it('defaults TLS ON when the mapping does not say', () => {
    // Was once `port === 993`, a literal port comparison, so an IMAPS server on
    // any other port got a CLEARTEXT socket. Asserted on the constructed config
    // rather than trusted, because the failure is silent and expensive.
    const target = buildImapDavTargetFrom(IMAP_DAV, 'pw') as unknown as {
      config?: { tls?: boolean };
    };
    expect(target.config?.tls).toBe(true);
  });

  it('honours an explicit tls: false', () => {
    // The other side of the default — a plaintext test server is legitimate, and
    // a default that could not be overridden would be its own bug.
    const target = buildImapDavTargetFrom({ ...IMAP_DAV, tls: false }, 'pw') as unknown as {
      config?: { tls?: boolean };
    };
    expect(target.config?.tls).toBe(false);
  });
});
