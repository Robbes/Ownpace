# ADR-0017: Migration tooling — Drizzle Kit (+ Atlas lint), not Liquibase

- **Status:** Accepted
- **Date:** 2026-06-20

> **Update 2026-08-02 (workplan 0021 T5, owner decision: keep + build).** The
> Atlas lint bullet was the one promise here with no code behind it — every
> migration to date had been reviewed by eye only. It is now real: the
> `migration-lint` CI job (`ci.yml`) installs the Atlas community binary and
> replays the whole `packages/ledger/migrations` directory against a
> disposable dockerized Postgres, failing on destructive changes; it runs
> whenever the migration directory changes. `atlas.sum` is generated in-job,
> not committed. Also note: this ADR's SQLite half was superseded by ADR-0023
> (Postgres-only, both editions) — Drizzle Kit + the startup lock runner and
> the newer-schema refusal guard are all real (`packages/ledger/src/migrate.ts`).

## Context
We need schema **and** data migrations for both PostgreSQL (managed) and SQLite (self-host) in a TypeScript/Node stack; the self-host edition runs on small hardware (Pi/NAS). Liquibase and Flyway are mature and DB-agnostic but JVM-based.

## Decision
- **Author and apply** migrations with **Drizzle Kit** (TS-native, supports PostgreSQL and SQLite, matches the chosen Drizzle ORM). SQL lives in `packages/ledger/migrations`.
- **Lint** migrations in CI with **Atlas** (single Go binary, multi-arch) for destructive-change detection and multi-dialect verification.
- **Data migrations** are versioned with the schema change, **idempotent**, **batched** for the large `item` table, using **expand-contract** for backward compatibility.
- Migrations **run on startup behind a lock** (Postgres advisory lock / SQLite file lock); the app **refuses to start if the schema is newer than it supports**.
- **Do not use Liquibase/Flyway** — JVM weight conflicts with a Node stack and Pi/NAS self-host.

## Consequences
- No JVM dependency; one toolchain for both backends; small footprint for self-host.
- Rollback is **roll-forward-preferred** (down-migrations only where cheap) — accepted; mitigated by DB backups and feature flags.
- Atlas adds a CI safety net against accidental destructive changes.

## Alternatives considered
- Liquibase / Flyway (rich rollback, contexts): rejected — JVM weight.
- dbmate (Go, multi-DB SQL): viable, but Drizzle Kit already aligns with the ORM.
- Raw SQL only: rejected — no linting/safety net.
