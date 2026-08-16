# Workplan 0047 — the migration completion report

## Status — 2026-08-16 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the shared builder | ✅ **Done 2026-08-16** | `packages/shared/src/completion-report.ts`: `buildCompletionReport` (pure — inputs in, document out) + `renderCompletionReportMarkdown`. The verdict is DERIVED, never hand-set: `complete` only when every enabled domain completed AND no queue holds an open item; a skipped domain is a scoping decision, not unfinished work. 8 unit tests pin the verdict logic, the queue counts (open vs acknowledged, relocations vs plain moves, unconfirmed deletions excluded) and the Markdown. |
| T2 both editions serve it | ✅ **Done 2026-08-16** | Managed: `GET /api/migrations/{id}/completion-report` (operating-routes; receipts counted as the `applied` section — every destructive outcome landed on one). Appliance: `GET /mappings/{id}/completion-report`, same builder, NO `applied` section — its applies are synchronous and recorded in the run log, and the document SAYS so instead of showing zeros that would read as "nothing was ever removed". OpenAPI path documented (drift lock). |
| T3 the download | ✅ **Done 2026-08-16** | The mapping hub gains one link: "Download the completion report (Markdown)" — client-side blob download, `completion-report-<id>.md`. EN/NL. |

## What this is

Every number on this document already lives on some screen — per-domain status, the three
queues, the receipts. What was missing was ONE document, assembled at a moment in time,
saying **what moved, what is waiting on a decision, and what was removed on whose
decision** — the deliverable a consultancy hands a customer at handover, and the closing
checklist an owner reads before calling a migration done.

## The one decision

**The verdict cannot say more than the queues allow.** `complete` requires every enabled
domain completed AND zero open moves, deletions and undecided failures. A closing document
that reads "done" over an open queue would be precisely the silence the queues exist to
prevent — so the middle state, `complete with decisions pending`, says what is true: the
copying is finished, the migration is not closed until the questions are answered.
