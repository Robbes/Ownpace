# Workplan 0029 — the permission inventory & guidance report

## Status — 2026-08-02 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Discover: delegations + shares, read-only over Graph | ⬜ Not started | — |
| T2 Map: each right to its target equivalent (or "manual") | ⬜ Not started | — |
| T3 Guide: the runbook the owner actually reads | ⬜ Not started | — |
| T4 Surface + manifest truth | ⬜ Not started | — |

## Why this exists

Owner decision 2026-08-02 (0026 T3 row 4): **keep, scoped — "perhaps the
writes later."** SAD §14.2 promises a four-step permission module and the
scope manifest tells owners "inventoried and guided; only the clean,
reversible subset is auto-applied" — with zero code behind any step. This
plan builds the first three steps as a **read-only report**; the fourth
step, **apply where safe** (Nextcloud OCS shares, group folders, DAV ACLs),
is **deferred, not retracted** — its revisit trigger is the report proving
useful in a real migration, and T4 makes the manifest say exactly that
until then.

Why it earns its keep: a cutover that nobody inventoried is how SendAs on
the shared address, the assistant's FullAccess and the family calendar
share all break silently on day one. The discover step rides on
infrastructure workplan 0027 already needs (application permissions +
Application Access Policy — 0027 T0 is the shared prerequisite; its
discovery already reads shared-mailbox membership).

## Tasks

- **T1 — discover.** Read-only Graph reads, least-privilege, behind 0027
  T0's auth mode: FullAccess/SendAs/SendOnBehalf delegations,
  shared-mailbox members (from 0027's `group_def` where already
  discovered), shared-calendar permissions, OneDrive/SharePoint sharing
  links and folder ACLs. Stored per mapping/tenant as inventory rows with
  the raw grant verbatim. IMAP-only sources: the inventory says
  "not discoverable over IMAP" (rule 9), never an empty report.
- **T2 — map.** A static, reviewable mapping table from each source right
  to its target equivalent where one cleanly exists (shared calendar →
  Nextcloud calendar share; folder share → group folder; SendAs → the
  target's alias/app-password convention per §14.1) and an explicit
  **manual** verdict where none does. No fuzzy translation — a right maps
  cleanly or it is named manual (the SAD's own "no fragile full ACL
  translator").
- **T3 — guide.** The §14.2 runbook, generated from T1+T2: readable
  Markdown per mapping — what exists on the source, what lands where, the
  step-by-step for every manual item, simplification advice where the
  inventory shows accumulated cruft. Rendered where reports live; EN frame
  via the dictionary if surfaced in the UI, grant names verbatim.
- **T4 — surface + truth.** The report reachable from the mapping hub and
  the Finish checklist (the cutover is when it matters); the manifest's
  Permissions row reworded to what is true after this plan: *inventoried
  and guided; nothing is auto-applied yet* — the "clean, reversible
  subset" wording returns only if the write half is built. SAD §14.2 gets
  the dated note recording the split.

## The deferred half (recorded so it is findable)

**Apply where safe** — automating the clean, reversible subset (Nextcloud
OCS Sharing API / group folders, CalDAV/CardDAV share ACLs). Deferred
2026-08-02 by the same owner decision. Revisit when the report has been
used in a real migration and the manual steps it generates are demonstrably
the ones an API could do reversibly. Until then the module writes nothing
(rule 2 stays untouched: inventory is read-only by construction).

## Hard rules that bite here

- **Rule 9:** blind spots are named — IMAP sources, rights Graph does not
  expose, targets with no equivalent. A report that omits what it could
  not see is worse than no report.
- **Safety note:** the test O365 tenant is real — discovery scopes are
  read-only and least-privilege behind the Application Access Policy.
- **Rule 6:** the runbook generator's output is per-tenant data, not
  repo docs; only its template/format is documented in `docs/`.
