# Workplan 0113 — A task is not an event

## Status — 2026-09-03 (update this block at the end of every session)

**2026-09-03 (latest): T4 built — the writer asks about the component it is writing.**
Both read-back queries in `caldav-target-writer.ts` filtered `comp-filter name="VEVENT"`, so
a task already on the target came back as "not there" and was re-PUT on every pass. Nothing
duplicated (same href, same UID) and nothing was lost — the idempotency CHECK was blind, not
the write, which is why a green suite never noticed. Reachable with no task feature at all: a
mixed collection already carries tasks through this writer today.

Three changes, one rule. The per-item REPORT filters on the component being written, read
from the object's own bytes; a caller that does not know asks for all three, which is
strictly more likely to find what is there (RFC 4791 §9.7.1: sibling comp-filters are an OR).
The collection snapshot — which also feeds verification — covers every component, keeping its
partial retrieval so a mailbox-sized calendar is still not downloaded to be counted.
`MKCALENDAR` carries the source collection's declared component set, and a source that
declared nothing creates a collection that declares nothing rather than being narrowed to
whatever this pass happened to see.

And a refusal names the component: writing a VTODO into a VEVENT-only collection is a 403
whose body is a stack of XML, so on the failure path only (one PROPFIND, never on a write
that worked) the collection is asked what it accepts and the sentence says which component
was written and which the target takes. When the component does not explain the refusal, the
server's own words are passed through unchanged — a guess dressed as a diagnosis is worse
than the raw refusal.

**2026-09-03: T3b, first half — an object is labelled what it is.** `parseCalendarObject`
stamped `type: 'event'` on every object it saw. That was wrong for two of RFC 5545's three
components and reachable today rather than hypothetically: `sync-collection` (RFC 6578) is
component-agnostic, so a MIXED collection — Nextcloud's default calendar declares
`VEVENT,VTODO` — hands the parser its tasks along with its events. The bytes were always
right (the raw iCalendar is carried through and PUT verbatim); the label on the record lied.

Nothing reads `type` today, so this changes no behaviour — it makes the record honest and
gives T4's read-back the field it needs. **It also turned T4 up as a live defect**, which the
entry above closes: both read-back queries filtered `comp-filter name="VEVENT"`, so a task
written into a mixed collection was invisible to the check that decides whether it is already
there, and was re-PUT on every pass.

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

**2026-09-03 (later still): T2 built — the ledger accepts `task` before anything sends it.**
Migration `0036_a_task_is_not_an_event.sql` widens **nine** CHECK constraints: eight `domain`
columns (seven from the baseline, one from 0035's `path_lifecycle`) and `item.item_type`,
whose vocabulary says 'mail' where the others say 'email' and whose column the code has never
written. The plan said "nine plus `item_item_type_check`"; measured, it is eight plus that
one. Additive only — every existing value stays valid, no row is read or written, and a second
application is a no-op.

`DISCOVERY_DOMAINS` still names four, deliberately: the database accepts a value nobody sends,
which is inert, rather than code sending a value the database refuses, which is a pass that
dies half-copied. The Drizzle mirror in `schema-pg.ts` now names `DISCOVERY_DOMAINS` instead
of listing the values, so it can only ever be narrower than what Postgres accepts — and
`scripts/a-fifth-domain-the-database-would-refuse.unit.test.ts` fails the build if a domain
reaches the shared list without a migration behind it. **`journal` is asserted absent**: the
third component in the same iCalendar enum, deliberately out of scope, and now out of the
database too.

Verified against a real Postgres (`scripts/local-pg.sh`), not reasoned about: all nine
constraints read back as accepting `task`, one row inserted into each of the eight domain
tables plus `item`, and `journal` still refused by name.

**2026-09-03 (later): T1 built — the domain has one name.** The owner, in the same
message that queued this work: *"add the task-objectkind (one of the latest workplans). Work
on this autonomously."* That is decision 1, yes. Decisions 2 and 3 are taken as this plan's
own recommendations — **its own tick**, and **Google Tasks out of v1** (T6 stays visible and
unstarted). Decision 4 waits for the owner's Soverin account to answer.

T1 measured **80** hand-written copies of the union across **18** files, not 73 — the count in
the table below was taken before #734–#738 landed. All 80 are gone: the list lives once, in
`DISCOVERY_DOMAINS`, with the type derived from it, and
`scripts/a-domain-union-typed-out-by-hand.unit.test.ts` fails the build on a new copy of
either. Three local aliases for the same concept (`SyncDomain` — declared twice in one
package — `PathDomain`, and two web-local `Domain`s) are gone with them. No behaviour changed;
the guard's exception list is now the checklist T2 and T5 work through.

**2026-09-03: drafted for the owner's decision, nothing built.** The owner, walking his own
Soverin account: *"i found 'Tasks', is that a Dav to? Perhaps we need to add it as
objecttype?"* Yes to the first half — tasks are CalDAV, `VTODO` components, and every DAV
provider this product targets carries them. The second half is this plan. What made it worth
writing rather than answering in a sentence is what the code says today: **a task list is
already being read as a calendar, and its tasks are already being labelled events.** That is
not a missing feature, it is a wrong answer, and §"What happens today" measures it.

| Task | Status | Evidence |
|---|---|---|
| T0 Decide: its own tick, and how far v1 reaches | ✅ Decided 2026-09-03 | 1: **build it** (the owner queued the work). 2: **its own tick**. 3: **Google Tasks out of v1**. 2 and 3 are this plan's own recommendations, taken in the owner's absence and reversible by a word from him. |
| T1 The domain has ONE name | ✅ Done | Was **80 inline copies across 18 files** (73 when this was written; #734–#738 added seven). Now one `DISCOVERY_DOMAINS` in `packages/shared/src/discovery.ts` with `DiscoveryDomain` derived from it, three redundant aliases removed, and `scripts/a-domain-union-typed-out-by-hand.unit.test.ts` failing the build on a new copy of the type OR of the value list — with every legitimate exception named and two-way, so it cannot go stale. Proved by breaking. No behaviour changed. |
| T2 The ledger widens | ✅ Done | `0036_a_task_is_not_an_event.sql`: nine CHECKs widened (eight `domain` columns — seven baseline, one from 0035 — plus the legacy `item.item_type`). Additive, re-runnable, verified against a real Postgres: nine constraints accept `task`, a row lands in each of the eight tables, and `journal` is still refused. The Drizzle mirror names `DISCOVERY_DOMAINS` rather than listing values, and a guard fails the build on a domain that reaches the code without a migration. Proved by breaking. |
| T3 The source tells a task list from a calendar | 🟡 (a) done, (b) half done | **(a)** `listCollections` now PROPFINDs `supported-calendar-component-set` (RFC 4791 §5.2.3) and drops a collection that does not carry `VEVENT`, so a VTODO-only list stops being counted among "5 calendars visible". The declared set rides on `CalendarFolder.components` as data; an UNDECLARED set is a yes for every component, per the RFC and 0105's never-guess rule. Proved by breaking. **(b) half:** each object's `type` is now read from its own `BEGIN:` line instead of stamped `'event'` — reachable today, because `sync-collection` is component-agnostic and a MIXED collection hands the parser its tasks along with its events. Still to come: carrying task collections as their own kind, which needs the task domain (T5). |
| T4 The writer writes a task | ✅ Done | Both read-backs follow the component: the per-item REPORT filters on what is being written (read from the object's own bytes), the collection snapshot covers all three while keeping partial retrieval, `MKCALENDAR` carries the source's declared component set (and declares nothing when the source did), and a refusal names the component instead of returning a bare 403 — passing the server's own words through unchanged when the component is not the reason. Proved by breaking, five ways. |
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
