// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MEASUREMENT THAT CANNOT TELL A REFUSAL FROM AN ABSENCE PICKS A DESIGN ON
 * THE STRENGTH OF ITS OWN BUG.
 *
 * The owner's Sharing page showed 482 rows for a handful of shared folders,
 * because Drive populates `permissions` on every child of a shared folder as
 * well as on the folder itself. §5 names two designs for collapsing that, says
 * which one is right depends on whether Drive reports inheritance for My Drive
 * items, and that the answer **must be measured rather than assumed**.
 *
 * `drive-share-inheritance.ts` takes that measurement and cannot be tested —
 * Google Drive cannot be containerised. These are the two decisions over data
 * that can be, and both are load-bearing: one is hard rule 9, the other is the
 * finding §5 says must never be folded away.
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

describe('the three answers, told apart', () => {
  /**
   * HARD RULE 9, and the reason this is three-way and not a boolean. Drive
   * documents `permissionDetails` for shared-drive items; on a My Drive item
   * the field coming back empty and the request being REFUSED for naming it
   * mean opposite things, and only one of them is an answer.
   */
  it('reports inheritance when either call carried the details', () => {
    expect(
      inheritanceVerdict({ inlineDetails: 3, endpointDetails: 0, endpointRefused: false }),
    ).toBe('reported');
    expect(
      inheritanceVerdict({ inlineDetails: 0, endpointDetails: 3, endpointRefused: false }),
    ).toBe('reported');
  });

  it('calls it absent only when Drive actually answered', () => {
    expect(
      inheritanceVerdict({ inlineDetails: 0, endpointDetails: 0, endpointRefused: false }),
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
      inheritanceVerdict({ inlineDetails: 0, endpointDetails: 0, endpointRefused: true }),
    ).toBe('not-requestable');
  });

  /** And details that DID come back outrank a refusal on some other child. */
  it('prefers what was observed over what was refused', () => {
    expect(
      inheritanceVerdict({ inlineDetails: 1, endpointDetails: 0, endpointRefused: true }),
    ).toBe('reported');
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
