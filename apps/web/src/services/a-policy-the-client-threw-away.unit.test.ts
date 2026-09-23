// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE FIELD THAT REACHED THE BROWSER AND NO SCREEN COULD READ (0125 T3).
 *
 * #1005 changed the detail route to answer the MAPPING's own config — its
 * `source_config_override` merged over its connection's, key by key, exactly as
 * a sync pass merges it — precisely so a screen could show the export policy in
 * force. Its own comment says why: *"a chooser showing the wrong current value
 * is worse than no chooser."*
 *
 * `MaskedConfigSchema` did not name `nativeFilePolicy`, and `z.object` STRIPS
 * what it does not name. So the value travelled the whole way and was thrown
 * away one line after arriving, and from a component's side that is
 * indistinguishable from a migration that has no policy at all — hard rule 9,
 * inside our own client.
 *
 * The kind of defect that only surfaces when somebody finally builds the
 * screen: the wire was right, the schema was silent, and nothing was red.
 */
import { describe, it, expect } from 'vitest';
import { MappingSchema } from './mapping-service.ts';

/** What GET /api/migrations/:id answers, trimmed to what this is about. */
const detailPayload = (sourceConfig: Record<string, unknown>) => ({
  id: 'm-1',
  tenantId: 't-1',
  name: 'Acme mail',
  sourceType: 'google',
  targetType: 'nextcloud',
  sourceConfig,
  targetConfig: { username: 'anna@nc.test', password: '***' },
  syncConfig: { domains: ['file'] },
  status: 'active',
  mode: 'mirror',
  domainStatus: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z',
});

describe('the policy survives the parse', () => {
  it.each(['refuse', 'export-odf', 'export-office', 'export-pdf'])(
    'keeps nativeFilePolicy=%s off the detail payload',
    (policy) => {
      const parsed = MappingSchema.parse(
        detailPayload({ username: 'owner@acme.test', password: '***', nativeFilePolicy: policy }),
      );
      expect(parsed.sourceConfig.nativeFilePolicy).toBe(policy);
    },
  );

  /**
   * ABSENT STAYS ABSENT — it does not become a policy. What an absent value
   * MEANS (`refuse`, the engine's default) is the panel's reading of it, and a
   * schema that filled it in here would make a migration with no override
   * indistinguishable from one that chose `refuse` on purpose.
   */
  it('does not invent a policy for a mapping that has none', () => {
    const parsed = MappingSchema.parse(detailPayload({ username: 'owner@acme.test' }));
    expect(parsed.sourceConfig.nativeFilePolicy).toBeUndefined();
  });

  /**
   * AND THE FORMAT PER KIND (workplan 0042 T9), for the same reason: stripped
   * here, the panel would read the single format alone and show "Office" for
   * decks the migration exports as `.odp`.
   */
  it('keeps the per-kind formats off the detail payload', () => {
    const parsed = MappingSchema.parse(
      detailPayload({
        username: 'owner@acme.test',
        nativeFilePolicy: 'export-office',
        nativeFilePolicies: { presentation: 'export-odf' },
      }),
    );
    expect(parsed.sourceConfig.nativeFilePolicies).toEqual({ presentation: 'export-odf' });
  });

  /**
   * AND THE ACCOUNT IS STILL THERE. The one field this schema was carrying
   * before, printed on the hub's "From … to …" line since 2026-09-17 — proof
   * the addition did not come at its expense.
   */
  it('still carries the account each side signs in as', () => {
    const parsed = MappingSchema.parse(
      detailPayload({ username: 'owner@acme.test', password: '***', nativeFilePolicy: 'export-pdf' }),
    );
    expect(parsed.sourceConfig.username).toBe('owner@acme.test');
    expect(parsed.targetConfig.username).toBe('anna@nc.test');
  });
});
