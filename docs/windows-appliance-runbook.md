# Running the self-host appliance on Windows — a runbook for the owner

**Status:** written 2026-08-06 by someone who has never run any of it.
**Owns:** workplan [0015](./workplans/0015-native-windows-installer.md) T3.
**Read first:** [ADR-0027](./adr/0027-windows-packaging-shell.md) — and its
**second update**, which replaces the Windows Service with a scheduled task, [ADR-0019](./adr/0019-packaging-runtime-targets.md).

---

## Why this document exists

0015 T3 says *"payload done; the MSI is not"*, and the reason the MSI is not
done is not that it is hard — it is that **nobody has ever run the appliance on
Windows at all.** `scripts/package-appliance.unit.test.ts` starts the payload as
a real child process with the repository nowhere in its environment, and it
passes; it passes **on Linux**, on CI, ten tests, every time. That proves the
payload is relocatable. It proves nothing about Windows.

Writing an installer before knowing whether the thing it installs runs would be
building the second floor first. So this runbook is ordered by **what is
unknown**, cheapest and most load-bearing first, and each phase is written so
that a failure is informative rather than just red.

**You need a Windows machine for every phase.** There is no Windows in CI and
none in the agent environment, so none of the commands below have been executed
by anyone. Treat every "expected" as a prediction, not a promise — and where a
prediction is shaky, this document says so rather than sounding confident.

---

## What to send back

Whatever happens, the useful artefact is the same. `scripts/windows/collect-evidence.cmd`
writes one file with the versions, the console output, the listening ports and
the data directory layout. Run it after whichever phase you reach and send
`windows-evidence.txt`. That is enough to act on without a back-and-forth.

If a phase fails, **stop there and send it** — the later phases assume the
earlier ones worked, and diagnosing phase 3 on a broken phase 1 wastes your time
rather than mine.

---

## Phase 0 — prerequisites: none

**Nothing to install on the Windows machine.** Not Node, not pnpm, not Git.

An earlier version of this runbook asked for all three, then for Node alone.
Both were wrong, and the correction is recorded rather than quietly applied
because the mistake is the instructive part: it made you install a *developer*
toolchain to test a product whose entire premise (0015: *"end users never
touching bash, a Linux filesystem or Docker"*) is that none of it is needed. The
owner uninstalled Node from the laptop to make the point, which is the right
test of the requirement.

| Need | Why |
|---|---|
| PowerShell 5.1 or 7 | already on the machine |

That is the list.

**Use PowerShell, not `cmd`.** Every command here is PowerShell — `cmd.exe` has
no `Copy-Item`, and the first run of this runbook lost time to exactly that.

**Windows blocks unsigned scripts by default**, so **use the `.cmd` wrappers**:

```powershell
.\collect-evidence.cmd -PayloadPath "C:\Program Files\OpenMigrateTest"
.\run-appliance.cmd    -PayloadPath "C:\Program Files\OpenMigrateTest"
```

Calling the `.ps1` files directly fails under the stock `Restricted` policy with
*"running scripts is disabled on this system"*. The wrappers pass
`-ExecutionPolicy Bypass` for that one process only — they do **not** change the
machine's stored policy, and you should not either: telling an owner to run
`Set-ExecutionPolicy RemoteSigned` weakens their machine permanently in order to
read a diagnostic file.

This is worth noticing rather than only working around. **An MSI that shipped
PowerShell scripts would hit the same wall on a customer's machine**, which is an
argument for the installer doing its work natively — and a second, concrete
reason for T4 code signing beyond SmartScreen.

**Owner decision, 2026-08-06: the payload ships its own Node runtime.**
`pnpm package:appliance --with-node win-x64` stages `node.exe` beside
`start.mjs`, and everything here runs it as `.\node.exe`. The alternative —
requiring Node and having the installer detect, prompt for or side-install it —
is a terminal-shaped problem wearing a dialog box, which is the thing 0015
exists to avoid.

What it costs, stated plainly: the payload goes from **28.8 MB to 117.3 MB**
(`node.exe` win-x64 is 88.5 MB). It compresses well in an MSI, and it means a
runtime we are now responsible for patching — `NODE_RUNTIME_VERSION` in
`scripts/package-appliance.mjs` is pinned to `v24.19.0` so that bumping it is a
visible edit somebody reviews, not a silent float.

The download is **checksum-verified** against the release's own
`SHASUMS256.txt`, and a mismatch stops the build. We would be shipping somebody
else's binary to customers; an unverified download is a supply-chain hole with a
progress bar.

**No Docker, no WSL, no Postgres, no Visual Studio, no build toolchain.** If any
phase turns out to need one, that is a finding worth reporting.

---

## Phase 1 — does the payload run on Windows at all?

**The one that matters.** Everything else is downstream of this answer.

### Get a payload: download it from Actions

The payload is **platform-independent to build**: `package-appliance.mjs` only
copies files, PGlite is WASM, the bundle is plain JavaScript, and `node.exe` is
just a download. Its own header says so, and CI has only ever built it on Linux.
So there is no reason to build it by hand at all.

1. GitHub → **Actions** → **Windows payload** → **Run workflow**.
2. Leave the platform as `win-x64` (pick `win-arm64` only for an ARM laptop).
3. When it finishes, download the artefact from the run's summary page and
   extract it on the laptop.

The download **expands straight to the payload** — `start.mjs`, `node.exe`,
`ui`, `migrations`. Before you do anything with it, check you have what you
think you have:

```powershell
Select-String -Path .\start.mjs -Pattern 'const BUILD ='
```

That must match the build stamp in the run summary. **Run this again after every
copy.** On 2026-08-07 the workflow double-zipped its own artefact, so the
download contained a single `.zip` rather than the payload; `Copy-Item <dir>\*`
copied that one file into the install directory, reported success, and the
machine went on running the previous payload. A copy that silently moved nothing
looks exactly like a copy that worked, and this line is the only thing that
tells them apart.

`SHA256SUMS.txt` inside the payload covers every file:

```powershell
# from the payload directory, if you have a sha256sum to hand
sha256sum -c SHA256SUMS.txt
```

Then, **from a writable folder**:

```powershell
cd openmig-appliance-win-x64
.\node.exe start.mjs
```

Under `C:\Program Files\` this REFUSES instead — see Phase 2. Use
`run-appliance.cmd` there.

Expected: a first line reading `[appliance] build <version> (<commit>)` — which
should match the commit in the run summary — then the staging log, ending with
`Run it with:  .\node.exe start.mjs   (nothing to install)`.

**This is still the right test, not merely the convenient one.** An MSI hands a
Windows machine a directory built somewhere else, so building on a Linux runner
and running on the laptop exercises the *relocatable* property the way the
product actually uses it — and running `.\node.exe` exercises the *shipped*
configuration rather than a developer's environment. Building on Windows and
running in place tests neither.

**The build is not signed.** SmartScreen will warn the first time, and you will
have to choose *More info → Run anyway*. Signing is workplan 0025 T6 / 0015 T4
and needs a certificate; that decision has not been taken. Fine for Phases 1–3,
not what you would hand a customer.

<details>
<summary>Building it by hand instead (on the Spark)</summary>

Still works, and is what the workflow runs:

```bash
pnpm package:appliance --with-node win-x64
tar -czf appliance.tgz -C dist appliance
```

Then copy `appliance.tgz` to the laptop over NetBird (`scp`, or any file share)
and expand it. The only reason to do this is if you are changing the packaging
script itself and want the loop to be seconds rather than a CI round trip.

</details>

### If you also want to know whether the build works on Windows

Optional, and nothing on the path to an MSI depends on it — a failure here would
not block one. It needs Git and pnpm, which is exactly why it is not the main
path:

```powershell
git clone https://github.com/Robbes/open-migrate.git
cd open-migrate
pnpm install --frozen-lockfile
pnpm package:appliance --with-node win-x64
cd dist\appliance
.\node.exe start.mjs
```

### What to expect either way

It migrates itself on first start and prints
`[appliance] listening on http://127.0.0.1:8080`. Open <http://127.0.0.1:8080/ui>
and you should get the operating UI. Press `Ctrl+C` to stop; run it again and it
should come back **without** re-migrating — that second start is the one that
proves the database was written and closed properly, so do not skip it.

### Where I expect this to break, and what each break means

These are predictions from reading the code, not observed failures. Listed
because a named suspicion is faster to check than a blank error.

1. **PGlite's WASM assets.** The payload deliberately ships
   `node_modules\@electric-sql\pglite` unbundled, because PGlite locates
   `pglite.wasm` and `pglite.data` (~26 MB) with `new URL(..., import.meta.url)`.
   If those lookups fail on Windows the error will name a missing file, and it
   will happen at startup, before anything is listening. **This is the single
   most likely Windows-specific failure** and the one that would most change the
   plan — if PGlite can't boot from a relocated directory on Windows, the whole
   no-Postgres premise (ADR-0023 → 0016) needs revisiting for this platform.

2. **Path separators.** `start.mjs` builds every path with `node:path.join`, which
   is correct on Windows, but the migration runner walks up from its own
   `import.meta.url` to find `migrations/`. A `file:///C:/...` URL round-trip is a
   classic place for this to go wrong. Symptom: it can't find the migration SQL,
   or it finds nothing and reports zero migrations rather than failing.

3. **Windows Defender / SmartScreen** may quarantine an unsigned `.exe`, though at
   this phase there is no `.exe` — only `node.exe` running a script. If Defender
   interferes here, say so; it changes T4's urgency.

4. **Long paths.** `node_modules\@electric-sql\pglite\dist\...` under a deep clone
   path can exceed 260 characters if long-path support is off. Symptom: `ENAMETOOLONG`
   or a confusing `ENOENT` during `pnpm install`.

---

## What needs to be running, and where

Short version: **Phases 1 and 2 need nothing but the laptop.** Phase 3's most
valuable test needs a real source and target, and that is what the Spark is for.

| Phase | Needs a source/target server? |
|---|---|
| 1 — does the payload run | **No.** `.\node.exe start.mjs` boots PGlite, migrates itself and serves `/ui` with no mapping configured. That is the whole test. |
| 2 — data directory | **No.** Same, from a different directory. |
| 3 — Windows Service | Registration, boot survival and a clean `Stop-Service`: **no**. The *mid-sync shutdown* test: **yes** — you cannot interrupt a sync that is not running. |
| 4 — installer | Not for the build. Yes for an end-to-end smoke after installing. |

So do not stand anything up before Phase 1. If the payload does not boot, a
Stalwart you provisioned first was wasted effort.

### For the Phase 3 shutdown test, over NetBird

Keep Stalwart (and Nextcloud, if you want the DAV domains) **on the Spark**,
started the way they already are — `deploy/selfhost/setup-stalwart.sh` is
idempotent — and run the appliance on the laptop, pointing its mapping at the
Spark's NetBird address.

That works without any change to the setup scripts, and it is worth knowing why:
`setup-stalwart.sh` publishes with `-p "${JMAP_PORT}:8080"` and
`-p "${IMAPS_PORT}:993"` and **no bind address**, so Docker publishes on
`0.0.0.0` and both are already reachable from the NetBird network. Nothing to
re-bind, nothing to open.

- JMAP: `http://<spark-netbird-ip>:18080/.well-known/jmap`
- IMAPS: `<spark-netbird-ip>:1993` (TLS, self-signed)
- Accounts: `source@dev.local` / `source_password`, `target@dev.local` / `target_password`

**Direction of traffic matters here and it is the reassuring part.** The
appliance is a *client* of Stalwart — it makes outbound connections. Nothing has
to reach the laptop, so there is no inbound firewall rule and no port to publish
on Windows. The appliance's own `HOST` stays `127.0.0.1`: you browse its UI from
the same machine it runs on, and it should stay off the network (it holds live
mail credentials).

Two things not to confuse:

- `SELFHOST_BIND` in `deploy/selfhost/compose.yml` binds the *appliance's* port
  to loopback in the Docker deployment. Irrelevant here — the Windows appliance
  is not in Docker, and its equivalent is the `HOST` variable.
- The self-signed certificate is expected, and since 2026-08-09 the mapping
  must SAY so: put `"tlsVerify": false` on the source (and on an `imap-dav`
  target, if you use one). Certificate verification now defaults ON — the
  connectors used to skip it for everyone, dev and production alike, which
  meant a production mailbox's credentials went to whatever answered the
  socket. A TLS rejection against the dev Stalwart therefore means the mapping
  is missing `"tlsVerify": false`; the error names the field. A TLS rejection
  against a REAL mail server is a finding — do not work around it.

### What "mid-sync shutdown" actually means

Seed the source, start a mapping, and while it is copying, `Stop-Service
OpenMigrateAppliance`. Then start it again. The appliance must come back, the
ledger must be intact, and a re-run must not duplicate what was already copied —
that is hard rule 1, and it is the property `selfhost-restart-resume.e2e.test.ts`
proves on Linux and nothing has ever proved on Windows.

**This is the test I care most about**, because it is where the Windows-specific
risk was thought to live. Windows services receive no POSIX signals, so a
clean PGlite close looked like it needed a wrapper — until the crash test in
Phase 3 showed an abrupt kill is survived anyway.

---

## Phase 2 — the data directory problem, which is real and already known

**Do not skip this. It is a design defect I can see from here, and Phase 1 will
not surface it because it runs from a writable directory.**

`start.mjs` defaults its writable state to *inside the payload*:

```js
pgliteDataDir: process.env.SELFHOST_PGLITE_DIR ?? join(here, 'data', 'pglite'),
configDir:     process.env.CONFIG_DIR          ?? join(here, 'data', 'config'),
```

That is fine when you run it out of `dist\appliance`. It is **wrong once an
installer puts the payload in `C:\Program Files\`**, which is not writable by a
normal user or by a service account. The database would fail to create on first
start, as a permissions error, on an end user's machine — exactly the class of
failure this project's hard rule 9 is about.

So the installer must set both explicitly, to somewhere a service can write:

```
SELFHOST_PGLITE_DIR = C:\ProgramData\OpenMigrate\pglite
CONFIG_DIR          = C:\ProgramData\OpenMigrate\config
```

**To prove the problem exists** — this needs TWO shells, and that is the point:
an installer runs elevated, the service does not.

First, **an ADMINISTRATOR PowerShell**, only to place the files where an
installer would:

```powershell
Stop-ScheduledTask -TaskName 'OpenMigrateAppliance' -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue |
  ForEach-Object { $_.Kill(); $_.WaitForExit(15000) | Out-Null }
robocopy "<payload>" "C:\Program Files\OpenMigrateTest" /MIR /XD data /NFL /NDL /NJH /NP
Select-String -Path "C:\Program Files\OpenMigrateTest\start.mjs" -Pattern 'const BUILD ='
```

**The two lines before `robocopy` are not optional on an upgrade.** A running
appliance holds `node.exe` open, and robocopy answers that with

```
ERROR 32 (0x00000020) Copying File ...\node.exe
Het proces heeft geen toegang tot het bestand omdat het door een ander proces
wordt gebruikt.
Waiting 30 seconds... Retrying...
```

`Stop-ScheduledTask` on its own is **not enough** — it asks the task to stop and
returns before the process is gone. `Stop-Process -Force` is closer but still
returns before Windows has released the file handle, which cost a 30-second
robocopy stall on 2026-08-09 even with it. `WaitForExit` is the part that
actually waits.

Robocopy exit codes **0–7 are success**; 8 or above is a real failure. The
`Select-String` must print a stamp matching the build you meant to install —
run it after every copy, not once. A copy that silently moved nothing looks
exactly like a copy that worked.

**Why `robocopy /MIR` and not `Copy-Item -Recurse`.** Two reasons, and the
first is the one that bites quietly:

- `Copy-Item` only ever ADDS. A file that a later build stopped shipping stays
  in the install directory forever, so an upgraded payload runs beside the
  leftovers of the one before it. `/MIR` mirrors: gone from the source means
  gone from the destination.
- `Copy-Item -Path <dir>\* -Destination <dir> -Recurse` is unreliable when the
  destination subdirectories already EXIST — it can copy into them rather than
  merging, leaving `ui\ui` or `node_modules\node_modules`. If you have used it,
  check before trusting the result:

  ```powershell
  Get-ChildItem "C:\Program Files\OpenMigrateTest" -Directory -Recurse -Depth 1 |
    Where-Object { $_.Name -eq $_.Parent.Name } | Select-Object FullName
  ```

**Note the `/XD data`.** If you have already run the payload in place it has a
`data\` directory beside `start.mjs` holding a real PGlite database, and a plain
recursive copy takes it with you — the first run of this on 2026-08-07 put
157.2 MB into Program Files where the build had staged 117.3 MB, the difference
being a database that should never have been there. With `/MIR` the exclusion
matters twice over: without it, mirroring would also DELETE that database when
the source has no `data\`. A real installer copies a freshly built payload and
never sees either problem, but it is worth knowing that the two directories are
only separate *by convention* until the environment variables are set.

Then close it and open a **NORMAL PowerShell**, because running as an
unprivileged account is the whole test:

```powershell
cd "C:\Program Files\OpenMigrateTest"
.\node.exe start.mjs
```

Expected: it **refuses to start**, naming the directory and the variable to set:

```
The appliance cannot write its database directory:
  C:\Program Files\OpenMigrateTest\data\pglite

Reason: EPERM: operation not permitted, mkdir '...'

This usually means the payload was installed somewhere read-only and
SELFHOST_PGLITE_DIR was not set. Point it at a writable location the service
account owns — on Windows C:\ProgramData\OpenMigrate\ — and keep it OUT of
the install directory so an upgrade or uninstall cannot take the migration
ledger with it.
```

That message is new (2026-08-06). Before it, this failed as a permissions error
from inside PGlite naming a path nobody chose — the same failure, reported as
something else. If you see the *old* behaviour, you are running a payload built
before that change; rebuild.

If it instead **succeeds**, that is worth knowing too — it would mean your
account has non-default write access to Program Files, and the test says nothing.

**Then prove the fix works:**

```powershell
..\..\scripts\windows\run-appliance.cmd -PayloadPath "C:\Program Files\OpenMigrateTest"
```

That script sets both variables to `C:\ProgramData\OpenMigrate\...`, creates the
directories, and starts the appliance. If Phase 1 passed and this passes, the
installer's requirements are settled and I can write that part with confidence.

---

## Phase 3 — start it on boot, with Task Scheduler

Only once Phases 1 and 2 pass.

**Owner decision, 2026-08-07: a scheduled task, not a Windows Service.** The
reasoning is in [ADR-0027](./adr/0027-windows-packaging-shell.md)'s second
update; the short version is that Node cannot be a Service on its own, every
wrapper that fixes that is a dormant third-party binary we would vendor and
sign, and the one thing such a wrapper buys — a clean stop — **turned out not to
be load-bearing**: the crash test below already passed.

### The crash test, which is why the rest of this is simple

Worth doing first, and worth doing again on any machine you care about:

```powershell
# Start it, then in a SECOND window kill it as hard as Windows can:
Stop-Process -Name node -Force
# Then start it again.
```

It should come back with `schema up to date` and serve the UI. **It did on
2026-08-07.** PGlite is Postgres, and surviving abrupt termination is what
Postgres does for a living — WAL recovery is its normal operating mode. That is
what makes a wrapper unnecessary rather than merely inconvenient.

### Install

The scripts ship **inside the payload**, under `scripts\`. You do not need a
checkout, git, or anything else on the Windows machine — that was true of Phases
1 and 2 and is now true of Phase 3 as well.

From an **elevated** prompt (both scripts declare `#Requires -RunAsAdministrator`):

```powershell
cd "C:\Program Files\OpenMigrateTest\scripts"
.\install-task.cmd -PayloadPath "C:\Program Files\OpenMigrateTest"
```

Each `.cmd` is a wrapper that runs its `.ps1` sibling with
`-ExecutionPolicy Bypass`, because stock Windows policy is `Restricted` and
refuses a `.ps1` outright. They must stay in the same directory; the payload
ships them that way and a test asserts it.

<details>
<summary>If you are on a payload from before 2026-08-07</summary>

Those predate the scripts being staged. The repository is public, so fetch them
without cloning:

```powershell
$dst  = "$env:USERPROFILE\openmig-scripts"
$base = "https://raw.githubusercontent.com/Robbes/open-migrate/main/scripts/windows"
New-Item -ItemType Directory -Force $dst | Out-Null
foreach ($f in 'install-task.ps1','install-task.cmd','uninstall-task.ps1','uninstall-task.cmd',
                'run-appliance.ps1','run-appliance.cmd','collect-evidence.ps1','collect-evidence.cmd') {
  Invoke-WebRequest "$base/$f" -OutFile (Join-Path $dst $f)
}
```

</details>

It creates `C:\ProgramData\OpenMigrate\{pglite,config,logs}`, grants the run-as
account Modify on them, writes a readable `service-launch.cmd` into the payload
(Task Scheduler actions carry no environment, and a generated launcher beats a
quoting puzzle inside a task definition), registers an **At-Startup** task, and
starts it.

Runs as `NT AUTHORITY\LocalService` — the least-privileged account that can do
this job. The appliance only makes *outbound* connections and authenticates to
mail servers with its own configured credentials, so it needs no machine
identity on the network. `SYSTEM` would also work and is over-privileged for
something that talks to the internet all day.

### Give it something to do

A freshly installed task logs `loaded 0 mapping(s)` and syncs nothing, because
`CONFIG_DIR` points at `C:\ProgramData\OpenMigrate\config` and that starts
empty. Put a mapping there — `deploy/selfhost/config/mapping.json.example` is
the template; any name ending `.json` is picked up, `.example` is not. Pointing
it at the dev Stalwart? Its certificate is self-signed, so the source needs
`"tlsVerify": false` (see the note in the example) — without it the pass
refuses the certificate, naming the field.

**Credentials do not go in the mapping, and they do not go in the launcher.**
A mapping names its secrets by environment variable (`passwordFromEnv`,
`tokenFromEnv`). `service-launch.cmd` would be the obvious place to set those —
and it is the wrong one, because it lives in `C:\Program Files`, which every
local user can read. `install-task.ps1` therefore creates
`C:\ProgramData\OpenMigrate\config\secrets.cmd`, ACL'd to Administrators,
SYSTEM and the run-as account only, and the launcher `call`s it. Put them
there:

```bat
set SOURCE_IMAP_PASSWORD=...
set TARGET_JMAP_PASSWORD=...
```

Then restart the task and confirm the log says `loaded 1 mapping(s)`.

**If you installed before 2026-08-09, that file is read-only even to you.** The
ACL granted Administrators `R`, so editing the file the script had just told you
to fill in failed with `Toegang tot het pad ... is geweigerd` from an elevated
shell. Fixed in `install-task.ps1` (Administrators now get `M`), but an existing
file keeps the ACL it was given. Repair it once, elevated:

```powershell
icacls 'C:\ProgramData\OpenMigrate\config\secrets.cmd' /grant '*S-1-5-32-544:(M)'
```

If that is itself refused, you are not the owner — `takeown /f` the file first.
Read-only for Administrators never protected anything (an administrator can take
ownership and re-grant at will); it only broke the documented workflow.

### What to check

```powershell
Get-ScheduledTask -TaskName OpenMigrateAppliance | Get-ScheduledTaskInfo
Get-Content C:\ProgramData\OpenMigrate\logs\appliance.log -Tail 20
```

Two things about that output surprise people:

- **`Get-ScheduledTask` needs an ELEVATED shell.** From a normal one it reports
  *"No MSFT_ScheduledTask objects found"* — the task exists, you just cannot see
  it. `Invoke-WebRequest http://127.0.0.1:8080/ui` is the check that works
  unprivileged, and is the better one anyway: a task in the Running state and an
  appliance that actually serves are not the same claim.
- **`LastTaskResult : 267009`** is `0x41301`, `SCHED_S_TASK_RUNNING`. It means
  *currently running*, not *failed with an error code*.

And when stopping and starting it, **pause before reading the log** — PGlite
takes a few seconds to come up, so a `Get-Content` pasted immediately after
`Start-ScheduledTask` shows the PREVIOUS run and looks like nothing happened:

```powershell
Stop-ScheduledTask -TaskName OpenMigrateAppliance
Start-Sleep 3
Start-ScheduledTask -TaskName OpenMigrateAppliance
Start-Sleep 15
Get-Content C:\ProgramData\OpenMigrate\logs\appliance.log -Tail 12
```

The log's first line names the build (`[appliance] build 0.1.0-rc.1 (…)`), which
is how you tell an installed copy from a test copy without guessing.

Then the things only a real machine can answer:

1. **Does it survive a reboot?** Restart, wait, and load
   <http://127.0.0.1:8080/ui/confirm> without logging in to anything first.
2. **Does it stop and start cleanly?** `Stop-ScheduledTask` then
   `Start-ScheduledTask`, and check the log picks up rather than re-migrating.
3. **The mid-sync test.** Start Stalwart on the Spark, point a mapping at it over
   NetBird, and stop the task while a sync is copying. Start it again. The ledger
   must be intact and a re-run must not duplicate — hard rule 1. The crash test
   makes this very likely to pass, but *likely* is not *tested*, and this is the
   one that involves real data.

### Two things worth knowing before they surprise you

- **There is no Services panel entry.** That is the trade, stated in the ADR. An
  administrator looking for one will not find it; the task lives in Task
  Scheduler, under `OpenMigrateAppliance`.
- **Task Scheduler's default `ExecutionTimeLimit` is three days**, after which it
  would stop a perfectly healthy appliance. `install-task.ps1` sets it to zero
  explicitly. If you ever create the task by hand, that is the setting that will
  bite you three days later.

### Uninstall

```powershell
.\uninstall-task.cmd -PayloadPath "C:\Program Files\OpenMigrateTest"
```

Stops and removes the task and its generated launcher, and **leaves
`C:\ProgramData\OpenMigrate` alone** — that is the migration ledger, the record
of what has already been copied, and deleting it is how a re-run duplicates a
customer's mailbox (hard rule 2). `-IncludeData` exists for someone who means
it, and prompts.

## Phase 4 — the installer

Only once Phase 3 is stable. ADR-0027 says WiX or Inno Setup, *"whichever proves
less painful at 0015 T3"*. That judgement is yours to make on the machine; I have
no basis for it and will not pretend otherwise.

What it must do, all of which Phases 1–3 will have established:

- Copy the payload verbatim to `C:\Program Files\OpenMigrate\`.
- Create `C:\ProgramData\OpenMigrate\{pglite,config}` and grant the service
  account write access.
- Run `install-task.ps1`, or do what it does: create the data directories,
  grant the run-as account Modify, write the launcher, register the At-Startup
  task with `ExecutionTimeLimit` zero.
- Create a Start-menu shortcut to the operating UI — **and pick a port first,
  because there are currently two.** `apps/selfhost/src/index.ts` defaults to
  **8080** and so does the payload's `start.mjs`; the Docker deployments set
  `PORT=8081` (`deploy/selfhost/compose.yml`), and ADR-0027 wrote its shortcut
  against that convention. Neither is wrong, but a shortcut that points at a
  port nothing is listening on is a support ticket on day one. My suggestion:
  the scheduled task sets `PORT=8081` explicitly, matching the deployed
  convention rather than the library default, and the shortcut follows. Say if
  you'd rather it were 8080 and I'll change `install-task.ps1`'s default — it is
  one line.
- Uninstall: run `uninstall-task.ps1`, delete Program Files content, and
  **leave `C:\ProgramData\OpenMigrate` alone** — that is the customer's
  migration ledger, and hard rule 2 says we do not delete data the owner did not
  ask us to delete. Offer it as an explicit checkbox, defaulted off.

**That open question is now closed** (owner decision, 2026-08-06): the payload
ships its own Node runtime, so the MSI installs a directory that runs on a
machine with nothing on it. See Phase 0 for what it costs and how it is
verified. Nothing in the installer needs to detect, prompt for or bundle Node.

---

## A note on what I have and have not done

I wrote every command here by reading the code. **None of it has been run.** The
`.ps1` files are untested on Windows for the same reason — no Windows in CI, none
in my environment. They are short and readable on purpose, so you can see what
they do before running them.

The one thing I am confident about without a Windows machine is the Phase 2 data
directory defect, because it follows from reading `start.mjs` against the fact
that `C:\Program Files` is not writable. Everything else is a prediction.
