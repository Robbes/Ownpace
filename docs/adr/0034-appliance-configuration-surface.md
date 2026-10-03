# ADR-0034: Personal, Organisation, Managed — naming the deployments, and giving each the configuration door it needs

- **Status:** Accepted 2026-09-20 (owner: "yes on all 3"); amended 3 times while proposed
  (latest 2026-08-19) and accepted as amended; consolidated 2026-10-03 (ADR-0051)
- **Date:** 2026-08-17; consolidated 2026-10-03
- **Deciders:** owner — the names and the ~1000 figure (2026-08-17), both open questions
  (2026-08-19), the accept (2026-09-20)
- **Relates to:** [ADR-0003](./0003-two-editions-one-core.md), [ADR-0026](./0026-one-operating-ui-one-contract.md),
  [ADR-0027](./0027-windows-packaging-shell.md), [ADR-0035](./0035-who-signs-in-and-who-gets-a-link.md)
  (restates decision 6), [ADR-0037](./0037-keys-credentials-and-transport-floors.md) (owns
  decision 5's key mechanics)
- **History:** the record as it read before consolidation, word for word —
  [history/0034-appliance-configuration-surface.md](./history/0034-appliance-configuration-surface.md)

## Operative rules

<!-- What holds NOW, within the ADR-0051 budget: 8 bullets, 60 words a bullet, 300 words in
     all. Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- Deployments are named **Personal / Organisation / Managed**, a runtime axis beside the
  edition; an Organisation's ~1000 is **migrated accounts run by a small admin team**, not
  interactive logins. A deployment-shape question is never answered with `isSelfHost`
  (decision 1).
- **Split by concern (owner, 2026-08-19):** topology's door is **files on Organisation (its
  sole door), the UI on Personal, the API/UI on Managed**; credentials and grants live in the
  one secret store everywhere (ADR-0037); `passwordFromEnv`/`tokenFromEnv` stays per
  connection. Files never hold secrets (decisions 2–4).
- No merge machinery: no ownership column, no collision check, no precedence rule. File-seeded
  rows record their origin path; Organisation's UI shows file topology read-only, naming the
  file. Deleting a file-declared connection revokes or parks its stored credential via
  `revokeStoredCredentials`, never orphans it (decision 4).
- The deployment mode is **explicit**, Personal by default. Contradictions refuse loudly,
  naming the fix: Personal with files in `CONFIG_DIR` refuses to start; Organisation refuses a
  topology write through the UI/API (decisions 1, 3).
- Key mechanics are ADR-0037's (the env key wins; Personal generates a key file at first
  store). A key file plus a different `SECRET_ENCRYPTION_KEY` **refuses the start**; the key is
  part of the backup; evidence collection reports its ACL, never its contents (decision 5).
- **Authentication is a prerequisite for Organisation** (decision 6, restated by ADR-0035):
  off loopback, credential-editing routes stay closed until an **admin login and session**
  exist — not per-user identity, not RBAC. Personal keeps its loopback bind as the boundary;
  migrated people get a link, never an account.

## Context

The appliance was built to be configured by a directory of JSON files and a set of environment
variables, and nothing else. `loadConfigDir` reads every `*.json` under `CONFIG_DIR`
(`/data/config`, or `C:\ProgramData\OpenMigrate\config` on Windows), validates each against the
shared mapping schema and fails fast on an invalid file or a duplicate `mappingId`. A mapping
never holds a secret: it names one (`passwordFromEnv`, `tokenFromEnv`), and on Windows that
environment is `config\secrets.cmd`, a batch file of `set` lines filled in by hand. The
appliance's `connection` rows are **bookkeeping, not configuration**: seeded
`ON CONFLICT (id) DO NOTHING` with a placeholder `config`, read by no code path that opens a
connection, there only because `mailbox` and `group_def` have foreign keys to them. A
connections page on the appliance would have had **nothing to edit**.

[Workplan 0066](../workplans/0066-deletion-overrides-and-editions.md) T3 had recorded "an
appliance's connections come from mapping FILES" as settled architecture. It was
[workplan 0010](../workplans/0010-selfhost-edition.md)'s implementation choice for a first
slice; the owner asked why, and this ADR is the answer.

"Self-host" is one **edition** covering two **deployments** whose operators have almost nothing
in common. An organisation's operator runs the Docker Compose stack for up to about a thousand
end users, with GitOps, a secret manager and config in version control; for them a directory of
mapping files is the only workable interface. One person installing the MSI on their own
Windows machine, the person ADR-0027 exists for, is asked to edit JSON with no schema, add `set`
lines to a batch script and restart a scheduled task. **Files scale up; the UI scales down.** The
discriminator is how a deployment is configured and by whom, a runtime property, not `SELFHOST`,
a build flag both deployments set. ADR-0026's precedent transfers: an appliance whose only
configuration surface is Notepad does not serve the person the installer exists for.

The owner's scale is not what the tree says. The SAD calls self-host "hobbyist", "optionally
single-user" and "single tenant", and the appliance, bound off loopback, warns at boot that it
has **no authentication**. The divergence is the tree's to fix (Consequences), and the last of
those facts is why decision 6 exists.

## Decision

One table carries the shape, the **split by concern** that the owner's answers produced on
2026-08-19; decisions 2–4 spell it out.

| concern | Personal | Organisation | Managed |
|---|---|---|---|
| **topology** (mappings, connections, schedules) | UI | **files** (sole door) | API/UI |
| **credentials & grants** | store (UI / grant link) | store (UI / grant link) | store |
| escape hatch | — | `passwordFromEnv`/`tokenFromEnv`, per connection | — |

### 1. Name the two axes, and stop using one word for both

**Deployment shape**: who operates it, and for how many people.

| Name | Who runs it | Whose data | Bind | Edition |
|---|---|---|---|---|
| **Personal** | one person, on their own machine | their own (or a handful) | loopback | self-host |
| **Organisation** | a **small admin team**, on the org's hardware | that org's users — up to ~1000 **migrated accounts** | network | self-host |
| **Managed** | us, for many organisations | many orgs' users | network | managed |

The Organisation figure is **migrated accounts, not interactive logins** (owner, 2026-08-17):
a thousand people's mail moves, a handful of admins operate it, and the migrators never sign
in. That bound is what keeps decision 6 small.

**Edition stays what ADR-0003 made it** (`self-host` | `managed`, a build distinction) and
gains a runtime companion, `deployment` ∈ `personal` | `organisation` | `managed`, **declared
explicitly in the environment, Personal by default**. The edition flag cannot tell Personal
from Organisation, so code that keys a deployment-shape question off `isSelfHost` is a bug
waiting for one of those two people.

**Configuration surface**: how an object got here. **Declared** means defined in a file under
`CONFIG_DIR`, which is authoritative (GitOps-shaped); **Operated** means created through the
UI or API, with the ledger authoritative. Which one applies follows from the concern and the
deployment (the table above), never from a choice made per object.

**Personas** are people, not deployments:

| Persona | What they do | Personal | Organisation | Managed |
|---|---|---|---|---|
| **Migrator** | the person whose mail is being moved | same human | an end user, may never log in | an end user |
| **Migration operator** | chooses scope, runs and verifies migrations | same human | the org's admin | the customer's admin |
| **Platform operator** | owns the hardware, upgrades, secrets, backups | same human | the org's IT | **us** |

In Personal the three are one person: there is nobody to authenticate against, and the UI is
the only sane surface. In Organisation they are different people and the migrators are a crowd:
authentication is not optional, and files are the bulk interface. In Managed the platform
operator is a different company.

### 2. The UI is a first-class configuration door on the self-host edition

The UI is **Personal's topology door and the credential door in every deployment**. The
self-host edition serves the same connections and mapping-management contract as the managed
edition, over the same routes, rendered by the same web app with no edition branch. A Personal
user adds a source and a target, tests them, creates a mapping and runs it **without opening a
text editor**, and without knowing that `CONFIG_DIR` exists. On Organisation the UI and the
grant link (ADR-0035) carry credentials and grants, and the UI shows file topology read-only
(decision 4); all of it subject to decision 6. It is not a reduced or "basic" mode: ADR-0026
found that a deliberately lesser appliance UI serves nobody.

For what the UI owns, the appliance builds its connectors from the **ledger**, through the same
`buildDepsFromMapping` the managed worker uses, rather than from a `MappingConfig`: one
contract, not two implementations of the same screen.

### 3. Files are Organisation's sole topology door, first-class and not deprecated

On Organisation, `CONFIG_DIR` keeps working exactly as it does: a mapping declared in a file is
loaded, scheduled and run as today, and `loadConfigDir`'s fail-fast on an invalid file or a
duplicate `mappingId` is unchanged. No "legacy" label, no warning banner: the fleet operator's
arrangement is not a transitional state on the way to a database. `passwordFromEnv` /
`tokenFromEnv` stays, per connection. It is the only way to configure a connection with **no
secret at rest** in the appliance's own storage, which some operators specifically want and the
store by definition cannot offer.

**Personal has no file door.** A contradiction between the declared mode and what is there
refuses loudly and names the fix. Personal with files present in `CONFIG_DIR` refuses to start,
naming the files and the mode switch; it never silently ignores configuration somebody wrote.
Organisation refuses a **topology** write that arrives through the UI or the API, naming the
file door; credential and grant writes are accepted everywhere. Today's file-configured fleet
upgrades with one environment variable, which the refusal itself names.

### 4. The doors are split by concern, and never merged

Topology and credentials are disjoint by construction: files never hold secrets, and the
credential flow never writes topology. Each concern has one door per deployment, so there is
**nothing to merge**: no ownership column, no collision check, no two-door edit rules, no
precedence rule, no "the file wins on restart". A merge fails in two ways and both are silent:
the file overwrites what somebody typed into the UI, or the UI shadows the file an operator
believes is authoritative.

Where the doors meet:

- **File-seeded rows record their origin path.** Organisation's UI shows file topology in full
  and refuses to edit it by **naming the file**: read-only, visible and explained; never
  hidden, never silently editable.
- **One lifecycle rule.** A file-declared connection may carry a store-held granted credential
  (disjoint fields, same row). Deleting the file revokes or parks that credential through the
  existing `revokeStoredCredentials` path; it is never orphaned.
- **Widening lands on the credential side.** ADR-0035's per-person grants widen the one source
  and target connection pair the appliance holds per tenant. The split is drawn so that
  topology (host, folders) stays shared and identities do not.

### 5. The appliance gets a secret store, and generates its own key

Credentials and grants live in the one store in every deployment, and `SecretStore` takes its
key from `SECRET_ENCRYPTION_KEY`, which is precisely what the Windows user must not be asked
for. The mechanics belong to [ADR-0037](./0037-keys-credentials-and-transport-floors.md) (one
`KeyProvider` seam, exactly two providers). This decision fixes:

- `SECRET_ENCRYPTION_KEY` **wins when set** (Organisation's secret manager, Managed), and no
  key file is created.
- Otherwise **Personal generates the key at first store**, not at boot, into its data directory
  (`secret.key` beside the PGlite directory): mode `0600` on POSIX, and ACL'd on Windows to
  exactly the principals `install-task.ps1` grants on `secrets.cmd` (Administrators, SYSTEM, the
  run-as account). A deployment that never stores a secret gains no key and no new knob; a
  credential that arrives where no key can be had is refused, naming the fix (ADR-0037).
- A key file **and** a different environment key **refuse the start**, rather than starting up
  and failing to decrypt every credential the appliance holds.

The limitation is stated, not buried: a key file beside the ciphertext is **no protection
against someone who can read the disk**. It answers every other local user, and a database
directory, dump or backup copied without it, which is the threat and the bar of `secrets.cmd`'s
ACL. Full-disk encryption answers device theft (ADR-0037), and
`packages/core/src/secret-store.ts` already disclaims a compromised host. The runbook carries two
consequences. The key is **part of the backup**: losing it loses the stored credentials,
recoverable only by re-entering them, because
[ADR-0020](./0020-ledger-rebuildable-cache-recovery.md) makes the ledger rebuildable and
credentials are not. And `collect-evidence.ps1` reports the key file's **ACL, never its
contents**, as it does for `secrets.cmd`.

### 6. Authentication is a prerequisite for an Organisation deployment, not a later nicety

A door that **stores and edits credentials** cannot sit on today's unauthenticated surface: on
it, anyone who can reach the port could add a source pointing at their own server, rotate a
credential, or read which accounts are being migrated. On a machine serving hundreds of
people's mailboxes the bind was never a sufficient boundary; it was adequate only while the
surface was small and the secrets were elsewhere. So, as a hard sequencing constraint:

- **Personal** (loopback bind, one operator, one person's data) ships the UI door with the bind
  as its boundary, unchanged.
- **Anything bound off loopback must not expose the credential-editing routes without
  authentication.** Until authentication exists, those routes refuse on a non-loopback bind, or
  the deployment keeps to files and environment variables, the path it wants anyway.

The prerequisite is small because of decision 1's bound: **an admin login and a session**, one
identity boundary in front of the operator surface, and not per-user identity, not RBAC, not
per-migrator scoping. ADR-0035 restates this decision and adds a second boundary of a different
shape: migrated people authenticate to their own provider through a signed **link**, never to
Ownpace, and hold no session, password or role here. The admin login stands in front of the
operator surface and the link in front of that person's own migrations only; neither is RBAC.

Authentication for the self-host edition is its own decision and its own ADR, starting with
SAD §7.3's self-host `Auth` row, "local / single-user", which becomes "admin login + session"
(ADR-0035). This ADR commits only to the ordering: the credential-editing door does not reach
an Organisation deployment ahead of the admin login. If end-user login is ever wanted, the
decisions to revisit are named: this one, the ledger's single-tenant assumption on the self-host
path, and every route that treats "the operator" as one person.

### 7. What does not change

- Hard rule 5: both editions run the same core. This adds a door; it does not add a feature
  one edition has and the other lacks.
- `no-managed-leakage` holds. `@openmig/orchestration` is already inside the appliance's
  permitted import graph, so reusing `buildDepsFromMapping` does not weaken it; if a future
  change would, the guard says so.

## Consequences

**Easier.** The Windows install becomes a product rather than a scaffold: install, open the
shortcut, work through the setup checklist
([workplan 0061](../workplans/0061-provider-setup-checklist.md)), add the connection it names,
create the mapping. The [runbook](../windows-appliance-runbook.md) loses its most error-prone
section, the `secrets.cmd` ACL and its `takeown` workaround. The shared web app needs no edition
branch for these pages: one fewer `isSelfHost` in the UI.

**Harder.** An explicit deployment mode and its refusals; a read-only rendering of file topology
convincing enough that nobody takes it for a bug; and real secret storage, which the appliance
did not have to defend before.

**Riskier.** Self-host credentials are at rest on the appliance's own disk for the first time:
a stolen or imaged appliance can yield them to anyone who takes the key file along with the
database. It is the cost Managed already carries and the price of the Personal user not editing
`secrets.cmd`. An Organisation operator who will not pay it keeps env indirection per
connection (decision 3).

**Work this creates elsewhere.** (a) The [SAD](../architecture/solution-architecture.md) still
calls self-host "hobbyist" (§2, and §7.1's heading), "optionally single-user" (§3, §7), "local /
single-user" (§7.3's `Auth` row) and "single tenant" (§8); it should name the three
deployments. (b) Authentication for an Organisation deployment needs its own ADR, and none
exists yet. (c) Each `isSelfHost` use needs re-reading against decision 1's two axes.

**Built, as of 2026-10-03.** Not the appliance side. `apps/selfhost` has no deployment mode, no
secret store or key file, no connections or credential routes and no origin-path column; it
still configures from files and environment variables, and still warns at boot, off loopback,
that it has no authentication. What has landed is the credential side the split anticipated:
the per-mapping credential (`mailbox_mapping.source_secret_ref`, ledger migration 0032), which
`buildDepsFromMapping` merges over the connection's and `revokeStoredCredentials` reads. The
setup-checklist comment in `apps/selfhost/src/index.ts` still calls the missing connections
management "a decision rather than an omission", the reasoning this ADR retracted.

## Alternatives considered

**Leave it: files only, documented better.** The status quo. Rejected: no documentation turns
"edit two files and restart a scheduled task" into something ADR-0027's person will do, and the
setup checklist and connections work already shipped assume a door the appliance did not have.

**UI only: config in the database, files a one-time import.** Tidier, with one source of truth.
Rejected: it takes away the only workable interface an Organisation deployment has (at ~1000
accounts that is arithmetic, not preference), and `passwordFromEnv` is the only configuration
path that keeps no secret at rest.

**Merge them: files seed defaults, the UI overrides.** The obvious compromise, and it fails
quietly: whichever side wins, the other side's edits vanish without an error, and the loser is
whoever was most confident they were editing the authoritative copy.

**Both doors on every object, ownership per row** (decisions 3 and 4 as first written). Files
and the UI open on every self-host deployment; each connection and mapping owned by one door,
recorded in an ownership column; file-owned ids derived and UI-owned ids random, with a startup
refusal naming both claimants if they ever collided; a vanished file's rows kept unscheduled and
offered for adoption into the UI or deletion with their history. Replaced on 2026-08-19 by the
split by concern: with one door per concern per deployment there is nothing to own, collide or
adopt, and that surface (two ways in, an ownership field on two tables, a collision check) goes.

**Split by deployment for everything: no secret store on Organisation.** The first shape of the
owner's answer. Rejected: a credential that arrives from a person at runtime, ADR-0035's grant
link and the product's central flow, has no environment variable, so the grown-up tier could not
run it. The owner's own challenge settled the shape (2026-08-19): *"why would we want to store
all possible secrets in files, while we can hold them also in DB like with grants and the UI we
have."*

**One word, qualified in prose** ("self-host, but the big kind"). Rejected: that is how "the
appliance configures itself from files" became a rule for a deployment it was never true of. A
distinction that exists only in the reader's head is not one the code can honour.

**Personal as a third edition.** One axis, three values, and `isPersonal` answers everything.
Rejected: Personal and Organisation run the same build and differ only in how they are deployed
and by whom, so a third edition would fork packaging, CI and release for a runtime difference.

**A UI that writes the config files.** Rejected: a generated file is not one an operator owns.
Comments and formatting do not survive, a Git working tree acquires changes nobody made, and a
text editor and a web form race on read-modify-write. It does not solve secrets either: a UI
writing `secrets.cmd` is a web form generating a batch script.

**A passphrase-derived key.** Genuinely stronger, since the key is then not on the disk.
Rejected as the only path: the appliance could not start unattended, and surviving a power cut
with nobody present is a stated value, proven on real hardware (runbook phase 3, hard kill
mid-sync). If it is ever wanted, it comes as an option on top of the key file (Argon2id,
ADR-0037).

**No authentication of its own, the bind as the boundary everywhere** (the first draft of
decision 6). True of Personal and false of the deployment the owner described; rejected for
anything bound off loopback, for the reasons in decision 6.

## Amendment log

- **2026-08-17** — Proposed, and revised the same day before anything was decided: the first
  draft treated self-host as one persona (the SAD's "hobbyist") and let the new routes ship
  without authentication. The owner set the names (decision 1) and the scale bound (~1000
  migrated accounts, not interactive logins); the auth clause became decision 6. Record:
  *"Self-host" is one word for two deployments (decision 1 names them)*, and decision 6.
- **2026-08-17** — Decision 6 restated by ADR-0035: it holds, with a second boundary, because
  migrated people get a signed link and not an account. Record: *Update 2026-08-17 — decision 6
  is restated by ADR-0035*.
- **2026-08-19** — Correction: the two open questions (do files survive; where does the key
  live) had been recorded as delegated on a *"no preference"* the owner never gave, an
  unanswered picker read as consent. Both were reopened as proposals; the owner: *"I do have a
  preference."* A decision log that can absorb a non-answer as an answer is worse than no log.
  Record: *The correction, first, because this ADR asserted something untrue about its own
  owner*.
- **2026-08-19** — Both questions answered by the owner; checked twice against the record, the
  answers became the split by concern. Decisions 2–5 amended: the UI is Personal's topology door
  and the credential door everywhere; files are Organisation's sole topology door and Personal
  has none; decision 4's ownership machinery is replaced; the key's mechanics move to ADR-0037,
  with the key required at first store. Record: *Now decided (owner, 2026-08-19) — and the shape
  the answers produced*, and the "Amended 2026-08-19" notes under decisions 2–5.
- **2026-09-20** — Accepted as amended (owner: "yes on all 3"); nothing changed.
- **2026-10-03** — Consolidated in place
  ([ADR-0051](./0051-an-adr-reads-as-it-stands.md)): written as the decision stands, decision
  numbers 1–7 kept, decisions 3 and 4 retitled to their amended meaning; decision 5's threat
  statement follows ADR-0037's.

The full record, word for word as it read before this consolidation:
[history/0034-appliance-configuration-surface.md](./history/0034-appliance-configuration-surface.md).
