// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ATTENTION TAB SHOWED ONE QUEUE OUT OF FIVE.
 *
 * `nav.decisions` is labelled "Attention" and rendered the drift decision
 * queue, and nothing else. So an owner whose weekly digest opened with
 *
 *     Migration: Gmail to Nextcloud
 *       - 34 items that could not be copied
 *
 * clicked the tab it pointed at and found it empty (owner report,
 * 2026-09-14). The digest counted five queues; the screen read one.
 *
 * What these pin is the pair of properties that make the screen trustworthy
 * once it is not empty:
 *
 *   - it says the same thing the mail said, per migration, by the migration's
 *     NAME rather than the UUID the digest used to print;
 *   - every count is a LINK to the queue that holds it, because a number
 *     somebody cannot act on trains them to ignore the screen. The drift
 *     decisions are the one exception, answered on this page itself — and a
 *     link to the screen you are already on is worse than none;
 *   - a queue that could not be READ keeps its migration on the list and says
 *     so, rather than reporting zero. "I found nothing" and "I could not look"
 *     arriving as the same quiet row is how somebody decides a migration is
 *     finished when it is not;
 *   - a read that failed OUTRIGHT says so instead of rendering an empty list,
 *     which would be the original defect in a new place: a screen saying
 *     "nothing is waiting" about a question nobody managed to ask.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect } from 'vitest';
import type { MappingAttention, TenantAttention } from '@openmig/shared';
import { AttentionSummary, organisationWants, wantsSomeone } from './AttentionSummary.tsx';
import { queueScreenPathFor } from '../services/edition.ts';

const UUID = '0cc9a844-4075-4d65-a562-374df8299b77';

function mapping(over: Partial<MappingAttention> = {}): MappingAttention {
  return {
    mappingId: UUID,
    name: 'Gmail to Nextcloud',
    pendingDecisions: 0,
    deletionsWaiting: 0,
    movesWaiting: 0,
    failuresWaiting: 0,
    readyForCutover: false,
    autoApplied: 0,
    sharingOpen: 0,
    ...over,
  } as MappingAttention;
}

const show = (mappings: MappingAttention[], failed = false, tenant?: TenantAttention) =>
  render(
    <MemoryRouter>
      <AttentionSummary
        mappings={mappings}
        {...(tenant ? { tenant } : {})}
        failed={failed}
      />
    </MemoryRouter>,
  );

describe('the line the owner came looking for', () => {
  it('shows the 34 the digest counted, under the name the digest used', () => {
    show([mapping({ failuresWaiting: 34 })]);
    expect(screen.getByText('Gmail to Nextcloud')).toBeVisible();
    expect(screen.getByText('34')).toBeVisible();
    expect(screen.getByText(/items that could not be copied/)).toBeVisible();
    // The UUID is our handle for the row and appears on no screen they have.
    expect(screen.queryByText(UUID)).not.toBeInTheDocument();
  });

  it('falls back to the id for a migration nobody named', () => {
    // Nullable in the database: the create route requires a name, rows the
    // appliance wrote and rows predating that do not have one. A blank label
    // would leave the counts belonging to nothing nameable.
    show([mapping({ name: undefined, failuresWaiting: 1 })]);
    expect(screen.getByText(UUID)).toBeVisible();
  });

  it('links each count to the queue that holds it', () => {
    show([
      mapping({ failuresWaiting: 3, deletionsWaiting: 2, movesWaiting: 1, sharingOpen: 4 }),
    ]);
    const href = (label: RegExp) =>
      screen.getByText(label).closest('a')?.getAttribute('href');
    expect(href(/items that could not be copied/)).toBe(`/mappings/${UUID}/failures`);
    expect(href(/deletions to confirm/)).toBe(`/mappings/${UUID}/deletions`);
    expect(href(/moves to acknowledge/)).toBe(`/mappings/${UUID}/moves`);
    expect(href(/sharing checklist/)).toBe(`/mappings/${UUID}/sharing`);
  });

  it('does NOT link the drift decisions — they are answered on this page', () => {
    show([mapping({ pendingDecisions: 2 })]);
    const line = screen.getByText(/changes needing a decision/);
    expect(line.closest('a'), 'a link to the screen you are on is worse than none').toBeNull();
  });

  it('offers the finish when a migration is checked and ready', () => {
    show([mapping({ readyForCutover: true })]);
    const link = screen.getByText(/checked and ready to finish/).closest('a');
    expect(link?.getAttribute('href')).toBe(`/mappings/${UUID}`);
  });
});

describe('what it does not say', () => {
  it('leaves out a migration with nothing waiting, and counts it instead', () => {
    show([mapping({ failuresWaiting: 1 }), mapping({ mappingId: 'quiet-1', name: 'Quiet' })]);
    expect(screen.queryByText('Quiet')).not.toBeInTheDocument();
    // Said rather than left as an absence: a list showing one of two looks
    // like it has lost one.
    expect(screen.getByText(/1 running by themselves/)).toBeVisible();
  });

  it('says nothing is waiting, rather than rendering an empty box', () => {
    show([mapping()]);
    expect(screen.getByText(/Nothing is waiting/)).toBeVisible();
  });

  it('does not put a migration on the list for auto-applied removals', () => {
    // The endpoint reports zero for those on purpose; this is the screen-side
    // half of the same decision. Nothing is waiting, so nobody is needed.
    expect(wantsSomeone(mapping({ autoApplied: 3 }))).toBe(false);
  });
});

describe('a queue that could not be read is not an empty queue', () => {
  it('keeps the migration on the list and carries the reason verbatim', () => {
    show([
      mapping({
        blindSpots: ['the failures queue: connection terminated unexpectedly'],
      } as Partial<MappingAttention>),
    ]);
    expect(screen.getByText('Gmail to Nextcloud')).toBeVisible();
    expect(screen.getByText(/these numbers may be low/)).toBeVisible();
    expect(
      screen.getByText('the failures queue: connection terminated unexpectedly'),
    ).toBeVisible();
    expect(screen.queryByText(/Nothing is waiting/)).not.toBeInTheDocument();
  });

  it('says the whole read failed, rather than showing an empty list', () => {
    show([], true);
    expect(screen.getByText(/could not be loaded/)).toBeVisible();
    expect(screen.queryByText(/Nothing is waiting/)).not.toBeInTheDocument();
  });
});

describe('the links respect the edition', () => {
  it('sends the appliance to its flat queue screens and managed to the scoped ones', () => {
    // The appliance's screens answer for every configured mapping at once;
    // a managed tenant's are scoped to one. Getting this backwards is a 404
    // or, worse, another migration's queue.
    expect(queueScreenPathFor('selfhost', 'failures', UUID)).toBe('/failures');
    expect(queueScreenPathFor('managed', 'failures', UUID)).toBe(`/mappings/${UUID}/failures`);
  });

  it('keeps the sharing checklist scoped on BOTH editions', () => {
    // Its rows live in the ledger either way, and `AppRoutes` mounts only the
    // scoped route — a flat `/sharing` would 404 on the appliance.
    expect(queueScreenPathFor('selfhost', 'sharing', UUID)).toBe(`/mappings/${UUID}/sharing`);
    expect(queueScreenPathFor('managed', 'sharing', UUID)).toBe(`/mappings/${UUID}/sharing`);
  });
});


describe('the organisation, which is not one of its migrations', () => {
  it('names it and counts its decisions when no migration reports', () => {
    // The hole. A tenant whose every migration is `done` reported no mapping,
    // so the pending decisions had nowhere to go and the panel said "Nothing
    // is waiting. Every migration is running by itself" over a drift queue
    // that was not empty. Neither clause was true.
    show([], false, { pendingDecisions: 3 });
    expect(screen.getByText('Your organisation')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText(/changes needing a decision/)).toBeVisible();
    expect(screen.queryByText(/Every migration is running by itself/)).not.toBeInTheDocument();
  });

  it('does not link the count, because it is answered on this page', () => {
    // Same rule the migrations' drift decisions follow: a link to the screen
    // you are already on is worse than none.
    show([], false, { pendingDecisions: 2 });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it("prints the server's own words when the decision queue could not be READ", () => {
    // Rule 9 at tenant scope. "I could not look" must not read as "nothing is
    // waiting" merely because no migration was there to carry the reason.
    show([], false, { blindSpots: ['the decision queue: permission denied'] });
    expect(screen.getByText('Your organisation')).toBeVisible();
    expect(screen.getByText('the decision queue: permission denied')).toBeVisible();
    expect(screen.queryByText(/Every migration is running by itself/)).not.toBeInTheDocument();
  });

  it('stops claiming migrations are running when there are none', () => {
    // The false sentence, on its own. No organisation attention either, so
    // this is the genuinely quiet all-finished tenant — and the panel must
    // still not assert something that is running.
    show([]);
    expect(screen.getByText('Nothing is waiting, and no migration is running.')).toBeVisible();
    expect(screen.queryByText(/Every migration is running by itself/)).not.toBeInTheDocument();
  });

  it('keeps the original sentence when migrations ARE running quietly', () => {
    // The other silence, which was never wrong: migrations on the list, none
    // of them wanting anybody. Guarding it so the fix above does not take a
    // true sentence away with the false one.
    show([mapping()]);
    expect(screen.getByText(/Every migration is running by itself/)).toBeVisible();
  });

  it('says nothing about the organisation when it has nothing to say', () => {
    show([mapping({ failuresWaiting: 1 })], false, {});
    expect(screen.queryByText('Your organisation')).not.toBeInTheDocument();
  });

  it('shows both when both report, rather than dropping one', () => {
    // The server sends `tenant` only when no migration reported, so this does
    // not happen today. It is asserted anyway: a screen that dropped one
    // because the other arrived would be this route's own defect, and the
    // rule that keeps them apart lives on the server where it can change.
    show([mapping({ failuresWaiting: 34 })], false, { pendingDecisions: 1 });
    expect(screen.getByText('Your organisation')).toBeVisible();
    expect(screen.getByText('Gmail to Nextcloud')).toBeVisible();
  });

  it('organisationWants is false for absent, empty and zero', () => {
    expect(organisationWants(undefined)).toBe(false);
    expect(organisationWants({})).toBe(false);
    expect(organisationWants({ pendingDecisions: 0 })).toBe(false);
    expect(organisationWants({ blindSpots: [] })).toBe(false);
    expect(organisationWants({ pendingDecisions: 1 })).toBe(true);
    expect(organisationWants({ blindSpots: ['x'] })).toBe(true);
  });
});
