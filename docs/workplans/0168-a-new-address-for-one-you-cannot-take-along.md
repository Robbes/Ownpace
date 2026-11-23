# Workplan 0168 — A new address for one you cannot take along

> **In one line:** A declared table of address changes (old to new), shared by every migration of one family or team, applied to contacts' `EMAIL`, calendar `ORGANIZER`/`ATTENDEE` and share grantees, never to mail bytes or free text. The plan covers its step in *Start a migration* and the proposed ADR-0055.

## Status — 2026-11-23 (update this block at the end of every session)

**2026-11-23, later still: the owner's two decisions on copies nothing changes, built, on
`claude/ownpace-public-readiness-y7orc6-0168-unguarded`** (cut from the follow-ups' branch). Two
of the follow-ups' *Not done* items were the owner's call; both are decided and built, each rule
with tests that fail without it (ADR-0055 decisions 5 and 6, amended; its Amendment log).

- **1. Copies that cannot be guarded do not hold the switch.** The owner took the advice: *"i
  think i take on what you adviced."* A copy with no strong version to guard a rewrite keeps the
  old address, since no pass and no press changes it. Verification now checks it as a plain copy
  (its sample is compared with the bytes as copied, so a real difference still fails it), counts
  and names it apart (`addressChanges.unguarded`, `ADDRESS_UNGUARDED_*`), and never holds the
  cutover on it alone; an item truly waiting for a pass or the press is still set aside and still
  holds (`ADDRESS_NOT_COMPARED_*`). The confirmed list keeps such a row's own state, verified when
  it matches, and says `unguarded`. The Check page, the confirmed list, the migration's page and
  the report say *N items keep the old address, because the new system offers no safe way to
  update them*, in English and Dutch (`verification-a-change-under-an-older-table.unit.test.ts`,
  `a-match-under-an-older-address-table.unit.test.ts`, `Verify.unit.test.tsx`,
  `Confirmed.unit.test.tsx`, `MappingDetail.unit.test.tsx`).
- **2. After the switch, a copy whose source changed is left, and said as left: option (b).** The
  owner: *"2) b."* Past a data type's cutover such a copy is counted `changedAfterCutover` and
  never rewritten ("Stop overwriting", ADR-0048), and the press never rewrites it either. A pass
  now records it as left with the change it waits for (`item.address_left_at`, ledger
  `0075_the_copy_left_after_the_switch`, additive; set by `markAddressChangeDue`'s `left`, cleared
  when the copy is written or nothing is due). Every reader counts it apart, never as waiting:
  the pass (`addressChangesLeft`, in `lastPass`), verification (`leftKeys`, `addressChanges.left`,
  `ADDRESS_LEFT_*`, compared as a plain copy, never held), the confirmed list (`left`), the report
  and the migration's page, where the press's *Waiting for it* leaves it out. The words: *changed
  in your old account after the switch, not updated*, in English and Dutch
  (`a-copy-changed-at-the-source-after-the-switch.unit.test.ts`). Option (c), rewriting only the
  address lines in the new account's copy, was not chosen and is not built.

Left alone, as asked: the calendar rule on past events, `SENT-BY` and the other parameters, and the
domain list (`NOT_TAKEN_ALONG`), which other branches build; and the digest of an event and the
own addresses (the follow-ups' last *Not done* item).

Evidence: the two new unit files fail on the follow-ups' head (11 of their 20 tests) and pass
here; the unit tier, typecheck, lint and the docs checks on the branch's head; the SQL readers
and the new column on Postgres through `scripts/local-pg.sh`
(`a-copy-left-after-the-switch.integration.test.ts`, with `a-copy-no-pass-changes.integration.test.ts`
again), and on PGlite (`an-address-change-read-from-a-real-ledger.unit.test.ts`). **E2E
(managed)** is for the coordinating session to dispatch: it should show the confirmed-rows run
green as before, every copy of the run carrying a strong version, so `unguarded` and `left`
absent from the report and the Check page's address lines unchanged.

**2026-11-23, after #2070: `NOT_TAKEN_ALONG` holds Microsoft's, Apple's, Yahoo's and four
Dutch and Belgian internet providers' domains, on
`claude/ownpace-public-readiness-y7orc6-domains`.** Every provider's page was read on 2026-11-23,
and `address-forms.ts` cites one page beside each group: 154 domains, Google 2, Microsoft 103,
Apple 3, Yahoo 17, Ziggo 7, KPN 18, Telenet 1, Proximus 3.

- **Only Thunderbird's ISP database names** 96 of Microsoft's (every country form but the three
  `.co.uk` ones, with `windowslive.com` and `livemail.tw`) and 11 of Yahoo's country forms, and
  the groups say so. Neither provider publishes a list: Microsoft's pages say its country domains
  exist, *"such as .com and .co.uk"*, and Yahoo's give `@yahoo.co.uk` and `@yahoo.fr` as examples.
  §6.1 and T1 asked for Microsoft's own list; there is none.
- **Where a provider's page lists its domains, the list follows it**, and a domain only the ISP
  database still names is left out, since it may have lapsed: Ziggo's `hahah.nl`, `ziggomail.com`,
  `zinders.nl`, `zeggis.nl`, `zeggis.com`, `razcall.nl`, `razcall.com`, `multiweb.nl`, and
  Proximus's `kidcity.be`. Ziggo's own page adds `a2000.nl`, which the database lacks.
- **Kept, though the address can be kept at the provider** (the list only proposes, and the person
  can say No): KPN sells *E-mail Only* within six months of leaving; Telenet's terms keep the
  mailbox after the contract ends, and let Telenet delete one that sends nothing for two years
  (its business page says 18 months); Proximus's terms keep it up to 18 months, free. Neither
  says a Belgian rule requires it. Ziggo offers no way to keep one.
- **Not added:** `onmicrosoft.com` (a tenant's name is a host under it, which a list of whole
  domains holds only as a pattern; the guide keeps the tick for it), `passport.com` (Wikipedia
  only), `pandora.be` and `yahoo.nl`/`yahoo.be` (no source found).
- **The words:** the Microsoft guide, in both languages, says the step now comes by itself for
  Microsoft's addresses, and keeps the tick for an `.onmicrosoft.com` name or any address the
  step does not recognise; the Dutch is for the owner's check. The step says the provider the
  list names (*"‹provider› keeps that address"*) and needed no change, nor did the Google guide,
  the privacy policy (no domain in §4.6 or §9), the feature matrix or the site's *How it works*.
- **Proof:** `address-forms.unit.test.ts` pins every entry by provider, proposes a Hotmail, a
  Live and a Ziggo address, proposes nothing for eight lookalikes (`hotmail.example.com`,
  `notgmail.com`, `mail.hotmail.com`, …) and refuses a pattern; `StartMigration.unit.test.tsx`
  shows the step for `name@hotmail.com`, `name@live.nl` and `name@ziggo.nl` with no box ticked,
  and not for `name@hotmail.example.com` or `name@notgmail.com`. A suffix match in place of the
  exact lookup fails three of them; dropping `hotmail.com` fails the pin and both proposals.

Sources, read 2026-11-23: Microsoft,
[Subscription features in Outlook.com](https://support.microsoft.com/en-us/outlook/premium-features-in-outlook-com-for-microsoft-365-subscribers),
[My username and password have stopped working](https://support.microsoft.com/en-us/accounts-billing/manage/my-username-and-password-have-stopped-working),
[the recovery form's help](https://support.microsoft.com/en-us/accounts-billing/manage/help-with-the-microsoft-account-recovery-form);
[Apple, 118230](https://support.apple.com/en-us/118230); Yahoo,
[SLN2153](https://help.yahoo.com/kb/SLN2153.html), [SLN3407](https://help.yahoo.com/kb/SLN3407.html);
Ziggo, [server settings](https://www.ziggo.nl/klantenservice/e-mail/serverinstellingen),
[Ziggo Mail](https://www.ziggo.nl/klantenservice/e-mail/ziggo-mail); KPN,
[e-mail settings](https://www.kpn.com/service/ugs/instellen-e-mail-laptop-pc),
[E-mail Only](https://www.kpn.com/service/ugs/email-only-abonnement); Telenet,
[Je e-mail](https://www2.telenet.be/residential/nl/klantenservice/internet/e-mail.html),
[terms of 1 November 2024](https://www2.telenet.be/content/dam/www-telenet-touch/nl/klantenservice/downloads-(pdf)/telenet-residentieel-algemene-voorwaarden-1november2024.pdf),
[business: takeover or cancellation](https://www2.telenet.be/business/nl/klantenservice/je-gegevens-aanpassen/verhuis-of-overname/verschil-tussen-overname-en-opzeg.html);
Proximus, [Proximus mail](https://www.proximus.be/support/nl/id_sfaqr_mail_global/particulieren/support/internet/e-mails-en-website/problemen-met-je-mailbox/vragen-over-proximus-mail.html),
[internet terms](https://www.proximus.be/dam/jcr:35ef9494-e322-46db-b5aa-6a90dcfa1f78/gtc-internet-aup-ss-slg-nl.pdf);
Thunderbird's ISP database, `https://autoconfig.thunderbird.net/v1.1/‹domain›` for `hotmail.com`,
`yahoo.com`, `ziggo.nl`, `kpnmail.nl` and `skynet.be`; Wikipedia,
[Outlook.com](https://en.wikipedia.org/wiki/Outlook.com) and
[Yahoo Mail](https://en.wikipedia.org/wiki/Yahoo_Mail).

**2026-11-23, later: the follow-ups for alpha.18, on
`claude/ownpace-public-readiness-y7orc6-0168-followups`.** Six of the seven defects found on the
way are fixed and the API flag is added, each with a test that fails without its fix. The
domain list did not move, and one defect waits for the owner's call.

- **A copy deleted on the target is counted gone, whichever rewrite finds it.** The JMAP file
  writer answers `goneFromTarget` where it threw (`jmap-file-target.unit.test.ts`, three cases).
  A DAV rewrite refused with 412 is told from an edit by one HEAD (`goneOrEdited`,
  `dav-target-version.ts`): 404/410 is gone, 2xx is an edit, anything else fails the item; the
  chunked MOVE's 404 says gone too (`target-edit-protection.unit.test.ts`, *a rewrite whose target
  copy was deleted*, all three writers). The pass reports `goneFromTarget` with no table as well.
- **A failed rewrite is retried as that rewrite**, by the rules of the rewrite it was (a source
  change's, the cutover's included), never as a create; not after a relocation
  (`a-failed-rewrite-is-retried-as-a-rewrite.unit.test.ts`).
- **`record-version` writes the version alone** (`Ledger.recordSourceVersion`), so the usage meter
  no longer reads it as a copy; proven on Postgres through `scripts/local-pg.sh`
  (`a-version-recorded-is-not-a-copy.integration.test.ts`, `packages/managed`).
- **The account's own addresses are in a calendar's cursor tag** (`addressTableTag`, `+own:`), so a
  change to them reads the calendar again and its guests follow
  (`a-new-address-on-a-source-that-lists-only-what-changed.unit.test.ts`). Cards' tags are
  unchanged.
- **A copy with no version to guard its rewrite is said as left, never as waiting**: the confirmed
  list's row says `unguarded` and the summary counts them; verification names them
  (`unguardedKeys`), counts them apart (`addressChanges.unguarded`), warns with
  `ADDRESS_UNGUARDED_*`, and stops telling a held sample of only those to check again after a pass;
  the Check page says both in English and Dutch. Both SQL readers proven on Postgres
  (`a-copy-no-pass-changes.integration.test.ts`).
- **The appliance's apply 404** says `NO_SUCH_MIGRATION_HERE` in both languages, as managed does.
- **`confirmedByThePerson`** on every row of `/api/address-changes` (OpenAPI too); the team screen
  reads it instead of comparing names.

Not done, and why:

- **`NOT_TAKEN_ALONG` still holds Google's two domains.** This build could not read one provider
  page either: support.microsoft.com, support.apple.com, help.yahoo.com, www.ziggo.nl,
  www.kpn.com, www.proximus.be and www2.telenet.be, and every fallback tried (Wikipedia, the web
  archive, Thunderbird's autoconfig), are refused by this environment's network. Search excerpts
  were found for each group, but they are not the pages and are not cited. The next build needs
  those hosts allowed. What the excerpts suggest, to check against the pages: Ziggo keeps
  ziggo.nl, quicknet.nl, home.nl, casema.nl, upcmail.nl, chello.nl and a2000.nl, and offers no way
  to keep one after leaving; KPN keeps kpnmail.nl, planet.nl, hetnet.nl, xs4all.nl and others, and
  sells *E-mail Only* to keep one; Telenet and Proximus (skynet.be) keep the address free for at
  least 18 months, as Belgian rules require; Microsoft and Yahoo publish no list of their country
  domains. Where a provider sells a way to keep the address, the recommendation is to keep the
  domain in the list: the list only proposes, and the person can still say No — *done on
  `claude/ownpace-public-readiness-y7orc6-domains`, above, with what the pages said*.
- **Past a cutover, a copy whose source changed and whose digest moved** is counted as waiting for
  the press, and the press never rewrites it, since that rewrite would also write the source's
  change, which "Stop overwriting" forbids after a cutover. **The owner's call:** (a) the press
  rewrites such a copy, source change included, guarded by `If-Match`; or (b) it is left and
  counted apart from those the press reaches. Nothing changed here.
- **A held sample of copies with no version to guard the write** holds the cutover with no remedy
  in the product (now said as such). Whether such copies should hold the gate is the owner's call.
- **The digest of an event still leaves out the own addresses** where they decide: in a series
  whose override has an organiser in the table, an own-address change moves the bytes and not the
  digest. Folding them in would rewrite, once, every event the account organised that a row
  changed; left for a decision with the press question above.

Evidence: the unit tier, typecheck, lint and the docs checks on the branch's head; the two
Postgres files above through `scripts/local-pg.sh`. **E2E (managed)** is for the coordinating
session to dispatch: it should show the same confirmed-rows run as #507, green, with
`goneFromTarget` absent from a pass that deleted nothing, and the Check page's address lines
unchanged for copies with a strong version.

**2026-11-23: landed whole, in one pull request (#2067), with the review's fixes; the Dutch waits
for the owner's check.** The seven branches of 2026-11-22 (T1–T9) were merged onto alpha.16's C
and reviewed by three readers at once: the engine's data path; the table, its routes and their
security; the screens and the contracts between the parts. Their findings, and a second reading
of the link door, were fixed before anything reached a tester:

- **The table.** Only an owner or an admin writes it; a member confirms or sends back their own
  row and reads only their own rows (§4.4; during the alpha every member is an owner or an admin,
  so this narrows only legacy roles). Every write is in `audit_log`, the row by its pseudonym
  under the deployment's key, never by address. Both access logs write `:key` for the old address.
  A table holds at most 300 rows. A value with a control character, or a key longer than the
  column, is refused in both languages instead of answering 500. The races are tested on Postgres,
  and the erasure with rows in both tables.
- **The appliance.** One table for every tenant: at start-up every tenant's table is made equal
  to the first that holds a row, and a removed `address-changes.json`'s rows are deleted.
- **The link door (§4.4), built.** A person who has only links sees their own rows on their grant
  and progress pages and confirms them or sends them back (`PUT
  /api/{grant|view}/{link}/address-changes/{ref}`). A row is named there by an opaque reference,
  never by the old address; an answer to an address that changed since the page was opened is
  refused; each answer that changed the row is in the audit log under the door's link holder.
  The person's own confirmation is stored as `person:<id>` and said as their name.
- **The engine.** A card nested inside a card keeps every byte, and the line a card gains names no
  `PID`, `ALTID` or `PROP-ID`. A copy records the digest of the rows that decided it, not the
  table's, so a row added for one person rewrites only that person's copies. A copy a change waits
  for is never a match: ledger `0074` records the digest a copy is due
  (`item.address_digest_due`); the confirmed list counts it as older, and verification holds the
  switch when every sampled item waits (`ADDRESS_NOT_COMPARED`). A rewrite needs a strong recorded
  version, sent as `If-Match`; without one the copy is left and counted (`addressChangesUnguarded`),
  and a copy the person deleted on the new system is never made again. A change to the table
  reaches the copies of a source that lists only what changed: every cursor is stored with the
  table it was read under. Both editions carry the pass's address counts in `lastPass`, and *Apply
  the new addresses here too* shows where copies wait, in both editions, and must name the table
  the page showed (400 without it, 409 when it moved).
- **The screens.** *Your new address* writes its rows when *Start* is pressed, never on *Next*; a
  refused row stops the start and is said; a row the flow wrote is deleted only on a *No*. A row
  that waits for a confirmation says so and changes nothing until then. The confirmed list counts
  the address changes and marks only a verified row; its CSV gains an `address` column. The team
  screen links a row to a person; the appliance offers no *Not right?* and no person.
- **The words.** The privacy policy's §4.6 says who added, confirmed, sent back or deleted a change
  stays in the audit log by reference, and §7 that a person's progress link also shows the new
  address set up for them and whether it is confirmed, never the old one. Still version 1.0,
  edited in place, on the owner's word of 2026-11-22 (D8: *"1.0 ok"*), and both pins moved with
  it.

Proven:

- **E2E (managed)** on the landing before these fixes (run #507): the confirmed rows' card carries
  the target account's own address first and preferred (`TYPE=pref` on the server's vCard 3.0)
  and keeps the old one; the event's organiser is the new address with `SCHEDULE-AGENT=CLIENT`,
  its outside attendee and description unchanged; the row deleted, the next pass put both copies
  back as the source has them; the seeded message hashes on the target exactly as on the source,
  one copy; and nothing reached the mail catcher. **E2E (self-hosted)** on PostgreSQL (#429) and
  PGlite (#430): the file door's gate on both backends. All three again on the head that merged;
  the pull request names those runs.
- The unit tier, the type checks, lint and the docs checks on that head; the Postgres race tests
  through `scripts/local-pg.sh`; each fix with a test that fails without it.

**Not in this landing** (follow-ups):

- `NOT_TAKEN_ALONG` holds Google's two domains only. Microsoft's, Apple's, Yahoo's and the
  internet providers' each need a source this build could not read. Until then a person declares
  such an address by ticking *I am also changing my address*, as the Microsoft guide says —
  *done on `claude/ownpace-public-readiness-y7orc6-domains`, above*.
- A member's team screen shows the organisation's table, but a legacy `member` or `viewer` now
  reads only their own rows there, and their *Start* with a new address is refused; nobody is
  granted those roles during the alpha.
- The team screen tells a person's own confirmation from an admin's by name; an API flag would be
  exact when two people share one name — *added for alpha.18 (`confirmedByThePerson`)*.
- A database fault logs the driver's whole error, parameters included (`server-fault.ts`), on
  every route; the fix belongs in `loggableError`.
- `SENT-BY`, `DELEGATED-FROM`/`-TO` and `MEMBER` keep their old addresses while `ORGANIZER` and
  `ATTENDEE` change (D3 names only those two): the owner's call.
- **Where the build differs from §3 and D2 above:** a copy records the digest of the rows that
  decided its bytes, not the table's, with `item.address_digest_due` beside it (§3.1); a rewrite
  needs a strong recorded version, and a copy deleted on the target is counted as gone (§3.3); the
  press names the table the page showed and only reaches copies with a strong version (§3.4); DAV
  and Graph cursors carry the table's tag (§3.5); a card that already lists the new address
  prefers that line where it is (D2). ADR-0055 says each.
- Found on the way, outside this landing's fixes:
  - a rewrite of a file that is gone throws and its retry takes the create path
    (`jmap-file-target.ts`), and so does a failed rewrite of a source change (`domain-sync.ts`)
    — *fixed for alpha.18, above*;
  - `record-version` bumps `last_synced_at`, which the usage meter reads as a copy again — *fixed*;
  - a 412 on a copy deleted on a DAV target reads as an edit, so it is counted as adopted — *fixed*;
  - past a cutover, a copy whose source changed and whose digest moved is counted as waiting for
    the press, which never rewrites it — *the owner's call, above*;
  - a change to the account's own addresses changes no copy's digest, so it rewrites nothing —
    *fixed in the cursor's tag; one narrow case left, above*;
  - copies with no version to guard a rewrite are still called waiting for the next pass in the
    confirmed list's reading, Verify and §20's words — *fixed*;
  - the appliance's apply 404 carries a code and no sentence — *fixed*.


**2026-11-22: T9 drafted by a builder, for the owner's check.** The privacy policy gains the §4.6
item of §5, word for word in English, and a §9 row beside *"What belongs to your organisation
rather than to one migration"*: until that change is deleted, or the organisation's data is
erased; deleting a person does not delete it. The Dutch policy says the same with *u*. The Google
and Microsoft guides, in both languages, gain a section *A new address, when yours cannot come with
you* (`#new-address`), and Finish step 4 a line on the automatic reply at the old provider
(`finish.step4.autoreply`, both locales, with a test). **The policy's version (1.0) and its
*Last updated* line are unchanged, for the owner to decide**, and so are the pins in
`scripts/a-version-the-tester-accepted.unit.test.ts`: that guard fails on these words until the
owner says whether they stay 1.0, edited in place, or become 1.1. The guides describe the step of
T7, which is not built, so they should not reach customers before it.

**2026-11-22: T7 built (the screens), with T6's screen; not yet run against a server.** On
`claude/ownpace-0168-screens`, which merges T1 (`claude/ownpace-0168-core`) and T2's routes and
table (`claude/ownpace-0168-table`). *Start a migration* gains the step `address` between `to`
and `check` in §6.2's three cases, and otherwise keeps six steps; the person's page, the team
screen, the migration page, the confirmed list, the Sharing checklist and the grant and progress
pages say §6.3's lines, in English and Dutch. The appliance's confirm page (`GET /`) holds its
one table through §7's doors: rows added there on its page door, read-only and named on its file door. Proven: the web unit tests of every page touched and
the UI smoke through the new step at phone width in Dutch (the PR quotes both). Not proven: any of
it against a running API. Three things are written against shapes no route serves yet, and the PR
names them: the pass's `lastPass.addressChanged`, the confirmed list's row `address`
(`changed`/`older`), and the link door for a migrated person (`addressChanges` on the grant and
view payloads, `PUT /api/{grant|view}/{link}/address-changes/{oldKey}`). The Dutch follows §6.2's
draft in the dictionary's register (*u*, `GLOSSARY.md`) and without the retired word for a move
(`a-word-the-owner-retired`); the owner reads it in the PR.

**2026-11-22: T8 written, on `claude/ownpace-0168-e2e`; not run yet.** Both lanes need the shared
runner, and nothing here dispatches them.

- **The managed gate** (`smoke-managed.sh`, prepare) confirms two rows through
  `POST /api/address-changes`:
  - in the DAV organisation, a tagged old address to the target account's own;
  - in the mail organisation, the seeded mail's sender.

  The seeder adds event 4 and contact `a`, which name the old address. The gate asserts:
  - on the target's bytes, the card's new address is first with `PREF=1` and the old one is kept;
  - the event's organiser is the new address with `SCHEDULE-AGENT=CLIENT`, and its attendee and
    description are unchanged;
  - both ledger rows carry a digest;
  - the row, deleted, converges back on the next pass;
  - the catcher hears nothing (the existing count of the tagged canary attendee);
  - `<seed-1@dev.local>` hashes on the target exactly as on the source, one copy.
- **The appliance** (`selfhost-address-changes.e2e.test.ts`, both backends) runs the same through
  `address-changes.json`. It does not prove the convergence after a deleted row, because the image
  bakes its config directory. It does not prove the silence either: that stack runs no mail
  catcher. The managed gate proves both.

**2026-11-22: T4, T5 and T6's backend built, on `claude/ownpace-0168-engine`** (merges
`claude/ownpace-0168-table` for T2's migrations and reader). Nothing is shown yet (T7).

- **T4.** Each contact, calendar and task pass reads the tenant's confirmed rows once, at its
  start, in both dispatchers (`addressChangesForPass`; `runAllDomains` and
  `buildDomainDepsFromMapping`), and changes the body the source gave before anything reads it.
  The writers' `repairPayload` and `neutraliseScheduling` then run on the changed body, and the
  loop's hash, the writer's PUT and the ledger name one set of bytes. `item.address_digest` is
  recorded on a create (through `UpsertOptions`, the writers' own race) and on a rewrite, null
  included. `classifyKnownItem` answers `rewrite-addresses` on a changed digest: an adopted copy
  is left alone and counted, the write carries `If-Match`, a tombstone stays. Past a data type's
  cutover it waits (`addressChangesWaiting`) unless a person pressed *Apply the new addresses here
  too*: `POST /api/migrations/{mappingId}/address-changes/apply` (managed) and
  `POST /mappings/{id}/address-changes/apply` (appliance), one ledger door
  (`applyNewAddressesHere`), recorded on `mailbox_mapping` (ledger 0073) and read with the
  phases every pass reads. Proven by unit tests on the real loop with the memory ledger
  (`a-new-address-that-converges.unit.test.ts`: a pass after a pass writes nothing; a table
  change rewrites each affected item once; removing the row converges back; adopted and edited
  copies left alone; tombstones kept; D5 waits, then goes through), two mutations of the rule
  caught, and a PGlite read of the column, the press and the phases. **Not run here:**
  integration against Stalwart and Nextcloud (no container runtime in the build session).
- **T5.** The confirmed list and the §20 report name the table's digest and count copies changed
  under it and under an older table. An older one is never a match: its list row reads
  `differs` with `address: older`, its verification sample is set aside and warned about.
  Proven by unit tests, a mutant of `confirmed-list.ts` run against them, a mutation of
  `verification.ts`, and the PGlite read.
- **T6.** A confirmed row is a grantee's confirmation in the folder press, and the sharing read
  carries `granteeNewAddress` for the page to propose. The single-row press is unchanged: it
  still sends its address. ADR-0032's gates are unchanged (the existing share-queue tests pass).
- **Completion report:** *Addresses changed* / *Gewijzigde adressen*, counts per data type and
  the line that mail was copied unchanged, in EN and NL.

**2026-11-22: T1 and T3 built, on `claude/ownpace-0168-core`.** Nothing calls either yet.

- **T1.** `packages/shared/src/address-forms.ts`: `addressKey`, `isAddress`, `NOT_TAKEN_ALONG`,
  `cannotTakeAlong`. `signed-in-account.ts` reads its fold from there, and its tests pass unchanged.
  **`NOT_TAKEN_ALONG` holds `gmail.com` and `googlemail.com` only.** They are the only domains
  whose sources could be read from the build container on 2026-11-22 (two Google for Developers
  pages, quoted beside the entry). The container's network refused every other provider's pages
  (`support.google.com`, `support.apple.com`; the Dutch and Belgian internet providers' sites),
  so these are left out until their pages are read: Microsoft's `outlook.com`, `hotmail.com`,
  `live.com`, `msn.com`, the country variants and `onmicrosoft.com`; Apple's `icloud.com`,
  `me.com`, `mac.com`; Yahoo's domains; and every internet provider's.
- **T3.** `packages/shared/src/address-changes.ts`: `ConfirmedAddressChange`,
  `addressTableDigest`, `prepareAddressTable` and `applyAddressChanges(format, body, table,
  ownKeys)`, as D2 and D3 say. A table that chains, holds one old key twice or holds a value that
  is not an address is refused whole (`AddressTableRefused`). Proven by unit tests: hand-written
  fixtures in Google's, Graph's and Apple's shapes, and seeded property tests over 400 random
  cards and 400 random events (an empty table is byte-identical; `f(f(x)) = f(x)`; free text,
  display names and UIDs unchanged; folded lines read as unfolded). A guard keeps the module off
  the mail path (`an-address-change-that-reached-mail.unit.test.ts`).

**2026-11-22: T2 built, on `claude/ownpace-0168-table`; nothing applies a row yet.** The table,
its routes in both editions and every migration file of this plan:

- ledger 0071 `address_change`, under forced row security;
- ledger 0072 `item.address_digest`, which nothing writes until T4;
- managed 0063 `address_change_person` and Support's counts (D7).

Both tables are in `PURGED_TABLES`. The engine reads the confirmed rows through
`Ledger.listConfirmedAddressChanges`. The appliance's file door is `address-changes.json`, and
without it the page door writes rows `confirmed` by `operator`. Proven in the unit tier, on the real
migrations in PGlite: another organisation never sees, changes or deletes a row; the four refusals,
in English and Dutch; the purge's grants; the file read and refused when malformed. The migration
lint (Atlas) and the lock report (squawk) run in CI only. ADR-0034's explicit deployment mode does
not exist in the appliance yet, so the file's presence decides the door. The step on `GET /` is
T7's screen; T2 gives it its routes.

**2026-11-22: ADR-0055 accepted.** The owner: *"I accept"*. T0 is done; T1 can start.

**2026-11-22: all ten decisions answered.** D7, reworded, answered: *"ok, now I understand. I
agree."* That is (a): Support shows counts only. Every decision in §9 is now the recommended
option. ADR-0055 stays proposed until the owner accepts it; it is the only thing left in T0.

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
proposed [ADR-0055](../adr/0055-a-new-address-is-a-declared-change.md), accepted by the owner on 2026-11-22,
because the design amends what ADR-0005, ADR-0032 §6 and ADR-0043 say about a faithful copy. Every
fact about today's behaviour below was read in the code on 2026-11-22 at `4aa500c`, and the file
and function are named beside it.

What is proven: nothing runs. The docs checks pass (the PR that opens this plan quotes them).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The owner's decisions and ADR-0055 | owner | ✅ **Done 2026-11-22** | §9: D1–D10 answered as recommended on 2026-11-22 (D7 after rewording). ADR-0055 accepted the same day. |
| T1 Address forms and the list of addresses nobody can take along | builder | ✅ **Done 2026-11-23** (#2067) | §6.1. `packages/shared/src/address-forms.ts`; `googleAccountKey` moved there, no behaviour change. The list held Google's two domains at the landing; Microsoft's, Apple's, Yahoo's and four Dutch and Belgian internet providers' followed on 2026-11-23 (Status). |
| T2 The table of address changes | builder | ✅ **Done 2026-11-23** (#2067) | §4, §5. `address_change` (ledger 0071), `item.address_digest` (0072), `address_change_person` (managed 0063), routes in both editions, `PURGED_TABLES`, Support's counts. Status 2026-11-22. |
| T3 The change itself, as a pure function | builder | ✅ **Done 2026-11-23** (#2067) | §2. `applyAddressChanges` for vCard and iCalendar; identity on an empty table; property tests; mail-path guard. |
| T4 The writers apply it, and a changed table converges | builder | ✅ **Done 2026-11-23** (#2067) | §3. CardDAV, JMAP contacts and CalDAV writers; `item.address_digest`; `classifyKnownItem`. |
| T5 Verification and the confirmed list say what was changed | builder | ✅ **Done 2026-11-23** (#2067) | §3.1. A declared change, never a silent difference. |
| T6 The Sharing checklist reads the table | builder | ✅ **Done 2026-11-23** (#2067) | §2.4. Pre-fills the grantee; each press still sends its address. |
| T7 The screens | builder | ✅ **Done 2026-11-23** (#2067); the Dutch waits for the owner's check | §6. *Start a migration*'s step, the person's page, the organisation's table, the migration page, the confirmed list, the Sharing checklist, the grant and progress pages. Unit tests and the UI smoke at phone width; every shape served by its route since the landing, the link door's included (Status 2026-11-23). |
| T8 The E2E lane proves it | builder | ✅ **Done 2026-11-23** (#2067) | §8. The managed gate and the appliance's e2e: bytes changed where declared, mail byte-identical, no mail sent. |
| T9 Words outside the app | owner | 🔄 **Landed 2026-11-23** (#2067); the policy stays 1.0 (D8, *"1.0 ok"*); the Dutch waits for the owner's check | §5, §7. The privacy policy (D8), the customer guides, Finish step 4. Drafted 2026-11-22; landed 2026-11-23 under 1.0 on the owner's word. |

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
