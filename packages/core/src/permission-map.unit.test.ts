// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The §14.2 mapping table (workplan 0029 T2).
 *
 * §14.2 says what NOT to build: a fragile full ACL translator. So the tests
 * that matter are the ones pinning the table's honesty — that an unknown
 * right becomes `manual` rather than a guess, that a sharing LINK is never
 * treated as a person's right, and that `clean` never means "we did it".
 */

import { describe, it, expect } from 'vitest';
import type { PermissionGrant } from '@openmig/shared';
import { mapGrant } from './permission-map.ts';

const grant = (overrides: Partial<PermissionGrant> = {}): PermissionGrant => ({
  subject: 'calendar',
  on: 'Rob — Calendar',
  grantee: 'anna@acme.nl',
  role: 'read',
  raw: '{}',
  ...overrides,
});

describe('calendar shares', () => {
  it('map cleanly, read-only', () => {
    const m = mapGrant(grant());
    expect(m.verdict).toBe('clean');
    expect(m.target).toContain('read-only');
  });

  it('map cleanly, writable', () => {
    for (const role of ['write', 'owner', 'editor']) {
      const m = mapGrant(grant({ role }));
      expect(m.verdict, role).toBe('clean');
      expect(m.target, role).toContain('write');
    }
  });
});

describe('drive shares', () => {
  it('map cleanly when a person holds them', () => {
    const m = mapGrant(grant({ subject: 'drive_item', on: '/Budget.xlsx', role: 'write' }));
    expect(m.verdict).toBe('clean');
    expect(m.target).toContain('edit permission');
  });

  it('are MANUAL when they are a sharing link', () => {
    const m = mapGrant(
      grant({ subject: 'drive_item', on: '/Budget.xlsx', role: 'write', viaLink: true }),
    );

    // A link is a URL that works for whoever has it, not a right held by
    // anybody — migrating it silently would carry that access across without
    // anybody choosing to.
    expect(m.verdict).toBe('manual');
    expect(m.target).toContain('whether this link should exist at all');
  });
});

describe('mailbox rights', () => {
  it('send FullAccess to the app-password convention', () => {
    const m = mapGrant(grant({ subject: 'mailbox', on: 'info@acme.nl', role: 'FullAccess' }));
    expect(m.verdict).toBe('manual');
    expect(m.target).toContain('app password');
    expect(m.note).toContain('withdrawn individually');
  });

  it('name Send-As as a target platform setting', () => {
    for (const role of ['SendAs', 'SendOnBehalf']) {
      const m = mapGrant(grant({ subject: 'mailbox', on: 'info@acme.nl', role }));
      expect(m.verdict, role).toBe('manual');
      expect(m.target, role).toContain('Send-As');
    }
  });
});

describe('the fallback', () => {
  it('is MANUAL for a right the table has never seen', () => {
    const m = mapGrant(grant({ subject: 'mailbox', on: 'x', role: 'SomeExchangeRoleFrom2027' }));

    // Total by construction: a right with no entry is exactly the one an
    // owner must be told about, so it is never dropped and never guessed.
    expect(m.verdict).toBe('manual');
    expect(m.target).toContain('no equivalent is known');
  });

  it('never invents a third verdict', () => {
    // Anything fuzzier than clean-or-manual invites the translator §14.2
    // says not to build.
    const verdicts = new Set(
      ['read', 'write', 'FullAccess', 'SendAs', 'nonsense'].map((role) => mapGrant(grant({ role })).verdict),
    );
    for (const v of verdicts) expect(['clean', 'manual']).toContain(v);
  });
});
