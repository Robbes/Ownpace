# Running the self-host appliance on Windows — a runbook for the owner

**Status:** written 2026-08-06 by someone who has never run any of it.
**Owns:** workplan [0015](./workplans/0015-native-windows-installer.md) T3.
**Read first:** [ADR-0027](./adr/0027-windows-packaging-shell.md) (why a service
and a shortcut, not a native shell), [ADR-0019](./adr/0019-packaging-runtime-targets.md).

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

Whatever happens, the useful artefact is the same. `scripts/windows/collect-evidence.ps1`
writes one file with the versions, the console output, the listening ports and
the data directory layout. Run it after whichever phase you reach and send
`windows-evidence.txt`. That is enough to act on without a back-and-forth.

If a phase fails, **stop there and send it** — the later phases assume the
earlier ones worked, and diagnosing phase 3 on a broken phase 1 wastes your time
rather than mine.

---

## Phase 0 — prerequisites, and why there are so few

**Only Node 22+.** Not pnpm, not Git, not the repository. An earlier version of
this runbook told you to install all three; that was wrong, and worth correcting
rather than quietly dropping, because the mistake is the interesting part: it
made you install a *developer* toolchain to test a product whose entire premise
(0015: *"end users never touching bash, a Linux filesystem or Docker"*) is that
none of it is needed.

| Need | Why | Check |
|---|---|---|
| **Node 22 or newer** | the bundle targets `node22` and `start.mjs` uses top-level `await` | `node --version` |
| PowerShell 5.1 or 7 | the scripts here; already on the machine | `$PSVersionTable.PSVersion` |

**No Docker, no WSL, no Postgres, no Visual Studio, no build toolchain.** If any
phase turns out to need one, that is a finding worth reporting.

### And you should not need Node either — this is the open question

`package-appliance.mjs` produces a directory. Running it needs *a* Node; nothing
says it has to be one **you** installed. Workplan 0015's open item —
*"whether the payload ships its own Node runtime"* — is exactly this question,
and it is not a packaging detail, it decides what the product is:

- **Payload ships `node.exe`** (~50 MB more, ~78 MB total). The MSI installs and
  the appliance runs. The end user has no idea Node exists. This is what "never
  touching a terminal" actually requires.
- **Payload requires Node** (~28 MB). The MSI has to detect it, prompt for it, or
  bundle an installer for it — and every one of those is a terminal-shaped
  problem wearing a dialog box.

I think the answer is obviously the first, and that it should be settled before
the MSI rather than during. It is an owner decision (size, and shipping a runtime
you must then keep patched), so it is stated here rather than assumed.

Until it is settled, use whatever Node you have to answer Phase 1 — the question
"does this code run on Windows" is independent of who supplied the interpreter.

---

## Phase 1 — does the payload run on Windows at all?

**The one that matters.** Everything else is downstream of this answer.

### Option A (recommended) — build on the Spark, copy, run

The payload is **platform-independent**: `package-appliance.mjs` only copies
files, PGlite is WASM, and the bundle is plain JavaScript. Its own header says
so, and CI has only ever built it on Linux. So build it where the repository
already lives:

```bash
# On the Spark
pnpm package:appliance          # produces dist/appliance
tar -czf appliance.tgz -C dist appliance
```

Copy `appliance.tgz` to the laptop over NetBird (`scp`, or any file share), expand
it, and:

```powershell
cd appliance
node start.mjs
```

**This is the better test, not just the cheaper one.** An MSI will hand a Windows
machine a directory built somewhere else — so building on the Spark and running
on the laptop exercises the *relocatable* property the way the product actually
uses it. Building on Windows and running in place does not.

### Option B — build on Windows too

Only if you also want to know whether the *build* works on Windows, which no
product requirement depends on. It needs `git` and `pnpm` as well:

```powershell
git clone https://github.com/Robbes/open-migrate.git
cd open-migrate
pnpm install --frozen-lockfile
pnpm package:appliance
cd dist\appliance
node start.mjs
```

Worth doing eventually — a contributor on Windows would hit it — but it is not on
the path to an MSI, and a failure here would not block one.

### Either way, what to expect

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

---

## What needs to be running, and where

Short version: **Phases 1 and 2 need nothing but the laptop.** Phase 3's most
valuable test needs a real source and target, and that is what the Spark is for.

| Phase | Needs a source/target server? |
|---|---|
| 1 — does the payload run | **No.** `node start.mjs` boots PGlite, migrates itself and serves `/ui` with no mapping configured. That is the whole test. |
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
- The self-signed certificate is expected. The connectors use
  `rejectUnauthorized: false` on this dev path by design; if you see a TLS
  rejection that is a finding, not something to work around.

### What "mid-sync shutdown" actually means

Seed the source, start a mapping, and while it is copying, `Stop-Service
OpenMigrateAppliance`. Then start it again. The appliance must come back, the
ledger must be intact, and a re-run must not duplicate what was already copied —
that is hard rule 1, and it is the property `selfhost-restart-resume.e2e.test.ts`
proves on Linux and nothing has ever proved on Windows.

**This is the test I care most about**, because it is where the Windows-specific
risk actually lives: Windows services receive no POSIX signals, so whether
`start.mjs` gets to close PGlite cleanly depends entirely on how the wrapper
stops it.

---

**Expected:** it migrates itself on first start and prints
`[appliance] listening on http://127.0.0.1:8080`. Open <http://127.0.0.1:8080/ui>
and you should get the operating UI. Press `Ctrl+C` to stop; run `node start.mjs`
again and it should come back **without** re-migrating.

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

**To prove the problem exists** (worth ten minutes, because it justifies the fix):

```powershell
# As a NORMAL user, not an admin shell.
mkdir "C:\Program Files\OpenMigrateTest"
Copy-Item -Recurse dist\appliance\* "C:\Program Files\OpenMigrateTest\"
cd "C:\Program Files\OpenMigrateTest"
node start.mjs
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
..\..\scripts\windows\run-appliance.ps1 -PayloadPath "C:\Program Files\OpenMigrateTest"
```

That script sets both variables to `C:\ProgramData\OpenMigrate\...`, creates the
directories, and starts the appliance. If Phase 1 passed and this passes, the
installer's requirements are settled and I can write that part with confidence.

---

## Phase 3 — run it as a Windows Service

Only once Phases 1 and 2 pass.

Node cannot register itself as a service; something has to wrap it. ADR-0027
picked "a Windows Service" without naming the mechanism, because that was T3's
job. The three candidates:

| Mechanism | For | Against |
|---|---|---|
| **WinSW** (recommended) | a single `.exe` + one XML file, both shipped inside the payload; no install step; MSI-friendly; handles stdout/stderr logging and restart-on-failure | one more vendored binary to keep current |
| **nssm** | well known, interactive `nssm install` GUI | unmaintained since 2017; the GUI is wrong for an unattended MSI |
| **`sc.exe` directly** | already on the machine, nothing to vendor | cannot supervise a plain `node.exe` properly; no log redirection; restart semantics are crude |

`scripts\windows\appliance-service.xml` is a ready-to-use WinSW configuration
with the environment from Phase 2 already set. It expects `WinSW.exe` renamed to
`appliance-service.exe` beside it.

```powershell
# Download WinSW v3 (net472 or net8 build) and place it next to the XML, renamed:
#   scripts\windows\appliance-service.exe
cd scripts\windows
.\appliance-service.exe install
.\appliance-service.exe start
Get-Service OpenMigrateAppliance
```

**What to check:** it survives a reboot; `Stop-Service` shuts down cleanly rather
than killing PGlite mid-write (`start.mjs` handles `SIGTERM`, but **Windows
services do not receive POSIX signals** — this is the part I am least sure of,
and WinSW's `stopparentprocessfirst` / `<onfailure>` behaviour is what to watch).
A database corrupted by an abrupt stop would be the worst outcome here and is
worth deliberately testing: stop the service while a sync is running, then start
it again and confirm the appliance still boots and the ledger is intact.

---

## Phase 4 — the installer

Only once Phase 3 is stable. ADR-0027 says WiX or Inno Setup, *"whichever proves
less painful at 0015 T3"*. That judgement is yours to make on the machine; I have
no basis for it and will not pretend otherwise.

What it must do, all of which Phases 1–3 will have established:

- Copy the payload verbatim to `C:\Program Files\OpenMigrate\`.
- Create `C:\ProgramData\OpenMigrate\{pglite,config}` and grant the service
  account write access.
- Register the service with the two environment variables set.
- Create a Start-menu shortcut to the operating UI — **and pick a port first,
  because there are currently two.** `apps/selfhost/src/index.ts` defaults to
  **8080** and so does the payload's `start.mjs`; the Docker deployments set
  `PORT=8081` (`deploy/selfhost/compose.yml`), and ADR-0027 wrote its shortcut
  against that convention. Neither is wrong, but a shortcut that points at a
  port nothing is listening on is a support ticket on day one. My suggestion:
  the Windows service sets `PORT=8081` explicitly, matching the deployed
  convention rather than the library default, and the shortcut follows. Say if
  you'd rather it were 8080 and I'll change the service XML — it is one line.
- Uninstall: stop and remove the service, delete Program Files content, and
  **leave `C:\ProgramData\OpenMigrate` alone** — that is the customer's
  migration ledger, and hard rule 2 says we do not delete data the owner did not
  ask us to delete. Offer it as an explicit checkbox, defaulted off.

Open question from the workplan, still open: **does the payload ship its own Node
runtime?** Requiring an end user to install Node contradicts *"end users must
never touch bash, a Linux filesystem, or Docker"* in spirit. Bundling `node.exe`
adds ~50 MB. Worth deciding before the MSI, not during.

---

## A note on what I have and have not done

I wrote every command here by reading the code. **None of it has been run.** The
`.ps1` files are untested on Windows for the same reason — no Windows in CI, none
in my environment. They are short and readable on purpose, so you can see what
they do before running them.

The one thing I am confident about without a Windows machine is the Phase 2 data
directory defect, because it follows from reading `start.mjs` against the fact
that `C:\Program Files` is not writable. Everything else is a prediction.
