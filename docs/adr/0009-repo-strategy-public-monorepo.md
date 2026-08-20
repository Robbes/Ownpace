# ADR-0009: Public Apache-2.0 monorepo; ops/secrets private

- **Status:** Accepted — **amended 2026-08-19 by [ADR-0039](./0039-no-open-core-and-what-ops-privacy-means.md)**: "no open-core" reaffirmed and the question closed with a revisit trigger; the "private ops/IaC" clause corrected (the recipe is public by design).
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- One **public Apache-2.0 monorepo** with the whole product.
- **"No open-core"** stands and the question is **CLOSED** — [ADR-0039](./0039-no-open-core-and-what-ops-privacy-means.md) resolved this against ADR-0036's "remains open" and named the three-part revisit trigger. The prior conflict flag is retired.
- Private is **secrets, instance facts, tenant data, billing keys and NDA integrations — NOT the deployment recipe.** ADR-0039 corrected this rule: `deploy/` is public by design (it is how an MSP runs their own managed instance); instance facts ride env vars and repository variables; secrets are gitignored.

## Context
Maximal use + open. Avoid leaking secrets or business operations.

## Decision
One **public Apache-2.0 monorepo** containing the whole product (core, both editions incl. the multi-tenant control-plane, UI, deploy, docs, tests). **Private** only: secrets/credentials (vault, never git), our operational deployment/IaC, tenant/customer data, billing keys, and any NDA partner integrations. **No open-core.**

## Consequences
- MSPs/communities can run their own managed instance.
- Secrets hygiene enforced via `.gitignore` + `.env.example` + vault.
- Self-hosted CI runner runs trusted workflows only.

## Alternatives considered
- Open-core (private multi-tenant features): rejected — conflicts with maximal-use.
