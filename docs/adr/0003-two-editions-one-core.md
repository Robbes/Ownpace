# ADR-0003: Two editions from one core (self-host + managed)

- **Status:** Accepted
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- One codebase, two editions; **only the control plane differs** (orchestration, state, tenancy, secrets, auth, provisioning, billing).
- Shared code must not depend on managed-only services — the boundary is drawn and enforced by ADR-0036's walk.
- Migration behavior and idempotency are identical across editions.

## Context
Audience spans a self-hosting hobbyist (NAS/Pi/Spark, possibly single-user) and customers without a server who need a managed service.

## Decision
Ship **one codebase** with two editions. Only the control-plane differs: orchestration, state, tenancy, secrets, auth, provisioning, billing. The migration core, connectors, engines, and UI are identical. See solution-architecture.md section 7.3.

## Consequences
- Identical migration behavior and idempotency across editions.
- Shared code must not hard-depend on managed-only services.
- Clear interfaces (`Scheduler`, `TargetProvisioner`) isolate the differences.

## Alternatives considered
- Separate products: rejected — duplicate logic, divergent behavior.
