# Workplan 0054 — the three orphaned Graph sources, wired

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the finding | ✅ **Stated 2026-08-17** | The owner asked why OneDrive was not in the feature matrix. The answer turned out bigger than OneDrive: `GraphCalendarSource`, `GraphContactsSource` and `GraphDriveSource` all existed in `@openmig/connectors` — implemented, unit-tested — with **zero production call sites**. `graph-calendar`/`graph-contacts` configs PARSED and then fell through to the DAV endpoint resolver, which throws about a URL a Graph config does not have; `graph-drive` had no config type and was not even exported from the package index. The matrix listed the first two as ✅ — the document's own rule ("when this file and the code disagree, the code is right") applied to itself, and the drift lock could not catch it: it polices the WIZARD matrices, and these are appliance mapping-file types. |
| T2 the seam | ✅ **Done 2026-08-17** | `orchestration/graph-domain-source-factory.ts`, shaped exactly like the mail factory: same Entra registration (`OAUTH2_CLIENT_ID/SECRET/REFRESH_TOKEN`), same two flows chosen by what is set (refresh token → delegated per-product scope — `Calendars.Read` / `Contacts.Read` / `Files.Read` + offline_access; client secret → client-credentials `.default`), and the same build-time refusal when a `mailbox` (/users read, application permissions only) meets the delegated flow — Graph's 403 never names the cause, so the factory does. 5 unit tests. |
| T3 reachable from a mapping file | ✅ **Done 2026-08-17** | `GraphDriveFileSource` config type (`type: "graph-drive"`, tenantId, optional mailbox/baseUrl) + parser, mirroring graph-calendar's; the connector exported at last; `build-deps` calendar/contact/file branches route the three Graph types to the new factory instead of the DAV resolver. The consent note travels with the type: reading ANOTHER user's OneDrive needs `Files.Read.All` — the scope workplan 0029 deliberately did not consent on the reference tenant; a customer grants it to their own registration knowingly, or reads `/me` per user. |
| T4 not done, honestly | ⛔ | (a) The managed WIZARD still offers M365 mail only — exposing calendar/contacts/drive there needs wizard source types, connection kinds (a migration) and cards; recorded in the matrix's gaps table. (b) Real-tenant proof: all three are ⏳ in the matrix — wired ≠ proven, and their first live run rides the owner runbook. (c) OneDrive deletion evidence: `GraphDriveSource` never populates `removed` (same posture as Drive/WebDAV — absence-counting covers it); a recycle-bin read like Drive's is unbuilt. |

## What this is

An honesty repair as much as a feature: the matrix claimed M365 calendars and contacts
migrated, and the code said otherwise in the quietest possible way — connectors with no
callers. One factory closes the gap for all three, OneDrive included, and the matrix now
says ⏳ (wired, awaiting reality) instead of a ✅ nothing could cash.

## The one decision

**The wiring reuses the mail factory's rules rather than inventing gentler ones.** The
same registration, the same flow selection, the same mailbox-needs-application-permissions
refusal — because an operator who has configured graph-mail already knows exactly these
sentences, and a fourth Graph source with its own credential vocabulary would be the drift
rule 5 exists to prevent.
