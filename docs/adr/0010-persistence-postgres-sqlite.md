# ADR-0010: Persistence — Postgres+RLS (managed) / SQLite or small Postgres (self-host)

- **Status:** Accepted; **partially superseded by [ADR-0023](0023-persistence-postgres-only.md)** (2026-07-16) — the SQLite / dual-backend option is dropped; both editions now use Postgres (self-host bundles a small Postgres). The Postgres+RLS-for-managed decision below still stands.
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- Only **Postgres + RLS for the managed edition** survives from this ADR.
- The SQLite/dual-backend half is superseded: ADR-0023 made Postgres the only dialect; ADR-0028 added the PGlite engine for the appliance behind the `LedgerDriver` seam.

## Context
The ledger and control-plane need durable storage in both editions, with multi-tenant isolation in the managed service.

## Decision
**Managed:** managed **Postgres with Row-Level Security** (per-tenant isolation). **Self-host:** **SQLite** (single-user, lightest) or a small **Postgres** container. Same ledger schema contract; migrations versioned (tool TBD: e.g., drizzle/atlas/prisma).

## Consequences
- One schema, two backends; behavior identical.
- RLS provides tenant isolation in managed.
- SQLite keeps self-host viable on a Pi.

## Alternatives considered
- Postgres everywhere: heavier for single-user self-host.
