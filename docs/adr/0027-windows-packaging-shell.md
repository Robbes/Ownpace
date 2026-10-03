# ADR-0027: The Windows appliance ships as a service with a shortcut, not a native shell

- **Status:** Accepted 2026-07-30; updated three times — amended 2026-08-06 (bundled Node) and 2026-08-07 (scheduled task), measured on real Windows 2026-08-09 — plus a build correction (2026-07-31); consolidated 2026-10-03 (ADR-0051). **Despite the title, it is a scheduled task, not a Windows Service.**
- **Date:** 2026-07-30; consolidated 2026-10-03
- **Supersedes:** the "optional Tauri tray variant (planned)" in [ADR-0019](./0019-packaging-runtime-targets.md) §2, as the *first* packaging target. Tauri is not rejected — it is deferred, with a named revisit condition below.
- **Relates to:** [ADR-0023](./0023-persistence-postgres-only.md) (Postgres everywhere), [ADR-0026](./0026-one-operating-ui-one-contract.md) (one operating UI), [ADR-0028](./0028-pglite-appliance-persistence.md) (PGlite for the appliance), workplans [0015](../workplans/0015-native-windows-installer.md) T2–T4 and [0016](../workplans/0016-pglite-adoption.md), the [Windows runbook](../windows-appliance-runbook.md).
- **History:** the record as it read before consolidation, word for word — [history/0027-windows-packaging-shell.md](./history/0027-windows-packaging-shell.md)

## Operative rules

<!-- What holds NOW, within the ADR-0051 budget: 8 bullets, 60 words a bullet, 300 words in
     all. Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- The Windows appliance is a **Task Scheduler task** (At-Startup, `NT AUTHORITY\LocalService`), **not a Windows Service** whatever the title says, plus a Start-menu shortcut to the operating UI. No native shell, no wrapper binary (WinSW, nssm rejected). Held by `scripts/windows/install-task.ps1`; reasons in *Decision*.
- The Windows payload carries its **own pinned Node runtime** (`NODE_RUNTIME_VERSION`), staged by the opt-in `--with-node` flag and verified against the release's `SHASUMS256.txt` — a mismatch stops the build. Held by `scripts/package-appliance.mjs` and its unit test; `install-task.ps1` refuses a payload without `node.exe`.
- **The no-wrapper decision rests on a hard kill being safe**: PGlite and the migration ledger survive `Stop-Process -Force` (measured on real Windows 2026-08-07 and 2026-08-09, *Decision*). Anything that breaks that reopens it.
- `install-task.ps1` **must set `ExecutionTimeLimit` to zero** (no test checks it): the three-day default would stop a healthy appliance, the likeliest quiet failure.
- Writable state lives in **`C:\ProgramData\OpenMigrate`**, outside the payload; `uninstall-task.ps1` **keeps it** (the migration ledger, hard rule 2) unless `-IncludeData` is passed.
- **Tauri is deferred, not rejected:** revisit only when "it must look like a native application" becomes a stated requirement — never on size, since the Node runtime is the bulk. See *Revisit condition*.

## Context

Workplan 0015's goal, in the owner's words: a single `.msi`/`.exe` where **end users never
touch bash, a Linux filesystem, or Docker.** Both prerequisites are met — the appliance has a
UI (ADR-0026), and PGlite removed the last native dependency (0016), so the runtime is pure
JavaScript plus WASM. What remains is the shell: what the user actually installs and clicks.
ADR-0019's "optional Tauri tray variant" was planned when the runtime still shelled out to
Perl and Python and the state store was assumed to be SQLite, so it is re-examined here
rather than inherited.

**Most of the packaging work is identical whichever shell is chosen, and Tauri is additive
rather than alternative.** Tauri is a Rust shell. It cannot run our TypeScript, so it needs
the Node backend as a **sidecar** — which means the sidecar must first be packaged, which is
the whole job. Tauri is that work *plus* a Rust toolchain.

**The requirement, read literally, says nothing about a native window: a Start-menu shortcut
to `http://localhost:8081/ui` satisfies it completely.** The gap between "must not need a
terminal" and "must look like a native application" is where a Rust toolchain gets adopted
by momentum rather than by decision. (That example used the Docker deployment's port; the
installed shortcut uses the payload's 8080, as the runbook's Phase 4 records.)

## Decision

**The Windows appliance runs as a scheduled task in Windows Task Scheduler, not as a Windows
Service; the title's "ships as a service" is its 2026-07-30 wording, not the mechanism.**
Beside the task, a Start-menu shortcut opens the operating UI, and there is no native shell.

### What is installed

- **A Task Scheduler task**, `OpenMigrateAppliance`: At-Startup trigger, run as
  `NT AUTHORITY\LocalService` (least privilege: the appliance only makes outbound
  connections), registered by [`install-task.ps1`](../../scripts/windows/install-task.ps1).
  It delivers what the decision requires — the appliance *"starts on boot and keeps syncing
  whether or not anyone is logged in"*, which is what a background sync appliance *is*; an
  application somebody can close is the wrong shape for it. What a task does not deliver is an entry in the
  Services panel, which is presentation rather than requirement.
- It runs **the payload's own `node.exe`** through a generated `service-launch.cmd`, since Task
  Scheduler actions carry no environment; `install-task.ps1` refuses a payload without
  `node.exe`.
- **`ExecutionTimeLimit` is zero**, set explicitly: the three-day default would stop a healthy
  appliance, the single most likely way for this to fail quietly.
- **A Start-menu shortcut opens the operating UI in the default browser**: an all-users
  `Ownpace.url` pointing at `http://127.0.0.1:8080/ui` by default.
- **Writable state lives in `C:\ProgramData\OpenMigrate`**, outside the payload, and
  [`uninstall-task.ps1`](../../scripts/windows/uninstall-task.ps1) — written in the same commit
  as `install-task.ps1`, because a thing that installs and cannot be removed is not finished — **does not
  delete it**: it is the migration ledger, the record of what has already been copied and the
  reason a re-run converges instead of duplicating a customer's mailbox (hard rule 2).
  `-IncludeData` exists for someone who means it, and prompts.
- **The installer is WiX or Inno Setup — whichever proves less painful at 0015 T3.** Nothing in
  this decision depends on which. Until it exists, the two scripts, shipped in the payload
  with `.cmd` wrappers, are the install.

### The payload, and the Node runtime it carries

`pnpm package:appliance` ([`scripts/package-appliance.mjs`](../../scripts/package-appliance.mjs))
stages a relocatable directory an installer copies verbatim: an esbuild bundle (2.8 MB when T3 built it) of
`apps/selfhost/src/index.ts`, `start.mjs`, the migration SQL, the built UI and ~26 MB of PGlite
WASM and data. **Bundling is not a risk, but it took three fixes:** PGlite stays *external*,
because it finds its WASM through `import.meta.url` and, once bundled, would look beside the
bundle and the database would never boot; a `createRequire` banner, or `pg`'s
`require('events')` becomes esbuild's throwing `__require`; and `start.mjs` passes `start()`
a `migrationsDir`.
[`package-appliance.unit.test.ts`](../../scripts/package-appliance.unit.test.ts) pins them and
boots the payload as a real process with the repository out of its environment.

**The payload ships its own Node runtime.** `pnpm package:appliance --with-node win-x64`
stages `node.exe` beside `start.mjs`, so the installed directory runs on a machine with
nothing on it: an installer that must detect, prompt for or side-install a runtime is a
terminal-shaped problem wearing a dialog box, and every branch of it lands on an end user who
was promised none. The owner settled it on 2026-08-06 by uninstalling Node from the target
laptop and asking why it was needed at all. The cost, measured that day: 28.8 MB staged became
117.3 MB (`node.exe` is 88.5 MB), and a runtime we now patch. `NODE_RUNTIME_VERSION` is pinned
so a bump is a reviewed edit, and the download is verified against the release's
own `SHASUMS256.txt` — a mismatch stops the build, because an unverified binary is a
supply-chain hole with a progress bar. It is **opt-in** at the flag: a Linux dev build has a
Node already and should not pay for a 93 MB download it will never run.

### Why a scheduled task, and no wrapper

Node cannot be a Windows Service on its own — it never answers the service control manager,
so Windows reports a plain `node.exe` as failing to start even while it runs. Every wrapper
that fixes that is a third-party binary we would vendor into a customer's machine, sign and
patch (*Alternatives considered*). The single thing it buys is translating
`SERVICE_CONTROL_STOP` into something `start.mjs` can act on — a service never receives a
POSIX signal — so that PGlite is not killed mid-write.

**That requirement is not load-bearing, and it was measured, not argued.** PGlite is Postgres,
and surviving abrupt termination is what Postgres does for a living: WAL recovery is its
normal operating mode. On the target machine, `Stop-Process -Force` — the hardest kill Windows
offers — left a database that came back with `schema up to date` (2026-08-07). Two hard kills
mid-upload, with 498 messages already copied, were followed by a pass that added exactly two:
the target finished on 500, not 1000, verified at the target server (2026-08-09). The ledger
surviving is the property the no-wrapper decision turns on, because a ledger that lost its
partial rows would re-copy a customer's mailbox on every restart (hard rule 1). The bundled
runtime was proven the same day: with Node uninstalled and the machine rebooted, the task
started itself and copied ten new messages.

What is gained: nothing vendored, nothing extra to sign, no dormant upstream to track, and one
fewer binary in a payload that already ships a Node runtime.

### Why this shape rather than a native shell

- **Its cost is entirely work that must happen anyway** — bundle, assets, installer: no new
  language, no experimental API, no second build system.
- **The product runs in the background; it is not an app.** It runs for weeks on a schedule,
  and the UI is opened occasionally, to answer a decision queue or run the §20 check.
  Optimising the window optimises the rare case.
- **It is the cheapest thing to be wrong about:** a native shell, if ever wanted, wraps the
  already-packaged backend — the sidecar Tauri needs exists. Nothing is thrown away.
- **Code signing (0015 T4) stays simple:** the installer, with no Rust shell, sidecar or
  wrapper binary beside it.

## Consequences

- **A backend bundle step is required**, where the repo had none — new build surface, but
  required by every option, including the ones not chosen.
- **The Node runtime is the bulk of the payload** (88.5 of 117.3 MB on 2026-08-06) unless a later SEA effort
  removes it, and it is ours to patch: the obvious place to look if size becomes a complaint.
- **No Services-panel entry, no tray icon, no window.** An administrator looking for a service
  will not find one; "is it running?" is answered by Task Scheduler and the UI itself, and the
  runbook says so. If that proves a real support burden, it is evidence for the revisit
  condition, not a surprise.
- **Nothing in CI runs the Windows shell**, so a change to `scripts/windows/` is verified only
  by somebody running it. The gates test the artefact; the five defects the 2026-08-09 run
  found (the record lists them) lived in what happens after somebody downloads it.
- **Built and run on real Windows 11** — install, hard kills, a migration and uninstall
  (2026-08-09), an in-place upgrade (2026-08-13). What remains is the MSI and code signing
  (workplan 0015 T3–T4).
- **The macOS and Linux stories are unaffected.** The container path (ADR-0019 §1) remains the
  supported deployment everywhere else.

## Alternatives considered

**Tauri + Node sidecar** (ADR-0019's plan). A genuinely native window and tray, ~10 MB shell,
WebView2 preinstalled on Windows 11, emits a real MSI. Rejected *for now* because it is
**additive**: a Rust toolchain and a multi-OS build pipeline on top of everything above, for a
window that displays a page a browser already renders. Windows 10 additionally needs the
WebView2 bootstrapper. Deferred, not rejected — see *Revisit condition*.

**Node SEA + tray helper.** One binary, no Node install, no Rust. Rejected on two counts: SEA
is still **experimental** and requires a **CommonJS** entry, which our three `import.meta.url`
sites (the migrations directory, the UI directory, the entrypoint check) work against; and the ~26 MB of WASM ships alongside the executable regardless, so the
single-file story — the actual reason to want SEA — is not delivered. Taking an unstable API's
constraints without its payoff is the worst of both.

**Electron.** Its main process *is* Node, so no sidecar and no second language, and
`electron-builder` has the most mature Windows installer/signing/auto-update story available.
Rejected on footprint, as ADR-0019 already had: ~150 MB of Chromium to render one page,
against a ~26 MB WASM payload we are already apologising for.

**A Windows Service through a wrapper** (the mechanism named on 2026-07-30; WinSW was
configured until 2026-08-07). Rejected 2026-08-07 for the reasons under *Why a scheduled
task, and no wrapper*. The wrappers on offer: **WinSW**, whose v3 line has been in **alpha since 2021** (`v3.0.0-alpha.11`,
2025-01-29) while the newest stable, `v2.12.0` (2025-01-28), has had nothing since; and
**nssm**, unmaintained since 2017, whose install flow is an interactive GUI — the wrong shape
for an unattended installer.

**Relying on a Node installed on the machine.** Rejected 2026-08-06, for the reason under
*The payload, and the Node runtime it carries*: it hands an end user a terminal-shaped problem.

## Revisit condition

Adopt Tauri when **"it must look like a native application" becomes a stated requirement** —
from a buyer, a demo, or an observed support burden — rather than an aesthetic preference. At
that point the sidecar it needs already exists, so the change is a shell around working
software, not a packaging rewrite.

Do **not** revisit on size alone. The Node runtime, not the shell, is the bulk.

## Amendment log

- **2026-07-31** — the T3 update note, re-measured when workplan 0015
  T3 built the payload: the bundle is 2.8 MB, not 3.6 (PGlite left external); 27.6 MB staged;
  `start()` gained a `migrationsDir` option; a third fix (`pg`'s `require('events')`) that the
  original list missed. The conclusion held. Record: *Re-measured when T3 actually built the
  payload — two corrections*, in *The observation that decides this*.
- **2026-08-06** — the first update: the payload ships its own Node runtime (owner decision,
  0015 T3). `--with-node win-x64`, `NODE_RUNTIME_VERSION` pinned, `SHASUMS256.txt` verified,
  opt-in. The WinSW definition it named was deleted the next day. Record: *Update, 2026-08-06 —
  the payload ships its own Node runtime*.
- **2026-08-07** — the second update: Task Scheduler, not a Windows Service (owner decision,
  0015 T3 Phase 3). It changed the Decision's mechanism and left the title as written;
  `scripts/windows/appliance-service.xml` was deleted, and `install-task.ps1` and
  `uninstall-task.ps1` replaced it. Its reasoning is now *Why a scheduled task, and no
  wrapper*. Record: *Second update, 2026-08-07 — Task Scheduler, not a Windows Service*.
- **2026-08-09** — the third update, a measurement rather than an amendment: both premises
  measured on the owner's target machine (the ledger survives hard kills; the appliance runs
  with no Node installed), and five Windows-shell defects found and fixed. Record: *Update,
  2026-08-09 — both premises are now measured, not argued*.
- **2026-08-19** — `## Operative rules` added in the ADR-0038 backfill (owner decision); the
  decision did not change.
- **2026-10-03** — consolidated in place under
  [ADR-0051](./0051-an-adr-reads-as-it-stands.md) (owner decision): the updates above folded
  into the Decision; title unchanged.

The full record, word for word as it read before this consolidation:
[history/0027-windows-packaging-shell.md](./history/0027-windows-packaging-shell.md).
