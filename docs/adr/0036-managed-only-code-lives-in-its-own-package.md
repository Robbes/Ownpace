# ADR-0036: Money lives in its own package, and the appliance cannot reach it

- **Status:** Accepted 2026-08-19 — owner decision ("do the path 1 now"), taken as the
  cheapest and most reversible of three options for the managed/self-host split. The other
  two — an open-core split into two repositories, and a private monorepo with a filtered
  public mirror — are **explicitly parked**, not rejected. This ADR is deliberately written
  so that neither is made harder by it.
- **Date:** 2026-08-19
- **Deciders:** owner
- **Relates to:** [ADR-0003](./0003-two-editions-one-core.md) (two editions from one core —
  this is that decision's boundary, drawn where it had never actually been drawn),
  [ADR-0009](./0009-repo-strategy-public-monorepo.md) (public monorepo — unchanged),
  [ADR-0014](./0014-cost-recovery-billing.md) (what the moved code computes),
  [ADR-0001](./0001-license-apache-2.0.md) (Apache-2.0 — unchanged, and see Consequences),
  AGENTS.md hard rule 5 (the editions must not differ), hard rule 2 (never delete from
  source).

## Context

ADR-0003 says two editions come from one core. It does not say where the core stops, and
nothing enforced a stopping point, so over time it stopped in different places depending on
what was convenient.

The appliance's entrypoint imports `@openmig/shared` and `@openmig/ledger`. Both of them
re-exported billing:

| what | where it was | what the appliance got |
|---|---|---|
| `pricing.ts` — the operator's price list, VAT, integer-cent arithmetic | `@openmig/shared` | the price list of a service its owner is not a customer of |
| `tenant-pricing.ts` — a tenant's agreed rates, pinned on first use | `@openmig/ledger` | a function that would pin a price for an appliance with no customers |
| `usage-metering.ts` — the metered rows an invoice is built from | `@openmig/ledger` | a writer for a table it never reads |
| `invoice`, `payment_method`, `usage_metric` tables | `@openmig/ledger`'s `schema-pg.ts` | typed handles on three tables that are always empty |
| `pages/Billing.tsx` + its Mollie-shaped API client | `apps/web`, statically imported | 11.5 KB of payment UI in every appliance bundle |

None of it ever *ran* on the appliance. `ManagedOnly` redirects the billing route, and no
appliance code path calls a pricing function. That is exactly why it survived: every test
was green, and a rule nothing enforces is a habit, not a rule.

**The guard that should have caught it did not, and its reason is worth recording.**
`apps/selfhost/src/no-managed-leakage.unit.test.ts` walks the appliance's real transitive
import graph and fails on forbidden specifiers. Its forbidden list was `@trigger.dev`,
`mollie`, and the word `billing`. The modules above are called `pricing`, `tenant-pricing`
and `usage-metering`. A rule written against the word "billing" catches whatever happens to
be named after the invoice, not what happens to be about money — and it passed, for as long
as they existed, while walking straight past them.

The owner's question that started this was not about any of these files. It was: *would a
monorepo holding both editions leave the appliance contaminated with managed concerns?* The
measurement says the shared packages are 64% of the tree and the managed-only apps 15%, so
the ratio was never the problem. The absence of an enforced boundary was.

## Decision

**1. Managed-only code lives in `@openmig/billing`, which the appliance may not import.**
`pricing.ts`, `tenant-pricing.ts`, `usage-metering.ts` and the three billing tables move
there. Only `apps/api` and `apps/worker` depend on it.

**2. The split is by who is being charged, not by subject matter.** A price list, a tenant's
agreed rates, metered rows and an invoice all belong to an operator with customers. An
appliance has an owner, not customers, and every one of those modules would compute zero for
it — which is the tell that it should not have been carrying them.

**3. The rule is enforced by a walk, not by review.** `no-managed-leakage` now forbids
pricing and metering specifiers as well as billing ones, and gains the half it never had:
the appliance's reachable graph declares no managed-only **table**, and the one managed-only
**column** it still carries is named with the reason it is allowed to be there.

**4. The appliance's bundle is asserted by building it.** `AppRoutes` loads Billing through a
dynamic import behind a comparison against a literal Vite bakes in, so the self-host build
folds the branch away and no chunk is emitted. That is invisible in a diff — `isSelfHost()`
would be correct at runtime and useless here, because a function call is opaque to the
bundler — so the test builds **both** editions in memory and requires every billing marker to
be present on managed and absent on self-host.

**5. Two things deliberately do not move, and are recorded rather than tidied.**

- **`tenant.pricing`.** A table is declared in one place. Splitting one nullable jsonb column
  into a second declaration of `tenant` would leave the schema/migration drift guard with two
  rows of that name and no way to say which one it checked — a guard that quietly checks the
  wrong thing is worse than the column. The logic left; the column stays beside its table,
  and is named in an allow-list so it cannot acquire company without a test failing.

- **The DDL.** `0001_baseline.sql` creates `invoice`, `payment_method` and `usage_metric`, and
  every install has applied it. `offboarding.ts` — shared, and reached by the appliance's own
  `forget-me` — issues raw SQL against `invoice` to detach it at erasure, so the table has to
  exist there. Dropping them on the appliance would be a **destructive migration against hard
  rule 2, to reclaim three permanently empty tables, at the cost of breaking an erasure path
  that works today.** They stay, inert. What changed is that no shared code can name them.

**6. Managed-only DDL added from here on goes in a managed-only migration chain.** No such
chain exists yet, and none is created by this ADR: `runMigrations` already takes a
`migrationsDir`, but two chains sharing one `schema_migrations` table would break its
downgrade guard, and building that mechanism before there is a table to put in it would be
speculation. The rule is recorded so the next managed table is the one that builds it, rather
than the fourth one to be quietly added to the baseline's chain.

## Consequences

**The owner's worry becomes a failing test.** "The appliance should stay focused" was a
feeling that could only be checked by reading. It is now four assertions that fail by name,
with the reason in the message.

**Two repositories get easier, not harder.** The parked options both need a line drawn
between what is shared and what is managed. That line now exists, is enforced, and was drawn
while both editions still build and test together — which is the cheapest time to draw it. If
the split never happens, nothing has been wasted; if it does, `packages/billing` and
`apps/api`'s billing routes are the extraction boundary, already separated.

**Apache-2.0 is untouched.** Nothing here changes what is licensed or published. A package
boundary is not a licence boundary, and this ADR should not be read as a first step toward
closing anything — that decision is the parked one, and remains open.

**The appliance ships ~11.5 KB less JavaScript**, which is the smallest consequence on this
list and the only one anybody will notice by looking.

**One guard got weaker before it got stronger, and the shape is worth remembering.** Moving
the three tables silently removed them from the schema/migration drift guard: its "undeclared
column" direction skips any table the ORM does not model, so losing three tables looked
exactly like success. It now reads both schema modules and fails by name if either drops out.
**A guard that iterates over one module is a guard that stops covering whatever leaves it**,
and it will not tell you.
