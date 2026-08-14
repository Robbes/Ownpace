# `@openmig/core`

**The behaviour.** Where `@openmig/shared` holds the types and pure functions, this package
holds what the product actually *does*: the reconcile loop, the per-domain sync, verification,
discovery and the gated deletion path.

Its only **runtime** dependency is `@openmig/shared`. `connectors`, `engines` and `ledger` are
devDependencies — its tests exercise real implementations, but the shipped code depends on the
interfaces in `shared/ports.ts` rather than on any concrete adapter. That is what lets one
reconcile loop serve both editions.

## What lives here

- **The loop** — `reconcile.ts`, `domain-sync.ts`, `dav-sync.ts`, `reindex.ts`.
- **The gates** — `verification.ts` and `verification-implementations.ts`, `apply-deletion.ts`
  (the one destructive path, ADR-0024), `cutover-state.ts`.
- **Discovery** — `discovery.ts`, `detect-new-mailboxes.ts`, `run-group-discovery.ts`,
  `classify-shared-address.ts`, `mapping-coverage.ts`, `mapping-pattern.ts`.
- **Secrets at rest** — `secrets.ts`, `secret-store.ts` (AES-GCM; the envelope every stored
  credential goes through).
- **Permissions and reporting** — `permission-map.ts`, `permission-report.ts`,
  `run-permission-inventory.ts`, `group-runbook.ts`.
- **DNS, read-only** — `dns-verify-only.ts`. The write path was deleted on 2026-08-05; the
  product's DNS posture is verify-only by owner decision.

## The boundary with `@openmig/shared`, stated so it stops being folklore

| | `shared` | `core` |
|---|---|---|
| Workspace dependencies | **none** — it is the leaf | `shared` at runtime |
| Contains | types, contracts, pure functions | behaviour, orchestration, I/O through ports |
| Depended on by | all eleven packages and apps | `ledger`, `api`, `selfhost`, `worker` |

The test: **could this module be imported by a package that knows nothing about migrating
anything?** If yes it is `shared`; if it encodes how a migration proceeds, it is `core`.

## Hard rules that bite here

Two of the repository's hard rules are implemented in this package rather than merely observed
by it: **re-runs converge** (`reconcile.ts` keys on the natural key and adopts rather than
duplicating) and **nothing is destructive** except `apply-deletion.ts`, which is explicitly
gated. A change here that cannot show it preserves both will be sent back — see
[`docs/testing.md`](../../docs/testing.md) for the idempotency property and where it is asserted.
