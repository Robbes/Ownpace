# ADR-0009: Public Apache-2.0 monorepo; ops/secrets private

- **Status:** Accepted
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- One **public Apache-2.0 monorepo** with the whole product; private only: secrets, our ops/IaC, tenant data, billing keys, NDA integrations.
- This ADR says **"No open-core."** ⚠ **CONFLICT:** ADR-0036 (also Accepted) parks an open-core split as an option that "remains open". Which statement governs is an **owner decision still pending** — do not act on either reading without it.

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
