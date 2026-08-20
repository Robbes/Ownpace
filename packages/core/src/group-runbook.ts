// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Pattern D runbook (workplan 0027 T2, §14.2's "guide" step).
 *
 * T2 says: automate the clean subset where the target has an API, and
 * generate the step-by-step runbook where it does not. **For every target
 * this stack supports today, it does not.** JMAP has no mailing-list surface
 * in the protocol; Stalwart's group management lives in its own admin API,
 * which needs administrative credentials a migration is never given; Soverin
 * and the IMAP/DAV family expose no group endpoint at all. So the whole of
 * Pattern D recreation is the guided half, and this file says that out loud
 * rather than shipping an "automated" path that quietly does nothing.
 *
 * That is §14.2's doctrine applied to §14.1 — *covered, not necessarily
 * automated*: everything is covered, partly automatic and partly guided,
 * without a fragile translator nobody can trust.
 *
 * WHAT THIS FILE WILL NOT DO, and each is a way a runbook can be worse than
 * no runbook:
 *
 *  - **It does not invent user interfaces.** No "click Settings → Groups →
 *    New": we do not know what any given target's admin panel says this
 *    week, and steps that name buttons which do not exist teach the reader
 *    the whole document is guesswork. Every step states the OUTCOME required
 *    and the data needed for it, which a person can map to whatever their
 *    platform actually calls it.
 *  - **It does not list members it did not read.** A group whose membership
 *    could not be enumerated gets a section saying so, not an empty member
 *    list somebody would recreate as an empty group (hard rule 9).
 *  - **It never says "replace" or "remove".** Recreation is create-only; a
 *    group that already exists on the target is a stop-and-check, because
 *    modifying it would be the destructive half hard rule 2 forbids.
 */

import type { SharedAddressPattern } from '@openmig/shared';

/** One discovered address, as the runbook needs it. */
export interface RunbookGroup {
  readonly address: string;
  readonly displayName?: string;
  readonly pattern?: SharedAddressPattern;
  readonly members: readonly string[];
  /** False when the member list could not be read; `members` is then empty. */
  readonly membersKnown: boolean;
}

export interface RunbookInput {
  readonly groups: readonly RunbookGroup[];
  /** Rendered into the header so the reader knows which migration this is. */
  readonly tenantLabel?: string;
  /** ISO date, passed in rather than read: this module stays pure. */
  readonly generatedOn?: string;
}

/**
 * Render the runbook as Markdown.
 *
 * Always returns a document, including when there is nothing to recreate —
 * an empty file and "you have no distribution lists" are different claims,
 * and only one of them is ours to make.
 */
export function renderGroupRunbook(input: RunbookInput): string {
  const lists = input.groups.filter((g) => g.pattern === 'distribution_d');
  const recreatable = lists.filter((g) => g.membersKnown);
  const blocked = lists.filter((g) => !g.membersKnown);
  const shared = input.groups.filter((g) => g.pattern === 'shared_s');
  const unclassified = input.groups.filter((g) => g.pattern === undefined);

  const out: string[] = [];

  out.push(`# Recreating your distribution lists`);
  out.push('');
  if (input.tenantLabel) out.push(`**Migration:** ${input.tenantLabel}  `);
  if (input.generatedOn) out.push(`**Generated:** ${input.generatedOn}  `);
  out.push('');
  out.push(
    'This is a set of steps **for a person**. Nothing in it has been done for you, and ' +
      'nothing in it will be done automatically later.',
  );
  out.push('');
  out.push(
    'A distribution list has no message store to copy — mail sent to it is delivered into ' +
      'the members’ own mailboxes, which migrate through their own syncs. What has to move is ' +
      'the **list itself**: the address, and who receives mail sent to it. None of the target ' +
      'platforms this tool supports exposes an interface for creating that, so this document ' +
      'gives you the address, the exact membership we read from the source, and what to check ' +
      'afterwards.',
  );
  out.push('');
  out.push('## Before you start');
  out.push('');
  out.push(
    '- **Create only. Never modify an existing group.** If your target already has a group ' +
      'at one of these addresses, stop at that entry and reconcile it by hand — this migration ' +
      'never removes or replaces anything that is already there.',
  );
  out.push(
    '- **Members are addresses on the SOURCE.** If a member’s mailbox is moving to a new ' +
      'address on the target, use the new one; the list below is what the source directory said.',
  );
  out.push(
    '- **Do this before you switch DNS.** A list that does not exist on the target is mail ' +
      'that bounces, and the sender gets the bounce, not you.',
  );
  out.push('');

  out.push('## The lists');
  out.push('');
  if (recreatable.length === 0) {
    out.push(
      '_No distribution lists are ready to recreate._ That is not the same as "you have ' +
        'none" — see the sections below, and note that a source which cannot be enumerated ' +
        '(any IMAP source) contributes nothing here at all.',
    );
    out.push('');
  }

  for (const group of recreatable) {
    out.push(`### ${title(group)}`);
    out.push('');
    out.push(`- **Address:** \`${group.address}\``);
    out.push(`- **Receives mail for:** ${group.members.length} recipient(s)`);
    out.push('');
    out.push('Each of these must receive mail sent to the address above:');
    out.push('');
    for (const member of group.members) out.push(`- \`${member}\``);
    if (group.members.length === 0) {
      out.push(
        '- _(none — this list has no members on the source. Recreating it empty is ' +
          'correct; mail to the address will go nowhere, exactly as it does today.)_',
      );
    }
    out.push('');
    out.push('**Then check:** send one message to the address and confirm every recipient above receives it.');
    out.push('');
  }

  if (blocked.length > 0) {
    out.push('## Lists that CANNOT be recreated from what we know');
    out.push('');
    out.push(
      'The membership of these could not be read from the source, so recreating them from ' +
        'this document would produce **empty groups that look finished**. They are listed here ' +
        'rather than left out, because the addresses are real and mail sent to them after ' +
        'cutover would reach nobody.',
    );
    out.push('');
    for (const group of blocked) {
      out.push(`- \`${group.address}\`${group.displayName ? ` — ${group.displayName}` : ''}`);
    }
    out.push('');
    out.push(
      '**To fix:** grant the permission that lets the source be read (see ' +
        '`docs/o365-application-access.md`) and run discovery again, or write the membership ' +
        'down by hand from the source’s own admin tools.',
    );
    out.push('');
  }

  if (unclassified.length > 0) {
    out.push('## Addresses still to classify');
    out.push('');
    out.push(
      'The source did not say whether these are shared mailboxes or distribution lists, and ' +
        'the two migrate differently. They are waiting for you on the **Needs a decision** ' +
        'screen; nothing here applies to them until they are answered.',
    );
    out.push('');
    for (const group of unclassified) out.push(`- \`${group.address}\``);
    out.push('');
  }

  if (shared.length > 0) {
    out.push('## Shared mailboxes (not in this runbook)');
    out.push('');
    out.push(
      'These have their own message store, so they are copied rather than recreated and do ' +
        'not belong in a list of manual steps:',
    );
    out.push('');
    for (const group of shared) out.push(`- \`${group.address}\``);
    out.push('');
  }

  return out.join('\n');
}

function title(group: RunbookGroup): string {
  return group.displayName ? `${group.displayName} (${group.address})` : group.address;
}
