// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Running the permission inventory (workplan 0029 T1/T3).
 *
 * The load-bearing test is the first one: the mailbox-delegation section is
 * present whatever the caller passed. FullAccess and SendAs cannot be read
 * through Graph at all, so a report is only honest if it says so — and the
 * way that sentence would get lost is the way sections always get lost, a
 * caller that forgot to add one.
 */

import { describe, it, expect, vi } from 'vitest';
import { runPermissionInventory } from './run-permission-inventory.ts';

const REASON = 'Graph does not expose them — use Get-MailboxPermission';

describe('the section that is never optional', () => {
  it('appears even when the caller passes no scans at all', async () => {
    const md = await runPermissionInventory({ delegationReason: REASON });

    expect(md).toContain('Mailbox delegation');
    expect(md).toContain('Get-MailboxPermission');
  });

  it('appears above what was found', async () => {
    const md = await runPermissionInventory({
      delegationReason: REASON,
      scanCalendars: async () => ({
        kind: 'listed',
        grants: [
          { subject: 'calendar', on: 'Rob — Calendar', grantee: 'anna@acme.nl', role: 'read', raw: '{}' },
        ],
      }),
    });

    // Buried under the findings it gets skipped, and it is the dangerous half.
    expect(md.indexOf('Mailbox delegation')).toBeLessThan(md.indexOf('Rob — Calendar'));
  });
});

describe('a category with no reader', () => {
  it('is stated as uninventoried, not omitted', async () => {
    const md = await runPermissionInventory({ delegationReason: REASON });

    // A category that vanished from the report would be indistinguishable
    // from one that came back empty.
    expect(md).toContain('File and folder sharing');
    expect(md).toContain('Nothing was looked at either way');
  });
});

describe('a scan that throws', () => {
  it('becomes a stated blind spot rather than a lost report', async () => {
    const error = vi.fn();
    const md = await runPermissionInventory({
      delegationReason: REASON,
      scanDrive: async () => {
        throw new Error('token expired');
      },
      error,
    });

    expect(md).toContain('the scan failed: token expired');
    expect(error).toHaveBeenCalledOnce();
  });

  it('does not stop the other categories', async () => {
    const md = await runPermissionInventory({
      delegationReason: REASON,
      scanDrive: async () => {
        throw new Error('boom');
      },
      scanCalendars: async () => ({
        kind: 'listed',
        grants: [{ subject: 'calendar', on: 'Team', grantee: 'jan@acme.nl', role: 'write', raw: '{}' }],
      }),
    });

    expect(md).toContain('Team');
    expect(md).toContain('boom');
  });
});

describe('the findings', () => {
  it('carry the mapping table’s verdict into the report', async () => {
    const md = await runPermissionInventory({
      delegationReason: REASON,
      scanDrive: async () => ({
        kind: 'listed',
        grants: [
          { subject: 'drive_item', on: '/Budget.xlsx', role: 'write', viaLink: true, raw: '{}' },
        ],
      }),
    });

    expect(md).toContain('**by hand**');
    expect(md).toContain('anyone with the link');
  });

  it('pass the header through, and invent nothing', async () => {
    const md = await runPermissionInventory({
      delegationReason: REASON,
      mappingLabel: 'Acme BV',
      generatedOn: '2026-08-04',
    });
    expect(md).toContain('Acme BV');
    expect(md).toContain('2026-08-04');

    const bare = await runPermissionInventory({ delegationReason: REASON });
    // Nothing here reads a clock.
    expect(bare).not.toContain('**Generated:**');
  });
});
