# Architecture Decision Records

Every decision this project has committed to, with its **current** status — which is
not always the status the ADR's own heading suggests. Several were amended or
retracted after they were accepted, and an ADR is append-only (hard rule 7:
supersede, don't delete), so the heading is a historical artefact and this table is
the register.

**This is the only register.** `docs/architecture/solution-architecture.md` §24 used
to restate the whole list in prose and drifted from it — on 2026-08-13 it still
described ADR-0027 as a Windows Service eight days after it became a scheduled task,
and named two retracted ADRs as live. It now links here instead. If you find yourself
writing a second list of ADRs somewhere, that is the mistake this file exists to stop.

New decision? Copy [`0000-template.md`](./0000-template.md) to the next free number.
Read [`CONTRIBUTING.md`](../../CONTRIBUTING.md#architecture-decision-records-adrs)
first.

## The register

| ADR | Decision | Status |
|---|---|---|
| [0001](./0001-license-apache-2.0.md) | License is Apache-2.0 | Accepted |
| [0002](./0002-language-typescript.md) | Implementation language is TypeScript | Accepted |
| [0003](./0003-two-editions-one-core.md) | Two editions from one core (self-host + managed) | Accepted |
| [0004](./0004-orchestration-triggerdev-and-inprocess.md) | Orchestration via Trigger.dev (managed) + in-process scheduler (self-host) | Accepted |
| [0005](./0005-idempotency-ledger-nondestructive.md) | Idempotency via a ledger; non-destructive by default | Accepted |
| [0006](./0006-o365-access-model.md) | O365 access model | Accepted |
| [0007](./0007-reuse-engines-graph-extractor.md) | Reuse proven engines + a Graph rich extractor; no commercial SharePoint tools | Accepted 2026-06-20 — **both halves have since moved. Read the Update below before the Decision above.** The rich Gra… |
| [0008](./0008-pluggable-target-provisioner.md) | Pluggable TargetProvisioner (manual + API) | **Retracted 2026-08-02** (owner decision, workplan 0021 T5) — accepted 2026-06-20, never built |
| [0009](./0009-repo-strategy-public-monorepo.md) | Public Apache-2.0 monorepo; ops/secrets private | Accepted |
| [0010](./0010-persistence-postgres-sqlite.md) | Persistence — Postgres+RLS (managed) / SQLite or small Postgres (self-host) | Accepted; **partially superseded by [ADR-0023](0023-persistence-postgres-only.md)** (2026-07-16) — the SQLite / dual-… |
| [0011](./0011-targets-managed-eu-no-selfhosted-mail.md) | Targets default to managed EU/CH; self-hosted targets are user-operated | Accepted |
| [0012](./0012-graph-over-ews-davmail.md) | Prefer Microsoft Graph; avoid EWS/DavMail | Accepted |
| [0013](./0013-i18n-english-dev-bilingual-ui.md) | English for development; bilingual (EN+NL) end-user UI | Accepted |
| [0014](./0014-cost-recovery-billing.md) | Cost-recovery billing (no profit) for the managed edition | Accepted |
| [0015](./0015-backup-scope.md) | Backup scope — stack DR vs end-user data vs optional extra backup | Accepted; the **"optional user-controlled extra backup" bullet is RETRACTED 2026-08-02** (owner decision, workplan 00… |
| [0016](./0016-ledger-schema-v1.md) | Ledger schema v1 | Accepted; the **"Drizzle ORM (dual pg/sqlite)" access-layer clause is superseded by [ADR-0023](0023-persistence-postg… |
| [0017](./0017-migration-tooling.md) | Migration tooling — Drizzle Kit (+ Atlas lint), not Liquibase | Accepted |
| [0018](./0018-jmap-primary-target.md) | JMAP is the primary target protocol; IMAP/DAV is the parallel second family | Accepted |
| [0019](./0019-packaging-runtime-targets.md) | Packaging & runtime targets — container-first, optional Tauri tray, prefer JS-native engines for portability | Accepted (the Tauri tray variant is **superseded as the first Windows target** by [ADR-0027](./0027-windows-packaging… |
| [0020](./0020-ledger-rebuildable-cache-recovery.md) | The ledger is a rebuildable cache — recovery via target reindex (natural-key adoption) | Accepted |
| [0021](./0021-knowledge-enrichment-okf-addin.md) | Optional knowledge-enrichment add-in (OKF) — a parallel, opt-in `KnowledgeSink` | **Retracted 2026-08-05** (owner decision, workplan 0026 T3 row 16) — accepted 2026-06-22 as planned/optional, never b… |
| [0022](./0022-imap-dependency-security-strategy.md) | IMAP Dependency Security Strategy | **NO STATUS LINE** — see the note below |
| [0023](./0023-persistence-postgres-only.md) | Persistence — Postgres-only across both editions | Accepted — **amended by [ADR-0028](./0028-pglite-appliance-persistence.md)** |
| [0024](./0024-explicit-owner-deletion-apply.md) | `apply` — an explicit, gated exception to non-destructiveness | Accepted |
| [0025](./0025-proton-drive-target-deferred.md) | Proton Drive as a files target — deferred on authentication, not on effort | Accepted (deferred, with named revisit conditions) |
| [0026](./0026-one-operating-ui-one-contract.md) | One operating UI, one contract, both editions | Accepted |
| [0027](./0027-windows-packaging-shell.md) | The Windows appliance ships as a service with a shortcut, not a native shell | Accepted — amended three times (2026-08-06 the payload ships its own Node runtime; 2026-08-07 the mechanism is a sche… |
| [0028](./0028-pglite-appliance-persistence.md) | PGlite as the appliance's embedded persistence (amends ADR-0023) | Accepted (2026-08-01, recording a decision executed in workplan 0016) |
| [0029](./0029-public-site-is-server-rendered-and-legible.md) | The public site is server-rendered, and legible to assistants | Accepted |
| [0030](./0030-relocation-is-positive-evidence.md) | A correlated relocation is positive evidence, and may be applied | **Accepted 2026-08-15** (owner decision) — built the same day for the appliance; the managed edition's queued-job route followed 2026-08-16 (receipt discriminator, migration 0010), so both editions now offer the action |
| [0031](./0031-auto-apply-relocations.md) | Auto-applying relocations — what unattended would require | **Accepted 2026-08-16** (owner decision) — built the same day: per-mapping `autoApplyRelocations` (default off), four gates in front of the existing `applyRelocation`, both editions |
| [0032](./0032-sharing-queue-target-native-invites.md) | The sharing queue — re-sharing on the target as an owner decision, invites through the target's own messaging | **Accepted 2026-08-16** (owner decision) — first slice built the same day (workplan 0052): grants are trackable checklist rows in both editions, apply is per-grant, gated behind cutover, through Nextcloud's OCS API so the target's own share notification is the message to the people affected (open-migrate never mails third parties itself); manual steps tick off with attribution |
| [0033](./0033-domain-wide-delegation.md) | Whole-tenant Google migration — domain-wide delegation, opt-in and stated | **Accepted 2026-08-17** (owner decision) — first slice built the same day (workplan 0053): JWT-bearer provider + one mode-selector across all four Google factories; per-user tokens stay the default, a `serviceAccountKey` opts a deployment in; one subject per mapping; refusals name the Admin-console authorisation; setup-doc runbook ends with revoke-at-cutover |
| [0034](./0034-appliance-configuration-surface.md) | Personal / Organisation / Managed — naming the deployments, and giving each the configuration door it needs | **Proposed 2026-08-17** — awaiting an owner decision. Names two axes the tree conflates: **deployment** (Personal / Organisation / Managed, orthogonal to ADR-0003's edition) and **configuration surface** (Declared = files, Operated = UI, per object and never merged). Files scale UP (an Organisation deployment's ~1000 end users are declarative), the UI scales DOWN; the encryption key is generated for Personal and comes from a secret manager for Organisation; **authentication is a prerequisite** before the credential-editing UI reaches a non-loopback bind. Written because workplan 0066 recorded "the appliance's connections come from mapping files" as settled architecture when it was only workplan 0010's implementation choice — and because one word for two deployments is what let that happen. Flags that SAD §3/§4.1/§7/§7.1/§8's "hobbyist / single-user / single tenant" language contradicts the owner's stated scale |

## Reading the statuses

- **Accepted** — in force. The tree should match it; if it does not, one of the two is a bug.
- **Retracted** — decided, then un-decided before or instead of being built. `0008` and `0021`
  are both retracted-never-built, and both keep their reasoning below the retraction note
  because the analysis stays useful if anyone revisits.
- **Amended / partially superseded** — the decision holds but a named part of it moved. `0010`
  → `0023` (SQLite dropped), `0023` → `0028` (PGlite for the appliance), `0019` → `0027`
  (Windows packaging), `0006` (the one-multi-tenant-app half retired 2026-08-09), `0015` and
  `0016` (one clause each). **`0027` has been amended three times** and is the one most worth
  reading in full rather than skimming its title.
- **`0007` is the trap.** Its heading still reads "Reuse proven engines + a Graph rich
  extractor" and both halves have moved: the rich extractor is retracted, and there are no
  shell-out engines left at all (`0019`'s update). Read its status line before its Decision.

**`0022` has no status line.** It is the one ADR written from a different template — bare-bold
metadata instead of list bullets — so the extractor that builds this table finds nothing to
report. The decision itself (a pnpm override for the `semver` chain rather than migrating off
`imap-simple`) has since been overtaken: [workplan 0032](../workplans/0032-imapflow-migration.md)
did the migration, and the vulnerable chain is absent from the lockfile rather than overridden.
Giving it a status line is worth doing next time anyone touches it.
