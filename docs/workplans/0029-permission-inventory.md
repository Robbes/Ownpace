# Workplan 0029 — the permission inventory & guidance report

## Status — 2026-08-04 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Discover: delegations + shares, read-only over Graph | 🟡 **The read layer is built 2026-08-04; the wiring that produces a report is the next slice** | **The finding worth leading with: Graph cannot read mailbox delegation.** FullAccess, SendAs and SendOnBehalf are Exchange recipient permissions, and the Graph API this tool speaks does not expose them — the way to enumerate them is Exchange Online PowerShell (`Get-MailboxPermission`, `Get-RecipientPermission`), a different credential, consent model and protocol. `mailboxDelegations()` therefore always returns `not_discoverable`, naming those cmdlets, and it is a tested function rather than an omission — because those are exactly the rights whose silent loss on cutover day this plan exists to prevent, and a report that skipped them would read as *nothing was delegated* (rule 9). **What IS readable**, both read-only and both behind 0027 T0's application-permission mode: calendar sharing (`calendarPermissions`) and OneDrive/SharePoint sharing (a drive item's `permissions`). Sharing LINKS are told apart from people-grants — *anyone with this link can edit* is a different risk from *Anna can edit*, and it is the finding an owner most often does not know about. Every failure path returns `not_discoverable` with the reason, never `[]`: no permission, an error status carrying Graph's own words, a transport failure, a non-JSON body, paging that will not end. The vocabulary lives in `@openmig/shared` (`PermissionGrant`, `PermissionListing`) for the same reason `DirectoryListing` does — the connector that produces findings and the report that consumes them are in different packages. `raw` carries the grant verbatim and is never parsed downstream: it is evidence, not a model. 13 tests. **Owner decision needed before this can run live:** the two Graph scopes it uses — `Calendars.Read` and `Files.Read.All` — are NOT in `docs/o365-application-access.md`'s consented set, and that runbook says adding a permission is *worth a conversation rather than a click*. This is that conversation. **Not done:** enumerating a tenant's calendars and drive items to feed these readers, and storing or serving the result. |
| T2 Map: each right to its target equivalent (or "manual") | ✅ **Done 2026-08-04** | A **table, not a translator** — §14.2 is explicit that a fragile full ACL translator is the thing not to build, so `mapGrant` has exactly two verdicts and no confidence score: a right maps cleanly or a person decides. Reviewing one file is enough to know what the report will say about any grant. Clean: calendar shares and per-person file shares, read or write, which are the same idea on both sides. Manual: a sharing LINK (not a right held by anybody — recreating one carries that access across without anybody choosing to, so it is a decision, not a translation), FullAccess (the target has no per-person mailbox ACL; app passwords are §14.1's convention and can be withdrawn individually), Send-As (a target platform setting). **Total by construction:** a right the table has never seen falls through to `manual` with *no equivalent is known* rather than being dropped or guessed — an unrecognised right is exactly the one an owner must be told about. **`clean` never means `handled`:** the apply step is deferred, so it names what a right corresponds to on the target, not something that will be created. 8 tests. |
| T3 Guide: the runbook the owner actually reads | 🟡 **The generator is built 2026-08-04; it has no live input until T1's wiring lands** | `renderPermissionReport` is pure — listings in, Markdown out, no clock — so what it says is testable without a tenant. **Two structural choices, both about what a reader does with it.** Blind spots come **first, above the findings**: the instinct is to lead with what was found, but a *could not be inventoried* section under two pages of successful findings gets skipped, and it is the dangerous half — mailbox delegation is always in it. And **`clean` never reads as `handled`**: the document says nothing has been applied and nothing will be applied automatically, before the first finding, because §14.2's apply step is deferred and a clean mapping is still a step for a person. The findings table renders the grantee as *anyone with the link* rather than a blank cell for link shares, escapes the source's own words so a pipe cannot break the row, and gathers every manual item into a closing checklist. Three empty states, each refusing the reading that would be convenient: *no rights found* points back at the uninventoried section before anybody concludes nothing is shared; *no manual steps* says that is not the same as nothing to do; and no sections at all still produces a document. 12 tests. |
| T4 Surface + manifest truth | 🟡 **The manifest correction landed early, 2026-08-04; the surface waits on T1's wiring** | The Permissions row said *"inventoried and guided; only the clean, reversible subset is auto-applied"*. Nothing was inventoried and nothing is applied — the write step is deferred by decision and has no code — so the sentence promised that permissions largely take care of themselves. Corrected ahead of the rest of T4 because it was false in shipped text, not merely incomplete: it now says NOT yet inventoried, that nothing is ever auto-applied, that the reading and the report exist but are not reachable from a screen, and that mailbox delegation is not readable through Graph at all and must be captured with Exchange Online PowerShell before cutover. **Still to do:** the report reachable from the mapping hub and the Finish checklist, the SAD §14.2 dated note, and rewording this row once an owner can actually read a report. |

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
