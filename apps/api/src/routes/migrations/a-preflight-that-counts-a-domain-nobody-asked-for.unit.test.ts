// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PREFLIGHT COUNTED DOMAINS THE OWNER HAD SWITCHED OFF.
 *
 * `POST /api/migrations/:id/discover` read:
 *
 *     const domains = body.domains ?? [...DISCOVERY_DOMAINS];
 *
 * — a default that looks harmless and is not, because the caller that matters
 * never names domains. The confirm screen calls `mappingApi.discover(id)` with
 * no body at all, so EVERY preflight the product runs took that branch and
 * asked for all five.
 *
 * ## What the owner saw
 *
 * A full Microsoft-to-Nextcloud migration carrying everything BUT mail
 * (2026-09-07). Its preflight showed an Email row beside the four real ones,
 * and the Email row said
 *
 *     Unsupported target type: undefined
 *
 * because the mail arm resolved a mail target this mapping was never given.
 * Read from the outside that is the product failing to see somebody's mail.
 * What it actually was: nobody asked for mail, and the API asked anyway.
 *
 * ## Where the answer lives
 *
 * In `scope_selection`, which the API can see but the job is the one that
 * READS — and this is settled precedent in this codebase, not a new idea. The
 * start route already passes no domains for exactly this reason, in a comment
 * that predates the bug:
 *
 *     No `domains`: `run-delta-sync` resolves the mapping's own
 *     scope_selection when the payload omits them, which is the one place
 *     that decision belongs. Naming them here would let a stale copy of the
 *     scope sync a domain the owner had switched off.
 *
 * The sync side learned it live in #207 (2026-08-11). The preflight is the
 * same route with the same defaulting mistake, and it was the last one left.
 *
 * ## What this pins
 *
 * That the enqueued payload OMITS `domains` when the request does — an
 * absence, not an empty array, because the job's schema marks the field
 * optional and an empty array would read as "the owner selected nothing".
 * And that a caller who does name domains still gets exactly those, so a
 * narrower manual re-count is not collateral damage of the fix.
 */

import { describe, it, expect } from 'vitest';
import { DISCOVERY_DOMAINS } from '@openmig/shared';
import { resolveDiscoveryJob, resolveSyncJob } from './job-resolution.ts';

const TENANT = '11111111-1111-1111-1111-111111111111';
const MAPPING = '22222222-2222-2222-2222-222222222222';

describe('the preflight does not name the domains itself', () => {
  it('omits `domains` entirely when the request did not name any', () => {
    const { payload } = resolveDiscoveryJob(TENANT, MAPPING, {});

    expect(
      Object.keys(payload),
      'a `domains` key here overrides scope_selection with a list the API guessed: ' +
        'the owner who switched mail off got an Email row reading ' +
        '"Unsupported target type: undefined"',
    ).not.toContain('domains');
    expect(payload).toEqual({ tenantId: TENANT, mappingId: MAPPING });
  });

  it('does not smuggle the whole list back in as an empty array', () => {
    // Empty is a DIFFERENT claim from absent: `run-discovery` reads an empty
    // list as "the owner selected nothing", which is a real state a mapping
    // can be in and must not be fabricated here.
    const { payload } = resolveDiscoveryJob(TENANT, MAPPING, {});
    expect(payload.domains).toBeUndefined();
  });

  it('never defaults to every domain the product carries', () => {
    const { payload } = resolveDiscoveryJob(TENANT, MAPPING, {});
    expect(payload.domains).not.toEqual([...DISCOVERY_DOMAINS]);
    // The list is worth having in this file: were it ever one domain long,
    // the assertion above would pass by accident.
    expect(DISCOVERY_DOMAINS.length).toBeGreaterThan(1);
  });

  it('carries exactly the domains a caller did name, so a narrower re-count still works', () => {
    const { taskId, payload } = resolveDiscoveryJob(TENANT, MAPPING, { domains: ['calendar'] });

    expect(taskId).toBe('run-discovery');
    expect(payload.domains).toEqual(['calendar']);
  });

  it('copies the caller list rather than holding their array', () => {
    const asked = ['calendar', 'file'];
    const { payload } = resolveDiscoveryJob(TENANT, MAPPING, { domains: asked });
    asked.push('email');

    expect(payload.domains, 'the payload must not change under the caller').toEqual([
      'calendar',
      'file',
    ]);
  });

  it('resolves the same way the sync job does — ids only, no scope', () => {
    // The sibling this was made to match. If a `domains` key is ever added to
    // one of these payloads, it should be added to both on purpose.
    const sync = resolveSyncJob(TENANT, MAPPING, {});
    expect(sync.payload).toEqual({ tenantId: TENANT, mappingId: MAPPING });
  });
});
