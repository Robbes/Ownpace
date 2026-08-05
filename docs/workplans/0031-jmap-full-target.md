# Workplan 0031 — JMAP as a full target (calendars, contacts, files)

## Status — 2026-08-05 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 The spike: do our natural keys survive the transport switch? | ✅ **ANSWERED on Spark 2026-08-05. The key question is answer 1 — but the run surfaced a DIFFERENT blocker that changes T1** | **All three capabilities are advertised**, so the plan is NOT blocked on the server: `urn:ietf:params:jmap:calendars`, `:contacts` and `:filenode`, alongside `:mail`, `:blob`, `:principals`, `:quota`, `:sieve`, `:submission`, `:websocket` and Stalwart's own `urn:stalwart:jmap`. That closes the branch this task existed to test cheaply, in one request. **Two corrections came out of running it.** (1) The spike asked for `urn:ietf:params:jmap:blob` for files and warned that blob gives no collection model — true of blob and beside the point: Stalwart advertises **`filenode`**, which IS the file-node concept, so the check was aimed at the wrong URN and would have reported a doubt the server had already answered. Corrected, with blob's insufficiency kept as the reason filenode is the one that matters. (2) The session advertises **`apiUrl: https://0.0.0.0/jmap/`** — unroutable. That is not a new discovery: `jmap-target.ts` already ignores the session's apiUrl and rebuilds the endpoint from `baseUrl`, with a comment saying the host is unreliable on Stalwart. The run is that comment proven, and T1-T3 inherit the convention rather than rediscovering it. **STEP 2, the part that mattered.** The natural-key question is **answer 1: the keys agree, no transformation needed.** `uid` round-trips unchanged, and an override's map key came back **byte-identical** to what was written (`2026-09-08T09:00:00`) — which is exactly the value CalDAV puts in RECURRENCE-ID, so `naturalKeyForCalendar()` produces the same hash on both transports and a switched mapping re-copies nothing. **But the ladder found what a single attempt would have missed: Stalwart accepts `recurrenceOverrides` and REFUSES `recurrenceRules`.** Three different rule shapes — with `@type`, without it, and `until` instead of `count` — all came back `invalidProperties: ["recurrenceRules"]`, identically. Three refusals of three syntaxes is not a syntax problem: **this Stalwart version (v0.16.10) does not implement recurrence rules over JMAP at all**, while its CalDAV path does. That is a bigger finding than the one T0 was chartered to get, and it is the kind this repo exists to catch: a JMAP calendar target built today would write a recurring series as **a single event plus orphaned overrides**, losing the RRULE — silently, because every write would succeed. |
| T1 Calendars as a JMAP target | ⏸️ **PARKED 2026-08-05 by owner decision — option (a): wait for JMAP to mature on Stalwart** | The natural key is no longer the obstacle: T0 proved it agrees. The obstacle is that `recurrenceRules` is refused by Stalwart v0.16.10 over JMAP, so a JMAP calendar target cannot carry a recurring series at all. Three options, and none of them is *build it as scoped*: **(a)** wait for Stalwart to implement it and keep DAV for calendars meanwhile; **(b)** build T1 but REFUSE recurring events on the JMAP path, migrating them over DAV — honest, and a per-item split nothing else in this product does; **(c)** drop T1 and take T2/T3 first, where no equivalent gap is known yet. **Owner chose (a) on 2026-08-05: wait.** Calendars keep going over CalDAV, which works today and is in the nightly e2e, so nothing regresses and no half-measure is taken on. **The trigger is `scripts/jmap-target-spike.ts` re-run on each Stalwart bump** — it takes seconds and rung 2 is the whole test: the day `recurrenceRules` is accepted, T1 unblocks. Option (b) was rejected as strictly worse than DAV-only: splitting one domain across two transports mid-migration would take the complexity of both protocols and the simplicity of neither, which is the opposite of the reason JMAP was chosen. **Research 2026-08-05 — the refusal is probably NOT our request being odd, and the reason matters.** Stalwart's documentation says it **pre-expands** a recurrence pattern into individual stored instances rather than keeping the rule and computing occurrences on read (there is a `maxRecurrenceExpansions` limit on the Calendar singleton for exactly that cost). The JMAP calendars draft in turn says `recurrenceRules` and `recurrenceOverrides` MUST be returned as null **for a server-expanded single instance** — so a store built around expansion has a real reason to refuse a rule on write while still accepting overrides, which is precisely the asymmetry the ladder observed. Corroborating: Stalwart's own JMAP conformance suite covers **mail only** — its maintainers say so in discussion #2772, where extending it to Calendars/Contacts/Files was raised and deferred. So the calendar surface is genuinely younger and less exercised than the mail one this product already relies on, and CalDAV remains its better-trodden path for this domain. |
| T2 Contacts as a JMAP target | 🟢 **CLEAR — spiked on Spark 2026-08-05, the key survives** | Unblocked from T1 deliberately: with calendars blocked on the server, the useful question stopped being *can T1 be built* and became **is the calendar gap an exception or a pattern**. Probes whether a vCard UID survives a `ContactCard/set` round trip — that UID is what `naturalKeyForContact()` hashes. **It does, unchanged:** `"uid":"openmig-spike-contact-2aed1fbf"` came back byte-for-byte, alongside `addressBookIds`. So contacts have no equivalent of the calendar problem, and **that answers the question the owner extended this spike to ask: the recurrence gap is an EXCEPTION, not a pattern.** One correction on the way — the first attempt omitted `addressBookIds` and Stalwart refused with *"Contact has to belong to at least one address book"*, the exact analogue of `calendarIds`; the id is now looked up with `AddressBook/get` rather than guessed. **T2 is the sensible place to start building.** |
| T3 Files as a JMAP target | 🟡 **Still unanswered — two spike defects, both ours, neither a capability gap** | Same reasoning. Deliberately READ-ONLY: the identity question is what a `FileNode` calls itself — a path, or a name plus a parentId — and listing answers that without creating anything in a hierarchy whose shape is still unknown. `fileNaturalKeyHash()` hashes a normalised PATH, so a parent-chain model needs a documented reconstruction before T3 can key anything. **Two runs, two of our own mistakes.** The read-only probe returned an empty list — a probe that cannot fail informatively against an empty store, which is the third time this week that shape has cost a run. Creating a node then failed with `invalidProperties: ["@type"]`, because the spike sent `'@type': 'FileNode'`. Both corrected. **Nothing here yet suggests a server gap**, and the record matters: on this surface the spike has been wrong twice and Stalwart zero times, so the next refusal deserves the same suspicion of ourselves first. |
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

### T2 — contacts, T3 — files

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
