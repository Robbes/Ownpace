# Contributing

## Getting started

You need **Node 24+** and **pnpm**. That is all `pnpm test` needs. The integration and
e2e tiers also need Docker: Testcontainers brings up its own Postgres, Nextcloud and
Stalwart, so there is no stack to install first.

```bash
pnpm install
pnpm test          # unit + component. No Docker needed, ~90s.
```

That is enough to make and verify most changes. For the rest:

- **Every command** — lint, typecheck, integration, e2e, the optional dev stack —
  is listed once in [AGENTS.md's Commands section](./AGENTS.md#commands). It is
  written for coding agents but the commands are the same ones humans run.
- **Running the product**, either edition, is in the
  README's [Get it](./README.md#get-it-released-artifacts) (released builds) and
  [Quickstart](./README.md#quickstart-from-source) (from source).
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

### If CI fails on `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`

Dependencies must be **three days old** before this repository installs them — a cooldown
over the window in which a compromised release is published, installed and then yanked. The
error names the package and when it was published. Usually the right answer is to **wait and
re-run**: the check only gets easier with time, so the pull request goes green on its own
within three days, with no change. Take a younger release only when you need it now — a
security fix, typically — by adding `name@version` to `minimumReleaseAgeExclude` in the same
pull request, with a reason. The full rule, and why the number is what it is, is in
[`pnpm-workspace.yaml`](./pnpm-workspace.yaml) beside the setting itself.

## Documentation lives in `docs/`
All documentation goes under `docs/`. The **only** Markdown files allowed in the repo root are:

`README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, `TRADEMARK.md`

(`LICENSE` has no extension.) Anything else — design, guides, runbooks, notes — belongs in `docs/`. The `docs-hygiene` job in `.github/workflows/ci.yml` enforces this allowlist.

Workspace packages use the npm scope `@openmig/*`, the database role is `openmigrate` and metrics
carry the `openmigrate_*` prefix. This is deliberate: ADR-0040 renames what is named after the
product and keeps what is named after the scope.

## Architecture Decision Records (ADRs)
Significant decisions are captured as ADRs in `docs/adr/`.
- Copy `docs/adr/0000-template.md` to the next number, e.g. `0011-my-decision.md`.
- Status flow: Proposed -> Accepted -> (later) Superseded by `00xx`.
- Keep them short (about one page): Context, Decision, Consequences, Alternatives.
- **Every ADR carries an `## Operative rules` section** (ADR-0038): 3–8 terse bullets
  stating what holds now, amended **in place** when a later decision changes them — the
  rest of the file stays append-only. After amending, regenerate the assembled view:
  `node scripts/adr-operative.mjs --write` (a unit test fails any drift). Readers load
  `docs/adr/OPERATIVE.md`; the register (`docs/adr/README.md`) carries statuses only.
- Reference the ADR id from code/PRs when relevant.

## Commits & branches
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`...).
- Short-lived feature branches; PRs into `main`; CI green before merge.

## Code
- TypeScript, pnpm workspaces. Apache-2.0 license header on source files.
- Keep `packages/` (except `packages/managed`, the one managed-only package — ADR-0036) and `apps/selfhost` free of managed-only hard dependencies (self-host must work).
- Add/keep tests; idempotency and non-destructive invariants are mandatory (see AGENTS.md).

## Secrets
Never commit secrets. Use `.env` (gitignored; templates in `.env.example`, `deploy/compose/managed.env.example`
and `deploy/selfhost/selfhost.env.example`). There is no vault integration today — see [SECURITY.md](./SECURITY.md).
