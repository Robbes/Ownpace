// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MEASUREMENT THAT ACCEPTS ONE FIELD AS EVIDENCE FOR ANOTHER RECOMMENDS A
 * DESIGN ON A CAPABILITY IT NEVER MEASURED.
 *
 * The owner's Sharing page showed 482 rows for a handful of shared folders,
 * because Drive populates `permissions` on every child of a shared folder as
 * well as on the folder itself. §5 names two designs for collapsing that, says
 * which one is right depends on whether Drive reports inheritance for My Drive
 * items, and that the answer **must be measured rather than assumed**.
 *
 * `drive-share-inheritance.ts` took that measurement on 2026-09-18 and got a
 * real answer — and the verdict function read it wrong. The first design groups
 * children under the folder they inherit FROM, which needs `inheritedFrom`. The
 * verdict checked `permissionDetails !== undefined`, which is a different
 * field answering a different question. Drive returned the details on 10 of 10
 * children and `inheritedFrom` on none of them, so the run reported the design
 * open while holding the evidence that it was shut.
 *
 * Both halves of that are guarded here, because both are ways of picking a
 * design on something other than what was measured:
 *
 *  1. **One field is not another.** `sourcedDetails` is counted apart from the
 *     details, and `reported-without-source` is its own answer. Collapsing the
 *     two back together goes red.
 *  2. **Hard rule 9, the original reason this is not a boolean.** A refusal and
 *     an absence mean opposite things — the first is our bug and picks nothing,
 *     the second is an answer that picks the fallback. A refusal read as an
 *     absence goes red.
 *
 * And the third decision, which is over data rather than about the instrument:
 * what counts as a deviation. That one is the finding §5 says must never be
 * folded away.
 */
import { describe, it, expect } from 'vitest';
import {
  deviation,
  grantSet,
  inheritanceVerdict,
  pseudonymiser,
  type SharePermission,
} from './drive-share-grouping.ts';

const person = (emailAddress: string, role: string): SharePermission => ({
  type: 'user',
  role,
  emailAddress,
});

describe('the four answers, told apart', () => {
  /**
   * HARD RULE 9, and the reason this is not a boolean. Drive documents
   * `permissionDetails` for shared-drive items; on a My Drive item the field
   * coming back empty and the request being REFUSED for naming it mean
   * opposite things, and only one of them is an answer.
   */
  it('reports inheritance when either call carried the details AND their source', () => {
    expect(
      inheritanceVerdict({
        inlineDetails: 3,
        endpointDetails: 0,
        sourcedDetails: 3,
        endpointRefused: false,
      }),
    ).toBe('reported');
    expect(
      inheritanceVerdict({
        inlineDetails: 0,
        endpointDetails: 3,
        sourcedDetails: 3,
        endpointRefused: false,
      }),
    ).toBe('reported');
  });

  /**
   * THE MEASUREMENT THIS WAS WRONG ABOUT, 2026-09-18. On the owner's Drive all
   * ten children came back with `permissionDetails` and not one came back with
   * `inheritedFrom`, though the request named it. The old two-way split read
   * that as `reported` and recommended grouping children under "the folder they
   * inherit from" — using a key Drive had just declined to supply.
   *
   * Set `sourcedDetails` to 3 and this test goes green while saying the
   * opposite thing, which is the point: the two fields are different
   * capabilities and the verdict must not accept one as the other.
   */
  it('details without a source do NOT open the design that groups by source', () => {
    expect(
      inheritanceVerdict({
        inlineDetails: 0,
        endpointDetails: 10,
        sourcedDetails: 0,
        endpointRefused: false,
      }),
    ).toBe('reported-without-source');
  });

  /** One item answering with a source is enough to make the key usable. */
  it('a single sourced item is still a source', () => {
    expect(
      inheritanceVerdict({
        inlineDetails: 0,
        endpointDetails: 10,
        sourcedDetails: 1,
        endpointRefused: false,
      }),
    ).toBe('reported');
  });

  it('calls it absent only when Drive actually answered', () => {
    expect(
      inheritanceVerdict({
        inlineDetails: 0,
        endpointDetails: 0,
        sourcedDetails: 0,
        endpointRefused: false,
      }),
    ).toBe('absent');
  });

  /**
   * THE ONE THAT MATTERS MOST. A refused request has established nothing about
   * Drive — it has established that we asked wrongly. Reading it as `absent`
   * would pick §5's fallback design on the strength of our own bug, and nobody
   * reading the output would know the difference.
   */
  it('a refusal is never an absence', () => {
    expect(
      inheritanceVerdict({
        inlineDetails: 0,
        endpointDetails: 0,
        sourcedDetails: 0,
        endpointRefused: true,
      }),
    ).toBe('not-requestable');
  });

  /** And details that DID come back outrank a refusal on some other child. */
  it('prefers what was observed over what was refused', () => {
    expect(
      inheritanceVerdict({
        inlineDetails: 1,
        endpointDetails: 0,
        sourcedDetails: 1,
        endpointRefused: true,
      }),
    ).toBe('reported');
  });

  /**
   * A source cannot be conjured out of a refusal either: nothing observed and
   * a refusal outstanding is still `not-requestable`, whatever `sourcedDetails`
   * claims. Guards the ordering, not the counting.
   */
  it('a source count cannot promote a run that observed nothing', () => {
    expect(
      inheritanceVerdict({
        inlineDetails: 0,
        endpointDetails: 0,
        sourcedDetails: 5,
        endpointRefused: true,
      }),
    ).toBe('not-requestable');
  });
});

describe('what counts as a deviation', () => {
  const folder = ['person-1:reader', 'person-2:writer'];

  it('matching grants are presumed inherited', () => {
    expect(deviation(folder, ['person-2:writer', 'person-1:reader']).deviates).toBe(false);
  });

  it('an EXTRA grant on the child is a deviation, and is named', () => {
    const d = deviation(folder, [...folder, 'anyone:reader']);
    expect(d.deviates).toBe(true);
    expect(d.extra).toEqual(['anyone:reader']);
    expect(d.missing).toEqual([]);
  });

  /**
   * BOTH DIRECTIONS. "This file inside a shared folder is NOT actually shared
   * with everyone the folder is" is exactly the finding somebody needs before a
   * cutover, and a subset test would report it as inherited and fold it into
   * the folder's row.
   */
  it('a MISSING grant is a deviation too', () => {
    const d = deviation(folder, ['person-1:reader']);
    expect(d.deviates).toBe(true);
    expect(d.missing).toEqual(['person-2:writer']);
    expect(d.extra).toEqual([]);
  });

  /**
   * THE ROLE IS PART OF THE GRANT. Same person, more power on the child: a
   * comparison over grantees alone would call this inherited, which is how a
   * file somebody can WRITE to ends up hidden inside a folder they can only
   * read.
   */
  it('the same grantee with a different role deviates', () => {
    const d = deviation(folder, ['person-1:writer', 'person-2:writer']);
    expect(d.deviates).toBe(true);
    expect(d.extra).toEqual(['person-1:writer']);
    expect(d.missing).toEqual(['person-1:reader']);
  });
});

describe('what reaches the transcript', () => {
  /**
   * THE PRIVACY PROMISE THE SCRIPT'S HEADER MAKES. Its output is meant to be
   * pasted into a workplan, and "is this grant inherited" is answered by none
   * of the addresses. A run that printed them would put the owner's colleagues
   * into a public repository.
   */
  it('never lets a grantee address through', () => {
    const grantee = pseudonymiser();
    const permissions = [
      person('anna@example.test', 'reader'),
      person('bram@example.test', 'writer'),
      { type: 'domain', role: 'reader', domain: 'example.test' } as SharePermission,
    ];
    const printed = grantSet(permissions, grantee).join(' ');
    expect(printed).not.toContain('anna');
    expect(printed).not.toContain('bram');
    expect(printed).not.toContain('example.test');
    expect(printed).toContain('person-1');
    expect(printed).toContain('domain-1');
  });

  /** Stable within a run, or two grant sets could not be compared by eye. */
  it('gives one grantee the same name every time it is seen', () => {
    const grantee = pseudonymiser();
    const first = grantSet([person('anna@example.test', 'reader')], grantee);
    const second = grantSet(
      [person('bram@example.test', 'reader'), person('anna@example.test', 'reader')],
      grantee,
    );
    expect(first).toEqual(['person-1:reader']);
    expect(second).toEqual(['person-1:reader', 'person-2:reader']);
  });

  /**
   * `anyone` KEEPS ITS NAME. It identifies nobody, and calling it `person-3`
   * would bury the one grant that means "the whole internet" among the people.
   */
  it('does not pseudonymise anyone', () => {
    const grantee = pseudonymiser();
    expect(grantSet([{ type: 'anyone', role: 'reader' }], grantee)).toEqual(['anyone:reader']);
  });

  /** A fresh run starts its numbering again; two runs must not share one. */
  it('does not carry names between runs', () => {
    const a = pseudonymiser();
    const b = pseudonymiser();
    expect(grantSet([person('anna@example.test', 'reader')], a)).toEqual(['person-1:reader']);
    expect(grantSet([person('zoe@example.test', 'reader')], b)).toEqual(['person-1:reader']);
  });
});
