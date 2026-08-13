# Contributing

## Getting started

You need **Node 24+** and **pnpm**. Nothing else — the test suite brings up its own
Postgres, Nextcloud and Stalwart via Testcontainers, so there is no stack to install
first.

```bash
pnpm install
pnpm test          # unit + component. No Docker needed, ~90s.
```

That is enough to make and verify most changes. For the rest:

- **Every command** — lint, typecheck, integration, e2e, the optional dev stack —
  is listed once in [AGENTS.md's Commands section](./AGENTS.md#commands). It is
  written for coding agents but the commands are the same ones humans run.
- **Running the product**, either edition, is in the
  [README's Quickstart](./README.md#quickstart).
- **What the thing is and why it is shaped this way**:
  [`docs/architecture/solution-architecture.md`](./docs/architecture/solution-architecture.md),
  then [`docs/adr/`](./docs/adr/) for the decisions.
- **How the test tiers differ** and which to add to:
  [`docs/testing.md`](./docs/testing.md).

Those live in one place each, on purpose. This file links to them rather than
repeating them, because a second copy of a command list is a copy that goes stale —
which is exactly what happened to the mapping example this file used to describe.

## Opening a pull request

CI must be green. Beyond that, the bar is
[AGENTS.md's Definition of done](./AGENTS.md#definition-of-done), which the pull
request template restates as a checklist so you do not have to go looking: gates
green, docs updated, workplan Status block updated, an ADR if a decision changed, no
secrets, idempotency and non-destructive behaviour intact, self-host intact, no
docker debris.

Two of those deserve emphasis because they are this project's hard rules rather than
style preferences: **a re-run must converge, never duplicate**, and **nothing is
destructive** except the explicitly gated `apply` path (ADR-0024). A change that
cannot show it preserves both will be sent back regardless of how clean it is.

## Documentation lives in `docs/`
All documentation goes under `docs/`. The **only** Markdown files allowed in the repo root are:

`README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`

(`LICENSE` has no extension.) Anything else — design, guides, runbooks, notes — belongs in `docs/`. A CI check may enforce this allowlist.

## Architecture Decision Records (ADRs)
Significant decisions are captured as ADRs in `docs/adr/`.
- Copy `docs/adr/0000-template.md` to the next number, e.g. `0011-my-decision.md`.
- Status flow: Proposed -> Accepted -> (later) Superseded by `00xx`.
- Keep them short (about one page): Context, Decision, Consequences, Alternatives.
- Reference the ADR id from code/PRs when relevant.

## Commits & branches
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`...).
- Short-lived feature branches; PRs into `main`; CI green before merge.

## Code
- TypeScript, pnpm workspaces. Apache-2.0 license header on source files.
- Keep `packages/` and `apps/selfhost` free of managed-only hard dependencies (self-host must work).
- Add/keep tests; idempotency and non-destructive invariants are mandatory (see AGENTS.md).

## Secrets
Never commit secrets. Use `.env` (gitignored, see `.env.example`) and a vault.
