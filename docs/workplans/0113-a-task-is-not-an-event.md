# Workplan 0113 — A task is not an event

## Status — 2026-09-03 (update this block at the end of every session)

**2026-09-03: T3b, first half — an object is labelled what it is.** `parseCalendarObject`
stamped `type: 'event'` on every object it saw. That was wrong for two of RFC 5545's three
components and reachable today rather than hypothetically: `sync-collection` (RFC 6578) is
component-agnostic, so a MIXED collection — Nextcloud's default calendar declares
`VEVENT,VTODO` — hands the parser its tasks along with its events. The bytes were always
right (the raw iCalendar is carried through and PUT verbatim); the label on the record lied.

Nothing reads `type` today, so this changes no behaviour — it makes the record honest and
gives T4's read-back the field it needs. **T4 is now the live defect:** both read-back
queries in `caldav-target-writer.ts` filter `comp-filter name="VEVENT"`, so a task written
into a mixed collection is invisible to the check that decides whether it is already there,
and is re-PUT on every pass.

**2026-09-03: T3a built — a task list stops being counted as a calendar.** `listCollections`
asks for `supported-calendar-component-set` and skips a collection that does not carry
`VEVENT`. The property is the ONLY thing that separates a task list from a calendar on the
wire — both are calendar collections — which is why this went unnoticed: nothing was asking.
`CalendarFolder.components` carries what the server declared, as data, so T3b reads the same
field for VTODO rather than asking twice.

Silence is not a no: a collection that declares nothing "MAY contain any calendar component
type" (RFC 4791 §5.2.3), and so does a collection whose declaration this parse does not
recognise. Both are kept. Reading silence as VTODO would hide a real calendar from somebody
who has one, which is a worse failure than the one being fixed.

*(T0's decisions and T1/T2 land in their own pull requests; this one is independent of both
and can merge in any order.)*

**2026-09-03: drafted for the owner's decision, nothing built.** The owner, walking his own
Soverin account: *"i found 'Tasks', is that a Dav to? Perhaps we need to add it as
objecttype?"* Yes to the first half — tasks are CalDAV, `VTODO` components, and every DAV
provider this product targets carries them. The second half is this plan. What made it worth
writing rather than answering in a sentence is what the code says today: **a task list is
already being read as a calendar, and its tasks are already being labelled events.** That is
not a missing feature, it is a wrong answer, and §"What happens today" measures it.

| Task | Status | Evidence |
|---|---|---|
| T0 Decide: its own tick, and how far v1 reaches | 📋 Owner decision | §"The owner's decisions" 1–3. Nothing below starts without 1. |
| T1 The domain has ONE name | 📋 Planned | `DiscoveryDomain` is spelled out inline as a union **73 times across 17 files**. A fifth domain added on top of that is 73 edits and a drift bug in whichever one is missed. Collapse them onto the type first, with a guard that fails on a new inline copy. No behaviour changes; this is the task that makes every one below cheap. |
| T2 The ledger widens | 📋 Planned (needs T1) | Nine `CHECK` constraints in `0001_baseline.sql` pin the four domains, plus `item_item_type_check`. One additive migration widens them; nothing is rewritten, nothing is dropped. |
| T3 The source tells a task list from a calendar | 🟡 (a) done, (b) half done | **(a)** `listCollections` now PROPFINDs `supported-calendar-component-set` (RFC 4791 §5.2.3) and drops a collection that does not carry `VEVENT`, so a VTODO-only list stops being counted among "5 calendars visible". The declared set rides on `CalendarFolder.components` as data; an UNDECLARED set is a yes for every component, per the RFC and 0105's never-guess rule. Proved by breaking. **(b) half:** each object's `type` is now read from its own `BEGIN:` line instead of stamped `'event'` — reachable today, because `sync-collection` is component-agnostic and a MIXED collection hands the parser its tasks along with its events. Still to come: carrying task collections as their own kind, which needs the task domain (T5). |
| T4 The writer writes a task | 📋 Planned (needs T3) | The read-back's `comp-filter` follows the component being written; `MKCALENDAR` names the component set when a collection has to be created; a target collection that cannot take the component is refused **by name**, never by a silent 403. |
| T5 The domain surfaces | 📋 Planned (needs T1, T2, T3) | The matrices, the qualification's fifth face and its badge, the wizard's fifth tick, the discovery counts, the confirm screen, EN/NL strings, the icon. |
| T6 Google Tasks | 📋 Optional (needs T0 decision 3) | Google's CalDAV carries no VTODO at all: tasks live behind the separate Tasks REST API, whose model is thinner than VTODO. A face of its own, or out of scope for v1. |
| T7 The gate | 📋 Planned (needs T4) | The managed nightly seeds a task list in the demo backend and migrates it, so the next regression of this shape is caught by a machine rather than by the owner's account. |

## Why this exists

The four faces this product carries — mail, calendar, contacts, files — were chosen because
each is a thing a person would notice missing after a migration. A task list is that too. It
is also, unlike photos ([0112](./0112-google-photos-through-takeout.md)), **already reachable
over a protocol we already speak, with a credential we already hold**: it is the same CalDAV
account, on the same connection, behind the same password. There is no new grant, no new API
tier, and no provider to negotiate with.

What there is instead is a modelling mistake that has been shipping quietly.

## What happens today — measured in the code, 2026-09-03

| where | what it does | consequence |
|---|---|---|
| `packages/shared/src/discovery.ts:85` | `DiscoveryDomain = 'email' \| 'calendar' \| 'contact' \| 'file'` | There is no task domain to tick, count, or refuse. |
| `packages/shared/src/calendar.ts:5` | `CalendarEventType = 'event' \| 'todo' \| 'journal'` | The vocabulary exists. **Nothing in the repository produces or consumes the last two.** |
| `packages/connectors/src/caldav-source.ts:249` | `listCollections` PROPFINDs `resourcetype`, `calendar-description` and `calendar-timezone` — never `supported-calendar-component-set` | A task list is returned as a **calendar** and counted as one. The owner's "5 calendars visible" may include one. |
| `packages/connectors/src/caldav-source.ts` `listSince` | `sync-collection` REPORT (RFC 6578), which is component-agnostic | Tasks in a mixed collection are pulled in whether or not anybody asked for them. |
| `packages/connectors/src/caldav-source.ts:613` | Every parsed object is stamped `type: 'event'` | A task is carried as an event. The raw iCalendar survives; the label lies. |
| `packages/engines/src/caldav-target-writer.ts:334, :455` | Both read-back queries filter `comp-filter name="VEVENT"` | A written task is invisible to the check that decides whether it is already there — and a target collection whose component set is VEVENT-only refuses the write outright. |
| `packages/ledger/migrations/0001_baseline.sql` | Nine `CHECK (domain = ANY (ARRAY['email','calendar','contact','file']))` plus `item_item_type_check` | The database would refuse a task row today. |

So the honest summary for a customer, right now, is: *tasks are neither carried nor
refused; they are miscounted, mislabelled, and may fail to land with the provider's own
403 as the only clue.* Fixing the label is not optional work that waits for a feature — T3a
alone makes the counts true, and it is small.

## The facts, checked 2026-09-03

| route | what it gives | what it cannot do | source |
|---|---|---|---|
| **CalDAV `VTODO`** (RFC 4791, RFC 5545 §3.6.2) | Tasks as first-class calendar objects, in a calendar collection. A collection declares `supported-calendar-component-set`; `MKCALENDAR` may set it at creation. Same `UID` natural key, same `getetag`, same `sync-collection` as events. | Nothing beyond that property distinguishes a "task list" — it is a calendar collection whose component set says VTODO. | RFC 4791 §5.2.3 |
| **Nextcloud** | Stores the component set per calendar (`VEVENT` and/or `VTODO`); the Tasks app reads the VTODO ones. | Create a VTODO-**only** list from the web UI: it offers calendar, or calendar-plus-tasks. Administrators change the type in the database. | nextcloud/server issues [#41014](https://github.com/nextcloud/server/issues/41014), [#8625](https://github.com/nextcloud/server/issues/8625) |
| **Apple Reminders** | Older versions created task lists over CalDAV with `MKCALENDAR`. | Be a CalDAV peer at all on current macOS/iOS — Reminders dropped CalDAV from iOS 13 / Catalina. | nextcloud/server issue [#17190](https://github.com/nextcloud/server/issues/17190) |
| **Google Calendar's CalDAV** | Events. | Tasks: Google's own CalDAV guide states the implementation **does not support `VTODO` or `VJOURNAL`**. | [Google CalDAV API guide](https://developers.google.com/workspace/calendar/caldav/v2/guide) |
| **Google Tasks API** | Google's tasks, over a separate REST API and its own scopes. | Match VTODO: no recurrence rules and no precise times in Google's model, so a round trip loses shape rather than bytes. | Google Tasks API reference; the limitation is reported consistently by CalDAV clients |
| **Google Takeout** | `Tasks.json` per account. | Be live: it is an export, on 0112's two-monthly floor. | Third-party importers read exactly this file |

**The asymmetry that shapes v1.** A DAV account (Soverin, Nextcloud, a generic CalDAV
target) carries tasks over the protocol we already speak. Google does not, at all, over
CalDAV. So "tasks" is a face that a **target** can offer and a **Google source** cannot — the
first face where the two sides differ for a reason that is neither a scope nor a
qualification, but the protocol itself. The three-state record already handles this
correctly (0106 T0): a Google account measures a task face and gets a **measured no**, with
the evidence sentence naming Google's own documentation. Nothing new is needed to say so.

## The design

### One name before a fifth value

`DiscoveryDomain` exists, and almost nothing uses it. The union `'email' | 'calendar' |
'contact' | 'file'` is written out **29 times in `packages/shared/src/ports.ts` alone** and
44 more times across 16 other files — the ledger stores, the orchestration seams, the core
engines, the managed metering, the web services. Adding `'task'` to a type nobody references
would change nothing; adding it to 73 sites by hand would work until the day one of them was
missed, and the shape of that bug is #597's, which this repository has paid for twice.

So T1 is a refactor with no behaviour: every inline copy becomes `DiscoveryDomain`, and a
guard test fails the build on a new one. The rule it pins is the same one
`PROVIDER_ACCOUNT_DOMAINS` already carries: **a capability list belongs in one table, and a
second copy disagrees with the first exactly once.**

### A collection kind, not a flag on a calendar

A task list is a calendar collection whose component set says VTODO. Two ways to model that:

- **(a) A flag on `CalendarFolder`.** Cheap; leaves every consumer to remember to read it.
- **(b) Its own collection kind** — the source lists task collections separately, and the
  task domain enumerates those, exactly as the contact domain enumerates address books.

**(b), and the reason is the count.** The owner's screen said "Calendar ✓ 5 calendars". If a
task list is one of those five, that line is wrong, and a flag nobody reads keeps it wrong.
A collection kind makes the miscount impossible to express: a collection is enumerated by
the domain that can carry it, and one that declares both components is enumerated by both,
with each domain reading only its own components out of it.

That mixed case is the one to get right, and it is common: Nextcloud's default calendar
declares `VEVENT,VTODO`. The rule: **the component decides the domain, the collection never
does.** A mixed collection appears under Calendar for its events and under Tasks for its
tasks; the item's own `BEGIN:` line is what routes it; and a person who ticks only Calendar
gets the events out of that collection and no tasks — which is what ticking one box should
mean.

### The natural key, and what idempotency costs

Nothing new. A VTODO carries a `UID` like a VEVENT, `getetag` changes when it changes, and
`sync-collection` reports it. The existing ledger row shape fits with one added domain value.
Rule 1 holds by the same mechanism it already holds for events.

The one place to be careful is **completion**. A task has `STATUS:COMPLETED`,
`PERCENT-COMPLETE` and `COMPLETED`, and a re-run must not resurrect a task the person
finished on the source after the first copy. That is the same ordinary "changed since" the
etag already answers — but it is worth an explicit test, because a resurrected to-do list is
the kind of wrong that a customer notices immediately and trusts you less for.

### What this plan deliberately leaves out

- **`VJOURNAL`.** The third component in the same enum. Nobody has asked, no provider this
  product targets exposes it in a UI, and 0105's never-guess rule says an unmeasured face
  stays out. It becomes a row in the same tables the day a real account carries one.
- **Reminders and alarms (`VALARM`).** They ride inside the copied object as bytes; whether
  a target re-arms them is the target's business. Naming this is the honest position, and
  it belongs in the feature matrix rather than in code.
- **Google Tasks**, unless decision 3 says otherwise — see T6.

## The owner's decisions

1. **Build it?** The alternative is T3a alone: stop miscounting task lists as calendars, say
   in the matrix that tasks are not carried, and stop there. That is a few hours and leaves
   the product honest. The full plan is the feature.
2. **Its own tick, or under Calendar?** My recommendation: **its own tick.** A target can
   carry one and refuse the other — Google's CalDAV is the proof — and a tick that cannot be
   refused separately cannot be honest about that. It also fits the existing machinery
   exactly: a fifth domain, a fifth face, a fifth badge.
3. **Google Tasks in v1?** My recommendation: **no.** It is a different API with a thinner
   model, and shipping it inside this plan would mix "carry tasks between DAV accounts" with
   "translate Google's task model into VTODO". T6 keeps it visible without holding v1.
4. **Which provider is the first proof?** The owner's own Soverin account, if it publishes a
   task collection — which his newly-added test data can now answer.

## Sources

- RFC 4791 (CalDAV) §5.2.3 `supported-calendar-component-set`; RFC 5545 §3.6.2 `VTODO`; RFC 6578 (sync-collection)
- [Google CalDAV API Developer's Guide](https://developers.google.com/workspace/calendar/caldav/v2/guide) — no VTODO, no VJOURNAL
- nextcloud/server [#41014](https://github.com/nextcloud/server/issues/41014), [#8625](https://github.com/nextcloud/server/issues/8625), [#17190](https://github.com/nextcloud/server/issues/17190)
- This repository, read 2026-09-03: `packages/shared/src/discovery.ts`, `packages/shared/src/calendar.ts`, `packages/connectors/src/caldav-source.ts`, `packages/engines/src/caldav-target-writer.ts`, `packages/ledger/migrations/0001_baseline.sql`
