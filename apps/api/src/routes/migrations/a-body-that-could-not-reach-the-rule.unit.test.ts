// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE DOOR IN FRONT OF THE RULE (workplan 0125 T3).
 *
 * 0125 T1 put a table in `shared` saying what a live migration may revise, and
 * the PUT route calls it: refused fields come back 409, all of them at once,
 * each with its reason. Every part of that was built and tested — and none of
 * it could be reached, because `UpdateMappingSchema` was `CreateMappingBase
 * .partial()` and `.partial()` is SHALLOW.
 *
 * `sourceConfig` became optional; the object inside it stayed exactly as strict
 * as create's, where `username` is required. So:
 *
 *  - a body proposing only an export policy — the thing twenty-one of the
 *    owner's refused files tell him to go and set — was answered
 *    `400 Validation error: sourceConfig.username`;
 *  - a body proposing a new root folder got the same 400, so the refusal
 *    written to say *"items already copied would sit outside the new folder"*
 *    never fired for the case it exists to catch.
 *
 * Hard rule 9 twice: the caller is told the wrong reason, and a refusal that
 * cannot fire is not a refusal anybody should trust. These guards hold the
 * update body open for the fields the rule judges, and hold CREATE shut.
 */
import { describe, it, expect } from 'vitest';
import {
  CreateMappingSchema,
  UpdateMappingSchema,
  proposedRevisions,
} from './index.ts';
import { refusalsFor } from '@openmig/shared';

describe('a revision body reaches the rule', () => {
  /**
   * THE ONE THE OWNER NEEDS. Nothing but the policy: a settings panel that
   * padded the body with a username to get past the schema would be sending a
   * field it does not mean to change, through a route whose whole job is to
   * judge what is being changed.
   */
  it('accepts a body that proposes only the export policy', () => {
    const parsed = UpdateMappingSchema.safeParse({
      sourceConfig: { nativeFilePolicy: 'export-pdf' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sourceConfig?.nativeFilePolicy).toBe('export-pdf');
    }
  });

  /**
   * AND THE REFUSALS BECOME REACHABLE, which is the half that matters more:
   * a rule that only ever sees bodies the schema already let through is a rule
   * nobody has tested against the traffic it is for.
   */
  it.each([
    ['source.rootFolderId', { sourceConfig: { rootFolderId: 'folder-2' } }],
    ['target.account', { targetConfig: { username: 'someone-else@example.test' } }],
    ['source.type', { sourceType: 'dropbox' }],
    ['target.type', { targetType: 'nextcloud' }],
  ])('a body proposing %s parses, and the rule refuses it', (field, body) => {
    const parsed = UpdateMappingSchema.safeParse(body);
    expect(parsed.success, `${field} cannot reach the rule`).toBe(true);
    if (!parsed.success) return;
    const refused = refusalsFor(proposedRevisions(parsed.data));
    expect(refused.map((r) => r.field)).toContain(field);
    // The reason is the product: a refusal that does not say what to do
    // instead is how somebody concludes the tool is broken.
    expect(refused.find((r) => r.field === field)?.reason ?? '').toMatch(/migration/i);
  });

  /**
   * A body proposing nothing the table judges is not refused — and that is not
   * the same as "nothing was proposed". The route answers 409 only when there
   * is something to refuse.
   */
  it('refuses nothing for a policy-only body', () => {
    const parsed = UpdateMappingSchema.parse({
      sourceConfig: { nativeFilePolicy: 'export-odf' },
    });
    expect(refusalsFor(proposedRevisions(parsed))).toEqual([]);
  });
});

describe('what widening the update body did NOT widen', () => {
  /**
   * CREATE IS UNTOUCHED. A migration is created with an account to sign in as;
   * that has never been optional and this must not be the change that makes it
   * so. The update path is the one where "partial" was always the intent.
   */
  it('still requires an account when a migration is created', () => {
    const parsed = CreateMappingSchema.safeParse({
      name: 'Acme',
      sourceType: 'google-drive',
      targetType: 'nextcloud',
      sourceConfig: { nativeFilePolicy: 'export-pdf' },
      targetConfig: { username: 'anna@nc.test' },
      syncConfig: { domains: ['file'] },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('sourceConfig.username');
    }
  });

  /**
   * And the retracted sync modes are still refused on the update path with the
   * same words as create — the guard `sync-mode.unit.test.ts` holds, restated
   * here because this change rebuilt the schema those two share.
   */
  it('still refuses a retracted sync mode', () => {
    expect(UpdateMappingSchema.safeParse({ mode: 'bidirectional' }).success).toBe(false);
    expect(UpdateMappingSchema.safeParse({ mode: 'mirror' }).success).toBe(true);
  });
});
