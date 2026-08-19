# ADR-0001: License is Apache-2.0

- **Status:** Accepted
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- The whole product is **Apache-2.0**; source headers and NOTICE conventions apply.
- No copyleft: a third party running the code as a closed SaaS is an accepted trade.

## Context
The project optimizes for maximal adoption AND being open. Copyleft (AGPL) protects "stays open" but deters commercial/MSP adoption.

## Decision
License the whole product under **Apache-2.0** (OSI-approved, permissive, includes a patent grant).

## Consequences
- Maximizes adoption; MSPs/communities and commercial users can build on and host it.
- No copyleft protection: a third party may run the code as a closed SaaS (accepted trade-off).
- Apache-2.0 source headers + NOTICE conventions apply.

## Alternatives considered
- AGPL-3.0: rejected — would limit the "maximal use" goal.
- MIT: viable but lacks the explicit patent grant.
