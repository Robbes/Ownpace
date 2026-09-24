# Workplan 0142 — Alerts someone reads

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that
nobody is told when the stack, the scheduled tick, the disk, a pass or a nightly gate fails.
The status page runs on the machine it watches and has no alerting. The architecture document
promises dashboards, alerts and SLOs that were never built. The review listed this group as W12,
and the owner chose to have it written: *"W12 write"*. For the alpha, the owner is the one
person who lets testers in and supports them, with no obligations on either side (§2). So this
plan is about one person being told, soon enough to act, by something that does not share the
failure it reports.

It sets a channel and a promise (T0), and puts alerts on the status page's own rows (T1). It
gives the scheduled tick a heartbeat (T2). It watches the disk and what grows on it (T3), and what
is waiting in the queue and the pooler (T4). It adds a watcher that is not on the machine (T5),
writes a runbook for a bad day (T6), and corrects the architecture document (T8). A lane that
checked nothing showing green (T7) is 0141's. Dashboards and SLOs stay parked (T9).

**The minimum before the first invitation is T0, T1, T2 and T6** (§4). The rest follows the
first invitation.

Nothing is built. Three neighbouring fixes were drafted in the consistency PR, #1137, which
merged on 2026-09-24:

- the bring-up's ports table says where `/metrics` may be reached;
- the comment in `pgbouncer.ini` says `query_wait_timeout` is a wait for a connection;
- the live-target lane runs the Node version the images ship.

Each was checked at `main` after the merge. The first two come up in §1; the third belonged to
the lane T7 pointed at, which is now 0141's.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137
merged.** Testers use a second compose project, `ownpace-live`, at the production names
(`app.ownpace.eu`, `id.ownpace.eu`, `status.ownpace.eu`). The OTA stack stays the nightly gate's
target and the demo (0131 D3, 0132 D7). So the alerts are for live: the switch is on in live's
`.env` only, because the gate rebuilds the OTA stack every night (T1). The commands in T0, T4 and
T6 name compose services rather than containers, because 0132 T1 derives container names from the
project. T7 moved to 0141 T13(c), which plans the same change. T6 now carries 0143 T2d's step for
stopping one organisation, and it names GitHub's own notifications as the way a red lane or a
watch's issue reaches the owner (0141, 0146).

| Task | Status | Notes |
|---|---|---|
| T0 The alert channel, and what the alpha promises | ⏳ **Owner** for the channel; the promise 📋 **Decided 2026-09-24** (D1, D2) | §3. **Alpha minimum.** One channel the owner reads, hosted in the EU: e-mail through 0133's relay, or a chat webhook. One test alert. A sentence for 0139's conditions: best effort, no promised response. |
| T1 The status page tells the owner when an Ownpace row goes red | 📋 **Proposed** (D1) | §3. **Alpha minimum.** An `alerting` block in `gatus.yaml`, with an address and a switch, as the Website row already has. Alerts on the Ownpace rows only. The switch is on in live's `.env` and off on the OTA stack. |
| T2 A tick that says it ran | 📋 **Proposed** (D1) | §3. **Alpha minimum.** The tick rewrites one row each minute. `GET /api/ready/scheduler` reads it, and a status row with an alert reads that route. `/api/ready` stays as it is. |
| T3 The disk, and what grows on it | 📋 **Proposed** | §3. After the first invitation; **the first to add** if the owner wants one more. A free-space floor every ten minutes and one summary a day. Also gives 0132 T7's daily duties a voice. What to do about the growth belongs to 0143. |
| T4 What is waiting: queued runs, pooler waits, recorded failures | 📋 **Proposed** | §3. After the first invitation. Queue counts written with T2's heartbeat, `SHOW POOLS`, and a daily count of 0129's recorded failures. |
| T5 Something off the machine that can say "down" | 📋 **Proposed**; the host is the owner's | §3. After the first invitation. A second copy of the same `gatus.yaml` on a small EU host, watching the public addresses. Until then, testers are the outside probe (§4). |
| T6 What to do when an alert or a tester says something is wrong | 📋 **Proposed** (D1, D2, D4, D5) | §3. **Alpha minimum.** `docs/incident-runbook.md`: a row for every alert, the steps when a tester reports trouble with their data (with 0143 T2d's step for stopping one organisation), and the hand-over to 0139 T8's breach procedure. |
| T7 A lane that checked nothing is not green | ⛔ **Moved 2026-09-24** to 0141 T13(c) | §3. 0141 plans the same change: an unarmed night shows the lane job as skipped. Kept here as a pointer so the number does not move. |
| T8 The architecture document says what is watched | 📋 **Proposed** | §3. After the first invitation, with T1. §18 and §19 say what is built and what is not. |
| T9 Dashboards, alert rules on stalls, auth failures and throttling, SLOs | 🅿️ **Parked (trigger: the first paying customer, or 0143's capacity measurements exist, whichever comes first)** | §3. 0026 row 19 still holds for everything beyond "has it stopped". |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24. Where a fact comes from the
review and was not re-checked here, it says so.

**Nobody is told.**

- `deploy/compose/gatus.yaml` (240 lines) has no `alerting` block, and no endpoint in it has
  `alerts`. A search for `alert` or `notif` in it finds nothing.
- `deploy/compose/managed.yml` runs no metrics scraper, no alert manager and no dashboard. Its
  services are Postgres, PgBouncer, the Trigger.dev plane (database, Redis, API, ClickHouse,
  registry, Docker proxy, supervisor, MinIO, TLS front), the identity provider, the API, the web
  app, Gatus, Mailpit and Nextcloud.
- The API's `/metrics` says what it does not do (`apps/api/src/index.ts`): *"What this does NOT
  deliver: §19's per-tenant dashboards, alert rules and SLOs. Those were deferred in the same
  decision"*. Since #1137 (merged 2026-09-24) the bring-up's ports section says it is reachable
  only on the API's own port, and is to be scraped over the compose network or loopback. Nothing
  scrapes it. Managed passes do not feed it anyway. `recordPassMetrics` is reached only through
  `runAllDomains` (`packages/orchestration/src/orchestration.ts`), which the appliance and the
  worker's command-line entry (`apps/worker/src/index.ts`) call. `run-delta-sync.ts` has its own
  chain and records no metric. Its runs also execute in their own containers, not in the API
  process.
- The digest (`apps/worker/src/jobs/managed-digest.ts`, daily or weekly as each organisation
  chooses) goes to each organisation's active owners and admins, as `tenant.settings` says. It
  does not go to the operator.
- `NOTIFY_TO` is the operator's address. On the managed edition it receives the notice that
  somebody asked for access (`apps/api/src/access-notify.ts`, 0133 §1). Through
  `notifierFromEnv` it also receives what three tasks send: a `decision_raised` mail from the
  drift detector and from group discovery (`managed-drift-detect.ts`, `managed-group-discovery.ts`),
  and the rollback notice (`run-rollback.ts`). None of these says anything about the stack's own
  health. On the OTA stack this mail goes to Mailpit and stays there; 0133 T3 points live's mail
  at a relay.
- The header of `e2e-managed.yml` mentions a *"watch routine that reads this gate"* in the
  morning. That routine is not in this repository, and this plan does not count it as an alert.

**The status page watches from inside the machine.** `gatus.yaml` opens with *"THIS PAGE RUNS
INSIDE THE STACK IT WATCHES. When the box is off, the network is gone, or Docker itself has fallen
over, this page is off too"*. The limit is an owner decision of 2026-08-22: *"before there are
customers, an honest page inside the stack beats a second machine to patch"*. 0094 T4 *"Move it
to its own host"* stands at *"Planned — when there are customers"*. The page has three groups:

- **Ownpace:** Web app, API, Database and Sign-in read the public address (`STATUS_WEB_URL`). The
  Identity provider row asks the container directly over the `status-probe` network. The Website
  row is off unless `STATUS_SITE_ENABLED` is set.
- **Sources:** Microsoft 365, Google Workspace and the Gmail API.
- **Targets:** Soverin, Mailfence and Infomaniak.

The operator's support screen reads the same page's JSON (`apps/api/src/routes/platform-status.ts`,
through `STATUS_URL`, which `managed.yml` defaults to `http://gatus:8080`).

The sign-in page links to the page. `StatusLink.tsx` turns `app.` into `status.`, so
`app.ota.ownpace.eu` links to `status.ota.ownpace.eu`, and live's `app.ownpace.eu` will link to
`status.ownpace.eu`. Its own comment says that *"A link to a status page that does not exist is
worse than no link, because it answers "is it down" with a browser error"*. The review recorded
the OTA status page as reachable only over the mesh. That cannot be seen from the repository.
0132 T1e routes `status.ownpace.eu` to live's page, and 0132 T3's outside probe tries it; the
probe does not try `status.ota.ownpace.eu`.

**The tick records nothing about itself.** `managed-sync-tick` is a Trigger.dev scheduled task
with `cron: '* * * * *'` (`apps/worker/src/jobs/managed-sync-tick.ts`). It starts every scheduled
pass on the managed edition, and under a hold it reports how many passes are still in flight. It
writes nothing to the application database: its SQL is read-only. Its only traces are the
`[sync-tick]` line in each task run's output, and Trigger.dev's own list of runs. `/api/ready`
leaves it out on purpose (`apps/api/src/routes/ready.ts`): *"Not the worker, not Trigger.dev, not
the demo backends. A sync that is behind is a real thing to know and NOT a reason to tell the
world the service is down; it belongs on a queue-depth metric, not here."* No such metric exists
anywhere in `apps/` or `packages/`.

So if the tick stops, whether because the supervisor is down, the task plane is broken or the
deploy failed, nothing says so. A stack with no active migration looks the same from the outside.
Five more tasks are scheduled the same way:

- `managed-purge-closed`, hourly at :23;
- `managed-retention`, 03:17 UTC;
- `managed-group-discovery`, 06:30 UTC;
- `managed-drift-detect`, 07:00 UTC;
- `managed-digest`, 08:00 UTC.

**The disk is checked once, at bring-up.** The bring-up's `preflight` warns below 15 GB free
(`bootstrap-managed.sh`: *"WARNING: only ${free_gb}GB free. A full bring-up pulls and builds
~15GB."*). Nothing checks it afterwards. 0099 records what that costs: *"A disk that is full does
not fail like a disk that is full. It fails like the code is broken"*, and the same machine had
*"the second disk leak on that machine in two days"*.

What grows:

- `item` is never pruned, because it is the idempotency ledger (0082 T2).
- Run rows are pruned per organisation only as far back as its newest issued invoice, and *"a
  tenant with none is skipped entirely, keeping all of its runs"*
  (`apps/worker/src/jobs/managed-retention.ts`). In a free alpha, no organisation's runs are
  pruned (0131 T3 proposes accepting that).
- `run_event` (60 days) and `app_event` (30 days, 0129 T3) are pruned.
- `managed.yml` sets no retention for the Trigger.dev plane's database, ClickHouse, MinIO or the
  task registry. A search for `ttl` or `retention` finds only `BACKUP_RETENTION_DAYS`. The review
  also found no registry garbage collection anywhere in `deploy/`; that half was not re-checked
  here.
- Container output goes to the journal for a month, where the bring-up's prerequisite from 0129
  T3 is followed. Whether it is followed on the reference machine cannot be seen from here.

**The queue and the pooler.** Passes run on the `delta-sync` queue (`concurrencyLimit: 1`, keyed
per migration, `run-delta-sync.ts`), and discovery on `run-discovery`. The installed Trigger.dev
SDK (4.5.16, the version `managed.yml` pins) has `queues.retrieve`. Its answer carries `queued`
and `running` counts (the `QueueItem` schema in `@trigger.dev/core`). Nothing reads them.

PgBouncer admits `pgbouncer_auth` to its console as a stats user (`stats_users` in
`pgbouncer/pgbouncer.ini`), and its healthcheck already runs `SHOW POOLS`. Nothing reads
`cl_waiting` or `maxwait`. `query_wait_timeout = 120` disconnects a client that waited that long
for a server connection. Its comment says so since #1137 (merged 2026-09-24); before, it read as a
statement limit.

**Failures are recorded, and nobody is told.** Since 0129 T1, a failed data type is recorded in
`app_event` as `sync.<domain>.failed`. So are a 500 from the API (`api.<code>`) and a problem
report that could not be delivered to Zammad (`report.not-delivered`). The operator's log page
shows these rows (0129 T2). It shows them only when somebody opens it.

**A green lane that ran nothing.** `e2e-live-target.yml` is scheduled for 04:30 UTC. GitHub's run
list, re-checked on 2026-09-24, shows 28 runs, all scheduled and all `success`. GitHub started the
first two in the afternoon (27 and 28 August), and the other 26 between 08:27 and 11:14 UTC, about
four to almost seven hours late. Most finished in about thirty seconds. The latest job's log
(2026-09-23), re-read here, ends with *"live-target: STAND-DOWN — unconfigured, and says so"*.

The stand-down is deliberate. `runLane` in `scripts/live-target-lane.ts` returns `ok: true` for
it, and the workflow's header says so: *"Unconfigured, the lane STANDS DOWN
loudly-but-green"*. The header of `live-target-lane.ts`, which holds the lane's decisions, says
why: *"red would train everybody to ignore the lane before it exists; silent green would claim a
proof nobody ran"*. 0105's status marks T4 *"Built
2026-08-26 — armed by T3's step H"*, and T3 reads *"the sitting itself waits for the owner"*.

GitHub mails a failed scheduled run to the account that last changed its schedule, if that
account's notification settings allow it. Those settings are not visible from here. The same
schedules show that GitHub's clock is not an alarm clock. `e2e-managed.yml` records being started
*"~09:50 — four and a half hours late"*.

**What the documents promise.** `docs/architecture/solution-architecture.md` §18 names
*"observability (Grafana Cloud EU or self-host LGTM)"*. §19 reads: *"Per-job logs (engine stdout
captured); per-tenant dashboards (migrated, queued, errors, throughput, sync lag); alerts on
stalls, auth failures, throttling. SLOs: sync freshness/lag, success rate, time-to-first-mirror."*
Neither section says that 0026 row 19 (2026-08-05) built the endpoint and deferred the rest. The
row says why: *"thresholds chosen before there is traffic to measure are guesses wearing the
costume of a service level"*. The API's comment says it; the architecture document does not.
#1137 (merged 2026-09-24) corrected the document's CI gates, not §18 or §19.

**No runbook for a bad day.** Outside the workplans, `docs/` has no incident or breach procedure;
`docs/dns-management.md` names *"Incident response procedures"* in one bullet. The draft
data-processing agreement promises to notify a controller *"without undue delay after becoming
aware"* of a breach (`site/legal/dpa.md` §7). 0139 T8 proposes the breach procedure.

What exists is the hold. *"While the hold is on, every signed-in customer sees a note at the top
of every screen with your sentence on it"*, and *"Every hold is kept, with who started it, who
lifted it and what it said"* (`docs/managed-bring-up.md`, *Draining first, and telling customers
why*). The hold stops the tick only. A pass a tester starts by hand is not held (0132 §1).

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words and the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — who is told, and who acts.** *Who decides who joins the test, and should only owners and
admins invite?* — *"I am the gate for letting people in the test."* *A tester stack separate from
CI and the nightly gate?* — *"Yes, but its a controlled rest. I Let people in and support them.
Max 10/20 people"* ("rest" is read as "test", as 0131 reads it). *If the current stack is reused,
its demo secrets must be rotated: who needs them?* — *"Who would need/het credentials? I
aupporrthe test. No one will be added to NetBird network. Devs need to setup own private test/dev
environments. GitHub PRs and git is the bridge."* ("het" is read as "get", and "aupporrthe" as
"support the", as 0131 reads them.)

So the owner is the one person who is told and the one who acts. Nobody else receives an alert,
because nobody else is on the machine or the mesh. An alert that reaches someone who cannot act on
it is noise.

**D2 — what the alpha promises.** *Is the test free or paid, for how many people, and in which
language?* — *"Free and invite only. 10 to 20 people max. Dutch."* *Its posture?* — *"Free. A few
weeks. No obligations both sides."*

So there is no availability promise and no promised response time. When something breaks, the
owner is told and looks as soon as they can. Alerts are not pages: nothing is meant to wake
anyone. Tester-facing words are in Dutch first.

**D3 — where it runs.** *Where do testers run, and under which host names?* — *"This machine, ci
states. The OTA address. It's all controlled by me and invite only."* ("ci states" is read as "CI
stays", as 0131 reads it.)

Later the same day the owner chose a second compose project for testers, `ownpace-live`, beside
the OTA stack on the same machine, at the production names; the OTA stack stays the nightly
gate's target and the demo (0131 D3, 0132 D7, where the owner's words are quoted). So each stack
has its own status page and its own tick, and the alerts in this plan are for live's.

Both stacks, both status pages, CI and every check in T1 to T4 still share one machine. When the
machine or its connection is down, all of them are down together. T5 is the only answer to that,
and §4 says what stands in for it during the alpha.

**D4 — no backups.** *How much may be lost, how fast must it come back, and where are backups
kept?* — *"None during the test"*. *Nothing backs up the application database?* — *"No
obligations during controlled test"*.

So the review's suggested backup-age check has nothing to check, and this plan does not build it
(0134 T5 parks backups). T6 says plainly that lost data cannot be restored.

**D5 — the legal gate first, and the name.** *A lawyer's pass before the first invitation, or a
labelled test notice, and can you supply the facts?* — *"Yes before, Alpha, and i can supply."*

So T0's promise is a sentence for 0139 T2's alpha conditions, which the owner writes and the
lawyer reads. T6 hands a possible breach to 0139 T8's procedure and does not duplicate it.

## 3. What each task does

### T0 — the alert channel, and what the alpha promises (owner) — alpha minimum

**The channel.** One channel, read by the owner, hosted in the EU, and chosen once, so that T1 and
T3 to T5 all send to it. There are two options (open question 1):

- **(a) E-mail** to the address in `NOTIFY_TO`, through the relay 0133 T0 sets up. *Recommended*
  once 0133 T3 has pointed live's mail at that relay: the login already exists in live's `.env`,
  and Gatus has an e-mail provider.
- **(b) A chat or push webhook**, for example a self-hosted ntfy, or a Matrix room on an EU
  homeserver. Gatus has providers for both. This is the route if the first invitation comes before
  the relay.

Either way, an alert carries a component name, its state and a time. It never carries a tester's
data. No row probes anything a tester owns, and T3 and T4 send counts, never names or addresses.
So the channel's provider receives no personal data, and needs no line among 0139 T5's
sub-processors for this purpose.

**The steps on live, before the first invitation, while nobody but the owner uses it:**

1. Choose (a) or (b), and put its settings and the switch in live's persisted `.env`
   (`~/.persistent/ownpace-live/.env`, 0132 T1b; T1 names the settings). Values stay out of this
   plan. The OTA stack's `.env` gets none of them. Also check that GitHub's notification settings
   send a failed scheduled run and a new issue to an address the owner reads (T6).
2. Send one test alert. From `~/ownpace-live`, stop the web app for four minutes
   (`docker compose -f deploy/compose/managed.yml stop web`, then `start web`; a compose service
   name, because 0132 T1 derives container names from the project). The rows that read the public
   address (Web app, API, Database, Sign-in, and Scheduled syncs once T2 exists) should each send
   an alert, then a recovery. The Identity provider row should stay quiet, because it does not
   pass through the web container. Write the date and the outcome in this block.
3. Check from a machine off the mesh that `status.ownpace.eu` answers, once 0132 T1e routes it.
   0132 T3's outside probe tries it. Write the outcome here, and see open question 4.

**The promise.** It is decided in substance (D2), and the wording is the owner's, for 0139 T2's
conditions. A draft:

- NL: *"Tijdens de alfa is er geen beloofde beschikbaarheid en geen beloofde reactietijd. Als er
  iets misgaat, krijgen wij een melding en kijken we er zo snel mogelijk naar. Merkt u het eerder,
  mail dan naar «het adres uit de voorwaarden»."*
- EN: *"During the alpha there is no promised availability and no promised response time. When
  something breaks, we are told and look at it as soon as we can. If you notice it first, write to
  «the address in the conditions»."*

The address must be one whose mail the reference machine does not handle. When the machine is
down, the report form (0130) is down with it.

### T1 — the status page tells the owner when an Ownpace row goes red — alpha minimum

**The change, in `gatus.yaml`.** An `alerting` block for the provider T0 chose. Every field in it
is a variable, so the public repository holds no address and no credential. `alerts` go on each
row of the Ownpace group (Web app, API, Database, Sign-in, Identity provider, Website) and on T2's
new row, with:

- `failure-threshold: 3`, which is three minutes at the rows' 60-second interval. A container
  recreated during a deploy should not alert. A deploy that takes longer will alert, and the owner
  is expecting it;
- `success-threshold: 2`;
- `send-on-resolved: true`, so the owner also learns that it is over;
- a `description` that names the row's line in T6's runbook.

Sources and Targets get no alerts. A Google outage is not the owner's to fix, and the page already
shows it.

**An address and a switch, as the Website row has.** The file's own comments record that Gatus
expands the environment over the whole file and *"refuses to load a config with an endpoint that
has no URL, taking the whole page down with it"*. A channel that is not set up must leave the page
exactly as it is today. So:

- `managed.yml` gives each provider field a harmless default, the `.invalid` placeholder shape
  `STATUS_SITE_URL` already uses;
- a switch, `ALERT_ENABLED`, defaults to `false`;
- each alert reads the switch through Gatus's per-alert `enabled`.

Before writing this, check what Gatus v5.36.0 does with an alert whose provider is invalid or
unset, against its source, as the healthcheck comment in `managed.yml` was checked. The guard
pins whichever it is.

**On for live, off for the OTA stack.** Both stacks read the same `gatus.yaml` and `managed.yml`,
so the switch is what separates them. Live's `.env` turns it on (T0). The OTA stack leaves it off:
the nightly gate recreates its API and web app every night, so its rows can go red on schedule,
and an alert about that reaches the one person who already knows (D1).

**The settings.** For route (a), `ALERT_SMTP_*` default to the product's own `SMTP_*`, and
`ALERT_TO` defaults to `NOTIFY_TO`, so one relay login serves both. `managed.env.example` lists
them, and `managed-env-contract.unit.test.ts` holds the example to compose. Both directions of
`status-page.unit.test.ts`'s variable check already apply: every variable the file names must be
handed to the container, and every variable handed over must be named.

**The docs.** `docs/status-page.md` gains a short *Who is told* section: the owner, through T0's
channel, for the Ownpace rows only. It also says that an alert from inside the machine cannot
report the machine itself (T5). `docs/managed-bring-up.md` gains the settings. Read the three
guards `docs/LESSONS.md` indexes for `gatus.yaml` before the edit.

**Guard.** `scripts/an-alert-someone-reads.unit.test.ts` checks five things:

1. `gatus.yaml` has an `alerting` block, and every value in it is a variable, never a literal.
2. Every Ownpace row carries an alert of the configured type, with `send-on-resolved: true`, a
   failure threshold of at least 2, and `enabled` read from the switch.
3. No Sources or Targets row carries one.
4. `managed.yml` defaults the switch to off and every provider field to a placeholder.
5. Each alert's `description` names a row of T6's runbook table.

It fails today on the first.

### T2 — a tick that says it ran — alpha minimum

**The beat.** A new managed migration creates one table, working name `sync_tick_beat`: one row,
keyed by a constant, holding `beat_at`.

- **No row security, and the migration says so in the words `app_event` uses.** The table has no
  tenant column, it is written by system-level code, and it holds a time and nothing personal.
- **The application role may read it and nothing else.** The tick writes it through the owner
  connection it already uses.

Two functions in `@openmig/managed`:

- `recordTickBeat(pool, now)` writes the row. If it throws, the tick logs and carries on. A beat
  that could not be written costs the beat, never the tick's work, the rule `recordAppEvent`
  follows.
- `readTickBeat(db, now)` answers `up` or `down`. It answers `down` when the row is older than
  `TICK_LATE_AFTER_MS`, five minutes.

Five minutes is a structural number: five missed runs of a one-minute cron. It is not a guess
about traffic, which is what 0026 row 19 objected to.

**Where the tick beats.** At the end of each run, not the start: on the hold's early return, and
after the enqueue phase on the normal path. A beat written first would say "ran" for a tick that
then threw on its enumeration. A single migration that fails to enqueue is already caught and
counted (`failedToEnqueue`), so it does not stop the beat. Under a hold the tick beats: it is
running, and the hold is shown to testers separately.

**Where it is read.** `/api/ready` is not changed, for the reason `ready.ts` gives. A sibling
route, `GET /api/ready/scheduler`, answers `{ "scheduler": "up" | "down" | "off" }`. It follows
the same rule as `/api/ready`: *"It says up or down and NOTHING else"*, and the reason goes to the
log. `off` keeps the meaning `ready.ts` gives it, *"not configured here"*: a deployment that runs
no managed tick. Which setting says so is for the build to settle.

A new Gatus row, **Scheduled syncs**, in the Ownpace group, reads `[BODY].scheduler == up` through
`STATUS_WEB_URL` and carries T1's alert. Each stack's page gets the row, and each reads its own
stack's tick; only live's alerts (T1). Because the operator's support screen reads Gatus's JSON,
it shows the row with no further change. Whether the row is on the public page or only the owner's
is open question 3.

**The other five scheduled tasks** are daily or hourly, and a missed day is less urgent. T3's
daily summary reports each one's last run once they beat too. That is a small follow-up of T2,
using the same table with one row per task.

**Guards.** Each fails today, because none of this exists.

- `packages/managed/src/a-tick-that-says-it-ran.unit.test.ts`, on PGlite with both chains:
  - `recordTickBeat` writes one row and replaces it;
  - `readTickBeat` answers `up` at 30 seconds, and `down` at six minutes or with no row;
  - the application role can select and cannot insert or update.
- `apps/worker/src/jobs/a-tick-that-says-it-ran.unit.test.ts` reads the task body as text, the way
  `a-drain-that-only-said-so` does, because the body needs a runner to execute. It checks that
  `recordTickBeat` is called on the hold's return path and after the enqueue phase, and never
  before the enumeration.
- `apps/api/src/routes/a-tick-that-says-it-ran.unit.test.ts`: the route's body has one field. A
  failed read answers `down` and logs the reason.
- `scripts/status-page.unit.test.ts`: its field scan (*"asserts only on fields /api/ready
  returns"*) learns the second route's type, and **Scheduled syncs** joins `THROUGH_THE_APP`.

### T3 — the disk, and what grows on it

**A check every ten minutes.** `deploy/compose/box-checks.sh`, on a systemd timer on the
reference machine, run from `~/ownpace-live` so that it reads live's `.env` and sends through
live's channel. The unit files go in the bring-up, beside 0132 T7's. Both stacks fill the same
disk, so one check covers them. It measures free space on
Docker's data root (`docker info --format '{{.DockerRootDir}}'`) and on the filesystem that holds
the persisted `.env`. Below `ALERT_DISK_FREE_GB` it sends one message, naming the mount point and
the figure. The default is 15, the figure the preflight already uses.

It remembers what it last said. A disk below the floor is one message, not one every ten minutes,
and a recovery is one more. It sends through `deploy/compose/tell-owner.sh`, a small sender for
T0's channel. For route (a) that is `curl`'s SMTP support with the relay login; for route (b) it
is the webhook.

**One summary a day, numbers only.**

- Free space.
- For each stack, live's and the OTA stack's (the nightly gate adds to the same disk), the size
  of the application database, the identity provider's database and the Trigger.dev plane's
  database (`pg_database_size`).
- The five largest volumes (`docker system df -v`), across both projects.
- Row counts for `run`, `run_event`, `item` and `app_event` in live's application database.
- The age of live's beat (T2).

It reads the database the way `operator.sh` does. If it composes an owner connection string,
`docs/rls-guide.md` §2 lists it, which `a-connection-the-docs-did-not-know-about` enforces.

The summary does two jobs. It turns growth into a number the owner sees, which is what 0143 needs
before it can set run retention for organisations that are never invoiced, registry clean-up or
caps. It also proves the channel is alive: a morning without it means the machine, the timer or
the channel is broken.

**A voice for 0132 T7.** 0132 T7's `box-duties.sh`, which runs daily from `~/ownpace-live`,
*"exits non-zero and names the duty that failed"*, and 0132 says *"Nobody is told when it fails;
0142 is where that changes."* This plan tells the owner: the timer's unit runs `tell-owner.sh` when
the duty fails, using systemd's `OnFailure=`.

**Guard.** `scripts/a-disk-that-says-it-is-filling.unit.test.ts` drives `box-checks.sh` with
stubbed `df`, `docker` and `tell-owner.sh` on `PATH`, as `seed-managed.unit.test.ts` stubs
`docker`.

- 14 GB free sends one message naming the mount point.
- A second run at 14 GB sends nothing.
- 16 GB sends one recovery.
- The daily summary contains no e-mail address and no UUID; a pattern sweep over its output checks
  this.

It fails today, because the script does not exist.

### T4 — what is waiting: queued runs, pooler waits, recorded failures

**The queue.** The tick runs on live's task plane every minute, and already points the SDK at
the plane's API (`configure({ baseURL })`). It reads `queues.retrieve` for `delta-sync` and
`run-discovery` and stores `queued` and `running` in T2's row, beside its own summary numbers
(`triggered`, `heldBack`, `staleRuns`, `failedToEnqueue`). A failed queue read costs the numbers,
never the beat.

`box-checks.sh` sends a message when `queued > 0` and `running = 0` have held for ten minutes:
work is waiting and the plane is taking none. That is a stall, not a threshold on traffic.

Two things have to be checked on the reference machine before the build: whether the self-hosted
plane at v4.5.16 answers `queues.retrieve`, and what a retry that is waiting for its backoff
counts as.

**The pooler.** `box-checks.sh` runs `SHOW POOLS` in live's `pgbouncer` service
(`docker compose exec pgbouncer`; today's container name, `ownpace-pgbouncer`, goes with 0132 T1),
as the healthcheck does.
It sends a message when `cl_waiting > 0` on two runs in a row: clients are waiting for a server
connection, and after 120 seconds PgBouncer disconnects them. The daily summary carries the day's
largest `maxwait`.

**Recorded failures.** The daily summary counts `app_event` rows of the last 24 hours by event,
among them `sync.<domain>.failed`, `api.<code>` and `report.not-delivered`. This is a count, not
an alert. A tester's expired credential is the tester's to fix, and their digest tells them. The
owner sees from the count whether the log page (0129 T2) is worth opening today.

**Guards.** Each fails today, because none of this exists.

- `apps/worker/src/jobs/a-queue-that-says-it-is-waiting.unit.test.ts` reads the task body as text.
  The queue read sits in its own `try`, and the beat is written whether or not it succeeds.
- The T2 function test stores and reads back the numbers.
- `a-disk-that-says-it-is-filling` gains two cases, driven by a stubbed beat and stubbed
  `SHOW POOLS` output:
  - ten minutes of `queued > 0` with `running = 0` send one message;
  - `cl_waiting > 0` twice in a row sends one message.

### T5 — something off the machine that can say "down"

Everything in T1 to T4 runs on the reference machine. When the machine, its power or its
connection is gone, all of it is silent, which is exactly when the owner most needs to hear.

**Recommended:** a second Gatus on a small EU host that is not the reference machine. The owner
chooses the host, and its name and address stay out of this repository. It runs the same
`gatus.yaml`, mounted rather than copied, as the file's header promises: *"this file and the
endpoints it names stay exactly as they are, pointed at public URLs from a machine that is not
this one"*. It uses live's public addresses, the production names 0132 T1e routes:

- `STATUS_WEB_URL` is `https://app.<domain>`;
- `STATUS_IDP_URL` is `https://id.<domain>`;
- the Website row is on.

Its alerts go to T0's channel. The copy on the machine stays, for the operator's support screen
and the view from inside.

Two things have to be checked:

- whether `/debug/ready` answers through the ingress at the public issuer name;
- whether the rows T1 alerts on then alert twice, once from each copy. The proposal is that only
  the outside copy alerts on Web app, API and Website, and only the inside copy on Database,
  Sign-in, Identity provider and Scheduled syncs.

**Not a GitHub schedule.** 0132 T3's outside probe runs on a GitHub-hosted runner, on dispatch
only, and that is right for its job. A scheduled probe there is the wrong tool for this one. GitHub
started 26 of this repository's 04:30 lane runs between 08:27 and 11:14, and the first two in the
afternoon (§1). Its logs are public, and it is US-hosted, which `docs/status-page.md` asks the
status page not to be.

**Files.** Three things change:

- `deploy/status-offbox/compose.yml`, with the one `gatus` service;
- `deploy/status-offbox/offbox.env.example`, with placeholders only;
- `docs/status-page.md`'s *Moving it out later*, which becomes the instructions.

If the off-box copy takes over `status.ownpace.eu`, the sign-in page's link still answers when
the machine is down (open question 4).

**Guard.** `scripts/a-page-that-is-not-on-the-box.unit.test.ts` renders `gatus.yaml` with
`offbox.env.example`. Every Ownpace row must be `https`, and none may name a compose service or a
container port such as `:3126`. The off-box compose file must mount `deploy/compose/gatus.yaml`
itself. It fails today, because neither file exists.

### T6 — what to do when an alert or a tester says something is wrong — alpha minimum

`docs/incident-runbook.md`, linked from the operator runbook. Managed only. It has no secrets and
no names in it, so it belongs in the public repository. A record of each incident is kept by the
owner outside it, because it names testers.

**Who, and what is promised.** The owner, alone (D1). Best effort, no promised response time, in
the words T0 gives 0139 (D2).

**Where signals arrive:**

- T1's alerts, and T3 and T4 once built;
- a tester's report, through 0130's form where a Zammad is configured, or by mail to the address
  in the conditions;
- GitHub's own notifications: a red scheduled run (the nightly gate on the OTA stack, and the lanes
  0141 T13 makes evidence), and an issue the weekly image watch opens (0135 T7, 0146 T8). GitHub
  sends these to the account and addresses in its own notification settings, which cannot be seen
  from here; T0's step 1 includes checking them.

**One row per alert.** Each alert has a row, under the same name as in `gatus.yaml` or
`box-checks.sh`. The row says what the alert means, where to look first, and the first thing to
do. For example:

- *Database*: from `~/ownpace-live`, `docker compose -f deploy/compose/managed.yml ps`, then
  `logs postgres`, then the pooler.
- *Sign-in* and *Identity provider*: the bring-up's failure table.
- *Scheduled syncs*: live's supervisor log and the run list for `managed-sync-tick` on live's own
  Trigger.dev plane (0132 T1c).
- *Disk*: `docker system df`, then the growers §1 lists.

**When a tester reports trouble with their data:**

1. **Find it.** Ask for the reference number the screen shows (0129, 0130), and look it up on the
   log page.
2. **Name the kind.** Something missing at the target; something changed or removed that should
   not have been; something in the wrong place or the wrong organisation; or a credential.
3. **Stop it spreading.** If other testers could be touched, or anything could be removed, start
   the hold on live with a Dutch sentence. It stops scheduled passes and is shown to every
   signed-in tester. It does not stop a pass started by hand (0132 T6 proposes that it should). So
   ask the affected tester to pause the migration (*Pauzeren*, *Pause* in English, on the
   migrations list or the migration's page) and not to press *Synchroniseer nu* (*Trigger sync*)
   until told. If one organisation's migrations have to stop at once, use 0143 T2d's step, which
   this runbook carries: as the database owner, write down the id and state of each of its
   migrations in a state that runs passes, set those to `paused`, and note the date and the
   organisation here.
4. **Keep the evidence.** Do not redeploy, restart, prune or reset live before the relevant rows
   and container output are copied off the machine (0139 T8 step 2). The nightly gate rebuilds
   only the OTA stack and never touches live (0132 D7, T1g), so it does not have to be switched
   off for this; a deploy of live (0132 T6) waits until the copy is made.
5. **Decide whether it is a personal-data breach.** If it may be, 0139 T8's procedure takes over
   from here. Its clock starts when the owner becomes aware, not when the assessment ends.
6. **Tell the tester**, in Dutch. Say what is known, what is not, and what they should do with
   their old account: keep it, as 0131 T1's draft note says.
7. **Say it plainly if data is gone.** There are no backups during the alpha (D4, 0134). What was
   lost on the machine cannot be restored. The source account is untouched, because no connector
   writes to it (0131 T4), so a migration can be set up again.
8. **Write it down**: date, what happened, which organisations, what was done, what testers were
   told. The hold's own history already keeps the last of these for platform-wide holds.

**Guard.** `scripts/a-runbook-for-every-alert.unit.test.ts` checks that every alert in
`gatus.yaml`, and every message `box-checks.sh` can send, has a row in the runbook's table under
the same name. An alert nobody knows what to do about is the next thing to be ignored. Once 0139
T8's page exists, the guard also checks that the runbook links it. It fails today, because the
runbook does not exist. T1's guard point 5 ties the two together.

### T7 — a lane that checked nothing is not green (moved to 0141 T13(c))

The lane's stand-down is honest in its text and misleading in its colour: 28 green ticks, none of
them evidence (§1). 0141 T13(c) plans the change: a first job decides whether the lane is armed,
the lane job runs only when it is, so an unarmed night shows the lane job as skipped, and a proof
may cite a run only when its lane job ran. This plan does not plan it a second time. What it needs
from that change is only that a red lane reaches the owner, which T6 lists among its signals.

### T8 — the architecture document says what is watched

Rewrite §19 as two short lists.

**Built:**

- per-pass lines in `run_event`, kept 60 days;
- the application's errors and warnings in `app_event`, and the operator's log page (0129);
- `/metrics` on both editions, which on managed is unscraped and not fed by passes (§1);
- the status page, and what it cannot see (0094);
- T1 to T6, each added as it lands.

**Not built:** per-tenant dashboards; alerts on stalls, auth failures and throttling; SLOs. It
cites 0026 row 19 and T9.

§18's *"observability (Grafana Cloud EU or self-host LGTM)"* is marked as an option, not deployed,
with a pointer to §19. §22.1's *"per-tenant migration success in observability"* sits in the
release-controls bullet that 0132 T6 rewrites. This task hands it that phrase, so that one line is
not edited twice.

**Guard.** `scripts/a-promise-the-architecture-keeps.unit.test.ts` checks that §19 has a *Not
built* list, and that every path §19 names as built exists in the tree. It fails today on the
first.

### T9 — dashboards, alert rules on stalls, auth failures and throttling, SLOs (parked)

This is 0026 row 19's deferred half, and its reason still holds. The alpha's traffic is at most 20
organisations for a few weeks (D2), which is too little to set a service level on. T1 to T4 ask
only whether something has stopped or is filling up. The trigger is the first paying customer, or
0143's capacity measurements, whichever comes first. Then the numbers T3 and T4 collected are the
first measurements to set thresholds from.

## 4. The alpha: the minimum, and what comes after

**Before the first invitation: T0, T1, T2 and T6.**

- **T0**, because every other task sends somewhere, and because the conditions must say what is
  promised.
- **T1**, because it turns a page that already exists into something that tells the owner, with
  the least new code.
- **T2**, because a stopped tick is silent to everyone, the owner included. The page's other rows
  at least turn red for whoever looks. Testers would read a stopped tick as their migration
  hanging.
- **T6**, because the first bad day should not be the first time the steps are worked out, and
  0139 T8 needs a way in.

0131 T5's go/no-go table lists 0131 to 0140, 0093 T2c and 0130, and has no row for this plan
yet. The row proposed for it: T0's test alert arrived on live, and its recovery too; T1 and T2 are
on `ownpace-live` with the switch on, and off on the OTA stack; T6 is in `docs/`. As with the other
rows, the owner may accept a gap in writing instead, dated, with the reason.

**After the first invitation**, in this order:

1. **T3.** It is the first to add if the owner wants one more before the first invitation. Until
   it exists, the owner reads `df -h` and `docker system df` on the machine once a week.
2. **T4.**
3. **T5.** Until it exists, the testers are the outside probe. They can only be that if the
   conditions name an address whose mail does not pass through the reference machine (T0).
4. **T8**, in the same PR as T1 or straight after.

T7 is 0141 T13(c)'s, after the first invitation there too.

## Not in this plan

- **Backups, and a check of their age:** 0134 T5 (D4).
- **Capacity, per-organisation caps, run retention for organisations that are never invoiced, and
  registry clean-up:** 0143. This plan only measures (T3, T4).
- **The outside exposure probe:** 0132 T3. **The daily duties themselves:** 0132 T7. This plan
  only gives them a voice.
- **The breach procedure, the record of processing and the security policy's channel:** 0139 T8
  and T9.
- **The threat model, and `SECURITY.md`'s stale sentence calling 0026 row 11 an open decision:**
  0136 T7.
- **Arming the live-target lane:** 0105 T3's supervised sitting, and the live runs in 0141. **Its
  colour on a night it stood down:** 0141 T13(c).

## Open questions

1. **The channel (T0).** (a) E-mail to `NOTIFY_TO` through 0133's relay, which is recommended once
   that relay carries live's mail; or (b) a chat or push webhook hosted in the EU, if the first
   invitation comes first. Alerts can arrive at any hour. Is it acceptable that nothing wakes
   anyone, as D2 suggests?
2. **Are alpha testers "customers" for the 2026-08-22 status page decision** (0094 T0b and T4)? If
   they are, T5 moves into the minimum. The recommendation is no: the testers, writing to an
   address off the machine, are the outside probe for a few weeks.
3. **The Scheduled syncs row (T2):** on the public page, where it tells a tester why nothing
   moves, or kept to the owner? Unless Gatus v5.36.0 can hide a row from the public page (to be
   checked), "kept to the owner" means T3's script reads the route instead of the page. The
   recommendation is the public page, with the plain name, and with `/api/ready` left alone.
4. **The status link on the sign-in page.** On live it points at `status.ownpace.eu`, which 0132
   T1e routes to live's page on the machine. If that name does not answer off the mesh (T0 step
   3), or when the machine is down, the link answers testers with a timeout, which
   `StatusLink.tsx` itself calls worse than no link. Should T5's off-box copy take over that name,
   or should the link be hidden on live until it does?
