# Workplan 0031 — JMAP as a full target (calendars, contacts, files)

## Status — 2026-08-06 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 The spike: do our natural keys survive the transport switch? | ✅ **ANSWERED on Spark 2026-08-05. The key question is answer 1 — but the run surfaced a DIFFERENT blocker that changes T1** | **All three capabilities are advertised**, so the plan is NOT blocked on the server: `urn:ietf:params:jmap:calendars`, `:contacts` and `:filenode`, alongside `:mail`, `:blob`, `:principals`, `:quota`, `:sieve`, `:submission`, `:websocket` and Stalwart's own `urn:stalwart:jmap`. That closes the branch this task existed to test cheaply, in one request. **Two corrections came out of running it.** (1) The spike asked for `urn:ietf:params:jmap:blob` for files and warned that blob gives no collection model — true of blob and beside the point: Stalwart advertises **`filenode`**, which IS the file-node concept, so the check was aimed at the wrong URN and would have reported a doubt the server had already answered. Corrected, with blob's insufficiency kept as the reason filenode is the one that matters. (2) The session advertises **`apiUrl: https://0.0.0.0/jmap/`** — unroutable. That is not a new discovery: `jmap-target.ts` already ignores the session's apiUrl and rebuilds the endpoint from `baseUrl`, with a comment saying the host is unreliable on Stalwart. The run is that comment proven, and T1-T3 inherit the convention rather than rediscovering it. **STEP 2, the part that mattered.** The natural-key question is **answer 1: the keys agree, no transformation needed.** `uid` round-trips unchanged, and an override's map key came back **byte-identical** to what was written (`2026-09-08T09:00:00`) — which is exactly the value CalDAV puts in RECURRENCE-ID, so `naturalKeyForCalendar()` produces the same hash on both transports and a switched mapping re-copies nothing. **But the ladder found what a single attempt would have missed: Stalwart accepts `recurrenceOverrides` and REFUSES `recurrenceRules`.** Three different rule shapes — with `@type`, without it, and `until` instead of `count` — all came back `invalidProperties: ["recurrenceRules"]`, identically. Three refusals of three syntaxes is not a syntax problem: **this Stalwart version (v0.16.10) does not implement recurrence rules over JMAP at all**, while its CalDAV path does. That is a bigger finding than the one T0 was chartered to get, and it is the kind this repo exists to catch: a JMAP calendar target built today would write a recurring series as **a single event plus orphaned overrides**, losing the RRULE — silently, because every write would succeed. |
| T1 Calendars as a JMAP target | ⏸️ **PARKED 2026-08-05 by owner decision — option (a): wait for JMAP to mature on Stalwart** | The natural key is no longer the obstacle: T0 proved it agrees. The obstacle is that `recurrenceRules` is refused by Stalwart v0.16.10 over JMAP, so a JMAP calendar target cannot carry a recurring series at all. Three options, and none of them is *build it as scoped*: **(a)** wait for Stalwart to implement it and keep DAV for calendars meanwhile; **(b)** build T1 but REFUSE recurring events on the JMAP path, migrating them over DAV — honest, and a per-item split nothing else in this product does; **(c)** drop T1 and take T2/T3 first, where no equivalent gap is known yet. **Owner chose (a) on 2026-08-05: wait.** Calendars keep going over CalDAV, which works today and is in the nightly e2e, so nothing regresses and no half-measure is taken on. **The trigger is `scripts/jmap-target-spike.ts` re-run on each Stalwart bump** — it takes seconds and rung 2 is the whole test: the day `recurrenceRules` is accepted, T1 unblocks. Option (b) was rejected as strictly worse than DAV-only: splitting one domain across two transports mid-migration would take the complexity of both protocols and the simplicity of neither, which is the opposite of the reason JMAP was chosen. **Research 2026-08-05 — the refusal is probably NOT our request being odd, and the reason matters.** Stalwart's documentation says it **pre-expands** a recurrence pattern into individual stored instances rather than keeping the rule and computing occurrences on read (there is a `maxRecurrenceExpansions` limit on the Calendar singleton for exactly that cost). The JMAP calendars draft in turn says `recurrenceRules` and `recurrenceOverrides` MUST be returned as null **for a server-expanded single instance** — so a store built around expansion has a real reason to refuse a rule on write while still accepting overrides, which is precisely the asymmetry the ladder observed. Corroborating: Stalwart's own JMAP conformance suite covers **mail only** — its maintainers say so in discussion #2772, where extending it to Calendars/Contacts/Files was raised and deferred. So the calendar surface is genuinely younger and less exercised than the mail one this product already relies on, and CalDAV remains its better-trodden path for this domain. **Trigger re-checked 2026-08-05 (the T2.0 run): STILL REFUSED.** All three rungs came back `invalidProperties: ["recurrenceRules"]` on the same Stalwart, so T1 stays parked and the trigger stays armed — recorded here because a trigger nobody records the state of is a trigger nobody knows is still pending. One thing the same run did surface for T1's eventual benefit: the session advertises **`urn:ietf:params:jmap:calendars:parse`** alongside the contacts one, so when T1 unparks it inherits T2's fidelity route (let the server convert) rather than needing its own. It does **not** unpark T1 — parse is a read-side conversion and the refusal is on `set`. |
| T2 Contacts as a JMAP target | 🟡 **T2.1 + T2.2 BUILT 2026-08-05 — connector, both editions wired, 34 unit tests + an integration test. Not yet in the nightly e2e** | `JmapContactTarget` (`packages/connectors`) implements `ContactTargetWriter` + `TargetReindexer` + `TargetRemover` on route (2): upload the vCard blob, `ContactCard/parse`, write the SERVER's own parsed card with only `addressBookIds` added. Rung C is the proof it is faithful — the card this path writes, read back out through the CardDAV door, returns every property that went in including a standalone `GEO` and an `X-OPENMIG-PROBE` with no JSContact equivalent. `apps/worker/src/contact-target-factory.ts` dispatches for BOTH editions off `connection.kind` (managed) and `target.type` (self-host); **no migration and no new config field were needed** — `'jmap'` has been a valid kind since the 0001 baseline and `TargetConfig` already included `JmapTarget`. Everything unrecognised falls back to CardDAV rather than throwing, so no existing mapping moves. Two things carried rather than fixed: **every read names `vCard`** (pinned by a mutation-verified test) and **no §20 checksum leg** — `contentHashFor` deliberately absent rather than stubbed. **Gated in CI** — the `integration-tests` job runs `pnpm test:integration`, whose global setup provisions Stalwart with Testcontainers, so the integration test needs nothing configured. **T2.3 built:** `packages/core/src/jmap-contact-sync.integration.test.ts` runs `runContactSync` against a real Stalwart — three passes (create / idempotent through a FRESH writer so the ledger rather than the connector's snapshot is what decides / one added later), plus the two assertions specific to this transport: the stored-card fingerprint reaches the ledger (or hard rule 2 stops being enforced silently) and the RFC 9555 escape hatch survives a full pass. Placed beside `dav-sync.integration.test.ts` rather than in the nightly e2e, which boots the whole appliance from one fixture and would have cost a second twenty-minute run or the CardDAV coverage. **Still open: the scope manifest does not yet say which protocol carries which domain (T4).** |
| T3 Files as a JMAP target | 🟡 **T3.1 + T3.2 BUILT 2026-08-06 — connector, both editions wired, 26 unit tests mutation-verified six ways, two integration tests. NOT run here: this container has no Docker, so CI is the first execution of the integration legs** | `JmapFileTarget` (`packages/connectors/src/jmap-file-target.ts`) implements `FileTargetWriter` + `TargetReindexer` + `TargetRemover`. **Both spike findings are structural rather than commented.** (1) Every natural key comes out of `reconstructFileNodePath` — nothing in the connector re-implements path handling, and `readTree` REFUSES the whole enumeration rather than mis-key one broken chain, because a suffix path is a well-formed string that re-copies its file on every pass forever. (2) `contentHashFor` reads `blobId` OFF THE NODE; the upload's handle is never retained, and the unit fake serves content only for the handle it issued, so a connector holding the dead one 404s in the test exactly as it would in production. **This domain needs no narrowing, unlike contacts:** a node carries `size` and `blobId`, so §20 gets counts, total bytes AND content checksums — `contentHashFor` is implemented here rather than deliberately absent. **The ownership guard is built rather than borrowed**, same as contacts: no ETag exists, so `targetVersion` is a canonical fingerprint of the node as stored over a FIXED property list, re-read before any rewrite or removal; a moved node is `conflicted`, not thrown. Directory chains are created segment by segment (`parentId: null` is the account root — a JMAP file tree has no node for it), and both conflict directions refuse: a directory where a file must go, and a file where a directory must go. `apps/worker/src/file-target-factory.ts` dispatches for BOTH editions off `connection.kind` (managed) and `target.type` (self-host), **no migration and no new config field needed**, everything unrecognised falling back to WebDAV so no existing mapping moves. **Mutation-verified six times, each mutation caught:** keying files by `node.name` instead of the reconstructed path fails 3 tests; dropping `blobId` from the property list fails 2; returning a method-level `["error",…]` as if it were a result fails 2; a failed enumeration degrading to an EMPTY tree instead of `undefined` fails 1; dropping the sort from the canonical fingerprint fails 1; and keeping the UPLOAD's blobId for the checksum sample fails 1. The fake honours `properties` for exactly that reason — a fake that ignored it would let the property-list mutation through. **Two integration tests, gated in CI, not run here:** `jmap-file-target.integration.test.ts` (the connector — key, adoption, the checksum leg through the node's own blobId, both guard directions, removal) and `packages/core/src/jmap-file-sync.integration.test.ts` (the LOOP — three passes, the source-side and target-side hashes asserted equal in one run, the fingerprint and byte count reaching the ledger). Fixture prefix `5b2b` registered. **Still to build:** the delta/removal channel and the trashbin signal, which are source-side and transfer for free from nothing. Previous state, kept because it is what T3 was built on: `packages/shared/src/jmap-file-path.ts` — `reconstructFileNodePath(nodeId, nodesById)` walks the parent chain and joins names into the shape `webdav-source.ts`'s `toRelativePath` produces: root-relative, percent-DECODED, no leading or trailing slash, **no case folding and no Unicode normalisation**. The load-bearing test asserts `fileNaturalKeyHash(reconstructed) === fileNaturalKeyHash(webdavPath)` — through the hash the ledger keys on, not string equality, since comparing strings would pass a reconstruction that agreed by accident. **It refuses rather than guesses**, and every refusal names its reason: a broken chain (a missing ancestor yields a well-formed SUFFIX that hashes to something WebDAV never produces — that file would re-copy every pass forever with every write succeeding), a cycle (a hang is worse than a failure), a `/` inside a name (ambiguous against a real separator, and WebDAV cannot express it, so no agreeing key exists), an empty name, and an absurd depth. **Mutation-verified**: percent-encoding the segments fails 2 tests, and returning a suffix on a broken chain fails 1. **A false claim on the natural key itself was corrected on the way**: `fileNaturalKeyHash`'s doc said "we normalize to handle case-insensitive filesystems" and it never has — it hashes the string verbatim. That mattered precisely here: a second producer of these paths written to match a normalisation that is not there would key every capitalised or accented path differently per transport, silently. **RUNG 2 ANSWERED on Spark 2026-08-06: files can carry content, with NO narrowing found.** `FileNode/set` accepts `blobId` on create; the node reads back `nodeType: "file"`, `size: 27` matching the bytes uploaded, `type: "text/plain"` matching the upload, `executable: false`, and `parentId` nesting it under the folder above — so **verification CAN count bytes for this domain** (unlike contacts, which have no checksum leg) and the path reconstruction has a real chain to walk rather than a flat list. **And one thing nobody asked, which matters more than the three that were asked: the blobId READ BACK IS NOT THE ONE UPLOADED.** Uploaded `eda…udrxi0gbq`, stored `cc2…gaqmai` — same long middle, different prefix and tail. Stalwart re-issues the handle once the blob is attached to a node, so any code that keeps the upload's blobId in order to fetch content later is holding a handle the store does not use. `contentHashFor` must read the blobId **off the node**, and §20's content leg is implementable here precisely because the node carries one. That is the kind of detail that would have surfaced as an intermittent 404 in a checksum sample rather than as an error at write time. **T3 is now genuinely unblocked: the reconstruction exists, content is proven to round-trip, and no promise needs narrowing.** Still to build: the connector, plus the delta/removal channel and the trashbin signal, none of which transfer for free. |
| T4 Surface + manifest truth | 🟡 **The CONTACTS slice done 2026-08-05, the FILES slice 2026-08-06; only the picker still waits, and only on T1** | **Files slice 2026-08-06:** the scope manifest's Files row now says the domain travels over WebDAV *or* JMAP, and says the thing that differs from the contacts row — there is NO narrowing here. A JMAP file node carries its own byte count and a handle to its content, so verification checks counts, total bytes and content checksums on both paths, which is why `JmapFileTarget` implements `contentHashFor` and `JmapContactTarget` deliberately does not. Version bumped to `2026-08-06`. Still open: **the target picker offering JMAP per domain only where the server speaks it** — now blocked on T1 alone, since two of the three domains can answer for themselves. Contacts slice, 2026-08-05: | T4 was scoped as one task behind T1, but T1 is parked and T2 shipped — so the part of it that had become UNTRUE was done now rather than held behind a domain that may not arrive. **Scope manifest** (§11.2, no silent omissions): Contacts now says it travels over CardDAV *or* JMAP and names the one difference that matters before cutover — on the JMAP path the target exposes no route back to the original vCard, so content-checksum sampling does not run and verification checks counts and presence instead. Version bumped. **ADR-0018** gets its dated update: "mail leads and cal/contacts/files follow" now has a first follower, and the three domains did not move together — contacts shipped, calendars are parked on a server gap, files are buildable and unstarted. **Two stale truths corrected**, both saying CalDAV/CardDAV omit `contentHashFor`: that was #143's position and it was REVERSED, so both DAV writers hash canonically now and the accurate present-day example is `JmapContactTarget`. One was a present-tense comment in `verification-implementations.ts`; the other was the NAME of the test that pins the property — and a test named after a case that no longer exists is how somebody deletes it as obsolete. **Nothing was built for the narrowing itself**: `verification.ts` already raises `CHECKSUM_UNAVAILABLE_*` as a WARNING plus a recommendation, so the JMAP contacts path degrades honestly through machinery that already existed. **Still open: the target picker offering JMAP per domain only where the server speaks it**, which needs T1 and T3 to know what it is offering. |

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

**It took two attempts, and the first failure was the spike's own.** The PUT went to
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

**✅ ANSWERED on Spark 2026-08-05, and the answer is the fourth reading — the
one that was written down as a reason not to call the split data loss before
the rung had run.**

The DAV-written card, read back over JMAP, carries **one** address with
`coordinates` merged in — structurally identical to the parse output. The
JMAP-written card carries **two**. So the split is unambiguously the JMAP write
path, which was the outcome flagged as narrowing the plan. It is not, and the
fixture is what shows why:

```
ADR;TYPE=work:;;Keizersgracht 1;Amsterdam;;1015 CJ;NL
GEO:geo:52.3676,4.9041
```

**Two separate vCard properties went in.** vCard 4.0 has no coordinate
parameter on `ADR`; `GEO` is standalone, and RFC 9555 maps a standalone `GEO`
to an `Address` carrying only `coordinates`. So `ContactCard/parse` *merging*
them is the liberty, and the store *splitting* them back apart reproduces the
source's own shape — precisely what Stalwart needs in order to emit `ADR` and
`GEO` as two properties again on the way back out to vCard.

`vCard` with `x-openmig-probe` survived on **both** paths. `davUid` was present
in the JMAP list, so the two surfaces are one store.

| Axis tested | Result |
|---|---|
| natural key (vCard UID) | unchanged on every path — idempotency holds, a transport switch cannot duplicate |
| mapped properties (`ROLE`, `IMPP`, `GEO`, `ADR`, `NOTE` folding) | all present |
| unmapped properties (`X-OPENMIG-PROBE`) | preserved in `vCard.properties` on both paths |
| structure | JSContact differs between the two write paths; both encode the same vCard |

### T2.0b — Rung C, the one claim still reasoned rather than proven

Everything above compares JSContact against JSContact. **What a customer
actually keeps is a vCard** — their next client reads the account over CardDAV.
So the question that decides whether a JMAP-written contact is faithful is not
what `ContactCard/get` says about it; it is what comes back out of the CardDAV
door.

Rung C reads the card **we wrote over JMAP** back as vCard and puts it beside
the bytes the run started from. If `ADR` and `GEO` return as two separate
properties with `X-OPENMIG-PROBE` intact, the split never existed from the
customer's point of view and T2.1 is clear. Anything missing is a real
narrowing and goes to the owner.

The parsed card is no longer destroyed inside the parse block — Rung C needs it
alive — and the tidy-up moved to a `finally`, so a failure in B or C still
leaves the account as the script found it. A spike that litters the fixture on
the unhappy path makes the *next* run's "already exists" look like a finding.

**🔁 First attempt did not run, 2026-08-05. Two bugs, both mine, and the
second one is the shape this repo keeps finding.**

It reported *"the JMAP-written card is not in this address book over CardDAV …
the two surfaces may not be one store"* — while **Rung B's own JMAP read-back
in the same run listed both cards side by side in that book** (`id:"l"` the
JMAP-written one, `id:"m"` the DAV-written one). So the card was there and the
rung could not see it.

1. **It filtered DAV hrefs to `.vcf`.** A card *we* named over CardDAV ends in
   `.vcf` because we chose the filename; a card the *server* created from a
   `ContactCard/set` gets a DAV name of Stalwart's choosing. The one card this
   rung exists to read was the one card the filter excluded. It now walks every
   resource below the collection and prints the list, so a miss is visible
   rather than inferred.

2. **A failed GET became `''`** via `r.ok ? r.text() : ''`, and an empty string
   does not contain the uid — so an unreadable resource was indistinguishable
   from "not the card we wanted", and the rung escalated that into a doubt
   about whether the two surfaces share a store. **Fifth instance of that shape
   this week, and this one was written in the same session as the comments
   warning about it.** A read that could not happen is now said.

The "not found" message no longer leaves the wrong reading open either: it
names Rung B's contradicting evidence, so the honest conclusion is *the DAV
listing does not show it*, not *the card is absent*.

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

### T2.1 — the connector (built 2026-08-05)

`packages/connectors/src/jmap-contact-target.ts` — `JmapContactTarget`,
implementing `ContactTargetWriter`, `TargetReindexer` and `TargetRemover`.
Beside the mail target rather than beside the DAV writers in `@openmig/engines`,
because it shares that file's transport concerns — session discovery, the
unroutable advertised `apiUrl`, rate-limit retry — not theirs.

**Rung C settled the last open claim.** The card this path writes, read back
out through the CardDAV door, returns every property that went in: `UID`
unchanged, a standalone `GEO`, `IMPP`, `ROLE`, `CATEGORIES`, `BDAY`, and an
`X-OPENMIG-PROBE` with no JSContact equivalent at all. Not byte-identical —
Stalwart adds `PROP-ID`, `JSCOMPS` and `JSPROP` round-trip machinery and writes
the street into both the legacy `ADR` component and RFC 9554's structured one —
which is exactly why `contactContentHash` is a canonical fingerprint rather
than a hash of bytes.

What it does, and the reason where the reason is not obvious:

- **Writes via route (2).** Upload the vCard blob, `ContactCard/parse`, then
  `ContactCard/set` the SERVER's own parsed card with `addressBookIds` added
  and nothing else changed. The one property the parser cannot know is which
  book; everything else is Stalwart's conversion of the source bytes.
- **Adopts account-wide**, not per book. The natural key is unique per mapping
  rather than per collection (ADR-0020), so a card already filed anywhere is
  adopted rather than written again — and `alreadyExists` from the server is
  adopted too, because the snapshot is a pass old by the time the write lands.
- **An ownership guard built rather than borrowed.** The DAV writers compare an
  ETag; JMAP contacts expose none, and the mail writer's answer — accept
  `expectedTargetVersion` and ignore it — is defensible for mail, where a
  message is immutable apart from flags. It is not defensible for a contact,
  which is exactly the kind of thing an owner edits in a system they have
  started using. So `targetVersion` is a **canonical fingerprint of the card as
  stored**, re-read and re-fingerprinted before any rewrite or removal, and a
  card that moved is refused (`conflicted`, not thrown — a conflict is a fact
  about ownership, not a failed migration).

Two things it carries rather than fixes, both stated in the file's own header:

- **Every read names `vCard`.** One `CARD_PROPERTIES` constant, used
  everywhere, pinned by a test that fails the moment the property is dropped.
- **No §20 checksum leg.** `contentHashFor` is deliberately absent rather than
  stubbed to return `undefined`, which would read as a check that ran and found
  nothing to say.

**22 unit tests, mutation-verified.** Two mutations were run against them:
dropping `vCard` from the property list fails one test, and removing the sort
from the canonical fingerprint fails one test. The second mutation initially
**passed** — the key-order test was serving both fingerprint reads from the
same branch of the fake, so it held whether or not the code sorted anything.
That is the vacuous-pass shape again, in a test written to guard against a
silent failure, and it is only known because the mutation was run rather than
assumed.

### T2.2 — wiring, both editions (built 2026-08-05)

`apps/worker/src/contact-target-factory.ts` — ONE decision function used by
both deps builders, `build-deps.ts` (self-host file config) and
`build-deps-from-mapping.ts` (managed DB rows). ADR-0026 is "one operating UI,
one contract", and a target available in one edition and not the other is
exactly the split that promise forbids (hard rule 5).

**No migration and no new config field were needed.** `connection.kind` has
allowed `'jmap'` since the 0001 baseline, and `TargetConfig` is already a union
including `JmapTarget` — so a contacts domain naming `type: 'jmap'` was
expressible before this change and simply had nowhere to go. The only edits
were a builder that stops insisting on CardDAV and a `davEndpoint` that reads
`baseUrl` as well as `url`.

**JMAP does not replace CardDAV and the dispatcher is written so it cannot.**
Everything unrecognised falls back to `carddav` rather than throwing: throwing
on an unknown kind would have turned every existing `nextcloud` / `soverin` /
`proton` contacts mapping into a hard failure the day this shipped. Nextcloud,
openDesk and Soverin do not speak JMAP for contacts, and a customer already
mid-migration must not be moved.

Switching an existing mapping between the two is safe, and that is evidence
rather than assumption: the natural key is the vCard UID on both paths and it
survives `ContactCard/parse` byte-identical, so a switched mapping adopts what
is there instead of re-copying it.

**`jmap-contact-target.integration.test.ts`** turns the spike's findings into
something that fails when they stop being true — against a real Stalwart, not a
fake transport. Six cases: the UID is the key (looked up by `targetId` first,
so it compares the key rather than finding by it and then asserting it); a
second pass adopts instead of duplicating; `X-OPENMIG-PROBE` is still in the
stored card, read straight off the server rather than through the connector;
the rewrite guard refuses a moved card; the fingerprint is stable enough that a
matching rewrite goes through; and removal reports `deleted` rather than
`binned`.

**It is already gated in CI, and that was a pleasant correction to make.** The
`integration-tests` job runs `pnpm test:integration`, and `vitest.global-setup.ts`
provisions a Stalwart with Testcontainers and exports `STALWART_JMAP_URL`,
`STALWART_JMAP_USERNAME` and `STALWART_JMAP_PASSWORD` before any test file
loads. Nothing needs configuring; the suite brings its own server.

Two things this file got wrong on the first pass, both found by running it:

1. The header told the owner to point it at their dev Stalwart with
   `STALWART_JMAP_URL=http://127.0.0.1:18080`. **That variable is overwritten by
   the global setup**, so the run went to the Testcontainers instance and the
   instruction was noise.
2. It then read a hardcoded `target@dev.local` and a loopback password default
   while **ignoring the two variables the harness actually exports**. It passed
   because the fixture happens to use those exact values — luck rather than
   correctness, and it would have broken on any fixture change for a reason
   having nothing to do with the connector. Both are read properly now, the way
   `shadow-pass.integration.test.ts` reads them.

When `STALWART_JMAP_URL` is unset it skips under a describe named **"NOT
VERIFIED against a real server"**, because a suite that goes green having
checked nothing is the failure mode this repo keeps finding. Under the
integration project that branch is effectively **unreachable** — the harness
always sets the URL — so it guards someone running the file outside the
harness and nothing else. Said plainly in the file, because a guard that cannot
fire where it matters is not the protection it looks like.

### T2.3 — what is STILL not done

### T2.3 — the LOOP over the connector (built 2026-08-05)

`packages/core/src/jmap-contact-sync.integration.test.ts` — `runContactSync`
against a real Stalwart, shaped like `dav-sync.integration.test.ts` with the
same synthetic in-memory source so only the untested leg is on trial.

**Why here rather than in the nightly e2e.** The e2e boots the whole appliance
from ONE mapping fixture whose contacts domain is CardDAV→CardDAV. Adding JMAP
there meant either a second twenty-minute appliance run or replacing the
CardDAV coverage — spending real e2e time to prove something a much cheaper
gate can prove, and losing a proven path to do it. `dav-sync.integration.test.ts`
already established the right size for "the loop, over a real target", it runs
in CI on every push rather than nightly, and this sits beside it.

Three cases, and two of them are assertions the DAV file does not make because
they are specific to this transport:

1. **N created, 0 on a second pass through a FRESH writer, 1 more on a third.**
   The fresh writer matters: the connector caches an account-wide key snapshot
   for the life of an instance, so reusing it would let the snapshot rather
   than the LEDGER be what makes pass 2 idempotent — and the ledger is the leg
   the connector's own tests cannot reach. The third pass is the shadow-sync
   property: a sync that had stopped taking new work entirely passes 1 and 2
   perfectly, because "created 0" is exactly what it would report.

2. **The stored-card fingerprint reaches the ledger.** JMAP contacts expose no
   ETag, so the writer invents its version marker by fingerprinting the card as
   stored — and unlike the DAV writers it does **not** record its own rows, so
   the value only survives if `runDomainSync` persists what `upsertContact`
   returned. If it does not, nothing fails: every future rewrite simply runs
   with no ownership guard and hard rule 2 stops being enforced quietly.

3. **The RFC 9555 escape hatch survives a full pass.** `X-OPENMIG-PROBE` can
   only be on the server by riding the `vCard` property, which is the one thing
   letting the server parse buys over building the card from our normalised
   model. Change that and every other assertion still passes; only this goes
   red.

**One vacuous assertion caught before it shipped**, in both this file and the
connector's own integration test: the escape-hatch check grepped the entire
`ContactCard/get` response body, and the two suites plant an identical
`X-OPENMIG-PROBE` against the same Stalwart account. Either would have gone
green on the other's card — failing only when BOTH were broken at once. Both
now isolate their own card by uid first and assert on that object.

**Not run locally**: this container has no Docker, so the integration harness
cannot start. CI is the first execution.
- **Not in the scope manifest**, which is T4's job: the manifest should say
  which protocol carries which domain, and it does not yet.
- **No §20 checksum leg**, permanently, for the reason in T2.1.

### T3.1 — the connector (built 2026-08-06)

`packages/connectors/src/jmap-file-target.ts` — `JmapFileTarget`, implementing
`FileTargetWriter`, `TargetReindexer` and `TargetRemover`. Beside the other two
JMAP writers rather than beside `webdav-target-writer.ts` in `@openmig/engines`,
because it shares their transport concerns — session discovery, the unroutable
advertised `apiUrl`, rate-limit retry, method-level errors inside an HTTP 200 —
not theirs.

**The two spike findings are load-bearing, and both are structural rather than
a comment asking someone to remember.**

- **A FileNode has no path.** Identity is `name` + `parentId`; the natural key
  is rebuilt by `reconstructFileNodePath` and nothing here re-implements path
  handling. `readTree` refuses the WHOLE enumeration rather than mis-key one
  broken chain: a suffix path is a well-formed string that hashes to something
  no other transport produces, so the file would copy again on every pass
  forever with every write succeeding. Refusing is loud and one operator
  decision; the alternative is silent and permanent.
- **The blobId you upload is not the blobId the node carries.** Stalwart
  re-issues the handle once the blob is attached, so `contentHashFor` reads it
  off the node and the upload's id is never retained past the create call. This
  is the finding that does not fail at write time: it surfaces as §20 samples
  quietly returning `checksumUnavailable`, which reads as a check that ran.

**This domain needs no narrowing, and that is worth stating beside T2.1's,
which did.** A `ContactCard` has no handle back to vCard bytes, so contacts over
JMAP get counts and presence only. A `FileNode` carries `size` AND `blobId`,
both proven real by the spike, so files over JMAP are verified exactly as files
over WebDAV: counts, total bytes and content checksums. `contentHashFor` is
therefore implemented here rather than deliberately absent.

Three more decisions where the reason is not obvious:

- **The ownership guard is built rather than borrowed.** The WebDAV writer
  compares an ETag; a FileNode exposes none. So `targetVersion` is a canonical
  fingerprint of the node as stored, over a FIXED property list so it is
  deterministic, re-read and re-fingerprinted before any rewrite or removal. A
  node that moved is refused (`conflicted`, not thrown — a conflict is a fact
  about ownership, not a failed migration).
- **Directories are created segment by segment**, because WebDAV gets a path
  for free and JMAP does not: a node without a parent is a node somewhere else.
  `parentId: null` is the account root — a JMAP file tree has no node for it,
  which is why `ensureDirectory` returns `''` for it rather than inventing one.
- **Both conflict directions refuse.** A directory sitting where a file must go
  (the WebDAV writer's case) and a file sitting where a directory must go (this
  transport's own). Writing over either destroys the customer's data; adopting
  either records an item that was never copied.

**26 unit tests, mutation-verified SIX ways** — every mutation caught, and the
list is the argument that the tests are load-bearing rather than decorative:

| Mutation | Tests that fail |
|---|---|
| Key files by `node.name` instead of the reconstructed path | 3 |
| Drop `blobId` from the read property list | 2 |
| Return a method-level `["error", …]` as if it were the result | 2 |
| A failed enumeration degrades to an EMPTY tree instead of `undefined` | 1 |
| Drop the sort from the canonical fingerprint | 1 |
| Keep the UPLOAD's blobId and use it for the checksum sample | 1 |

The fake transport honours `properties` deliberately: a fake that ignored the
property list would let the second mutation through, and that mutation is the
one the whole §20 leg for this domain depends on.

### T3.2 — wiring and the two integration tests (built 2026-08-06)

`apps/worker/src/file-target-factory.ts` — ONE decision function used by both
deps builders, exactly as `contact-target-factory.ts` is. **No migration and no
new config field were needed**: `connection.kind` has allowed `'jmap'` since the
0001 baseline and `TargetConfig` already includes `JmapTarget`. Everything
unrecognised falls back to `webdav` rather than throwing, so no existing
`nextcloud` / `webdav` mapping moves the day this ships.

Switching an existing mapping between the two is safe, and that is a property of
the KEY rather than a hope about the protocol: both paths key on the same
root-relative path, one read off a URL and one rebuilt from a parent chain, and
`jmap-file-path.unit.test.ts` pins the two as producing the same
`fileNaturalKeyHash`.

**`packages/connectors/src/jmap-file-target.integration.test.ts`** — the
connector against a real Stalwart. Six cases: the key is the reconstructed path
(looked up by `targetId` first, so it compares the key rather than finding by it
and then asserting it); a second pass through a FRESH writer adopts instead of
duplicating; **the checksum leg resolves through the node's own blobId**; the
rewrite guard refuses a moved node and goes through on a matching one; the
rewrite actually replaced the bytes; and removal reports `deleted` rather than
`binned`. The fixture path carries a SPACE, because that is the character a
percent-encoding reconstruction gets wrong and gets wrong silently.

**`packages/core/src/jmap-file-sync.integration.test.ts`** — the LOOP over the
connector, shaped like `jmap-contact-sync.integration.test.ts` with the same
synthetic in-memory source so only the untested leg is on trial. Three cases,
and two are specific to this domain: the source-side and target-side natural-key
hashes asserted EQUAL in one run against a real server (the only place in the
repo where both halves are computed by the code that will really compute them),
and the stored-node fingerprint plus the byte count reaching the ledger — the
writer does not record its own rows, so if `runDomainSync` drops the version
nothing fails and hard rule 2 simply stops being enforced. Fixture prefix `5b2b`,
registered in `docs/test-fixture-uuid-collision-audit.md`.

**NOT RUN HERE.** This container has no Docker, so the integration harness
cannot start; CI is the first execution of both files. Said plainly rather than
implied, because "the tests are written" and "the tests pass" are different
claims and only one of them is true today.

### T3.3 — what is STILL not done

- **The delta/removal channel.** WebDAV has no delta query and JMAP has
  `FileNode/changes`; nothing here uses it, so a JMAP files mapping enumerates
  the account per pass exactly as the WebDAV one does.
- **The trashbin signal.** Nextcloud serves a trashbin endpoint whose entries
  give files `trashed` deletion evidence (§11.1). Nothing has established that a
  JMAP filenode account exposes an equivalent, and inventing one would be the
  guess this plan exists to avoid. Files over JMAP therefore stay on
  absence-counting for deletions, which is the weakest of the three signals and
  is stated rather than left to be discovered.
- **Paging.** `FileNode/get` with `ids: null` reads the whole tree in one call,
  which is what the spike exercised. `FileNode/query` would allow paging and
  nothing has confirmed this server implements it; a paginating enumerator built
  on an unverified method fails by returning FEWER nodes than exist, which reads
  as data loss. Same bound, same reasoning, as `JmapContactTarget`.

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
