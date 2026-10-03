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
- No two-door merge machinery: no ownership column, no collision check, no file-versus-UI
  precedence. File-seeded
  rows record their origin path; Organisation's UI shows file topology read-only, naming the
  file. Deleting a file-declared connection revokes or parks its stored credential via
  `revokeCredentialRow`, never orphans it (decision 4).
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

The appliance was built to be configured by JSON mapping files under `CONFIG_DIR` and by
environment variables, and nothing else. A mapping names its secret (`passwordFromEnv`,
`tokenFromEnv`) and never holds it; on Windows the environment is a hand-filled
`config\secrets.cmd`. The appliance's `connection` rows exist for foreign keys and are read by
nothing that opens a connection, so a connections page would have had **nothing to edit**.
[Workplan 0066](../workplans/0066-deletion-overrides-and-editions.md) T3 had called this settled
architecture; it was [workplan 0010](../workplans/0010-selfhost-edition.md)'s first-slice choice.

"Self-host" is one **edition** covering two **deployments**. An organisation running Docker
Compose for up to about a thousand end users, with GitOps and a secret manager, needs files. One
person installing the MSI, ADR-0027's person, should not have to edit JSON and a batch script.
**Files scale up; the UI scales down**, so the discriminator is a runtime property, not the
`SELFHOST` build flag both set. As ADR-0026 found for operating, an appliance whose only
configuration surface is Notepad does not serve the person the installer exists for.

## Decision

The shape is one table, the **split by concern** that the owner's answers produced on
2026-08-19. Decisions 2–4 spell it out. The owner's reasons: people on Personal work 99% in the
UI, and Organisation fits a DevOps or IT team that wants GitOps, or at least control from files.
Checked against the code, Organisation's overlap with Managed is on **secrets**, not
configuration: managed tenants configure through the API (the UI's door), so on topology Managed
sits with Personal; on secrets, Organisation and Managed both have someone who already runs
secret management, and Personal has nobody.

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

The Organisation figure is **migrated accounts, not a thousand interactive logins** (owner,
2026-08-17): the migrators never sign in, which keeps decision 6 small. **Edition stays what
ADR-0003 made it**, a build distinction, beside a runtime `deployment` ∈ `personal` |
`organisation` | `managed`; the self-host edition serves the first two, **declared in the
environment, Personal by default**. The edition
flag cannot tell Personal from Organisation, so keying a deployment-shape question off
`isSelfHost` is a bug.

The second axis, **configuration surface**: an object is **Declared** (a file under
`CONFIG_DIR` is authoritative) or **Operated** (UI or API; the ledger is): by concern, and for
topology by deployment; never chosen per object, except the environment escape hatch, which
Organisation chooses per connection.

**Personas** are people, not deployments: the **migrator** (whose mail moves), the **migration
operator** (runs and verifies migrations) and the **platform operator** (hardware, upgrades,
secrets, backups). In Personal they are one human, so the UI is the only sane surface; in
Organisation the migrators are a crowd, so authentication is not optional; in Managed the
platform operator is us.

### 2. The UI is a first-class configuration door on the self-host edition

The UI is **Personal's topology door and the credential door in every deployment**: the managed
edition's contract, over the same routes, in the same web app with no edition branch, and not a
reduced "basic" mode (ADR-0026: a lesser appliance UI serves nobody). A Personal user goes from
source to running mapping **without opening a text editor**. On Organisation the UI and the grant
link (ADR-0035) carry credentials and grants, subject to decision 6. For what the UI owns, the
appliance builds its connectors from the **ledger** through the same `buildDepsFromMapping` the
managed worker uses, not from a `MappingConfig`.

### 3. Files are Organisation's sole topology door, first-class and not deprecated

On Organisation, `CONFIG_DIR` works exactly as it does, including `loadConfigDir`'s fail-fast on
an invalid file or a duplicate `mappingId`, with no "legacy" label and no banner.
`passwordFromEnv`/`tokenFromEnv` stays per connection: the only way to keep **no secret at
rest** in the appliance's storage. **Personal has no file door.** Contradictions refuse loudly
and name the fix: Personal with files in `CONFIG_DIR` refuses to start, naming the files and the
mode switch; Organisation refuses a **topology** write through the UI or API, naming the file
door. The mode refuses no credential or grant write. A file-configured fleet upgrades by setting
the one environment variable the refusal names.

### 4. The doors are split by concern, and never merged

Topology and credentials are disjoint by construction (files never hold secrets; the credential
flow never writes topology), and each concern has one door in a deployment. So there is **nothing to
merge**: no ownership column, no collision check, no two-door edit rules, no precedence such as
"the file wins on restart". A merge fails silently either way: the file overwrites what somebody
typed, or the UI shadows the file an operator believes is authoritative. Where the doors meet:

- **File-seeded rows record their origin path.** Organisation's UI shows file topology in full
  and refuses to edit it by **naming the file**.
- A file-declared connection or mapping may carry a store-held granted credential (disjoint
  fields). **Deleting the file revokes or parks that credential** through `revokeCredentialRow`,
  the per-row half of `revokeStoredCredentials`; it is never orphaned. What becomes of a removed
  file's rows beyond its credential is not decided here — deleting them would cascade to their
  mailboxes and the item ledger beneath them.
- When grants by migrated people (ADR-0035) reach the appliance, they widen its one source and
  target connection pair per tenant on the credential side only: topology (host, folders) is
  shared, identities are not.

### 5. The appliance gets a secret store, and generates its own key

`SecretStore` takes its key from `SECRET_ENCRYPTION_KEY`, which the Windows user must not be
asked for. [ADR-0037](./0037-keys-credentials-and-transport-floors.md) owns the mechanics (one
`KeyProvider` seam, two providers). This decision fixes:

- `SECRET_ENCRYPTION_KEY` **wins when set** (Organisation's secret manager, Managed); no key
  file is created.
- Otherwise **Personal generates the key at first store**, not at boot: `secret.key` beside the
  PGlite directory on every platform, mode `0600` on POSIX, ACL'd on Windows to exactly the
  principals `install-task.ps1` grants on `secrets.cmd` (Administrators, SYSTEM, the run-as
  account), and nobody else: the same threat that ACL addresses, and the same bar — not a claim
  of protection against a compromised host. Never storing a secret means never needing a key.
- A key file **and** a different environment key **refuse the start**, rather than failing to
  decrypt every credential.

The key file is **no protection against someone who can read the disk**. It answers other local
users and a database or backup copied without it; full-disk encryption answers device theft
(ADR-0037). The runbook must say the key is **part of the backup**: without it the stored
credentials can only be re-entered, because [ADR-0020](./0020-ledger-rebuildable-cache-recovery.md)
makes the ledger rebuildable and credentials are not. `collect-evidence.ps1` reports the key
file's **ACL, never its contents**.

### 6. Authentication is a prerequisite for an Organisation deployment, not a later nicety

On today's unauthenticated surface, a door that **stores and edits credentials** would let
anyone who reaches the port add a source pointing at their own server, rotate a credential or
read which accounts are being migrated. So, as a hard sequencing constraint:

- **Personal** (loopback bind, one operator, one person's data) may ship the UI door with the bind
  as its boundary.
- **Anything bound off loopback must not expose the credential-editing routes without
  authentication.** Until it exists, those routes refuse on a non-loopback bind, or the
  deployment keeps to files and environment variables.

The prerequisite is small because of decision 1's bound: **an admin login and a session** in
front of the operator surface, not per-user identity, not RBAC, not per-migrator scoping.
ADR-0035 restates this decision and adds a second boundary: migrated people get a signed
**link** in front of exactly the migrations it names, authenticate to their own provider, and
hold no session, password or role here. Neither boundary is RBAC.

Self-host authentication gets its own ADR, starting with SAD §7.3's self-host `Auth` row ("local
/ single-user" becomes "admin login + session", ADR-0035); this ADR fixes only the ordering.
End-user login, if ever wanted, reopens this decision, the ledger's single-tenant assumption on
the self-host path, and every route that treats "the operator" as one person.

### 7. What does not change

- Hard rule 5: both editions run the same core. This adds a door, not a feature one edition
  lacks.
- `no-managed-leakage` holds: `@openmig/orchestration` is already inside the appliance's
  permitted import graph, so reusing `buildDepsFromMapping` does not weaken it.

## Consequences

**Easier.** The Windows install becomes a product: install, follow the setup checklist
([workplan 0061](../workplans/0061-provider-setup-checklist.md)), add the connection, create the
mapping. The [runbook](../windows-appliance-runbook.md) loses its most error-prone section, the
`secrets.cmd` ACL and its `takeown` workaround.

**Harder and riskier.** A mode switch and its refusals; a read-only view of file topology that
nobody mistakes for a bug; and credentials at rest on the appliance's disk for the first time,
which a stolen or imaged appliance yields to whoever also takes the key file. Managed already
carries that cost; an Organisation operator who will not pay it keeps env indirection per
connection.

**Work elsewhere.** (a) The [SAD](../architecture/solution-architecture.md) still says
"hobbyist", "optionally single-user", "local / single-user" and "single tenant" (§2, §3, §7,
§7.1, §7.3, §8); it should name the three deployments. (b) Organisation authentication needs its
own ADR; none exists yet. (c) Each `isSelfHost` use needs re-reading against decision 1.

**Built, as of 2026-10-03.** None of the appliance side: `apps/selfhost` has no mode, credential store, key
file, credential routes or origin path, still warns at boot, off loopback, that it has no
authentication, and still carries a comment calling the missing connections management "a
decision rather than an omission"; it stores no credential. On managed, the credential side has
landed: a granted token lives on its
mapping (`mailbox_mapping.source_secret_ref`, ledger migration 0032), merged by
`buildDepsFromMapping` and revoked through `revokeCredentialRow`.

## Alternatives considered

- **Files only, documented better** (the status quo). Rejected: no documentation turns "edit two
  files and restart a scheduled task" into something ADR-0027's person will do, and the setup
  checklist and the connections work already shipped assume a door the appliance does not have.
- **UI only, files as a one-time import.** Rejected: it removes an Organisation deployment's
  only workable interface (at ~1000 accounts, arithmetic rather than preference) and the only
  path that keeps no secret at rest.
- **Merge: files seed defaults, the UI overrides.** Rejected: it fails silently either way
  (decision 4), and the loser is whoever was surest of editing the authoritative copy.
- **Both doors on every object, ownership per row** (decisions 3 and 4 as first written): an
  ownership column, a startup refusal if derived and random ids collided, a vanished file's rows
  offered for adoption into the UI or deletion. Replaced on 2026-08-19 by the split by concern:
  with one door per concern there is nothing to own, collide or adopt.
- **Split by deployment for everything: no secret store on Organisation** (an earlier draft of
  the 2026-08-19 answers). Rejected: a credential that arrives from a person at runtime,
  ADR-0035's grant link, has no environment variable. The owner, 2026-08-19: *"why would we want to store all possible
  secrets in files, while we can hold them also in DB like with grants and the UI we have."*
- **One word, qualified in prose** ("self-host, but the big kind"). Rejected: a distinction that
  exists only in the reader's head is not one the code can honour.
- **Personal as a third edition.** Rejected: Personal and Organisation are one build that differs
  only at runtime; a third edition would fork packaging, CI and release.
- **A UI that writes the config files.** Rejected: a generated file is not one an operator owns
  (comments lost, Git changes nobody made, a race with a text editor), and the secrets would
  still sit in a batch script.
- **A passphrase-derived key.** Stronger, but rejected as the only path: the appliance could not
  start unattended, and surviving a power cut with nobody present is a stated value, proven on
  real hardware (runbook phase 3, hard kill mid-sync). It may come as an option on top of the
  key file (Argon2id, ADR-0037).
- **The bind as the boundary everywhere** (decision 6's first draft): true of Personal, false of
  a served deployment; see decision 6.

## Amendment log

- **2026-08-17** — Proposed, and revised the same day: the first draft treated self-host as one
  persona (the SAD's "hobbyist") and let the new routes ship without authentication. The owner
  set the names (decision 1) and the scale bound (~1000 migrated accounts, not interactive
  logins); the auth clause became decision 6. Record: *"Self-host" is one word for two
  deployments (decision 1 names them)*, and decision 6.
- **2026-08-17** — Decision 6 restated by ADR-0035: it holds, with a second boundary, because
  migrated people get a signed link and not an account. Record: *Update 2026-08-17 — decision 6
  is restated by ADR-0035*.
- **2026-08-19** — Correction: the two open questions (do files survive; where does the key
  live) had been recorded as delegated on a *"no preference"* the owner never gave, an
  unanswered picker read as consent. Both were reopened as proposals; the owner: *"I do have a
  preference."* A decision log that can absorb a non-answer as an answer is worse than no log.
  Record: *The correction, first, because this ADR asserted something untrue about its own
  owner*.
- **2026-08-19** — Both questions answered by the owner; corrected twice against the record, the
  answers became the split by concern. Decisions 2–5 amended: the UI is Personal's topology door
  and the credential door everywhere; files are Organisation's sole topology door and Personal
  has none; decision 4's ownership machinery is replaced; the key's mechanics move to ADR-0037,
  with the key required at first store. Record: *Now decided (owner, 2026-08-19) — and the shape
  the answers produced*, and the "Amended 2026-08-19" notes under decisions 2–5.
- **2026-09-20** — Accepted as amended (owner: "yes on all 3"); nothing changed.
- **2026-10-03** — Consolidated in place
  ([ADR-0051](./0051-an-adr-reads-as-it-stands.md)): written as the decision stands, decision
  numbers 1–7 kept, decisions 3 and 4 retitled to their amended meaning; decision 5's threat
  statement follows ADR-0037's, and decision 6 names the link's scope as ADR-0035 now does.

The full record, word for word as it read before this consolidation:
[history/0034-appliance-configuration-surface.md](./history/0034-appliance-configuration-surface.md).
