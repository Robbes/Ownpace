# ADR-0039: No open-core — closed, with a trigger; and what "private ops" actually means

- **Status:** Accepted 2026-08-19 — owner decision in conversation ("i accept the
  reaffirm-with-revisit-trigger resolution"), given conditionally on the reasoning holding
  after the owner's own addition about the product's pace. One premise of that reasoning was
  **wrong and is corrected below**; the correction strengthens the conclusion rather than
  rescuing it, which is why the acceptance stands.
- **Date:** 2026-08-19
- **Deciders:** owner
- **Resolves:** the flagged conflict between [ADR-0009](./0009-repo-strategy-public-monorepo.md)
  ("No open-core", Accepted) and [ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md)
  ("parked, not rejected… remains open", Accepted).
- **Relates to:** [ADR-0001](./0001-license-apache-2.0.md) (Apache-2.0 and its accepted
  trade), [ADR-0003](./0003-two-editions-one-core.md), [ADR-0014](./0014-cost-recovery-billing.md)
  (**not** decided here — see the last section), [ADR-0015](./0015-backup-scope.md) (why the
  backup use case is a pricing question, not a build).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **No open-core, no private monorepo, no filtered mirror.** ADR-0009's answer stands and the
  question is **closed**, not open — superseding ADR-0036's "remains open" on this point only.
- **Revisit needs all three, not any:** the managed service has become the primary funding for
  sustained work; a resourced competitor has actually forked and is outcompeting us; and cost
  recovery has demonstrably failed. Absent all three, this stays closed.
- **Two public Apache-2.0 repos** (the variant neither prior ADR named) is **declined**: the
  boundary's three guards each need one repo — the leakage walk's single import graph, the
  both-bundles build, and `two-chains` applying both chains to one database. Reconsider only
  on a *social* trigger (a separate contributor community around the core), never a technical one.
- **"Private ops" means instance facts and secrets, never the recipe.** `deploy/` is public by
  design — it is how an MSP runs their own managed instance. Instance facts (hostnames, IPs,
  runner paths, project refs) ride env vars and repository variables; secrets are gitignored
  and never in git. A private ops repo is warranted only if instance facts outgrow env vars,
  and it holds *only* those, pointing at the public recipe.
- The trademark is the **mission-compatible moat** — Apache-2.0 §6 grants no trade-mark
  rights — but asserting it in `NOTICE` is **recommended, not yet decided**.

## What the conflict actually was

Not a disagreement about topology. ADR-0036 says in its own consequences: *"A package boundary
is not a licence boundary, and this ADR must not be read as a first step toward closing
anything — that decision is the parked one, and remains open."* It never reopened open-core on
the merits; it drew a package boundary, disclaimed any licensing consequence, and then declined
to re-affirm ADR-0009. The whole disagreement was one word: **0009 says the question is closed;
0036 says it remains open.**

That matters because resolving it costs nothing 0036 achieved. The extraction boundary, the
leakage walk, the two chains — all survive any answer here.

## The reasoning, including the premise that was wrong

**The mission test decides it.** ADR-0009's own consequence names who open-core would exclude:
*"MSPs/communities can run their own managed instance."* Closing `packages/managed` closes
multi-tenancy — exactly what an MSP needs and a family does not. One MSP serving fifty SMBs
moves more people off US cloud than a single-operator managed service plausibly will. For a
mission stated as *migrate as many people as possible*, open-core **taxes the highest-leverage
adopter to protect revenue from the lowest-leverage one**, which inverts the objective.

Against that, what Apache-2.0 costs is already priced by ADR-0001: *"a third party may run the
code as a closed SaaS (accepted trade)."* Note what that costs **the mission** — nothing. A
competitor migrating Europeans off US cloud *achieves* the mission. It threatens only the
subgoal, and a subgoal yields to the mission by definition.

**The premise that was wrong.** The analysis put to the owner argued the fork threat was weak
partly because *"migration is a one-time-ish transaction with modest lifetime value."* The owner
corrected it: the product's distinguishing promise is migration **at the customer's own pace** —
sync running for months, cutover when the owner says so, the service ending on their word, or
continuing indefinitely as a backup to a second destination. **That is recurring revenue, not a
one-shot fee.**

The correction strengthens both halves rather than weakening either:

- *For the subgoal:* cost recovery is more achievable than the analysis assumed, and ADR-0014's
  model already fits it — a low flat monthly plus marginal pass-through for storage and egress,
  which is precisely the "syncs a lot of bytes" shape. ADR-0015's retraction helps too: it
  retired the extra-backup feature because *a second mapping pointed anywhere achieves the same
  through tested machinery*, so the backup cohort is a **pricing** question, not a build.
- *For the licence:* "ends when you say" is a promise about **customer control**, and
  Apache-2.0 plus a self-hostable appliance is its strongest form — if we vanish, or they stop
  paying, or they outgrow us, they take the appliance and keep going. Open-core would withhold
  the multi-tenant half and quietly narrow that promise for anyone graduating from managed to
  self-run. The licence and the USP point the same way.
- And a service **designed to end** is a poor business to steal, which weakens the very threat
  open-core would exist to answer.

**What the moat actually is,** since it was never the source: operations (running the stack, the
nightly gates, on-call); trust at a frightening one-time moment — this product's stated
differentiator is that it tells the truth, `SKIPPED` means nobody checked (ADR-0029); and the
**trademark**, which Apache-2.0 §6 explicitly does not grant. A fork may run every line; it may
not call itself Open Migrate. That is protection which costs the mission nothing.

**The cost of splitting, measured rather than assumed.** ADR-0036 says two repos "get easier,
not harder" now the boundary exists — true of the *boundary*, but the boundary is **verified** by
mechanisms that each need one repo: `no-managed-leakage` walks one transitive import graph; the
bundle test builds both editions in one pass and compares; `two-chains.unit.test.ts` applies both
chains to one database. Split, and each becomes cross-repo CI with version skew — a core change
that breaks managed surfaces at the next bump instead of in the PR, and a schema change touching
both chains becomes two ordered PRs. The guard that caught the `billing`-vs-`pricing` naming
failure gets weaker exactly where the stakes rise.

**AGPL for the managed control plane** — open but reciprocal — was the honest middle and is
declined: it contradicts ADR-0001's maximal-use rationale, a mixed-licence monorepo is real
overhead in headers, SBOM and contributor clarity, and AGPL reliably fails exactly the SMB and
MSP legal reviews we most want to pass, cutting the multiplier group to deter a threat that is
largely hypothetical here.

## The ops-privacy correction

ADR-0009's rule reads *"Private only: … our operational deployment/IaC."* **That is not
describing reality**, and reality is the correct one: `deploy/compose/managed.yml` and 31 other
`deploy/` files are tracked and public today.

"IaC" was conflating three tiers with different homes:

| tier | example | belongs | today |
|---|---|---|---|
| **Recipe** | `managed.yml`, bootstrap scripts, `trigger-tls.Caddyfile`, `pgbouncer.ini` | **public — a product feature** | public ✓ |
| **Instance facts** | hostnames, IPs, runner paths, project refs, persist dirs | private, but small | env vars + repository variables ✓ |
| **Secrets** | keys, tokens, passwords | never in git | `.env*` gitignored ✓ |

The recipe must stay public: it is how an MSP runs their own managed instance — ADR-0009's own
stated consequence and the mission's multiplier. Privatising it would be open-core through the
back door, arriving as an ops decision rather than a licensing one, which is how such things
usually arrive.

Tier 2 was checked rather than assumed: `git grep` over `deploy/` and `.github/` for IP
literals, personal paths and host names returns only `/home/node/shared` (a container path) and
`1.1.1.1`/`8.8.8.8` (public resolvers). **Nothing instance-specific is committed.** The existing
pattern — `${{ vars.MANAGED_ENV_PERSIST_DIR }}`, GitHub secrets, and `.env` restored from
outside the checkout so `actions/checkout`'s clean cannot reach it — is already the right
mechanism.

**A private ops repo is therefore not needed now.** It becomes warranted if instance facts
outgrow environment variables — real Terraform state, DNS records, monitoring configuration —
and when it appears it holds *only* those, pointing at the public recipe. That is the ordinary
split, not open-core.

## What this ADR does NOT decide

**ADR-0014's "cost recovery, no profit" is untouched.** The owner raised *"perhaps earn a bit"*
in the same conversation; that is a genuine change to stated project intent, it is independent
of everything above (a margin on a hosted service is fully permitted by Apache-2.0), and it was
**not decided here**. Conflating the two is how projects close code to solve a problem pricing
would have solved.

One number should be measured before that pricing is set, and the ledger can already answer it:
**what fraction of customers keep a mapping running after cutover.** If the service ends at
cutover, per-customer revenue is bounded by migration duration; the keep-syncing/backup cohort
is the only unbounded line.

**Asserting our trademark in `NOTICE`** is recommended above and not decided. `NOTICE` today
disclaims Microsoft's marks and asserts nothing about ours.
