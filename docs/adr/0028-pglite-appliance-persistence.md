# ADR-0028: PGlite as the appliance's embedded persistence (amends ADR-0023)

- **Status:** Accepted (2026-08-01, recording a decision executed in workplan 0016)
- **Amends:** [ADR-0023](./0023-persistence-postgres-only.md)
- **Context:** workplans [0016](../workplans/0016-pglite-adoption.md) (execution),
  [0015](../workplans/0015-native-windows-installer.md) (the motivating installer)

## Context

ADR-0023 chose PostgreSQL as the single ledger backend for both editions and
explicitly parked PGlite as "the reversibility path… not chosen now". That
decision was then executed the other way by workplan 0016 — the appliance can
run on PGlite with no `DATABASE_URL`, no container, no port and no `initdb` —
and no ADR recorded it. ADR-0027 already depends on the outcome ("PGlite
removed the last native dependency"). This ADR closes that gap in the record;
it does not re-decide anything.

The forcing function was ADR-0027's Windows installer: after the shell-out
engines were deleted, Postgres was the appliance's last native dependency, and
"install Postgres" is not a sentence a Windows end-user installer gets to say.

## Decision

**One dialect, two engines behind one seam.** The ledger speaks PostgreSQL —
one migration set, one Drizzle schema, one SQL surface — through a
`LedgerDriver` seam (`packages/ledger/src/driver.ts`) with two
implementations:

- `pgDriver` (node-postgres pool) — the managed edition, and the appliance's
  bundled-Postgres compose shape;
- `pgliteDriver` (`@electric-sql/pglite`, in-process WASM Postgres) — the
  appliance when `SELFHOST_PERSISTENCE=pglite`, persisting to
  `SELFHOST_PGLITE_DIR` (`deploy/selfhost/compose.pglite.yml` is the compose
  form; the packaged Windows appliance is the shape this exists for).

What keeps this honest rather than a second ADR-0010:

- **The seam carries the security posture, not just queries.**
  `LedgerDriver.role` exists because both appliance backends connect as
  owner/superuser, which Postgres exempts from RLS — without `SET LOCAL ROLE`
  to a non-owner, every policy is decoration. 0016 found RLS silently inert on
  both appliance backends and fixed it at the seam.
- **The parity matrix is real.** The full e2e gate runs per backend
  (`persistence: postgres | pglite` dispatch inputs), 46 tests each, compared
  domain-for-domain — reversing ADR-0023's "no parity-test matrix"
  consequence, which this ADR accepts as the price of the installer.
- **The managed edition is untouched.** PGlite is single-process,
  single-connection; wrong for a multi-tenant API with a worker fleet. Server
  Postgres remains the only managed backend.

**Not the default.** `deploy/selfhost/compose.yml` still ships bundled
Postgres; PGlite is opt-in. Making it the appliance default is a deliberate,
separate decision that belongs to workplan 0015 (it is the shipped-installer
posture, and the installer is 0015's deliverable).

## Consequences

- ADR-0023's decision sentence survives at the *dialect* level ("one dialect,
  one migration set, one access layer") and is amended at the *engine* level:
  there are two engines, chosen at the seam, tested as a matrix.
- Migrations must stay runnable on both engines; the migrator's advisory lock
  serializes concurrent migrators on `pg` and is trivially satisfied on
  single-process PGlite.
- Anything opening its own connection outside the seam is a bug — 0016 found
  the sync path doing exactly that (`buildDeps` refusing to open a pool in
  PGlite mode is the guard).
