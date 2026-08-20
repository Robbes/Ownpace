// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Pattern D runbook (workplan 0027 T2).
 *
 * The tests worth having here are the ones about what the document must NOT
 * do: recreate a group from members nobody read, imply that something was
 * done automatically, or tell the reader to modify something that already
 * exists on the target.
 */

import { describe, it, expect } from 'vitest';
import { renderGroupRunbook, type RunbookGroup } from './group-runbook.ts';

const list = (overrides: Partial<RunbookGroup> = {}): RunbookGroup => ({
  address: 'sales@acme.nl',
  displayName: 'Sales',
  pattern: 'distribution_d',
  members: ['rob@acme.nl', 'jan@acme.nl'],
  membersKnown: true,
  ...overrides,
});

describe('a list that can be recreated', () => {
  it('gives the address and every member, verbatim', () => {
    const md = renderGroupRunbook({ groups: [list()] });

    expect(md).toContain('Sales (sales@acme.nl)');
    expect(md).toContain('`rob@acme.nl`');
    expect(md).toContain('`jan@acme.nl`');
    // The check that tells the reader they succeeded.
    expect(md).toContain('send one message to the address');
  });

  it('says a genuinely empty list is correctly empty', () => {
    const md = renderGroupRunbook({ groups: [list({ members: [] })] });
    // Distinct from the unread case below: recreating this one empty is the
    // right outcome, and the reader needs to know that is deliberate.
    expect(md).toContain('this list has no members on the source');
  });
});

describe('a list whose membership could not be read', () => {
  it('is named, and explicitly NOT given as steps', () => {
    const md = renderGroupRunbook({
      groups: [list({ address: 'unread@acme.nl', members: [], membersKnown: false })],
    });

    expect(md).toContain('CANNOT be recreated');
    expect(md).toContain('`unread@acme.nl`');
    // Recreating from an unread list produces an empty group that looks
    // finished — the failure hard rule 9 exists to prevent.
    expect(md).toContain('empty groups that look finished');
    expect(md).not.toContain('this list has no members on the source');
  });

  it('names the fix rather than leaving the reader stuck', () => {
    const md = renderGroupRunbook({
      groups: [list({ members: [], membersKnown: false })],
    });
    expect(md).toContain('docs/o365-application-access.md');
  });
});

describe('what the document refuses to do', () => {
  it('never tells the reader to modify or remove an existing group', () => {
    const md = renderGroupRunbook({ groups: [list()] });

    expect(md).toContain('Create only. Never modify an existing group');
    expect(md).toContain('reconcile it by hand');
    // Hard rule 2, in the reader's own instructions.
    expect(md).not.toMatch(/\breplace the (existing|current) group\b/i);
  });

  it('does not claim anything was done automatically', () => {
    const md = renderGroupRunbook({ groups: [list()] });
    // No target this stack supports has a group API, and a runbook that
    // implied otherwise would have owners skip the steps.
    expect(md).toContain('Nothing in it has been done for you');
  });

  it('does not name buttons in somebody else’s admin panel', () => {
    const md = renderGroupRunbook({ groups: [list()] });
    // Invented UI labels teach the reader the whole document is guesswork.
    expect(md).not.toMatch(/click\s+/i);
    expect(md).not.toMatch(/Settings\s*(→|->)/);
  });
});

describe('the other categories', () => {
  it('sends unclassified addresses to the decision screen, not to steps', () => {
    const md = renderGroupRunbook({
      groups: [list({ address: 'mystery@acme.nl', pattern: undefined })],
    });

    expect(md).toContain('still to classify');
    expect(md).toContain('Needs a decision');
    expect(md).not.toContain('### mystery@acme.nl');
  });

  it('lists shared mailboxes as explicitly out of scope for a manual runbook', () => {
    const md = renderGroupRunbook({
      groups: [list({ address: 'team@acme.nl', pattern: 'shared_s' })],
    });

    expect(md).toContain('not in this runbook');
    expect(md).toContain('copied rather than recreated');
  });
});

describe('nothing to recreate', () => {
  it('still produces a document, and refuses to claim there are none', () => {
    const md = renderGroupRunbook({ groups: [] });

    // An empty file and "you have no distribution lists" are different
    // claims, and only one of them is ours to make.
    expect(md).toContain('No distribution lists are ready to recreate');
    expect(md).toContain('not the same as "you have ');
    expect(md).toContain('any IMAP source');
  });
});

describe('the header', () => {
  it('carries the migration and the date it was generated', () => {
    const md = renderGroupRunbook({
      groups: [list()],
      tenantLabel: 'Acme BV',
      generatedOn: '2026-08-04',
    });
    expect(md).toContain('Acme BV');
    expect(md).toContain('2026-08-04');
  });

  it('omits them rather than inventing them', () => {
    // The module is pure: it never reads a clock, so a caller that did not
    // pass a date gets a document without one.
    const md = renderGroupRunbook({ groups: [list()] });
    expect(md).not.toContain('**Generated:**');
  });
});
