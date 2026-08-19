# ADR-0036: The managed edition is its own package and its own migration chain

- **Status:** Accepted 2026-08-19 — owner decision, in two rounds. First "do the path 1 now"
  (clean the boundary, stay in one repo), then, after reading what that turned up, "move all
  four" and "leave the chain, split only". The other two structural options — an open-core
  split into two repositories, and a private monorepo with a filtered public mirror — are
  **explicitly parked**, not rejected. This ADR is deliberately written so that neither is
  made harder by it.
- **Date:** 2026-08-19
- **Deciders:** owner
- **Relates to:** [ADR-0003](./0003-two-editions-one-core.md) (two editions from one core —
  this is that decision's boundary, drawn where it had never actually been drawn),
  [ADR-0009](./0009-repo-strategy-public-monorepo.md) (public monorepo — unchanged),
  [ADR-0014](./0014-cost-recovery-billing.md) (what the moved pricing computes),
  [ADR-0035](./0035-who-signs-in-and-who-gets-a-link.md) (`tenant_member` is its model, and
  moves here), [ADR-0020](./0020-ledger-rebuildable-cache-recovery.md) (why a pre-release schema
  rewrite is cheap), [ADR-0001](./0001-license-apache-2.0.md) (Apache-2.0 — unchanged, and
  see Consequences), AGENTS.md hard rule 5 (the editions must not differ), hard rule 2 (never
  delete from source).

## Context

ADR-0003 says two editions come from one core. It does not say where the core stops, and
nothing enforced a stopping point, so over time it stopped in different places depending on
what was convenient.

The appliance's entrypoint imports `@openmig/shared` and `@openmig/ledger`. Both re-exported
the managed service:

| what | where it was | what the appliance got |
|---|---|---|
| `pricing.ts` — price list, VAT, integer-cent arithmetic | `@openmig/shared` | the price list of a service its owner is not a customer of |
| `tenant-pricing.ts` — a tenant's agreed rates | `@openmig/ledger` | a function that would pin a price for an appliance with no customers |
| `usage-metering.ts` — the rows an invoice is built from | `@openmig/ledger` | a writer for a table it never reads |
| `offboarding.ts` — close windows, purge, receipts | `@openmig/ledger` | a module it loads and never executes a line of |
| `invoice`, `payment_method`, `usage_metric`, `tenant_member`, `erasure_record` | `schema-pg.ts` + `0001_baseline.sql` | five tables it creates and never writes a row to |
| `tenant.pricing`, `tenant.closed_at/purge_after/closed_by` | `schema-pg.ts` + `0007`/`0025` | four columns of the same |
| `pages/Billing.tsx` + its Mollie-shaped client | `apps/web`, statically imported | 11,551 bytes of payment UI in every appliance bundle |

None of it ever *ran* on the appliance. `ManagedOnly` redirects the billing route, no
appliance code path calls a pricing function, and `purgeTenant` is invoked from exactly one
place: `apps/worker/src/jobs/managed-purge-closed.ts`. That is precisely why it survived —
every test was green, and a rule nothing enforces is a habit.

**The guard that should have caught it did not, and its reason is the most transferable thing
here.** `apps/selfhost/src/no-managed-leakage.unit.test.ts` walks the appliance's real
transitive import graph and fails on forbidden specifiers. Its forbidden list was
`@trigger.dev`, `mollie`, and the word `billing`. The modules above are called `pricing`,
`tenant-pricing`, `usage-metering` and `offboarding`. **A rule written against the word
"billing" catches whatever happens to be named after the invoice, not what happens to be
about money** — and it passed, for as long as they existed, while walking straight past them.

The question that started this was not about any of these files. It was: *would a monorepo
holding both editions leave the appliance contaminated with managed concerns?* The
measurement says the shared packages are 64% of the tree and the managed apps 15%, so the
ratio was never the problem. The absence of an enforced boundary was.

## Decision

**1. Managed-only code lives in `@openmig/managed`, which the appliance may not import.**
Pricing, tenant pricing, usage metering, offboarding, and the seven managed tables move
there. Only `apps/api` and `apps/worker` depend on it.

**2. The split is by who is being served, not by subject matter.** This package was called
`@openmig/billing` for about an hour, on the theory that money was the whole of the
difference. It was not: the same boundary immediately caught accounts, closing an account,
and the erasure receipts we produce as somebody's processor — none of which is money, and all
of which exists only because there is a customer on the other side. An appliance has an
owner, not customers.

**3. The rule is enforced by a walk, not by review.** `no-managed-leakage` forbids
`@openmig/managed` by name and the pricing/metering specifiers, and gained the half it never
had: the appliance's reachable graph declares no managed-only **table**, and the allow-list of
managed-only **columns** is empty.

**4. The appliance's bundle is asserted by building it.** `AppRoutes` loads Billing through a
dynamic import behind a comparison against a literal Vite bakes in, so the self-host build
folds the branch away and no chunk is emitted. That is invisible in a diff — `isSelfHost()`
would be correct at runtime and useless here, because a function call is opaque to the
bundler — so the test builds **both** editions in memory and requires every billing marker
present on managed and absent on self-host.

**5. Managed DDL lives in `packages/managed/migrations/`, with its own bookkeeping table and
its own advisory lock.** `apps/api` applies the shared chain, then the managed one. The
appliance applies only the shared one, and that is the whole mechanism by which it ends up
without the tables.

**6. A managed thing that hangs off a core table becomes a ROW, not a column.**
`tenant.pricing` is `tenant_pricing`; `tenant.closed_at/purge_after/closed_by` is
`tenant_closure`. `tenant` itself stays core and cannot move: it is the RLS anchor every other
table keys on, and putting it in the managed package would make the shared packages depend on
the managed one.

Absence of a row is also a better answer than a nullable column. As columns, both needed a
comment saying NULL did not mean "free" and did not mean "not closed" — a distinction a reader
gets wrong exactly once, on an invoice.

**7. `tenant.status` keeps `closed` and `deleting`.** A CHECK constraint is a statement about
what is ALLOWED; an allowed-but-unused value costs an appliance nothing, and moving it would
mean the managed chain rewriting a constraint the shared chain owns. A cross-chain dependency
is much worse to carry than an unused enum value.

**8. `apps/selfhost/src/forget-me.ts` stays on the appliance.** It looks like the same subject
as offboarding and is not. Deleting an appliance destroys *our copy* of a credential and does
nothing whatever to the grant: a refresh token still mints access tokens after the disk is
gone, and revoking it needs the credential the wipe destroyed. That is the one part of ending
the service the operator cannot do for themselves — the opposite of a service obligation.

**9. The 27-file shared chain is NOT compressed.** See the rejected option below.

## What this ADR said first, and why it changed

Kept because the corrections are the useful part, and each was found by writing a test or by
the owner asking a better question — none by reading more carefully.

**"The baseline's billing DDL has to stay, because `offboarding.ts` is shared and reached by
the appliance's own `forget-me`."** Wrong where it mattered. The appliance *loads* the module
— the ledger index re-exported it — and never executes a line. `purgeTenant` has one caller,
in the worker. Combined with the owner's "no one uses this solution live", both reasons for
leaving the DDL alone evaporated, and the honest move was to take it out.

**"`tenant.pricing` must stay, because a second declaration of `tenant` would leave the drift
guard checking whichever it found first."** True, and beside the point. I had weighed
*declare it twice* against *leave it* and missed *do not have the column*. The owner asked the
question that surfaced it.

**"A shared `schema_migrations` would make the appliance refuse to boot."** Not what happens.
`0001_the_managed_service.sql` sorts BELOW `0027_...`, so the managed chain is what refuses,
immediately. The correct statement is worse: **the two chains' versions were never ordered
against each other**, so one ledger has the downgrade guard comparing numbers with nothing in
common, and which side breaks is an accident of how somebody named a file. Rename it `0100_`
and it *is* the appliance, at boot, on a machine that never downgraded anything.
`two-chains.unit.test.ts` runs that mistake and pins what it does.

## This is a pre-release schema break, and the upgrade gate said so

Removing the four tables from `0001_baseline.sql` edits a migration `v0.1.0-rc.1` already
shipped, so the N-1 → N upgrade gate failed — correctly. A database upgraded from that tag
KEEPS `invoice`, `payment_method`, `usage_metric` and `tenant_member`, empty, while a fresh
install at HEAD never has them.

**There is deliberately no migration that drops them.** It would have to live in the SHARED
chain, because the appliance is the deployment we want rid of them on and it applies no other
chain — and the managed edition applies that same chain, where `invoice` is not an empty table
but the tax record we are legally required to keep. The managed chain would then
`CREATE TABLE IF NOT EXISTS` a fresh empty one behind it. **A migration that destroys invoices
to tidy four tables off an appliance is not a trade worth making**, and it would sit in the
chain for ever.

The remedy is the one `migrate.ts` already prescribes for a squash: recreate the database. The
ledger is a rebuildable cache (ADR-0020), and a pre-release schema break is fixed by dropping
it, not by migrating through it. Left alone, the leftovers are four empty tables an appliance
never reads.

**`v0.1.0-rc.1` is a release candidate with no known installs, which is the only reason that
shrug is acceptable** — the same shrug after a real release would not be. So the gate does not
merely tolerate the difference: `MOVED_TO_MANAGED_CHAIN` names the four tables with their
reason, an upgraded database may carry **those and nothing else**, it may never LACK anything a
fresh install has, and a declaration that has stopped covering anything fails its own test.

## Rejected: compressing the shared chain

With zero installs the 27 files could collapse into one clean baseline, and the temptation is
real — the chain still carries a migration that repairs data no deployment ever had.

The reason not to is testable. **The repo's schema guards compare column NAMES, count
policies against a floor, and check `app_user`'s grants. Nothing compares RLS policy
definitions.** A 2,580-line baseline rewrite that silently drops one `USING` clause is a
tenant-isolation bug that every current test passes. The migration comments are also the best
surviving explanation of why several columns exist, and compression either deletes them or
moves them somewhere they will rot.

The targeted split carries a different risk profile and that is why it was acceptable: 47
objects, four tables, and `force-rls` plus the grant test are generic catalogue queries that
cover whatever is present rather than a hand-written list.

If the chain is ever to be compressed, the honest order is: add a guard that compares policy
definitions and per-role grants, prove it fails on a dropped `USING` clause, then compress
under it.

## Consequences

**The worry becomes a failing test.** "The appliance should stay focused" was a feeling that
could only be checked by reading. It is now a set of assertions that fail by name, including
two that ask a real database what the shared chain built.

**Two repositories get easier, not harder.** Both parked options need a line drawn between
shared and managed. That line now exists, is enforced, and was drawn while both editions still
build and test together — the cheapest time to draw it. If the split never happens nothing has
been wasted; if it does, `packages/managed`, `apps/api`'s billing routes and
`packages/managed/migrations` are the extraction boundary, already separated.

**Apache-2.0 is untouched.** Nothing here changes what is licensed or published. A package
boundary is not a licence boundary, and this ADR must not be read as a first step toward
closing anything — that decision is the parked one, and remains open.

**The appliance creates seven fewer tables and four fewer columns, and ships ~11.5 KB less
JavaScript.** The smallest consequence on this list, and the only one anybody notices by
looking.

**Two guards got weaker before they got stronger, and the shape recurs.** Moving the tables
silently removed them from the schema/migration drift guard — its "undeclared column"
direction skips any table the ORM does not model, so losing five tables looked exactly like
success. **A guard that iterates over one module or applies one chain stops covering whatever
leaves it, and does not say so.** Both now read both modules and apply both chains, and fail
by name if either drops out.

**A splitting script beat a search-and-replace, twice over.** The baseline was cut on
pg_dump's own object headers because `payment_method` is also a COLUMN of `invoice`. That
rule alone still missed seven objects: index headers are named `ix_invoice_status`, one word,
matching no table name — so a second rule reads each statement's `ON public.<table>`. Without
it the shared chain would have kept seven indexes pointing at tables it no longer creates.
