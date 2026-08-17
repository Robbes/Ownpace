# Workplan 0052 — the sharing checklist

## Status — 2026-08-16 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 rows that remember | ✅ **Done 2026-08-16** | Migration `0016_share_grant.sql` (RLS'd like every tenant table; no FK on mapping_id, mirroring `item` — appliance mappings are config-born) + schema + the ledger port trio: `upsertShareGrants` (identity is `grant_hash` — subject+on+grantee+role+link-ness, NOT the raw blob, so a re-serialised permission is the same grant and **a rescan never resets a decision**), `listShareGrants` (checklist order: open first), `decideShareGrant` (`state='open'` in the WHERE — a settled row stays settled, two concurrent deciders cannot both win). Pg + memory fake. |
| T2 the queue's engine | ✅ **Done 2026-08-16** | `core/share-queue.ts`: `refreshShareGrants` (the SAME scan functions the §14.2 report composes — the queue can never know more or less than the report; blind spots come back verbatim as the checklist items the tool cannot enumerate), `applyShareGrant` (gate order: open row → not a link (§7) → clean verdict (0029 T2's table decides applicability) → cutover (§5) → target has a share API (§3) → the target's own answer, verbatim; a refusal leaves the row OPEN because nothing was carried over), `markShareGrant` (the by-hand tick: `done_manual` / `skipped`, any verdict — manual rows are exactly what the checklist is FOR), `summariseShareGrants` (the progress line, `openManual` called out as the owner's own remaining steps). Audit rows attributed to the decider; a failed audit write never undoes a settled tick. 11 unit tests. |
| T3 the first share verb | ✅ **Done 2026-08-16** | `connectors/nextcloud-ocs.ts`: `createNextcloudUserShare` — ORIGIN-rooted endpoint (the wellKnownUrl lesson: never concatenate onto the DAV path), `OCS-APIRequest` header (without it OCS answers 401 to everything and that 401 reads as wrong credentials), success requires BOTH 2xx AND the OCS envelope saying ok, refusals carry the server's own sentence. Two permission levels only, mirroring the two verdicts: write-ish → editor **without re-share** (handing out the right to hand out rights is not this tool's call), else read. 6 unit tests. |
| T4 both editions, same three verbs | ✅ **Done 2026-08-16** | `GET /:mappingId/sharing`, `POST …/sharing/rescan`, `POST …/sharing/:grantId/decision` — managed (operating-routes; scans via the extracted `tenantInventoryScans`, capability from the mapping's target connection when its kind is `webdav`, decidedBy = the authenticated user) and appliance (same URLs under `/mappings`; scans via the extracted `inventoryScansFor`, capability from the mapping's webdav target config + env password, decidedBy = `operator`). Route-parity and OpenAPI drift locks both extended and green. |
| T5 the checklist screen | ✅ **Done 2026-08-16** | `pages/Sharing.tsx`, mounted per-mapping in both editions, hub card added. The progress line ("N / M settled"), rescan with blind spots listed verbatim, and per-row: **apply** as a two-step destructive-style button (it is outward-facing — pressing it sends a real invitation) beside an **editable grantee field** prefilled with the source's address (§6: the machine proposes, a person confirms), **Mark done** and **Skip** for everything including manual rows, settled rows showing state + decider + when. Refusals render the server's words verbatim. EN/NL. |
| T6 the edges | 🟡 **a/b/c built 2026-08-16 (same day, follow-up PR); d/e remain** | (a) ✅ The digest narrates open checklist rows (`sharingOpen`, required on `MappingAttention`, EN/NL lines; open rows alone keep the email alive — a forgotten checklist is what the digest prevents). (b) ✅ The completion report gained "Access carried over": applied / done by hand / skipped / still open (manual called out), rendered by the shared builder in both editions; open rows WARN (access dies when the source is retired) but never hold the verdict — the checklist is post-finish work. (c) ✅ Confirm-once, client-side: an address the owner corrected and successfully applied prefills the same grantee's other rows (their own edits always win; nothing stored server-side — every apply still sends its address explicitly). (d) ⛔ live Nextcloud OCS proof — rides the owner runbook. (e) ⛔ group shares and DAV ACLs — out of ADR-0032's scope by its own words. |

## What this is

ADR-0032, built the day it was accepted — plus the owner's addition that reshaped it:
**"make all manual handling a checklist, so I can keep track of what still needs to be
done and what was done already."** So the queue is not "the rows the tool can apply,
plus a rendered report for the rest": every grant is a row, `manual` rows most of all,
and the three settle actions (`applied` / `done_manual` / `skipped`) are the same kind
of tick with the same attribution. "What is left?" is now a query the progress line
answers, not a memory.

## The one decision

**The invite IS the notification** (ADR-0032 §4). `apply` creates the share through the
target's own API and the target tells the grantee — in its branding, with a working
link, only when the access is real. open-migrate never mails third parties: the digest
mails the owner, and everyone else hears from the platform they will actually use. The
cutover gate (§5) exists for the same reason in reverse — an invite into a half-filled
target is the wrong announcement from the right channel.
