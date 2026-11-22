# Workplan 0168 — A new address for one you cannot take along

> **In one line:** A declared table of address changes (old to new), shared by every migration of one family or team, applied to contacts' `EMAIL`, calendar `ORGANIZER`/`ATTENDEE` and share grantees, never to mail bytes or free text. The plan covers its step in *Start a migration* and the proposed ADR-0055.

## Status — 2026-11-22 (update this block at the end of every session)

**2026-11-22: the owner answered §9.** D1, D2, D3, D4, D5, D6, D8, D9 and D10: *"ok"*, each as
recommended. D7 drew a question: *"then how can he/she manage the family? Or is the admin not the
one managing the migrations?"* D7 is about the **operator**, the Ownpace team's Support pages, not
the organisation's owner or admin. The admin manages the family and sees every address in the
organisation's table on the team screen (§6.3). D7 is reworded to say so and waits for the owner's
answer. ADR-0055 stays proposed until the owner accepts it.

**2026-11-22: designed, nothing built.** The owner asked, on 2026-11-22:

> *"As an important function I want users to be able to 'overwrite' what they migrate into their
> target system with a new username/mailaddress when/if they migrate for example out of gmail,
> live, hotmail or other emailaddress/username they can not take with them. Reason on those
> situations and how/where we need to fit this in the UX. [...] Also, take into account a family
> or team might move together and want to overwrite other addresses as well."*

This plan is the reasoning (§1 to §7), a plan in steps (§8) and the decisions it needs (§9). It
proposes [ADR-0055](../adr/0055-a-new-address-is-a-declared-change.md), **proposed, not accepted**,
because the design amends what ADR-0005, ADR-0032 §6 and ADR-0043 say about a faithful copy. Every
fact about today's behaviour below was read in the code on 2026-11-22 at `4aa500c`, and the file
and function are named beside it.

What is proven: nothing runs. The docs checks pass (the PR that opens this plan quotes them).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The owner's decisions and ADR-0055 | owner | 🟡 **Nine of ten answered** | §9: D1–D6 and D8–D10 answered as recommended on 2026-11-22; D7 reworded, waiting. ADR-0055 is proposed; nothing below starts before it is accepted or changed. |
| T1 Address forms and the list of addresses nobody can take along | builder | 📋 **Proposed** | §6.1. `packages/shared/src/address-forms.ts`; `googleAccountKey` moves there. No behaviour change. |
| T2 The table of address changes | builder | 📋 **Proposed** | §4, §5. `address_change` in the shared chain, its routes in both editions, `PURGED_TABLES`. |
| T3 The change itself, as a pure function | builder | 📋 **Proposed** | §2. `applyAddressChanges` for vCard and iCalendar; identity on an empty table; property tests. |
| T4 The writers apply it, and a changed table converges | builder | 📋 **Proposed** | §3. CardDAV, JMAP contacts and CalDAV writers; `item.address_digest`; `classifyKnownItem`. |
| T5 Verification and the confirmed list say what was changed | builder | 📋 **Proposed** | §3.1. A declared change, never a silent difference. |
| T6 The Sharing checklist reads the table | builder | 📋 **Proposed** | §2.4. Pre-fills the grantee; each press still sends its address. |
| T7 The screens | builder | 📋 **Proposed** | §6. *Start a migration*'s step, the person's page, the organisation's table, the migration page. |
| T8 The E2E lane proves it | builder | 📋 **Proposed** | §8. The managed gate and the appliance's e2e: bytes changed where declared, mail byte-identical, no mail sent. |
| T9 Words outside the app | owner | ⏳ **Waiting** | §5, §7. The privacy policy (D8), the customer guides. |

## 1. The situations

### 1.1 Who cannot take their address along

An address can be taken along when its owner controls the domain's MX record. Then the cutover
moves delivery (arch doc §11, *Email cutover*) and the address stays the same. An address cannot
be taken along when the domain belongs to the provider being left.

| Address | Who owns the domain | Can it move? |
|---|---|---|
| `‹name›@gmail.com`, `‹name›@googlemail.com` | Google | No. One account, two spellings (`googleAccountKey`, `apps/api/src/routes/migrations/signed-in-account.ts`). |
| `‹name›@outlook.com`, `@hotmail.com`, `@live.com`, `@msn.com` and the country variants (`@hotmail.co.uk`, `@live.nl` and others) | Microsoft | No. |
| `‹name›@‹tenant›.onmicrosoft.com` | Microsoft, the M365 tenant's built-in domain | No. It ends when the tenant ends. |
| `‹name›@icloud.com`, `@me.com`, `@mac.com` | Apple | No. |
| `‹name›@yahoo.com` and other free mail | the provider | No. |
| an internet provider's address (for example, a cable or DSL company's own domain) | the internet provider | No. It also ends when the internet contract ends, whatever mail provider the person uses. |
| `‹name›@example.org` on Google Workspace or Microsoft 365 | the person or their organisation | **Yes.** The MX record moves; nothing needs a new address. |
| an own domain the person is giving up (an old business, an old employer's domain) | the person, but not for much longer | Technically yes, but the person wants a new address anyway. Detection cannot know this, so the person must be able to declare it (§6.2). |

Today nothing in the product knows these domains. `googleAccountKey` is the only code that reads
an address's domain, and it folds Gmail spellings to check that the right Google account signed
in. The rest matches hosts (`imap.gmail.com` in `rate-budget.ts`, `build-deps.ts`). The Finish
checklist already tells the two cases apart for delivery: *"with an address like @gmail.com, turn
on forwarding to your new address"* (`finish.step4.body`, `apps/web/src/i18n/strings/finish.ts`).

### 1.2 The mixed cases

- **One person, consumer address to own domain.** `‹name›@gmail.com` moves to `‹name›@example.org`
  at Soverin. This is the base case, with one row in the table.
- **A household on consumer addresses moving to one own domain.** Four people, two at Gmail and two
  at Outlook.com, each get `‹first›@example.org`. Their address books hold one another's old
  addresses. Their calendars hold events one of them organised with the others as guests. One table
  of four rows serves all four people's migrations (§4.3).
- **A team.** It is the same as the household, plus shared folders whose grantees are colleagues.
  Often the team is already on its own domain at Workspace or M365, so no address changes and
  nothing is needed. The exception is the tenant's `onmicrosoft.com` names.
- **One member stays behind.** A grandparent keeps `‹name›@hotmail.com`. That address gets no row,
  so every card and event that names it is copied as it is. This is correct: that address still
  works.
- **Aliases and several old addresses.** One person may own `‹name›@gmail.com`,
  `‹name›@googlemail.com` and an old `‹name›@hotmail.com`. The table maps many old addresses to one
  new one. Gmail's dot and plus forms are one key (§2.5), so they need no rows of their own.
- **Moving again later.** A person who moves from `example.org` at Soverin to another provider keeps
  the address. A second migration out of `example.org` needs no row. A person who later moves on
  from a new consumer address needs a second row in another migration, and the rows chain
  `a → b → c`. The table stores each old address against its *final* new address. When a row's new
  address is itself an old address in the table, the table refuses it and says which row to change
  (§4.2), so no chain is ever applied.

## 2. Where an address lives, per data type, and what changing it would mean

### 2.1 Mail: never rewritten

**What the code does today.** Mail is copied byte for byte. `fetchRaw` in
`packages/core/src/reconcile.ts` runs `ensureMessageId(raw.rfc822)`, which returns a message that
already has a Message-ID *"byte-identical"*. Only a message without one gets a generated header
(`packages/shared/src/generated-message-id.ts`, ADR-0020). The IMAP writer appends those bytes
(`upsertEmail`, `packages/connectors/src/imapflow-dav-target.ts`), and the JMAP writer uploads them
as a blob and runs `Email/import` (`packages/connectors/src/jmap-target.ts`). The ledger hash is a
SHA-256 of the bytes, *"hashed verbatim (no header normalization)"* (`contentHash`,
`packages/shared/src/hash.ts`). Verification samples compare that hash with the target's re-read
(`getTargetSamplesFromReindexer`, `packages/core/src/verification-implementations.ts`;
`confirmation-pass.ts`).

**Why it stays that way.** Rewriting `From`, `To`, `Cc`, `Reply-To`, `Sender` or `Delivered-To` in
stored mail would:

1. break every DKIM signature and ARC seal over those headers. A client or a later import that
   checks them would mark the person's own archive as forged;
2. change the generated Message-ID of mail that has none, because its key material is exactly
   those headers (`KEYED_HEADERS` in `generated-message-id.ts`: date, from, sender, reply-to, to,
   cc, …). The next pass would no longer find the copy by its natural key and would copy it again,
   which breaks hard rule 1;
3. make the copy differ from the source, which is what verification and the confirmed list
   measure: a sampled hash would differ for every rewritten message;
4. falsify a historical record. On the day it was sent, the mail went from and to the old address.
   A dispute, a tax question or a search for "what did I write to whom" needs the old address.

**What the person gets instead.** The new address is the target account's own identity, because
the target account *is* the new address. Mail sent from now on comes from it. The old address
appears in the old mail, which is true. Three things the person may want are guidance, never
writes, and they belong on the Finish checklist:

- forwarding at the old provider (already step 4 of Finish), and an automatic reply there saying
  the address has changed. Ownpace sends nothing to anyone (ADR-0043), so the person turns this on
  themselves, in the old provider's settings;
- telling the mail program on the target that the old address was also *you*, so that old sent mail
  shows as sent by you. Some clients have this as an identity or alias setting. Ownpace writes no
  identity today (`Identity/set` appears nowhere in `packages/`) and this plan does not add one;
- sending *as* the old address from the new provider. That depends on the old domain's DMARC
  policy, which neither the person nor Ownpace controls. It is not recommended and not offered.

D1 asks the owner to confirm this.

### 2.2 Contacts: `EMAIL` in a card

**What the code does today.** The CardDAV writer repairs two known defects and otherwise writes the
card unchanged (`repairPayload`, `packages/engines/src/dav-payload-defects.ts`; `upsertContact`,
`packages/engines/src/carddav-target-writer.ts`). It hashes the repaired body it sends, *"or the
three disagree"*. JMAP hands the vCard to the server's `ContactCard/parse`
(`packages/connectors/src/jmap-contact-target.ts`). `EMAIL` is one of the properties the
contact fingerprint compares (`CONTACT_PROPERTIES` in `packages/shared/src/dav-canonical.ts`: UID,
FN, N, EMAIL, TEL, ORG, TITLE, NOTE), so a changed `EMAIL` is a changed contact.

**Three cards are affected.**

- **The person's own card**, if they keep one. Nothing marks a card as "me" in CardDAV or in
  Google's contacts, so this card is found like any other: by an `EMAIL` that is an old address in
  the table.
- **Cards of family members or colleagues who move too**, in everyone's address book.
- **Cards of people who are not in the table.** These are never touched.

**What the change does.** The proposal (D2) is to **add the new address and keep the old one**: the
new `EMAIL` line goes first and carries `PREF=1`, and the old line stays, losing any `PREF` it had.
Keeping it costs nothing and keeps the card matching every old message from that person, so a
search in the new mail program still finds them. Replacing the old address would lose that match.
Leaving the card unchanged means the household's first mail in the new system goes to the old
address.

### 2.3 Calendars: `ORGANIZER` and `ATTENDEE`

**What the code does today.** Every event the CalDAV writer PUTs goes through
`neutraliseScheduling` (`packages/shared/src/calendar-scheduling.ts`). It sets
`SCHEDULE-AGENT=CLIENT` on every `ORGANIZER` and `ATTENDEE`, and never changes the address. At a
target on `TARGETS_THAT_MAIL_GUESTS`, both properties become `COMMENT` lines instead
(`withoutGuests`). Since 2026-11-20 that list is empty: Infomaniak (0161, #1965) and Cirrux (0160,
#1968) keep their guests marked `CLIENT`, and a copy at such a target that already lists guests is
left as it is (#1957; `a-copy-that-lists-guests-is-left-as-it-is.unit.test.ts`). There is no JMAP
calendar writer (`packages/shared/src/target-domains.ts`, 0031 T1 parked). The calendar fingerprint
compares only `UID`, `SUMMARY`, `DESCRIPTION` and `LOCATION` (`CALENDAR_PROPERTIES`,
`dav-canonical.ts`), so **verification cannot see an attendee change today**. That is why §3.1
makes the change declared. The source events arrive as iCalendar from every source, Graph included
(`/events/{id}/$value`, `graph-calendar-source.ts`).

**Why it matters to the person.** A calendar server decides who may edit an event by comparing its
`ORGANIZER` with the account's own addresses (`calendar-user-address-set`, the property the managed
smoke reads for its organiser canary, `deploy/compose/smoke-managed.sh`). An event the person
organised as `‹name›@gmail.com` reads, in the new account, as someone else's invitation. Some
clients then show it read-only, and others offer edits that would go out as a reply to a stranger.
After the change, the person is the organiser and can edit, move or cancel their own events.

**What the change does (D3).**

- **`ORGANIZER`** is replaced when its address is an old address in the table. The `CN` (display
  name) and every other parameter are kept.
- **`ATTENDEE`** is replaced when its address is an old address in the table **and** the event's
  organiser is in the table too, or is the person themselves. That covers events inside the family
  or team.
- **An invitation from someone outside the table keeps every attendee address as it was.** The
  outside organiser's copy names the old address, and a reply sent later from the new account
  would not match the guest they invited. Keeping it is the honest record of whom they invited. The
  screen says so (§6.3).
- **`SCHEDULE-AGENT=CLIENT` is applied after the change**, by the same `neutraliseScheduling` call,
  so the promise of ADR-0043 holds for the changed lines byte for byte. The managed gate already
  proves the hardest case: its organiser canary is an event whose organiser is the target
  account's own address, and the mail catcher stays empty (`the-mail-nobody-should-get.unit.test.ts`).
  T8 adds a changed event to the same check.

**After the move.** An edit the person makes in the new calendar is their own action, and the
target may then mail the guests. Those guests are now at their *new* addresses, which is what the
household wants. ADR-0043 governs writes this product makes, not the person's own edits.

### 2.4 Files: shares by address

**What the code does today.** Nothing applies a share on its own. The Sharing checklist re-creates a
share per row, after the data type's cutover, through Nextcloud's OCS API (`applyShareGrant`,
`applyShareGrantsInFolder`, `packages/core/src/share-queue.ts`; ADR-0032). ADR-0032 §6 already
names this problem: *"`‹name›@old-domain` is usually `‹name›@new-domain` — but 'usually' is not a
rule the machine may act on"*. Today the screen proposes the source's own address, and a person
confirms or corrects it before the press (`Sharing.tsx`). A correction is held only in the page's
state: *"Never stored server-side — each apply still sends its address explicitly"* (`confirmedPairs`,
`Sharing.tsx`). The folder press refuses until every grantee has a confirmed address
(`unconfirmed_grantees`).

**What the change does.** A confirmed row in the table *is* a person's confirmation of a grantee's
new address. T6 pre-fills the grantee field from it and counts it as confirmed for the folder gate.
The press is still a person's, and the address still travels in the request (ADR-0032 is unchanged
in its gates). File contents are never touched.

### 2.5 Free text, and the forms an address takes

- **Free text is never rewritten:** `DESCRIPTION`, `SUMMARY`, `LOCATION`, a contact's `NOTE`, a
  signature, a document. An address in prose may be quoted, part of a sentence, or someone else's
  address that happens to share a local part. A text change would also change the calendar and
  contact fingerprints, which compare those properties. D4 offers no option to change it, and
  recommends against one.
- **Matching uses a key, not the text.** The key is the address in lower case. For Gmail only, dots
  and a `+suffix` in the local part are dropped and `googlemail.com` is read as `gmail.com`, exactly
  as `googleAccountKey` does today and for the same reason: Google treats them as one account. No
  other domain is folded, *"two Workspace users can be `a.b@` and `ab@`"*. Microsoft's consumer
  plus-addressing is not folded either until T1 measures it.
- **A `mailto:` value** is matched on the address after `mailto:`, case-insensitively, as
  `guestNote` already reads it. An `EMAIL=` parameter on an attendee is changed with the value.
- **Display names are never changed.** A `CN` or a vCard `FN` is the person's name, not their address.

## 3. What it does to Ownpace's guarantees

### 3.1 The ledger and verification: a declared change

The change is a **pure function of the source bytes and the table**:
`applyAddressChanges(body, table) → { body, changed, digest }`, in `packages/shared` (T3). The table
has a **digest**, a SHA-256 over its confirmed rows sorted by old key. The writer:

1. applies it before `repairPayload` and before `neutraliseScheduling`;
2. hashes what it sends, as today. So `item.content_hash` is the hash of the changed copy, and the
   sampled comparison of ledger with target holds without any new rule;
3. records the table digest it applied on the row (`item.address_digest`, new, NULL when nothing
   changed). This puts a stored fact in the ledger's own words, which ADR-0046 rule 4 asks of a
   scheme.

Verification and the confirmed list (`packages/shared/src/confirmed-list.ts`) **say** how many
items carry a declared change, per data type, and name the digest. A row whose digest is not the
current table's is reported as *changed under an older table* until a pass rewrites it, never as a
match (T5). Counts and natural keys are untouched (a UID is never changed), so §20's count parity
and missing/extra checks need nothing new.

### 3.2 Idempotency

- An empty table is the identity, byte for byte. Every migration with no row behaves exactly as
  today. A property test pins this (T3).
- `f(f(x)) = f(x)`: a changed copy changed again is unchanged, because a new address is never an
  old one (§4.2). A property test pins this.
- The natural key is the UID, which is never changed, so the target lookup by key (ADR-0020's
  create-if-absent) finds the copy whatever its addresses.

### 3.3 A table that changes after data was copied

`classifyKnownItem` (`packages/core/src/domain-sync.ts`) decides on `sourceVersion`. When the
source is unchanged it answers `skip`, so a new row in the table would reach nothing already
copied. T4 adds one rule before the version rule: a contact or calendar row whose `address_digest`
differs from the digest the item would get now is `rewrite`. Everything that holds for a rewrite
today holds for this one:

- an `adopted` item, which the person edited on the target, is left alone and reported;
- the write carries `If-Match` with the recorded version, so an item the person edited since is
  refused and becomes `adopted` (arch doc §11.1, *the owner works in the target*);
- a tombstoned item stays tombstoned.

Removing a row or changing its new address converges the same way, back to what the source says.

A new row can reach thousands of items across a family's migrations at once. The rewrite rides the
ordinary pass, under the same per-provider budgets (hard rule 4). The pass reports a count
(`addressChanged`), never the addresses (§5).

### 3.4 The cutover, and changes after it

The DNS gate is unaffected. A consumer address has no MX to move, which Finish step 4 already
says. Once a data type is past its cutover, the target is the person's live system
(`sourceStillDecides`, `packages/shared/src/path-phase.ts`), and a rewrite of a copy they have been
using is a change to their live data. D5 proposes that a table change reaches a data type past its
cutover only when someone presses *Apply the new addresses here too* on that migration, which
reaches only copies the person has not edited (the `If-Match` rule).

### 3.5 Delta syncs

New mail at the old address keeps arriving at the source while forwarding is off, and is copied as
it is. New and changed contacts and events are changed by the current table as they are copied. No
new state is needed.

## 4. Families and teams

### 4.1 What there is today

- **An organisation** (`tenant`) has members in `tenant_member`: `user_id` (the sign-in subject,
  0102), `email` (a label, reconciled from a verified claim), a role in `owner`, `admin`, `member`,
  `viewer` and a status (`packages/managed/migrations/0001_the_managed_service.sql`; `declined`
  from 0008, 0099). During the alpha an invitation can only make an owner or an admin (`ALPHA_ROLES`
  in `apps/api/src/routes/tenants/members.ts`). No policy reads the role inside an organisation, and
  most writes carry `authenticate` alone (0137 §1; 0137 T2, gating every write by role, is
  proposed).
- **A person** is someone being moved: a name, optionally an email address for grant links, and
  optionally the member it is (`person.user_id`, managed 0061). A migration belongs to at most one
  person (`person_migration`, managed 0031; ADR-0050).
- **Migrated people get links, not accounts** (ADR-0035). They grant their own source on the grant
  page (`Grant.tsx`) and see progress on a progress page. Only they hold their own source
  credential.
- **The appliance has one implicit person** holding every migration (`implicitPeople`,
  `packages/shared/src/people.ts`), and no members or roles.

### 4.2 The table

`address_change`, one row per old address, in the **shared ledger chain** (`packages/ledger/migrations`).
The appliance needs it too (§7), and the rows are about addresses, not customers. Columns:

- `tenant_id`;
- `old_address`, as typed;
- `old_key`, the matching key (§2.5), unique per tenant;
- `new_address`;
- `state`: `proposed` or `confirmed`;
- `set_by` and `confirmed_by`, attributions in the decision idiom (`decided_by`), never an id on
  screen;
- `created_at` and `confirmed_at`.

It has forced row security like every tenant table. Its refusals are said in both languages:

- a new address whose key is an old key in the table (`chained`, naming the row);
- two rows for one old key (`already_changed`);
- a value that is not an address.

**The link to a person is a managed row of its own**, `address_change_person (tenant_id, old_key,
person_id)` in `packages/managed/migrations`, because hard rule 5 makes a managed thing hanging off
a core table a row and never a column. Only **confirmed** rows reach any writer.

### 4.3 One table for every member's migration

The table belongs to the organisation, not to one migration. Every pass of every migration in the
tenant reads the confirmed rows once, at its start, so the change is the same in everyone's address
book and calendar. That is the reason for one table: in a family, Mum's card for her son and the
son's own events must agree on his new address.

### 4.4 Who may set and confirm a row (D6)

- **Proposing** a row for any address: an owner or admin of the organisation. During the alpha that
  is every member (`ALPHA_ROLES`). The machine also proposes rows (§6.1), each `proposed`, never
  `confirmed`.
- **Confirming one's own row:** the person whose old address it is, on a page they already reach.
  A member uses their own person's page (`Person.tsx`, *This is me*). A migrated person uses their
  grant page and progress page (ADR-0035), which gain one line: *"Your new address: ‹first›@example.org.
  Is that right?"*
- **Confirming for someone else:** the proposal is that an owner or admin may confirm for a person
  who has no page of their own (a child, a person the admin migrates with their own credentials).
  The attribution says *"confirmed by ‹admin› for ‹person›"*, and that person's pages show the row
  with *Not right?*, which returns it to `proposed`.
- **An address of somebody who is not moving at all** (an outside colleague, a grandparent who
  stays) is never in the table. Proposing one is allowed, and the person's page shows it, but
  nothing proposes such a row on its own.

### 4.5 When only some members move

A row exists only for an address that changes. A member who stays keeps their address in every card
and event, and the people who move still mail them there. A member who moves later adds their row
then, and every migration converges (§3.3), under D5's rule after a cutover.

## 5. Privacy and legal

The table holds personal data of people other than the customer: a family member's old and new
addresses, a colleague's. The privacy policy (`site/legal/privacy.md`) names *"People who are not
our customers"* in §4.6: the people you migrate for, a family member granting by link, sharing
grantees, invitees. It does not name an address table. This plan does not change the policy. T9
and D8 are the owner's:

- **What the policy would add.** One §4.6 item: *"The addresses that change. When you tell us that
  an address moves to a new one, for you or someone moving with you, we keep both addresses and who
  confirmed it, and use them only to correct those addresses in the contacts, calendars and shares
  we copy for your organisation. Your mail is never changed."* And one §9 row: until the row is
  deleted, or the organisation's data is erased.
- **Retention and erasure.** The rows live as long as the organisation, like its members and
  invitations (§9's *"What belongs to your organisation rather than to one migration"*). Deleting
  a person does not delete the rows, because other people's copies depend on them. The person's
  page offers their deletion. Closing an organisation purges both tables: `address_change` and
  `address_change_person` join `PURGED_TABLES` (`packages/managed/src/offboarding.ts`), and the
  guard that lists every tenant table refuses a table left out.
- **The operator's view.** This is the Ownpace team's view, not the organisation's. The
  organisation's owners and admins see and manage every row on the team screen (§6.3). Support's
  pages show names, states and categories, never content
  (`apps/api/src/routes/support.ts`, every read logged in `support_read`). The proposal (D7) is that
  Support shows the number of rows and how many are confirmed, never an address. The audit log
  records who confirmed which row by reference, and the digest and reports narrate counts, as
  ADR-0032 §8 does for shares.
- **Basis.** For a household this is the household exemption the policy's §3 already describes.
  For a team, the organisation is the controller and Ownpace the processor (arch doc §17). The
  table is the minimum needed to make the copies match the move.

## 6. The UX: where it fits

### 6.1 How the machine finds an address to change

T1 adds `packages/shared/src/address-forms.ts`:

- `addressKey` is `googleAccountKey` moved and generalised;
- `NOT_TAKEN_ALONG` is the list of domains in §1.1, each with the provider it belongs to.
  Microsoft's country variants are taken from Microsoft's own published list when T1 is built,
  never guessed;
- `cannotTakeAlong(address)` answers yes or no and names the provider.

**The proposal** is made in *Start a migration* (`apps/web/src/pages/StartMigration.tsx`, steps
`who`, `from`, `what`, `connect`, `to`, `check`). By the end of `to`, the flow knows both accounts:

- the old account's address is `sourceUsername` (`start-plan.ts`);
- the new one is `targetUsername`. At Infomaniak, whose sync login is a short username, it is the
  mail login (`mailLoginOf`, 0161).

When the old address is on the list, and the new one is a different address, the flow proposes the
row. When the new account's username is not an address, the flow proposes nothing and asks.

### 6.2 Where it fits in *Start a migration* (D9)

A step of its own, `address`, between `to` and `check`. It appears in three cases:

- when the old address is on the list (§6.1);
- when the organisation's table already holds a row for this person;
- when the person chooses *I am also changing my address* on `to`. That is the own domain being
  given up (§1.1), which no list can detect.

Otherwise the flow has the same six steps as today. The step stays out of `check` because it needs
room to say where the address will and will not change, and `check` is already *the green light*
(0153 T4).

**The step, in English:**

> **Your new address**
>
> You are leaving ‹name›@gmail.com. Google keeps that address, so it cannot come with you. Your new
> account's address is ‹first›@example.org.
>
> **Use ‹first›@example.org in place of ‹name›@gmail.com?** [Yes] [No, keep it as it is] [Another
> address…]
>
> **Where your new address goes**
> - **Contacts:** cards that list ‹name›@gmail.com get ‹first›@example.org as their first address.
>   The old one stays on the card, so old mail still finds the person.
> - **Calendars:** events you organised list you as ‹first›@example.org, so you can still change
>   them. Nobody gets an invitation or an update.
> - **Shared folders:** the Sharing checklist suggests ‹first›@example.org for you. You still press
>   each share yourself.
>
> **Where it does not go, and why**
> - **Mail:** every message stays exactly as it was sent. Changing an old message would break its
>   signature and its history. Your new mail comes from ‹first›@example.org.
> - **Invitations from other people:** they keep the address they were sent to, so a reply still
>   matches what the sender has.
> - **Text:** descriptions, notes and documents are never changed.
>
> **Others moving with you?** Add the addresses that change for your family or team. [Add an
> address change]
>
> Nothing is copied yet. You can change this until you press Start, and afterwards on your page.

**Dutch draft, for the owner to check:**

> **Je nieuwe adres**
>
> Je verlaat ‹name›@gmail.com. Dat adres blijft bij Google en kan dus niet mee. Het adres van je
> nieuwe account is ‹first›@example.org.
>
> **‹first›@example.org gebruiken in plaats van ‹name›@gmail.com?** [Ja] [Nee, laat het zoals het
> is] [Een ander adres…]
>
> **Waar je nieuwe adres komt**
> - **Contacten:** kaarten met ‹name›@gmail.com krijgen ‹first›@example.org als eerste adres. Het
>   oude adres blijft op de kaart staan, zodat oude mail de persoon nog vindt.
> - **Agenda's:** afspraken die jij hebt gemaakt, noemen jou ‹first›@example.org, zodat je ze kunt
>   blijven wijzigen. Niemand krijgt een uitnodiging of een wijziging.
> - **Gedeelde mappen:** de lijst Delen stelt ‹first›@example.org voor jou voor. Elke deling druk je
>   nog steeds zelf.
>
> **Waar het niet komt, en waarom**
> - **Mail:** elk bericht blijft precies zoals het is verstuurd. Een oud bericht wijzigen breekt de
>   handtekening en de geschiedenis ervan. Je nieuwe mail komt van ‹first›@example.org.
> - **Uitnodigingen van anderen:** die houden het adres waarnaar ze zijn gestuurd, zodat een
>   antwoord nog klopt met wat de afzender heeft.
> - **Tekst:** beschrijvingen, notities en documenten worden nooit gewijzigd.
>
> **Verhuizen er anderen mee?** Voeg de adressen toe die voor je gezin of team veranderen.
> [Adreswijziging toevoegen]
>
> Er is nog niets gekopieerd. Je kunt dit wijzigen tot je op Start drukt, en daarna op je pagina.

**On `check`:** one line per changed address, *"‹name›@gmail.com becomes ‹first›@example.org in
contacts, calendars and shares"* / *"‹name›@gmail.com wordt ‹first›@example.org in contacten,
agenda's en delingen"*. Discovery counts no bodies (0013), so the screen states the rule before the
first copy, never a count it could not have.

### 6.3 Afterwards

- **The person's page** (`Person.tsx`) gets a section *Addresses* / *Adressen* listing their rows.
  Each row reads *Confirmed* / *Bevestigd* (with who) or *Waiting for ‹person›* / *Wacht op
  ‹persoon›*, and offers *Change* / *Wijzigen* and *Delete* / *Verwijderen*.
- **The organisation's table** sits on the team screen (`Tenants.tsx`) as *Address changes* /
  *Adreswijzigingen*: every row, its person, its state and who set it, with *Add* / *Toevoegen*.
  It uses the screen's existing owner-or-admin rule.
- **The migration page** (`MappingDetail.tsx`) already shows *"From {source} to {target}"*
  (`hub.connections`). It gains *"Your new address is used in contacts and calendars"* / *"Je
  nieuwe adres wordt gebruikt in contacten en agenda's"* and the count of changed items from the
  last pass. After a data type's cutover, a table change shows *Apply the new addresses here too* /
  *De nieuwe adressen hier ook toepassen* (D5).
- **Moves and Deletions** (`Moves.tsx`, `Deletions.tsx`) are unaffected: a changed address is
  neither a move nor a deletion, and their rows keep their keys. Neither page mentions the change.
- **The confirmed list** (`Confirmed.tsx`) shows a changed item as *Matches, with your new
  address* / *Klopt, met je nieuwe adres*, and one changed under an older table as *Waiting for the
  next pass* / *Wacht op de volgende ronde* (T5).
- **The completion report** (`buildCompletionReport`) gains *Addresses changed*: the rows, and per
  data type how many items carry them. It also says that mail was copied unchanged.
- **The Sharing checklist** (`Sharing.tsx`) pre-fills a grantee from a confirmed row, and labels it
  *From your address changes* / *Uit je adreswijzigingen*.

## 7. The self-host appliance

The change is in the engine, so it applies on the appliance unchanged (hard rule 5, ADR-0003). The
table lives in the shared chain, which the appliance applies, both on Postgres and on PGlite. The
door follows ADR-0034:

- **Personal**: the appliance's own confirm page (`GET /`) shows the step of §6.2 for its one
  person, and `POST /address-changes` writes the rows. Nobody signs in on the appliance, and a
  person typing on its loopback page is its owner, so a row confirmed there is `confirmed` with
  `confirmed_by: 'operator'`, as its decisions are today.
- **Organisation**: a file, `address-changes.json` in `CONFIG_DIR`, is the only door, and the UI
  shows it read-only, naming the file. A row in the file is confirmed by the admin who wrote it.
- **No managed row**: `address_change_person` is managed-only. The appliance has one implicit
  person, and `no-managed-leakage.unit.test.ts` names the table.

## 8. The plan

Each task lands alone, with its proof. T1 to T5 change nothing a person sees until T7 switches the
step on.

- **T1 — address forms.** `address-forms.ts` with `addressKey`, `NOT_TAKEN_ALONG` and
  `cannotTakeAlong`. `signed-in-account.ts` imports `addressKey` from there and keeps its behaviour.
  Proof: the existing `signed-in-account` tests unchanged and passing, plus a table test per
  domain and per Gmail form. The Microsoft variants come from Microsoft's published list, and the
  test names the date it was read.
- **T2 — the table.** Ledger migration `address_change` with forced row security, and managed
  migration `address_change_person`. `PURGED_TABLES` gains both. Routes `GET`, `POST`, `PUT` and
  `DELETE /api/address-changes` in the OpenAPI spec, with the appliance's Personal door and
  Organisation file. Proof: an RLS guard (a row is invisible to another tenant), the purge guard,
  the refusals (`chained`, `already_changed`) tested in both languages, the appliance's file
  parsed and refused when malformed, and `no-managed-leakage` extended.
- **T3 — the change.** `applyAddressChanges` for vCard and iCalendar, and the table digest. Proof:
  property tests (an empty table is byte-identical; `f(f(x)) = f(x)`; `SUMMARY`, `DESCRIPTION`,
  `LOCATION`, `NOTE` and `FN` are never changed; a folded line round-trips; outside invitations are
  kept, §2.3), fixtures from Google, Graph and Apple sources, and a guard that the mail path never
  imports it.
- **T4 — the writers, and convergence.** The CardDAV, JMAP contacts and CalDAV writers apply it
  first, then `repairPayload` and `neutraliseScheduling`. Ledger migration: `item.address_digest`.
  `classifyKnownItem` rewrites on a changed digest. Proof: the idempotency property tests extended
  (a pass after a pass writes nothing; a table change rewrites each affected item once; an adopted
  item is left alone and reported), and the existing guests guards unchanged
  (`a-guest-a-server-would-mail`, `a-copy-that-lists-guests-is-left-as-it-is`, `target-scheduling`).
  Integration against Stalwart and Nextcloud, under the Stalwart fix doc.
- **T5 — declared, never silent.** Verification and the confirmed list count changed items and
  name the digest. A row under an older digest is never a match. Proof: unit tests on
  `confirmed-list.ts` and `verification.ts`, plus a mutation that drops the digest check, run
  against them.
- **T6 — the Sharing checklist.** A confirmed row pre-fills the grantee and satisfies
  `unconfirmed_grantees`. Each press still sends its address. Proof: `Sharing.unit.test.tsx` and
  the share-queue tests, and ADR-0032's gates unchanged.
- **T7 — the screens.** §6.2 and §6.3, EN and NL with key parity, on the existing pages. Proof: the
  web unit tests, the UI smoke (`pnpm test:ui`) through the new step at phone width, and the
  hardcoded-text guard.
- **T8 — the E2E lane.** The managed gate (`smoke-managed.sh`) seeds a contact and an event that
  name an old address, with a confirmed row. It asserts:
  - the target's bytes carry the new address with `SCHEDULE-AGENT=CLIENT`;
  - a seeded message's bytes on the target hash the same as the source;
  - the mail catcher stays empty (`the-mail-nobody-should-get`);
  - a row deleted after the copy converges back on the next pass.

  The appliance's e2e (`pnpm test:e2e`, both persistence backends) runs the same with the file
  door.
- **T9 — words outside the app.** The privacy policy lines of §5, by the owner (D8). The customer
  guides `docs/guides/en|nl/google.md` and `microsoft.md` get a paragraph on the new address, and
  Finish step 4 a line on the automatic reply at the old provider.

**Order.** T0 first. Then T1, T2, T3 and T4 in that order. T5 must land before T7, so that nothing
is shown before verification can say it. T6 and T9 can go at any time after T2. T8 is the gate
before the step is shown to a tester. D5's after-cutover press can wait until a tester has
cut over a data type.

**Not in this plan:** rewriting mail; changing free text; configuring identities or aliases at the
target; sending anything to anyone; detecting a person's "own card" by any means other than an
address in the table.

## 9. The owner's decisions

- **D1 — Mail.** (a) Never rewritten. The new address is the target's identity, and forwarding is
  guidance. (b) Rewrite `From` in Sent only, as an option. (c) Rewrite every header, as an
  option. **Recommended: (a).** A rewrite breaks DKIM, changes Message-ID keys (so mail is copied
  twice) and falsifies the archive.
- **D2 — A contact's old address.** (a) Add the new address as preferred and keep the old one.
  (b) Replace the old one. (c) Leave cards as they are. **Recommended: (a).** Mail goes to the new
  address, and old mail still finds the person.
- **D3 — Calendar guests.** (a) Change the organiser and the guests in events inside the family or
  team, and leave outside invitations as they were. (b) Change every occurrence. (c) Change the
  organiser only. **Recommended: (a).** The person can edit their own events, and replies to
  outsiders still match.
- **D4 — Free text.** (a) Never changed. (b) Change it as an opt-in, per migration.
  **Recommended: (a).** Prose cannot be changed safely, and changing it changes the fingerprints.
- **D5 — A table change after a data type's cutover.** (a) It applies only when someone presses
  *Apply here too*. (b) It applies automatically, as before the cutover. (c) It does not apply
  after the cutover. **Recommended: (a).** By then the target is live data, so a person decides.
- **D6 — Who confirms someone else's address.** (a) The person confirms on their own page or link,
  and an admin may confirm for them, with attribution. (b) Only the person may confirm. (c) An
  admin's word is enough, with no confirmation step. **Recommended: (a).** A child or a person
  without a link must not block the family, and the person can still undo it.
- **D7 — What the Ownpace team's Support pages show.** This is not about the family's admin, who
  sees and manages every address on the team screen in every option. (a) The number of rows and
  how many are confirmed, no addresses. (b) The addresses, as Support shows members' addresses
  today. **Recommended: (a).** Helping a family needs only the counts; any read would be logged in
  `support_read` either way.
- **D8 — The privacy policy.** (a) Add the §4.6 item and the §9 row before the step is shown to
  anyone. (b) Add them at the next policy revision. **Recommended: (a).** The table holds other
  people's addresses from the first row.
- **D9 — Where the step sits.** (a) A step of its own, shown only when an address changes or the
  person says it does. (b) A section inside *Check, then start*. (c) Only on the person's page
  after the start. **Recommended: (a).** It needs room to say where the address changes and where
  it does not.
- **D10 — Scope of the first list.** (a) Google, Microsoft (with `onmicrosoft.com`), Apple, Yahoo
  and internet providers' addresses. (b) Google and Microsoft only. **Recommended: (a).** The list
  only proposes. Anyone can still say no, or declare an address the list missed.
