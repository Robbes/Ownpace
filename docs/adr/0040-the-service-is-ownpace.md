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
- **Operational identifiers keep the old string and are NOT renamed with the brand:** GHCR
  image names (`ghcr.io/robbes/open-migrate-{api,web,selfhost}`), the compose project, container,
  network and volume names, the persist directory, and the `openmigrate` DB role. Renaming a
  compose project **detaches its live volumes** — the running stack would come up empty with the
  real data dangling — and the published images are cosign-signed against
  `--certificate-identity-regexp '^https://github.com/Robbes/open-migrate/'`, so a rename breaks
  signature verification for everything already released. Any change here is a migration, not a
  rename, and needs its own plan.
- **Still OPEN, the owner's, not to be inferred:** the npm scope `@openmig/*` (13 packages, all
  `private: true`, so no external consumer); whether to assert the mark in `NOTICE` (still held);
  and whether the post-cutover backup gets its own brand or is a plan name under Ownpace.

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
