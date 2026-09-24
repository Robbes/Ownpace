# Workplan 0129 — A log the operator can read

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-23: opened from the owner's answers.** The owner asked for *"an logging page, for the
operator, logging can be viewd and searched, keep is basic. I want retention of 1 month. And i
want a way of export/publish auditlog records, in such a way commen logging frameworks can pick
it up / stream it to loglakes/logsolution."* Five questions went back the same day, and all five
were answered (§2); the owner then added the actor to the page.

**2026-09-23, later: T1 built.** The application's errors and warnings are recorded in
`app_event` (migration 0059), which has no column a message could go in: the event is a name
from code, and a CHECK on each text column admits nothing personal. No row-level security,
deliberately, and the application's role may insert and nothing else, so no customer reads it.
Recorded: every 500 the API answers (`api.<code>`, under the reference the person was shown),
every data type whose pass fails (`sync.<domain>.failed`, with the category the progress strip
shows), and a pass that could not read a collection's keys or the owner's bin (the two
warnings that cost a pass its moves and deletions). Each log line carries the event's
reference. `recordAppEvent` never throws; each process sets its sink at start-up. Guards:
`an-error-the-operator-can-find.unit.test.ts` in shared (18), ledger (13), orchestration (6),
core (3) and the API (3), and the RLS, grants and erasure guards now name the table; 21
mutations, all killed.

**2026-09-23, T2 for the managed edition.** Support links to **The log**: one view,
`support_log` (managed migration 0025), over `audit_log` and `app_event`, metadata only. A row
has its time, level (`info` for an audit row), organisation, migration, event, category and
reference, and an audit row has who acted, shown as the member's address. The view has no
column for `audit_log.detail`, which an investigation queries (`docs/managed-bring-up.md`
§8c-bis shows how), and it serves an action or an actor that is not a name from code as nothing
readable. `GET /api/support/log` reads it newest first, a hundred rows a page, with a cursor to
the microsecond; a filter of the wrong shape is a 400 naming it; and every page served is a
`support_read` row (`log` joined the vocabulary) with its filters and how many rows came back,
under the organisation it was narrowed to. Ledger migration 0060 indexes `audit_log (at)`, so a
page does not sort the whole table. The appliance's page, T2's other half, is next: it has no
operator sign-in and no `platform_operator`, so it reads the same timeline through a route of
its own. Guards: `a-log-the-operator-can-read` in managed (11), the API (23) and the web app
(6), and the support-view and vocabulary guards name the new view; 33 mutations, all killed.

**2026-09-23, T2 for the appliance: the same page (D5).** The appliance's menu has **Log**,
the managed operator's page fed by `GET /log`: the same rows, the same cursor, and the same
filters, parsed by the same rules (`parseLogFilters` moved to shared, so a wrong filter is
refused by name on both editions). The appliance has no operator and no managed chain, so
`readOperatorLog` (ledger) reads the two tables itself. The audit log is read one organisation
at a time inside `withTenant`, under that organisation's policy, and `app_event` as the owner
on a connection from the same driver. The metadata-only line is the managed view's own three
patterns, and a test holds them in step with managed migration 0025. A migration is named as
the appliance's screens name it, by the mapping's `name`. The page has no disclosure and
records no read, because its reader is the owner. Found building it: on PGlite, a query on the
owner's handle runs inside whatever transaction a pass has open, as `app_user`, and `app_event`
refused it with "permission denied". The reproduction is a test. Guards:
`a-log-the-appliance-can-read` in ledger (18) and web (4), `a-log-the-appliance-serves` in
selfhost (3), and the route and nav tests; 19 of 20 mutations killed. The survivor is
equivalent: `app_event` holds no `info` row (its CHECK), so the skipped query could only have
come back empty.

**2026-09-23, T3 built.** The application's errors and warnings are pruned at 30 days, the
owner's month, in bounded batches by both editions' nightly retention (`pruneAppEvents`); the
audit log is not touched, and runs and their logs keep their 60 days. Container output: the
appliance's `compose.yml` caps each container at five files of 20 MB, because Docker keeps
output by size and never by age, and its guide says how to keep exactly 30 days with the host's
journal. The managed guide points Docker's daemon default at the journal with
`MaxRetentionSec=1month`, which also reaches the task runs Trigger.dev starts, since no compose
file creates those. Guards: `a-month-of-the-applications-errors.unit.test.ts` (6) and
`a-month-of-container-output.unit.test.ts` (8); 11 mutations, all killed.

**2026-09-24, T4's first half: the line (D4, D5).** Every audit event is also one JSON line on
the output of the process that recorded it, by the OpenTelemetry log data model's own field
names: `Timestamp` in nanoseconds, `SeverityText` `INFO`, `Body` the action, `Attributes` and
`Resource`. The line carries the row's id and its time to the microsecond, so a line and the
download's copy of the same event are one event to a store that de-duplicates.
`recordAuditEvent` hands the event over once the tenant's transaction it was written in has
committed (`afterCommit`, which `withTenant` runs after its `COMMIT`), so an event that was
rolled back prints nothing. It never waits for the line: on PGlite's one connection, a line that
waited inside the transaction for its key would wait forever. What may leave is decided field by
field (`AUDIT_DETAIL_FIELDS` in shared: keep, pseudonym or origin), because no pattern can tell
a file's name from a migration's state. A field the list does not know is dropped, and an
address inside a kept string is replaced too. A guard reads every place that writes an audit
event, from the syntax tree, and fails on a field nobody has classified. A pseudonym is
`pseudo:` and sixteen hex characters of an HMAC-SHA256 under this deployment's own key (ledger
migration 0062, `deployment_key`, which the request path cannot read), so the same person is the
same pseudonym after a restart. An actor that is an identifier stays as it is, an address
becomes its pseudonym, and an action that is not a name from code leaves as `audit.unnamed`, as
the log page shows it. Found building it: Trigger.dev runs each task run as a process of its
own, so the sink set where the worker starts would have missed the digest's events and a
rollback's. Every task file that opens the database now sets it, and the guard holds all 14 to
it, with the API, the appliance and the worker. The two commands an operator types at a terminal
print no line; the download will serve their rows. Guards: `an-audit-line-a-collector-can-read`
in shared (15) and ledger (11), and `every-audit-field-is-classified` (20); 36 mutations, all
killed. The download that resumes, T4's second half, is next.

| Task | Status | Notes |
|---|---|---|
| T1 The application's errors and warnings are recorded where the page can search them | ✅ **Built 2026-09-23** (D1, D3) | §3. A table of metadata only, written beside the log line, never instead of it. |
| T2 The operator's log page | ✅ **Built 2026-09-23, both editions** (D1, D3, D5) | §3. The audit log and T1's table, one timeline, searchable: under Support on managed, **Log** on the appliance. |
| T3 One month for application and container logs | ✅ **Built 2026-09-23** (D2) | §3. T1's table is pruned at 30 days; container output is kept 30 days where it is collected. |
| T4 The audit export: one JSON line per event, and a download that resumes | 🟡 **The line built 2026-09-24** (D4, D5) | §3. OpenTelemetry field names, to stdout, pseudonyms by default: built. The backfill endpoint with a cursor is next. |

## 1. What there is today

- **The audit log** (`audit_log`, since the baseline; written through `recordAuditEvent`, 0048):
  who did what to which entity, per customer. It is **not pruned**, and `retention.ts` says why:
  its retention is a compliance question, and a customer's rows go when the customer is erased.
  Nothing shows it to anyone.
- **The application's own log** is `log.info` / `log.warn` / `log.error` from `@openmig/shared`,
  written to the container's output and nowhere else. No screen can read it.
- **A pass's own lines** (`run_event`) and its run rows (`run`) are in the database and kept
  60 days (`DEFAULT_RUN_RETENTION_DAYS`); a run is pruned only once it has been invoiced
  (0121 T5).
- **The operator's screens** (0110 T4) are metadata only: they read `support_%` views that
  cannot select a message, a subject or a file name, and every view served is written to
  `support_read` against the operator's name.

## 2. The owner's decisions (2026-09-23)

The questions, and the answers as given:

- **D1, which logs the page shows:** *"The audit log plus the application's errors and warnings,
  both stored in the database so the page can search them. The page cannot reach container
  output."*
- **D2, what one month covers:** *"Application logs and container logs: yes. Audit log: keep
  until the customer is erased, as today; your export gives you a longer copy anywhere.
  Sync-pass lines: stay 2 months for billing."*
- **D3, what the page may show:** *"Metadata only: time, level, customer, migration, event,
  error category, reference number, searchable. No free text, per your support rule."* And the
  same day, for the audit log: *"do add the actor in auditlog page. The details we don't need,
  only when investigating, and we can then query them, I assume."*
- **D4, the export format:** *"One JSON line per audit event, using OpenTelemetry field names,
  written to stdout. Plus a download endpoint that resumes where the last one stopped, for
  backfill. Email addresses and file names replaced by pseudonyms in the export by default."*
- **D5, the appliance:** *"Yes: same page, and export only to where its owner points it."*

## 3. The design

**T1, the application's errors and warnings.** A new table in the shared ledger chain, so both
editions have it: time, level (`warn` or `error`), customer, migration, event, error category
and reference number, and nothing else. The event is a name from a closed list in code (for
example `sync.pass-failed`), never the log line's text, so a message, a subject or a file name
cannot reach it by accident. A `log.warn` or `log.error` that names an event is also recorded;
one that does not stays in the container output only, as today. The recording must never be able
to fail the work it describes: a database that refuses the row costs the row, not the pass.

**The reference number** is made when an error is recorded, and it is what a person quotes. The
error page and the failure line show it, and the problem report (0130) carries it, so a report
and a log row find each other without anybody reading a message.

**T2, the page.** One timeline of the audit log and T1's table, newest first, searchable by
time, level, customer, migration, event, category and reference. It shows D3's fields and no
others. On the managed edition it is another operator screen: it reads through a `support_%`
view with the same `platform_operator` check as the others, and each view served is recorded
in `support_read` (its screen vocabulary is a CHECK, so a new screen is a migration). On the
appliance it is the same page, for the appliance's own operator.

An audit row shows its time, customer, migration, actor (who did it: a person's address, or
the process that acted) and action, as its event (D3). Its `detail` is not shown: it stays in
`audit_log` until the customer is erased, and an investigation reads it with a database query,
as it can today.

**T3, one month.** T1's table is pruned at 30 days by the retention job that already prunes
`run_event`, with the same batching and the same override pattern. Container output is kept for
30 days where it is collected. Docker keeps it by size, not by age, and the compose files set
no logging options today, so: the appliance's compose file gets size caps for about a month of
ordinary output, and its guide says how to keep exactly 30 days with the host's journal; the
managed host's collector keeps 30 days, set in its runbook. `run` and `run_event` stay at 60
days (D2), and the audit log is not pruned (D2).

**T4, the export.** Every audit event is also written to the process's output as one JSON line,
with OpenTelemetry's log field names (`Timestamp`, `SeverityText`, `Body`, `Attributes`,
`Resource`), so a collector that reads container output (Vector, Fluent Bit, the OpenTelemetry
Collector, Loki's agent) can forward it without a parser of its own. A download endpoint returns
the same lines from a cursor and the cursor to continue from, so a log store can backfill what
it missed and resume. Email addresses and file names are replaced by pseudonyms by default: a
keyed hash, the same person always the same pseudonym within one deployment, so events can be
correlated without the export naming anyone. The appliance writes to its own output and serves
its own endpoint, and sends nothing anywhere else (D5).

## 4. Order

T1 first: T2 has nothing to show from the application without it, and the reference number is
what 0130's report carries. Then T2, T4 and T3, each its own PR.
