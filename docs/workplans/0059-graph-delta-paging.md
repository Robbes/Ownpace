# Workplan 0059 — the Graph delta loop that never advanced

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 why look | ✅ **Stated 2026-08-17** | Workplan 0058 found the OneDrive connector keying every file off `GraphDriveItem.path`, a field Graph does not return, with fixtures that invented it — so 41 green tests certified a connector that could not migrate a real drive. `graph-calendar-source.ts` and `graph-contacts-source.ts` are the same vintage, were made reachable by real mappings in workplan 0054, and have never met a tenant either. Auditing them for the same class of defect was the obvious next move, and it found one. |
| T2 the defect | ✅ **Fixed 2026-08-17** | Both `listSince` implementations built `const url = deltaLink ?? …` ONCE, outside the pagination loop, and never used `nextLink` as an address — they only tested it for truthiness. Against a real server that means: fetch page one, see `@odata.nextLink`, fetch **page one again**, forever — appending the same events/contacts to an unbounded array until the process dies. Any mailbox whose delta answers more than a single page, which is most of them. Both `listFolders` methods in the same two files declare `const url = nextLink ?? …` INSIDE the loop and are correct, so the pattern was known; the delta paths just missed it. Fixed to request `nextLink ?? firstUrl`, with a `MAX_DELTA_PAGES` guard so an unbounded request loop against a customer tenant fails loudly instead of quietly. |
| T3 why no test caught it | ✅ **Fixed 2026-08-17** | Both files had a test called "should handle pagination in delta query" that passed. Their `createMockHttpClient(responses[])` answers **by call order and ignores the URL** — so it returned page two for a repeat of the identical request, which no server does. The mock modelled a server that cannot exist, exactly as 0058's fixtures modelled a field that does not exist. New tests in both files use a URL-aware mock and assert the second request goes to the `nextLink` address. Mutation-verified: reverting the fix makes the new calendar test fail with the page guard (10 000 identical requests), and restoring it passes. |
| T4 the `$delta` path | ✅ **Fixed 2026-08-17** | Both built `${baseUrl}/$delta`. Graph spells this segment `/delta` — as this repo's own `graph-drive-source.ts` does (`/drive/root/delta`). Corrected in both. Unproven against a tenant like everything else here, but the in-repo inconsistency was one-sided. |
| T5 not done, honestly | ⛔ | (a) `graph-calendar-source` fetches each event's iCal from `…/events/{id}/$value` behind `Prefer: outlook.body-content-type="icalendar"`. Whether Graph serves that combination is a REAL-TENANT question this audit cannot settle, and it is the next thing to check when a tenant exists — if it does not, the calendar source has no iCal to parse and the ⏳ becomes a rebuild. Recorded rather than guessed at. (b) The audit covered pagination and field derivation. It did not verify every Graph field name against the API (`GraphCalendar.name`, `GraphContact.displayName` etc. look right and are unverified). (c) No integration coverage for either connector — the whole class of defect this workplan and 0058 found is invisible to fixtures by construction. |

## What this is

The second finding of the same audit, and the reason the audit was worth running: two connectors
that unit tests declared healthy would each have hung on the first real mailbox with more than one
page of items.

The pattern worth naming, because it has now produced three defects across two workplans: **a mock
that answers something a real server could not answer will certify code that cannot work.** 0058's
fixtures invented a field; these answered different bodies to identical requests. Both times the
test suite was green, and both times the connector was unusable. Tests built from a provider's real
payload shapes and real addressing rules are the only kind that say anything about the provider.
