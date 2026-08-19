# AGENTS.md

Agent guidance for this repo (Claude Code via `CLAUDE.md` pointer, OpenHands, others). **Read `docs/architecture/solution-architecture.md` first — the source of truth.** This file is the operational contract. Detail lives in the docs it points to (progressive disclosure), not here.

Before any Stalwart or integration-test work: read `docs/stalwart-integration-fix.md` in full and do not deviate (decisions in ADR-0022). Never change the pinned Stalwart version; never put accounts/domains/listeners in config.json; never skip the shadow-pass tests.

## Session protocol (mandatory)
1. **Start:** read the arch doc, then the active workplan in `docs/workplans/` — its top **Status block** is ground truth for done/open. Trust it; never redo completed tasks.
2. **Plan:** create a task-tracker list before coding; keep it updated. Parallel subagents may do read-only audits; conclusions still need quoted evidence.
3. **Evidence-first:** never claim something works without pasting proof (test run, logs, wire dialogue). Quote errors verbatim before proposing fixes.
4. **Docker hygiene:** manual debug `docker run` uses `--rm` or is removed before session end.
   One Stalwart container per data volume, ever (RocksDB lock). At end:
   `docker ps -a | grep -i stalwart` + `docker volume ls | grep -i stalwart`, remove your debris.
5. **End:** update the workplan Status block with what you proved; commit docs with code; all gates green.

## Commands
- Install: `pnpm install` · Lint: `pnpm lint` · Typecheck: `pnpm typecheck`
- **The toolchain runs two TypeScripts on purpose.** `tsc` is TypeScript 7 (the Go
  port) and does every type check; `tsc6` is TypeScript 6 and exists only for
  `pnpm typecheck:legacy`, a second opinion when 7 says something surprising.
  In `package.json` this reads as `"typescript": "npm:@typescript/typescript6"`
  and `"@typescript/native": "npm:typescript@7"` — deliberately crossed, not a
  mistake. TypeScript 7.0 ships **no programmatic API**, and typescript-eslint
  imports one, so the package NAME `typescript` has to keep resolving to a 6.x
  API or ESLint stops working. Nine installed packages depend on that name: the
  seven `@typescript-eslint/*`, `ts-api-utils`, and `typescript-eslint`.
  **Remove the split** once typescript-eslint ships a release whose peer range
  admits TypeScript 7 — today's is `>=4.8.4 <6.1.0`, and the work is tracked in
  [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)
  (TS 7.1 is the release expected to restore the API). Then `typescript` goes
  back to plain `typescript@7` and `typecheck:legacy` goes away.
  `scripts/toolchain-split.unit.test.ts` guards the arrangement and should be
  deleted in the same change.
- **`pnpm lint` is type-aware, and cached.** Two rules need a real TS Program —
  `no-floating-promises` and `no-misused-promises` — so a COLD lint is ~47s and a
  warm one ~2.4s. Do not drop `--cache --cache-strategy content` from the script
  to "simplify" it: `--cache` alone keys on mtime, which every checkout
  invalidates. The type-aware block is scoped to the globs a tsconfig actually
  covers; `test/`, `scripts/` and root-level `.ts` are in no `include` and are
  therefore neither typechecked nor type-linted (29 real type errors are waiting
  there whenever someone widens it).
- Unit: `pnpm test` · Integration: `pnpm test:integration` (self-manages its stack via Testcontainers) · UI smoke: `pnpm test:ui` (real Chromium over the built bundle; runs on every PR) · E2E: `pnpm test:e2e`
- Optional dev stack: `docker compose -f deploy/compose/dev.yml up -d` (Postgres + Nextcloud).
  Stalwart isn't part of it — its two-phase startup can't be expressed as one compose service —
  bring it up with `deploy/selfhost/setup-stalwart.sh` instead.

## What we are building
Sovereign migration/sync: families and SMBs move off US cloud (O365/Google/Dropbox) to EU targets. **JMAP is the primary target protocol** (Stalwart reference; mosa.cloud / La Suite / MijnBureau); **IMAP/CalDAV/CardDAV/WebDAV is the parallel second family** (Soverin, openDesk,
Nextcloud) — both in MVP (ADR-0018). The **O365 source stays IMAP+OAuth2/Graph**. Migration is idempotent, shadow-runs as long as the user wants, and the user stays in control via the UI.

## Decided stack (details in the ADRs — follow them, don't re-decide)
- TypeScript, Node 24, pnpm workspaces monorepo (ADR-0002); Apache-2.0 (ADR-0001).
- `Scheduler` interface: in-process croner (self-host) / Trigger.dev (managed) (ADR-0004).
- Ledger: **Postgres everywhere** — managed Postgres+RLS (managed) / bundled small Postgres (self-host), one schema (ADR-0016, **ADR-0023** supersedes the SQLite option in ADR-0010); migrations via Drizzle Kit + Atlas lint (ADR-0017). **No SQLite** — do not reintroduce a second dialect.
- Engines: **JS-native, all of them. No Perl, no Python, no external binaries.** JMAP writer (jmap-jam) for JMAP; `imapflow` for IMAP; `webdav`/`ical.js` for DAV. The imapsync/vdirsyncer/rclone shell-outs this line used to name are **gone** — see ADR-0019's update note, "there are no shell-out engines left", and ADR-0007's status line (ADR-0007/0018/0019).
- O365: one multi-tenant Entra app; IMAP+OAuth2 primary, Graph fallback (ADR-0006).
- Target provisioning: RETRACTED (ADR-0008, owner decision 2026-08-02) — the owner supplies existing-account credentials; provisioning guidance lives in docs, not an interface.

## Repo map (top level; don't trust paths blindly — verify before editing)
- `docs/` — all documentation: `architecture/` (source of truth), `adr/`, `workplans/` (Status blocks), canonical docs incl. `stalwart-integration-fix.md`, `testing.md`.
- `packages/` — `core` (reconcile+idempotency), `ledger`, `connectors`, `engines`, `scheduler`, `shared`, `testing`, and `managed` — **the one managed-only package** (ADR-0036). Everything else here is loaded by both editions; `managed` is loaded by `apps/api` and `apps/worker` and by nothing the appliance runs. It carries its own `migrations/` too: the appliance applies `packages/ledger/migrations` only, which is why it has no `invoice`, `tenant_member` or `erasure_record` table.
- `apps/` — `api`, `web`, `worker`, `selfhost`.
- `deploy/` — `compose/` (managed control plane, plus the dev/CI stacks) and `selfhost/` (appliance compose, PGlite and drill overrides). There is no `helm/` or `homeassistant/`; this line named both until 2026-08-13 and neither has ever existed.
- `test/` — `e2e/` and `ui/` only. **Integration tests colocate with their source** under `packages/`/`apps/`, as do unit tests; `test/` is for the two tiers that belong to no single package. (`test/fixtures/` and `test/integration/` were empty scaffolds and are gone.)

## Hard rules (each "don't" has its "do")
1. **Idempotency is sacred.** Re-runs converge: no duplicates, no corruption. Keep the idempotency property tests green; extend them with new behavior.
2. **Non-destructive by default.** Never auto-delete/overwrite on the target; surface source deletions as user decisions (arch doc §11.1).
3. **No secrets in the repo.** Use `.env` (gitignored) / vault refs; never in code, tests, fixtures, or ADRs.
4. **Respect provider limits.** Honor 429/`Retry-After`; keep per-tenant/provider concurrency budgets.
5. **Self-host must keep working.** No managed-only dependency in `packages/` or `apps/selfhost`; orchestration stays behind `Scheduler`. **The one exception is `packages/managed`, which IS managed-only and is named as such** (ADR-0036) — it exists so that everything presuming a CUSTOMER (prices, invoices, seats, closing an account, erasure receipts) has somewhere to live that is not `shared` or `ledger`. Its DDL goes in `packages/managed/migrations`, never the shared chain. The rule is enforced, not remembered: `apps/selfhost/src/no-managed-leakage.unit.test.ts` walks the appliance's real import graph, and it passed for as long as billing lived in the shared packages because its forbidden list said "billing" while the modules were called `pricing`, `usage-metering` and `offboarding`. **Managed-only code that is not named after an invoice still belongs in `packages/managed` or an `apps/` managed app** — add the specifier to that guard when you add the code, and a managed thing hanging off a core table becomes a ROW of its own, never a column.
6. **Docs discipline.** `docs/` is the only home for documentation; keep the root `.md` allowlist (CONTRIBUTING.md); Apache-2.0 headers on source files.
7. **Decisions → ADRs** (append-only; supersede, don't delete). Operational findings → a Rule + one-line rationale in the relevant reference doc (e.g. the Stalwart fix doc).
8. **Gates before "done":** lint + typecheck + unit + relevant integration; update docs.
9. **Never mask errors.** No null-fallbacks or catch-and-continue that turn failures into empty results (`scanned=0` must be unreachable via a swallowed error) — unmask, quote, fix the root cause. Connector (IMAP/JMAP) failures must surface.

## Safety notes
- The test O365 source is a **real SMB tenant**: read-only, least-privilege, never write back.
- The Spark arm64 runner has docker socket + root: trusted workflows only; build multi-arch (amd64+arm64) images.
- **Running as an agent inside its own container (Docker-outside-of-Docker, e.g. OpenHands with a
  mounted `docker.sock`)?** Containers you start are siblings on the *host's* daemon, not nested —
  `localhost` inside your container is not the host's `localhost`. See
  `docs/stalwart-integration-fix.md` "Running from inside a sandboxed agent container" before
  concluding a Docker/port failure is a bug here.

## Skills (all agents)
Agent-neutral, reusable skills live in `.agents/skills/` — currently `caveman.md` (ultra-terse
output mode). Activate one only when the user asks for it by name (e.g. "caveman mode");
read the file and follow it for the rest of the session.

## Prompts for other agent sessions
Inline all code/commands/paths as backtick inline code within prose — no separate fenced blocks —
so the whole prompt is one copy-pasteable unit.

## Definition of done
Gates green · docs updated · workplan Status block updated · ADR if a decision changed ·
no secrets · idempotency + non-destructive intact · self-host intact · no docker debris.