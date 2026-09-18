// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A LIVE MIGRATION MAY CHANGE ABOUT ITSELF (workplan 0125 T1).
 *
 * The table is prose and a verdict per field, so most of what matters here is
 * not "does the function return the right enum" — it is that the table stays
 * complete, that its refusals stay actionable, and that the one field the
 * owner actually needs stays on the permitted side of it.
 *
 * The defect it was written for: his live migration refused twenty-one files
 * with a sentence telling him to set an export policy on the mapping, and
 * neither edition had anywhere to do that — managed dropped a `sourceConfig`
 * in silence, the appliance would take any edit at all including ones a ledger
 * full of items cannot survive.
 */

import { describe, it, expect } from 'vitest';
import {
  REVISABLE_FIELDS,
  isRevisableField,
  mayRevise,
  refusalsFor,
  type RevisableField,
} from './config-revision.ts';

describe('the table answers for every field it names', () => {
  it.each([...REVISABLE_FIELDS])('%s has a verdict', (field) => {
    // The union and the table are two lists, and the way this breaks is a
    // field added to one of them. `mayRevise` throws rather than defaulting to
    // permitted, which is the direction that cannot orphan anybody's data.
    expect(() => mayRevise(field)).not.toThrow();
  });

  it('throws for a field nobody wrote a row for, rather than permitting it', () => {
    expect(() => mayRevise('source.credentials' as RevisableField)).toThrow(
      /no revision rule/,
    );
  });

  it('recognises its own members and nothing else', () => {
    for (const f of REVISABLE_FIELDS) expect(isRevisableField(f)).toBe(true);
    for (const junk of ['', 'source', 'sourceConfig.nativeFilePolicy', null, 7]) {
      expect(isRevisableField(junk)).toBe(false);
    }
  });
});

describe('the export policy — the field this plan was opened for', () => {
  it('may change, which is the whole point', () => {
    expect(mayRevise('source.nativeFilePolicy').allowed).toBe(true);
  });

  it('says what it means for what is already copied, rather than leaving it to be found', () => {
    // Safe BECAUSE of ADR-0046 — the rendering scheme travels with the content
    // hash, so no later pass reads a policy change as a content change. What is
    // NOT free is the items already copied: hard rule 2 means they keep the
    // format they arrived in, and somebody who expected a re-export needs to
    // be told before they press rather than after.
    const verdict = mayRevise('source.nativeFilePolicy');
    expect(verdict.allowed).toBe(true);
    const consequence = verdict.allowed ? verdict.consequence : undefined;
    expect(consequence).toBeDefined();
    expect(consequence).toMatch(/already copied/i);
    expect(consequence).toMatch(/never overwrites/i);
  });
});

describe('a refusal names something the reader can do instead', () => {
  const refusedFields = REVISABLE_FIELDS.filter((f) => !mayRevise(f).allowed);

  it('there are refusals at all, so the rest of this file is not vacuous', () => {
    // Proving the instrument: a table that permitted everything would pass
    // every assertion below by having nothing to assert on.
    expect(refusedFields.length).toBeGreaterThan(0);
  });

  it.each([...refusedFields])('%s says what to do instead', (field) => {
    // THE RULE THIS PRODUCT KEEPS BREAKING, in three places in one day: a
    // remedy that names an action nobody can carry out is worse than none,
    // because the reader concludes the tool is broken. Every refusal here
    // points at a migration they can start or a page they can go to.
    const verdict = mayRevise(field);
    expect(verdict.allowed).toBe(false);
    const reason = verdict.allowed ? '' : verdict.reason;
    expect(reason.length, `${field} refuses in fewer words than a reason needs`).toBeGreaterThan(60);
    expect(reason, `${field} refuses without naming a way forward`).toMatch(
      /start a (new|second) migration|Connections page/i,
    );
  });

  it('never claims a change is impossible, only that this product will not do it', () => {
    // The distinction `googleMailboxDelegationNotRead` keeps for the same
    // reason: "cannot" is a stronger statement than the evidence supports, and
    // a later slice that adds the capability would leave a lie in the file.
    for (const field of refusedFields) {
      const verdict = mayRevise(field);
      const reason = verdict.allowed ? '' : verdict.reason;
      expect(reason, field).not.toMatch(/impossible|never possible|no way to/i);
    }
  });

  it('keeps re-granting a credential OUT of the target refusal', () => {
    // A rotated password and a renewed sign-in are what `auth_expired` tells
    // somebody to go and do, on a different page. A refusal that read as
    // "you cannot reconnect this account" would contradict the one remedy this
    // product gives most often.
    const verdict = mayRevise('target.account');
    const reason = verdict.allowed ? '' : verdict.reason;
    expect(reason).toMatch(/Connections page/);
    expect(reason).toMatch(/password|sign-in/i);
  });
});

describe('refusalsFor', () => {
  it('reports EVERY refused field, not the first', () => {
    // Somebody who changed three forbidden fields and is told about one fixes
    // it and is refused again, twice.
    const refused = refusalsFor(['source.type', 'source.rootFolderId', 'target.account']);
    expect(refused.map((r) => r.field)).toEqual([
      'source.type',
      'source.rootFolderId',
      'target.account',
    ]);
    for (const r of refused) expect(r.reason.length).toBeGreaterThan(60);
  });

  it('is empty when every proposed field may change', () => {
    expect(refusalsFor(['name', 'schedule', 'source.nativeFilePolicy'])).toEqual([]);
  });

  it('is empty for nothing proposed, which a caller must not read as approval', () => {
    // Stated because the two are the same value and different facts. A caller
    // that needs to tell them apart knows what it passed in; this function
    // deliberately does not invent a third answer.
    expect(refusalsFor([])).toEqual([]);
  });
});
