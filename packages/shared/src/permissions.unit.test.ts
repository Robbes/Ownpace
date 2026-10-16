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
import {
  calendarSharingNotReadForThisSource,
  calendarSharingNotReadForThisSourceSaid,
  fileSharingNotReadForThisSource,
  fileSharingNotReadForThisSourceSaid,
  googleMailboxDelegationNotRead,
  googleMailboxDelegationNotReadSaid,
  mailboxAccessNotReadForThisSource,
  mailboxAccessNotReadForThisSourceSaid,
  microsoftAccountCalendarSharingNotRead,
  microsoftAccountFileSharingNotRead,
  microsoftAccountMailboxAccessNotRead,
  permissionsNotDiscoverable,
  permissionsNotDiscoverableNl,
} from './permissions.ts';

describe('permissionsNotDiscoverable', () => {
  it('says nothing was looked at, never that nothing is set (hard rule 9)', () => {
    const text = permissionsNotDiscoverable('the API does not expose them');

    expect(text).toContain('the API does not expose them');
    expect(text).toContain('nothing was looked at');
    expect(text).toContain('This does not mean nothing is shared');
    // The half that makes it actionable: it names the consequence, so a
    // reader who skips it is choosing to, rather than not knowing.
    expect(text).toContain('stops working without warning when you switch over');
  });

  it("says it in a tester's words, in English and in Dutch (the owner, 2026-10-16)", () => {
    // "Could not be inventoried … at cutover" was the developer's sentence.
    const en = permissionsNotDiscoverable('x');
    const nl = permissionsNotDiscoverableNl('x');
    for (const text of [en, nl]) {
      expect(text).not.toMatch(/inventor|cutover|deployment/i);
    }
    expect(en).toContain('was not read');
    expect(nl).toContain('niet gelezen');
    // The same meaning in Dutch: nothing looked at, which is never "nothing shared".
    expect(nl).toContain('niets bekeken');
    expect(nl).toContain('betekent niet dat er niets gedeeld is');
    expect(nl).toContain('zodra u overstapt');
    expect(nl).not.toMatch(/verhuizing|\bje\b|\bjij\b/);
  });
});

describe('every sentence of ours is said in Dutch too (the owner, 2026-10-16)', () => {
  it('pairs each English blind spot with its Dutch twin, both framed as blind spots', () => {
    const pairs = [
      googleMailboxDelegationNotReadSaid(),
      mailboxAccessNotReadForThisSourceSaid(),
      calendarSharingNotReadForThisSourceSaid(),
      fileSharingNotReadForThisSourceSaid(),
      microsoftAccountMailboxAccessNotRead(),
      microsoftAccountCalendarSharingNotRead(),
      microsoftAccountFileSharingNotRead(),
    ];
    for (const pair of pairs) {
      expect(pair.en).toContain('nothing was looked at');
      expect(pair.nl).toContain('niets bekeken');
      expect(pair.nl).not.toMatch(/verhuizing/);
    }
    // The English half is the sentence the report has always carried.
    expect(googleMailboxDelegationNotReadSaid().en).toBe(googleMailboxDelegationNotRead());
    expect(mailboxAccessNotReadForThisSourceSaid().en).toBe(mailboxAccessNotReadForThisSource());
  });
});

describe('a Microsoft account connected with its own sign-in (the owner, 2026-10-16)', () => {
  it("names no Exchange tool and no organisation's directory, in either language", () => {
    for (const pair of [
      microsoftAccountMailboxAccessNotRead(),
      microsoftAccountCalendarSharingNotRead(),
      microsoftAccountFileSharingNotRead(),
    ]) {
      for (const text of [pair.en, pair.nl]) {
        expect(text).not.toMatch(/PowerShell|Get-MailboxPermission|Exchange|tenant|SharePoint|directory|registration|inventor|cutover/i);
      }
      expect(pair.en).toContain('not read by Ownpace');
    }
    expect(microsoftAccountMailboxAccessNotRead().en).toContain("Outlook's settings");
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

    // Gmail DOES expose delegation and send-as to some callers. Ownpace
    // does not read them, which is a smaller and true statement; "cannot be
    // read" would be a stronger claim than the evidence supports, and a
    // later slice that adds the scan would make it a lie in the file.
    expect(text).toContain('not read by Ownpace');
    expect(text).not.toMatch(/cannot be read|impossible|no way to/i);
  });

  it('carries the shared frame, so it reads like every other blind spot', () => {
    // Composed through `permissionsNotDiscoverable`, not hand-written beside
    // it — one frame, so a change to the warning reaches every provider.
    expect(googleMailboxDelegationNotRead()).toContain('nothing was looked at');
  });
});

describe('a source that is neither Microsoft nor Google (the owner, 2026-10-14)', () => {
  const said = [
    mailboxAccessNotReadForThisSource(),
    calendarSharingNotReadForThisSource(),
    fileSharingNotReadForThisSource(),
  ];

  it("is sent on no provider's errand: no Exchange, no Graph, no OneDrive, no Gmail", () => {
    for (const text of said) {
      expect(text).not.toMatch(/PowerShell|Exchange|Microsoft|Graph|tenant|OneDrive|SharePoint|Gmail|Google/);
    }
  });

  it('says each as a blind spot, never as "nothing there" (hard rule 9)', () => {
    for (const text of said) {
      expect(text).toContain('not read by Ownpace for this kind of source');
      expect(text).toContain('nothing was looked at');
      expect(text).toContain('before you switch over');
    }
  });
});
