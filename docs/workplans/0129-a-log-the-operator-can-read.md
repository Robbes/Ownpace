# Workplan 0129 — A log the operator can read

## Status — 2026-09-23 (update this block at the end of every session)

**2026-09-23: opened from the owner's answers.** The owner asked for *"an logging page, for the
operator, logging can be viewd and searched, keep is basic. I want retention of 1 month. And i
want a way of export/publish auditlog records, in such a way commen logging frameworks can pick
it up / stream it to loglakes/logsolution."* Five questions went back the same day, and all five
were answered (§2). Nothing is built yet.

| Task | Status | Notes |
|---|---|---|
| T1 The application's errors and warnings are recorded where the page can search them | 📋 **Decided 2026-09-23** (D1, D3) | §3. A table of metadata only, written beside the log line, never instead of it. |
| T2 The operator's log page | 📋 **Decided** (D1, D3, D5) | §3. The audit log and T1's table, one timeline, searchable; both editions. |
| T3 One month for application and container logs | 📋 **Decided** (D2) | §3. T1's table is pruned at 30 days; container output is kept 30 days where it is collected. |
| T4 The audit export: one JSON line per event, and a download that resumes | 📋 **Decided** (D4, D5) | §3. OpenTelemetry field names, to stdout; a backfill endpoint with a cursor; pseudonyms by default. |

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
  error category, reference number, searchable. No free text, per your support rule."*
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

The audit log's `actor` and `detail` are not shown: an address is personal data, and `detail`
is free JSON. The page shows the audit row's time, customer, migration and action (as its
event).

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
