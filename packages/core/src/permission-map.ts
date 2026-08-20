// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Mapping a source right to its target equivalent (workplan 0029 T2, §14.2).
 *
 * §14.2 is explicit about what NOT to build: *"without a fragile full ACL
 * translator"*. Permission models differ enough between O365 and the targets
 * that a 1:1 translation is often impossible, and a translator that guessed
 * would produce target ACLs nobody asked for — the worst kind of wrong,
 * because they look deliberate.
 *
 * So this is a **table, not a translator**. Each source right either has a
 * clean equivalent, which is named, or it does not, and is named `manual`.
 * There is no third verdict and no confidence score: a right maps cleanly or
 * a person decides. Reviewing this file should be enough to know exactly what
 * the report will say about any grant.
 *
 * NOTHING HERE APPLIES ANYTHING. §14.2's apply step is deferred by owner
 * decision (workplan 0029's own note), so `clean` means *"this is what it
 * corresponds to on the target"*, not *"we will do it"*. Every item in the
 * report is a step for a person until that decision is revisited — and the
 * runbook says so, rather than letting `clean` be read as `handled`.
 */

import type { PermissionGrant } from '@openmig/shared';

export interface PermissionMapping {
  /**
   * `clean` — the target has a direct equivalent, named in `target`.
   * `manual` — it does not, and `target` says what to do instead.
   *
   * Two verdicts on purpose. Anything fuzzier invites a translator.
   */
  readonly verdict: 'clean' | 'manual';
  /** What it corresponds to on the target, in the owner's terms. */
  readonly target: string;
  /** Why, when the reason is not obvious from the target alone. */
  readonly note?: string;
}

/**
 * Map one grant.
 *
 * Deliberately total: every grant gets a verdict, and the fallback is
 * `manual` rather than a throw or a silent drop. A right this table has not
 * seen before is exactly the one an owner must be told about.
 */
export function mapGrant(grant: PermissionGrant): PermissionMapping {
  if (grant.subject === 'calendar') {
    // The one genuinely clean correspondence: both sides model "this
    // calendar is shared with this person, read or read-write".
    const writable = /write|owner|editor/i.test(grant.role);
    return {
      verdict: 'clean',
      target: writable
        ? 'a Nextcloud calendar share with write access'
        : 'a Nextcloud calendar share, read-only',
      note: 'CalDAV calendar sharing is the same idea on both sides; only the wording differs.',
    };
  }

  if (grant.subject === 'drive_item') {
    if (grant.viaLink) {
      // A link is not a right held by anybody — it is a URL that works. It
      // cannot be "translated": recreating one is a deliberate act with its
      // own risk, and the owner may well want it to end at the migration.
      return {
        verdict: 'manual',
        target:
          'decide whether this link should exist at all after the move — a sharing link is a ' +
          'URL that works for whoever has it, so migrating it silently would carry that ' +
          'access across without anybody choosing to',
        note: 'Not a right held by a person, so there is nothing to translate.',
      };
    }
    const writable = /write|owner|editor/i.test(grant.role);
    return {
      verdict: 'clean',
      target: writable
        ? 'a Nextcloud share with edit permission'
        : 'a Nextcloud share, read-only',
      note: 'A per-person file or folder share exists on both sides.',
    };
  }

  // Mailbox rights. These never arrive from Graph — `mailboxDelegations()`
  // reports that it cannot read them — so they get here only from an
  // inventory a person captured by hand, which is exactly when the target
  // convention is worth stating.
  if (/fullaccess/i.test(grant.role)) {
    return {
      verdict: 'manual',
      target:
        'give each person who needs the shared mailbox their own app password for it ' +
        '(SAD §14.1, docs/shared-mailboxes.md)',
      note: 'The target has no per-person mailbox ACL; app passwords are the convention, and they can be withdrawn individually.',
    };
  }
  if (/sendas|sendonbehalf/i.test(grant.role)) {
    return {
      verdict: 'manual',
      target: 'configure Send-As for this address on the target platform',
      note: 'Send-As is a platform setting on the target, not a permission this tool can grant.',
    };
  }

  return {
    verdict: 'manual',
    target: 'no equivalent is known for this right — decide what it should become',
    note: 'This table has no entry for it, which is itself worth knowing before cutover.',
  };
}
