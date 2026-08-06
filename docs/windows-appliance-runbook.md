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

## Phase 0 — prerequisites

| Need | Why | Check |
|---|---|---|
| **Node 22 or newer** | the bundle targets `node22`, and `start.mjs` uses top-level `await` | `node --version` |
| **pnpm 11+** | to build the payload | `pnpm --version` |
| **Git** | to clone the repo | `git --version` |
| PowerShell 5.1 or 7 | the scripts here | `$PSVersionTable.PSVersion` |

Nothing else. **No Docker, no WSL, no Postgres, no Visual Studio.** If any phase
below turns out to need one of those, that is a finding worth reporting — the
whole point of 0015 is that it should not.

---

## Phase 1 — does the payload run on Windows at all?

**The one that matters.** Everything else is downstream of this answer.

```powershell
git clone https://github.com/Robbes/open-migrate.git
cd open-migrate
pnpm install --frozen-lockfile
pnpm package:appliance
```

Expected: a `dist\appliance\` directory of roughly **27–28 MB**, and a final line
reading `Run it with:  node start.mjs   (needs Node 22+; nothing else)`.

Then run it:

```powershell
cd dist\appliance
node start.mjs
```

**Expected:** it migrates itself on first start and prints
`[appliance] listening on http://127.0.0.1:8080`. Open <http://127.0.0.1:8080/ui>
and you should get the operating UI. Press `Ctrl+C` to stop; run `node start.mjs`
again and it should come back **without** re-migrating.

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

Expected: a permissions failure. If it instead *succeeds*, that is worth knowing
too — it would mean your account has non-default write access to Program Files,
and the test says nothing.

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
