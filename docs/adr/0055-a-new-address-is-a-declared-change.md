# ADR-0055: A new address is a declared change, applied to cards and calendars, never to mail

- **Status:** **Accepted 2026-11-22** by the owner, as workplan 0168 proposed it, with its decisions D1–D10 as recommended; built 2026-11-23 (0168 T1–T9, #2067), and amended that day three times: by the landing's review (decisions 3 to 6), for alpha.18 (5, 6), and by the owner's two decisions on copies nothing changes (5, 6). See the Amendment log.
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

- **Built** (workplan 0168 T1–T9). A copy changes only once the organisation's table holds a
  confirmed row; with none, every byte is the source's.
- **One table per organisation**, `address_change`, in the shared chain under forced row security.
  Only an owner or an admin writes it, and only rows a person **confirmed** reach a writer; the
  machine never confirms. An admin may confirm for a person, attributed; the person confirms or
  sends back their own row, on their page or through their links (0168 D6).
- **A pure function of source bytes and table** (`applyAddressChanges`), applied before
  `repairPayload` and `neutraliseScheduling`. An empty table is the identity, byte for byte.
- **Changed:** a vCard `EMAIL` gains the new address first and preferred, the old kept (D2); an old
  `ORGANIZER` is replaced; an `ATTENDEE` only where the organiser is in the table or is the person (D3).
- **Never changed:** mail, in any byte (D1); free text (D4); display names; UIDs; a card inside a
  card; an outside organiser's invitation.
- **Declared, never silent:** each item records the digest of the rows that decided it
  (`item.address_digest`), counted and named by verification and the confirmed list; a change still
  to come (`item.address_digest_due`) is never a match. A copy nothing will change (`unguarded`,
  `left`) is checked as copied, said apart, and holds nothing. Writes are audited.
- **A changed table converges** by a rewrite guarded by `If-Match` with a strong version, else
  the copy is left and said as left. A copy deleted on the target is never remade (decision 6).
  Past a cutover only on a person's press, for the table shown (D5), never for a copy whose source
  changed after it. Silence (ADR-0043) holds.
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
2. **The change is a pure function of the source bytes and the table**
   (`applyAddressChanges`, `packages/shared`), applied by the contact and calendar writers before
   their existing repairs and before `neutraliseScheduling`. An empty table is the identity, byte
   for byte.
3. **What it changes:**
   - a vCard `EMAIL` that is an old address gains the new one, first and preferred, and the old line
     is kept (a card that already lists the new address prefers that line where it is, and the
     added line carries no `PID`, `ALTID` or `PROP-ID`);
   - an `ORGANIZER` that is an old address is replaced;
   - an `ATTENDEE` is replaced only in events whose organiser is in the table or is the person.
4. **What it never changes:**
   - mail, in any header or byte;
   - free text (`SUMMARY`, `DESCRIPTION`, `LOCATION`, `NOTE`);
   - display names;
   - UIDs;
   - a card inside a card;
   - an outside organiser's invitation.
5. **It is declared, never silent.** Each item records the digest of the confirmed rows that
   decided its bytes (`item.address_digest`), and a pass that did not write it records the digest
   it should carry (`item.address_digest_due`). Verification and the confirmed list count changed
   items and name the digest, an item a change still waits for is never reported as a match, and
   a sample in which every item waits holds the cutover. An item with no version to guard its
   rewrite is said apart from those that wait (`unguarded`): no pass and no press changes it.
   *Amended 2026-11-23 by the owner (Amendment log):* such an item is checked as a plain copy,
   counted and named apart, and never holds the cutover on its own.
6. **A changed table converges** through the ordinary rewrite, with every rule a rewrite keeps:
   - an adopted item is left alone;
   - the write carries `If-Match` with a strong recorded version, and without one the item is left
     as it is and counted;
   - a tombstoned item stays tombstoned, and an item deleted on the target is never made again:
     a rewrite that finds no copy says so (`goneFromTarget`), on JMAP and on a DAV `If-Match` 412
     whose HEAD finds nothing, for a source change as for an address change, and a failed rewrite
     is retried as that rewrite, never as a create;
   - a source that lists only what changed reads a collection again when its table moves, and for
     a calendar or task when the account's own addresses move, since they decide its guests.

   After a data type's cutover, it waits for a person's press, which names the table the page
   showed (workplan 0168 D5). *Amended 2026-11-23 by the owner (Amendment log):* a copy whose
   source changed after the cutover is left as it is and said as left (`left`): the press never
   rewrites it, and it never counts as waiting.
7. **Shares:** a confirmed row counts as ADR-0032 §6's confirmation of a grantee's address. Each
   press still sends its address. Nothing else in ADR-0032 changes.
8. **Silence holds:** ADR-0043's rule is unchanged, and the managed gate proves it on a changed
   event.

## Amendment log

- **2026-11-23** — **Copies that cannot be guarded do not hold the switch** (the owner, workplan
  0168, on the follow-ups' advice: *"i think i take on what you adviced."*). A copy with no strong
  version to guard a rewrite is changed by no pass and no press, so it keeps the old address. A
  verification sample of only those held the cutover for good, with no remedy. Now verification
  checks it as a plain copy, which must still equal the bytes as copied, counts and names it apart
  (`unguarded`, `ADDRESS_UNGUARDED_*`), and never holds the cutover on it alone; an item truly
  waiting for a pass or the press still holds as before. The words: *N items keep the old address,
  because the new system offers no safe way to update them.* Record: decision 5.
- **2026-11-23** — **After the switch, a copy whose source changed is left, and said as left**
  (the owner, workplan 0168: *"2) b."*). Past a data type's cutover a change at the source
  overwrites no copy (ADR-0048, *"Stop overwriting"*). A copy whose address rows moved too was
  counted as waiting for the press, which never rewrites it, since that rewrite would carry the
  source's change. Now a pass records it as left (`item.address_left_at`, ledger 0075), and every
  reader counts it apart (`left`, `addressChangesLeft`, `ADDRESS_LEFT_*`): the press never claims
  or rewrites it, it never holds the cutover, and it never counts as waiting. It is checked as a
  plain copy. Option (c), rewriting only the address lines in the new account's copy, was not
  chosen. The words: *changed in your old account after the switch, not updated.* Record:
  decision 6.

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
