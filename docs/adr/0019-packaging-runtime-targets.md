# ADR-0019: Packaging & runtime targets — container-first, optional Tauri tray, prefer JS-native engines for portability

- **Status:** Accepted (the Tauri tray variant is **superseded as the first Windows target** by [ADR-0027](./0027-windows-packaging-shell.md), 2026-07-30 — deferred, not rejected, with a named revisit condition there)
- **Date:** 2026-06-21
- **Refines:** ADR-0007 (engine reuse); relates to ADR-0003 (two editions, one core) and ADR-0018 (JMAP-first).

## Update 2026-07-30: decision 3 went all the way — there are no shell-out engines left

Decision 3 said "prefer JS-native where fidelity is equal, keep the shell-out
engines available". In practice **every** domain ended up JS-native and the
wrappers were never wired into anything: `runShadowPass` → `runDomainSync` drives
the connectors and target writers directly for all four domains, and the
`imapsync-wrapper` / `caldav-sync` (vdirsyncer) / `carddav-sync` (vdirsyncer) /
`webdav-sync` (rclone) modules in `@openmig/engines` were exported but imported by
nothing. They have now been deleted, so the runtime dependency list below is not
"preferred" — it is exhaustive:

**No Perl, no Python, no external binaries.** The sync path is Node plus pure-JS
libraries (`imap-simple`/`node-imap`, `webdav`, `ical.js`, `undici`). The one
native dependency left in the self-host edition is **Postgres** (ADR-0023), which
is what a native-Windows packaging story has to answer for — not imapsync.

Everything below stands as written; the paragraphs that hedge about imapsync
friction on Windows are now historical context for why decision 3 was made, not a
live constraint.

## Context
The self-host edition is container/Linux-first (Docker Compose, NAS/Pi/Spark, Helm, Home Assistant add-on). Users may want to run it on **Windows 11**, possibly as a background **system-tray** app. The core is Node/TypeScript and therefore cross-platform, and the JMAP-first mail path (ADR-0018) is pure Node (a JS JMAP writer + a JS IMAP source). The shell-out engines we reuse (ADR-0007) vary in Windows-friendliness: **rclone** has native Windows builds, **vdirsyncer** installs via Python, but **imapsync** (Perl) is awkward on native Windows.

## Decision
1. **Container-first stays the supported self-host packaging.** It already runs on **Windows 11 via Docker Desktop + WSL2** (web UI in a browser) with no new code. This is the recommended Windows path today.
2. **Optional Tauri tray variant (planned).** For a native desktop / system-tray experience (tray icon, start-on-login, background service), wrap the Node service + existing web UI in **Tauri** — a Rust shell with a system webview that supervises the Node sidecar. Chosen over **Electron** for footprint and memory (a few MB vs ~100 MB) and arm64/Pi friendliness, matching the low-maintenance ethos. It is a packaging layer over the same core (ADR-0003), not part of the MVP. A Windows Service + small tray helper is the heavier fallback.
3. **Prefer JS-native engines for portability** where a maintained library gives equivalent fidelity — a refinement of ADR-0007. Rationale: fewer external binaries means a clean native Windows/macOS/arm64 story, simpler packaging (especially a future Tauri build), and the JMAP-first mail path is already JS-native. The proven shell-out engines (imapsync for IMAP bulk, vdirsyncer for cal/contacts, rclone for files) remain available and are still preferred on Linux/container deployments and for heavy bulk; they are simply not required for the JS-native mail path.

## Consequences
- Windows 11 works now (WSL2/Docker Desktop); a nicer native tray experience is a known, non-disruptive future option.
- The JMAP-first mail path is binary-free and therefore the most portable; the IMAP/DAV/files paths may still want WSL2 or a bundled runtime on native Windows (imapsync especially).
- A Tauri build, when pursued, must spawn/bundle the Node runtime as a sidecar and ship the web UI assets; the self-host SQLite state is already embeddable. *(Update 2026-08-02: read "SQLite state" as PGlite — SQLite was dropped by ADR-0023, and the embeddable-state property this consequence relies on is provided by PGlite since ADR-0028.)* It adds a multi-OS packaging/build pipeline.
- The tension with ADR-0007 (reuse over reimplement) is intentional and bounded: prefer JS-native **only** where it does not sacrifice fidelity or robustness; otherwise keep the battle-tested CLI engines.

## Alternatives considered
- **Electron tray** — rejected: heavier footprint/memory, worse fit for Pi/arm64 and the low-maintenance goal.
- **Windows Service + tray helper only** — viable fallback, but more native plumbing and less cross-platform than Tauri.
- **Reimplement all engines in JS** — rejected: over-scope; imapsync/rclone are battle-tested (ADR-0007).
- **Windows-native, no container, as the default** — rejected: imapsync friction and a larger support surface; container-first remains primary.
