# ADR-0034: Personal, Organisation, Managed — naming the deployments, and giving each the configuration door it needs

- **Status:** Proposed — the decisions below await an accept/reject, but two inputs to them
  are settled owner decisions (2026-08-17): the **names** in decision 1 (Personal /
  Organisation / Managed, with edition left as ADR-0003 defined it), and that an
  Organisation deployment's ~1000 is **migrated accounts operated by a small admin team**,
  not a thousand interactive logins.
- **Date:** 2026-08-17
- **Deciders:** owner (who also delegated the two questions in "Decisions the owner left
  open", below, answering *no preference* to both — so those two are recorded as mine,
  with the reasoning, and are the easiest part of this ADR to overrule)
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

### "Self-host" is one word for two deployments (decision 1 names them)

This is the part the first draft of this ADR got wrong, and the owner corrected: I treated
"self-host" as one persona and borrowed the SAD's word for them — *hobbyist*. It is one
**edition** covering two **deployments** whose operators have almost nothing in common, and
the edition flag does not tell them apart.

**Self-host as a service.** An operator runs the Docker Compose stack on real hardware and
migrates an organisation with it — the owner's stated ceiling is **around a thousand
end users**. Operationally this is the managed service with a different owner of the box:
GitOps, IaC, a secret manager, config in version control, CI, staged upgrades. For this
person a directory of mapping files is not a tax, it is the **only** workable interface —
a thousand mappings are generated, reviewed in a diff, and rolled back as a commit. Nobody
types a thousand of anything into a wizard.

**Self-host as a personal appliance.** One person installs the MSI on their own Windows
machine to move their own mail, or their small company's. ADR-0027 exists for exactly this
person and states the goal without hedging: a single `.msi`/`.exe` where **"end users never
touch bash, a Linux filesystem, or Docker."** What they are asked to do today, after the
installer finishes, is: copy a JSON example, edit it in a text editor with no schema, save
it under a name ending `.json` and not `.example`, open a second file that is a Windows
*batch script*, add `set` lines to it, and restart a scheduled task. When it does not work,
the diagnosis is a log file. Every step is a text file edited by hand — bash's ergonomics
with none of bash's tooling. The MSI got them to the front door and handed them a config
file.

**The managed operator**, for completeness: has neither problem. Everything is in the
ledger, created through the same UI and the same API.

### So the axis is not the edition, and files do not mean "small"

The first draft implied that config files were the small deployment's path and the UI was
the big one's. It is the reverse, and stating it correctly changes the design:

> **Files scale up. The UI scales down.**

A thousand mappings are declarative, generated and version-controlled; one mapping is a
form somebody fills in once. The discriminator is therefore **how a deployment is
configured and by whom** — a runtime property — not `SELFHOST`, which is a build flag that
both of these deployments set. Any design keyed off the edition flag will serve one of
these two people badly, which is precisely what shipping "connections management is
managed-only" did.

That also means this is not a two-way split with a middle. A served self-host deployment
wants files for the bulk *and* the UI for the one-off correction, the credential rotation,
the connection somebody added last week. Both doors, one deployment.

### The scale claim contradicts the tree, and that is a finding

The owner's "multi-end-user, possibly a thousand" is **not** what this repository currently
says, in either the documents or the code:

| Where | What it says today |
|---|---|
| SAD §3 | "self-host (**hobbyist**)" |
| SAD §4.1, §7 | "NAS/Pi/Spark, **optionally single-user**" |
| SAD §7.1 | heading: "Self-host edition (**the hobbyist**)" |
| SAD §7.3 | Auth row: self-host = "**local / single-user**" |
| SAD §8 | "there is a **single tenant**" |
| `apps/selfhost/src/index.ts` | "**The bind IS the auth boundary** … the appliance has **NO authentication** — anyone who can reach port N can operate it, including apply and finish" |

Recording that plainly rather than quietly adopting the new number, because the last
correction in this area came from exactly the opposite mistake — writing an inference in
the voice of a settled decision. The owner is the decider and the intent is now stated, so
**the divergence is the tree's to fix**: §3/§4.1/§7/§7.1/§8's hobbyist and single-tenant
language is wrong for the deployment the owner has in mind, and this ADR's Consequences
name that as work rather than assuming it away.

One consequence is immediate and not cosmetic — see decision 6.

### The precedent this project already set

ADR-0026 answered a structurally identical question about *operating* the appliance, and
its sentence transfers without modification:

> An MSI that installs an appliance whose only operating surface is `curl` does not serve
> the person the installer exists for.

Replace `curl` with Notepad and operating with configuring, and you have the argument of
this ADR. ADR-0026 concluded that the appliance gets the real UI over the same contract,
not a lesser one, because two editions from one core (ADR-0003) is about the *core*, and a
person's first hour is not core.

The owner's framing was that GitOps-style file configuration is reasonable for the managed
service **and for a served self-host deployment**, and overkill for the personal Windows
install. That is the same split, drawn between deployments rather than between editions —
which is the only place it can be drawn, because the two people it separates are both
"self-host".

## The question

Should the appliance be configurable through its own UI — and if so, what happens to the
config files that a working fleet already depends on?

## Decision

### 1. Name the two axes, and stop using one word for both

The confusion above is not a writing problem, it is the **cause** of the wrong decision in
workplan 0066: "the appliance configures itself from files" was a true statement about one
deployment applied to a word that covers two. Fix the vocabulary first, because every other
decision here refers to it.

There are **two independent axes**, and conflating them is the original mistake:

**Axis 1 — deployment shape: who operates it, and for how many people.**

| Name | Who runs it | Whose data | Bind | Edition |
|---|---|---|---|---|
| **Personal** | one person, on their own machine | their own (or a handful) | loopback | self-host |
| **Organisation** | a **small admin team**, on the org's hardware | that org's users — up to ~1000 **migrated accounts** | network | self-host |
| **Managed** | us, for many organisations | many orgs' users | network | managed |

The Organisation row's number is **migrated accounts, not interactive logins** (owner
decision, 2026-08-17). A thousand people's mail moves; a handful of admins operate it, and
the migrators never sign in. That bound is load-bearing — it is what makes decision 6's
prerequisite an admin login rather than a multi-user identity programme.

**Edition stays what ADR-0003 made it** — `self-host` | `managed`, a *build* distinction —
and gains a runtime companion, `deployment` ∈ `personal` | `organisation` | `managed`. The
self-host edition serves the first two. That is the whole point: **the edition flag cannot
tell Personal from Organisation, and almost every decision in this document depends on
telling them apart.** Any code keyed off `isSelfHost` for a question that is really about
deployment shape is a bug waiting for one of those two people.

**Axis 2 — configuration surface: how an object got here.**

| Name | What it means |
|---|---|
| **Declared** | defined in a file under `CONFIG_DIR`; the file is authoritative; GitOps-shaped |
| **Operated** | created through the UI/API; the ledger is authoritative |

These are per **object**, not per deployment — decision 3 is exactly this — so an
Organisation deployment can declare nine hundred mappings and operate the three somebody
added last week, with no ambiguity about which is which.

**Personas (people, not deployments)**, because the same human wears several hats in
Personal and none of them in Managed:

| Persona | What they do | Personal | Organisation | Managed |
|---|---|---|---|---|
| **Migrator** | the person whose mail is being moved | same human | an end user, may never log in | an end user |
| **Migration operator** | chooses scope, runs and verifies migrations | same human | the org's admin | the customer's admin |
| **Platform operator** | owns the hardware, upgrades, secrets, backups | same human | the org's IT | **us** |

Read down the columns and the design falls out. In **Personal** all three are one person, so
there is nobody to authenticate against and nobody to keep secrets from — the UI is the only
sane surface. In **Organisation** they are two or three different people and the migrators
are a crowd, so authentication is not optional and files are the bulk interface. In
**Managed** the platform operator is a different *company*, which is why that edition has had
a real auth story from the start.

The rest of this ADR uses these words. Where the tree uses "the appliance" to mean both
Personal and Organisation, it now means whichever the sentence says.

### 2. The UI is a first-class configuration door on the self-host edition

The self-host edition serves the same connections and mapping-management contract the
managed edition does, over the same routes, rendered by the same web app with no edition
branch. A **Personal** user who installs the MSI can add a source, add a target, test them,
create a mapping and run it **without opening a text editor**, and without knowing that a
`CONFIG_DIR` exists. An **Organisation** deployment gets the same door for the work that is
genuinely one-off — a rotation, a correction, the connection somebody added last week —
subject to decision 6.

This is not a reduced or "basic" mode. ADR-0026's finding was that a deliberately lesser
appliance UI ends up serving nobody: the people who would tolerate it do not need it, and
the people who need it are not served by it.

The mechanism follows from the "what is true today" section: for objects the UI owns, the
appliance must build its connectors from the **ledger**, through the same
`buildDepsFromMapping` the managed worker uses, rather than from a `MappingConfig`. That is
the whole of the technical work, and it is the reason this is one contract rather than two
implementations of the same screen.

### 3. Files stay, first-class, unchanged, and are not deprecated

`CONFIG_DIR` keeps working exactly as it does. No migration step, no "legacy" label, no
warning banner. The fleet operator's arrangement is not a transitional state on the way to
a database, and a product that treats it as one has misread who is running it.

Concretely: a mapping declared in a file is loaded, scheduled and run the way it is today;
`loadConfigDir`'s fail-fast on an invalid file or a duplicate `mappingId` is unchanged; the
`passwordFromEnv` / `tokenFromEnv` indirection is unchanged, and remains the only way to
configure the appliance with **no secret at rest in its own storage** — which is a property
some operators specifically want, and which the UI path by definition cannot offer.

### 4. Ownership is per object, and the two sources are never merged

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

### 5. The appliance gets a secret store, and generates its own key

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

### 6. Authentication is a prerequisite for an Organisation deployment, not a later nicety

The first draft of this ADR waved this through: *"the appliance stays single-operator behind
its own perimeter; these routes get no authentication of their own, like every other
appliance route."* That was true of the deployment I had in mind and false of the one the
owner described, and the difference is not cosmetic — **this ADR is what makes it
dangerous.**

Today the self-host edition holds no credentials at all (they live in the operator's
environment) and its own boot log says the quiet part out loud: *"the appliance has NO
authentication — anyone who can reach port N can operate it, including apply and finish."*
Adding a UI that **stores and edits credentials** to an unauthenticated surface turns
"anyone on the network can operate this" into "anyone on the network can add a source
pointing at their own server, rotate a credential, or read which accounts are being
migrated". On a machine serving hundreds of people's mailboxes, the bind is not a
sufficient auth boundary and it never was; it was only ever adequate because the surface
was small and the secrets were somewhere else.

So, as a hard sequencing constraint rather than a wish:

- **The personal appliance** (loopback bind, one operator, one person's data) may ship the
  UI door with the bind as its boundary, unchanged. That is what it is today and this ADR
  does not weaken it.
- **A served deployment** — anything bound off loopback — **must not expose the
  credential-editing routes without authentication.** Until authentication exists, the
  honest options are that those routes refuse on a non-loopback bind, or that the
  deployment keeps using files, which is the path it wants anyway.

**And it is a small prerequisite, because of how the owner bounded the scale.** The ~1000 is
migrated accounts, not interactive logins: the migrators never sign in, a handful of admins
operate everything. So what decision 6 demands is **an admin login and a session** — one
identity boundary in front of an operator surface — not per-user identity, not RBAC, not
per-migrator scoping. That is a well-understood, contained piece of work, which is the
difference between a prerequisite worth stating and one that would quietly kill the feature.

If end-user login is ever wanted, the decisions that would need revisiting are named: this
one, the ledger's single-tenant assumption on the self-host path, and every route that
currently treats "the operator" as one person.

Authentication for the self-host edition is still **its own decision and its own ADR**; SAD
§7.3 records self-host auth as "local / single-user", which is the row that has to change
first. What this ADR commits to is only the ordering: the credential-editing door does not
reach an Organisation deployment ahead of it.

> **Update 2026-08-17 — decision 6 is restated by [ADR-0035](./0035-who-signs-in-and-who-gets-a-link.md).**
> Appended rather than edited, per hard rule 7. Decision 6 and its bound both **hold**: the
> owner's "not a thousand interactive logins" survives, because ADR-0035 gives migrated
> people a signed, mapping-scoped **link** rather than an account — they authenticate to
> their own provider, never to open-migrate, and hold no session, password or role here.
> What ADR-0035 adds is that there are now **two** boundaries of different shapes: the admin
> login this decision demands, in front of the operator surface; and the migrator's link, in
> front of exactly one mapping. Neither is RBAC. Read decision 6 with that addition — its
> sequencing constraint is unchanged, and the credential-editing door still must not reach a
> served deployment ahead of the admin login.

### 7. What does not change

- Hard rule 5: both editions run the same core. This ADR adds a door; it does not add a
  feature one edition has and the other lacks.
- `no-managed-leakage` continues to hold. `@openmig/orchestration` is already inside the
  appliance's permitted import graph, so reusing `buildDepsFromMapping` does not weaken it;
  if a future change would, the lock is the thing that says so.

## Decisions the owner left open

Both were put to the owner with a recommendation; both came back *no preference*. Recording
them here with the reasoning is the point — they are judgement calls, not findings, and
they are the two lines in this ADR most likely to deserve reversing.

**Do files survive at all?** Yes — decision 3. The alternative, "the UI becomes the only
way and files become an import step", is a smaller product with less to explain, and it
breaks the only workable interface an Organisation deployment has. At the owner's stated
ceiling of ~1000 end users this is not a preference, it is arithmetic.

**Where does the encryption key live?** A generated file in the data directory — decision
5 — and the vocabulary makes the answer sharper than it was. This is the **Personal**
deployment's answer: there is one human, no secret manager, and the machine must come back
from a power cut without them. An **Organisation** deployment already runs a secret manager
and should set `SECRET_ENCRYPTION_KEY` from it, which decision 5 lets it do — so the key
file is a default for the deployment that has nowhere better, not a recommendation for the
one that does.

The alternative worth taking seriously is prompting for a passphrase and deriving the key,
which is genuinely stronger: the key is then not on the disk. Rejected because it makes the
appliance **unable to start unattended**, and surviving a power cut without a human present
is a stated value for intermittently attended hosts — proven deliberately on real hardware
(runbook phase 3, hard kill mid-sync). If the owner wants the passphrase it should be an
*option* on top of the key file, never the only path.

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

**Riskier, and worth naming.** The self-host edition's credentials are at rest on its own
disk for the first time. Today a stolen or imaged appliance yields configuration and a
migration ledger; after this it can yield credentials too, to anyone who takes the key file
along with the database. That is the cost of the Personal user not having to edit
`secrets.cmd`, it is the same cost the Managed edition already carries, and the operator who
does not want to pay it keeps the Declared path, which is decision 3's other reason to exist.

**Work this creates elsewhere, named rather than assumed.** (a) The SAD's self-host language
— §3 "hobbyist", §4.1/§7 "optionally single-user", §7.1's heading, §7.3's "local /
single-user" auth row, §8's "single tenant" — describes a product the owner is not building,
and should be corrected to the three deployments named in decision 1. (b) Authentication for
an Organisation deployment needs its own ADR, and decision 6 makes it a prerequisite rather
than a follow-up. (c) `isSelfHost` is used today for questions that are really about
deployment shape; each use needs re-reading against decision 1's two axes.

**Neutral.** The shared web app needs no edition branch for these pages, which is one fewer
`isSelfHost` in the UI — the same direction ADR-0026 pushed.

## Alternatives considered

**Leave it: files only, and document them better.** The status quo, and the honest version
of what the code does today. Rejected because no amount of documentation converts "edit two
files and restart a scheduled task" into something ADR-0027's persona will do, and because
the setup checklist and connections work already shipped assumes a door the appliance does
not have.

**UI only: config lives in the database, files become a one-time import.**
Tidier, one source of truth, no ownership field, no collision check. Rejected because it
takes the Organisation deployment's only workable interface away to solve a problem it does
not have, and because `passwordFromEnv` is the only configuration path that keeps no secret
at rest — a property worth keeping available even though most installs will not choose it.

**Merge them: files seed defaults, the UI overrides.** The obvious compromise, and the one
that fails quietly. Whichever side is chosen as the winner, the other side's edits vanish
without an error — and the person who loses is the one who was most confident, because they
were editing the thing they believed was authoritative. Per-object ownership costs one
column and buys a refusal that names a file path.

**Keep one word and qualify it in prose** ("self-host, but the big kind"). Rejected: that
is what the tree does today, and it is how "the appliance configures itself from files"
became a rule applied to a deployment it was never true of. A distinction that only exists
in the reader's head is not a distinction the code can honour — decision 1 gives it a name
precisely so `isSelfHost` stops being asked a question it cannot answer.

**Split the edition instead — make Personal a third edition.** Superficially cleaner: one
axis, three values, and `isPersonal` answers everything. Rejected because Personal and
Organisation run the *same build* and differ only in how they are deployed and by whom, so a
third edition would fork packaging, CI and release for a difference that is entirely runtime.
ADR-0003's two editions stay two; the deployment axis is the new one.

**A UI that writes the config files.** Superficially the best of both: the fleet operator's
files stay authoritative, the Windows user never opens an editor. Rejected because a
generated file is not a file an operator owns — comments and formatting do not survive, a
Git working tree acquires changes nobody made, and the moment the file is also
hand-editable there is a read-modify-write race between a text editor and a web form. It
also does not solve secrets, which are the actual pain: they are in the environment, not in
the file, and a UI writing `secrets.cmd` is a web form generating a batch script.
