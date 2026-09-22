// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The Layout's pure header/highlight helpers (0034 T3).
 *
 * Pinned as pure functions per the corrected guardrail: the fleet's draft of
 * T3 proposed "prefix-match on the path segments", which cannot light
 * `/deletions` from `/mappings/acme/deletions` under any prefix reading —
 * the mechanism here is the corrected one (screen-segment match on the flat
 * hrefs; `/mappings` wins on managed).
 */
import { describe, it, expect } from 'vitest';
import {
  activeNavHref,
  mappingDisplayName,
  mappingRouteContext,
  truncateMiddle,
  upHref,
} from './layout-context.ts';

const SELFHOST_HREFS = ['/confirm', '/deletions', '/moves', '/failures', '/verify', '/finish', '/decisions'];
const MANAGED_HREFS = ['/dashboard', '/mappings', '/decisions', '/tenants', '/billing'];

describe('mappingRouteContext', () => {
  it('parses screen and id from a per-mapping route', () => {
    expect(mappingRouteContext('/mappings/acme-mail/deletions')).toEqual({
      mappingId: 'acme-mail',
      screen: 'deletions',
    });
  });

  it('the hub itself has a mapping and no screen', () => {
    expect(mappingRouteContext('/mappings/acme-mail')).toEqual({
      mappingId: 'acme-mail',
      screen: null,
    });
  });

  it('the creation wizard and the list are NOT mapping contexts', () => {
    expect(mappingRouteContext('/mappings/new')).toBeNull();
    expect(mappingRouteContext('/mappings')).toBeNull();
  });

  it('decodes an encoded id', () => {
    expect(mappingRouteContext('/mappings/acme%20mail/verify')?.mappingId).toBe('acme mail');
  });
});

describe('activeNavHref', () => {
  it('selfhost: /mappings/acme/deletions lights the flat Deletions entry', () => {
    expect(activeNavHref('/mappings/acme/deletions', SELFHOST_HREFS)).toBe('/deletions');
  });

  it('selfhost: the hub lights nothing (it has no nav entry, by design)', () => {
    expect(activeNavHref('/mappings/acme', SELFHOST_HREFS)).toBeNull();
  });

  it('managed: every mapping-scoped path lights Mappings', () => {
    expect(activeNavHref('/mappings/acme/deletions', MANAGED_HREFS)).toBe('/mappings');
    expect(activeNavHref('/mappings/acme', MANAGED_HREFS)).toBe('/mappings');
  });

  it('keeps the plain prefix rule off mapping routes', () => {
    expect(activeNavHref('/deletions', SELFHOST_HREFS)).toBe('/deletions');
    expect(activeNavHref('/dashboard', MANAGED_HREFS)).toBe('/dashboard');
  });
});

describe('truncateMiddle', () => {
  it('keeps short ids whole and truncates long ones middle-out', () => {
    expect(truncateMiddle('acme-mail')).toBe('acme-mail');
    const long = 'a-very-long-mapping-identifier-from-config';
    const out = truncateMiddle(long, 20);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain('…');
    expect(out.startsWith('a-very-lo')).toBe(true);
    expect(out.endsWith('om-config')).toBe(true);
  });
});

describe('upHref — the header\'s back arrow goes UP a level', () => {
  it('from a migration\'s hub, up to the list of migrations', () => {
    // The owner's click, 2026-09-22: on the hub, the header's only link pointed
    // at the page they were on. Up from a hub is the list.
    expect(upHref({ mappingId: 'ff591fee-9e2a-4b64-9707-37de2233cb7b', screen: null })).toBe(
      '/mappings',
    );
  });

  it('from a screen under the hub, up to that hub', () => {
    expect(upHref({ mappingId: 'acme-mail', screen: 'failures' })).toBe('/mappings/acme-mail');
  });

  it('encodes an id it puts back into a path', () => {
    expect(upHref({ mappingId: 'a b/c', screen: 'verify' })).toBe('/mappings/a%20b%2Fc');
  });
});

describe('mappingDisplayName — a migration is called by its name', () => {
  const UUID = 'ff591fee-9e2a-4b64-9707-37de2233cb7b';

  it('uses the name the owner gave it', () => {
    expect(mappingDisplayName(UUID, 'Goog2NC')).toBe('Goog2NC');
  });

  it('falls back to the shortened id, never to a blank', () => {
    // While the name loads, when it could not be read, and on the appliance.
    expect(mappingDisplayName(UUID, undefined)).toBe(truncateMiddle(UUID));
    expect(mappingDisplayName(UUID, '   ')).toBe(truncateMiddle(UUID));
    expect(mappingDisplayName(UUID, '')).not.toBe('');
  });

  it('keeps an appliance slug as it is, because that slug already is a name', () => {
    expect(mappingDisplayName('acme-mail', undefined)).toBe('acme-mail');
  });
});
