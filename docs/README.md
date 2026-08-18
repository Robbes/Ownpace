# Documentation

All project documentation lives here.

- **`architecture/solution-architecture.md`** — the source of truth. Read this first.
- **`adr/`** — Architecture Decision Records. `0000-template.md` is the template; decisions are
  numbered and append-only (supersede, don't delete).
- **`workplans/`** — numbered build slices (one vertical slice per plan). Each workplan carries a
  **Status block** at the top that agents must keep current at session end; it is the single place
  to see what is done, in flight, or open for that slice.
- **`design/`** — design proposals and per-task ground-truth reports that back the workplans
  (e.g. `domain-sync.md`, `migration-status.md`, the `0011-t*` analyses). These are working
  documents; once a task lands, its outcome is captured in the workplan Status block and the
  design note is kept for the reasoning trail.
- **`stalwart-integration-fix.md`** — the authoritative operational reference for the Stalwart
  v0.16 Testcontainers setup (two-phase startup, provisioning, TLS-only listeners, hard-won rules).
  Read it before touching anything Stalwart-related; do not re-litigate its settled findings.
- **`testing.md`** — canonical testing doc (pyramid, how to run, CI mapping).
- **`deployment.md`** — canonical deployment doc (editions, dev/e2e stack, release controls).
- **`performance.md`** — performance levers and guardrails (do not optimize speculatively).

Operational how-tos already live at the docs root: the runbooks (`operator-runbook.md`,
`cutover-runbook.md`, `selfhost-quickstart.md`, `managed-bring-up.md` (standing the
managed edition up on a new machine — the executable half is
`deploy/compose/bootstrap-managed.sh`), `windows-appliance-runbook.md`,
`release.md`, `test-tenant.md`, `TROUBLESHOOTING.md`), connector guides
(`dav-sync.md` — CalDAV, CardDAV and WebDAV in one), `o365-setup.md`,
`o365-application-access.md` (the admin-consent + Application Access Policy steps
that let the source read a mailbox other than the signed-in user's) and
`shared-mailboxes.md` (SAD §14.1 Pattern S: how a shared mailbox becomes an
ordinary mapping, and why a distribution list cannot be one), `dns-management.md`,
`rls-guide.md`, `rollback-mechanisms.md`, `target-providers.md`,
`desec-provider-assessment.md`, `i18n-prose-boundary.md` (what the bilingual
UI may and may not translate, per prose class — read it before adding
user-facing strings), the cutover comms templates
(`cutover-communication-templates.md`), and the one-off audit note
`test-fixture-uuid-collision-audit.md` (its remediation shipped as the
`fixture-uuid-check` CI job). A dedicated `guides/` / `runbooks/` split can come later if
the root grows unwieldy; don't add empty placeholder directories.

Historical notes are banner-marked in place rather than deleted (workplan/ADR policy): e.g.
`unified-sync.md` (⚠️ superseded by `design/domain-sync.md`), `dav-integration-status.md`
(📄 resolved in 0007), `caldav-sync.md` / `carddav-sync.md` / `webdav-sync.md`
(⚠️ merged into `dav-sync.md`, 2026-07-27), and `imapsync-bulk-sync.md`
(⚠️ withdrawn 2026-07-30 — the wrapper it documents was unused and is deleted).

## Root Markdown allowlist
To keep the repo root clean, only these `.md` files are allowed there:
`README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`.
Everything else is documentation and belongs in `docs/`.
