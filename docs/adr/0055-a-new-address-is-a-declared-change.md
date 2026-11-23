# ADR-0055: A new address is a declared change, applied to cards and calendars, never to mail

- **Status:** **Accepted 2026-11-22** by the owner, as workplan 0168 proposed it, with its decisions D1–D10 as recommended; built 2026-11-23 (0168 T1–T9, #2067), and amended that day by the landing's review: a copy records the digest of the rows that decided it, a rewrite needs a strong recorded version, and the press names the table it was shown (decisions 3 to 6); again for alpha.18 (3 to 6).
- **Date:** 2026-11-22
- **Deciders:** owner
- **Relates to:** [ADR-0005](./0005-idempotency-ledger-nondestructive.md) (re-runs converge),
  [ADR-0020](./0020-ledger-rebuildable-cache-recovery.md) (natural keys; the generated Message-ID),
  [ADR-0032](./0032-sharing-queue-target-native-invites.md) §6 (grantee addresses confirmed by a
  person), [ADR-0034](./0034-appliance-configuration-surface.md) (the doors per deployment),
  [ADR-0043](./0043-a-migration-is-silent-by-default.md) (no write sends mail),
  [ADR-0046](./0046-a-rendering-is-compared-by-its-parts.md) rule 4 (a stored fact carries its
  scheme), [ADR-0050](./0050-a-move-is-a-persons-migrations.md) (a person),
  [workplan 0168](../workplans/0168-a-new-address-for-one-you-cannot-take-along.md)

## Operative rules

- **Built** (workplan 0168): only a confirmed row changes a copy.
- **One table per organisation**, `address_change`, in the shared chain under forced row security.
  Only an owner or an admin writes it, and only rows a person **confirmed** reach a writer; the
  machine never confirms. An admin may confirm for a person, attributed; the person confirms or
  sends back their own row, on their page or through their links (0168 D6).
- **A pure function of source bytes, table and migration start** (`applyAddressChanges`), before
  `repairPayload` and `neutraliseScheduling`. An empty table is the identity, as is an event or task
  over at that start (`mailbox_mapping.created_at`).
- **Changed:** a vCard `EMAIL` gains the new address first and preferred, the old kept (D2); an old
  `ORGANIZER` is replaced; an old `ATTENDEE`, `SENT-BY`, `DELEGATED-*` or `MEMBER` address only where
  the organiser is in the table or is the person (D3).
- **Never changed:** mail, in any byte (D1); free text (D4); display names; UIDs; a card inside a
  card; an outside organiser's invitation.
- **Declared, never silent:** each item records the digest of the rows that decided it
  (`item.address_digest`); verification and the confirmed list count and name it; an older digest,
  or a change a copy still waits for (`item.address_digest_due`), is never a match. Every write of
  the table is audited by reference, never by address.
- **A changed table converges** by a rewrite guarded by `If-Match` with a strong version, else
  the copy is left and said as left. A copy deleted on the target is counted gone, never remade
  (decision 6). Past a cutover only on a person's press, for the table they were shown (D5).
  Silence (ADR-0043) holds.
- **Shares:** a confirmed row is ADR-0032 §6's confirmation; each press still sends its address.
  Support shows counts only (D7); erasure purges both tables (`PURGED_TABLES`).

## Context

People leaving Google or Microsoft on a consumer address (`‹name›@gmail.com`,
`‹name›@outlook.com`, `‹name›@hotmail.com`, `‹name›@live.com`) cannot take the address with
them. They arrive at a new account, often with a family or team, at `‹first›@example.org`. Today a
copy is faithful in every address:

- mail is copied byte for byte (`ensureMessageId`, `contentHash`);
- vCards are copied with two repairs (`repairPayload`);
- events are copied with `SCHEDULE-AGENT=CLIENT` added to their organiser and guests, and their
  addresses unchanged (`neutraliseScheduling`).

So in the new account the person's own events name an organiser the server does not recognise as
them, and the family's cards point at addresses that are being given up. The owner asked, on
2026-11-22, for a way to "overwrite" those addresses, for a family or team moving together too.
Workplan 0168 §1 to §3 reads where an address lives in each data type and what changing it would
break.

## Decision

1. **One table of address changes per organisation**, old to new, in the shared ledger chain
   (`address_change`, forced row security). Only rows a person **confirmed** reach a writer. The
   machine may propose rows, and never confirms one.
2. **The change is a pure function of the source bytes and the table**, and for a calendar object
   of the migration's start too (decision 4; `applyAddressChanges`, `packages/shared`), applied by
   the contact and calendar writers before their existing repairs and before
   `neutraliseScheduling`. An empty table is the identity, byte for byte.
3. **What it changes:**
   - a vCard `EMAIL` that is an old address gains the new one, first and preferred, and the old line
     is kept (a card that already lists the new address prefers that line where it is, and the
     added line carries no `PID`, `ALTID` or `PROP-ID`);
   - an `ORGANIZER` that is an old address is replaced;
   - an `ATTENDEE` is replaced only in events whose organiser is in the table or is the person;
   - in those events, an old address in an `ORGANIZER`'s or `ATTENDEE`'s `SENT-BY`,
     `DELEGATED-FROM`, `DELEGATED-TO` or `MEMBER` gets the new one, each value of a list in its own
     quotes and scheme spelling (amended 2026-11-23; the owner: *"yes, since the new address will
     control the new events"*). An `ATTENDEE` left as it was keeps them.
4. **What it never changes:**
   - mail, in any header or byte;
   - free text (`SUMMARY`, `DESCRIPTION`, `LOCATION`, `NOTE`);
   - display names;
   - UIDs;
   - a card inside a card;
   - an outside organiser's invitation;
   - a calendar object that was over at the migration's start, `mailbox_mapping.created_at`, one
     moment no pass and no press moves: an event whose last occurrence ended before it, a series
     with an `UNTIL` or `COUNT` spent and no `RDATE` or moved instance still to come, a task done
     before it, a journal entry dated before it. The whole object is one decision, and dates that
     cannot be read are not over. Its bytes are decided by no row, so its digest is null (amended
     2026-11-23; the owner: *"Though perhapse we need not change past-events we migrate."*).
   - A task is done before the start when its `COMPLETED` time is; without one, when its `STATUS`
     is `COMPLETED` or `CANCELLED` and its `LAST-MODIFIED`, else its `DTSTAMP`, is. With no such
     time, or one that cannot be read, it is not over. So a task open at the start changes and
     stays changed when it is finished later: nothing goes back during a migration (the same day's
     review).
5. **It is declared, never silent.** Each item records the digest of the confirmed rows that
   decided its bytes (`item.address_digest`), and a pass that did not write it records the digest
   it should carry (`item.address_digest_due`). Verification and the confirmed list count changed
   items and name the digest, an item a change still waits for is never reported as a match, and
   a sample in which every item waits holds the cutover. An item with no version to guard its
   rewrite is said apart from those that wait (`unguarded`): no pass and no press changes it.
6. **A changed table converges** through the ordinary rewrite, with every rule a rewrite keeps:
   - an adopted item is left alone;
   - the write carries `If-Match` with a strong recorded version, and without one the item is left
     as it is and counted;
   - a tombstoned item stays tombstoned, and an item deleted on the target is never made again:
     a rewrite that finds no copy says so (`goneFromTarget`), on JMAP and on a DAV `If-Match` 412
     whose HEAD finds nothing, for a source change as for an address change, and a failed rewrite
     is retried as that rewrite, never as a create;
   - a source that lists only what changed reads a collection again when its table moves, and for
     a calendar or task when the account's own addresses move, since they decide its guests; the
     migration's start is in a calendar's tag too (decision 4), which never moves, so a calendar
     read before 2026-11-23 is read once more and its past events go back to the source's bytes.

   After a data type's cutover, it waits for a person's press, which names the table the page
   showed (workplan 0168 D5).
7. **Shares:** a confirmed row counts as ADR-0032 §6's confirmation of a grantee's address. Each
   press still sends its address. Nothing else in ADR-0032 changes.
8. **Silence holds:** ADR-0043's rule is unchanged, and the managed gate proves it on a changed
   event.

## Consequences

- **What the person gets.** A person can edit their own events in the new account, and a family's
  address books point at the addresses they now use. Their mail archive stays what it was, and its
  signatures stay valid.
- **The copy is no longer faithful in every byte for contacts and calendars**, and that is why the
  change is a recorded scheme on each row, not an implicit difference.
- **A new row can rewrite many items at once**, across every migration of a tenant, within the
  ordinary budgets.
- **The table holds other people's addresses.** The privacy policy needs a line before it is shown
  to anyone (workplan 0168 §5, D8). Erasure purges it (`PURGED_TABLES`).

## Alternatives considered

- **Rewrite mail headers.** Refused: it breaks DKIM and ARC, it changes the generated Message-ID's
  key material (so a copy would be made twice, against ADR-0005), and it falsifies the archive.
- **One table per migration.** Refused: a family's copies would disagree about one person's address.
- **Infer the new address from the local part, unconfirmed.** Refused, as ADR-0032 §6 refused it:
  "usually" is not a rule the machine may act on.
- **Change free text too.** Refused: an address in prose cannot be changed safely.
