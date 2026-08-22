# Architecture Decision Records

Every decision this project has committed to, with its **current** status — which is
not always the status the ADR's own heading suggests. Several were amended or
retracted after they were accepted, and an ADR is append-only (hard rule 7:
supersede, don't delete), so the heading is a historical artefact and this table is
the register.

**This is the only register — for STATUS.** `docs/architecture/solution-architecture.md`
§24 used to restate the whole list in prose and drifted from it — on 2026-08-13 it still
described ADR-0027 as a Windows Service eight days after it became a scheduled task,
and named two retracted ADRs as live. It now links here instead. If you find yourself
writing a second list of ADRs somewhere, that is the mistake this file exists to stop.

**For the RULES, load [`OPERATIVE.md`](./OPERATIVE.md)** — generated from every ADR's own
`## Operative rules` section (`node scripts/adr-operative.mjs --write`, drift-guarded by
a unit test, so it is build output rather than a second source; ADR-0038). Rows here are
deliberately one sentence: the substance the long rows used to carry lives in the
operative sections now, where the drift guard can see it.

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
| [0006](./0006-o365-access-model.md) | O365 access model | Accepted — amended twice; multi-tenant app retired 2026-08-09 |
| [0007](./0007-reuse-engines-graph-extractor.md) | Reuse proven engines + a Graph rich extractor; no commercial SharePoint tools | Accepted 2026-06-20 — both halves since moved; only "no commercial SharePoint tools" survives |
| [0008](./0008-pluggable-target-provisioner.md) | Pluggable TargetProvisioner (manual + API) | **Retracted 2026-08-02** (never built) |
| [0009](./0009-repo-strategy-public-monorepo.md) | Public Apache-2.0 monorepo; ops/secrets private | Accepted — amended by 0039: no-open-core reaffirmed and CLOSED; the "private ops/IaC" clause corrected |
| [0010](./0010-persistence-postgres-sqlite.md) | Persistence — Postgres+RLS (managed) / SQLite or small Postgres (self-host) | Accepted — superseded in part by 0023/0028; Postgres+RLS for managed survives |
| [0011](./0011-targets-managed-eu-no-selfhosted-mail.md) | Targets default to managed EU/CH; self-hosted targets are user-operated | Accepted |
| [0012](./0012-graph-over-ews-davmail.md) | Prefer Microsoft Graph; avoid EWS/DavMail | Accepted |
| [0013](./0013-i18n-english-dev-bilingual-ui.md) | English for development; bilingual (EN+NL) end-user UI | Accepted — bilingual UI built 2026-08-02 |
| [0014](./0014-cost-recovery-billing.md) | Managed billing | **Amended 2026-08-20** — four tiers on active paths, no per-GB/compute line; "no profit" retired (cross-subsidy) |
| [0015](./0015-backup-scope.md) | Backup scope — stack DR vs end-user data vs optional extra backup | Accepted — extra-backup bullet retracted 2026-08-02 |
| [0016](./0016-ledger-schema-v1.md) | Ledger schema v1 | Accepted — access-layer clause superseded by 0023; managed tables moved by 0036 |
| [0017](./0017-migration-tooling.md) | Migration tooling — Drizzle Kit (+ Atlas lint), not Liquibase | Accepted — Atlas lint built 2026-08-02; two chains since 0036 |
| [0018](./0018-jmap-primary-target.md) | JMAP is the primary target protocol; IMAP/DAV is the parallel second family | Accepted — per-domain sequencing settled 2026-08-05/06; calendars stay CalDAV |
| [0019](./0019-packaging-runtime-targets.md) | Packaging & runtime targets — container-first, optional Tauri tray, prefer JS-native engines for portability | Accepted — Tauri deferred by 0027; no shell-out engines since 2026-07-30 |
| [0020](./0020-ledger-rebuildable-cache-recovery.md) | The ledger is a rebuildable cache — recovery via target reindex (natural-key adoption) | Accepted |
| [0021](./0021-knowledge-enrichment-okf-addin.md) | Optional knowledge-enrichment add-in (OKF) — a parallel, opt-in `KnowledgeSink` | **Retracted 2026-08-05** (never built) |
| [0022](./0022-imap-dependency-security-strategy.md) | IMAP Dependency Security Strategy | Accepted — the vulnerable chain removed 2026-08-06; the override stays |
| [0023](./0023-persistence-postgres-only.md) | Persistence — Postgres-only across both editions | Accepted — amended by 0028 (PGlite appliance engine) |
| [0024](./0024-explicit-owner-deletion-apply.md) | `apply` — an explicit, gated exception to non-destructiveness | Accepted |
| [0025](./0025-proton-drive-target-deferred.md) | Proton Drive as a files target — deferred on authentication, not on effort | Accepted (deferred) — extended 2026-08-02 to the whole Proton destination |
| [0026](./0026-one-operating-ui-one-contract.md) | One operating UI, one contract, both editions | Accepted |
| [0027](./0027-windows-packaging-shell.md) | The Windows appliance ships as a service with a shortcut, not a native shell | Accepted — amended thrice; scheduled task, bundled Node, premises measured 2026-08-09 |
| [0028](./0028-pglite-appliance-persistence.md) | PGlite as the appliance's embedded persistence (amends ADR-0023) | Accepted |
| [0029](./0029-public-site-is-server-rendered-and-legible.md) | The public site is server-rendered, and legible to assistants | Accepted |
| [0030](./0030-relocation-is-positive-evidence.md) | A correlated relocation is positive evidence, and may be applied | Accepted 2026-08-15 — gates hardened by same-day amendments |
| [0031](./0031-auto-apply-relocations.md) | Auto-applying relocations — what unattended would require | Accepted 2026-08-16 — built the same day |
| [0032](./0032-sharing-queue-target-native-invites.md) | The sharing queue — re-sharing on the target as an owner decision, invites through the target's own messaging | Accepted 2026-08-16 — first slice built |
| [0033](./0033-domain-wide-delegation.md) | Whole-tenant Google migration — domain-wide delegation, opt-in and stated | Accepted 2026-08-17 — first slice built |
| [0034](./0034-appliance-configuration-surface.md) | Personal / Organisation / Managed — naming the deployments, and giving each the configuration door it needs | Proposed 2026-08-17 — open questions resolved by the owner 2026-08-19; accept/reject of the reasoning outstanding |
| [0035](./0035-who-signs-in-and-who-gets-a-link.md) | Who signs in, and who just gets a link | Proposed 2026-08-17 — substance owner-decided; restated 2026-08-19 |
| [0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md) | The managed edition is its own package and its own migration chain | Accepted 2026-08-19 — its parked two-repo options closed by 0039; the enforced boundary stands |
| [0037](./0037-keys-credentials-and-transport-floors.md) | One credential store, two key providers, and TLS floors | Accepted 2026-08-19 |
| [0038](./0038-operative-rules-and-the-growing-record.md) | Operative rules — keeping a growing decision record loadable | Accepted 2026-08-19 (this convention) |
| [0039](./0039-no-open-core-and-what-ops-privacy-means.md) | No open-core — closed with a trigger; and what "private ops" means | Accepted 2026-08-19 (resolves the 0009 vs 0036 conflict) |
| [0040](./0040-the-service-is-ownpace.md) | The service is Ownpace; the project keeps its own name | Accepted 2026-08-20 — three open follow-ups (repo rename, NOTICE assertion, backup naming) |
| [0041](./0041-who-owns-the-oauth-client.md) | Who owns the OAuth client — managed brings its own, the appliance never does | Accepted 2026-08-21 |
| [0042](./0042-who-holds-the-passwords.md) | Who holds the passwords — an issuer we can replace | **Proposed** 2026-08-22 — awaiting the owner; the first identity decision in the register |

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
