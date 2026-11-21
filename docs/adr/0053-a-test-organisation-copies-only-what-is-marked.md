# ADR-0053: A test organisation copies only what is marked

- **Status:** **Accepted 2026-11-20** by the owner, as workplan 0162 §2 proposed it; built in that
  workplan: the marker at the source (T2), never finished or switched over (T3), the organisation
  and its marker (T1). Not yet run on live (T4).
- **Date:** 2026-11-21
- **Deciders:** owner
- **Relates to:** [ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md)
  (the organisation's marker is a managed row), [ADR-0024](./0024-explicit-owner-deletion-apply.md)
  (losing the marker deletes nothing), [ADR-0043](./0043-a-migration-is-silent-by-default.md)
  (guests as for any event), [ADR-0049](./0049-a-door-that-asked-nobody.md) (the doors that
  refuse a test migration), [ADR-0013](./0013-i18n-english-dev-bilingual-ui.md) (the operator's
  screen is English; the customer's banner is bilingual),
  [workplan 0162](../workplans/0162-a-test-organisation-copies-only-what-is-marked.md)

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **Only an appointed operator marks an organisation as a test**, with its marker, from Support
  (`POST`/`DELETE /api/support/tenants/{id}/test`), only while it is open and holds no migration;
  anybody else gets a 404, and the database writes the row for an operator only. The marker is
  required: trimmed, 3 to 64 printable characters. `[Ownpace-test]` is offered, never assumed.
- **A migration copies its organisation's marker when it is created** (`mailbox_mapping.test_marker`),
  in that transaction, and nothing changes or removes it. 0070's trigger is the guarantee;
  `a-test-marker-only-a-create-writes` is an early warning before the merge.
- **An item is in scope when its own title contains the marker**, ignoring case: a subject, an
  event's or task's title (a series by its master), a contact's name, a file's name. Nothing else
  decides.
- **Applied once, where the source is listed** (`MarkedOnly`, at every builder): discovery, the
  passes, the bin scan, verification and the counts see one marked set.
- **Never finished or switched over**: every such door refuses it and says why, the Finish page
  offers neither End nor Keep, and every page says *Test*. It ends by being deleted.
- **Losing the marker deletes nothing**: only a real deletion at the source reaches the queue.
- **Guests as for any event; every source kind** reads the marker.
- **Managed only**: the appliance has no operator and no test migration.

## Context

No lane reads a Google account: every E2E lane copies sources it seeds, or a non-Google source. A
Google source needs an account that may be read, and the one there is, the operator's own, is the
wrong thing to copy whole: it moves private mail and calendars into a test target, its events name
other people as guests, and a target may mail them (ADR-0043; on 2026-11-19 one did, workplan 0160
T2). Its counts are also too large to check by eye.

Marking test data is already how this repository tells test from real: the live-target lane tags
its mail, and the smoke tags its seeds. Workplan 0162 does the same for items in a real account:
the person making them writes a marker into their titles, and a test organisation copies only
those.

## Decision

The owner agreed to workplan 0162 §2 as written on 2026-11-20.

- **(a) A marker, in the item's own title.** The default is `[Ownpace-test]`. An item is in scope
  when its own title contains the marker, anywhere, ignoring case: a mail's subject; an event's
  `SUMMARY`, a recurring series decided by its master and its overrides following it; a contact's
  `FN`; a task's title; a file's own name. Not the folder, the label, the sender or the guests. A
  reply, `Re: [Ownpace-test] …`, stays in scope.
- **(b) Set on an organisation, by an appointed operator only**, from Support, with the
  `platform_operator` check *reopen* and *close* use. Every migration created in that organisation
  carries the marker from its creation, on the migration itself. No customer sees the switch. An
  organisation becomes a test, or stops being one, only while it holds no migration.
- **(c) Fixed for the life of a migration.** Written when it is created, never changed or removed:
  removing it would start copying everything, and a real move is a new migration in an
  organisation that is not a test.
- **(d) Applied once, where the source is first listed**, by one wrapper around each source port,
  applied where the source is built, as `GmailFolderView` is. Discovery, every pass, the bin scan,
  verification and every count see the same marked set. Nothing unmarked enters the ledger or is
  written to the target.
- **(e) Never finished or switched over.** *Finish*, ending or keeping a data type, the cutover's
  preparation and the cutover commands refuse it and name the reason. The screens say *Test*. It
  ends by being deleted.
- **(f) Losing the marker deletes nothing.** An item whose marker is taken out of its title keeps
  its last copy, as any item the source stops offering. Only a real deletion at the source reaches
  *Deleted on the old system*, and only a confirmed *Delete it here too* removes the copy
  (ADR-0024).
- **(g) Guests as today.** The marker changes what is copied, not how (ADR-0043).
- **(h) Every source kind, Google first.** The wrapper reads only the titles the listings carry,
  so it fits every source.

How T1 holds (b) and (c):

- **The organisation's marker is a row**, `test_organisation` (managed migration 0062), never a
  column on `tenant` (ADR-0036). The doors take the organisation's migrations lock, the advisory
  lock `POST /api/migrations` takes before it counts, then refuse while any `mailbox_mapping` row
  names the organisation, whatever its status, as `support_tenants.migration_count` and
  `operator.sh clean empty-tenant` count. A mark and a create are therefore decided one after the
  other: the create reads the marker under the same lock, and either copies it or makes the
  organisation hold a migration before the mark is decided. The lock is keyed on the id as the
  database spells it, so an id in capitals takes the same lock. Each door writes an audit row,
  `tenant.test_marker_set` or `tenant.test_marker_cleared`, and the same marker again changes and
  records nothing.
- **Only an operator writes the row, and the database says so.** The table's INSERT, UPDATE and
  DELETE policies ask that `app.current_user` names a row of `platform_operator`, and a row is
  written only in that operator's name, as 0023 and 0055 guard theirs; reading stays the
  organisation's, for the create. The doors set `app.current_user` and ask `platform_operator` in
  the transaction that writes.
- **Each migration's copy is a column** (ledger migration 0070), because every builder of a source
  must read it, and a column is harder to forget than a key in `scope_selection.filters`, which is
  per data type, read by nothing, and does not admit `task`. 0070's BEFORE UPDATE trigger, which
  refuses any change of it for every role, is what keeps it fixed. The guard
  `a-test-marker-only-a-create-writes` is an early warning: it reads the updates of the table it
  can recognise, SQL and drizzle, and refuses any that names the column, or a drizzle update whose
  table is not named as itself; SQL built from pieces, or a column named at run time, it cannot
  see, and the trigger still refuses.
- **The screens.** The operating contract carries `testMarker`. Every page under a test
  migration shows a banner, in English and Dutch, drawn once by the frame around those pages, and
  the lists show a *Test* badge. The Support control is English, as every operator screen is
  (ADR-0013).

## Consequences

- A real account can be tested on live with a few marked items and an unmarked control of each
  kind, watched at the target (workplan 0162 T4).
- The wrapper sees every title the listings already return, and keeps none that is unmarked. A
  test account too large to list whole would need the source to filter first (T5, parked).
- A test organisation's migrations stay there until deleted; the organisation can then be
  unmarked.
- The appliance gains nothing: its `MappingConfig` can carry a marker later, if it needs one.

## Alternatives considered

**A new Google account made only for testing.** One made on 2026-11-20 was suspended by Google the
same day. A dedicated account, when one is available, works with this decision unchanged.

**The marker at the start of the title only.** Refused for anywhere: a reply, `Re: …`, would leave
the test (workplan 0162, open question 1).

**A file in a marked folder is in scope.** Refused: one rule for every data type, the item's own
title (open question 2).

**Refuse every source that is not Google in a test organisation.** Refused by (h): the wrapper fits
every source (open question 3).

**The marker on the migration, chosen in the wizard.** Refused by (b): no customer sees the switch,
and an organisation is a test or not, so that none of its migrations copies a real account whole.

**Ask Google to filter first** (`UID SEARCH SUBJECT`, Drive's `name contains`). Parked as T5: the
Tasks API has no search, and whether Google's DAV servers honour a text match is not measured.
