# Deployment

Canonical doc. Summarises how the stack is deployed; full rationale in `architecture/solution-architecture.md` §7, §18, §22.1.

## Editions (one core)
- **Managed:** Trigger.dev (self-host or cloud) + managed Postgres (with RLS) + S3-compatible EU object storage + secrets vault (OpenBao/Infisical) + identity (Zitadel/Keycloak); IaC/GitOps (OpenTofu + Helm + Argo CD/Flux), Renovate.
- **Self-host:** Docker Compose or a Home Assistant add-on; **in-process scheduler** (no Trigger.dev); a **small bundled Postgres** (no SQLite — ADR-0023 makes both editions Postgres-only); OS keychain / age-encrypted secrets. Targets remain managed EU/CH platforms (self-hosted email is permitted but user-operated, ADR-0011).

For managed day-2 operations (start/stop, seed, backup, tenant offboarding, what the operator can and cannot see) see the **[Operator Runbook](./operator-runbook.md)**; the stack is [`deploy/compose/managed.yml`](../deploy/compose/managed.yml).

## Windows 11 & desktop tray (ADR-0019)
- **Today:** the self-host container runs on **Windows 11 via Docker Desktop + WSL2** (web UI in a browser) — no extra code. Recommended Windows path.
- **Planned (optional):** a **Tauri** system-tray app (tray icon, start-on-login, background service) wrapping the Node service + web UI — chosen over Electron for footprint/arm64. Not MVP.
- **The whole sync path is binary-free**, not just the JMAP one. All four domains run on pure-JS libraries (`imap-simple`/`node-imap`, `webdav`, `ical.js`, `undici`); the imapsync/vdirsyncer/rclone wrappers ADR-0019 kept as an option were never wired in and have been deleted. No Perl, no Python, no external binaries.
- What a **native** Windows build would still have to answer for is therefore **Postgres**, not imapsync: ADR-0023 makes both editions Postgres-only, so a no-container Windows install needs a Postgres to point at (bundled, installed, or remote). Under Docker Desktop today that is simply another container.

## Dev / e2e stack
`deploy/compose/dev.yml` — Postgres (ledger) + **Stalwart** (reference target: JMAP **and** IMAP/SMTP/CalDAV/CardDAV/WebDAV) + Nextcloud (secondary DAV/files target). Light by design. **Trigger.dev is added later** from the official templates (github.com/triggerdotdev/docker); the first slice needs only Postgres + Stalwart.

## Release controls (see §22.1)
- SemVer; one release train; `CHANGELOG.md` + upgrade guide per release.
- **Migrations on startup behind a lock** (Drizzle Kit; Atlas lint in CI); the app refuses to start if the schema is newer than it understands.
- **Multi-arch images (amd64+arm64), signed (cosign), with an SBOM (syft)**; consumers pin by digest.
- **Release channels:** `stable` (default) and `edge`/`beta` (opt-in); self-host updates via image tags; back up the ledger before upgrading; never run two app versions against one database.
- Managed: staged/canary rollout, DB backup before migrate, roll-forward preferred over schema rollback.

## EU/CH provider options
Scaleway, OVHcloud (incl. SecNumCloud), Exoscale, StackIT, IONOS, Open Telekom Cloud, UpCloud, Elastx, Leafcloud; Aiven for managed data; Hetzner for cheap IaaS.
