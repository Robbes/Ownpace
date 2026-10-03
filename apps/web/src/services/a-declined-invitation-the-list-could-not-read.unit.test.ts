// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DECLINED INVITATION THE LIST COULD NOT READ (workplan 0156 T3).
 *
 * Managed migration 0008 lets an invited person answer No, and their row's
 * status becomes `declined`. `GET /api/tenants/:id/members` lists every row,
 * declined ones included, and the web's `MemberStatusSchema` did not know the
 * word: one declined invitation made `memberApi.list` throw, and the Team page
 * said "Could not read the member list" to everybody in the organisation.
 *
 * The list is the column's (`tenantMember.status` in
 * `packages/managed/src/schema-managed.ts`), written out because the web app
 * does not import the managed package.
 */

import { describe, it, expect } from 'vitest';
import { MemberSchema, MemberStatusSchema } from './mapping-service.ts';

const EVERY_STATUS_THE_COLUMN_HOLDS = ['active', 'invited', 'declined', 'suspended', 'removed'];

describe("the member list reads every status the database can hold", () => {
  it.each(EVERY_STATUS_THE_COLUMN_HOLDS)('reads a row whose status is %s', (status) => {
    expect(MemberStatusSchema.safeParse(status).success).toBe(true);
  });

  it('reads a declined invitation as the API sends it', () => {
    const row = MemberSchema.parse({
      id: 'm-9',
      tenantId: 'acme',
      userId: 'pending:5f0b',
      email: 'nee@acme.nl',
      role: 'admin',
      status: 'declined',
      origin: 'invited',
      invitedAt: '2026-09-25T09:15:00.000Z',
      joinedAt: null,
    });
    expect(row.status).toBe('declined');
  });
});
