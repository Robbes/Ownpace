// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Group discovery over IMAP: the honest "no" (workplan 0027 T1, hard rule 9).
 *
 * IMAP has no directory. The protocol addresses one authenticated account's
 * folders and messages and knows nothing about distribution lists, shared
 * mailboxes or membership — those live in the mail platform's directory
 * (Exchange, LDAP, an admin panel), and IMAP is not a way in.
 *
 * This file exists precisely because that fact is easy to express as silence.
 * An IMAP source wired to discovery with no groups reader would return `[]`
 * and Review & confirm would show "no shared addresses" — a sentence the
 * operator would read as "there are none", when what happened is that nobody
 * looked. The workplan calls this out by name: *"discovery honestly reports
 * 'not discoverable over IMAP' rather than an empty list"*.
 *
 * So it is a function and not an omission, and it is tested, because the
 * regression it guards against is somebody later making it return `[]` to make
 * a screen look tidier.
 */

import { groupsNotEnumerable, type GroupListing } from './graph-groups.ts';

/**
 * Always `not_enumerable`. There is no configuration under which IMAP can
 * answer this question, which is why it takes no arguments — an option that
 * could turn it into a listing would be a promise the protocol cannot keep.
 */
export function listImapGroups(): GroupListing {
  return {
    kind: 'not_enumerable',
    reason: groupsNotEnumerable(
      'IMAP has no directory — it addresses one account’s folders and messages, ' +
        'and distribution lists, shared-mailbox membership and group definitions ' +
        'are not visible over it at all. Shared addresses on this source have to ' +
        'be entered by hand, or discovered from a source that does have a ' +
        'directory (Microsoft Graph)',
    ),
  };
}
