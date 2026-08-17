# ADR-0034: Configuring the appliance — the UI is a real door, files stay for fleets

- **Status:** Proposed
- **Date:** 2026-08-17
- **Deciders:** owner (who delegated the two questions in "Decisions the owner left
  open", below, answering *no preference* to both — so they are recorded here as
  mine, with the reasoning, and are the easiest part of this ADR to overrule)
- **Relates to:** [ADR-0003](./0003-two-editions-one-core.md) (two editions, one core),
  [ADR-0026](./0026-one-operating-ui-one-contract.md) (one operating UI, one contract —
  this is that argument applied to configuration rather than to operation),
  [ADR-0027](./0027-windows-packaging-shell.md) (the Windows appliance and the person it
  is for), [ADR-0020](./0020-ledger-rebuildable-cache-recovery.md) (the ledger is a
  rebuildable cache — which credentials are not), workplan 0010 (which chose the current
  arrangement, as an implementation detail, and never claimed more than that).

## Context

### What is true today

The appliance's configuration is a directory of JSON files and a set of environment
variables, and nothing else:

- `apps/selfhost/src/config-dir.ts` reads every `*.json` under `CONFIG_DIR`
  (`/data/config`, or `C:\ProgramData\OpenMigrate\config` on Windows), validates each
  against the shared mapping schema, and fails fast on an invalid file or a duplicate
  `mappingId`.
- A mapping never holds a secret. It names one — `passwordFromEnv`, `tokenFromEnv` —
  and the value comes from the process environment. On Windows that environment is
  `config\secrets.cmd`, a batch file of `set` lines that the installer creates empty
  and ACLs, and that the operator fills in by hand.
- **The appliance has no secret storage at all.** `apps/selfhost` never imports
  `SecretStore`; the `connection` rows it seeds are written with `config` and no
  `secret_ref`.

There is a detail here that I got wrong once already and that changes the argument, so
it is worth stating precisely. The appliance's `connection` rows are **bookkeeping, not
configuration**. They are inserted `ON CONFLICT (id) DO NOTHING`, their `config` JSONB is
a placeholder (`{type:'imap',host:'stalwart',…}`, or `{tenantId}` for Graph), and no code
path that opens a connection ever reads them: the sync pass constructs its connectors
straight from the `MappingConfig` the file produced. They exist because `mailbox` and
`group_def` have foreign keys that need something to point at. `buildDepsFromMapping` —
the function that *does* read connection config and credentials out of the ledger — is
imported only by `apps/worker`, which is the managed edition.

So the true statement about the appliance is not "the file wins on restart". It is
stronger and worse: **there is nothing for a UI to edit.** A connections page on the
appliance today would render four rows of dev-fixture placeholders and write changes that
no migration would ever read.

### Why this is being decided now, and not earlier

It should have been. Workplan 0066 recorded "an appliance's connections come from mapping
FILES, which are the operator's source of truth and are version-controlled" as though it
were settled architecture. It was not. It was workplan 0010's implementation choice for a
first slice, and I restated my own inference about it as a decision the project had made.
The owner asked *why*, which is how it got caught. That workplan's T3 is corrected in the
same change as this ADR.

### The three people this has to serve

The self-host edition is not one persona wearing two hats. It is two people with almost
nothing in common, and the managed edition's operator is a third.

**The fleet operator.** Docker Compose on a NAS, a Pi, a mini-PC or a rack; comfortable in
a shell; `.env` files and `docker compose up`; increasingly likely to be running *several*
appliances, one per customer. For this person, files are not a tax — they are the feature.
A directory of mappings is diffable, reviewable, reproducible, and restorable from a
backup with `cp`. Take that away and you have made their job worse.

**The Windows end user.** ADR-0027 exists for this person and states the goal without
hedging: a single `.msi`/`.exe` where **"end users never touch bash, a Linux filesystem,
or Docker."** What that person is asked to do today, after the installer finishes, is:
copy a JSON example, edit it in a text editor without a schema, save it under a name
ending `.json` and not `.example`, open a second file that is a Windows batch script, add
`set` lines to it, and restart a scheduled task. When it does not work, the diagnosis is a
log file. Every one of those steps is a text file edited by hand — which is bash's
ergonomics with none of bash's tooling. The MSI got the person to the front door and then
handed them a config file.

**The managed operator**, for completeness: has none of this. Everything is in the ledger,
created through the same UI and the same API, connections included — which is the surface
that workplans 0062–0066 have just spent a PR building out.

### The precedent this project already set

ADR-0026 answered a structurally identical question about *operating* the appliance, and
its sentence transfers without modification:

> An MSI that installs an appliance whose only operating surface is `curl` does not serve
> the person the installer exists for.

Replace `curl` with Notepad and operating with configuring, and you have the argument of
this ADR. ADR-0026 concluded that the appliance gets the real UI over the same contract,
not a lesser one, because two editions from one core (ADR-0003) is about the *core*, and a
person's first hour is not core.

The owner's framing was that GitOps-style file configuration "is reasonable" where an
operator team runs the thing, and "overkill" for the self-hosted Windows install. That is
the same split, drawn between personas rather than between editions — which is the correct
place to draw it, because the Docker operator and the MSI user are both "self-host".

## The question

Should the appliance be configurable through its own UI — and if so, what happens to the
config files that a working fleet already depends on?

## Decision

### 1. The UI is a first-class configuration door on the appliance

The appliance serves the same connections and mapping-management contract the managed
edition does, over the same routes, rendered by the same web app with no edition branch.
A Windows user who installs the MSI can add a source, add a target, test them, create a
mapping and run it **without opening a text editor**, and without knowing that a
`CONFIG_DIR` exists.

This is not a reduced or "basic" mode. ADR-0026's finding was that a deliberately lesser
appliance UI ends up serving nobody: the people who would tolerate it do not need it, and
the people who need it are not served by it.

The mechanism follows from the "what is true today" section: for objects the UI owns, the
appliance must build its connectors from the **ledger**, through the same
`buildDepsFromMapping` the managed worker uses, rather than from a `MappingConfig`. That is
the whole of the technical work, and it is the reason this is one contract rather than two
implementations of the same screen.

### 2. Files stay, first-class, unchanged, and are not deprecated

`CONFIG_DIR` keeps working exactly as it does. No migration step, no "legacy" label, no
warning banner. The fleet operator's arrangement is not a transitional state on the way to
a database, and a product that treats it as one has misread who is running it.

Concretely: a mapping declared in a file is loaded, scheduled and run the way it is today;
`loadConfigDir`'s fail-fast on an invalid file or a duplicate `mappingId` is unchanged; the
`passwordFromEnv` / `tokenFromEnv` indirection is unchanged, and remains the only way to
configure the appliance with **no secret at rest in its own storage** — which is a property
some operators specifically want, and which the UI path by definition cannot offer.

### 3. Ownership is per object, and the two sources are never merged

Every connection and every mapping is owned by exactly one of the two doors, and the row
records which:

- **File-owned** — seeded from a `*.json` under `CONFIG_DIR`, with the file's path stored
  on the row. The UI **shows** it in full, and refuses to edit it by **naming the file**:
  *"This mapping is defined in `C:\ProgramData\OpenMigrate\config\acme.json`. Edit it
  there, or remove it there to manage it here."* Read-only, visible, and explained — not
  hidden, and not silently editable.
- **UI-owned** — created through the API, credentials in the appliance's own secret store,
  never written to a file and never touched by the loader.

There is no merge, no precedence rule, and no "the file wins on restart". A merge has
exactly two failure modes and both are silent: the file quietly overwrites what somebody
typed into the UI at the next restart, or the UI quietly shadows the file that an operator
believes is their source of truth. A named refusal is worse for nobody and honest for
everybody.

Two edges follow, and both are decided rather than left to be discovered:

- **A file disappears.** The rows it owned stop being scheduled, and are **kept** and
  marked as declared by a file that is no longer present. They are not deleted: deleting a
  connection cascades to its mailboxes and to the entire item ledger beneath them, which is
  the reason the managed edition refuses that delete while anything uses it (workplan 0066
  T1). The UI offers the two honest choices — *adopt it into the UI* (which requires
  re-entering the credentials, since the environment variable it named may be gone) or
  *delete it and its history*. Silently continuing to sync something the operator removed
  from Git would be the worst of the three.
- **Identity collisions cannot happen by accident**, because file-owned ids are derived
  (`uuidFromString(tenantId + ':mapping:' + mappingId)`) and UI-owned ids are random. If
  one ever does occur, the appliance refuses to start and names both claimants, matching
  `loadConfigDir`'s existing behaviour for two files claiming one `mappingId`.

### 4. The appliance gets a secret store, and generates its own key

Storing credentials from the UI requires an encryption key, and `SecretStore` currently
demands `SECRET_ENCRYPTION_KEY` from the environment — which is precisely the thing the
Windows user must not be asked for.

On first run, if no key is configured, the appliance **generates one** into its data
directory (`secret.key` beside the PGlite directory), mode `0600` on POSIX and ACL'd on
Windows to exactly the principals `install-task.ps1` already grants on `secrets.cmd`
(Administrators, SYSTEM, the run-as account — nobody else). `SECRET_ENCRYPTION_KEY` still
wins when it is set, so the fleet operator who already manages keys in their environment
keeps doing that and no key file is created. If a key file exists **and** the environment
sets a different key, the appliance refuses to start and says so, rather than starting up
and failing to decrypt every credential it holds.

The limitation is stated rather than buried: **a key file beside the ciphertext is not
protection against someone who can read the disk.** It protects against the realistic
appliance accidents — a PGlite directory copied into a backup, a support bundle, a cloned
VM, a disk sent for warranty — and against every other local user, which is the same
threat `secrets.cmd`'s ACL addresses and the same bar. It is not a claim of protection
against a compromised host, and `packages/core/src/secret-store.ts` already says so for
the managed edition.

Two consequences the runbook must carry: the key is **part of the backup** (losing it
loses the stored credentials — recoverable by re-entering them, since ADR-0020 makes the
ledger itself rebuildable, but not by any clever means), and `collect-evidence.ps1` reports
the key file's **ACL and never its contents**, exactly as it already does for `secrets.cmd`.

### 5. What does not change

- Hard rule 5: both editions run the same core. This ADR adds a door to the appliance; it
  does not add a feature the managed edition lacks or vice versa.
- The appliance stays single-operator behind its own perimeter. These routes get no
  authentication of their own, for the same reason every other appliance route has none —
  stated here so it is a decision and not an oversight, and so that the day the appliance
  grows multi-user access, this is on the list.
- `no-managed-leakage` continues to hold. `@openmig/orchestration` is already inside the
  appliance's permitted import graph, so reusing `buildDepsFromMapping` does not weaken it;
  if a future change would, the lock is the thing that says so.

## Decisions the owner left open

Both were put to the owner with a recommendation; both came back *no preference*. Recording
them here with the reasoning is the point — they are judgement calls, not findings, and
they are the two lines in this ADR most likely to deserve reversing.

**Do files survive at all?** Yes — decision 2. The alternative, "the UI becomes the only
way and files become an import step", is a smaller product with less to explain, and it
breaks a working arrangement for the persona most able to notice. Nobody is asking for it
to be taken away.

**Where does the encryption key live?** A generated file in the data directory — decision
4. The alternative worth taking seriously is prompting the operator for a passphrase and
deriving the key from it, which is genuinely stronger: the key is then not on the disk. It
is rejected because it makes the appliance **unable to start unattended**, and surviving a
power cut without a human present is a stated value of this product for intermittently
attended hosts — it was proven deliberately on real hardware (runbook phase 3, hard kill
mid-sync). Trading unattended restart for a threat model the design does not otherwise
claim is the wrong trade. If the owner wants the passphrase, it should be an *option* on
top of the key file, never the only path.

## Consequences

**Easier.** The Windows install becomes a product rather than a scaffold: install, open the
shortcut, work through the setup checklist that workplan 0061 just built, add the
connection it tells you to add, create the mapping. The setup checklist stops being advice
about a form the appliance does not have. `docs/windows-appliance-runbook.md` loses its
longest and most error-prone section — the one that currently has to explain an ACL bug and
a `takeown` workaround for a file whose only purpose is to hold two passwords.

**Harder.** Two sources of configuration is genuinely more surface than one: two ways in,
an ownership field on two tables, a refusal path, a startup collision check, and a UI that
must render "you cannot edit this here" convincingly enough that nobody assumes it is a bug.
The appliance also gains real secret storage, which is a thing it currently — and
enviably — does not have to defend.

**Riskier, and worth naming.** The appliance's credentials are at rest on the appliance for
the first time. Today an appliance that is stolen or imaged yields configuration and a
migration ledger; after this it can yield credentials too, to anyone who takes the key file
along with the database. That is the cost of the Windows user not having to edit
`secrets.cmd`, it is the same cost the managed edition already carries, and the operator who
does not want to pay it keeps the file path, which is decision 2's other reason to exist.

**Neutral.** The shared web app needs no edition branch for these pages, which is one fewer
`isSelfHost` in the UI — the same direction ADR-0026 pushed.

## Alternatives considered

**Leave it: files only, and document them better.** The status quo, and the honest version
of what the code does today. Rejected because no amount of documentation converts "edit two
files and restart a scheduled task" into something ADR-0027's persona will do, and because
the setup checklist and connections work already shipped assumes a door the appliance does
not have.

**UI only: the appliance's config lives in its database, files become a one-time import.**
Tidier, one source of truth, no ownership field, no collision check. Rejected because it
removes a working arrangement from the fleet operator to solve a problem they do not have,
and because `passwordFromEnv` is the only configuration path that keeps no secret at rest —
a property worth keeping available even though most installs will not choose it.

**Merge them: files seed defaults, the UI overrides.** The obvious compromise, and the one
that fails quietly. Whichever side is chosen as the winner, the other side's edits vanish
without an error — and the person who loses is the one who was most confident, because they
were editing the thing they believed was authoritative. Per-object ownership costs one
column and buys a refusal that names a file path.

**A UI that writes the config files.** Superficially the best of both: the fleet operator's
files stay authoritative, the Windows user never opens an editor. Rejected because a
generated file is not a file an operator owns — comments and formatting do not survive, a
Git working tree acquires changes nobody made, and the moment the file is also
hand-editable there is a read-modify-write race between a text editor and a web form. It
also does not solve secrets, which are the actual pain: they are in the environment, not in
the file, and a UI writing `secrets.cmd` is a web form generating a batch script.
