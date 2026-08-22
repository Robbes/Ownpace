// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Which tenant a request acts on, now that the token need not say (ADR-0042).
 *
 * The rule that matters most here is the REFUSAL. A subject in two
 * organisations, with no explicit choice, is the one case that cannot be
 * guessed — and the tempting answer, "take the first", would silently serve
 * somebody the wrong organisation's mail. There is no error message for that
 * afterwards: it just looks like their data.
 *
 * Everything below drives `resolveTenant` directly, and the file next door
 * (`auth.unit.test.ts`) covers the same behaviour through the middleware so
 * neither can drift into being right on its own.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveTenant,
  TENANT_HEADER,
  __setMembershipsLookupForTests,
} from './auth.ts';
import type { JwtPayload } from './auth.ts';

const SUBJECT: JwtPayload = { sub: 'sub-1', email: 'a@b.test' };
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const memberships = (...tenantIds: string[]) =>
  __setMembershipsLookupForTests(async () =>
    tenantIds.map((tenantId) => ({ tenantId, role: 'owner' })),
  );

afterEach(() => __setMembershipsLookupForTests(null));

describe('resolveTenant', () => {
  it('takes the one membership when there is only one', async () => {
    // The ordinary case. Invite-only means almost everybody belongs to exactly
    // one organisation, and asking them to name it would be asking a question
    // with one possible answer.
    memberships(A);
    expect(await resolveTenant(SUBJECT, undefined)).toEqual({ tenantId: A });
  });

  it('prefers an explicitly requested tenant over everything else', async () => {
    memberships(A, B);
    expect(await resolveTenant(SUBJECT, B)).toEqual({ tenantId: B });
  });

  it('does not GRANT the requested tenant — it only decides what gets checked', async () => {
    // A tenant the subject has nothing to do with resolves fine here, and then
    // fails the membership gate. That separation is deliberate: this function
    // answers "which", the gate answers "may they", and collapsing the two is
    // how a header becomes an authorisation.
    memberships(A);
    expect(await resolveTenant(SUBJECT, 'ffffffff-ffff-4fff-8fff-ffffffffffff')).toEqual({
      tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
  });

  it('still honours a tenantId claim, so existing sessions keep working', async () => {
    // The self-host edition mints its own HS256 tokens with the claim, and a
    // managed deployment may not have moved yet. Dropping support on the day the
    // claim stopped being REQUIRED would have broken every live session.
    memberships(A, B);
    expect(await resolveTenant({ ...SUBJECT, tenantId: A }, undefined)).toEqual({ tenantId: A });
  });

  it('lets an explicit header override a stale claim', async () => {
    memberships(A, B);
    expect(await resolveTenant({ ...SUBJECT, tenantId: A }, B)).toEqual({ tenantId: B });
  });

  it('REFUSES to guess between several, and names the choices', async () => {
    memberships(A, B);
    const result = await resolveTenant(SUBJECT, undefined);

    expect('refusal' in result).toBe(true);
    const refusal = (result as { refusal: { status: number; body: Record<string, unknown> } }).refusal;
    // 400, not 403: they are allowed in, they just have not said where.
    expect(refusal.status).toBe(400);
    // The client has to ask a person which organisation, so it needs the list.
    expect(refusal.body.tenants).toEqual([
      { tenantId: A, role: 'owner' },
      { tenantId: B, role: 'owner' },
    ]);
    // And the sentence says how to answer.
    expect(String(refusal.body.message)).toContain(TENANT_HEADER);
  });

  it('answers a subject with no memberships as forbidden, not as ambiguous', async () => {
    // Somebody whose invitation was withdrawn, or who never had one. That is a
    // 403 and reads the same as the membership gate's, so a client sees one
    // sentence for one situation.
    memberships();
    const result = await resolveTenant(SUBJECT, undefined);
    const refusal = (result as { refusal: { status: number; body: Record<string, unknown> } }).refusal;
    expect(refusal.status).toBe(403);
    expect(refusal.body.message).toBe('No active membership for this tenant');
  });

  it('ignores a blank header rather than treating it as a choice', async () => {
    // A client that always sends the header and sometimes has nothing to put in
    // it must not thereby ask for the tenant named "".
    memberships(A);
    expect(await resolveTenant(SUBJECT, '   ')).toEqual({ tenantId: A });
  });

  it('does not touch the database when it does not have to', async () => {
    // An explicit choice or a claim answers the question outright. A lookup per
    // request, for a question already answered, is a round trip on every call.
    let called = 0;
    __setMembershipsLookupForTests(async () => {
      called += 1;
      return [{ tenantId: A, role: 'owner' }];
    });

    await resolveTenant(SUBJECT, B);
    await resolveTenant({ ...SUBJECT, tenantId: A }, undefined);
    expect(called).toBe(0);

    await resolveTenant(SUBJECT, undefined);
    expect(called).toBe(1);
  });
});
