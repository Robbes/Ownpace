# Workplan 0031 — JMAP as a full target (calendars, contacts, files)

## Status — 2026-08-05 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 The spike: do our natural keys survive the transport switch? | ✅ **ANSWERED on Spark 2026-08-05. The key question is answer 1 — but the run surfaced a DIFFERENT blocker that changes T1** | **All three capabilities are advertised**, so the plan is NOT blocked on the server: `urn:ietf:params:jmap:calendars`, `:contacts` and `:filenode`, alongside `:mail`, `:blob`, `:principals`, `:quota`, `:sieve`, `:submission`, `:websocket` and Stalwart's own `urn:stalwart:jmap`. That closes the branch this task existed to test cheaply, in one request. **Two corrections came out of running it.** (1) The spike asked for `urn:ietf:params:jmap:blob` for files and warned that blob gives no collection model — true of blob and beside the point: Stalwart advertises **`filenode`**, which IS the file-node concept, so the check was aimed at the wrong URN and would have reported a doubt the server had already answered. Corrected, with blob's insufficiency kept as the reason filenode is the one that matters. (2) The session advertises **`apiUrl: https://0.0.0.0/jmap/`** — unroutable. That is not a new discovery: `jmap-target.ts` already ignores the session's apiUrl and rebuilds the endpoint from `baseUrl`, with a comment saying the host is unreliable on Stalwart. The run is that comment proven, and T1-T3 inherit the convention rather than rediscovering it. **STEP 2, the part that mattered.** The natural-key question is **answer 1: the keys agree, no transformation needed.** `uid` round-trips unchanged, and an override's map key came back **byte-identical** to what was written (`2026-09-08T09:00:00`) — which is exactly the value CalDAV puts in RECURRENCE-ID, so `naturalKeyForCalendar()` produces the same hash on both transports and a switched mapping re-copies nothing. **But the ladder found what a single attempt would have missed: Stalwart accepts `recurrenceOverrides` and REFUSES `recurrenceRules`.** Three different rule shapes — with `@type`, without it, and `until` instead of `count` — all came back `invalidProperties: ["recurrenceRules"]`, identically. Three refusals of three syntaxes is not a syntax problem: **this Stalwart version (v0.16.10) does not implement recurrence rules over JMAP at all**, while its CalDAV path does. That is a bigger finding than the one T0 was chartered to get, and it is the kind this repo exists to catch: a JMAP calendar target built today would write a recurring series as **a single event plus orphaned overrides**, losing the RRULE — silently, because every write would succeed. |
| T1 Calendars as a JMAP target | ⏸️ **PARKED 2026-08-05 by owner decision — option (a): wait for JMAP to mature on Stalwart** | The natural key is no longer the obstacle: T0 proved it agrees. The obstacle is that `recurrenceRules` is refused by Stalwart v0.16.10 over JMAP, so a JMAP calendar target cannot carry a recurring series at all. Three options, and none of them is *build it as scoped*: **(a)** wait for Stalwart to implement it and keep DAV for calendars meanwhile; **(b)** build T1 but REFUSE recurring events on the JMAP path, migrating them over DAV — honest, and a per-item split nothing else in this product does; **(c)** drop T1 and take T2/T3 first, where no equivalent gap is known yet. **Owner chose (a) on 2026-08-05: wait.** Calendars keep going over CalDAV, which works today and is in the nightly e2e, so nothing regresses and no half-measure is taken on. **The trigger is `scripts/jmap-target-spike.ts` re-run on each Stalwart bump** — it takes seconds and rung 2 is the whole test: the day `recurrenceRules` is accepted, T1 unblocks. Option (b) was rejected as strictly worse than DAV-only: splitting one domain across two transports mid-migration would take the complexity of both protocols and the simplicity of neither, which is the opposite of the reason JMAP was chosen. **Research 2026-08-05 — the refusal is probably NOT our request being odd, and the reason matters.** Stalwart's documentation says it **pre-expands** a recurrence pattern into individual stored instances rather than keeping the rule and computing occurrences on read (there is a `maxRecurrenceExpansions` limit on the Calendar singleton for exactly that cost). The JMAP calendars draft in turn says `recurrenceRules` and `recurrenceOverrides` MUST be returned as null **for a server-expanded single instance** — so a store built around expansion has a real reason to refuse a rule on write while still accepting overrides, which is precisely the asymmetry the ladder observed. Corroborating: Stalwart's own JMAP conformance suite covers **mail only** — its maintainers say so in discussion #2772, where extending it to Calendars/Contacts/Files was raised and deferred. So the calendar surface is genuinely younger and less exercised than the mail one this product already relies on, and CalDAV remains its better-trodden path for this domain. **Trigger re-checked 2026-08-05 (the T2.0 run): STILL REFUSED.** All three rungs came back `invalidProperties: ["recurrenceRules"]` on the same Stalwart, so T1 stays parked and the trigger stays armed — recorded here because a trigger nobody records the state of is a trigger nobody knows is still pending. One thing the same run did surface for T1's eventual benefit: the session advertises **`urn:ietf:params:jmap:calendars:parse`** alongside the contacts one, so when T1 unparks it inherits T2's fidelity route (let the server convert) rather than needing its own. It does **not** unpark T1 — parse is a read-side conversion and the refusal is on `set`. |
| T2 Contacts as a JMAP target | 🟡 **Route CONFIRMED and Rung A ANSWERED (2026-08-05). One rung left: does a JMAP-written card differ from a CardDAV-written one?** | **Rung A came back clean: `vCard` IS stored — `convertedProperties` and `x-openmig-probe` both intact — it is simply not volunteered by a `ContactCard/get` that does not name it.** So the JMAP path is NOT narrower than the CardDAV target on unmapped vCard properties, and the owner-grade question that rung existed to raise does not arise. What it leaves is a requirement with teeth: **every read T2 makes must name `vCard` explicitly**, or it gets a card that looks complete and is not — a passing read that would make content comparisons differ for a reason unrelated to the card, and make a reindex write ledger rows against a thinner card than the target holds. T2.1 owes a test that pins it. **Rung B did NOT run: the spike's own bug.** The PUT went to `/dav/card/target@dev.local/<uid>.vcf` with no address-book segment and Stalwart refused it with 409; the book-finder compared a server-decoded href against a still-percent-encoded `URL.pathname`, so the home set passed the "not the home set" filter and was chosen as the book. Fixed — both sides decoded, candidates must be strictly below the home set, and the chosen collection is now printed. **Third time on this surface the spike was wrong and Stalwart was not** (after `@type` on `FileNode` and the missing `addressBookIds`), and a rung that manufactures a DAV finding out of its own 409 is worse than no rung. Below, the route finding it all rests on. **The route is settled: `ContactCard/parse` accepted the uploaded vCard blob and returned a full JSContact Card, so the conversion is Stalwart's own and T2 needs no hand-written RFC 9555 converter.** The UID survived the SERVER's parser unchanged (`openmig-spike-vcard-6702dfea`), which is the key question asked a second and harder way than step 3 asked it. Fidelity in the PARSE OUTPUT is better than our normaliser could ever be: `ROLE` → `titles.k2 {kind:"role", organizationId:"k1"}`, `IMPP` → `onlineServices`, `GEO` → `addresses.k1.coordinates`, the folded `NOTE` correctly unfolded, and `X-OPENMIG-PROBE` preserved inside a `vCard.properties` escape hatch alongside a `convertedProperties` provenance map. **Then the store read-back APPEARED to lose two of them, silently, with every write returning success** — which is why 2026-08-05 added two rungs rather than a connector. (1) The `vCard` object seemed absent from the stored card; **Rung A has since shown it is not — see above. That loss was never real, and writing T2.1 on the first reading would have shipped a documented data-loss caveat that did not exist.** (2) The single `ADR` came back as TWO addresses: `k1` holding nothing but `coordinates`, and a new `k1-2` holding the actual street address. **Still open, and Rung B is what settles it.** Hold a fourth reading while it runs: vCard 4.0 has no coordinate parameter on `ADR` — `GEO` is a standalone property, and RFC 9555 maps a standalone `GEO` to an `Address` carrying only `coordinates`. So the PARSER merging them may be the liberty and the STORE splitting them back apart may be Stalwart's canonical form, being exactly what it needs to emit a standalone `GEO:` line on the way back out to vCard. **One more thing this run settled and it is a narrowing: the stored contact card carries NO `blobId` and no other handle back to vCard bytes.** `carddav-target-writer.ts` implements §20's content leg by GETting the card and hashing the vCard with the same `contactContentHash` the ledger row was written from; a JMAP contacts target has nothing to GET, so **contacts verified over JMAP get counts and presence but no checksum leg.** That is not a defect to fix, it is a promise T2.1 must state rather than let a cutover gate imply. **T2.1 still waits.** Historic note on how T2 got here: **the key question was the wrong one to stop at, and finding that out cost a reading of `carddav-target-writer.ts` rather than a connector.** Every contacts source hands the loop a `RawContact` carrying the ORIGINAL vCard TEXT, and the CardDAV writer PUTs those bytes verbatim — nothing is lost because nothing is interpreted. JMAP has no vCard; `ContactCard` is JSContact (RFC 9553). So a JMAP target must convert, and the only structured thing we hold besides the vCard text is `Contact` — our own normalised model, lossy by design (no IMPP, no ROLE, no GEO, no X- properties, one photo). Converting from THAT drops whatever the normaliser never modelled, on every card, forever, with a green result and a correct count. **Stalwart documents `ContactCard/parse` (bounded by `parseLimitContact`, default 10), which would make the conversion the SERVER's own — the same mapping its CardDAV store uses — and that is the difference between a connector and a standards project.** Documentation is not the answer here though; the recurrence ladder is why. **T2.0 is built: spike step 3b** uploads a realistic vCard (CRLF, a folded NOTE, IMPP/ROLE/GEO/X- properties), runs `ContactCard/parse`, writes the server's OWN parsed card back with `ContactCard/set`, reads it from the store and destroys it. One run decides three things: which route T2 takes, whether the UID survives the server's parser (step 3 only proved it through a card we hand-built), and whether the stored card carries a `blobId` — which decides whether §20's content leg is implementable on this transport at all, since `contentHashFor` on CardDAV works by GETting the vCard and there would be none. **T2.1 is not written until this answers.** **The earlier finding stands underneath all of this and is not withdrawn:** unblocked from T1 deliberately — with calendars blocked on the server, the useful question stopped being *can T1 be built* and became **is the calendar gap an exception or a pattern**. Probes whether a vCard UID survives a `ContactCard/set` round trip — that UID is what `naturalKeyForContact()` hashes. **It does, unchanged:** `"uid":"openmig-spike-contact-2aed1fbf"` came back byte-for-byte, alongside `addressBookIds`. So contacts have no equivalent of the calendar problem, and **that answers the question the owner extended this spike to ask: the recurrence gap is an EXCEPTION, not a pattern.** One correction on the way — the first attempt omitted `addressBookIds` and Stalwart refused with *"Contact has to belong to at least one address book"*, the exact analogue of `calendarIds`; the id is now looked up with `AddressBook/get` rather than guessed. **T2 is the sensible place to start building.** |
| T3 Files as a JMAP target | 🟠 **ANSWERED 2026-08-05: buildable, but it needs a PATH RECONSTRUCTION that does not exist yet** | Same reasoning. Deliberately READ-ONLY: the identity question is what a `FileNode` calls itself — a path, or a name plus a parentId — and listing answers that without creating anything in a hierarchy whose shape is still unknown. `fileNaturalKeyHash()` hashes a normalised PATH, so a parent-chain model needs a documented reconstruction before T3 can key anything. **Two runs, two of our own mistakes.** The read-only probe returned an empty list — a probe that cannot fail informatively against an empty store, which is the third time this week that shape has cost a run. Creating a node then failed with `invalidProperties: ["@type"]`, because the spike sent `'@type': 'FileNode'`. Both corrected. **Nothing here yet suggests a server gap**, and the record matters: on this surface the spike has been wrong twice and Stalwart zero times, so the next refusal deserves the same suspicion of ourselves first. **The third run answered it, and the news is mixed.** Creation works cleanly, and a `FileNode` reads back as: `{id, parentId, nodeType, blobId, target, size, name, type, created, modified, accessed, changed, executable, isSubscribed, myRights, shareWith, role}`. **There is no path field.** Identity is `name` + `parentId` — a parent-chain model, which is the case flagged as needing a documented reconstruction before anything can be keyed. `fileNaturalKeyHash()` hashes a NORMALISED PATH, so T3 must walk the parent chain to the root and join names, and **that reconstruction has to produce byte-identical output to what the WebDAV path produces** or every file re-copies on the first pass — silently, because each write succeeds. Path normalisation has already caused four silent-mismatch bugs in this repo; this would be the fifth and the most expensive, since it would hit every file at once rather than an edge case. **Two consequences worth deciding before T3 starts.** (1) The reconstruction costs a lookup per ancestor, or a whole-tree fetch per pass, where WebDAV hands the path over for free. (2) Renaming a folder changes every descendant's key — that is equally true of the WebDAV path today, so it is not a regression, but a parent-chain model makes it easy to introduce a normalisation difference while working around it. **T3 is therefore not blocked; it is larger than the row implied, and the first thing it needs is the reconstruction plus a test asserting both transports hash identically — not a connector.** |
| T4 Surface + manifest truth | ⬜ Blocked on T1 | |

## Why this exists

**Owner decision 2026-08-05 (0026 T3 row 18): BUILD it.** ADR-0018 said "mail
leads" and workplan 0007 deferred the rest *until DAV is proven*. DAV is proven
— it runs in the nightly e2e on both persistence backends — so the deferral
expired, and the standing recommendation in this repo was to retract the
promise and declare JMAP deliberately mail-only.

The owner overruled that, and the reason is worth recording because it changes
what "done" means here: **JMAP is judged more future-proof, and is therefore
the preferred protocol.** This is not a capability gap being filled. Stalwart
already serves calendars, contacts and files over DAV and those paths work.
What this plan buys is *one protocol per target* — one credential, one failure
mode, one set of semantics per migration — and a bet that JMAP is the surface
worth investing in as it grows.

Two consequences follow, and both are constraints rather than preferences:

- **DAV is not being replaced.** Every DAV target stays: Nextcloud, openDesk
  and Soverin do not speak JMAP for these domains, and a Stalwart customer
  already mid-migration on DAV must not be moved. JMAP becomes an *additional*
  target for the one server that speaks it.
- **A mapping must be switchable between them without duplicating anything.**
  That is the whole risk, and it is what T0 exists to settle.

## Why T0 comes first, and why nothing else starts until it answers

The engine's idempotency rests on one property: **the natural key for an item
is the same whatever transport carried it.** It is why switching a mail mapping
between IMAP and Graph cannot duplicate a mailbox, and it was hard-won —
`hash.ts` computes those keys in one place precisely so two transports cannot
drift apart.

Three of them are load-bearing here, and one has a fresh scar:

- **Calendars.** A recurring series and its modified occurrences share a UID
  under RFC 5545; `naturalKeyForCalendar` distinguishes them with
  `RECURRENCE-ID`. That fix landed on 2026-08-04 after the key collided and
  silently lost modified occurrences. **If JMAP's calendar object model does
  not expose a recurrence identifier in a form that hashes identically, a
  mapping switched from DAV to JMAP re-copies every modified occurrence** — and
  the failure is silent, because a duplicate is a successful write.
- **Contacts.** The DAV path keys on the vCard UID. JMAP ContactCards may
  or may not preserve it across a write.
- **Files.** The DAV path keys on a normalised path
  (`trashbinPathToKeyPath` + `fileNaturalKeyHash`), and normalisation has
  already caused four silent-mismatch bugs in this repo. A JMAP file surface
  with a different identity model is a fifth waiting to happen.

So T0 is not a warm-up. It is a **go / no-go with three possible answers**, and
the plan branches on which one comes back:

1. **The keys survive.** Build T1–T4 as scoped.
2. **The keys survive only with a documented transformation** (e.g. JMAP
   exposes the recurrence id under another name). Then the transformation, not
   the connector, is the first thing built and tested — in `hash.ts`, with both
   transports asserted equal.
3. **The keys cannot be made to agree.** Then a mapping is NOT switchable, and
   the honest shape is a one-way door: a mapping is JMAP or DAV at creation and
   changing it requires a reindex. That is a different product decision and
   comes back to the owner rather than being absorbed quietly.

**Answer 3 is a real possibility, and the plan is written so that discovering
it costs a day rather than three connectors.**

## Tasks

### T0 — the spike (a day, and it may end the plan)

Against the real Stalwart in the dev stack, not a specification: create a
calendar event with a modified occurrence, a contact, and a file over **DAV**;
read the same three back over **JMAP**; compute the natural key from each side
with the EXISTING `hash.ts` functions and compare.

Done when: a written answer to the three-way question above, with the actual
identifiers observed pasted in, and — whichever answer — a test that pins it.
Not done when: "the JMAP spec says it should work."

### T1 — calendars as a JMAP target

First because it is the smallest surface AND carries the sharpest key risk, so
the thing most likely to invalidate the plan is met earliest. Implements the
calendar target port against JMAP, including removal (`apply` needs it),
verification counts and discovery counts. Wired into the nightly e2e on both
backends, beside the DAV calendar target rather than instead of it.

### T2 — contacts as a JMAP target (STARTED 2026-08-05, owner picked it)

T0 proved the natural key survives. That is necessary and it is not enough,
and the gap between the two is where T2's real work is.

**The problem in one sentence:** every contacts source in this product hands
the sync loop a `RawContact` carrying the **original vCard text**, and
`carddav-target-writer.ts` PUTs those bytes verbatim — nothing is lost because
nothing is interpreted. JMAP has no vCard. `ContactCard` is JSContact
(RFC 9553), a different object model, so a JMAP contacts target has to get from
one to the other. There are exactly two ways and they are not close in value.

**Route (1) — we convert.** The only structured thing we hold besides the
vCard text is `Contact`, our own normalised model, and it is lossy by design:
no IMPP, no ROLE, no GEO, no X- properties, one photo. Building the JSContact
from that silently drops whatever the normaliser never modelled, on every card,
forever — hard rule 9's failure mode with a green result and a correct count.

**Route (2) — the server converts**, via `ContactCard/parse` on an uploaded
vCard blob. Then the mapping is Stalwart's own, the same one its CardDAV store
uses, so a card written over JMAP holds what a card written over CardDAV holds.
That is the answer that makes T2 a connector instead of a standards project.

Stalwart's documentation says `ContactCard/parse` exists and bounds it with
`parseLimitContact` (default 10 vCards per request), which is why route (2) is
worth a request rather than an assumption. **The rule here is unchanged: the
spike answers against the running server, not against documentation** — the
recurrence ladder is why that rule exists.

**T2.0 (the gate, built 2026-08-05):** `scripts/jmap-target-spike.ts` step 3b
uploads a realistic vCard — CRLF, a folded NOTE, and IMPP/ROLE/GEO/X- properties
our model does not carry — runs `ContactCard/parse`, writes the **server's own
parsed card** back with `ContactCard/set`, reads it from the store and destroys
it. Three things come out of one run:

| What the output shows | What it decides |
|---|---|
| Whether `parse` accepts a blobId and returns a Card | route (2) or route (1) |
| Whether the UID survives the SERVER's parser | the key, again — step 3 only proved it through a card we hand-built |
| Whether the stored card carries a `blobId` | whether §20's content leg is implementable at all on this transport |

That third row is the one easy to miss. `carddav-target-writer.ts` implements
`contentHashFor` by GETting the card and hashing the vCard with the same
`contactContentHash` the ledger row was written with. A JMAP target has no
vCard to GET, so with no blob handle contacts verified over JMAP fall back to
counts alone — a real narrowing of what a cutover gate can promise, and one
that must be *stated* rather than discovered.

**T2.0 ran on Spark, 2026-08-05. Route (2) is confirmed.** `ContactCard/parse`
accepted the blob and returned a full Card, the UID survived the server's own
parser, and the parse output carried every property our normalised `Contact`
would have dropped:

| vCard input | JSContact in the PARSE output | In our `Contact` model? |
|---|---|---|
| `ROLE:Probe` | `titles.k2 {kind:"role", organizationId:"k1"}` | no |
| `IMPP:xmpp:…` | `onlineServices.k1.uri` | no |
| `GEO:geo:52.3676,4.9041` | `addresses.k1.coordinates` | no |
| folded `NOTE` | `notes.k1.note`, correctly unfolded | yes |
| `X-OPENMIG-PROBE` | `vCard.properties[…]` (the RFC 9555 escape hatch) | no |

So route (1) is not merely worse in theory — this table is the list of things
it would have thrown away on every card, and the run is what makes that
concrete rather than argued.

**And then the store read-back lost two of them.** Comparing the parse output
against `ContactCard/get` after `ContactCard/set`:

- the whole `vCard` object appeared to be gone — escape hatch,
  `X-OPENMIG-PROBE` and the `convertedProperties` provenance map together;
- the single `ADR` became **two** addresses: `k1` holding nothing but
  `coordinates`, and a new `k1-2` holding the actual street address.

Every write returned success. Same shape as the calendar finding and as the
four vacuous passes fixed this week, which is why both got rungs instead of a
workaround — and the first of the two is why that was the right call rather
than a slow one: **the `vCard` loss was not real.** Rung A found the property
present once asked for by name (below). Had T2.1 been written on the first
reading, it would have carried a documented data-loss caveat that never
existed, which is its own kind of untrue.

### T2.0a — the two rungs that diagnose it

**Rung A: was `vCard` dropped, or merely not returned?** Re-reads the stored
card asking for `vCard` **by name**, because a property explicitly requested
and still absent was not stored.

**✅ ANSWERED on Spark 2026-08-05 — it is PRESENT. Nothing was lost.** The
stored card returned `vCard` in full: `convertedProperties` (`impp` →
`onlineServices/k1/uri`, `geo` → `addresses/k1/coordinates`) and
`x-openmig-probe` both intact. The store keeps the RFC 9555 escape hatch;
`ContactCard/get` simply does not volunteer it. **So JMAP contacts are NOT
narrower than the CardDAV target on unmapped properties, and the owner-grade
question this rung existed to raise does not arise.**

It leaves a requirement rather than a defect, and the requirement has teeth:
**every read T2 makes must name `vCard` explicitly.** A read that omits it gets
a card that looks complete and is not — which would make a content comparison
differ for a reason having nothing to do with the card, and would make a
reindex write ledger rows against a thinner card than the target holds. T2.1
owes a test that pins this, because the failure mode is a passing read.

**Rung B: is the address split ours or the parser's?** PUTs the identical
vCard over Stalwart's own CardDAV and reads the result back over JMAP. Same
server, same store, same card — the only variable is which door it came in.
This is the DAV↔JMAP comparison T0 was chartered to do, aimed at the content
rather than the key.

**🔁 DID NOT RUN on 2026-08-05 — the spike's own bug, fixed.** The PUT went to
`/dav/card/target@dev.local/<uid>.vcf`, with no address-book segment, and
Stalwart correctly refused it with 409. The book-finder compared a
server-decoded href (`/dav/card/target@dev.local/`) against `URL.pathname`,
which stays percent-encoded (`target%40dev.local`) — so the home set never
matched the "not the home set" filter and was chosen as the address book. Both
sides are now decoded before comparing, a candidate must be strictly *below*
the home set, and the chosen collection is printed rather than left to be
inferred from the failing URL.

Worth naming plainly: **that is the third time on this surface the spike was
wrong and Stalwart was not** — after `@type` on `FileNode` and the missing
`addressBookIds`. A rung that manufactures a DAV finding out of its own 409 is
worse than no rung, which is why this one now says which collection it picked.

| Rung B outcome | What it means |
|---|---|
| Splits on both paths | the parser's doing; a DAV customer already has these cards and switching transport changes nothing |
| Splits only on the JMAP path | a card written over JMAP differs from the same vCard written over CardDAV, and **0031's premise that a mapping is switchable between them is narrower than it was written to be** |
| `davUid` absent from the JMAP list | the two surfaces are not one store — a bigger finding than either defect |

There is a fourth reading worth holding while the rung runs, because it would
make the split correct rather than a defect: **vCard 4.0 has no coordinate
parameter on `ADR` — `GEO` is a standalone property**, and RFC 9555 maps a
standalone `GEO` to an `Address` carrying only `coordinates`. So the parser
merging `GEO` into the `ADR` entry may be the liberty, and the store splitting
it back out may be Stalwart's canonical form — exactly what it would need in
order to emit a standalone `GEO:` line on the way back to vCard. Rung B decides
it either way; this is a reason not to write the split up as data loss before
it has.

### The narrowing T2.1 has to state out loud

The stored contact card carries **no `blobId`** and no other handle back to
vCard bytes — the run shows the full property list and there is nothing there.
That decides §20's content-verification leg for this domain.

`carddav-target-writer.ts` implements `contentHashFor` by GETting the card and
fingerprinting the vCard with the same `contactContentHash` the ledger row was
written from. (Canonically, not byte-wise — that was #143's reversal, and the
comment in `jmap-target.ts` still claiming the DAV writers "deliberately do not
implement this" is corrected in this change.) **A JMAP contacts target has
nothing to GET, so contacts verified over JMAP get counts and presence but no
checksum leg.**

There is exactly one way around it and it costs the thing the plan was for:
Stalwart serves the same store over CardDAV, so a JMAP-written card *is*
readable as vCard at `/dav/card/…`. Verifying that way means the "JMAP" target
needs DAV credentials and a DAV code path, which is the opposite of the one
credential / one failure mode / one set of semantics this plan exists to buy.

So this is not a defect to fix. It is a promise T2.1 must state, rather than
let a cutover gate imply a check it never ran.

**T2.1 is still not written.** Route being settled unblocks the connector's
*shape*; the rungs decide what it is allowed to promise. Rung A has already
converted one of those from a caveat into a requirement (name `vCard` on every
read), and one of the three Rung B outcomes goes back to the owner rather than
into code.

### T3 — files

Same shape. T3 is the largest: the file domain carries path normalisation, the
delta/removal channel, and the trashbin signal, none of which transfer for
free.

### T4 — surface + manifest truth

The target picker offers JMAP for these domains only where the server speaks
it; the scope manifest says which protocol carries which domain; ADR-0018's
"mail leads" line gets its dated update recording that the rest followed.

## Hard rules that bite here

- **Rule 1 (idempotency)** is the entire risk. A natural key that differs by
  transport is not an error — it is a duplicate, and a duplicate is a
  successful write nobody notices until a mailbox is twice its size.
- **Rule 9:** if the spike cannot establish a key equivalence, it says so.
  "Probably fine" is the answer that costs three connectors.
- **Rule 5:** the appliance ships this too; nothing here may become
  managed-only.
- **Rule 9 again, on FIDELITY rather than keys** (added 2026-08-05 by T2). The
  plan was written as though the key were the only thing that had to survive
  the transport switch. It is not. A DAV target writes the source's own bytes;
  every JMAP target in this plan writes an OBJECT, and an object built from our
  normalised model carries only what that model happens to have. A card, event
  or file that arrives with fewer properties than it left is a successful write
  and a correct count, which is the exact shape this repo keeps finding. So
  each of T1-T3 owes a *stated* fidelity route, not only a key proof.
