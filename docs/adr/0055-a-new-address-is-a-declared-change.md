# ADR-0055: A new address is a declared change, applied to cards and calendars, never to mail

- **Status:** Proposed 2026-11-22, not accepted; nothing is built (workplan 0168).
- **Date:** 2026-11-22
- **Deciders:** owner (to decide)
- **Relates to:** [ADR-0005](./0005-idempotency-ledger-nondestructive.md) (re-runs converge),
  [ADR-0020](./0020-ledger-rebuildable-cache-recovery.md) (natural keys; the generated Message-ID),
  [ADR-0032](./0032-sharing-queue-target-native-invites.md) §6 (grantee addresses confirmed by a
  person), [ADR-0034](./0034-appliance-configuration-surface.md) (the doors per deployment),
  [ADR-0043](./0043-a-migration-is-silent-by-default.md) (no write sends mail),
  [ADR-0046](./0046-a-rendering-is-compared-by-its-parts.md) rule 4 (a stored fact carries its
  scheme), [ADR-0050](./0050-a-move-is-a-persons-migrations.md) (a person),
  [workplan 0168](../workplans/0168-a-new-address-for-one-you-cannot-take-along.md)

## Operative rules

- **Nothing is operative — proposed 2026-11-22, not accepted.** Until the owner accepts it, every
  copy stays as ADR-0043 and ADR-0005 describe: no address in any copied item is changed. Workplan
  0168 §9 holds the decisions this waits on.

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

## Decision (proposed)

1. **One table of address changes per organisation**, old to new, in the shared ledger chain
   (`address_change`, forced row security). Only rows a person **confirmed** reach a writer. The
   machine may propose rows, and never confirms one.
2. **The change is a pure function of the source bytes and the table**
   (`applyAddressChanges`, `packages/shared`), applied by the contact and calendar writers before
   their existing repairs and before `neutraliseScheduling`. An empty table is the identity, byte
   for byte.
3. **What it changes:**
   - a vCard `EMAIL` that is an old address gains the new one, first and preferred, and the old line
     is kept;
   - an `ORGANIZER` that is an old address is replaced;
   - an `ATTENDEE` is replaced only in events whose organiser is in the table or is the person.
4. **What it never changes:**
   - mail, in any header or byte;
   - free text (`SUMMARY`, `DESCRIPTION`, `LOCATION`, `NOTE`);
   - display names;
   - UIDs;
   - an outside organiser's invitation.
5. **It is declared, never silent.** Each item records the table digest it was written under
   (`item.address_digest`). Verification and the confirmed list count changed items and name the
   digest, and an item under an older digest is never reported as a match.
6. **A changed table converges** through the ordinary rewrite, with every rule a rewrite keeps:
   - an adopted item is left alone;
   - the write carries `If-Match`;
   - a tombstoned item stays tombstoned.

   After a data type's cutover, it waits for a person's press (workplan 0168 D5).
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
