// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Which domains are allowed to run at the same time.
 *
 * Domains ran strictly one after another — email, calendar, contacts, files —
 * and run #38 spent 939 seconds that way while three of the four servers sat
 * idle. But they are not independent: calendar, contacts and files usually
 * land on ONE Nextcloud, whose default SQLite is a single-writer database that
 * really does answer "database is locked" under concurrent writes. Overlapping
 * those three converts a slow migration into a failing one.
 *
 * So the rule is host-based, not domain-based: overlap only where no server is
 * shared. These tests pin that rule, because the failure it prevents shows up
 * as flaky 500s in someone else's migration rather than here.
 */

import { describe, it, expect } from 'vitest';
import { planDomainLanes, type SyncDomain } from './orchestration';
import type { MappingConfig } from '@openmig/shared';

const ALL: SyncDomain[] = ['email', 'calendar', 'contact', 'file'];

function dav(url: string) {
  return { type: 'caldav', url, user: 'u', auth: { kind: 'password', passwordFromEnv: 'P' } };
}

function config(domains: Record<string, { source: unknown; target: unknown }>): MappingConfig {
  return {
    tenantId: 't',
    mappingId: 'm',
    source: { type: 'imap-oauth2', host: 'imap.example.com', port: 993, user: 'u', auth: {} },
    target: { type: 'jmap', baseUrl: 'https://mail.example.com', user: 'u', auth: {} },
    domains,
  } as unknown as MappingConfig;
}

describe('domain lane planning', () => {
  it('runs mail alongside the DAV domains, and the DAV domains one at a time', () => {
    // The ordinary shape: Stalwart for mail, one Nextcloud for everything else.
    const lanes = planDomainLanes(
      config({
        mail: {
          source: { type: 'imap-oauth2', host: 'imap.mail.example.com' },
          target: { type: 'jmap', baseUrl: 'https://mail.example.com/jmap' },
        },
        calendar: { source: dav('https://cloud.example.com/dav'), target: dav('https://cloud.example.com/dav') },
        contacts: { source: dav('https://cloud.example.com/dav'), target: dav('https://cloud.example.com/dav') },
        files: { source: dav('https://cloud.example.com/dav'), target: dav('https://cloud.example.com/dav') },
      }),
      ALL,
    );

    expect(lanes).toHaveLength(2);
    expect(lanes).toContainEqual(['email']);
    // Together, and in order — never three at once against one SQLite.
    expect(lanes).toContainEqual(['calendar', 'contact', 'file']);
  });

  it('keeps everything sequential when one server holds all four domains', () => {
    const one = { source: dav('https://cloud.example.com/dav'), target: dav('https://cloud.example.com/dav') };
    const lanes = planDomainLanes(
      config({ mail: one, calendar: one, contacts: one, files: one }),
      ALL,
    );

    expect(lanes).toEqual([['email', 'calendar', 'contact', 'file']]);
  });

  it('merges lanes when a later domain bridges two servers', () => {
    // calendar touches A, contacts touches B — provisionally two lanes. Then
    // files touches BOTH, so nothing may overlap: A and B would each end up
    // with two domains hitting them at once. The lanes have to collapse.
    const lanes = planDomainLanes(
      config({
        calendar: { source: dav('https://a.example.com/dav'), target: dav('https://a.example.com/dav') },
        contacts: { source: dav('https://b.example.com/dav'), target: dav('https://b.example.com/dav') },
        files: { source: dav('https://a.example.com/dav'), target: dav('https://b.example.com/dav') },
      }),
      ['calendar', 'contact', 'file'],
    );

    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toEqual(expect.arrayContaining(['calendar', 'contact', 'file']));
  });

  it('separates domains that share nothing at all', () => {
    const lanes = planDomainLanes(
      config({
        calendar: { source: dav('https://a.example.com/dav'), target: dav('https://b.example.com/dav') },
        contacts: { source: dav('https://c.example.com/dav'), target: dav('https://d.example.com/dav') },
      }),
      ['calendar', 'contact'],
    );

    expect(lanes).toHaveLength(2);
  });

  it('cross-server migration still separates by host, not by direction', () => {
    // Reading from one provider and writing to another is the actual product.
    // calendar and contacts share BOTH hosts, so they stay sequential.
    const lanes = planDomainLanes(
      config({
        calendar: { source: dav('https://old.example.com/dav'), target: dav('https://new.example.com/dav') },
        contacts: { source: dav('https://old.example.com/dav'), target: dav('https://new.example.com/dav') },
      }),
      ['calendar', 'contact'],
    );

    expect(lanes).toEqual([['calendar', 'contact']]);
  });

  it('falls back to fully sequential for endpoints it cannot place', () => {
    // An unrecognised config shape must not be guessed to be isolated —
    // guessing wrong means concurrent writes to a server we did not identify.
    const lanes = planDomainLanes(
      config({
        calendar: { source: { type: 'mystery' }, target: { type: 'mystery' } },
        contacts: { source: { type: 'mystery' }, target: { type: 'mystery' } },
      }),
      ['calendar', 'contact'],
    );

    expect(lanes).toEqual([['calendar', 'contact']]);
  });

  it('a single enabled domain is one lane, exactly as before', () => {
    const lanes = planDomainLanes(
      config({ mail: { source: { host: 'imap.example.com' }, target: { baseUrl: 'https://mail.example.com' } } }),
      ['email'],
    );

    expect(lanes).toEqual([['email']]);
  });

  it('no enabled domains plans no work', () => {
    expect(planDomainLanes(config({}), [])).toEqual([]);
  });
});
