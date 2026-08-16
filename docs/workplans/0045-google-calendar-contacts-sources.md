# Workplan 0045 — Google Calendar & Contacts as sources

## Status — 2026-08-16 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Bearer capability in the DAV connectors | ✅ **Done 2026-08-16** | `tokenProvider?: TokenProvider` on `CalDAVSourceConfig`/`CardDAVSourceConfig`; `authorizationHeader()` (now async) answers `Bearer <token>` minted per request — cached until expiry, which is what keeps a pass alive past Google's one-hour token — and Basic byte-for-byte as before for every password server. Unit tests both connectors, including the Bearer mint. |
| T2 the factories and both editions | ✅ **Done 2026-08-16** | `google-dav-source-factory.ts`: per-product scopes (`auth/calendar`, `auth/carddav`), fixed principal URLs (`apidata.googleusercontent.com/caldav/v2/{user}/user/`, `www.googleapis.com/carddav/v1/principals/{user}/`), per-product env variables (`GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CONTACTS_REFRESH_TOKEN` — a consent is per product, and the variable names keep that visible), refusals in each edition's vocabulary. Appliance: `buildDomainDeps` calendar/contact branches. Managed: `buildDomainDepsFromMapping` branches on `connection.kind` (`google_calendar`/`google_contacts`, migration `0015`). |
| T3 the doors | ✅ **Done 2026-08-16** | Shared `GoogleCalendarSource`/`GoogleContactsSource` (one field, like gmail) + parse; source-domain matrix rows with per-product refusal prose; API sourceType enum + kinds + config blobs + superRefine naming each product's scope + the Google secret branch; two wizard cards (calendar pins `caldav` — the one calendar-capable target; contacts keeps jmap/carddav), EN/NL. Tests at every seam. Also fixed while here: the web client's create-response schema still listed only the ORIGINAL three source types, so every successful Google create threw client-side (wizard never navigated; a retry created a duplicate chain). |
| T4 an owner runs it | ⏳ **Waiting on the owner** | Stage 6 of `docs/owner-test-runbook.md`: Google's principal URLs answering the discovery walk, and its sync-token dialect, are the two things only reality proves. The connectors are proven against RFC-shaped servers; Google's dialect is the unknown, stated rather than assumed. |

## What this is

The last two domains of a "leave Google Workspace" story, and the cheapest of the four
Google sources, because Google still speaks the protocols this product already implements.
The ENTIRE CalDAV/CardDAV read path — discovery, sync-collection, removal reports feeding
deletion evidence — runs unchanged; the one capability added is Bearer authentication with
per-request token minting, because Google's DAV endpoints take OAuth only.

## The decisions

1. **DAV, not the REST APIs.** The Calendar/People REST APIs would be two new read paths to
   keep at parity forever. The DAV connectors exist, are proven, and already produce the
   evidence classes the queues consume (RFC 6578 removal reports are the `reported`
   deletion evidence). If Google's DAV dialect fails Stage 6 in some unfixable way, THEN a
   REST connector is the fallback — with this workplan's doors already in place.
2. **Two source types, not one "Google DAV".** A mapping's one target can serve calendar
   OR contacts (CalDAV carries calendars only; CardDAV contacts; JMAP has contacts, no
   calendar), so a combined type would offer a pairing no target accepts. Two types match
   how mappings actually shape, and the refusal prose stays per-product.
3. **Per-product refresh-token variables.** A refresh token carries its consent. One consent
   can carry both scopes — the doc says so, and the same value may be set in both variables
   — but the config stays explicit about which consent each domain runs on, exactly the
   GOOGLE_MAIL_REFRESH_TOKEN argument.
