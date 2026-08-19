// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Which protocol carries contacts to the target (workplan 0031 T2.2).
 *
 * The failure this file is aimed at is not "the wrong class was returned". It
 * is that a JMAP contacts connection gets handed to the CardDAV writer, which
 * then talks CardDAV to a JMAP endpoint and fails as a 404 or a 405 — an error
 * naming the wrong layer entirely, at write time, after the operator has
 * configured everything and started a run.
 *
 * The mirror matters just as much: every EXISTING contacts mapping is CardDAV
 * and must stay CardDAV. A dispatcher that got adventurous with an unfamiliar
 * connection kind would move a customer mid-migration, which is precisely what
 * 0031 says must not happen.
 */

import { describe, it, expect } from 'vitest';
import { CardDAVTargetWriter } from '@openmig/engines';
import { JmapContactTarget } from '@openmig/connectors';
import type { Ledger, TenantId, MappingId } from '@openmig/shared';
import { buildContactTargetFor, contactTargetProtocol } from './contact-target-factory.ts';

const endpoint = { url: 'http://target.test', username: 'a@dev.local', password: 'pw' };
const deps = {
  ledger: {} as Ledger,
  tenantId: 't' as TenantId,
  mappingId: 'm' as MappingId,
};

describe('reading the protocol off a connection', () => {
  it('routes a `jmap` connection to JMAP', () => {
    // The managed schema calls this `connection.kind` and the self-host config
    // calls it `target.type`; both spell JMAP the same way, which is why one
    // function reads both.
    expect(contactTargetProtocol('jmap')).toBe('jmap');
  });

  it.each(['carddav', 'nextcloud', 'soverin', 'proton', 'o365', undefined, ''])(
    'leaves %s on CardDAV',
    (kind) => {
      // Everything unrecognised falls back rather than throwing. Throwing on an
      // unknown kind would have turned every existing contacts mapping into a
      // hard failure the day this shipped, and CardDAV is what they have always
      // been.
      expect(contactTargetProtocol(kind)).toBe('carddav');
    },
  );
});

describe('what actually gets built', () => {
  it('builds the JMAP target for a jmap connection', () => {
    const target = buildContactTargetFor('jmap', endpoint, deps);
    // Not `toBeDefined()`. The specific failure being prevented is a JMAP
    // connection handed to the CardDAV writer, which then speaks CardDAV to a
    // JMAP endpoint and fails at write time as a 404 — an error naming the
    // wrong layer, long after the operator could have been told.
    expect(target).toBeInstanceOf(JmapContactTarget);
    expect(target).not.toBeInstanceOf(CardDAVTargetWriter);
  });

  it('builds the CardDAV writer for everything else', () => {
    const target = buildContactTargetFor('carddav', endpoint, deps);
    expect(target).toBeInstanceOf(CardDAVTargetWriter);
    expect(target).not.toBeInstanceOf(JmapContactTarget);
  });

  it('gives the JMAP target the endpoint url as its baseUrl', () => {
    // `DavEndpoint.url` and `JmapContactTargetConfig.baseUrl` are the same fact
    // under two names, and getting the mapping wrong produces a connector that
    // constructs cleanly and cannot reach anything.
    const target = buildContactTargetFor('jmap', endpoint, deps) as unknown as {
      config: { baseUrl: string; username: string };
    };
    expect(target.config.baseUrl).toBe('http://target.test');
    expect(target.config.username).toBe('a@dev.local');
  });

  it('does not need a ledger to build the JMAP target', () => {
    // `JmapContactTarget` leaves recording to `runDomainSync`, exactly as
    // `JmapTargetWriter` does for mail. That is safe because the loop persists
    // `result.targetVersion` (domain-sync.ts), so the writer's stored-card
    // fingerprint still reaches the ledger and its overwrite protection works
    // on the next pass. Passing a deliberately unusable deps bundle proves the
    // JMAP path never touches it.
    const unusable = null as unknown as typeof deps;
    expect(() => buildContactTargetFor('jmap', endpoint, unusable)).not.toThrow();
  });
});
