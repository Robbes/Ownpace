// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The runbook fenced two of four permissions and read as though it fenced all
 * four (workplan 0027; owner 2026-09-09).
 *
 * `docs/o365-application-access.md` grants four application permissions and
 * then narrows them with an Application Access Policy, under a heading that
 * said *"This is the step that makes the grant safe."* It makes the MAILBOX
 * grant safe. Application Access Policy is an **Exchange** mechanism:
 * `Mail.Read` and `Calendars.Read` are fenced to the named group, and
 * `User.Read.All` and `Group.Read.All` — Entra directory permissions — are not
 * and cannot be. They stay tenant-wide for as long as the registration exists.
 *
 * The document already made exactly this argument, correctly and at length,
 * about a permission it decided NOT to grant (`Files.Read.All`, *Two scopes,
 * one granted*). It never applied it to the two it does grant. Nothing was
 * false; the omission was the defect, and the reader it misleads is the
 * colleague being told what this means for them.
 *
 * WHAT THIS PINS, and why each part earns its place:
 *
 *  - **Every granted permission has a reach line.** This is the drift that
 *    produced the defect and the one most likely to recur: §2's table is where
 *    somebody adds a fifth permission, and it is one table away from the place
 *    that says what a permission can see. A grant with no reach line fails
 *    here rather than in a conversation with somebody's colleague.
 *  - **The directory pair is recorded as unfenceable**, so "narrowed by the
 *    policy" cannot quietly become the story again.
 *  - **The demo's limit is stated.** `Test-ApplicationAccessPolicy` answering
 *    Denied is the most persuasive artefact in the runbook, and it proves
 *    exactly one thing: mailbox access. Letting it stand for the whole grant
 *    would be the same defect wearing a green tick.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOC = 'docs/o365-application-access.md';
const doc = readFileSync(join(import.meta.dirname, '..', DOC), 'utf8');

/** The text between one heading and the next of the same or higher level. */
function section(heading: string): string {
  const start = doc.indexOf(heading);
  expect(start, `${DOC} no longer contains the heading ${JSON.stringify(heading)}`)
    .toBeGreaterThan(-1);
  const depth = heading.match(/^#+/)![0].length;
  const rest = doc.slice(start + heading.length);
  const next = rest.search(new RegExp(`^#{1,${depth}} `, 'm'));
  return next === -1 ? rest : rest.slice(0, next);
}

/** The backticked name in each table row's FIRST cell. */
function permissionsIn(markdown: string): string[] {
  return [...markdown.matchAll(/^\|\s*`([A-Za-z.]+)`\s*\|/gm)].map((m) => m[1]!);
}

const GRANTED = '## 2. Add the application permissions';
const REACH = '### What it can and cannot reach — the answer for a colleague';

describe('a fence that covers half the grant', () => {
  it('every permission the runbook GRANTS also has a reach line', () => {
    // §2's table stops where the Files.Read.All argument starts — that section
    // discusses a permission that is deliberately NOT granted, so its mentions
    // must not be read as grants.
    const granted = permissionsIn(section(GRANTED).split('### Two scopes')[0]!);
    const described = permissionsIn(section(REACH));

    expect(granted.length, 'the grant table has no rows — has §2 been restructured?')
      .toBeGreaterThanOrEqual(4);

    const missing = granted.filter((p) => !described.includes(p));
    expect(
      missing,
      'these permissions are granted with nothing saying what they can reach. Every ' +
        'application permission is tenant-wide until something narrows it, and two of ' +
        'the four here cannot be narrowed at all — a grant whose reach is undocumented ' +
        'is one nobody can honestly explain to the people it touches.',
    ).toEqual([]);
  });

  it('the Entra directory permissions are recorded as UNFENCEABLE, not merely unfenced', () => {
    const reach = section(REACH);
    for (const permission of ['User.Read.All', 'Group.Read.All']) {
      const row = reach.split('\n').find((l) => l.includes(`\`${permission}\``));
      expect(row, `${permission} has no row in the reach table`).toBeDefined();
      expect(
        row,
        `${permission} is a directory permission and Application Access Policy is an ` +
          'Exchange mechanism, so step 4 cannot touch it — the row must say No, and say ' +
          'that it is not a matter of configuring it differently.',
      ).toMatch(/\*\*No — and it cannot be\*\*/);
    }
  });

  it('the Exchange pair is recorded as fenced — or the table proves nothing', () => {
    // Without this the guard above passes on a table that says "No" everywhere,
    // which would be alarmist and equally wrong.
    const reach = section(REACH);
    for (const permission of ['Mail.Read', 'Calendars.Read']) {
      const row = reach.split('\n').find((l) => l.includes(`\`${permission}\``));
      expect(row, `${permission} has no row in the reach table`).toBeDefined();
      expect(row, `${permission} IS fenced by step 4; saying otherwise overstates the reach`)
        .toMatch(/\*\*Yes\*\*/);
    }
  });

  it('the section names what was deliberately NOT granted, in the sentence that says so', () => {
    // Scoped to the "deliberately not granted" paragraph, NOT to the section.
    // Written as `toContain` over the whole section first, and a mutation that
    // deleted `Files.Read.All` from this paragraph stayed green — the name
    // also appears further up, pointing at the Two-scopes argument. A guard
    // that passes because a string happens to occur elsewhere is testing the
    // vocabulary, not the claim.
    const reach = section(REACH);
    const start = reach.indexOf('**Deliberately not granted**');
    expect(start, 'the "deliberately not granted" paragraph is gone').toBeGreaterThan(-1);
    const paragraph = reach.slice(start).split('\n\n')[0]!;

    // The reassuring half, and the half a worried reader most needs: the two
    // permissions whose absence is a decision rather than an oversight.
    for (const permission of ['Mail.ReadWrite', 'Files.Read.All']) {
      expect(
        paragraph,
        `${permission} is no longer named as deliberately withheld. Its absence is a ` +
          'decision — dropping the sentence turns a reassurance somebody can check into ' +
          'a silence they have to take on trust.',
      ).toContain(permission);
    }
  });

  it('the Denied demo does not stand for more than it proves', () => {
    const reach = section(REACH);
    expect(
      reach,
      'Test-ApplicationAccessPolicy tests MAILBOX access. Offering it as proof of the ' +
        'whole grant would reproduce this defect with a green tick on top — there is no ' +
        'denial to demonstrate for the directory permissions, because nothing fences them.',
    ).toMatch(/tests mailbox access only/i);
  });

  it('step 4 no longer claims to make THE grant safe, unqualified', () => {
    expect(
      section('## 4. Scope it down — the Application Access Policy'),
      'step 4 makes the MAILBOX grant safe. Unqualified, that sentence is what let a ' +
        'reader conclude the policy fences everything the app was consented to.',
    ).not.toMatch(/This is the step that makes the grant safe/);
  });
});
