# ADR-0027: The Windows appliance ships as a service with a shortcut, not a native shell

- **Status:** Accepted — amended twice (2026-08-06 the payload ships its own Node runtime; 2026-08-07 the mechanism is a scheduled task, not a Windows Service). **The title below is left as written; read the second update before acting on it.**
- **Date:** 2026-07-30
- **Supersedes:** the "optional Tauri tray variant (planned)" in [ADR-0019](./0019-packaging-runtime-targets.md) §2, as the *first* packaging target. Tauri is not rejected — it is deferred, with a named revisit condition below.
- **Relates to:** ADR-0023 (Postgres everywhere), [ADR-0026](./0026-one-operating-ui-one-contract.md) (one operating UI), workplans [0015](../workplans/0015-native-windows-installer.md) T2–T4 and [0016](../workplans/0016-pglite-adoption.md).

## Context

Workplan 0015's goal, in the owner's words: a single `.msi`/`.exe` where **end
users never touch bash, a Linux filesystem, or Docker.** Both prerequisites are
now met — the appliance has a UI (ADR-0026), and PGlite removed the last native
dependency (0016), so the runtime is pure JavaScript plus WASM.

What remains is the shell: what the user actually installs and clicks.

ADR-0019 planned an "optional Tauri tray variant". That was written when the
runtime still shelled out to Perl and Python and the state store was assumed to be
SQLite. Enough has changed to re-examine it rather than inherit it.

## The observation that decides this

**Most of the packaging work is identical whichever shell is chosen, and Tauri
is additive rather than alternative.**

Tauri is a Rust shell. It cannot run our TypeScript, so it needs the Node
backend as a **sidecar** — which means the sidecar must first be packaged, which
is the whole job. Tauri is that work *plus* a Rust toolchain.

The payload is the same in every option:

| Piece | Size | Note |
|---|---|---|
| Backend bundle | 3.6 MB | New. There is no JS build today — the appliance runs TypeScript under `tsx`. *(2.8 MB once PGlite is left external — see the note below.)* |
| PGlite WASM + data | ~26 MB | `pglite.wasm` 9.6 MB, `pglite.data` 6.0 MB, plus contrib tarballs. |
| Web UI bundle | 500 KB | Already produced by `pnpm --filter @openmig/web build:selfhost`. |
| Migrations SQL | 88 KB | Must sit beside the binary; `runMigrations` resolves it relative to its own module. |

**The bundling is not a risk.** Measured, not assumed: esbuild bundles
`apps/selfhost/src/index.ts` into a single 3.6 MB ESM file in 166 ms with no
errors. Three `import.meta.url` sites (migrations dir, UI dir, entrypoint check)
resolve relative to the bundle, and two of them already have explicit overrides
(`migrationsDir`, `SELFHOST_UI_DIR`).

> **Re-measured when T3 actually built the payload — two corrections.** The
> bundle is **2.8 MB**, not 3.6: PGlite has to be left *external* (it finds its
> WASM with `new URL(..., import.meta.url)`, so bundling it points those lookups
> at the bundle and the database never boots), which takes its JS out. Total
> staged payload, Node runtime aside: **27.6 MB**.
>
> And "two of them already have explicit overrides" was half true. `runMigrations`
> accepted a `migrationsDir`; **`start()` did not pass one and had no way to be
> given one**, so the bundled appliance walked up from the wrong module and died
> on `ENOENT … scandir '/tmp/migrations'`. It is an option now. The third site —
> `pg`'s CommonJS `require('events')` becoming esbuild's throwing `__require`
> helper — was not on the list at all, because it is not an `import.meta.url`
> site; it is the same class of bug wearing different clothes. The conclusion
> holds (bundling is not a risk), but it took three fixes, not zero.

## The requirement, read literally

"Never touch bash, a Linux filesystem, or Docker" says nothing about a native
window. **A Start-menu shortcut to `http://localhost:8081/ui` satisfies it
completely.**

That is worth stating plainly, because the gap between "must not need a
terminal" and "must look like a native application" is where a Rust toolchain
gets adopted by momentum rather than by decision.

## Decision

**Ship a Windows Service plus a Start-menu shortcut. No native shell.**

> **Update, 2026-08-06 — the payload ships its own Node runtime.**
>
> This ADR left open what the service would execute. 0015 T3 recorded it as
> *"whether the payload ships its own Node runtime"*, and the owner settled it
> by uninstalling Node from the target laptop and asking why it was needed at
> all — which is the right test of *"never touching a terminal"*. An installer
> that must detect, prompt for or side-install a runtime is a terminal-shaped
> problem wearing a dialog box, and every branch of it lands on an end user who
> was promised none.
>
> So `pnpm package:appliance --with-node win-x64` stages `node.exe` beside
> `start.mjs`, the WinSW definition executes `%BASE%\..\..\node.exe`, and the
> installed directory runs on a machine with nothing on it.
>
> **What it costs, so the trade is visible:** the payload goes from 28.8 MB to
> 117.3 MB (`node.exe` win-x64 is 88.5 MB), and we now ship a runtime we are
> responsible for patching. `NODE_RUNTIME_VERSION` is pinned in
> `scripts/package-appliance.mjs` so a bump is a reviewed edit rather than a
> silent float, and the download is verified against the release's own
> `SHASUMS256.txt` — a mismatch stops the build, because shipping somebody
> else's binary unverified is a supply-chain hole with a progress bar.
>
> It stays **opt-in** at the flag: a Linux dev build has a Node already and
> should not pay for a 93 MB download it will never run.

> ## Second update, 2026-08-07 — Task Scheduler, not a Windows Service
>
> **This one changes what the decision above says**, so it is written as an
> amendment rather than folded in. The heading still reads "ships as a service";
> the mechanism is now a scheduled task, and the requirement it was chosen to
> satisfy is unchanged.
>
> **What the ADR actually requires** is *"starts on boot and keeps syncing
> whether or not anyone is logged in"*. A Task Scheduler task with an At-Startup
> trigger, running as `NT AUTHORITY\LocalService`, delivers exactly that. What
> it does not deliver is an entry in the Services panel, which is presentation
> rather than requirement.
>
> **Why the change.** Node cannot be a Windows Service on its own — it never
> answers the service control manager, so Windows reports a plain `node.exe` as
> failing to start even while it runs. Something must wrap it, and every
> candidate is a third-party binary we would vendor into a customer's machine,
> sign, and then be responsible for patching:
>
> - **WinSW** — the v3 line has been in **alpha since 2021** (`v3.0.0-alpha.11`,
>   2025-01-29); the newest stable, `v2.12.0` (2025-01-28), has had nothing since.
> - **nssm** — unmaintained since 2017, and its install flow is an interactive
>   GUI, which is the wrong shape for an unattended installer.
>
> The single thing such a wrapper buys is translating `SERVICE_CONTROL_STOP`
> into something `start.mjs` can act on, since a service never receives a POSIX
> signal — without which PGlite is killed mid-write.
>
> **That assumption was tested rather than trusted.** On 2026-08-07 the owner
> ran `Stop-Process -Force` against the appliance — the hardest kill Windows
> offers, no clean shutdown at all — and it came back with `schema up to date`.
> PGlite is Postgres, and surviving abrupt termination is what Postgres does for
> a living: WAL recovery is its normal operating mode, not an edge case. So the
> requirement that justified the dependency is not load-bearing, and the
> dependency goes.
>
> **What is given up, plainly.** No Services panel entry, so an administrator
> looking for one will not find it — the task appears in Task Scheduler instead,
> and the runbook says so. Task Scheduler also carries a default
> `ExecutionTimeLimit` of three days, which would stop a healthy appliance;
> `install-task.ps1` sets it to zero explicitly, and that is the single most
> likely way for this to fail quietly.
>
> **What is gained:** nothing vendored, nothing extra to sign, no dormant
> upstream to track, and one fewer binary in a payload that already ships a Node
> runtime. `scripts/windows/appliance-service.xml` is deleted;
> `install-task.ps1` and `uninstall-task.ps1` replace it, the second in the same
> commit as the first because a thing that installs and cannot be removed is not
> finished.
>
> **The uninstaller does not delete `C:\ProgramData\OpenMigrate`.** That is the
> migration ledger — the record of what has already been copied, and the reason
> a re-run converges instead of duplicating a customer's mailbox (hard rule 2).
> `-IncludeData` exists for someone who means it, and prompts.

- The bundled backend installs as a Windows Service, so it starts on boot and
  keeps syncing whether or not anyone is logged in. That is what a background
  sync appliance *is*; an application somebody can close is the wrong shape for
  it.
- The Start-menu entry opens the operating UI in the default browser.
- The installer is WiX or Inno Setup — whichever proves less painful at 0015 T3.
  Nothing in this decision depends on which.

## Why this over the alternatives

**Its cost is entirely work that must happen anyway.** Bundle, assets,
installer. No new language, no experimental API, no second build system.

**The product is a service, not an app.** It runs for weeks on a schedule. The
UI is opened occasionally, to answer a decision queue or run the §20 check.
Optimising the window optimises the rare case.

**It is the cheapest thing to be wrong about.** If a native shell is ever
wanted, it wraps a working, already-packaged service — the sidecar Tauri needs
will exist by then. Nothing here is thrown away.

**Code signing (0015 T4) stays simple.** One binary and one installer to sign,
rather than a Rust shell plus a sidecar plus an installer.

## Alternatives considered

**Tauri + Node sidecar** (ADR-0019's plan). A genuinely native window and tray,
~10 MB shell, WebView2 preinstalled on Windows 11, emits a real MSI. Rejected
*for now* because it is **additive**: a Rust toolchain and a multi-OS build
pipeline on top of everything above, for a window that displays a page a browser
already renders. Windows 10 additionally needs the WebView2 bootstrapper.

**Node SEA + tray helper.** One binary, no Node install, no Rust. Rejected on
two counts: SEA is still **experimental** and requires a **CommonJS** entry,
which our three `import.meta.url` sites work against; and the ~26 MB of WASM
ships alongside the executable regardless, so the single-file story — the actual
reason to want SEA — is not delivered. Taking an unstable API's constraints
without its payoff is the worst of both.

**Electron.** Its main process *is* Node, so no sidecar and no second language,
and `electron-builder` has the most mature Windows installer/signing/auto-update
story available. Rejected on footprint, as ADR-0019 already had: ~150 MB of
Chromium to render one page, against a ~26 MB WASM payload we are already
apologising for.

## Consequences

- **A backend bundle step is now required**, where the repo has had none. That
  is new build surface — but it is required by every option, including the ones
  not chosen.
- **The Node runtime ships with the installer** (~110 MB) unless a later SEA
  effort removes it. That is the largest single line in the payload and the most
  obvious place to look if size becomes a complaint.
- **No tray icon and no window.** An operator's "is it running?" affordance is
  the Services panel and the UI itself. If that proves to be a real support
  burden, it is evidence for the revisit condition below rather than a surprise.
- **The macOS and Linux stories are unaffected.** The container path (ADR-0019
  §1) remains the supported deployment everywhere else.

## Revisit condition

Adopt Tauri when **"it must look like a native application" becomes a stated
requirement** — from a buyer, a demo, or an observed support burden — rather
than an aesthetic preference. At that point the sidecar it needs already exists,
so the change is a shell around working software, not a packaging rewrite.

Do **not** revisit on size alone. The Node runtime, not the shell, is the bulk.
