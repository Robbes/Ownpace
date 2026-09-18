// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The sentences a source says when it could not look (workplan 0123 T2).
 *
 * These are prose, and prose is normally not worth a test. These two are,
 * because each carries an INSTRUCTION somebody will follow, and the failure
 * mode is silent: a reader handed the wrong provider's remedy runs a command
 * that cannot work against their account, concludes the tool is broken, and
 * never records the rights — which is precisely the outcome the sentence
 * exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import { googleMailboxDelegationNotRead, permissionsNotDiscoverable } from './permissions.ts';

describe('permissionsNotDiscoverable', () => {
  it('says nothing was looked at, never that nothing is set (hard rule 9)', () => {
    const text = permissionsNotDiscoverable('the API does not expose them');

    expect(text).toContain('the API does not expose them');
    expect(text).toContain('nothing was looked at');
    // The half that makes it actionable: it names the consequence, so a
    // reader who skips it is choosing to, rather than not knowing.
    expect(text).toContain('stop working at cutover');
  });
});

describe('googleMailboxDelegationNotRead', () => {
  it('sends a Google reader to Google, and never to Exchange PowerShell', () => {
    const text = googleMailboxDelegationNotRead();

    // THE WRONG ERRAND, guarded. `mailboxDelegations()` — the Graph pair to
    // this function — names `Get-MailboxPermission` and
    // `Get-RecipientPermission`. Neither will ever run against a Gmail
    // account, and handing them to a Google tenant is how a remedy becomes a
    // dead end. Two other branches in this codebase already avoid exactly
    // this; the sharing checklist did not, until this.
    expect(text).not.toMatch(/Get-MailboxPermission|Get-RecipientPermission|PowerShell/i);
    expect(text).not.toMatch(/Exchange/i);

    // Where a person can actually look, named.
    expect(text).toContain('Accounts and Import');
    expect(text).toContain('Send mail as');
    expect(text).toContain('Admin console');
  });

  it('claims only that we do not read them, never that they cannot be read', () => {
    const text = googleMailboxDelegationNotRead();

    // Gmail DOES expose delegation and send-as to some callers. This tool
    // does not read them, which is a smaller and true statement; "cannot be
    // read" would be a stronger claim than the evidence supports, and a
    // later slice that adds the scan would make it a lie in the file.
    expect(text).toContain('not read by this tool');
    expect(text).not.toMatch(/cannot be read|impossible|no way to/i);
  });

  it('carries the shared frame, so it reads like every other blind spot', () => {
    // Composed through `permissionsNotDiscoverable`, not hand-written beside
    // it — one frame, so a change to the warning reaches every provider.
    expect(googleMailboxDelegationNotRead()).toContain('nothing was looked at');
  });
});
