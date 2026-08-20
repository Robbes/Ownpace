# ADR-0040: The service is Ownpace; the project keeps its own name

- **Status:** Accepted 2026-08-20 — owner decision in conversation ("Ok, i picked ownpace.eu"),
  closing the naming question opened by [ADR-0039](./0039-no-open-core-and-what-ops-privacy-means.md)'s
  finding that the trademark is the mission-compatible moat.
- **Date:** 2026-08-20
- **Deciders:** owner
- **Relates to:** [ADR-0001](./0001-license-apache-2.0.md) (Apache-2.0 §6 grants no trade-mark
  rights — which is why a mark is worth having), [ADR-0009](./0009-repo-strategy-public-monorepo.md)
  (one public repo), [ADR-0015](./0015-backup-scope.md) (the backup is a second mapping, not a
  second product — which bears on the open question below),
  [workplan 0088](../workplans/0088-a-price-you-can-see-before-you-connect.md) (whose
  "the service name" hold this releases).

> **Update 2026-08-20** — the owner extended this decision the same day: *"i want the repo
> rename to Ownpace, and i want all copyright headers updated to the new name."* Open question
> (a) below is therefore **partly answered** — project and service share one name — and the
> operative bullets are amended in place accordingly (ADR-0038). What that instruction did
> **not** reach, and what is deliberately untouched, is the third rename surface found while
> executing it: the operational identifiers. See the amended bullet and the Consequences.

> **Update 2026-08-20 (second)** — the owner authorised the third surface too: *"we keep the
> @openmig/* but do take on the Operational identifiers: nothing is live."* The bullet below
> that said operational identifiers are not renamed is amended in place accordingly; the
> reasoning that produced it is kept above, because it stays true of anything that IS live —
> this was safe only because nothing was. Surveying it also found that **`Open Migrate` was
> still the live customer-facing brand** in the web UI and in every notification e-mail
> subject, EN and NL — missed by the first pass, which grepped only for "Open Migration Stack".

> **Update 2026-08-20 (third)** — `ownpace.eu` is registered, the TMView check ran, and the
> owner asked for the mark to be asserted. The held item below is therefore **decided**;
> the evidence is in "The trade-mark check" at the end of this file.

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **One name: Ownpace** (`ownpace.eu`) — service *and* project. The repository, every
  copyright header, `NOTICE`, the README title, the API title and the root package all say
  Ownpace. The project/service split this ADR first recorded lasted one day and is superseded
  by the owner's 2026-08-20 instruction; the reasoning that produced it is kept above.
- **Never draw a name from the category's own vocabulary.** Three rounds found a prior user
  each time: *migrate* → TSG's OpenMigrate (2006); *safe* → SETsafe; *keep* → Keepit A/S.
  A candidate gets a prior-user check **before** a domain is bought, not after.
- **A domain is not clearance.** DNS availability is a hint (port 43 and RDAP are blocked from
  our sandbox, so even "unregistered" is unproven); **TMview classes 9, 38 and 42** before any
  filing or any assertion of the mark.
- The **GDPR Article 20 framing belongs in the copy, never in the name** — "transmitted
  directly from one controller to another, where technically feasible" is a claim no competitor
  can take and no registry has to grant.
- **Renamed to `ownpace-*`:** compose project, container, network and volume names, the
  persist directory, and future GHCR image names. **This is not a rename on a live stack** —
  a compose project rename detaches its volumes, so an operator with data must destroy the old
  project deliberately (`docker compose -p <old> down -v`) rather than discover it. Done here
  only because nothing was live.
- **Kept, deliberately:** the npm scope **`@openmig/*`** (13 packages, all `private: true`), and
  everything that follows it — the `openmigrate` Postgres role/database and the
  **`openmigrate_*` Prometheus metric prefix**, which a rename would silently break for every
  existing dashboard and alert. Rule of thumb: rename what is named after the *product*, keep
  what is named after the *scope*.
- **An image already published never moves.** Tags up to `v0.1.0-rc.1` live at
  `ghcr.io/robbes/open-migrate-selfhost` forever; `v0.1.0` on lives at `ownpace-selfhost`.
  `scripts/upgrade-drill.sh` derives its registry from the tag for exactly this reason — a
  hardcoded path makes the drill pull a tag that does not exist, silently, from the script whose
  job is proving upgrades work. The cosign identity regexp matches **both** repo paths.
- **The mark is asserted in `NOTICE`** — the one restriction on an otherwise permissive
  licence, guarded by `scripts/notice-and-trademark.unit.test.ts`. It is an **unregistered**
  claim: no `®`, no "registered trade mark of". The assertion states what needs **no**
  permission (nominative use, forking, private instances) as explicitly as what does, so it
  cannot be misread as a restriction on the code.
- **Still OPEN, the owner's, not to be inferred:** whether to file an EUTM (a separate step
  from asserting — see the two extra searches named below); the legal proprietor named in
  `NOTICE`, currently "the Ownpace project maintainers" rather than a company; and whether the
  post-cutover backup gets its own brand or is a plan name under Ownpace.

## Context

**The project answers to four different names in five places today**, which is the disorder this
ADR starts to resolve rather than the problem it solves:

| string | where | note |
|---|---|---|
| `open-migrate` | the GitHub repository | the name people cite |
| **Open Migration Stack** | `README.md` H1, `NOTICE`, and every file's copyright header | the *public product* name today |
| `sovereign-migration-stack` | root `package.json` `name` | internal only |
| `@openmig/*` | 13 workspace packages | **all `private: true`** — nothing is published to npm |

**Why a distinct service name was needed at all.** ADR-0039 established the trademark as the one
moat that costs the mission nothing: Apache-2.0 §6 grants no trade-mark rights, so a fork may run
every line and still may not trade under our name. That only works if the name is *ownable*.
"Open Migrate" is not: it is inherently descriptive of the goods (EUTMR Art. 7(1)(c)), **and**
TSG has shipped an ECM migration product called OpenMigrate since 2006 — EMC "Designed for
Documentum" accreditation, a product page, a CMSWire profile, and a GitHub repository archived in
August 2023. A mark that is both descriptive and second-in-use is not a moat.

**A pattern emerged over three rounds of candidates, and it is the transferable lesson.** Every
name built from the category's own vocabulary already had an established owner *in the category*:

| our word | prior user |
|---|---|
| **migrate** | TSG OpenMigrate — ECM migration since 2006 |
| **safe** | SETsafe \| SETfuse — circuit protection, ~40–50 countries, class 9, and it markets into data-centre power |
| **keep** | Keepit A/S — Copenhagen, 2007, SaaS backup for M365/Google/Salesforce, GDPR- and NIS2-positioned, ~$90M raised in 2024 |

The third is the sharpest, because it killed a recommendation made in this same conversation
(`ownkeep`) *after* it had been given. Recorded here rather than quietly dropped: the analysis
that produced it had not checked the category for prior users, which is exactly the check the
operative rule above now requires.

**Why "pace" survives all three rounds.** It is not category vocabulary. "Data portability",
"migration", "backup" and "safe" describe the *goods*; pace describes the **promise** — migration
that runs for as long as the customer wants, cutover on their word, the service ending when they
say so. A name drawn from the promise rather than the goods is suggestive, not descriptive, which
is the side of Art. 7(1)(c) a registrable mark sits on. "Own" carries the second meaning for
free: it is *your* pace, and it is *yours*.

## Decision

The managed service is **Ownpace**, at `ownpace.eu`.

The project keeps a separate name. Which one, and whether the repository, the npm scope and
`NOTICE` are brought into line with each other or with the service, is **not decided here**.

## Consequences

- **Workplan 0088 is unblocked** on this point: its "Not in this plan — the service name" line
  can retire, and `site/pricing/` may carry a brand.
- **Asserting the mark in `NOTICE` becomes decidable.** `NOTICE` today disclaims Microsoft's
  marks and asserts nothing about ours. ADR-0039 recommended asserting; the owner held it
  ("hold on a bit longer"), and it stays held. **Do not assert it before the TMview check.**
- **A repo rename is now a coherent option, and its cost is measured rather than feared:** 541
  files carry one of the name strings; a GitHub repository rename 301-redirects clones, issues
  and pull requests, so old remotes keep working; and because all 13 `@openmig/*` packages are
  `private: true`, a scope rename is a mechanical sweep with the test suite as its guard — no
  external consumer exists. The copyright header is the one string to change deliberately.
  **Recommended sequencing if it happens: one commit, all identities at once, tests as the
  gate — never a rename per identity.**
- The backup product's naming (ADR-0015 already holds that a backup *is* a second mapping
  through the same tested machinery, not a second build) is **recommended** as a plan name under
  Ownpace rather than a second brand: a separate brand would create a marketing boundary the
  code deliberately does not have, double the trademark and support surface for a solo operator,
  and introduce a second unfamiliar name at cutover — the exact moment continuity is the value.
  Not decided.
- One copy fix falls out and is worth doing whenever the brand lands anywhere public: the
  repository description reads *"Migrate anywhere in your own pace"*; idiomatic English is
  **"at your own pace"**, and the preposition ships with the brand.

## Alternatives considered

- **Keep "Open Migrate" as the service name and assert it anyway.** Rejected: descriptive *and*
  second-in-use. Asserting a mark we would likely lose is worse than asserting none.
- **`setsafe.eu`** — chosen by the owner in an earlier round and withdrawn on evidence: SETsafe
  is an established international brand whose goods sit in class 9 alongside software, and the
  search collision reproduces the Open Migrate problem exactly.
- **`ownkeep.eu`** — recommended and then withdrawn on the Keepit finding above.
- **The `port` family** (`rightport`, `doport`, `moveport`, …) — legally apt, since Article 20 is
  literally the right to *port* data, and rejected for that reason: it is the category's own
  vocabulary again. `doport` additionally reads as *deport*, which is disqualifying for a product
  about moving people's data in Europe.
- **The `leap` family** (`ownleap`, `shadowleap`, …) — rejected on positioning: a leap is sudden
  and taken on faith, and this product exists to replace faith with evidence. `sovleap` also
  reads as "sleep-leap" in Danish, Norwegian and Swedish.
- **Coined names.** `lentara.eu` cleared best of the invented set — no exact prior mark found,
  `.nl` and `.de` both open, and it reads as *lente* (Dutch: spring) at home and *lento* (the
  musical tempo marking) abroad. `solvara.eu` was rejected: 10 of 12 tested TLDs resolve
  including `.nl` and `.de`, a UK wellness brand and a brand-design studio both trade as Solvara,
  and "solv-" reads as *insolvent* for a company that sends invoices. Coined was declined
  overall for a simpler reason — `ownpace` states the differentiator with no explanation,
  and `lentara` needs a sentence.

## The trade-mark check (2026-08-20)

TMView, search *Merknaam (bevat): Ownpace*. **Two hits, both dead, neither in the EU, and
neither ever in our classes:**

| mark | filed | office | classes | proprietor | status |
|---|---|---|---|---|---|
| OWNPACE (86572163) | 2015-03-21 | US | 16, 41 | Gorodnitskiy, Oleg | **Ended** |
| AMERIDREAM.TRAVEL EXPERIENCE AMERICA AT YOUR OWNPACE (77296704) | 2007-10-04 | US | 39 | Canadream Corporation | **Ended** |

Classes 16 (printed matter), 41 (education/entertainment) and 39 (travel) are nowhere near 9,
38 or 42. So: no live mark anywhere, nothing in the EU at all, and no history in the classes a
software service files in. That is ample grounds for the unregistered assertion made in
`NOTICE`.

**What this search does NOT establish, stated so nobody treats it as clearance.** It matched
names *containing* "Ownpace", which is the right first search and not a sufficient one — an
EUIPO opposition can be founded on **similarity**, not identity alone. Two searches should run
before any filing: **"Own Pace"** as two words, and a phonetic/visual neighbourhood sweep
(`ONPACE`, `OWNSPACE`, `OWNPAY`), none of which a `contains` search returns. TMView also says
nothing about unregistered rights, company-name registers, or common-law use.

Asserting in `NOTICE` needs none of that — an unregistered mark is asserted by using it and
saying so. **Filing does.**
